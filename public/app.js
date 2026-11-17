// Finga Lickin Gud — storefront logic: menu, cart, checkout, receipt,
// tracker, PWA install, and the Kitchen Board (admin).
'use strict';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const money = (n) => '$' + Number(n).toFixed(2);
const SIDE_CHOICES = ['Festival', 'Bread', 'Salad', 'Fry Plantain'];
const CATS = [
  ['jerk', 'Jerk', 'From the fire — smoky, spicy, straight off the grill.'],
  ['fish', 'Fish', 'Whole fish, cooked the yard way.'],
  ['soup', 'Soup', 'Saturday soup energy, any day.'],
  ['sides', 'Sides', 'The plates that make the meal complete.'],
  ['drinks', 'Drinks', 'Cold, fresh, and gone fast.'],
  ['sweet', 'Fruit Cake', 'Made to order — call us to order yours.'],
];
// Image fallback: brown stew / escovitch photos may not exist yet.
const IMG_FALLBACK = { 'brown-stew-fish': 'steam-fish', escovitch: 'steam-fish' };

let MENU = [];
let cart = JSON.parse(localStorage.getItem('flg_cart') || '[]');
let adminLoggedIn = false;
let adminTab = 'menu';
let deferredPrompt = null;

// ------------------------------------------------------------ menu
async function loadMenu() {
  const root = $('#menuRoot');
  try {
    const res = await fetch('/api/menu');
    const data = await res.json();
    MENU = data.items || [];
  } catch (e) {
    root.innerHTML = '<p style="text-align:center;color:var(--muted)">The menu could not load. Please refresh the page.</p>';
    return;
  }
  if (!MENU.length) {
    root.innerHTML = '<p style="text-align:center;color:var(--muted)">The kitchen is closed today — check back soon.</p>';
    return;
  }
  root.innerHTML = CATS.map(([key, title, sub]) => {
    const items = MENU.filter((m) => m.category === key);
    if (!items.length) return '';
    return `<h3 class="cat-title">${title}</h3><p class="cat-sub">${sub}</p><div class="grid">` +
      items.map(cardHtml).join('') + '</div>';
  }).join('');
  root.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => addToCart(+b.dataset.add)));
  root.querySelectorAll('[data-size]').forEach((b) => b.addEventListener('click', () => {
    const card = b.closest('.card');
    card.querySelectorAll('[data-size]').forEach((x) => x.classList.toggle('on', x === b));
    card.querySelector('.price').textContent = money(+b.dataset.price);
  }));
}

function cardHtml(m) {
  const img = `/images/${m.imageKey}.jpg`;
  const fallback = IMG_FALLBACK[m.imageKey] ? `/images/${IMG_FALLBACK[m.imageKey]}.jpg` : '/images/soup.jpg';
  const price = m.priceTbd ? '' : `<span class="price">${money(m.priceSmall)}</span>`;
  const sizes = m.priceTbd ? '' : `<span class="size-toggle">
      <button type="button" data-size="small" data-price="${m.priceSmall}" class="on">Small ${money(m.priceSmall)}</button>
      <button type="button" data-size="large" data-price="${m.priceLarge}">Large ${money(m.priceLarge)}</button>
    </span>`;
  const action = m.priceTbd
    ? `<a class="btn call-btn" href="tel:+16466693814">Call to Order</a>`
    : `<button class="btn add-btn" type="button" data-add="${m.id}">Add to Order</button>`;
  const meal = m.isMeal
    ? `<div class="meal-note">Comes with White Rice <strong>and</strong> Rice &amp; Peas + one free side.</div>
       <select class="side-pick" data-side="${m.id}" aria-label="Free side choice">
         ${SIDE_CHOICES.map((s) => `<option>${s}</option>`).join('')}
       </select>` : '';
  return `<article class="card">
    <img src="${img}" alt="${m.name}" loading="lazy" onerror="this.onerror=null;this.src='${fallback}'">
    <div class="card-body"><h3>${m.name}</h3><p>${m.description}</p>${meal}
      <div class="price-row">${sizes}${m.priceTbd ? '<span class="tbd">Price on order</span>' : price}${action}</div>
    </div></article>`;
}

