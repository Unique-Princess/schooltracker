// PASTE your Apps Script deployment's /exec URL here after deploying:
const API_URL = 'https://script.google.com/macros/s/AKfycbwVulbnnA-tZ1dM68QEcjCN37oCc5a-ByWVQMOS_ezQON9jPYMdursGk754FJpcnq3b0w/exec';

let DATA = { students: [], terms: [], fees: [], balances: [], payments: [], discounts: [], currentTerm: null, categories: [] };
let STAFF_NAME = null;
let ACTIVE_STUDENT = null;

document.addEventListener('DOMContentLoaded', () => {
  apiGet('getInitData').then(onDataLoaded).catch(onLoadError);
});

// ---------- API helpers ----------
function apiGet(action, params) {
  const query = new URLSearchParams({ action, ...(params || {}) }).toString();
  return fetch(`${API_URL}?${query}`)
    .then(res => res.json())
    .then(data => { if (data && data.error) throw new Error(data.error); return data; });
}

function apiPost(action, payload) {
  return fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids CORS preflight
    body: JSON.stringify({ action, payload })
  })
    .then(res => res.json())
    .then(data => { if (data && data.error) throw new Error(data.error); return data; });
}

function onLoadError(err) {
  document.getElementById('loadingState').innerHTML =
    '<p style="color:#B23A3A">Could not load data: ' + err.message + '</p>';
}

function onDataLoaded(data) {
  DATA = data;
  document.getElementById('loadingState').classList.add('hidden');

  if (DATA.currentTerm) {
    document.getElementById('termLabel').textContent = DATA.currentTerm.TermName + ' — ' + DATA.currentTerm.Session;
    document.getElementById('reportTermLabel').textContent = DATA.currentTerm.TermName + ' — ' + DATA.currentTerm.Session;
  }

  document.getElementById('gateScreen').classList.remove('hidden');
  document.getElementById('gateContinue').addEventListener('click', onGateContinue);
  document.getElementById('gatePin').addEventListener('keydown', e => { if (e.key === 'Enter') onGateContinue(); });
  setupTabs();
  document.getElementById('studentSearch').addEventListener('input', renderStudentList);
  document.getElementById('backToList').addEventListener('click', () => showScreen('listScreen'));
  document.getElementById('paymentSubmit').addEventListener('click', submitPayment);
  document.getElementById('openingSubmit').addEventListener('click', submitOpeningBalance);
  document.getElementById('discountSubmit').addEventListener('click', submitDiscount);
  document.getElementById('recentDateFilter').addEventListener('input', renderRecentPayments);
  document.getElementById('recentDateClear').addEventListener('click', () => {
    document.getElementById('recentDateFilter').value = '';
    renderRecentPayments();
  });
}

function onGateContinue() {
  const pin = document.getElementById('gatePin').value.trim();
  if (!pin) { document.getElementById('gatePin').focus(); return; }

  const btn = document.getElementById('gateContinue');
  btn.disabled = true;
  btn.textContent = 'Checking…';

  apiGet('verifyPin', { pin })
    .then(res => {
      btn.disabled = false;
      btn.textContent = 'Continue';
      STAFF_NAME = res.staffName;
      document.getElementById('staffLabel').textContent = 'Logged in as ' + STAFF_NAME;
      document.getElementById('gateScreen').classList.add('hidden');
      document.getElementById('tabbar').classList.remove('hidden');
      showScreen('listScreen');
      renderStudentList();
      renderRecentPayments();
      renderReports();
    })
    .catch(err => {
      btn.disabled = false;
      btn.textContent = 'Continue';
      showFeedback('gateFeedback', err.message, 'error');
      document.getElementById('gatePin').value = '';
      document.getElementById('gatePin').focus();
    });
}

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      showScreen(btn.dataset.screen);
      if (btn.dataset.screen === 'recentScreen') renderRecentPayments();
      if (btn.dataset.screen === 'reportsScreen') renderReports();
    });
  });
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

