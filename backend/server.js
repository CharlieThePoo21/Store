require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const db = require('./database');
const { sendOrderEmails, formatAddress } = require('./email');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const PAYPAL_ENV = process.env.PAYPAL_ENV === 'live' ? 'live' : 'sandbox';
const PAYPAL_API_BASE =
  PAYPAL_ENV === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';

// ---- PayPal auth ----
async function getPayPalAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Missing PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET in .env');
  }
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PayPal auth failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  return data.access_token;
}

// ---- Public config (safe to expose: client ID only, never the secret) ----
app.get('/api/config', (req, res) => {
  res.json({
    clientId: process.env.PAYPAL_CLIENT_ID || '',
    env: PAYPAL_ENV,
  });
});

// ---- Product catalog (now from the database) ----
app.get('/api/products', (req, res) => {
  const products = db
    .prepare('SELECT id, name, description, price, image FROM products WHERE active = 1')
    .all();
  res.json(products);
});

// ---- Create a PayPal order from a cart ----
// Body: { items: [{ id: "poster-18x24", qty: 2 }, ...] }
// Prices are always looked up server-side so a client can't tamper with totals.
app.post('/api/orders', async (req, res) => {
  try {
    const cartItems = Array.isArray(req.body.items) ? req.body.items : [];
    if (cartItems.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    const getProduct = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1');

    let total = 0;
    const purchaseItems = [];

    for (const cartItem of cartItems) {
      const product = getProduct.get(cartItem.id);
      const qty = Math.max(1, parseInt(cartItem.qty, 10) || 1);
      if (!product) {
        return res.status(400).json({ error: `Unknown product: ${cartItem.id}` });
      }
      total += product.price * qty;
      purchaseItems.push({
        name: product.name.slice(0, 127),
        unit_amount: { currency_code: 'USD', value: product.price.toFixed(2) },
        quantity: String(qty),
      });
    }

    const accessToken = await getPayPalAccessToken();

    const orderRes = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        // GET_FROM_FILE asks the buyer to choose/confirm a shipping address
        // as part of the PayPal flow, which we then read back on capture.
        application_context: {
          shipping_preference: 'GET_FROM_FILE',
        },
        purchase_units: [
          {
            amount: {
              currency_code: 'USD',
              value: total.toFixed(2),
              breakdown: {
                item_total: { currency_code: 'USD', value: total.toFixed(2) },
              },
            },
            items: purchaseItems,
          },
        ],
      }),
    });

    const orderData = await orderRes.json();
    if (!orderRes.ok) {
      console.error('PayPal create order error:', orderData);
      return res.status(500).json({ error: 'Failed to create PayPal order' });
    }

    res.json({ id: orderData.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error creating order' });
  }
});

// ---- Capture payment after buyer approves ----
app.post('/api/orders/:orderID/capture', async (req, res) => {
  try {
    const { orderID } = req.params;
    const accessToken = await getPayPalAccessToken();

    const captureRes = await fetch(
      `${PAYPAL_API_BASE}/v2/checkout/orders/${orderID}/capture`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const captureData = await captureRes.json();
    if (!captureRes.ok) {
      console.error('PayPal capture error:', captureData);
      return res.status(500).json({ error: 'Failed to capture payment' });
    }

    const purchaseUnit = captureData.purchase_units && captureData.purchase_units[0];
    const capture = purchaseUnit && purchaseUnit.payments && purchaseUnit.payments.captures && purchaseUnit.payments.captures[0];
    const total = capture ? parseFloat(capture.amount.value) : 0;
    const shipping = purchaseUnit && purchaseUnit.shipping;
    const payer = captureData.payer || {};

    // Save the order
    const insertOrder = db.prepare(`
      INSERT INTO orders (paypal_order_id, status, payer_name, payer_email, shipping_name, shipping_address, total)
      VALUES (@paypal_order_id, @status, @payer_name, @payer_email, @shipping_name, @shipping_address, @total)
    `);
    const orderResult = insertOrder.run({
      paypal_order_id: orderID,
      status: captureData.status,
      payer_name: payer.name ? `${payer.name.given_name || ''} ${payer.name.surname || ''}`.trim() : null,
      payer_email: payer.email_address || null,
      shipping_name: shipping && shipping.name ? shipping.name.full_name : null,
      shipping_address: shipping ? formatAddress(shipping.address) : null,
      total,
    });
    const orderId = orderResult.lastInsertRowid;

    // Save line items (re-look-up from the PayPal item breakdown so the DB
    // record matches what was actually charged)
    const insertItem = db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, unit_price, qty)
      VALUES (@order_id, @product_id, @product_name, @unit_price, @qty)
    `);
    const items = (purchaseUnit.items || []).map((it) => ({
      order_id: orderId,
      product_id: it.sku || it.name,
      product_name: it.name,
      unit_price: parseFloat(it.unit_amount.value),
      qty: parseInt(it.quantity, 10),
    }));
    const insertItems = db.transaction((rows) => rows.forEach((r) => insertItem.run(r)));
    insertItems(items);

    // Fire off confirmation emails (non-blocking for the response, but we
    // await so any error gets logged rather than lost)
    await sendOrderEmails({
      order: {
        id: orderId,
        paypal_order_id: orderID,
        status: captureData.status,
        payer_name: payer.name ? `${payer.name.given_name || ''} ${payer.name.surname || ''}`.trim() : null,
        payer_email: payer.email_address || null,
        shipping_name: shipping && shipping.name ? shipping.name.full_name : null,
        shipping_address: shipping ? formatAddress(shipping.address) : null,
        total,
      },
      items,
    });

    res.json(captureData);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error capturing order' });
  }
});

// ---- Serve the frontend ----
app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.listen(PORT, () => {
  console.log(`Print shop server running on http://localhost:${PORT} (PayPal env: ${PAYPAL_ENV})`);
});