// ------------------------------------------------------------ cart
function saveCart() { localStorage.setItem('flg_cart', JSON.stringify(cart)); renderCart(); }
function cartQty() { return cart.reduce((n, l) => n + l.qty, 0); }
function cartSubtotal() {
  return cart.reduce((sum, l) => {
    const m = MENU.find((x) => x.id === l.id);
    if (!m) return sum;
    return sum + (l.size === 'small' ? m.priceSmall : m.priceLarge) * l.qty;
  }, 0);
}
function addToCart(id) {
  const m = MENU.find((x) => x.id === id);
  if (!m || m.priceTbd) return;
  const card = document.querySelector(`[data-add="${id}"]`).closest('.card');
  const sizeBtn = card.querySelector('[data-size].on');
  const size = sizeBtn ? sizeBtn.dataset.size : 'small';
  const sideSel = card.querySelector('[data-side]');
  const sideChoice = sideSel ? sideSel.value : '';
  const key = `${id}|${size}|${sideChoice}`;
  const line = cart.find((l) => l.key === key);
  if (line) line.qty = Math.min(line.qty + 1, 20); else cart.push({ key, id, size, sideChoice, qty: 1 });
  saveCart();
  openDrawer();
}
function renderCart() {
  $('#cartCount').textContent = cartQty();
  const body = $('#cartBody');
  if (!cart.length) {
    body.innerHTML = '<p style="color:var(--muted)">Your order is empty. Add something tasty from the menu.</p>';
    $('#cartTotals').innerHTML = '';
    $('#checkoutBtn').disabled = true;
    return;
  }
  $('#checkoutBtn').disabled = false;
  body.innerHTML = cart.map((l) => {
    const m = MENU.find((x) => x.id === l.id);
    if (!m) return '';
    const unit = l.size === 'small' ? m.priceSmall : m.priceLarge;
    return `<div class="cart-line"><div class="nm"><b>${m.name}</b>
      <span>${l.size === 'small' ? 'Small' : 'Large'}${l.sideChoice ? ' · Side: ' + l.sideChoice : ''} · ${money(unit)} each</span></div>
      <div class="qty-btns"><button type="button" data-dec="${l.key}" aria-label="Less">−</button><b>${l.qty}</b>
      <button type="button" data-inc="${l.key}" aria-label="More">+</button></div>
      <b>${money(unit * l.qty)}</b></div>`;
  }).join('');
  body.querySelectorAll('[data-inc]').forEach((b) => b.addEventListener('click', () => {
    const l = cart.find((x) => x.key === b.dataset.inc); if (l) l.qty = Math.min(l.qty + 1, 20); saveCart();
  }));
  body.querySelectorAll('[data-dec]').forEach((b) => b.addEventListener('click', () => {
    const l = cart.find((x) => x.key === b.dataset.dec); if (!l) return;
    l.qty -= 1; if (l.qty <= 0) cart = cart.filter((x) => x !== l); saveCart();
  }));
  renderTotals($('#cartTotals'), 'delivery');
}
function renderTotals(el, type) {
  const sub = cartSubtotal();
  const fee = type === 'delivery' ? (sub > 80 ? 0 : 15) : 0;
  el.innerHTML = `<div><span>Subtotal</span><span>${money(sub)}</span></div>
    <div><span>Delivery${type === 'delivery' && sub > 80 ? ' (free over $80)' : ''}</span><span>${fee ? money(fee) : 'Free'}</span></div>
    <div class="grand"><span>Total</span><span>${money(sub + fee)}</span></div>`;
}
function openDrawer() { $('#cartDrawer').classList.add('open'); }
function closeDrawer() { $('#cartDrawer').classList.remove('open'); }

// ------------------------------------------------------------ checkout
function openModal(id) { $('#' + id).classList.add('open'); }
function closeModal(id) { $('#' + id).classList.remove('open'); }
$$('[data-close]').forEach((b) => b.addEventListener('click', () => closeModal(b.dataset.close)));
$$('.modal-back').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) m.classList.remove('open'); }));

function currentType() {
  return (document.querySelector('input[name="otype"]:checked') || {}).value || 'delivery';
}
$$('input[name="otype"]').forEach((r) => r.addEventListener('change', () => {
  $$('input[name="otype"]').forEach((x) => x.closest('.radio-pill').classList.toggle('on', x.checked));
  const pickup = currentType() === 'pickup';
  $('#addressField').style.display = pickup ? 'none' : '';
  renderTotals($('#checkoutTotals'), currentType());
}));
$$('input[name="pay"]').forEach((r) => r.addEventListener('change', () => {
  $$('input[name="pay"]').forEach((x) => x.closest('.radio-pill').classList.toggle('on', x.checked));
}));

