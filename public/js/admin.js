'use strict';

let authToken = sessionStorage.getItem('nms_token') || null;
let currentUser = null;
let pages = [];
let currentSection = 'pages';
let currentPageId = null;

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function api(url, opts = {}) {
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
// Auth
// ---------------------------------------------------------------------------

async function tryAutoLogin() {
  if (!authToken) return false;
  try {
    await api('/api/admin/pages');
    return true;
  } catch {
    authToken = null;
    sessionStorage.removeItem('nms_token');
    return false;
  }
}

document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const username = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    authToken = data.token;
    sessionStorage.setItem('nms_token', authToken);
    currentUser = data;
    showAdmin();
  } catch (err) {
    errEl.textContent = err.message;
  }
});

function logout() {
  authToken = null;
  sessionStorage.removeItem('nms_token');
  location.reload();
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function init() {
  const loggedIn = await tryAutoLogin();
  if (loggedIn) {
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: '__token_check__', password: '__' })
      }).catch(() => null);
    } catch { /* ignore */ }
    showAdmin();
  } else {
    showLogin();
  }

  try {
    const cfg = await api('/api/config');
    if (cfg.googleClientId) setupGoogle(cfg.googleClientId);
  } catch { /* no SSO */ }
}

function showLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('admin-app').style.display = 'none';
}

async function showAdmin() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('admin-app').style.display = 'flex';
  await loadPages();
  renderSidebar();
  if (pages.length > 0) selectPage(pages[0].id);
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

async function loadPages() {
  pages = await api('/api/admin/pages');
  pages.sort((a, b) => a.order - b.order);
}

function renderSidebar() {
  const list = document.getElementById('page-list');
  list.innerHTML = '';
  pages.forEach(p => {
    const item = document.createElement('div');
    item.className = 'page-item' + (p.id === currentPageId ? ' active' : '');
    item.textContent = p.title;
    item.dataset.id = p.id;
    item.onclick = () => selectPage(p.id);
    list.appendChild(item);
  });
}

function selectPage(pageId) {
  currentPageId = pageId;
  currentSection = 'pages';
  document.querySelectorAll('.page-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === pageId);
  });
  document.querySelectorAll('.users-item').forEach(el => el.classList.remove('active'));
  renderPageEditor();
}

function selectUsers() {
  currentSection = 'users';
  currentPageId = null;
  document.querySelectorAll('.page-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.users-item').forEach(el => el.classList.add('active'));
  renderUsersPanel();
}

// ---------------------------------------------------------------------------
// Page editor
// ---------------------------------------------------------------------------

function renderPageEditor() {
  const page = pages.find(p => p.id === currentPageId);
  if (!page) return;
  const main = document.getElementById('admin-main');
  main.innerHTML = `
    <div class="panel-title">${escHtml(page.title)}</div>
    <div class="card">
      <div class="card-header"><h3>Page settings</h3></div>
      <div class="card-body">
        <div class="form-row">
          <div class="form-group">
            <label>Title</label>
            <input type="text" id="ep-title" value="${escHtml(page.title)}" />
          </div>
          <div class="form-group">
            <label>Order</label>
            <input type="text" id="ep-order" value="${page.order}" style="width:80px" />
          </div>
        </div>
        <div class="form-row">
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;text-transform:none;letter-spacing:0;">
            <input type="checkbox" id="ep-default" ${page.isDefault ? 'checked' : ''} /> Default page
          </label>
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;text-transform:none;letter-spacing:0;">
            <input type="checkbox" id="ep-popup" ${page.maintenancePopup ? 'checked' : ''} /> Opens in popup window
          </label>
        </div>
        <div style="display:flex;gap:10px;margin-top:8px;">
          <button class="btn btn-primary" onclick="savePageSettings()">Save settings</button>
          <button class="btn btn-danger btn-sm" onclick="deletePage('${page.id}')">Delete page</button>
        </div>
      </div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
      <div class="panel-title" style="font-size:15px;margin-bottom:0;">Sections</div>
      <button class="btn btn-primary btn-sm" onclick="addSection()">+ Add section</button>
    </div>
    <div id="sections-list"></div>
  `;
  renderSections(page);
}

