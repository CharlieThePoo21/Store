const API_BASE = ''; // same origin as backend

let PRODUCTS = [];
let cart = JSON.parse(localStorage.getItem('cart') || '{}'); // { productId: qty }

const productGrid = document.getElementById('product-grid');
const cartItemsEl = document.getElementById('cart-items');
const cartTotalEl = document.getElementById('cart-total');
const cartCountEl = document.getElementById('cart-count');
const cartDrawer = document.getElementById('cart-drawer');
const cartBackdrop = document.getElementById('cart-backdrop');
const checkoutMessage = document.getElementById('checkout-message');

document.getElementById('cart-toggle').addEventListener('click', openCart);
document.getElementById('cart-close').addEventListener('click', closeCart);
cartBackdrop.addEventListener('click', closeCart);

function openCart() {
  cartDrawer.classList.add('open');
  cartBackdrop.classList.add('open');
}
function closeCart() {
  cartDrawer.classList.remove('open');
  cartBackdrop.classList.remove('open');
}

function saveCart() {
  localStorage.setItem('cart', JSON.stringify(cart));
  renderCart();
}

function addToCart(productId) {
  cart[productId] = (cart[productId] || 0) + 1;
  saveCart();
  openCart();
}

function changeQty(productId, delta) {
  const next = (cart[productId] || 0) + delta;
  if (next <= 0) {
    delete cart[productId];
  } else {
    cart[productId] = next;
  }
  saveCart();
}

function removeFromCart(productId) {
  delete cart[productId];
  saveCart();
}

function cartTotal() {
  return Object.entries(cart).reduce((sum, [id, qty]) => {
    const product = PRODUCTS.find((p) => p.id === id);
    return product ? sum + product.price * qty : sum;
  }, 0);
}

function renderProducts() {
  if (PRODUCTS.length === 0) {
    productGrid.innerHTML = '<p class="loading">No products found.</p>';
    return;
  }
  productGrid.innerHTML = PRODUCTS.map((p) => `
    <div class="product-card">
      <img src="${p.image}" alt="${p.name}" />
      <div class="product-card-body">
        <h3>${p.name}</h3>
        <p>${p.description}</p>
        <div class="price">$${p.price.toFixed(2)}</div>
        <button class="add-btn" data-id="${p.id}">Add to cart</button>
      </div>
    </div>
  `).join('');

  productGrid.querySelectorAll('.add-btn').forEach((btn) => {
    btn.addEventListener('click', () => addToCart(btn.dataset.id));
  });
}

function renderCart() {
  const entries = Object.entries(cart);
  cartCountEl.textContent = entries.reduce((n, [, qty]) => n + qty, 0);

  if (entries.length === 0) {
    cartItemsEl.innerHTML = '<p class="loading">Your cart is empty.</p>';
  } else {
    cartItemsEl.innerHTML = entries.map(([id, qty]) => {
      const product = PRODUCTS.find((p) => p.id === id);
      if (!product) return '';
      return `
        <div class="cart-line">
          <div>
            <div>${product.name}</div>
            <div class="cart-line-qty">
              <button data-action="dec" data-id="${id}">−</button>
              <span>${qty}</span>
              <button data-action="inc" data-id="${id}">+</button>
            </div>
          </div>
          <div>
            $${(product.price * qty).toFixed(2)}
            <br/>
            <button class="remove-line" data-action="remove" data-id="${id}">Remove</button>
          </div>
        </div>
      `;
    }).join('');

    cartItemsEl.querySelectorAll('button').forEach((btn) => {
      const id = btn.dataset.id;
      btn.addEventListener('click', () => {
        if (btn.dataset.action === 'inc') changeQty(id, 1);
        if (btn.dataset.action === 'dec') changeQty(id, -1);
        if (btn.dataset.action === 'remove') removeFromCart(id);
      });
    });
  }

  cartTotalEl.textContent = `$${cartTotal().toFixed(2)}`;
}

function setCheckoutMessage(text, type) {
  checkoutMessage.textContent = text;
  checkoutMessage.className = `checkout-message ${type || ''}`;
}

async function init() {
  try {
    const [productsRes, configRes] = await Promise.all([
      fetch(`${API_BASE}/api/products`).then((r) => r.json()),
      fetch(`${API_BASE}/api/config`).then((r) => r.json()),
    ]);
    PRODUCTS = productsRes;
    renderProducts();
    renderCart();
    loadPayPalSdk(configRes.clientId);
  } catch (err) {
    console.error(err);
    productGrid.innerHTML = '<p class="loading">Could not load products. Is the backend running?</p>';
  }
}

function loadPayPalSdk(clientId) {
  if (!clientId) {
    setCheckoutMessage('PayPal is not configured yet (missing client ID on server).', 'error');
    return;
  }
  const script = document.createElement('script');
  // enable-funding=venmo surfaces Venmo as a payment option for eligible US buyers,
  // right alongside the PayPal button, with no separate integration needed.
  script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&components=buttons&enable-funding=venmo`;
  script.onload = renderPayPalButtons;
  script.onerror = () => setCheckoutMessage('Could not load PayPal checkout.', 'error');
  document.body.appendChild(script);
}

function renderPayPalButtons() {
  if (!window.paypal) return;

  window.paypal.Buttons({
    style: { layout: 'vertical', color: 'gold', shape: 'rect', label: 'paypal' },

    createOrder: async () => {
      setCheckoutMessage('');
      const items = Object.entries(cart).map(([id, qty]) => ({ id, qty }));
      if (items.length === 0) {
        setCheckoutMessage('Your cart is empty.', 'error');
        return Promise.reject(new Error('Empty cart'));
      }
      const res = await fetch(`${API_BASE}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCheckoutMessage(data.error || 'Could not start checkout.', 'error');
        throw new Error(data.error || 'Order creation failed');
      }
      return data.id;
    },

    onApprove: async (data) => {
      const res = await fetch(`${API_BASE}/api/orders/${data.orderID}/capture`, {
        method: 'POST',
      });
      const details = await res.json();
      if (!res.ok) {
        setCheckoutMessage('Payment could not be captured. Please try again.', 'error');
        return;
      }
      cart = {};
      saveCart();
      setCheckoutMessage('Payment successful! Thank you for your order.', 'success');
    },

    onCancel: () => {
      setCheckoutMessage('Checkout was cancelled.', '');
    },

    onError: (err) => {
      console.error(err);
      setCheckoutMessage('Something went wrong during checkout.', 'error');
    },
  }).render('#paypal-button-container');
}

init();
