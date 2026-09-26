# Print Shop — starter storefront (PayPal + Venmo checkout)

A minimal full-stack starter for selling printing products (business cards,
posters, canvas prints, stickers, etc.) from your own site.

- **Backend:** Node.js + Express. Serves the product catalog, creates PayPal
  orders, and captures payment. Prices are always calculated server-side so a
  customer can't tamper with the total in the browser.
- **Frontend:** Plain HTML/CSS/JS (no build step). Product grid, a slide-out
  cart, and the PayPal Buttons widget.
- **Database:** SQLite (`backend/store.db`), a single file — no separate
  database server to install or manage. Holds your product catalog and every
  completed order with its line items.
- **Payments:** PayPal Checkout. Venmo is turned on as an extra funding
  option automatically (`enable-funding=venmo` in the PayPal JS SDK URL) —
  it appears as its own button for eligible US buyers on mobile, no separate
  Venmo integration needed. There's no standalone "Venmo API" that's easier
  to integrate than this; going through PayPal is the practical way to offer
  Venmo on a website.
- **Shipping address:** collected by PayPal itself during checkout (the
  order is created with `shipping_preference: GET_FROM_FILE`), and saved to
  the order record along with the buyer's name/email.
- **Order confirmation emails:** sent to both the buyer and you (the store
  owner) right after a payment is captured, via any SMTP provider.

## 1. Get PayPal API credentials

1. Go to https://developer.paypal.com/dashboard/applications and log in
   (or create a free developer account).
2. Under **Sandbox → Apps & Credentials**, create an app (or use the
   default one) to get a **Client ID** and **Secret** for testing.
3. When you're ready to take real payments, create a **Live** app the same
   way and switch `PAYPAL_ENV=live` in your `.env`.
4. Venmo as a funding source requires your PayPal business account to be
   Venmo-eligible (US business account) — check under your PayPal account
   settings if the Venmo button doesn't appear. It only shows for US buyers
   on supported devices; it will simply be absent otherwise, and the regular
   PayPal button still works for everyone.

## 2. Configure the backend

```bash
cd backend
cp .env.example .env
# edit .env: paste in PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET, and (optionally)
# your SMTP details for order emails — see step 5 below
npm install
npm run seed    # creates store.db and loads products.json into it
npm start
```

The server runs on `http://localhost:3000` by default and serves both the
API and the frontend (the `frontend/` folder is served as static files), so
you only need to run one process.

Re-run `npm run seed` any time you edit `products.json` by hand and want
those changes pulled into the database.

## 3. Try it out

Open `http://localhost:3000` in your browser, add a product to the cart,
open the cart, and pay with the sandbox PayPal button. Use a PayPal sandbox
test buyer account (created automatically under **Sandbox → Accounts** in
the developer dashboard) to complete a test payment.

## 4. Edit your products

Edit `backend/products.json` — id, name, description, price, and an image
URL — then run `npm run seed` to load the changes into `store.db`. Replace
the placeholder images with real photos of your prints (hosted anywhere —
S3, Cloudinary, your own server, etc.).

Every paid order (with its line items, buyer info, and shipping address) is
saved in the `orders` and `order_items` tables in `store.db`. You can browse
this file with any SQLite viewer (e.g. the free [DB Browser for
SQLite](https://sqlitebrowser.org/)) to see your sales.

## 5. Order confirmation emails

Fill in the `SMTP_*` fields in `.env` and the app will automatically email a
receipt to the buyer and a sale notification to you after each successful
payment. If you leave those fields blank, checkout still works fine — it
just skips sending email (and logs a note in the server console).

The easiest free option to get started is Gmail:
1. Turn on 2-Step Verification on the Google account you'll send from.
2. Create an "app password" at https://myaccount.google.com/apppasswords.
3. Use `smtp.gmail.com`, port `587`, your Gmail address as `SMTP_USER`, and
   the 16-character app password as `SMTP_PASS`.

For a real business you'll likely outgrow Gmail's sending limits — a
transactional email service (Postmark, SendGrid, Resend, etc.) works the
same way, just swap in their SMTP host/credentials.

## 6. Shipping address

PayPal collects the shipping address as part of its own checkout flow (no
extra form needed on your site) and hands it back after payment — it's saved
to the order and included in both confirmation emails. Note this relies on
the buyer having an address on file with PayPal; if you'd rather collect
shipping with your own on-site form before checkout, let me know and I'll
add that instead.

## 7. Deploying

Any Node hosting works (Render, Railway, Fly.io, a VPS, etc.). Set the same
environment variables from `.env` in your host's dashboard, and use
`PAYPAL_ENV=live` with your live credentials once you're ready to accept
real payments. See the "Getting this live on the internet" walkthrough
below for the full path from your laptop to a real URL.

## What to build next

- Inventory tracking / "sold out" states
- An admin page to add/edit products without hand-editing JSON
- Order status updates (e.g. "shipped") that trigger a follow-up email