function renderSections(page) {
  const container = document.getElementById('sections-list');
  if (!container) return;
  container.innerHTML = '';
  if (!page.sections || page.sections.length === 0) {
    container.innerHTML = '<p class="no-items">No sections yet. Add one above.</p>';
    return;
  }
  const sorted = [...page.sections].sort((a, b) => a.order - b.order);
  sorted.forEach(section => {
    const acc = document.createElement('div');
    acc.className = 'section-accordion';
    acc.id = 'section-' + section.id;

    const headerTitle = section.columnHeaders.filter(h => h).join(' | ') || '(Untitled section)';
    acc.innerHTML = `
      <div class="sa-header" onclick="toggleSection('${section.id}')">
        <h4>${escHtml(headerTitle)}</h4>
        <span class="badge badge-teal">${section.rows.length} rows</span>
        <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();deleteSection('${page.id}','${section.id}')">Delete</button>
        <span class="sa-toggle">▼</span>
      </div>
      <div class="sa-body">
        <div class="form-group">
          <label>Column headers (one per line)</label>
          <textarea id="sh-${section.id}" rows="3" style="width:100%;font-size:12px;">${escHtml(section.columnHeaders.join('\n'))}</textarea>
        </div>
        <div class="form-group">
          <label>Section title (optional label shown above headers)</label>
          <input type="text" id="st-${section.id}" value="${escHtml(section.title || '')}" />
        </div>
        <div style="display:flex;gap:8px;margin-bottom:14px;">
          <button class="btn btn-primary btn-sm" onclick="saveSection('${page.id}','${section.id}')">Save section</button>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <strong style="font-size:12px;color:#555;">Rows</strong>
          <button class="btn btn-outline btn-sm" onclick="addRow('${page.id}','${section.id}',${section.columnHeaders.length})">+ Add row</button>
        </div>
        <div id="rows-${section.id}"></div>
      </div>
    `;
    container.appendChild(acc);
    renderRows(section, page.id);
  });
}

function toggleSection(sectionId) {
  const el = document.getElementById('section-' + sectionId);
  if (el) el.classList.toggle('open');
}

function renderRows(section, pageId) {
  const container = document.getElementById('rows-' + section.id);
  if (!container) return;
  container.innerHTML = '';
  if (section.rows.length === 0) {
    container.innerHTML = '<p class="no-items">No rows yet.</p>';
    return;
  }
  const colCount = section.columnHeaders.length;
  section.rows.forEach((row, ri) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'row-item';
    rowEl.id = 'row-' + row.id;

    let cellsHtml = '<div class="cell-inputs">';
    for (let i = 0; i < colCount; i++) {
      const cell = row.cells[i] || { label: '', url: '' };
      const colName = section.columnHeaders[i] || `Col ${i + 1}`;
      cellsHtml += `
        <div class="cell-pair">
          <label>${escHtml(colName)} — Label</label>
          <input type="text" id="cl-${row.id}-${i}" value="${escHtml(cell.label)}" placeholder="Label" />
          <label>${escHtml(colName)} — URL</label>
          <input type="text" id="cu-${row.id}-${i}" value="${escHtml(cell.url)}" placeholder="http://..." />
        </div>`;
    }
    cellsHtml += '</div>';

    rowEl.innerHTML = `
      ${cellsHtml}
      <div style="display:flex;flex-direction:column;gap:4px;">
        <button class="btn btn-primary btn-sm" onclick="saveRow('${pageId}','${section.id}','${row.id}',${colCount})">Save</button>
        <button class="btn btn-danger btn-sm" onclick="deleteRow('${pageId}','${section.id}','${row.id}')">Del</button>
      </div>`;
    container.appendChild(rowEl);
  });
}