function activePayments() {
  return DATA.payments.filter(p => p.Status !== 'Void');
}

function getStudentFinancials(studentId) {
  const termId = DATA.currentTerm ? DATA.currentTerm.TermID : null;
  const student = DATA.students.find(s => s.StudentID === studentId);

  const openingRow = DATA.balances.find(b => b.StudentID === studentId && b.TermID === termId);
  const opening = openingRow ? Number(openingRow.OpeningBalance) : 0;

  const discount = DATA.discounts
    .filter(d => d.StudentID === studentId && d.TermID === termId)
    .reduce((sum, d) => sum + Number(d.Amount), 0);

  const studentFees = DATA.fees.filter(f => f.Class === (student ? student.Class : null) && f.TermID === termId);
  const studentPayments = activePayments().filter(p => p.StudentID === studentId && p.TermID === termId);

  const byCategory = studentFees.map(f => {
    const paid = studentPayments.filter(p => p.Category === f.Category).reduce((sum, p) => sum + Number(p.Amount), 0);
    return { category: f.Category, expected: Number(f.ExpectedAmount), paid, balance: Number(f.ExpectedAmount) - paid };
  });

  const carryOverPaid = studentPayments.filter(p => p.Category === 'Previous Term Balance').reduce((sum, p) => sum + Number(p.Amount), 0);
  const carryOverBalance = Math.max(opening - carryOverPaid, 0);

  const expected = byCategory.reduce((sum, c) => sum + c.expected, 0);
  const paid = studentPayments.reduce((sum, p) => sum + Number(p.Amount), 0);
  const totalDue = Math.max(opening + expected - discount, 0);
  const balance = totalDue - paid;

  return { opening, carryOverBalance, discount, expected, totalDue, paid, balance, byCategory, studentPayments };
}

function renderStudentList() {
  const query = (document.getElementById('studentSearch').value || '').toLowerCase();
  const rows = DATA.students
    .filter(s => s.Status === 'Active')
    .filter(s => (s.FullName + ' ' + s.Class).toLowerCase().includes(query))
    .map(s => {
      const fin = getStudentFinancials(s.StudentID);
      const owing = fin.balance > 0;
      return `
        <div class="student-row" data-id="${s.StudentID}">
          <div class="student-row-name">${s.FullName}<span class="student-class">${s.Class}</span></div>
          <div class="student-badge ${owing ? 'owing' : ''}">${owing ? '₦' + fin.balance.toLocaleString() + ' due' : 'Cleared'}</div>
        </div>`;
    }).join('');
  document.getElementById('studentList').innerHTML = rows || '<p class="muted">No students match.</p>';
  document.querySelectorAll('.student-row').forEach(row => row.addEventListener('click', () => openStudent(row.dataset.id)));
}

function openStudent(studentId) {
  ACTIVE_STUDENT = studentId;
  const student = DATA.students.find(s => s.StudentID === studentId);
  const fin = getStudentFinancials(studentId);

  document.getElementById('detailName').textContent = student.FullName;
  document.getElementById('detailClass').textContent = student.Class + (DATA.currentTerm ? ' · ' + DATA.currentTerm.TermName : '');

  document.getElementById('categoryBreakdown').innerHTML = fin.byCategory.map(c => `
    <div class="category-breakdown-row">
      <div>
        <span class="cat-name">${c.category}</span>
        <span class="cat-meta">Expected ₦${c.expected.toLocaleString()} · Paid ₦${c.paid.toLocaleString()}</span>
      </div>
      <div class="cat-balance ${c.balance > 0 ? 'owing' : 'clear'}">${c.balance > 0 ? '₦' + c.balance.toLocaleString() + ' due' : 'Cleared'}</div>
    </div>`).join('') || '<p class="muted">No fee categories set for this class/term yet.</p>';

  document.getElementById('detailOpening').textContent = '₦' + fin.opening.toLocaleString();

  const discountRow = document.getElementById('detailDiscountRow');
  if (fin.discount > 0) {
    discountRow.classList.remove('hidden');
    document.getElementById('detailDiscount').textContent = '-₦' + fin.discount.toLocaleString();
  } else {
    discountRow.classList.add('hidden');
  }

  document.getElementById('detailTotalDue').textContent = '₦' + fin.totalDue.toLocaleString();
  document.getElementById('detailPaid').textContent = '₦' + fin.paid.toLocaleString();

  const balanceEl = document.getElementById('detailBalance');
  balanceEl.textContent = '₦' + fin.balance.toLocaleString();
  balanceEl.parentElement.className = 'due-row balance ' + (fin.balance > 0 ? 'owing' : 'clear');

  renderCategoryInputs(fin);
  document.getElementById('paymentNote').value = '';
  document.getElementById('openingAmount').value = fin.opening;
  document.getElementById('discountAmount').value = fin.discount;
  document.getElementById('discountReason').value =
    (DATA.discounts.find(d => d.StudentID === studentId && d.TermID === (DATA.currentTerm ? DATA.currentTerm.TermID : null)) || {}).Reason || '';

  renderPaymentHistory(fin.studentPayments, 'paymentHistory');
  showScreen('detailScreen');
}