$('#cartOpenBtn').addEventListener('click', openDrawer);
$('#cartCloseBtn').addEventListener('click', closeDrawer);
$('#checkoutBtn').addEventListener('click', () => {
  if (!cart.length) return;
  closeDrawer();
  renderTotals($('#checkoutTotals'), currentType());
  $('#checkoutErr').classList.remove('show');
  openModal('checkoutModal');
});

$('#checkoutForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#checkoutErr');
  err.classList.remove('show');
  const type = currentType();
  const payment = (document.querySelector('input[name="pay"]:checked') || {}).value || 'zelle';
  const payload = {
    type,
    paymentMethod: payment,
    customerName: $('#coName').value.trim(),
    customerPhone: $('#coPhone').value.trim(),
    deliveryAddress: $('#coAddress').value.trim(),
    notes: $('#coNotes').value.trim(),
    items: cart.map((l) => ({ id: l.id, size: l.size, sideChoice: l.sideChoice, qty: l.qty })),
  };
  try {
    const res = await fetch('/api/orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not place your order.');
    cart = []; saveCart();
    closeModal('checkoutModal');
    showReceipt(data.order);
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.add('show');
  }
});

function showReceipt(o) {
  const payLine = o.paymentMethod === 'cod'
    ? '<p>Pay in cash when your food arrives or when you pick it up.</p>'
    : `<p>Scan the code below to pay <strong>${money(o.total)}</strong> by ${o.paymentMethod === 'zelle' ? 'Zelle' : 'Cash App'}.</p>
       <p style="color:var(--muted)">Put your order number <strong style="color:var(--gold2)">${o.orderNumber}</strong> in the payment note.</p>
       <img class="qr" src="${o.paymentQr}" alt="Payment QR code">`;
  $('#receiptBody').innerHTML = `
    <p style="color:var(--muted)">Your order number is</p>
    <div class="big-num">${o.orderNumber}</div>
    <p style="color:var(--muted)">Keep it safe — you will need it to track your order.</p>
    <table><thead><tr><th>Dish</th><th>Qty</th><th>Amount</th></tr></thead><tbody>
      ${o.items.map((i) => `<tr><td>${i.name} (${i.size})${i.sideChoice ? '<br><small style="color:var(--muted)">Side: ' + i.sideChoice + '</small>' : ''}</td><td>${i.qty}</td><td>${money(i.lineTotal)}</td></tr>`).join('')}
      <tr><td colspan="2">Subtotal</td><td>${money(o.subtotal)}</td></tr>
      <tr><td colspan="2">${o.type === 'delivery' ? 'Delivery' : 'Pickup'}</td><td>${o.deliveryFee ? money(o.deliveryFee) : 'Free'}</td></tr>
      <tr><td colspan="2"><strong>Total</strong></td><td><strong>${money(o.total)}</strong></td></tr>
    </tbody></table>
    <p>${o.type === 'delivery' ? 'We will bring it to your door.' : 'Pickup: 4015 Edson Ave, Bronx, NY.'}</p>
    ${payLine}`;
  openModal('receiptModal');
}

// ------------------------------------------------------------ tracker
async function trackOrder() {
  const num = $('#trackInput').value.trim().toUpperCase();
  const out = $('#trackResult');
  if (!num) { out.innerHTML = '<p style="color:var(--muted)">Enter your order number first.</p>'; return; }
  out.innerHTML = '<p style="color:var(--muted)">Looking it up…</p>';
  try {
    const res = await fetch('/api/orders/' + encodeURIComponent(num));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Order not found.');
    const o = data.order;
    out.innerHTML = `<p><strong>${o.orderNumber}</strong> · ${o.type === 'delivery' ? 'Delivery' : 'Pickup'} · ${money(o.total)}</p>
      <div class="stages">${o.stages.map((s, i) =>
        `<div class="stage ${i < o.stage ? 'done' : i === o.stage ? 'now' : ''}">${i < o.stage ? '✓ ' : ''}${s}</div>`).join('')}</div>
      <p style="color:var(--gold2);margin:6px 0 0">Now: ${o.stageLabel}</p>
      <p style="color:var(--muted);font-size:14px">${o.items.map((i) => `${i.qty} × ${i.name} (${i.size})`).join(', ')}</p>`;
  } catch (ex) {
    out.innerHTML = `<p style="color:#f0b0b0">${ex.message}</p>`;
  }
}
$('#trackBtn').addEventListener('click', trackOrder);
$('#trackInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') trackOrder(); });

