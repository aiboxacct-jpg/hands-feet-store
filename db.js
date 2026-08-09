// Database layer with two interchangeable backends:
//  - LOCAL dev:   Node's built-in node:sqlite (no deps, a file on disk)
//  - PRODUCTION:  Turso via @libsql/client (set DATABASE_URL) — same SQLite SQL
//
// Both are exposed through the same async interface: db.get / db.all / db.run / db.exec.
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, 'data');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'buyer',
  cashapp       TEXT,
  venmo         TEXT,
  paypal        TEXT,
  bio           TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL,
  category    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS product_images (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  public_id  TEXT,
  position   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  buyer_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seller_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id     INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  amount_cents   INTEGER NOT NULL,
  payment_method TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending',
  contact        TEXT,
  note           TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_products_seller ON products(seller_id);
CREATE INDEX IF NOT EXISTS idx_images_product  ON product_images(product_id);
CREATE INDEX IF NOT EXISTS idx_orders_buyer    ON orders(buyer_id);
CREATE INDEX IF NOT EXISTS idx_orders_seller   ON orders(seller_id);
`;

let backend = null;
const usingTurso = !!process.env.DATABASE_URL;

// --- node:sqlite backend (local) -------------------------------------------
function nodeSqliteBackend() {
  const { DatabaseSync } = require('node:sqlite');
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const sqlite = new DatabaseSync(path.join(DATA_DIR, 'store.db'));
  sqlite.exec('PRAGMA journal_mode = WAL;');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  return {
    exec: async (sql) => sqlite.exec(sql),
    run: async (sql, ...args) => {
      const r = sqlite.prepare(sql).run(...args);
      return { lastInsertRowid: r.lastInsertRowid, changes: r.changes };
    },
    get: async (sql, ...args) => sqlite.prepare(sql).get(...args),
    all: async (sql, ...args) => sqlite.prepare(sql).all(...args),
  };
}

// --- Turso / libSQL backend (production) -----------------------------------
async function tursoBackend() {
  const { createClient } = await import('@libsql/client/web');
  const client = createClient({
    url: process.env.DATABASE_URL,
    authToken: process.env.DATABASE_AUTH_TOKEN,
  });
  return {
    exec: async (sql) => client.executeMultiple(sql),
    run: async (sql, ...args) => {
      const r = await client.execute({ sql, args });
      return { lastInsertRowid: r.lastInsertRowid, changes: r.rowsAffected };
    },
    get: async (sql, ...args) => (await client.execute({ sql, args })).rows[0],
    all: async (sql, ...args) => (await client.execute({ sql, args })).rows,
  };
}

async function seedAdmin() {
  const email = (process.env.ADMIN_EMAIL || 'admin@store.local').toLowerCase();
  const existing = await backend.get('SELECT id FROM users WHERE role = ?', 'admin');
  if (existing) return;
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  const hash = bcrypt.hashSync(password, 10);
  await backend.run(
    "INSERT INTO users (email, password_hash, display_name, role) VALUES (?, ?, ?, 'admin')",
    email,
    hash,
    'Site Admin'
  );
  console.log('\n=== Admin account created ===');
  console.log('  Email:    ' + email);
  console.log('  Password: ' + password);
  console.log('=============================\n');
}

async function init() {
  backend = usingTurso ? await tursoBackend() : nodeSqliteBackend();
  await backend.exec(SCHEMA);
  await seedAdmin();
  console.log('Database ready (' + (usingTurso ? 'Turso/libSQL' : 'local node:sqlite') + ').');
}

module.exports = {
  init,
  exec: (...a) => backend.exec(...a),
  run: (...a) => backend.run(...a),
  get: (...a) => backend.get(...a),
  all: (...a) => backend.all(...a),
};