function renderCategoryInputs(fin) {
  const container = document.getElementById('categoryInputs');
  const rows = [];

  if (fin.carryOverBalance > 0) {
    rows.push(`
      <label class="category-row">
        <input type="checkbox" class="cat-checkbox" data-category="Previous Term Balance" checked />
        <span class="category-row-label">Previous term balance<span class="category-due">Balance: ₦${fin.carryOverBalance.toLocaleString()}</span></span>
        <input type="number" class="cat-amount" inputmode="decimal" value="${fin.carryOverBalance}" />
      </label>`);
  }

  fin.byCategory.forEach(c => {
    rows.push(`
      <label class="category-row">
        <input type="checkbox" class="cat-checkbox" data-category="${c.category}" ${c.balance > 0 ? 'checked' : ''} />
        <span class="category-row-label">${c.category}<span class="category-due">Balance: ₦${Math.max(c.balance, 0).toLocaleString()}</span></span>
        <input type="number" class="cat-amount" inputmode="decimal" value="${Math.max(c.balance, 0)}" />
      </label>`);
  });

  container.innerHTML = rows.join('') || '<p class="muted">No fee categories set for this class/term yet.</p>';
}

function renderPaymentHistory(payments, targetId) {
  const active = payments.filter(p => p.Status !== 'Void');
  const sorted = [...active].sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp));
  document.getElementById(targetId).innerHTML = sorted.map(p => `
    <div class="payment-row" data-payment-id="${p.PaymentID}">
      <div class="payment-row-main">
        ${p.Category}
        <span class="payment-row-meta">${formatDate(p.Timestamp)} · ${p.RecordedBy || ''}${p.Note ? ' · ' + p.Note : ''}</span>
      </div>
      <div class="payment-row-amount">₦${Number(p.Amount).toLocaleString()}</div>
      <button class="void-btn" data-void-id="${p.PaymentID}">Delete</button>
    </div>`).join('') || '<p class="muted">No payments recorded yet.</p>';
  attachVoidHandlers(targetId);
}

function attachVoidHandlers(containerId) {
  document.querySelectorAll('#' + containerId + ' .void-btn').forEach(btn => {
    btn.addEventListener('click', () => onVoidClick(btn.dataset.voidId));
  });
}

function onVoidClick(paymentId) {
  if (!confirm('Delete this payment record? This removes it from balances and history.')) return;
  apiPost('voidPayment', { paymentId })
    .then(() => {
      const p = DATA.payments.find(p => p.PaymentID === paymentId);
      if (p) p.Status = 'Void';
      if (ACTIVE_STUDENT) openStudent(ACTIVE_STUDENT);
      renderStudentList();
      renderRecentPayments();
      renderReports();
    })
    .catch(err => alert('Could not delete: ' + err.message));
}

