// Finga Lickin Gud — standalone restaurant web app.
// Node.js + Express, SQLite (node:sqlite, file-based), static frontend.
// No external services, no email. Admin login is PBKDF2 (Node crypto),
// 30-day signed-cookie sessions. No admin login is seeded — the owner
// creates it through the first-run setup flow in the Kitchen Board.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const { db, DATA_DIR, getSetting, setSetting, serverSecret } = require('./db');

const PORT = parseInt(process.env.PORT || '3000', 10);
const SESSION_SECRET = process.env.SESSION_SECRET || serverSecret;
const COOKIE_NAME = 'flg_admin';
const SESSION_DAYS = 30;

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

// ---------------------------------------------------------------- helpers
function money(cents) { return (cents / 100).toFixed(2); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// PBKDF2 password hashing (Node built-in crypto, no bcrypt needed).
function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 210000, 64, 'sha512').toString('hex');
}
function makeHash(password) {
  const salt = crypto.randomBytes(32).toString('hex');
  return { salt, hash: hashPassword(password, salt) };
}
function checkPassword(password, salt, hash) {
  const attempt = crypto.pbkdf2Sync(password, salt, 210000, 64, 'sha512');
  const expected = Buffer.from(hash, 'hex');
  return attempt.length === expected.length && crypto.timingSafeEqual(attempt, expected);
}

// Signed session token: base64url(payload).base64url(hmac).
// Payload: { v: token_version, exp: unix seconds }. 30 days.
function signToken(tokenVersion) {
  const payload = Buffer.from(JSON.stringify({
    v: tokenVersion,
    exp: Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
  if (!data || typeof data.exp !== 'number' || data.exp * 1000 < Date.now()) return null;
  const admin = db.prepare('SELECT id, email, token_version FROM admin WHERE id = 1').get();
  if (!admin || admin.token_version !== data.v) return null;
  return admin;
}
function getAdmin(req) {
  const token = req.headers.cookie
    ? (req.headers.cookie.split(';').map((c) => c.trim())
      .find((c) => c.startsWith(COOKIE_NAME + '=')) || '').slice(COOKIE_NAME.length + 1)
    : null;
  if (!token) return null;
  try { return verifyToken(decodeURIComponent(token)); } catch { return null; }
}
function requireAdmin(req, res, next) {
  const admin = getAdmin(req);
  if (!admin) return res.status(401).json({ error: 'Admin login required.' });
  req.admin = admin;
  next();
}
function setAdminCookie(res, tokenVersion) {
  res.cookie(COOKIE_NAME, signToken(tokenVersion), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  });
}
function clearAdminCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

// ---------------------------------------------------------------- menu shaping
const CATEGORY_ORDER = ['jerk', 'fish', 'soup', 'sides', 'drinks', 'sweet'];
function publicItem(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    description: row.description,
    image: `/images/${row.image_key}.jpg`,
    imageKey: row.image_key,
    priceSmall: row.price_small_cents / 100,
    priceLarge: row.price_large_cents / 100,
    priceTbd: row.price_tbd === 1,
    isMeal: row.is_meal === 1,
  };
}
function adminItem(row) {
  return { ...publicItem(row), available: row.available === 1 };
}
function listMenu(onlyAvailable) {
  const rows = onlyAvailable
    ? db.prepare('SELECT * FROM menu_items WHERE available = 1 ORDER BY sort_order ASC').all()
    : db.prepare('SELECT * FROM menu_items ORDER BY sort_order ASC').all();
  return rows.sort((a, b) =>
    CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category)
    || a.sort_order - b.sort_order);
}

// Order stages, by fulfilment type.
const STAGES = {
  delivery: ['Received', 'Preparing', 'On the Way', 'Delivered'],
  pickup: ['Received', 'Preparing', 'Ready for Pickup', 'Picked Up'],
};
function stageLabel(type, stage) {
  const list = STAGES[type] || STAGES.delivery;
  return list[Math.min(Math.max(stage, 0), list.length - 1)];
}
function publicOrder(order, items) {
  return {
    orderNumber: order.order_number,
    type: order.type,
    paymentMethod: order.payment_method,
    customerName: order.customer_name,
    stage: order.stage,
    stageLabel: stageLabel(order.type, order.stage),
    stages: STAGES[order.type] || STAGES.delivery,
    subtotal: order.subtotal_cents / 100,
    deliveryFee: order.delivery_fee_cents / 100,
    total: order.total_cents / 100,
    createdAt: order.created_at,
    items: items.map((i) => ({
      name: i.name, size: i.size, sideChoice: i.side_choice || '',
      qty: i.qty, unitPrice: i.unit_price_cents / 100,
      lineTotal: (i.unit_price_cents * i.qty) / 100,
    })),
    // QR code image only (never the handle/number behind it).
    paymentQr: order.payment_method === 'zelle' ? '/images/zelle-qr.jpg'
      : order.payment_method === 'cashapp' ? '/images/cashapp-qr.jpg' : null,
  };
}

