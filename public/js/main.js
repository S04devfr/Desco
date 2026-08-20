/* =====================================================
   DESCO CRM — Global JS
   ===================================================== */

// ── THEME ──
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('crm-theme', theme);
  const icon = document.getElementById('themeIcon');
  if (icon) icon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
  
  // Sync logo image according to theme
  document.querySelectorAll('.app-brand-logo').forEach(function(img) {
    img.src = theme === 'dark' ? '/img/logo-dark.png' : '/img/logo-light.png';
  });
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

(function () {
  const saved = localStorage.getItem('crm-theme') || 'light';
  applyTheme(saved);
  document.addEventListener('DOMContentLoaded', () => applyTheme(saved));
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
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return typeof dateStr === 'object' ? JSON.stringify(dateStr) : String(dateStr);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}.${mm}.${yyyy}`;
  } catch { return typeof dateStr === 'object' ? JSON.stringify(dateStr) : String(dateStr); }
}

function fmtDateShort(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(2);
    return `${dd}.${mm}.${yy}`;
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

// ── CSRF PROTECTION HELPER ──
// ── FETCH WITH TIMEOUT (Zero Freeze Policy) ──
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

// ── GLOBAL SEARCH (topbar dropdown engine) ──
const globalSearchEl = document.getElementById('globalSearch');
const globalResultsEl = document.getElementById('globalSearchResults');

if (globalSearchEl && globalResultsEl) {
  const performSearch = debounce(async function () {
    const q = globalSearchEl.value.trim();
    if (q.length < 2) {
      globalResultsEl.style.display = 'none';
      globalResultsEl.innerHTML = '';
      return;
    }

    try {
      globalResultsEl.innerHTML = `
        <div style="padding:16px; text-align:center; color:var(--text-secondary); font-size:12.5px;">
          <i class="fas fa-spinner fa-spin" style="margin-right:6px; color:var(--brand)"></i> Qidirilmoqda...
        </div>
      `;
      globalResultsEl.style.display = 'block';

      const r = await fetch('/api/search?q=' + encodeURIComponent(q));
      if (!r.ok) throw new Error();
      const data = await r.json();

      const deals = data.deals || [];
      const clients = data.clients || [];

      if (!deals.length && !clients.length) {
        globalResultsEl.innerHTML = `
          <div style="padding:16px; text-align:center; color:var(--text-tertiary); font-size:12.5px;">
            <i class="fas fa-search" style="font-size:18px; margin-bottom:6px; display:block; opacity:0.5;"></i>
            Natija topilmadi
          </div>
        `;
        return;
      }

      let html = '';

      if (deals.length) {
        html += `<div style="padding:6px 14px 4px 14px; font-size:10.5px; font-weight:700; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.5px; border-bottom:1px solid var(--border);">SDELKALAR (${deals.length})</div>`;
        deals.forEach(d => {
          const formattedAmount = d.amount ? Number(d.amount).toLocaleString('uz-UZ') + ' so\'m' : '—';
          html += `
            <div onclick="openSearchDeal(${d.id})" style="padding:8px 14px; cursor:pointer; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border); transition:background 0.12s;" onmouseenter="this.style.background='var(--bg-secondary)'" onmouseleave="this.style.background='transparent'">
              <div style="display:flex; flex-direction:column; gap:2px; overflow:hidden; padding-right:8px;">
                <div style="font-size:13px; font-weight:700; color:var(--text-primary); text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">
                  <span style="color:var(--brand); font-weight:800; margin-right:4px;">${escHtml(d.dealNumber)}</span> ${escHtml(d.title)}
                </div>
                <div style="font-size:11px; color:var(--text-secondary); display:flex; align-items:center; gap:6px;">
                  <span><i class="fas fa-user" style="font-size:9.5px; margin-right:3px;"></i>${escHtml(d.clientName)}</span>
                  ${d.clientPhone ? `<span style="font-weight:600;"><i class="fas fa-phone-alt" style="font-size:9px; margin-right:2px;"></i>${escHtml(d.clientPhone)}</span>` : ''}
                </div>
              </div>
              <div style="display:flex; flex-direction:column; align-items:flex-end; gap:3px; flex-shrink:0;">
                <span class="badge" style="font-size:9px; padding:2px 6px; border-radius:4px; font-weight:700; color:#fff; background:${d.stageColor || '#007AFF'};">${escHtml(d.stageName)}</span>
                <span style="font-size:11px; font-weight:700; color:var(--text-primary);">${formattedAmount}</span>
              </div>
            </div>
          `;
        });
      }

      if (clients.length) {
        html += `<div style="padding:8px 14px 4px 14px; font-size:10.5px; font-weight:700; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.5px; border-bottom:1px solid var(--border); margin-top:4px;">MIJOZLAR (${clients.length})</div>`;
        clients.forEach(c => {
          html += `
            <div onclick="window.location.href='/deals?q=' + encodeURIComponent('${escHtml(c.phone || c.name)}')" style="padding:8px 14px; cursor:pointer; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border); transition:background 0.12s;" onmouseenter="this.style.background='var(--bg-secondary)'" onmouseleave="this.style.background='transparent'">
              <div>
                <div style="font-size:12.5px; font-weight:700; color:var(--text-primary);">${escHtml(c.name)}</div>
                <div style="font-size:11px; color:var(--text-secondary);"><i class="fas fa-phone-alt" style="font-size:9.5px; margin-right:3px;"></i>${escHtml(c.phone || '—')}</div>
              </div>
              <span style="font-size:10px; font-weight:600; color:var(--brand); background:var(--brand-soft); padding:2px 6px; border-radius:4px;">${c.dealCount} ta sdelka</span>
            </div>
          `;
        });
      }

      globalResultsEl.innerHTML = html;
      globalResultsEl.style.display = 'block';
    } catch (e) {
      globalResultsEl.innerHTML = `<div style="padding:12px; color:var(--danger); font-size:11.5px; text-align:center;">Qidiruvda xatolik yuz berdi</div>`;
    }
  }, 250);

  globalSearchEl.addEventListener('input', performSearch);
  globalSearchEl.addEventListener('focus', () => {
    if (globalSearchEl.value.trim().length >= 2) performSearch();
  });

  document.addEventListener('click', (e) => {
    if (!globalSearchEl.contains(e.target) && !globalResultsEl.contains(e.target)) {
      globalResultsEl.style.display = 'none';
    }
  });
}

window.openSearchDeal = function (dealId) {
  if (globalResultsEl) globalResultsEl.style.display = 'none';
  if (typeof openDealModal === 'function') {
    openDealModal(dealId);
  } else {
    window.location.href = '/deals?dealId=' + dealId;
  }
};

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

// ── UPDATE SIDEBAR CHAT BADGES ──
async function updateSidebarChatBadges() {
  const igBadge = document.getElementById('sidebar-instagram-badge');
  const tgBadge = document.getElementById('sidebar-telegram-badge');
  if (!igBadge && !tgBadge) return;
  try {
    const r = await fetch('/api/dashboard/unread-chats');
    if (r.ok) {
      const counts = await r.json();
      if (igBadge) {
        const igCount = counts.instagram || 0;
        if (igCount > 0) {
          igBadge.textContent = igCount;
          igBadge.classList.remove('hidden');
          igBadge.style.display = 'flex';
        } else {
          igBadge.classList.add('hidden');
          igBadge.style.display = 'none';
        }
      }
      if (tgBadge) {
        const tgCount = counts.telegram || 0;
        if (tgCount > 0) {
          tgBadge.textContent = tgCount;
          tgBadge.classList.remove('hidden');
          tgBadge.style.display = 'flex';
        } else {
          tgBadge.classList.add('hidden');
          tgBadge.style.display = 'none';
        }
      }
    }
  } catch (e) {
    console.error('Error fetching unread chat counts:', e);
  }
}
window.updateSidebarChatBadges = updateSidebarChatBadges;

document.addEventListener('DOMContentLoaded', () => {
  updateSidebarTaskBadge();
  updateSidebarChatBadges();
});

// ── MOBILE MENU TOGGLE ──
function toggleMobileMenu() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('mobileOverlay') || document.getElementById('sidebarOverlay');
  if (sidebar) {
    sidebar.classList.toggle('mobile-open');
  }
  if (overlay) {
    overlay.classList.toggle('active');
  }
}
window.toggleMobileMenu = toggleMobileMenu;
