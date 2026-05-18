'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const app = express();
const PORT = process.env.PORT || 3005;
const JWT_SECRET = process.env.JWT_SECRET || 'nms-dev-secret-change-in-production';
const DATA_FILE = path.join(__dirname, 'data.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

function readData() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}

function writeData(data) {
  const tmp = DATA_FILE + '.tmp';
  const content = JSON.stringify(data, null, 2);
  fs.writeFileSync(tmp, content, 'utf-8');
  try {
    fs.renameSync(tmp, DATA_FILE);
  } catch {
    fs.writeFileSync(DATA_FILE, content, 'utf-8');
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function sanitizeUrl(url) {
  if (!url) return '';
  const t = url.trim();
  if (t === '' || t === '#') return t;
  return (t.startsWith('http://') || t.startsWith('https://')) ? t : '';
}

// ---------------------------------------------------------------------------
// Seed guard
// ---------------------------------------------------------------------------

function isValidData(d) {
  return d && Array.isArray(d.pages) && Array.isArray(d.users);
}

let _existing = null;
if (fs.existsSync(DATA_FILE)) {
  try { _existing = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')); } catch { /* invalid JSON */ }
}
if (!isValidData(_existing)) {
  console.log('data.json not found or invalid — please ensure data.json exists.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

function authMiddleware(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

app.get('/api/pages', (req, res) => {
  const data = readData();
  const pages = data.pages
    .sort((a, b) => a.order - b.order)
    .map(page => ({
      id: page.id,
      title: page.title,
      slug: page.slug,
      order: page.order,
      isDefault: !!page.isDefault,
      maintenancePopup: !!page.maintenancePopup,
      sections: (page.sections || [])
        .sort((a, b) => a.order - b.order)
        .map(section => ({
          id: section.id,
          title: section.title || '',
          columnHeaders: section.columnHeaders || [],
          order: section.order,
          rows: (section.rows || []).map(row => ({
            id: row.id,
            cells: (row.cells || []).map(cell => ({
              label: cell.label || '',
              url: sanitizeUrl(cell.url)
            }))
          }))
        }))
    }));
  res.json(pages);
});

app.get('/api/config', (req, res) => {
  res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || '' });
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  const data = readData();
  const user = data.users.find(u => u.username === username);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '8h' }
  );
  res.json({ token, username: user.username, role: user.role });
});

app.post('/api/auth/google', async (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(503).json({ error: 'Google SSO is not configured on this server' });
  }
  const { credential } = req.body || {};
  if (!credential) return res.status(400).json({ error: 'No credential provided' });

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    const payload = ticket.getPayload();
    const email = payload.email;

    if (!payload.email_verified) {
      return res.status(401).json({ error: 'Google account email is not verified' });
    }
    if (!email.toLowerCase().endsWith('@tymeglobal.com')) {
      return res.status(403).json({ error: 'Only @tymeglobal.com accounts are permitted' });
    }

    const data = readData();
    let user = data.users.find(u => u.email && u.email.toLowerCase() === email.toLowerCase());

    if (!user) {
      user = {
        id: generateId(),
        username: email.split('@')[0],
        email: email.toLowerCase(),
        passwordHash: '',
        role: 'admin'
      };
      data.users.push(user);
      writeData(data);
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.json({ token, username: user.username, role: user.role });
  } catch {
    res.status(401).json({ error: 'Invalid Google token' });
  }
});

// ---------------------------------------------------------------------------
// Admin — Pages
// ---------------------------------------------------------------------------

app.get('/api/admin/pages', authMiddleware, (req, res) => {
  const data = readData();
  res.json(data.pages.sort((a, b) => a.order - b.order));
});

app.post('/api/admin/pages', authMiddleware, (req, res) => {
  const { title, slug, order, isDefault, maintenancePopup } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required' });
  const data = readData();
  const maxOrder = data.pages.reduce((m, p) => Math.max(m, p.order || 0), 0);
  const page = {
    id: generateId(),
    title: title.trim(),
    slug: (slug || title).trim().toLowerCase().replace(/\s+/g, '-'),
    order: parseInt(order) || maxOrder + 1,
    isDefault: !!isDefault,
    maintenancePopup: !!maintenancePopup,
    sections: []
  };
  data.pages.push(page);
  writeData(data);
  res.status(201).json(page);
});

app.put('/api/admin/pages/:id', authMiddleware, (req, res) => {
  const data = readData();
  const page = data.pages.find(p => p.id === req.params.id);
  if (!page) return res.status(404).json({ error: 'Page not found' });
  const { title, slug, order, isDefault, maintenancePopup } = req.body || {};
  if (title !== undefined) page.title = title.trim();
  if (slug !== undefined) page.slug = slug.trim();
  if (order !== undefined) page.order = parseInt(order);
  if (isDefault !== undefined) page.isDefault = !!isDefault;
  if (maintenancePopup !== undefined) page.maintenancePopup = !!maintenancePopup;
  writeData(data);
  res.json(page);
});

app.delete('/api/admin/pages/:id', authMiddleware, (req, res) => {
  const data = readData();
  const idx = data.pages.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Page not found' });
  data.pages.splice(idx, 1);
  writeData(data);
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// Admin — Sections
// ---------------------------------------------------------------------------

app.post('/api/admin/pages/:pageId/sections', authMiddleware, (req, res) => {
  const { title, columnHeaders, order } = req.body || {};
  const data = readData();
  const page = data.pages.find(p => p.id === req.params.pageId);
  if (!page) return res.status(404).json({ error: 'Page not found' });
  const maxOrder = (page.sections || []).reduce((m, s) => Math.max(m, s.order || 0), 0);
  const section = {
    id: generateId(),
    title: title || '',
    columnHeaders: Array.isArray(columnHeaders) ? columnHeaders : [],
    order: parseInt(order) || maxOrder + 1,
    rows: []
  };
  page.sections = page.sections || [];
  page.sections.push(section);
  writeData(data);
  res.status(201).json(section);
});

app.put('/api/admin/pages/:pageId/sections/:sectionId', authMiddleware, (req, res) => {
  const data = readData();
  const page = data.pages.find(p => p.id === req.params.pageId);
  if (!page) return res.status(404).json({ error: 'Page not found' });
  const section = (page.sections || []).find(s => s.id === req.params.sectionId);
  if (!section) return res.status(404).json({ error: 'Section not found' });
  const { title, columnHeaders, order } = req.body || {};
  if (title !== undefined) section.title = title;
  if (columnHeaders !== undefined) section.columnHeaders = Array.isArray(columnHeaders) ? columnHeaders : [];
  if (order !== undefined) section.order = parseInt(order);
  writeData(data);
  res.json(section);
});

app.delete('/api/admin/pages/:pageId/sections/:sectionId', authMiddleware, (req, res) => {
  const data = readData();
  const page = data.pages.find(p => p.id === req.params.pageId);
  if (!page) return res.status(404).json({ error: 'Page not found' });
  const idx = (page.sections || []).findIndex(s => s.id === req.params.sectionId);
  if (idx === -1) return res.status(404).json({ error: 'Section not found' });
  page.sections.splice(idx, 1);
  writeData(data);
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// Admin — Rows
// ---------------------------------------------------------------------------

app.post('/api/admin/pages/:pageId/sections/:sectionId/rows', authMiddleware, (req, res) => {
  const { cells } = req.body || {};
  const data = readData();
  const page = data.pages.find(p => p.id === req.params.pageId);
  if (!page) return res.status(404).json({ error: 'Page not found' });
  const section = (page.sections || []).find(s => s.id === req.params.sectionId);
  if (!section) return res.status(404).json({ error: 'Section not found' });
  const row = {
    id: generateId(),
    cells: Array.isArray(cells) ? cells.map(c => ({ label: c.label || '', url: c.url || '' })) : []
  };
  section.rows = section.rows || [];
  section.rows.push(row);
  writeData(data);
  res.status(201).json(row);
});

app.put('/api/admin/pages/:pageId/sections/:sectionId/rows/:rowId', authMiddleware, (req, res) => {
  const data = readData();
  const page = data.pages.find(p => p.id === req.params.pageId);
  if (!page) return res.status(404).json({ error: 'Page not found' });
  const section = (page.sections || []).find(s => s.id === req.params.sectionId);
  if (!section) return res.status(404).json({ error: 'Section not found' });
  const row = (section.rows || []).find(r => r.id === req.params.rowId);
  if (!row) return res.status(404).json({ error: 'Row not found' });
  const { cells } = req.body || {};
  if (cells !== undefined) {
    row.cells = Array.isArray(cells) ? cells.map(c => ({ label: c.label || '', url: c.url || '' })) : [];
  }
  writeData(data);
  res.json(row);
});

app.delete('/api/admin/pages/:pageId/sections/:sectionId/rows/:rowId', authMiddleware, (req, res) => {
  const data = readData();
  const page = data.pages.find(p => p.id === req.params.pageId);
  if (!page) return res.status(404).json({ error: 'Page not found' });
  const section = (page.sections || []).find(s => s.id === req.params.sectionId);
  if (!section) return res.status(404).json({ error: 'Section not found' });
  const idx = (section.rows || []).findIndex(r => r.id === req.params.rowId);
  if (idx === -1) return res.status(404).json({ error: 'Row not found' });
  section.rows.splice(idx, 1);
  writeData(data);
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// Admin — Row reordering
// ---------------------------------------------------------------------------

app.put('/api/admin/pages/:pageId/sections/:sectionId/rows/reorder', authMiddleware, (req, res) => {
  const { orderedIds } = req.body || {};
  if (!Array.isArray(orderedIds)) return res.status(400).json({ error: 'orderedIds array required' });
  const data = readData();
  const page = data.pages.find(p => p.id === req.params.pageId);
  if (!page) return res.status(404).json({ error: 'Page not found' });
  const section = (page.sections || []).find(s => s.id === req.params.sectionId);
  if (!section) return res.status(404).json({ error: 'Section not found' });
  const rowMap = Object.fromEntries((section.rows || []).map(r => [r.id, r]));
  section.rows = orderedIds.filter(id => rowMap[id]).map(id => rowMap[id]);
  writeData(data);
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// Admin — Users
// ---------------------------------------------------------------------------

app.get('/api/admin/users', authMiddleware, (req, res) => {
  const data = readData();
  res.json(data.users.map(u => ({ id: u.id, username: u.username, email: u.email || '', role: u.role })));
});

app.post('/api/admin/users', authMiddleware, (req, res) => {
  const { username, password, role, email } = req.body || {};
  if (!username || !username.trim()) return res.status(400).json({ error: 'Username is required' });
  const data = readData();
  if (data.users.find(u => u.username === username.trim())) {
    return res.status(409).json({ error: 'Username already exists' });
  }
  const user = {
    id: generateId(),
    username: username.trim(),
    email: email ? email.trim().toLowerCase() : '',
    passwordHash: password ? bcrypt.hashSync(password, 10) : '',
    role: role === 'admin' ? 'admin' : 'viewer'
  };
  data.users.push(user);
  writeData(data);
  res.status(201).json({ id: user.id, username: user.username, email: user.email, role: user.role });
});

app.put('/api/admin/users/:id', authMiddleware, (req, res) => {
  const data = readData();
  const user = data.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { username, password, role, email } = req.body || {};
  if (username && username.trim()) {
    const dup = data.users.find(u => u.username === username.trim() && u.id !== req.params.id);
    if (dup) return res.status(409).json({ error: 'Username already taken' });
    user.username = username.trim();
  }
  if (email !== undefined) user.email = email.trim().toLowerCase();
  if (password) user.passwordHash = bcrypt.hashSync(password, 10);
  if (role) user.role = role === 'admin' ? 'admin' : 'viewer';
  writeData(data);
  res.json({ id: user.id, username: user.username, email: user.email || '', role: user.role });
});

app.delete('/api/admin/users/:id', authMiddleware, (req, res) => {
  if (req.user.id === req.params.id) {
    return res.status(400).json({ error: 'You cannot delete your own account' });
  }
  const data = readData();
  const idx = data.users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  data.users.splice(idx, 1);
  writeData(data);
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`\nNMS server running at http://localhost:${PORT}`);
  console.log(`Admin panel:  http://localhost:${PORT}/admin.html`);
  console.log(`Default login: admin / NMS2024!`);
  console.log(`Port: ${PORT}\n`);
});