// ------------------------------------------------------------ PWA install
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  $('#installBtn').textContent = 'Install the App';
});
$('#installBtn').addEventListener('click', async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice.catch(() => null);
    deferredPrompt = null;
  } else {
    $('#iosSteps').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
});
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ------------------------------------------------------------ admin
async function adminStatus() {
  try {
    const res = await fetch('/api/admin/status');
    const data = await res.json();
    adminLoggedIn = !!data.loggedIn;
    if (adminLoggedIn) showAdminBoard();
    return data;
  } catch { return { setupRequired: false, loggedIn: false }; }
}
function openAdminModal() {
  adminStatus().then((st) => {
    const setup = !!st.setupRequired;
    $('#adminModalTitle').textContent = setup ? 'Set Up the Kitchen Board' : 'Kitchen Board Login';
    $('#adminModalSub').textContent = setup
      ? 'First time only: choose the email and password for the Kitchen Board. There is no backup login — keep it safe.'
      : 'For the kitchen only. Customers never see this.';
    $('#adminSubmitBtn').textContent = setup ? 'Create Login' : 'Log In';
    $('#adminPassword').setAttribute('autocomplete', setup ? 'new-password' : 'current-password');
    $('#adminErr').classList.remove('show');
    $('#adminOk').classList.remove('show');
    openModal('adminModal');
  });
}
$('#adminNavLink').addEventListener('click', (e) => { e.preventDefault(); adminLoggedIn ? showAdminBoard() : openAdminModal(); });
$('#adminFooterLink').addEventListener('click', (e) => { e.preventDefault(); adminLoggedIn ? showAdminBoard() : openAdminModal(); });

$('#adminForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#adminErr'); const ok = $('#adminOk');
  err.classList.remove('show'); ok.classList.remove('show');
  const email = $('#adminEmail').value.trim();
  const password = $('#adminPassword').value;
  const st = await adminStatus();
  const url = st.setupRequired ? '/api/admin/setup' : '/api/admin/login';
  try {
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed.');
    closeModal('adminModal');
    $('#adminPassword').value = '';
    showAdminBoard();
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.add('show');
  }
});

function showAdminBoard() {
  adminLoggedIn = true;
  $('#adminSection').classList.remove('hidden');
  $('#adminNavLink').textContent = 'Kitchen Board';
  renderAdminTab();
  document.getElementById('adminSection').scrollIntoView({ behavior: 'smooth' });
}
$('#adminLogoutBtn').addEventListener('click', async () => {
  await fetch('/api/admin/logout', { method: 'POST' });
  adminLoggedIn = false;
  $('#adminSection').classList.add('hidden');
  $('#adminNavLink').textContent = 'Admin Login';
});
$$('.admin-tabs [data-tab]').forEach((b) => b.addEventListener('click', () => {
  adminTab = b.dataset.tab;
  $$('.admin-tabs [data-tab]').forEach((x) => x.classList.toggle('on', x === b));
  renderAdminTab();
}));

