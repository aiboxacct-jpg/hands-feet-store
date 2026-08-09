# Deploying your store for free (permanent public link)

This puts your store online at a stable `https://…onrender.com` link that stays up
without your PC on, and keeps all data (accounts, listings, photos) permanently.

You'll use three free services. **All are free and none need a credit card.**

| Service | What it's for | Free tier |
|---------|---------------|-----------|
| **Turso** | The database (accounts, listings, orders) | Yes, no card |
| **Cloudinary** | Stores the uploaded photos | Yes, 25 GB, no card |
| **Render** | Runs the website | Yes, no card (sleeps when idle) |

> One quirk of Render's free tier: after ~15 min with no visitors the site "sleeps,"
> so the **first** visit afterward takes ~30–60 seconds to wake up. Your data is safe —
> only the wake-up is slow. Upgrading Render later removes this.

---

## Step 1 — Put the code on GitHub (so Render can read it)

Easiest for non-coders: **GitHub Desktop.**

1. Make a free account at <https://github.com>.
2. Download **GitHub Desktop**: <https://desktop.github.com> and sign in.
3. In GitHub Desktop: **File → Add local repository →** choose this folder
   (`Hands_Feet_Sellers Site`). If it offers to create a repository here, say yes.
4. Click **Publish repository**. Keep **"Keep this code private"** checked. Publish.

Your code is now on GitHub. (The `.gitignore` already keeps your local test data and
`node_modules` out of it.)

---

## Step 2 — Create the database (Turso)

1. Sign up at <https://turso.tech> (log in with GitHub — one click).
2. Create a database (any name, e.g. `store`). Pick the region closest to you.
3. You need two values. On the database page:
   - **Database URL** — looks like `libsql://store-yourname.turso.io`
   - **Auth token** — click **Create Token** / **Generate token** and copy it.
4. Keep these two handy for Step 4. (If the site has a CLI instead, the commands are
   `turso db show store --url` and `turso db tokens create store`.)

---

## Step 3 — Create image hosting (Cloudinary)

1. Sign up at <https://cloudinary.com> (free "Programmable Media" plan).
2. On the **Dashboard**, find **API Environment variable**. Copy the value that looks like:
   `cloudinary://123456789:abcdefg_yourSecret@your-cloud-name`
3. Keep it for Step 4.

---

## Step 4 — Deploy on Render

1. Sign up at <https://render.com> (log in with GitHub).
2. Click **New +  →  Blueprint**.
3. Connect the GitHub repo you published in Step 1. Render reads `render.yaml` and
   proposes a free web service — click **Apply**.
4. When it asks for the environment variables (or under the service's **Environment** tab),
   fill these in:

   | Key | Value |
   |-----|-------|
   | `DATABASE_URL` | the Turso URL from Step 2 (`libsql://…`) |
   | `DATABASE_AUTH_TOKEN` | the Turso token from Step 2 |
   | `CLOUDINARY_URL` | the Cloudinary value from Step 3 |
   | `ADMIN_PASSWORD` | a password you choose for your admin login |
   | `STORE_NAME` | your store's name (once you pick one) |
   | `ADMIN_EMAIL` | your admin login email (optional) |
   | `SESSION_SECRET` | leave it — Render fills this automatically |

5. Save. Render builds and deploys (a few minutes). When it's done you'll get a link like
   **`https://creator-store-xxxx.onrender.com`** — that's your public store.

6. Log in at `/login` with `ADMIN_EMAIL` (or `admin@store.local`) and the `ADMIN_PASSWORD`
   you set, and you're in.

Send that link to your testers — no password page, works from anywhere, anytime.

---

## Updating the site later
Make changes locally, then in GitHub Desktop click **Commit** and **Push**. Render
redeploys automatically within a minute or two. Your data stays put.

## Notes
- If you ever want no sleep/wake delay and a custom domain, that's Render's paid tier (~$7/mo).
- For a real adult business long-term, consider a host that explicitly allows adult content
  (mainstream hosts can remove "objectionable" content). Fine for testing as-is.