function formatDate(ts) {
  const d = new Date(ts);
  return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function submitPayment() {
  const lines = [];
  document.querySelectorAll('#categoryInputs .category-row').forEach(row => {
    const checkbox = row.querySelector('.cat-checkbox');
    const amountInput = row.querySelector('.cat-amount');
    if (checkbox.checked && Number(amountInput.value) > 0) {
      lines.push({ category: checkbox.dataset.category, amount: amountInput.value });
    }
  });

  if (lines.length === 0) {
    showFeedback('paymentFeedback', 'Tick at least one category with an amount.', 'error');
    return;
  }

  const payload = {
    studentId: ACTIVE_STUDENT,
    termId: DATA.currentTerm ? DATA.currentTerm.TermID : null,
    recordedBy: STAFF_NAME,
    note: document.getElementById('paymentNote').value,
    lines: lines
  };

  const btn = document.getElementById('paymentSubmit');
  btn.disabled = true;
  btn.textContent = 'Recording…';

  apiPost('recordPayment', payload)
    .then(res => {
      btn.disabled = false;
      btn.textContent = 'Record payment';
      showFeedback('paymentFeedback', 'Payment recorded ✓ Receipt emailed if guardian email is on file.', 'success');

      lines.forEach((line, i) => {
        DATA.payments.push({
          PaymentID: res.paymentIds[i], Timestamp: new Date().toISOString(),
          StudentID: payload.studentId, TermID: payload.termId, Category: line.category,
          Amount: Number(line.amount), RecordedBy: payload.recordedBy, Note: payload.note,
          Status: 'Active', ReceiptGroupID: res.receiptGroupId
        });
      });

      openStudent(ACTIVE_STUDENT);
      renderStudentList();
      renderReports();
    })
    .catch(err => {
      btn.disabled = false;
      btn.textContent = 'Record payment';
      showFeedback('paymentFeedback', err.message, 'error');
    });
}

function submitOpeningBalance() {
  const amount = document.getElementById('openingAmount').value;
  const payload = { studentId: ACTIVE_STUDENT, termId: DATA.currentTerm ? DATA.currentTerm.TermID : null, amount };

  const btn = document.getElementById('openingSubmit');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  apiPost('setOpeningBalance', payload)
    .then(() => {
      btn.disabled = false;
      btn.textContent = 'Save carried-over balance';
      showFeedback('openingFeedback', 'Balance updated ✓', 'success');
      const existing = DATA.balances.find(b => b.StudentID === payload.studentId && b.TermID === payload.termId);
      if (existing) existing.OpeningBalance = Number(payload.amount);
      else DATA.balances.push({ StudentID: payload.studentId, TermID: payload.termId, OpeningBalance: Number(payload.amount) });
      openStudent(ACTIVE_STUDENT);
      renderStudentList();
    })
    .catch(err => {
      btn.disabled = false;
      btn.textContent = 'Save carried-over balance';
      showFeedback('openingFeedback', err.message, 'error');
    });
}

function submitDiscount() {
  const amount = document.getElementById('discountAmount').value || 0;
  const reason = document.getElementById('discountReason').value;
  const payload = { studentId: ACTIVE_STUDENT, termId: DATA.currentTerm ? DATA.currentTerm.TermID : null, amount, reason };

  const btn = document.getElementById('discountSubmit');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  apiPost('setDiscount', payload)
    .then(() => {
      btn.disabled = false;
      btn.textContent = 'Save discount';
      showFeedback('discountFeedback', 'Discount saved ✓', 'success');
      const existing = DATA.discounts.find(d => d.StudentID === payload.studentId && d.TermID === payload.termId);
      if (existing) { existing.Amount = Number(payload.amount); existing.Reason = payload.reason; }
      else DATA.discounts.push({ StudentID: payload.studentId, TermID: payload.termId, Amount: Number(payload.amount), Reason: payload.reason });
      openStudent(ACTIVE_STUDENT);
      renderStudentList();
      renderReports();
    })
    .catch(err => {
      btn.disabled = false;
      btn.textContent = 'Save discount';
      showFeedback('discountFeedback', err.message, 'error');
    });
}

function renderRecentPayments() {
  const dateFilter = document.getElementById('recentDateFilter').value;

  let list = activePayments().map(p => {
    const student = DATA.students.find(s => s.StudentID === p.StudentID);
    return { ...p, StudentName: student ? student.FullName : p.StudentID };
  });

  if (dateFilter) {
    list = list.filter(p => {
      const d = new Date(p.Timestamp);
      const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      return iso === dateFilter;
    });
  }

  const sorted = list.sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp)).slice(0, 100);
  document.getElementById('recentList').innerHTML = sorted.map(p => `
    <div class="payment-row" data-payment-id="${p.PaymentID}">
      <div class="payment-row-main">
        ${p.StudentName} <span class="muted small" style="margin:0">· ${p.Category}</span>
        <span class="payment-row-meta">${formatDate(p.Timestamp)} · ${p.RecordedBy || ''}</span>
      </div>
      <div class="payment-row-amount">₦${Number(p.Amount).toLocaleString()}</div>
      <button class="void-btn" data-void-id="${p.PaymentID}">Delete</button>
    </div>`).join('') || '<p class="muted">No payments match.</p>';

  attachVoidHandlers('recentList');
}