async function apiAdmin(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { adminLoggedIn = false; $('#adminSection').classList.add('hidden'); throw new Error('Please log in again.'); }
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

async function renderAdminTab() {
  const root = $('#adminTabRoot');
  root.innerHTML = '<p style="color:var(--muted)">Loading…</p>';
  try {
    if (adminTab === 'menu') return renderAdminMenu(root);
    if (adminTab === 'orders') return renderAdminOrders(root);
    if (adminTab === 'settings') return renderAdminSettings(root);
    if (adminTab === 'account') return renderAdminAccount(root);
  } catch (ex) {
    root.innerHTML = `<p style="color:#f0b0b0">${ex.message}</p>`;
  }
}

async function renderAdminMenu(root) {
  const { items } = await apiAdmin('/api/admin/menu');
  const cats = CATS.map(([k, t]) => [k, t]);
  root.innerHTML = `
    <p style="color:var(--muted)">Switch a dish off and it disappears from the customer menu straight away. “Mark Sold Out” does the same thing — it is one switch, two names.</p>
    <div style="margin-bottom:18px"><button class="btn small" id="addDishBtn" type="button">+ Add a Dish</button>
    <span style="color:var(--muted);font-size:13px;margin-left:8px">New dishes start hidden until you switch them on.</span></div>
    <div id="addDishForm" class="hidden" style="background:var(--panel);border:1px solid var(--gold);border-radius:8px;padding:16px;margin-bottom:18px">
      <div class="field"><label>Name</label><input id="ndName"></div>
      <div class="field"><label>Category</label><select id="ndCat">${cats.map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></div>
      <div class="field"><label>Description</label><input id="ndDesc"></div>
      <div class="field"><label>Small price ($)</label><input id="ndSmall" type="number" step="0.01" min="0"></div>
      <div class="field"><label>Large price ($)</label><input id="ndLarge" type="number" step="0.01" min="0"></div>
      <div class="field"><label><input type="checkbox" id="ndMeal"> This is a meal (comes with both rices + free side)</label></div>
      <div class="field"><label><input type="checkbox" id="ndTbd"> Price on order (no online checkout, like the fruit cake)</label></div>
      <button class="btn small" id="ndSave" type="button">Save Dish (starts hidden)</button>
    </div>
    ${cats.map(([k, title]) => {
      const list = items.filter((i) => i.category === k);
      if (!list.length) return '';
      return `<h3 style="color:var(--gold2)">${title}</h3><div class="admin-list">` + list.map((m) => `
        <div class="admin-dish" data-id="${m.id}">
          <div class="top"><b>${m.name}</b><span class="cat">${m.category}</span>
            <span class="pill">${m.available ? 'ON THE MENU' : 'HIDDEN'}</span>
            <span style="margin-left:auto;color:var(--muted)">${m.priceTbd ? 'Price on order' : money(m.priceSmall) + ' / ' + money(m.priceLarge)}</span></div>
          <p style="color:var(--muted);margin:8px 0 0">${m.description}</p>
          <div class="soldout-bar ${m.available ? 'on' : ''}">
            <span>${m.available ? 'On the menu — customers can order this.' : 'SOLD OUT / HIDDEN — customers cannot see this dish.'}</span>
            <button class="btn small ${m.available ? 'ghost' : ''}" type="button" data-toggle="${m.id}">${m.available ? 'Mark Sold Out' : 'Back On'}</button>
          </div>
          <div class="price-edit">
            <label style="font-size:13px;color:var(--muted)">Small $ <input type="number" step="0.01" min="0" value="${m.priceSmall}" data-ps="${m.id}"></label>
            <label style="font-size:13px;color:var(--muted)">Large $ <input type="number" step="0.01" min="0" value="${m.priceLarge}" data-pl="${m.id}"></label>
            <button class="btn small ghost" type="button" data-save-price="${m.id}">Save Prices</button>
          </div>
        </div>`).join('') + '</div>';
    }).join('')}`;
  root.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
    const id = +b.dataset.toggle;
    const cur = items.find((i) => i.id === id);
    await apiAdmin(`/api/admin/menu/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ available: !cur.available }),
    });
    renderAdminTab();
  }));
  root.querySelectorAll('[data-save-price]').forEach((b) => b.addEventListener('click', async () => {
    const id = +b.dataset.savePrice;
    const ps = root.querySelector(`[data-ps="${id}"]`).value;
    const pl = root.querySelector(`[data-pl="${id}"]`).value;
    await apiAdmin(`/api/admin/menu/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priceSmall: ps, priceLarge: pl }),
    });
    renderAdminTab();
  }));
  $('#addDishBtn').addEventListener('click', () => $('#addDishForm').classList.toggle('hidden'));
  $('#ndSave').addEventListener('click', async () => {
    await apiAdmin('/api/admin/menu', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: $('#ndName').value, category: $('#ndCat').value, description: $('#ndDesc').value,
        priceSmall: $('#ndSmall').value || 0, priceLarge: $('#ndLarge').value || 0,
        isMeal: $('#ndMeal').checked, priceTbd: $('#ndTbd').checked,
      }),
    });
    renderAdminTab();
  });
}

