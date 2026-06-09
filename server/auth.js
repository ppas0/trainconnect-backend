const jwt    = require('jsonwebtoken');
const Stripe = require('stripe');

const JWT_SECRET = process.env.JWT_SECRET || 'trainconnect-v2-secret-2026-longkey-xyz';

// Stripe initialisation – key must be set in .env
const stripe = process.env.STRIPE_SECRET_KEY
  ? Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

// ── JWT Middleware ────────────────────────────────────────────────────────────
function authenticate(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Nicht angemeldet' });
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token ungültig oder abgelaufen' });
  }
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Kein Zugriff' });
  next();
}

// ── Payment Method Config ────────────────────────────────────────────────────
const PAYMENT_METHODS = {
  card:        { label: 'Kreditkarte',          icon: '💳', provider: 'stripe',   enabled: true },
  paypal:      { label: 'PayPal',               icon: '🅿️', provider: 'paypal',   enabled: true },
  apple_pay:   { label: 'Apple Pay',            icon: '🍎', provider: 'stripe',   enabled: true },
  google_pay:  { label: 'Google Pay',           icon: '🟢', provider: 'stripe',   enabled: true },
  twint:       { label: 'TWINT',                icon: '🇨🇭', provider: 'twint',    enabled: true },
  sepa:        { label: 'SEPA Banküberweisung', icon: '🏦', provider: 'stripe',   enabled: true },
  crypto_btc:  { label: 'Bitcoin (BTC)',        icon: '₿',  provider: 'coinbase', enabled: true },
  crypto_eth:  { label: 'Ethereum (ETH)',       icon: '⟠',  provider: 'coinbase', enabled: true },
  crypto_usdt: { label: 'USDT (Tether)',        icon: '💵', provider: 'coinbase', enabled: true },
  klarna:      { label: 'Klarna',               icon: '🛍️', provider: 'klarna',   enabled: true },
  sofort:      { label: 'Sofort',               icon: '⚡', provider: 'klarna',   enabled: true },
  stripe:      { label: 'Stripe',               icon: '💠', provider: 'stripe',   enabled: true },
};

// ── Stripe Payment Processing ─────────────────────────────────────────────────
//
// Flow:
//   Frontend creates a PaymentIntent via POST /api/payments/intent
//   → receives clientSecret
//   → confirms payment with stripe.js (card element / Apple Pay / Google Pay / SEPA)
//   → on success calls POST /api/checkout with paymentIntentId
//   Backend confirms the PaymentIntent is succeeded before issuing ticket
//
// For SEPA Debit the frontend uses stripe.confirmSepaDebitPayment().

async function createPaymentIntent({ amount, currency = 'EUR', method, userId, metadata = {} }) {
  if (!stripe) {
    // Dev fallback when STRIPE_SECRET_KEY is not set
    console.warn('[Stripe] STRIPE_SECRET_KEY nicht gesetzt – Simulation aktiv');
    return {
      clientSecret: `pi_sim_${Date.now()}_secret_sim`,
      paymentIntentId: `pi_sim_${Date.now()}`,
      simulated: true,
    };
  }

  const amountCents = Math.round(amount * 100); // Stripe works in smallest currency unit

  // Map payment methods to Stripe payment_method_types
  const methodTypeMap = {
    card:       ['card'],
    apple_pay:  ['card'],        // Apple Pay goes through the card element
    google_pay: ['card'],        // Google Pay goes through the card element
    sepa:       ['sepa_debit'],
    sofort:     ['sofort'],
    klarna:     ['klarna'],
    stripe:     ['card'],
  };
  const paymentMethodTypes = methodTypeMap[method] || ['card'];

  const intent = await stripe.paymentIntents.create({
    amount:               amountCents,
    currency:             currency.toLowerCase(),
    payment_method_types: paymentMethodTypes,
    metadata: {
      userId:   String(userId),
      platform: 'trainconnect-europe',
      ...metadata,
    },
    // Automatic receipt email (optional – enable in Stripe Dashboard)
    // receipt_email: metadata.userEmail,
  });

  return {
    clientSecret:    intent.client_secret,
    paymentIntentId: intent.id,
    simulated:       false,
  };
}

async function confirmPayment(paymentIntentId) {
  if (!stripe || paymentIntentId.startsWith('pi_sim_')) {
    // Dev fallback
    return {
      paymentId: paymentIntentId,
      provider:  'stripe-simulation',
      status:    'succeeded',
    };
  }

  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);

  if (intent.status !== 'succeeded') {
    throw new Error(`Zahlung nicht abgeschlossen (Status: ${intent.status})`);
  }

  return {
    paymentId: intent.id,
    provider:  'stripe',
    amount:    intent.amount / 100,
    currency:  intent.currency.toUpperCase(),
    status:    intent.status,
  };
}

// Legacy single-call helper (used by routes.js POST /api/checkout)
// In a full Stripe integration the frontend confirms the payment;
// this fallback is kept for server-side confirmation or simulation.
async function processPayment({ method, amount, currency, userId }) {
  const provider = PAYMENT_METHODS[method]?.provider || 'stripe';

  if (provider === 'stripe' && stripe) {
    // Server-side confirmation path (use only for server-to-server flows)
    // In the frontend-confirmation flow, call createPaymentIntent() instead
    // and confirm via confirmPayment() after the client returns.
    const { paymentIntentId } = await createPaymentIntent({ amount, currency, method, userId });
    // For server-side test mode, a PaymentIntent in 'requires_payment_method' status
    // would need a test payment method attached. We confirm here only in test mode.
    if (process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) {
      // Attach a test card and confirm in test mode
      const testPM = await stripe.paymentMethods.create({
        type: 'card',
        card: { token: 'tok_visa' },
      });
      await stripe.paymentIntents.confirm(paymentIntentId, {
        payment_method: testPM.id,
      });
    }
    return await confirmPayment(paymentIntentId);
  }

  // Non-Stripe providers (PayPal, TWINT, Coinbase, Klarna) – still simulated
  // TODO: replace with real SDK calls per provider
  await new Promise(r => setTimeout(r, 200));
  if (Math.random() < 0.03) throw new Error('Zahlung abgelehnt – bitte andere Methode versuchen');
  return {
    paymentId: `${provider.toUpperCase()}-${Date.now()}-${Math.random().toString(36).slice(2,8).toUpperCase()}`,
    provider, amount, currency, status: 'completed',
  };
}

module.exports = {
  authenticate,
  adminOnly,
  JWT_SECRET,
  PAYMENT_METHODS,
  processPayment,
  createPaymentIntent,
  confirmPayment,
};