// ---------------------------------------------------------------------------
// CRUD — Pages
// ---------------------------------------------------------------------------

async function savePageSettings() {
  const page = pages.find(p => p.id === currentPageId);
  if (!page) return;
  const title = document.getElementById('ep-title').value.trim();
  const order = parseInt(document.getElementById('ep-order').value) || page.order;
  const isDefault = document.getElementById('ep-default').checked;
  const maintenancePopup = document.getElementById('ep-popup').checked;
  try {
    await api('/api/admin/pages/' + page.id, {
      method: 'PUT',
      body: JSON.stringify({ title, order, isDefault, maintenancePopup })
    });
    await loadPages();
    renderSidebar();
    toast('Page settings saved');
  } catch (e) { toast(e.message, true); }
}

async function deletePage(pageId) {
  if (!confirm('Delete this page and all its sections/rows?')) return;
  try {
    await api('/api/admin/pages/' + pageId, { method: 'DELETE' });
    await loadPages();
    currentPageId = pages.length > 0 ? pages[0].id : null;
    renderSidebar();
    if (currentPageId) selectPage(currentPageId);
    else document.getElementById('admin-main').innerHTML = '<p class="no-items">No pages.</p>';
    toast('Page deleted');
  } catch (e) { toast(e.message, true); }
}

async function addPage() {
  openModal('Add page', `
    <div class="form-group"><label>Title</label><input type="text" id="mp-title" /></div>
    <div class="form-group"><label>Order</label><input type="text" id="mp-order" value="${pages.length + 1}" /></div>
    <label style="display:flex;align-items:center;gap:6px;font-size:13px;margin-bottom:8px;"><input type="checkbox" id="mp-popup" /> Opens in popup window</label>
  `, async () => {
    const title = document.getElementById('mp-title').value.trim();
    if (!title) { toast('Title required', true); return; }
    const order = parseInt(document.getElementById('mp-order').value) || pages.length + 1;
    const maintenancePopup = document.getElementById('mp-popup').checked;
    try {
      const page = await api('/api/admin/pages', {
        method: 'POST',
        body: JSON.stringify({ title, order, maintenancePopup })
      });
      await loadPages();
      renderSidebar();
      selectPage(page.id);
      closeModal();
      toast('Page created');
    } catch (e) { toast(e.message, true); }
  });
}

// ---------------------------------------------------------------------------
// CRUD — Sections
// ---------------------------------------------------------------------------

async function addSection() {
  if (!currentPageId) return;
  const page = pages.find(p => p.id === currentPageId);
  const maxOrder = (page.sections || []).reduce((m, s) => Math.max(m, s.order || 0), 0);
  openModal('Add section', `
    <div class="form-group"><label>Column headers (one per line)</label><textarea id="ms-headers" rows="3" placeholder="Column 1\nColumn 2"></textarea></div>
    <div class="form-group"><label>Optional section title</label><input type="text" id="ms-title" /></div>
  `, async () => {
    const raw = document.getElementById('ms-headers').value;
    const columnHeaders = raw.split('\n').map(h => h.trim());
    const title = document.getElementById('ms-title').value.trim();
    try {
      await api(`/api/admin/pages/${currentPageId}/sections`, {
        method: 'POST',
        body: JSON.stringify({ columnHeaders, title, order: maxOrder + 1 })
      });
      await loadPages();
      closeModal();
      selectPage(currentPageId);
      toast('Section added');
    } catch (e) { toast(e.message, true); }
  });
}

async function saveSection(pageId, sectionId) {
  const raw = document.getElementById('sh-' + sectionId).value;
  const columnHeaders = raw.split('\n').map(h => h.trim());
  const title = document.getElementById('st-' + sectionId).value.trim();
  try {
    await api(`/api/admin/pages/${pageId}/sections/${sectionId}`, {
      method: 'PUT',
      body: JSON.stringify({ columnHeaders, title })
    });
    await loadPages();
    selectPage(pageId);
    toast('Section saved');
  } catch (e) { toast(e.message, true); }
}

