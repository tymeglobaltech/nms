'use strict';

let pages = [];
let currentPageId = null;
let authToken = sessionStorage.getItem('nms_token') || null;

const SEARCHABLE_SLUGS = new Set(['voice-gates', 'operators']);

async function apiFetch(url, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
  const res = await fetch(url, { ...opts, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Dark mode
// ---------------------------------------------------------------------------

const DARK_KEY = 'nms_dark';

function initDarkMode() {
  const stored = localStorage.getItem(DARK_KEY);
  // Default to system preference if no stored setting
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = stored !== null ? stored === '1' : prefersDark;
  applyDarkMode(dark, false);
}

function toggleDarkMode() {
  const isDark = document.documentElement.dataset.theme === 'dark';
  applyDarkMode(!isDark);
}

function applyDarkMode(dark, save = true) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const btn = document.getElementById('dark-toggle');
  if (btn) btn.textContent = dark ? '☀' : '☾';
  if (save) localStorage.setItem(DARK_KEY, dark ? '1' : '0');
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function init() {
  initDarkMode();

  try {
    pages = await apiFetch('/api/pages');
  } catch (e) {
    document.getElementById('content').textContent = 'Error loading data: ' + e.message;
    return;
  }

  buildNav();
  const def = pages.find(p => p.isDefault) || pages[0];
  if (def) showPage(def.id);

  // Handle hash navigation
  const hash = location.hash.slice(1);
  if (hash) {
    const target = pages.find(p => p.slug === hash);
    if (target) showPage(target.id);
  }

  // Google SSO config
  try {
    const cfg = await apiFetch('/api/config');
    if (cfg.googleClientId) setupGoogle(cfg.googleClientId);
  } catch { /* no SSO */ }

  // Admin link
  if (authToken) document.getElementById('admin-link').style.display = 'inline-block';
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function buildNav() {
  const nav = document.getElementById('site-nav');
  nav.innerHTML = '';
  pages.sort((a, b) => a.order - b.order).forEach(page => {
    const tab = document.createElement('a');
    tab.className = 'nav-tab';
    tab.textContent = page.title;
    tab.href = '#' + page.slug;
    tab.dataset.pageId = page.id;
    if (page.maintenancePopup) {
      tab.addEventListener('click', e => {
        e.preventDefault();
        window.open('/maintenance.html', 'maintenance',
          'toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes,width=900,height=600');
      });
    } else {
      tab.addEventListener('click', e => {
        e.preventDefault();
        showPage(page.id);
        history.replaceState(null, '', '#' + page.slug);
      });
    }
    nav.appendChild(tab);
  });
}

function showPage(pageId) {
  currentPageId = pageId;

  document.querySelectorAll('.nav-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.pageId === pageId);
  });

  const page = pages.find(p => p.id === pageId);
  if (!page) return;

  const content = document.getElementById('content');
  content.innerHTML = '';

  // Search bar for designated pages
  if (SEARCHABLE_SLUGS.has(page.slug)) {
    content.appendChild(buildSearchBar());
  }

  page.sections.forEach(section => {
    const colCount = section.columnHeaders.length;
    if (colCount === 0 && section.rows.length === 0) return;

    const block = document.createElement('div');
    block.className = 'section-block';

    const table = document.createElement('table');

    // Collapse header into single full-width th when all headers are the same
    // or when only one column header has content.
    const thead = document.createElement('thead');
    const hrow = document.createElement('tr');
    const nonEmptyHeaders = section.columnHeaders.filter(h => h);
    const allSame = section.columnHeaders.length > 0 &&
      section.columnHeaders.every(h => h === section.columnHeaders[0]);
    const collapse = allSame || nonEmptyHeaders.length <= 1;

    if (collapse) {
      const th = document.createElement('th');
      th.colSpan = colCount;
      th.textContent = nonEmptyHeaders[0] || '';
      hrow.appendChild(th);
    } else {
      section.columnHeaders.forEach(h => {
        const th = document.createElement('th');
        th.textContent = h;
        hrow.appendChild(th);
      });
    }
    thead.appendChild(hrow);
    table.appendChild(thead);

    // Data rows
    const tbody = document.createElement('tbody');
    section.rows.forEach(row => {
      const tr = document.createElement('tr');
      for (let i = 0; i < colCount; i++) {
        const cell = row.cells[i] || { label: '', url: '' };
        const td = document.createElement('td');
        if (cell.label && cell.url) {
          const a = document.createElement('a');
          a.href = cell.url;
          a.textContent = cell.label;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          td.appendChild(a);
        } else if (cell.label) {
          td.textContent = cell.label;
        } else {
          td.className = 'empty-cell';
          td.textContent = ' ';
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    block.appendChild(table);
    content.appendChild(block);
  });
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

function buildSearchBar() {
  const wrapper = document.createElement('div');
  wrapper.className = 'search-bar';
  wrapper.innerHTML = `
    <span class="search-icon">&#9906;</span>
    <input type="text" id="search-input" placeholder="Search&hellip;" autocomplete="off" spellcheck="false" />
    <button class="search-clear" id="search-clear" title="Clear" style="display:none">&times;</button>
    <span class="search-count" id="search-count"></span>
  `;

  const input = wrapper.querySelector('#search-input');
  const clearBtn = wrapper.querySelector('#search-clear');
  const countEl = wrapper.querySelector('#search-count');

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    clearBtn.style.display = q ? 'inline' : 'none';
    applySearch(q, countEl);
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    clearBtn.style.display = 'none';
    applySearch('', countEl);
    input.focus();
  });

  // Keyboard shortcut: Escape clears
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') clearBtn.click();
  });

  // Auto-focus after render
  requestAnimationFrame(() => input.focus());

  return wrapper;
}

function applySearch(query, countEl) {
  let totalVisible = 0;

  document.querySelectorAll('.section-block').forEach(block => {
    let sectionVisible = 0;

    block.querySelectorAll('tbody tr').forEach(tr => {
      const text = tr.textContent.toLowerCase();
      const match = !query || text.includes(query);
      tr.style.display = match ? '' : 'none';
      if (match) sectionVisible++;
    });

    // Hide sections where nothing matches; always show when no query
    block.style.display = (query && sectionVisible === 0) ? 'none' : '';
    totalVisible += sectionVisible;
  });

  if (countEl) {
    countEl.textContent = query
      ? `${totalVisible} result${totalVisible !== 1 ? 's' : ''}`
      : '';
  }
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const username = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  try {
    const data = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    authToken = data.token;
    sessionStorage.setItem('nms_token', authToken);
    closeLogin();
    showToast('Logged in as ' + data.username);
    document.getElementById('admin-link').style.display = 'inline-block';
  } catch (err) {
    errEl.textContent = err.message;
  }
});

function openLogin() {
  document.getElementById('login-overlay').classList.add('open');
}
function closeLogin() {
  document.getElementById('login-overlay').classList.remove('open');
}

document.getElementById('login-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('login-overlay')) closeLogin();
});

// ---------------------------------------------------------------------------
// Google SSO
// ---------------------------------------------------------------------------

function setupGoogle(clientId) {
  const script = document.createElement('script');
  script.src = 'https://accounts.google.com/gsi/client';
  script.async = true;
  script.defer = true;
  document.head.appendChild(script);
  window._googleClientId = clientId;
  document.getElementById('google-btn').style.display = 'block';
}

document.getElementById('google-btn').addEventListener('click', () => {
  if (!window.google || !window._googleClientId) {
    showToast('Google SSO not available', true);
    return;
  }
  google.accounts.id.initialize({
    client_id: window._googleClientId,
    callback: async ({ credential }) => {
      try {
        const data = await apiFetch('/api/auth/google', {
          method: 'POST',
          body: JSON.stringify({ credential })
        });
        authToken = data.token;
        sessionStorage.setItem('nms_token', authToken);
        closeLogin();
        showToast('Logged in via Google as ' + data.username);
        document.getElementById('admin-link').style.display = 'inline-block';
      } catch (err) {
        document.getElementById('login-error').textContent = err.message;
      }
    }
  });
  google.accounts.id.prompt();
});

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

function showToast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show' + (isError ? ' error' : '');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = ''; }, 3000);
}

init();