async function renderAdminOrders(root) {
  const { orders } = await apiAdmin('/api/admin/orders');
  if (!orders.length) { root.innerHTML = '<p style="color:var(--muted)">No orders yet.</p>'; return; }
  root.innerHTML = '<div class="admin-list">' + orders.map((o) => `
    <div class="order-card">
      <div class="top"><b>${o.orderNumber}</b><span class="pill">${o.stageLabel}</span>
        <span>${o.type === 'delivery' ? 'Delivery' : 'Pickup'} · ${o.paymentMethod === 'zelle' ? 'Zelle' : o.paymentMethod === 'cashapp' ? 'Cash App' : 'Cash'} · ${money(o.total)}</span></div>
      <p style="color:var(--muted);margin:8px 0">${o.customerName} · ${o.customerPhone}${o.deliveryAddress ? ' · ' + o.deliveryAddress : ''}${o.notes ? ' · “' + o.notes + '”' : ''}</p>
      <ul>${o.items.map((i) => `<li>${i.qty} × ${i.name} (${i.size})${i.sideChoice ? ' — side: ' + i.sideChoice : ''} — ${money(i.lineTotal)}</li>`).join('')}</ul>
      <div class="stages">${o.stages.map((s, i) => `<div class="stage ${i < o.stage ? 'done' : i === o.stage ? 'now' : ''}">${s}</div>`).join('')}</div>
      <button class="btn small" type="button" data-next="${o.id}" ${o.stage >= o.stages.length - 1 ? 'disabled' : ''}>Next Stage →</button>
    </div>`).join('') + '</div>';
  root.querySelectorAll('[data-next]').forEach((b) => b.addEventListener('click', async () => {
    await apiAdmin(`/api/admin/orders/${b.dataset.next}/next-stage`, { method: 'POST' });
    renderAdminTab();
  }));
}

async function renderAdminSettings(root) {
  const { settings } = await apiAdmin('/api/admin/settings');
  root.innerHTML = `
    <p style="color:var(--muted)">Delivery is free strictly over the threshold — an order of exactly $${Number(settings.freeThreshold).toFixed(2)} still pays the fee.</p>
    <div class="field"><label>Delivery fee ($)</label><input id="setFee" type="number" step="0.01" min="0" value="${settings.deliveryFee}"></div>
    <div class="field"><label>Free delivery over ($)</label><input id="setFree" type="number" step="0.01" min="0" value="${settings.freeThreshold}"></div>
    <div class="field"><label>Zelle number (private — customers only ever see the QR code)</label><input id="setZelle" value="${settings.zelleHandle}"></div>
    <div class="field"><label>Cash App handle (private — customers only ever see the QR code)</label><input id="setCash" value="${settings.cashAppHandle}"></div>
    <button class="btn" id="setSave" type="button">Save Settings</button>
    <p id="setMsg" style="color:var(--gold2)"></p>`;
  $('#setSave').addEventListener('click', async () => {
    await apiAdmin('/api/admin/settings', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deliveryFee: $('#setFee').value, freeThreshold: $('#setFree').value,
        zelleHandle: $('#setZelle').value, cashAppHandle: $('#setCash').value,
      }),
    });
    $('#setMsg').textContent = 'Saved.';
  });
}

function renderAdminAccount(root) {
  root.innerHTML = `
    <p style="color:var(--muted)">Change your Kitchen Board password. Changing it signs you out on every device — you will need to log in again everywhere.</p>
    <div class="err" id="pwErr"></div><div class="ok" id="pwOk"></div>
    <div class="field"><label>Current password</label><input id="pwCur" type="password" autocomplete="current-password"></div>
    <div class="field"><label>New password (at least 8 characters)</label><input id="pwNew" type="password" autocomplete="new-password"></div>
    <button class="btn" id="pwSave" type="button">Change Password</button>`;
  $('#pwSave').addEventListener('click', async () => {
    const err = $('#pwErr'); const ok = $('#pwOk');
    err.classList.remove('show'); ok.classList.remove('show');
    try {
      const data = await apiAdmin('/api/admin/change-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: $('#pwCur').value, newPassword: $('#pwNew').value }),
      });
      ok.textContent = data.message || 'Password changed.';
      ok.classList.add('show');
      setTimeout(() => { adminLoggedIn = false; $('#adminSection').classList.add('hidden'); $('#adminNavLink').textContent = 'Admin Login'; }, 1500);
    } catch (ex) {
      err.textContent = ex.message; err.classList.add('show');
    }
  });
}

// ------------------------------------------------------------ boot
loadMenu();
renderCart();
adminStatus();
