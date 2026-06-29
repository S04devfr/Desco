/* =====================================================
   DESCO CRM — Global JS
   ===================================================== */

// ── THEME ──
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('crm-theme', theme);
  const icon = document.getElementById('themeIcon');
  if (icon) icon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

(function () {
  const saved = localStorage.getItem('crm-theme') || 'light';
  applyTheme(saved);
})();

// ── TOAST ──
function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const icons = { success: 'fa-check-circle', error: 'fa-times-circle', warning: 'fa-exclamation-triangle', info: 'fa-info-circle' };
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.innerHTML = `
    <i class="fas ${icons[type] || icons.info} toast-icon"></i>
    <span class="toast-msg">${escHtml(message)}</span>
    <button class="toast-close" onclick="this.closest('.toast').remove()">&times;</button>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('hiding');
    setTimeout(() => toast.remove(), 220);
  }, duration);
}

// ── LOGOUT ──
async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch (e) {}
  window.location.href = '/login';
}

// ── ESCAPE HTML ──
function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── FORMAT MONEY ──
function fmtMoney(val) {
  if (val === null || val === undefined) return '—';
  const n = Number(val) || 0;
  return n.toLocaleString('uz-UZ') + ' UZS';
}

function fmtShort(val) {
  const n = Number(val) || 0;
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'mlrd';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'mln';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K';
  return String(n);
}

// ── FORMAT DATES ──
function fmtDate(dateStr) {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('uz-UZ', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return dateStr; }
}

function fmtDateShort(dateStr) {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit', year: '2-digit' });
  } catch { return dateStr; }
}

function fmtDateTime(dateStr) {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleString('uz-UZ', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch { return dateStr; }
}

// ── DEBOUNCE ──
function debounce(fn, delay) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), delay);
  };
}

// ── FETCH WITH TIMEOUT (Zero Freeze Policy) ──
// Page-level data loads should use this instead of raw fetch() so a slow
// or hanging backend can never leave a page stuck on its loading
// skeleton/spinner forever. Aborts after `timeoutMs` (default 5s) and
// throws a friendly, pre-translated error so callers can show a toast
// instead of hanging indefinitely.
function fetchWithTimeout(url, options, timeoutMs) {
  options = options || {};
  timeoutMs = timeoutMs || 5000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, Object.assign({}, options, { signal: controller.signal }))
    .catch(e => {
      if (e && e.name === 'AbortError') {
        const timeoutErr = new Error("Ma'lumotlarni yuklashda xatolik");
        timeoutErr.isTimeout = true;
        throw timeoutErr;
      }
      throw e;
    })
    .finally(() => clearTimeout(timer));
}
window.fetchWithTimeout = fetchWithTimeout;

// ── TOGGLE TASK ──
async function toggleTask(id, el) {
  const completed = !el.classList.contains('done');
  try {
    await fetch('/api/tasks/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed })
    });
    el.classList.toggle('done', completed);
    el.innerHTML = completed ? '<i class="fas fa-check" style="font-size:9px"></i>' : '';
    // Find nearby title and toggle done class
    const titleEl = el.closest('.task-item')?.querySelector('.task-title');
    if (titleEl) titleEl.classList.toggle('done', completed);
    if (typeof window.updateSidebarTaskBadge === 'function') window.updateSidebarTaskBadge();
  } catch (e) {
    showToast('Xato', 'error');
  }
}

// ── GLOBAL SEARCH (topbar) ──
const globalSearchEl = document.getElementById('globalSearch');
if (globalSearchEl) {
  globalSearchEl.addEventListener('input', debounce(async function () {
    const q = this.value.trim();
    if (q.length < 2) return;
    try {
      const r = await fetch('/api/search?q=' + encodeURIComponent(q));
      if (r.ok) {
        const data = await r.json();
        // Simple: navigate to relevant page
        if (data.deals && data.deals.length) window._searchHint = 'deals';
      }
    } catch (e) {}
  }, 400));
}

// ── MODAL BACKDROP CLOSE ──
document.addEventListener('click', function (e) {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.add('hidden');
  }
});

// ── ESC TO CLOSE MODAL ──
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => m.classList.add('hidden'));
  }
});

// ── UPDATE SIDEBAR TASK BADGE ──
async function updateSidebarTaskBadge() {
  const badge = document.getElementById('sidebar-task-badge');
  if (!badge) return;
  try {
    const r = await fetch('/api/dashboard/today-tasks');
    if (r.ok) {
      const tasks = await r.json();
      const count = Array.isArray(tasks) ? tasks.length : 0;
      if (count > 0) {
        badge.textContent = count;
        badge.style.display = 'inline-block';
      } else {
        badge.style.display = 'none';
      }
    }
  } catch (e) {
    console.error('Error fetching today tasks count:', e);
  }
}
window.updateSidebarTaskBadge = updateSidebarTaskBadge;

document.addEventListener('DOMContentLoaded', () => {
  updateSidebarTaskBadge();
});
