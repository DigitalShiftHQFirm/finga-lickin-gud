# Finga Lickin Gud

Standalone restaurant web app — public menu, ordering with Zelle /
Cash App / cash, itemised receipt with QR code, order tracker, and a
Kitchen Board admin (menu toggles, price editing, add-a-dish, order
stages, settings). Black / gold / deep-green luxury look, Grandma in
the hero, Jamaican flag, animated steam / fire / embers / leaves
(the animation stops for `prefers-reduced-motion`).

## Stack

- Node 24 + Express (only dependency)
- SQLite via Node's built-in `node:sqlite` — file at `data/flg.db`
  (or `$DATA_DIR/flg.db` when set). No external services, no email.
- Admin passwords: PBKDF2 (Node crypto), salted hash, 30-day signed
  HMAC cookie sessions. Password change signs out all devices.

## Run locally

```bash
cd finga-liv
npm install
npm start          # http://localhost:3000
```

Food / QR / hero images live in `public/images/` (delivered separately
— do not commit placeholders there; the app references them by name).

## First-time admin setup

The app starts with **no admin login**. There are no default
credentials anywhere.

1. Open the site, click **Admin Login** (top nav or footer).
2. The modal says “Set Up the Kitchen Board” — enter the owner's
   email and a password (8+ characters) and submit.
3. That creates the one and only login. Afterwards the setup endpoint
   refuses (`403`) — nobody can claim or overwrite it.
4. If the password is ever lost there is **no backup access**: the
   database row must be cleared by someone with server/filesystem
   access (delete the `admin` row in `data/flg.db`), then setup runs
   again. On Render free tier, a redeploy wipes the database, so
   setup simply runs again after a wipe.

## Deploy on Render (free plan)

1. Push this folder to a GitHub repo (root = this folder).
2. In Render: New → Web Service → pick the repo. Render reads
   `render.yaml` (free plan, `npm install` / `npm start`, health
   check `/`).
3. Set `SESSION_SECRET` as a secret env var in the Render dashboard
   (any long random string). Without it, sessions still work — the
   secret is generated once and stored in the database — but setting
   it explicitly is safer across database wipes.
4. Deploy. Open the site and run first-time setup (above).

**Free-plan warning:** no persistent disk, so the SQLite database
resets on restart/redeploy — orders, menu edits and the admin login
are lost and the menu re-seeds from the code. For permanent data,
upgrade to a paid plan, add a disk mounted at `/var/data/flg`, and
set `DATA_DIR=/var/data/flg`.

## Money rules (seeded, editable in Kitchen Board → Settings)

- Delivery fee **$15**; free delivery **strictly over $80** — an
  order of exactly $80 still pays $15. Pickup is always free.
- Every meal comes with **both** White Rice and Rice & Peas + one
  free side (Festival / Bread / Salad / Fry Plantain).
- Jamaican Black Fruit Cake is **price on order, made to order** —
  no online checkout; customers call (646) 669-3814. The API refuses
  it in an order with a “call us” message.
- Zelle number and Cash App handle are stored privately and shown
  only in Kitchen Board settings. Customers only ever see the QR
  codes (`zelle-qr.jpg` / `cashapp-qr.jpg`) on the receipt, with the
  total and a note to put the order number in the payment note.

## Order stages

- Delivery: Received → Preparing → On the Way → Delivered
- Pickup: Received → Preparing → Ready for Pickup → Picked Up

Admin moves an order forward with **Next Stage** in Kitchen Board →
Orders. Customers track by order number (`FLG-######`) on the site.

## Key files

| File | What it is |
| --- | --- |
| `server.js` | Express app: public + admin API, auth, order math |
| `db.js` | SQLite schema + idempotent menu/settings seed |
| `public/index.html` | Storefront page (menu, tracker, footer, PWA links) |
| `public/app.js` | Menu/cart/checkout/receipt/tracker/Kitchen Board |
| `public/styles.css` | Black/gold/green luxury styling + hero animation |
| `public/manifest.webmanifest` | PWA manifest (name, icons, theme colour) |
| `public/sw.js` | App-shell service worker (API always network) |
| `render.yaml` | Render free-plan deploy |
