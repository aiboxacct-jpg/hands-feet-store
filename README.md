# Creator Store (working title)

A simple marketplace where creators sell photos (feet / hands) and adult items (toys).
Buyers pay directly via **Cash App, Venmo, or PayPal**, and the seller confirms payment.

## Requirements
- Node.js 22.5+ (uses the built-in `node:sqlite` locally — **no build tools needed**). Tested on Node 24.

## Putting it online (permanent public link)
See **[DEPLOY.md](DEPLOY.md)** for a free, step-by-step deploy (Render + Turso + Cloudinary).
Locally it needs none of that — it falls back to a SQLite file + the `uploads/` folder.

## Run it
```bash
npm install
npm start
```
Then open **http://localhost:3000**

On first start an **admin account** is printed in the console:
- Email: `admin@store.local`
- Password: `admin123`

Log in at `/login` and go to **Admin**. Change these before going live (see below).

## How it works
- **Buyers & sellers** create accounts. A buyer can switch to selling from *Account → Become a seller*.
- **Sellers** add their Cash App / Venmo / PayPal handles in *Account*, then post listings with photos, a description, a price, and a category (feet, hands, toys, other).
- **Checkout is manual:** the buyer sees the seller's payment handle, sends the money in that app, and the order is created as *pending*. The seller marks it *paid* / *shipped* once they receive it.
- **Admin** (you) can see all users, listings, and orders, change roles, and remove anything.
- An **18+ age gate** appears before browsing.

## Configuration (optional)
Set environment variables before `npm start` (see `.env.example`):
- `STORE_NAME` — the name shown in the header/footer (default "My Store"). Set this once you pick a name.
- `ADMIN_EMAIL`, `ADMIN_PASSWORD` — admin login created on first run.
- `SESSION_SECRET` — random string for signing sessions.
- `PORT` — default 3000.
- `DATABASE_URL`, `DATABASE_AUTH_TOKEN` — set to use Turso (cloud DB) instead of the local file.
- `CLOUDINARY_URL` — set to store uploaded photos on Cloudinary instead of `uploads/`.

PowerShell example:
```powershell
$env:STORE_NAME = "Sole Mates"; $env:SESSION_SECRET = "some-long-random-string"; npm start
```

## Data & files
- Database: `data/store.db` (SQLite)
- Uploaded images: `uploads/`
- Deleting either resets that data. Both are git-ignored.

## Notes / next steps
- Sessions are in-memory, so logins reset if you restart the server. Fine for local use.
- Payments are handled outside the app on purpose (Cash App/Venmo/PayPal have no simple
  drop-in checkout). Integrating PayPal buttons later would let payment be captured on-site.
- Before deploying publicly you'll want: HTTPS, a persistent session store, real backups,
  and to confirm your area's rules on selling used adult items.
