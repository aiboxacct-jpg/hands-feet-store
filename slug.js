// Turn a name into a URL-safe store handle, and ensure it's unique.
function slugify(name) {
  let s = String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/g, '');
  if (!s) s = 'store';
  if (/^\d+$/.test(s)) s = 'store-' + s; // never purely numeric (would clash with ids)
  return s;
}

// `get(sql, ...args)` is a db.get-style function returning the row or undefined.
async function uniqueHandle(get, name, excludeUserId) {
  const base = slugify(name);
  let candidate = base;
  let n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await get('SELECT id FROM users WHERE handle = ?', candidate);
    if (!existing || existing.id === excludeUserId) return candidate;
    n += 1;
    candidate = base + '-' + n;
  }
}

module.exports = { slugify, uniqueHandle };