async function deleteSection(pageId, sectionId) {
  if (!confirm('Delete this section and all its rows?')) return;
  try {
    await api(`/api/admin/pages/${pageId}/sections/${sectionId}`, { method: 'DELETE' });
    await loadPages();
    selectPage(pageId);
    toast('Section deleted');
  } catch (e) { toast(e.message, true); }
}

// ---------------------------------------------------------------------------
// CRUD — Rows
// ---------------------------------------------------------------------------

async function addRow(pageId, sectionId, colCount) {
  const cells = Array.from({ length: colCount }, () => ({ label: '', url: '' }));
  try {
    await api(`/api/admin/pages/${pageId}/sections/${sectionId}/rows`, {
      method: 'POST',
      body: JSON.stringify({ cells })
    });
    await loadPages();
    selectPage(pageId);
    // Re-open the section accordion
    setTimeout(() => {
      const el = document.getElementById('section-' + sectionId);
      if (el) el.classList.add('open');
    }, 50);
    toast('Row added');
  } catch (e) { toast(e.message, true); }
}

async function saveRow(pageId, sectionId, rowId, colCount) {
  const cells = [];
  for (let i = 0; i < colCount; i++) {
    const label = (document.getElementById(`cl-${rowId}-${i}`) || {}).value || '';
    const url = (document.getElementById(`cu-${rowId}-${i}`) || {}).value || '';
    cells.push({ label, url });
  }
  try {
    await api(`/api/admin/pages/${pageId}/sections/${sectionId}/rows/${rowId}`, {
      method: 'PUT',
      body: JSON.stringify({ cells })
    });
    await loadPages();
    selectPage(pageId);
    setTimeout(() => {
      const el = document.getElementById('section-' + sectionId);
      if (el) el.classList.add('open');
    }, 50);
    toast('Row saved');
  } catch (e) { toast(e.message, true); }
}

async function deleteRow(pageId, sectionId, rowId) {
  if (!confirm('Delete this row?')) return;
  try {
    await api(`/api/admin/pages/${pageId}/sections/${sectionId}/rows/${rowId}`, { method: 'DELETE' });
    await loadPages();
    selectPage(pageId);
    setTimeout(() => {
      const el = document.getElementById('section-' + sectionId);
      if (el) el.classList.add('open');
    }, 50);
    toast('Row deleted');
  } catch (e) { toast(e.message, true); }
}

// ---------------------------------------------------------------------------
// Users panel
// ---------------------------------------------------------------------------

