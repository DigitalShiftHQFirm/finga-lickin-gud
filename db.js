// Finga Lickin Gud — SQLite setup using Node's built-in node:sqlite.
// Database file lives at data/flg.db next to server.js, or under
// DATA_DIR when set (Render free tier has no persistent disk, so the
// database resets on redeploy/restart there — see README.md).
'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'flg.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );

  -- Single admin account (id 1). No row = no login set up yet.
  -- Password is a PBKDF2 salted hash (see server.js); never plaintext.
  CREATE TABLE IF NOT EXISTS admin (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    email TEXT NOT NULL,
    salt TEXT NOT NULL,
    hash TEXT NOT NULL,
    token_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS menu_items (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    image_key TEXT NOT NULL DEFAULT '',
    price_small_cents INTEGER NOT NULL DEFAULT 0,
    price_large_cents INTEGER NOT NULL DEFAULT 0,
    price_tbd INTEGER NOT NULL DEFAULT 0,
    is_meal INTEGER NOT NULL DEFAULT 0,
    available INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT NOT NULL UNIQUE,
    customer_name TEXT NOT NULL DEFAULT '',
    customer_phone TEXT NOT NULL DEFAULT '',
    delivery_address TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'delivery',
    payment_method TEXT NOT NULL DEFAULT 'zelle',
    subtotal_cents INTEGER NOT NULL DEFAULT 0,
    delivery_fee_cents INTEGER NOT NULL DEFAULT 0,
    total_cents INTEGER NOT NULL DEFAULT 0,
    stage INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    menu_item_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    size TEXT NOT NULL DEFAULT 'large',
    side_choice TEXT NOT NULL DEFAULT '',
    qty INTEGER NOT NULL DEFAULT 1,
    unit_price_cents INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (order_id) REFERENCES orders(id)
  );
`);

// ---------------------------------------------------------------- settings
function getSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}
function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

// Seeded once; never overwritten on later boots (so admin price edits
// and settings changes survive restarts).
setSetting('delivery_fee_cents', getSetting('delivery_fee_cents', '1500'));
setSetting('free_threshold_cents', getSetting('free_threshold_cents', '8000'));
// Payment handles are PRIVATE: stored here, served only to the admin.
// They must never appear in a customer page or public API response.
setSetting('zelle_handle', getSetting('zelle_handle', '13016656239'));
setSetting('cashapp_handle', getSetting('cashapp_handle', '$Resurrectedchild'));
// Server signing secret for admin session tokens. Generated once and
// persisted here so sessions survive restarts on the same disk.
let serverSecret = getSetting('server_secret', '');
if (!serverSecret) {
  serverSecret = require('crypto').randomBytes(32).toString('hex');
  setSetting('server_secret', serverSecret);
}

// ---------------------------------------------------------------- menu seed
// Idempotent: INSERT OR IGNORE by fixed id, so a re-seed never wipes
// an admin's price/availability edits. Prices are final as of Nov 17.
const MENU_SEED = [
  // id, name, category, description, imageKey, small¢, large¢, tbd, meal, available
  [1, 'Jerk Chicken', 'jerk', "Quarter chicken marinated in Grandma's jerk seasoning, smoked till the skin is dark and the inside stays juicy.", 'jerk-chicken', 1300, 1800, 0, 1, 1],
  [2, 'Jerk Pork', 'jerk', 'Pork shoulder rubbed down with Scotch bonnet, pimento and thyme, slow-smoked and chopped with the crispy edges.', 'jerk-pork', 1400, 1900, 0, 1, 1],
  [3, 'Steam Fish', 'fish', 'Whole fish steamed down with okra, carrot, cho cho and crackers in a light, peppery broth.', 'steam-fish', 1800, 2300, 0, 1, 1],
  [4, 'Roast Fish', 'fish', 'Whole fish seasoned and roasted till the skin crisps, stuffed with seasoned vegetables.', 'roast-fish', 1800, 2300, 0, 1, 1],
  [5, 'Brown Stew Fish', 'fish', 'Fried first, then simmered in a rich brown gravy with peppers, onion and tomato.', 'brown-stew-fish', 1800, 2300, 0, 1, 1],
  [6, 'Escovitch Fish', 'fish', 'Crispy fried whole fish topped with pickled peppers, onion and carrot in a vinegar bite.', 'escovitch', 1800, 2300, 0, 1, 1],
  [7, 'Chicken / Chicken Foot Soup', 'soup', 'Golden pumpkin broth with chicken, chicken foot, spinners, yam and corn — Saturday soup energy, any day.', 'soup', 700, 1200, 0, 0, 1],
  [8, 'Beef Soup', 'soup', 'Beef simmered tender in pumpkin broth with ground provisions and dumplings.', 'beef-soup', 700, 1200, 0, 0, 1],
  [9, 'Cowfoot Soup', 'soup', 'Cowfoot cooked down soft and gelatin-rich with beans, pumpkin and spinners.', 'cowfoot-soup', 800, 1300, 0, 0, 1],
  [10, 'Tripe Soup', 'soup', 'Tripe and beans in a seasoned pumpkin broth — old-school, hearty, filling.', 'tripe-soup', 800, 1300, 0, 0, 1],
  [11, 'Seafood Soup', 'soup', 'Fish, shrimp and crab in a coconut-kissed broth with okra, corn and ground provisions.', 'seafood-soup', 1000, 1600, 0, 0, 1],
  [12, 'Steam Cabbage', 'sides', 'Cabbage steamed down with carrot, sweet pepper, onion and thyme.', 'steam-cabbage', 500, 800, 0, 0, 1],
  [13, 'Rasta Pasta', 'sides', 'Penne in a creamy jerk-spiced sauce with red, gold and green peppers — the colours in a bowl.', 'rasta-pasta', 600, 900, 0, 0, 1],
  [14, 'Potato Salad', 'sides', 'Creamy yard-style potato salad with peas, carrot and a little sweetness.', 'potato-salad', 500, 800, 0, 0, 1],
  [15, 'Mac & Cheese', 'sides', 'Baked macaroni pie — golden crust on top, creamy and cheesy underneath.', 'mac-and-cheese', 500, 800, 0, 0, 1],
  [16, 'Mystery Juice of the Day', 'drinks', "Grandma's secret pour — whatever fruit is ripe and ready goes in the jug. Ask what's in it today, or just trust her.", 'rum-punch', 600, 900, 0, 0, 1],
  [17, 'Carrot Juice', 'drinks', 'Fresh carrots juiced thick and creamy with a warm hint of spice — a yard classic.', 'carrot-juice', 600, 900, 0, 0, 0],
  [18, 'Pineapple Ginger', 'drinks', 'Sweet pineapple with fresh ginger heat — bright, cold and cleansing.', 'pineapple-ginger', 500, 800, 0, 0, 0],
  [19, 'Lemonade', 'drinks', 'Hand-squeezed and sweetened just right — simple, cold, and gone fast.', 'lemonade', 500, 800, 0, 0, 0],
  [20, 'Sorrel', 'drinks', 'Hibiscus sorrel brewed with ginger and pimento — deep red, spiced, and pure Jamaica.', 'sorrel', 600, 900, 0, 0, 0],
  [21, 'Jamaican Black Fruit Cake', 'sweet', 'Dark, rich fruit cake — fruits soaked and blended the old way, baked low and slow. Dense, moist, unforgettable. Made to order — call us to order yours.', 'jamaican-fruit-cake', 0, 0, 1, 0, 1],
];

const seedMenu = db.prepare(
  `INSERT OR IGNORE INTO menu_items
   (id, name, category, description, image_key, price_small_cents, price_large_cents, price_tbd, is_meal, available, sort_order)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
for (const row of MENU_SEED) seedMenu.run(...row, row[0]);

module.exports = { db, DATA_DIR, getSetting, setSetting, serverSecret: getSetting('server_secret', '') };
