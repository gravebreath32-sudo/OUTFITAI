# OutfitAI

A responsive, local-first MVP for a personal wardrobe and outfit stylist. The project intentionally runs with Node.js built-ins only; it does not require a package install.

## Project structure

```text
server.js             HTTP API, local JSON persistence, password hashing, sessions
package.json          Start and smoke-test commands
render.yaml           Render web service + persistent disk blueprint
.gitignore             Local data and secret exclusions
public/index.html     App shell
public/styles.css     Responsive design system and screen styles
public/app.js         Client UI and API interactions
data/store.json       Created on first write; local account and wardrobe data
tests/smoke.js        End-to-end API smoke test
```

## Data model

The local store contains four collections. IDs are UUIDs and user-owned records carry a `userId` foreign-key equivalent. Every read and mutation of a private collection is scoped to the authenticated user's session.

- **users**: `id`, `name`, `email`, `salt`, `passwordHash`, `preferences`, `createdAt`
- **items**: `id`, `userId`, `name`, `category`, `color`, `style`, `season`, `occasion`, `brand`, `image`, `favorite`, `wears`, `createdAt`
- **outfits**: `id`, `userId`, `name`, `itemIds[]`, `score`, `why`, `colorNote`, `tip`, `occasion`, `weather`, `savedAt`
- **plans**: `id`, `userId`, `outfitId`, `title`, `date`, `occasion`, `notes`

Passwords are stored as salted scrypt hashes. The session token is random, held server-side, and delivered in an HttpOnly, SameSite cookie. The local JSON file and uploaded images are not a production storage service: deploy with a transactional database, durable session store, private object storage, TLS, CSRF controls, rate limits, and account recovery provider before serving real users.

## Run locally

Requires Node.js 18 or newer.

```sh
node server.js
```

Then open [http://localhost:3000](http://localhost:3000). Set `PORT` to change the port. Create an account in the app and add at least two wardrobe pieces before generating outfits. Data is stored in `data/store.json`. Remove that file to reset the local demo data.

## Free preview on Render

The included `render.yaml` configures a free Node web service with a health check and HTTPS-secure session cookies. `autoDeploy: false` disables future automatic deploys on repository changes.

1. Put the contents of this folder in a GitHub repository (do not upload `data/store.json` or secrets).
2. In Render, choose **New → Blueprint**, connect the repository, and review the Blueprint.
3. Create the free service. Render will show the public `onrender.com` URL when it is live.

Free services spin down after 15 minutes without traffic, and their filesystem is ephemeral. This app's JSON data may be lost when the service restarts or deploys; sessions also reset. Use this only as a public preview with test data, not real wardrobe photos or personal account data. For persistent real-user data, move accounts, wardrobe records, and uploaded images to Supabase Auth, Postgres with Row Level Security, and private Storage before launch. Do not put API secrets in the browser or commit `.env` files.

## MVP behavior and boundaries

- Sign up, sign in, sign out, and account deletion work locally. Password recovery displays an honest unavailable message because no mail provider is configured.
- Wardrobe items support image uploads (5 MB limit), category, color, style, season, brand, edit, search, category filters, sort, favorites, and removal.
- The outfit studio creates three combinations from the signed-in user's actual closet with understandable matching notes. This is a deterministic local wardrobe-rules engine, **not a live AI service**. It does not invent live weather; weather can be selected manually.
- Saved outfits can be planned on the calendar. Inspiration photos are editorial references from Unsplash and are not presented as wardrobe photos.
- Premium, billing, real weather, multimodal recognition, and real AI chat are not connected. There are no fake payment or AI success flows.

## Environment variables

No secrets or external API keys are required. `PORT` is optional. If AI, email recovery, weather, or payments are added, keep provider keys server-side in environment variables and validate every request on the server.

## Smoke test

```sh
node tests/smoke.js
```

The test starts an isolated server on a temporary port and verifies account creation, private wardrobe access, item creation, three outfit recommendations using owned items, saved outfit access, and logout. It removes its temporary store afterward.
