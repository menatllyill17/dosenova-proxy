// ═══════════════════════════════════════════════════════════════
// DOSENOVA PROXY SERVER — Complete server.js for Render
// ═══════════════════════════════════════════════════════════════
//
// ENV VARS NEEDED (set in Render Dashboard → Environment):
//   ANTHROPIC_API_KEY     — your Anthropic API key
//   OPENAI_API_KEY        — your OpenAI API key (for Whisper)
//   STRIPE_SECRET_KEY     — your Stripe secret key (sk_live_...)
//   STRIPE_WEBHOOK_SECRET — Stripe Dashboard → Webhooks → Signing secret
//   REVIEW_CODES          — comma-separated reviewer codes, e.g. "REVIEW2025,PRESS2025"
//
// DEPLOY:
//   1. Replace your existing server.js in the safedose-proxy repo with this file
//   2. Commit & push — Render auto-deploys
//   3. Set up Stripe webhook:
//      Stripe Dashboard → Developers → Webhooks → Add endpoint
//      URL: https://safedose-proxy.onrender.com/api/stripe-webhook
//      Events: checkout.session.completed, customer.subscription.updated,
//              customer.subscription.deleted, invoice.payment_failed
//
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const FormData = require('form-data');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// ── Stripe must be initialized before routes ──
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// ═══════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════

// IMPORTANT: Stripe webhook needs raw body — register BEFORE express.json()
app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), handleStripeWebhook);

// Now apply JSON parsing for all other routes
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ═══════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'dosenova-proxy', version: '2.0' });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ═══════════════════════════════════════
// ANTHROPIC CLAUDE PROXY
// ═══════════════════════════════════════
app.post('/api/claude', async (req, res) => {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: { message: 'ANTHROPIC_API_KEY not configured' } });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error('Claude proxy error:', err.message);
    res.status(500).json({ error: { message: 'Proxy error: ' + err.message } });
  }
});

// ═══════════════════════════════════════
// OPENAI WHISPER PROXY (doctor scribe)
// ═══════════════════════════════════════
app.post('/api/whisper', upload.single('file'), async (req, res) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

    if (!req.file) return res.status(400).json({ error: 'No audio file provided' });

    const form = new FormData();
    form.append('file', req.file.buffer, {
      filename: req.file.originalname || 'appointment.webm',
      contentType: req.file.mimetype || 'audio/webm',
    });
    form.append('model', req.body.model || 'whisper-1');
    if (req.body.language) form.append('language', req.body.language);

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        ...form.getHeaders(),
      },
      body: form,
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error('Whisper proxy error:', err.message);
    res.status(500).json({ error: 'Whisper proxy error: ' + err.message });
  }
});

