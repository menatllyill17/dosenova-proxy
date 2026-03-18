const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const multer = require('multer');
const FormData = require('form-data');
const Stripe = require('stripe');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

app.use(cors());
app.use(express.json({ limit: '20mb' }));

// ─── Rate limiting ────────────────────────────────────────────────────────────
// In-memory store: { ip: { count, resetAt } }
// Limits: 30 Claude calls / hour, 10 Whisper calls / hour per IP
const rateLimits = {};

function checkRate(ip, type) {
  const limits = { claude: 30, whisper: 10 };
  const key = `${ip}:${type}`;
  const now = Date.now();
  if (!rateLimits[key] || now > rateLimits[key].resetAt) {
    rateLimits[key] = { count: 0, resetAt: now + 60 * 60 * 1000 }; // 1 hour window
  }
  rateLimits[key].count++;
  if (rateLimits[key].count > limits[type]) {
    const resetMins = Math.ceil((rateLimits[key].resetAt - now) / 60000);
    return { limited: true, resetMins };
  }
  return { limited: false };
}

// Clean up old entries every 30 minutes to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const key in rateLimits) {
    if (now > rateLimits[key].resetAt) delete rateLimits[key];
  }
}, 30 * 60 * 1000);

function getIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
}

// ─── Routes ──────────────────────────────────────────────────────────────────

app.get('/', (req, res) => res.send('Dosenova proxy running ✅'));

// Claude AI
app.post('/api/claude', async (req, res) => {
  const ip = getIP(req);
  const rate = checkRate(ip, 'claude');
  if (rate.limited) {
    return res.status(429).json({ error: { message: `Too many requests. Try again in ${rate.resetMins} minutes.` } });
  }
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('Claude error:', err);
    res.status(500).json({ error: { message: 'Proxy error: ' + err.message } });
  }
});

// Whisper transcription
app.post('/api/whisper', upload.single('file'), async (req, res) => {
  const ip = getIP(req);
  const rate = checkRate(ip, 'whisper');
  if (rate.limited) {
    return res.status(429).json({ error: `Too many requests. Try again in ${rate.resetMins} minutes.` });
  }
  try {
    const form = new FormData();
    form.append('file', req.file.buffer, { filename: 'audio.webm', contentType: req.file.mimetype });
    form.append('model', 'whisper-1');
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, ...form.getHeaders() },
      body: form,
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('Whisper error:', err);
    res.status(500).json({ error: 'Transcription failed: ' + err.message });
  }
});

// Stripe checkout
app.post('/api/create-checkout', async (req, res) => {
  const { priceId, plan } = req.body;
  if (!priceId) return res.status(400).json({ error: 'Missing priceId' });
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { trial_period_days: 3 },
      success_url: 'https://darling-dango-f19097.netlify.app?pro=true',
      cancel_url: 'https://darling-dango-f19097.netlify.app?cancelled=true',
      metadata: { plan: plan || 'unknown' },
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Dosenova proxy on port ${PORT}`));
