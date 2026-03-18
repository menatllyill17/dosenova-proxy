# Dosenova — Medicine Safety, Simplified

**AI-powered medication companion for elderly users and their families.**

> Take the right medicine at the right time — and let someone you trust know if you don't.

---

## ✨ The Peace-of-Mind Feature: Dosenova Pulse

**Dosenova Pulse** is the feature that makes Dosenova different from every other pill reminder app.

When a user misses a dose, Dosenova doesn't just log it — it sends a real-time alert to up to 3 caregivers via WhatsApp, SMS, or email. Caregivers can also check a **live shareable Pulse link** at any time to see exactly which doses were taken today, which were missed, and when.

No app install required for caregivers. No account. Just a link.

This is the "peace of mind" feature for families managing medications across distance. A daughter in London can check if her mother in Edinburgh took her morning tablets — without calling and worrying her.

---

## Features

| Feature | Description |
|---|---|
| 📸 Pill scan | Claude Vision reads the label and identifies the medicine |
| ⏰ Smart reminders | AI reads dosing instructions and pre-sets the schedule |
| 💊 Medicine cabinet | Full drug info, interactions, safety level |
| 🔗 Dosenova Pulse | Shareable caregiver status link — no app needed |
| 📲 Caregiver alerts | WhatsApp/SMS/email alerts on missed doses |
| 🩺 Doctor scribe | Records appointments and generates plain-English summaries |
| 🥗 Food scanner | Checks food barcodes for medication interactions |
| 📊 Health tracking | Blood pressure, blood sugar, weight, mood |
| 🔍 Label magnifier | Freeze + pinch-zoom for small print |
| ☁️ Cloud backup | Supabase sync — restore on any device |

---

## Stack

- **Frontend**: Single `index.html` — vanilla JS, no framework, offline-first
- **AI**: Anthropic Claude (Haiku) for pill scan, interactions, health insights, chat
- **Transcription**: OpenAI Whisper for doctor scribe
- **Auth + DB**: Supabase (magic link + Google OAuth, RLS-enabled)
- **Payments**: Stripe (monthly + yearly, 3-day free trial)
- **Proxy**: Node.js on Render — rate-limited, keys never exposed to client
- **Hosting**: Netlify

---

## Architecture

```
User (Netlify) → Render Proxy → Anthropic / OpenAI / Stripe
                      ↓
               Supabase (auth + cloud sync)
```

All API keys live on Render as environment variables. The frontend never touches them directly.

---

## Pricing

| Plan | Price |
|---|---|
| Free | 3 scans, core reminders |
| Monthly Pro | $3.99/month (3-day free trial) |
| Yearly Pro | $24.99/year — save 48% |

---

## Running locally

Clone and open `index.html` in a browser. For AI features, you need the proxy running:

```bash
cd safedose-proxy
npm install
ANTHROPIC_API_KEY=... OPENAI_API_KEY=... STRIPE_SECRET_KEY=... node server.js
```

Update `PROXY_URL` in `index.html` to `http://localhost:3000/api/claude`.

---

## Legal

- Privacy Policy, Terms of Service, and Medical Disclaimer live at `/legal.html`
- AI outputs are for informational purposes only — not a substitute for professional medical advice
- GDPR compliant — user data stored in EU Supabase region, deletion on request

---

*Built for the people who need it most — and the families who worry about them.*
