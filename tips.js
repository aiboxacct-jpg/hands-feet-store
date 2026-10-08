// Tip links for the buyer side of a private chat: direct links/handles so a
// buyer can tip the seller on the seller's own rails (Cash App / Venmo /
// PayPal / crypto). The platform never touches the money.
function tipLinks(conv) {
  const links = [];
  if (conv.cashapp) links.push({ key: 'cashapp', label: 'Cash App', handle: conv.cashapp, url: 'https://cash.app/' + encodeURIComponent(String(conv.cashapp).replace(/^\$/, '')) });
  if (conv.venmo) links.push({ key: 'venmo', label: 'Venmo', handle: conv.venmo, url: 'https://venmo.com/' + encodeURIComponent(String(conv.venmo).replace(/^@/, '')) });
  if (conv.paypal) {
    const p = String(conv.paypal).trim();
    const url = /^https?:\/\//i.test(p) ? p : 'https://paypal.me/' + encodeURIComponent(p.replace(/^@/, ''));
    links.push({ key: 'paypal', label: 'PayPal', handle: conv.paypal, url });
  }
  if (conv.crypto) links.push({ key: 'crypto', label: 'Crypto', handle: conv.crypto, url: null });
  return links;
}

module.exports = { tipLinks };
