const nodemailer = require('nodemailer');

function getTransporter() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    return null; // email not configured — caller should skip sending
  }
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

function formatAddress(addr) {
  if (!addr) return null;
  const lines = [
    addr.address_line_1,
    addr.address_line_2,
    [addr.admin_area_2, addr.admin_area_1, addr.postal_code].filter(Boolean).join(', '),
    addr.country_code,
  ].filter(Boolean);
  return lines.join('<br/>');
}

function buildEmailHtml({ order, items, isStoreCopy }) {
  const itemRows = items
    .map(
      (it) => `
        <tr>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;">${it.product_name}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center;">${it.qty}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">$${it.unit_price.toFixed(2)}</td>
        </tr>`
    )
    .join('');

  const shippingBlock = order.shipping_address
    ? `<p><strong>Shipping to:</strong><br/>${order.shipping_name || ''}<br/>${order.shipping_address}</p>`
    : '';

  return `
    <div style="font-family:Arial,sans-serif;color:#1c1c1e;max-width:480px;">
      <h2>${isStoreCopy ? 'New order received' : 'Thanks for your order!'}</h2>
      <p>Order #${order.id} — PayPal order ${order.paypal_order_id}</p>
      ${!isStoreCopy ? `<p>Hi ${order.payer_name || 'there'}, thanks for shopping with us. Here's your receipt:</p>` : `<p>Buyer: ${order.payer_name || ''} (${order.payer_email || ''})</p>`}
      <table style="width:100%;border-collapse:collapse;margin:12px 0;">
        <thead>
          <tr>
            <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #ccc;">Item</th>
            <th style="text-align:center;padding:6px 8px;border-bottom:2px solid #ccc;">Qty</th>
            <th style="text-align:right;padding:6px 8px;border-bottom:2px solid #ccc;">Price</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>
      <p style="font-size:1.1em;"><strong>Total: $${order.total.toFixed(2)}</strong></p>
      ${shippingBlock}
    </div>
  `;
}

async function sendOrderEmails({ order, items }) {
  const transporter = getTransporter();
  if (!transporter) {
    console.log('SMTP not configured — skipping order confirmation email.');
    return;
  }

  const fromAddress = process.env.FROM_EMAIL || process.env.SMTP_USER;
  const storeEmail = process.env.STORE_EMAIL || process.env.SMTP_USER;

  const sends = [];

  if (order.payer_email) {
    sends.push(
      transporter.sendMail({
        from: fromAddress,
        to: order.payer_email,
        subject: `Your order #${order.id} is confirmed`,
        html: buildEmailHtml({ order, items, isStoreCopy: false }),
      })
    );
  }

  if (storeEmail) {
    sends.push(
      transporter.sendMail({
        from: fromAddress,
        to: storeEmail,
        subject: `New order #${order.id} — $${order.total.toFixed(2)}`,
        html: buildEmailHtml({ order, items, isStoreCopy: true }),
      })
    );
  }

  try {
    await Promise.all(sends);
  } catch (err) {
    // Don't fail the checkout if email sending has a problem — the payment
    // already succeeded. Just log it so you can investigate.
    console.error('Order confirmation email failed to send:', err);
  }
}

module.exports = { sendOrderEmails, formatAddress };