function renderReports() {
  const termId = DATA.currentTerm ? DATA.currentTerm.TermID : null;
  const termPayments = activePayments().filter(p => p.TermID === termId);
  const activeStudents = DATA.students.filter(s => s.Status === 'Active');

  const totalCollected = termPayments.reduce((sum, p) => sum + Number(p.Amount), 0);

  let totalOutstanding = 0;
  let studentsOwing = 0;
  activeStudents.forEach(s => {
    const fin = getStudentFinancials(s.StudentID);
    if (fin.balance > 0) { totalOutstanding += fin.balance; studentsOwing++; }
  });

  document.getElementById('reportSummary').innerHTML = `
    <div class="due-row"><span>Total collected this term</span><span>₦${totalCollected.toLocaleString()}</span></div>
    <div class="due-row"><span>Students fully cleared</span><span>${activeStudents.length - studentsOwing} of ${activeStudents.length}</span></div>
    <div class="due-row balance owing"><span>Total outstanding</span><span>₦${totalOutstanding.toLocaleString()}</span></div>`;

  const byCategory = {};
  termPayments.forEach(p => { byCategory[p.Category] = (byCategory[p.Category] || 0) + Number(p.Amount); });
  document.getElementById('reportByCategory').innerHTML = Object.keys(byCategory).length
    ? Object.entries(byCategory).map(([cat, amt]) => `<div class="due-row"><span>${cat}</span><span>₦${amt.toLocaleString()}</span></div>`).join('')
    : '<p class="muted">No payments recorded this term yet.</p>';

  const classSummary = {};
  activeStudents.forEach(s => {
    const fin = getStudentFinancials(s.StudentID);
    if (!classSummary[s.Class]) classSummary[s.Class] = { collected: 0, outstanding: 0, count: 0 };
    classSummary[s.Class].collected += fin.paid;
    classSummary[s.Class].outstanding += Math.max(fin.balance, 0);
    classSummary[s.Class].count += 1;
  });

  document.getElementById('reportByClass').innerHTML = Object.entries(classSummary)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([cls, s]) => `
      <div class="student-row" style="cursor:default">
        <div class="student-row-name">${cls}<span class="student-class">${s.count} students · ₦${s.collected.toLocaleString()} collected</span></div>
        <div class="student-badge ${s.outstanding > 0 ? 'owing' : ''}">${s.outstanding > 0 ? '₦' + s.outstanding.toLocaleString() + ' owed' : 'All cleared'}</div>
      </div>`).join('') || '<p class="muted">No active students found.</p>';
}

function showFeedback(elId, message, type) {
  const el = document.getElementById(elId);
  el.textContent = message;
  el.className = 'feedback ' + type;
  setTimeout(() => { el.textContent = ''; el.className = 'feedback'; }, 3000);
}