// ---------------------------------------------------------------- public API
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Public menu: available items only. OFF / hidden items never appear.
app.get('/api/menu', (req, res) => {
  res.json({ items: listMenu(true).map(publicItem) });
});

// Place an order. Prices are taken from the database, never from the
// client. Fruit cake (price TBD) cannot be ordered online at all.
const SIDE_CHOICES = ['Festival', 'Bread', 'Salad', 'Fry Plantain'];
app.post('/api/orders', (req, res) => {
  const body = req.body || {};
  const type = body.type === 'pickup' ? 'pickup' : 'delivery';
  const payment = ['zelle', 'cashapp', 'cod'].includes(body.paymentMethod) ? body.paymentMethod : 'zelle';
  const name = String(body.customerName || '').trim().slice(0, 80);
  const phone = String(body.customerPhone || '').trim().slice(0, 30);
  const address = String(body.deliveryAddress || '').trim().slice(0, 200);
  const notes = String(body.notes || '').trim().slice(0, 300);
  const rawItems = Array.isArray(body.items) ? body.items : [];

  if (!name || !phone) return res.status(400).json({ error: 'Please add your name and phone number.' });
  if (type === 'delivery' && !address) return res.status(400).json({ error: 'Please add a delivery address.' });
  if (!rawItems.length || rawItems.length > 20) return res.status(400).json({ error: 'Your order is empty.' });

  const deliveryFeeCents = parseInt(getSetting('delivery_fee_cents', '1500'), 10);
  const freeThresholdCents = parseInt(getSetting('free_threshold_cents', '8000'), 10);

  const lines = [];
  let subtotal = 0;
  for (const raw of rawItems) {
    const id = parseInt(raw.id, 10);
    const qty = Math.min(Math.max(parseInt(raw.qty, 10) || 1, 1), 20);
    const size = raw.size === 'small' ? 'small' : 'large';
    const row = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(id);
    if (!row) return res.status(400).json({ error: 'One of the dishes in your order is no longer on the menu.' });
    if (row.available !== 1) return res.status(400).json({ error: `${row.name} is not available right now.` });
    if (row.price_tbd === 1) {
      return res.status(400).json({
        error: `${row.name} is made to order — please call us on (646) 669-3814 to order yours. It cannot be ordered online.`,
      });
    }
    const unit = size === 'small' ? row.price_small_cents : row.price_large_cents;
    let sideChoice = '';
    if (row.is_meal === 1) {
      sideChoice = SIDE_CHOICES.includes(raw.sideChoice) ? raw.sideChoice : 'Festival';
    }
    lines.push({ menuItemId: row.id, name: row.name, size, sideChoice, qty, unit });
    subtotal += unit * qty;
  }

  // Free delivery strictly over the threshold: exactly $80 still pays.
  const fee = type === 'delivery' && subtotal <= freeThresholdCents ? deliveryFeeCents : 0;
  const total = subtotal + fee;

  // FLG-######, random, unique (retry on the rare clash).
  let orderNumber = '';
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = 'FLG-' + String(Math.floor(100000 + Math.random() * 900000));
    const clash = db.prepare('SELECT id FROM orders WHERE order_number = ?').get(candidate);
    if (!clash) { orderNumber = candidate; break; }
  }
  if (!orderNumber) return res.status(500).json({ error: 'Could not create your order — please try again.' });

  const info = db.prepare(
    `INSERT INTO orders (order_number, customer_name, customer_phone, delivery_address, notes,
       type, payment_method, subtotal_cents, delivery_fee_cents, total_cents, stage)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
  ).run(orderNumber, name, phone, type === 'delivery' ? address : '', notes, type, payment, subtotal, fee, total);
  const orderId = info.lastInsertRowid;
  const insItem = db.prepare(
    'INSERT INTO order_items (order_id, menu_item_id, name, size, side_choice, qty, unit_price_cents) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  for (const l of lines) insItem.run(orderId, l.menuItemId, l.name, l.size, l.sideChoice, l.qty, l.unit);

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
  res.status(201).json({ order: publicOrder(order, items) });
});

// Order tracker / receipt (public). No payment handles, no admin data.
app.get('/api/orders/:number', (req, res) => {
  const number = String(req.params.number || '').trim().toUpperCase();
  const order = db.prepare('SELECT * FROM orders WHERE order_number = ?').get(number);
  if (!order) return res.status(404).json({ error: 'No order with that number. Check it and try again.' });
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  res.json({ order: publicOrder(order, items) });
});

// ---------------------------------------------------------------- admin auth
// Reports ONLY whether a login is set up. Never the email or credential.
app.get('/api/admin/status', (req, res) => {
  const admin = db.prepare('SELECT id FROM admin WHERE id = 1').get();
  const authed = !!getAdmin(req);
  res.json({ setupRequired: !admin, loggedIn: authed });
});

// First-run setup ONLY: refuses once a login already exists, so a
// visitor can never claim or overwrite the owner's login.
app.post('/api/admin/setup', (req, res) => {
  const existing = db.prepare('SELECT id FROM admin WHERE id = 1').get();
  if (existing) return res.status(403).json({ error: 'A Kitchen Board login already exists.' });
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const password = String((req.body || {}).password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  const { salt, hash } = makeHash(password);
  db.prepare('INSERT INTO admin (id, email, salt, hash, token_version) VALUES (1, ?, ?, ?, 1)').run(email, salt, hash);
  setAdminCookie(res, 1);
  res.status(201).json({ ok: true, loggedIn: true });
});

app.post('/api/admin/login', (req, res) => {
  const admin = db.prepare('SELECT * FROM admin WHERE id = 1').get();
  if (!admin) return res.status(400).json({ error: 'No Kitchen Board login is set up yet. Use first-time setup first.' });
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const password = String((req.body || {}).password || '');
  if (email !== admin.email || !checkPassword(password, admin.salt, admin.hash)) {
    return res.status(401).json({ error: 'Wrong email or password.' });
  }
  setAdminCookie(res, admin.token_version);
  res.json({ ok: true, loggedIn: true });
});

app.post('/api/admin/logout', (req, res) => {
  clearAdminCookie(res);
  res.json({ ok: true });
});

// Change password signs out ALL devices (token version bumps).
app.post('/api/admin/change-password', requireAdmin, (req, res) => {
  const current = String((req.body || {}).currentPassword || '');
  const next = String((req.body || {}).newPassword || '');
  const admin = db.prepare('SELECT * FROM admin WHERE id = 1').get();
  if (!checkPassword(current, admin.salt, admin.hash)) {
    return res.status(401).json({ error: 'Your current password is wrong.' });
  }
  if (next.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  const { salt, hash } = makeHash(next);
  db.prepare('UPDATE admin SET salt = ?, hash = ?, token_version = token_version + 1, updated_at = datetime(\'now\') WHERE id = 1')
    .run(salt, hash);
  clearAdminCookie(res);
  res.json({ ok: true, message: 'Password changed. You have been signed out on all devices — please log in again.' });
});

// ---------------------------------------------------------------- admin API
app.get('/api/admin/menu', requireAdmin, (req, res) => {
  res.json({ items: listMenu(false).map(adminItem) });
});

// Toggle availability / edit price (and name/description). One endpoint
// drives both the on/off toggle and the "Mark Sold Out / Back On" bar.
app.patch('/api/admin/menu/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Dish not found.' });
  const body = req.body || {};
  const updates = [];
  const values = [];
  if (typeof body.available === 'boolean') { updates.push('available = ?'); values.push(body.available ? 1 : 0); }
  if (body.priceSmall != null) {
    const v = Math.round(parseFloat(body.priceSmall) * 100);
    if (!isFinite(v) || v < 0) return res.status(400).json({ error: 'Small price must be a number, 0 or more.' });
    updates.push('price_small_cents = ?'); values.push(v);
  }
  if (body.priceLarge != null) {
    const v = Math.round(parseFloat(body.priceLarge) * 100);
    if (!isFinite(v) || v < 0) return res.status(400).json({ error: 'Large price must be a number, 0 or more.' });
    updates.push('price_large_cents = ?'); values.push(v);
  }
  if (typeof body.name === 'string' && body.name.trim()) { updates.push('name = ?'); values.push(body.name.trim().slice(0, 80)); }
  if (typeof body.description === 'string') { updates.push('description = ?'); values.push(body.description.trim().slice(0, 300)); }
  if (typeof body.priceTbd === 'boolean') { updates.push('price_tbd = ?'); values.push(body.priceTbd ? 1 : 0); }
  if (typeof body.isMeal === 'boolean') { updates.push('is_meal = ?'); values.push(body.isMeal ? 1 : 0); }
  if (!updates.length) return res.status(400).json({ error: 'Nothing to update.' });
  values.push(id);
  db.prepare(`UPDATE menu_items SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  res.json({ item: adminItem(db.prepare('SELECT * FROM menu_items WHERE id = ?').get(id)) });
});