async function renderUsersPanel() {
  const main = document.getElementById('admin-main');
  main.innerHTML = '<div class="panel-title">Users</div><div id="users-content"><p class="no-items">Loading...</p></div>';
  try {
    const users = await api('/api/admin/users');
    const el = document.getElementById('users-content');
    el.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>All users</h3>
          <button class="btn btn-primary btn-sm" onclick="addUser()">+ Add user</button>
        </div>
        <div class="card-body" style="padding:0">
          <table class="data-table">
            <thead><tr><th>Username</th><th>Email</th><th>Role</th><th>Actions</th></tr></thead>
            <tbody>
              ${users.map(u => `
                <tr>
                  <td><strong>${escHtml(u.username)}</strong></td>
                  <td>${escHtml(u.email || '—')}</td>
                  <td><span class="badge ${u.role === 'admin' ? 'badge-orange' : 'badge-teal'}">${u.role}</span></td>
                  <td class="actions">
                    <button class="btn btn-outline btn-sm" onclick="editUser('${u.id}','${escHtml(u.username)}','${escHtml(u.email||'')}','${u.role}')">Edit</button>
                    <button class="btn btn-danger btn-sm" onclick="deleteUser('${u.id}')">Delete</button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  } catch (e) { toast(e.message, true); }
}

async function addUser() {
  openModal('Add user', `
    <div class="form-group"><label>Username</label><input type="text" id="mu-username" /></div>
    <div class="form-group"><label>Email (for Google SSO)</label><input type="email" id="mu-email" /></div>
    <div class="form-group"><label>Password</label><input type="password" id="mu-password" /></div>
    <div class="form-group"><label>Role</label><select id="mu-role"><option value="admin">admin</option><option value="viewer">viewer</option></select></div>
  `, async () => {
    const username = document.getElementById('mu-username').value.trim();
    const email = document.getElementById('mu-email').value.trim();
    const password = document.getElementById('mu-password').value;
    const role = document.getElementById('mu-role').value;
    try {
      await api('/api/admin/users', { method: 'POST', body: JSON.stringify({ username, email, password, role }) });
      closeModal();
      renderUsersPanel();
      toast('User created');
    } catch (e) { toast(e.message, true); }
  });
}

async function editUser(id, username, email, role) {
  openModal('Edit user', `
    <div class="form-group"><label>Username</label><input type="text" id="eu-username" value="${escHtml(username)}" /></div>
    <div class="form-group"><label>Email</label><input type="email" id="eu-email" value="${escHtml(email)}" /></div>
    <div class="form-group"><label>New password (leave blank to keep)</label><input type="password" id="eu-password" /></div>
    <div class="form-group"><label>Role</label><select id="eu-role"><option value="admin" ${role==='admin'?'selected':''}>admin</option><option value="viewer" ${role!=='admin'?'selected':''}>viewer</option></select></div>
  `, async () => {
    const data = {
      username: document.getElementById('eu-username').value.trim(),
      email: document.getElementById('eu-email').value.trim(),
      role: document.getElementById('eu-role').value
    };
    const pw = document.getElementById('eu-password').value;
    if (pw) data.password = pw;
    try {
      await api('/api/admin/users/' + id, { method: 'PUT', body: JSON.stringify(data) });
      closeModal();
      renderUsersPanel();
      toast('User updated');
    } catch (e) { toast(e.message, true); }
  });
}

async function deleteUser(id) {
  if (!confirm('Delete this user?')) return;
  try {
    await api('/api/admin/users/' + id, { method: 'DELETE' });
    renderUsersPanel();
    toast('User deleted');
  } catch (e) { toast(e.message, true); }
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

let _modalCallback = null;

function openModal(title, bodyHtml, onConfirm) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  _modalCallback = onConfirm;
  document.getElementById('modal-overlay').classList.add('open');
  const firstInput = document.querySelector('#modal-body input, #modal-body textarea');
  if (firstInput) setTimeout(() => firstInput.focus(), 50);
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  _modalCallback = null;
}

document.getElementById('modal-confirm').addEventListener('click', () => {
  if (_modalCallback) _modalCallback();
});

document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});

// ---------------------------------------------------------------------------
// Google SSO
// ---------------------------------------------------------------------------

function setupGoogle(clientId) {
  const script = document.createElement('script');
  script.src = 'https://accounts.google.com/gsi/client';
  script.async = true; script.defer = true;
  document.head.appendChild(script);
  window._googleClientId = clientId;
  document.getElementById('google-login-btn').style.display = 'block';
}

document.getElementById('google-login-btn').addEventListener('click', () => {
  if (!window.google || !window._googleClientId) { toast('Google SSO not configured', true); return; }
  google.accounts.id.initialize({
    client_id: window._googleClientId,
    callback: async ({ credential }) => {
      try {
        const data = await api('/api/auth/google', { method: 'POST', body: JSON.stringify({ credential }) });
        authToken = data.token;
        sessionStorage.setItem('nms_token', authToken);
        currentUser = data;
        showAdmin();
      } catch (err) {
        document.getElementById('login-error').textContent = err.message;
      }
    }
  });
  google.accounts.id.prompt();
});

// ---------------------------------------------------------------------------
// Toast / utils
// ---------------------------------------------------------------------------

function toast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show' + (isError ? ' error' : '');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = ''; }, 3000);
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

init();
