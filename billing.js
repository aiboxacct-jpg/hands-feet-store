// Platform commission + seller billing / lock-out.
// Payments are peer-to-peer, so the site's cut is tracked as a FEE the seller
// owes the platform, accrued on each paid order, and enforced via a lock.
const db = require('./db');

const cache = { site_cut_percent: 1, lockout_threshold_cents: 500, platform_handle: '' };

async function loadSettings() {
  const rows = await db.all('SELECT key, value FROM settings');
  for (const r of rows) {
    if (r.key === 'site_cut_percent') cache.site_cut_percent = parseFloat(r.value) || 0;
    else if (r.key === 'lockout_threshold_cents') cache.lockout_threshold_cents = parseInt(r.value, 10) || 0;
    else if (r.key === 'platform_handle') cache.platform_handle = r.value || '';
  }
}
function settings() {
  return { ...cache };
}
async function setSetting(key, value) {
  await db.run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    String(value)
  );
  await loadSettings();
}

// The site's cut on an order amount (rounded to cents).
function feeFor(amountCents) {
  return Math.round((Number(amountCents) * cache.site_cut_percent) / 100);
}

// What a seller currently owes (unpaid fees on paid/shipped orders).
async function sellerBill(sellerId) {
  const row = await db.get(
    "SELECT COALESCE(SUM(fee_cents), 0) AS owed FROM orders WHERE seller_id = ? AND status IN ('paid','shipped') AND fee_paid = 0",
    sellerId
  );
  return Number(row.owed);
}

// Set/clear the seller's locked flag based on their current bill vs threshold.
async function recomputeLock(sellerId) {
  const owed = await sellerBill(sellerId);
  const locked = cache.lockout_threshold_cents > 0 && owed >= cache.lockout_threshold_cents ? 1 : 0;
  await db.run('UPDATE users SET locked = ? WHERE id = ?', locked, sellerId);
  return { owed, locked };
}

// When an order becomes paid/shipped: record the fee once, then re-evaluate lock.
async function onOrderPaid(order) {
  if (!order.fee_cents) {
    await db.run('UPDATE orders SET fee_cents = ? WHERE id = ?', feeFor(order.amount_cents), order.id);
  }
  await recomputeLock(order.seller_id);
}

// Admin marks a seller's bill as paid (settles all outstanding fees) → unlock.
async function settleSeller(sellerId) {
  await db.run(
    "UPDATE orders SET fee_paid = 1 WHERE seller_id = ? AND status IN ('paid','shipped') AND fee_paid = 0",
    sellerId
  );
  await recomputeLock(sellerId);
}

// Re-evaluate every seller's lock (after changing the threshold).
async function recomputeAllLocks() {
  const sellers = await db.all("SELECT id FROM users WHERE role IN ('seller','admin')");
  for (const s of sellers) await recomputeLock(s.id);
}

module.exports = {
  loadSettings,
  settings,
  setSetting,
  feeFor,
  sellerBill,
  recomputeLock,
  onOrderPaid,
  settleSeller,
  recomputeAllLocks,
};
