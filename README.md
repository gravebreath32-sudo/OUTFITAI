# OutfitAI

A responsive personal wardrobe and outfit styling MVP. It runs with Node.js built-ins and can use Supabase Auth, Postgres, and private Storage for persistent accounts, wardrobe data, saved outfits, plans, and clothing photos.

## Project structure

```text
server.js                         HTTP API and local demo-mode fallback
supabase-provider.js              Server-side Supabase Auth, Postgres, and Storage adapter
supabase/migrations/001_outfitai.sql  Tables, Row Level Security, and private image bucket
supabase/migrations/002_billing.sql  Optional billing orders, entitlements, and usage limits
supabase/migrations/003_billing_atomic_fulfillment.sql  Idempotent paid-pass fulfillment
render.yaml                       Render free web service blueprint
public/index.html                 App shell
public/styles.css                 Responsive design system
public/app.js                     UI and API interactions
tests/smoke.js                    Local API smoke test
```

## Data model

Supabase Auth owns account credentials and user IDs. The migration creates:

- `profiles`: name, email, and saved style preferences.
- `wardrobe_items`: item metadata and private Storage object paths.
- `saved_outfits` and `outfit_items`: saved looks and item relationships.
- `outfit_plans`: calendar entries related to saved outfits.
- A private `wardrobe` Storage bucket for clothing photos.
- Optional Razorpay order verification and a manually renewed 30-day Plus pass.

Row Level Security restricts each row and photo path to its owner. Normal database and image requests use the signed-in user's token. The server-only Supabase secret is used only for account deletion; never expose it in the browser.

## Connect persistent storage

1. Create a Supabase account and a project.
2. In Supabase **SQL Editor**, run [`supabase/migrations/001_outfitai.sql`](supabase/migrations/001_outfitai.sql).
3. In Supabase **Project Settings → API**, copy the Project URL, publishable key, and secret key.
4. In Render, open the `outfitai` service → **Environment**. Set:
   - `SUPABASE_URL` to the Project URL.
   - `SUPABASE_PUBLISHABLE_KEY` to the publishable key.
   - `SUPABASE_SECRET_KEY` to the secret key. Keep this server-side; do not send it in chat or commit it.
5. Save changes and deploy the latest commit. Check `/api/config`; `{ "mode": "persistent" }` confirms the server is using Supabase.
6. In Supabase **Authentication → URL Configuration**, set the Site URL to `https://outfitai-qdjf.onrender.com` and add `https://outfitai-qdjf.onrender.com/` to the redirect URL allowlist. Keep email confirmation enabled and configure email delivery before inviting real users.

Until all three environment values and the migration are set, the app explicitly shows **Demo mode** and stores data in local JSON. Existing demo accounts and wardrobe records do not automatically transfer to Supabase; users should create new accounts after switching modes.

## Free preview limits

Render's free filesystem is ephemeral, so local demo-mode data can disappear on restart or deploy. Supabase Free stores data independently of Render deploys, but free projects can pause after a week of low activity, have usage limits, and do not include downloadable database backups. Restore a paused project in Supabase Studio. This is suitable for a small preview, not a durability guarantee for a production business. Keep independent exports and upgrade to a plan with backups before relying on real customer data.

## Run locally

Requires Node.js 20 or newer.

```sh
node server.js
```

Without Supabase environment variables, the app runs in clearly labeled local demo mode. To run against Supabase, set the three variables from `.env.example` in your shell, apply the migration, and start the server. Do not commit `.env`.

## MVP behavior and boundaries

- Supabase Auth handles account creation, sign-in, session refresh, email confirmation, password recovery, and account deletion when configured.
- Wardrobe items support image uploads, categories, color, style, season, brand, edit, search, filters, favorites, and removal.
- Outfit generation is a deterministic wardrobe-rules engine. It uses only the signed-in user's saved wardrobe and is not represented as a live AI service.
- Saved outfits can be planned on the calendar. Weather is not fabricated; choose conditions manually when needed.
- Inspiration photos are editorial references and are not presented as wardrobe photos. Real weather and multimodal image recognition are not connected.

## Optional paid plan

The app includes a **₹149 / 30-day OutfitAI Plus pass** scaffold. It is a one-time payment and does not renew automatically. The free plan stays useful; Plus raises the wardrobe limit from 50 to 500 items and removes the five-per-day outfit generation cap. Payment is off until the steps below are completed. Test with Razorpay test keys first; test payments do not collect real money.

1. Create and activate a Razorpay merchant account yourself. Complete any identity/business checks Razorpay requests. Never share its keys in chat or commit them.
2. In Supabase SQL Editor, run [`supabase/migrations/002_billing.sql`](supabase/migrations/002_billing.sql) and then [`supabase/migrations/003_billing_atomic_fulfillment.sql`](supabase/migrations/003_billing_atomic_fulfillment.sql) after migration 001.
3. In the Render service's Environment page, add `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and a long random `RAZORPAY_WEBHOOK_SECRET`. Use test keys first.
4. In Razorpay test-mode Webhooks, add `https://outfitai-qdjf.onrender.com/api/billing/webhook` and subscribe to the `payment.captured` event. Put the same webhook secret in Render.
5. Set `OUTFITAI_BILLING_ENABLED=true` only after the migration, webhook, and keys are in place; then deploy/restart the service.
6. Test a full checkout and verify the Plus expiry before switching to live Razorpay keys. The server checks Razorpay's checkout signature, confirms a captured payment with Razorpay, and accepts signed `payment.captured` webhooks before granting 30 days. Fulfillment is atomic and idempotent, so duplicate webhooks do not add extra days. A browser response alone never activates the plan.

Razorpay checkout and database setup are required before the app can collect money. Without them the UI clearly reports setup is pending and requests no payment. The ₹149 price is a placeholder and can be changed in `supabase-provider.js` and migration 003 before launch. Seven customers paying ₹149 would mean ₹1,043 gross for that 30-day period, before gateway fees, taxes, refunds, and operating costs; revenue is not guaranteed.

## Smoke test

```sh
npm test
```

The provider smoke test uses a mocked Supabase API and needs no credentials. The local end-to-end test starts an isolated server and verifies sign-up, private wardrobe access, adding an item, outfit generation, saving, and logout.