// Add a dish: hidden (available = off) until the admin switches it on.
app.post('/api/admin/menu', requireAdmin, (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim().slice(0, 80);
  const category = CATEGORY_ORDER.includes(body.category) ? body.category : 'sides';
  if (!name) return res.status(400).json({ error: 'Give the dish a name.' });
  const small = Math.round(parseFloat(body.priceSmall || 0) * 100);
  const large = Math.round(parseFloat(body.priceLarge || 0) * 100);
  if (!isFinite(small) || !isFinite(large) || small < 0 || large < 0) {
    return res.status(400).json({ error: 'Prices must be numbers, 0 or more.' });
  }
  const maxSort = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM menu_items').get().m;
  const info = db.prepare(
    `INSERT INTO menu_items (name, category, description, image_key, price_small_cents, price_large_cents,
       price_tbd, is_meal, available, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(name, category, String(body.description || '').trim().slice(0, 300),
    String(body.imageKey || '').trim().replace(/[^a-z0-9-]/gi, '').slice(0, 60) || 'soup',
    small, large, body.priceTbd ? 1 : 0, body.isMeal ? 1 : 0, maxSort + 1);
  res.status(201).json({ item: adminItem(db.prepare('SELECT * FROM menu_items WHERE id = ?').get(info.lastInsertRowid)) });
});

// Orders list (newest first) + Next Stage control.
app.get('/api/admin/orders', requireAdmin, (req, res) => {
  const orders = db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 200').all();
  const out = orders.map((o) => {
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id);
    return {
      ...publicOrder(o, items),
      id: o.id,
      customerPhone: o.customer_phone,
      deliveryAddress: o.delivery_address,
      notes: o.notes,
    };
  });
  res.json({ orders: out });
});

app.post('/api/admin/orders/:id/next-stage', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  const maxStage = (STAGES[order.type] || STAGES.delivery).length - 1;
  const next = Math.min(order.stage + 1, maxStage);
  db.prepare('UPDATE orders SET stage = ? WHERE id = ?').run(next, id);
  const fresh = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id);
  res.json({ order: publicOrder(fresh, items) });
});

// Settings. Payment handles live here ONLY — admin eyes only.
app.get('/api/admin/settings', requireAdmin, (req, res) => {
  res.json({
    settings: {
      deliveryFee: parseInt(getSetting('delivery_fee_cents', '1500'), 10) / 100,
      freeThreshold: parseInt(getSetting('free_threshold_cents', '8000'), 10) / 100,
      zelleHandle: getSetting('zelle_handle', ''),
      cashAppHandle: getSetting('cashapp_handle', ''),
    },
  });
});

app.patch('/api/admin/settings', requireAdmin, (req, res) => {
  const body = req.body || {};
  if (body.deliveryFee != null) {
    const v = Math.round(parseFloat(body.deliveryFee) * 100);
    if (!isFinite(v) || v < 0) return res.status(400).json({ error: 'Delivery fee must be a number, 0 or more.' });
    setSetting('delivery_fee_cents', String(v));
  }
  if (body.freeThreshold != null) {
    const v = Math.round(parseFloat(body.freeThreshold) * 100);
    if (!isFinite(v) || v < 0) return res.status(400).json({ error: 'Free-delivery threshold must be a number, 0 or more.' });
    setSetting('free_threshold_cents', String(v));
  }
  if (typeof body.zelleHandle === 'string') setSetting('zelle_handle', body.zelleHandle.trim().slice(0, 60));
  if (typeof body.cashAppHandle === 'string') setSetting('cashapp_handle', body.cashAppHandle.trim().slice(0, 60));
  res.json({ ok: true });
});

// SPA fallback: everything else serves the front page.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[flg] Finga Lickin Gud running on port ${PORT} (data: ${DATA_DIR})`);
});