// ═══════════════════════════════════════
// STRIPE — Create Checkout Session
// ═══════════════════════════════════════
app.post('/api/create-checkout', async (req, res) => {
  try {
    const { priceId, plan, email } = req.body;

    // Whitelist valid price IDs — never trust client-sent IDs blindly
    const VALID_PRICES = {
      'price_1T8VLEHg8oM0VdWoP5gkup1o': 'monthly',
      'price_1T8VM1Hg8oM0VdWoJRsO0Myz': 'yearly',
    };

    if (!VALID_PRICES[priceId]) {
      return res.status(400).json({ error: 'Invalid price ID' });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      // ✅ 3-day free trial
      subscription_data: {
        trial_period_days: 3,
      },
      success_url: `${req.headers.origin || 'https://darling-dango-f19097.netlify.app'}?session_id={CHECKOUT_SESSION_ID}&pro=1`,
      cancel_url: `${req.headers.origin || 'https://darling-dango-f19097.netlify.app'}?canceled=1`,
      ...(email ? { customer_email: email } : {}),
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════
// STRIPE — Server-side Pro Verification
// ═══════════════════════════════════════
// This is the critical security endpoint.
// The client calls this to verify pro status instead of
// trusting localStorage (which anyone can edit in DevTools).

app.post('/api/verify-pro', async (req, res) => {
  try {
    const { sessionId, email } = req.body;

    // Method 1: Verify by Stripe checkout session ID (right after payment)
    if (sessionId) {
      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['subscription'],
      });

      if (!session || !session.subscription) {
        return res.json({ isPro: false, reason: 'no_subscription' });
      }

      const sub = typeof session.subscription === 'string'
        ? await stripe.subscriptions.retrieve(session.subscription)
        : session.subscription;

      const active = ['active', 'trialing'].includes(sub.status);
      return res.json({
        isPro: active,
        status: sub.status,
        trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
        currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
        customerId: session.customer,
      });
    }

    // Method 2: Verify by customer email (on app load / sign in)
    if (email) {
      const customers = await stripe.customers.list({ email, limit: 1 });
      if (customers.data.length === 0) {
        return res.json({ isPro: false, reason: 'no_customer' });
      }

      const customer = customers.data[0];
      const subscriptions = await stripe.subscriptions.list({
        customer: customer.id,
        status: 'all',
        limit: 5,
      });

      const activeSub = subscriptions.data.find(s =>
        ['active', 'trialing'].includes(s.status)
      );

      if (!activeSub) {
        return res.json({ isPro: false, reason: 'no_active_sub' });
      }

      return res.json({
        isPro: true,
        status: activeSub.status,
        trialEnd: activeSub.trial_end ? new Date(activeSub.trial_end * 1000).toISOString() : null,
        currentPeriodEnd: new Date(activeSub.current_period_end * 1000).toISOString(),
        customerId: customer.id,
      });
    }

    res.json({ isPro: false, reason: 'no_identifier' });
  } catch (err) {
    console.error('Verify-pro error:', err.message);
    // Fail closed — don't grant pro on error
    res.status(500).json({ isPro: false, error: err.message });
  }
});

// ═══════════════════════════════════════
// STRIPE — Webhook for subscription lifecycle
// ═══════════════════════════════════════
// Registered at the top of this file BEFORE express.json()

async function handleStripeWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.warn('⚠️  STRIPE_WEBHOOK_SECRET not set — webhook disabled');
    return res.status(200).json({ received: true, warning: 'webhook secret not configured' });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      console.log(`✅ Checkout completed: ${session.customer_email || session.customer}`);
      break;
    }
    case 'customer.subscription.updated': {
      const sub = event.data.object;
      console.log(`📋 Subscription ${sub.id} → ${sub.status}`);
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      console.log(`❌ Subscription ${sub.id} cancelled`);
      break;
    }
    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      console.log(`⚠️ Payment failed: customer ${invoice.customer}`);
      break;
    }
    default:
      console.log(`Unhandled webhook: ${event.type}`);
  }

  res.json({ received: true });
}

// ═══════════════════════════════════════
// REVIEWER CODE VALIDATION
// ═══════════════════════════════════════
app.post('/api/validate-code', (req, res) => {
  const { code } = req.body;
  if (!code) return res.json({ valid: false });

  const validCodes = (process.env.REVIEW_CODES || '')
    .split(',')
    .map(c => c.trim().toUpperCase())
    .filter(Boolean);

  if (validCodes.length === 0) {
    console.warn('⚠️  REVIEW_CODES env var not set — no codes active');
    return res.json({ valid: false });
  }

  const valid = validCodes.includes(code.trim().toUpperCase());
  if (valid) console.log(`🔓 Reviewer code used: ${code} at ${new Date().toISOString()}`);
  res.json({ valid });
});

// ═══════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Dosenova proxy running on port ${PORT}`);
  console.log(`   Anthropic API: ${process.env.ANTHROPIC_API_KEY ? '✅ configured' : '❌ missing'}`);
  console.log(`   OpenAI API:    ${process.env.OPENAI_API_KEY ? '✅ configured' : '❌ missing'}`);
  console.log(`   Stripe:        ${process.env.STRIPE_SECRET_KEY ? '✅ configured' : '❌ missing'}`);
  console.log(`   Webhook:       ${process.env.STRIPE_WEBHOOK_SECRET ? '✅ configured' : '⚠️  not set (webhook disabled)'}`);
  console.log(`   Review codes:  ${process.env.REVIEW_CODES ? '✅ configured' : '⚠️  not set'}`);
});
