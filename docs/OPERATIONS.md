# OPERATIONS.md — Accounts, Billing, and Recovery Runbook

The "where is everything" file. Update this whenever an account, plan, or URL changes.
(No passwords or API keys in here — those live in password manager / .env files.)

## Accounts & services

| What | Provider | Account / login hint | Notes |
|---|---|---|---|
| Domain `playsluff.com` | **Squarespace Domains** (migrated from Google Domains) | Likely Google sign-in at account.squarespace.com | Registered 2025-07-25, **paid through 2030-07-25**. June 2026: on `clientHold` — verify contact email / account standing to reactivate. Nameservers: Google Cloud DNS. |
| Frontend hosting | **Netlify** | _fill in account email_ | Auto-deploys from `main` on GitHub. Config in `netlify.toml`. |
| Backend hosting | **Render** | _fill in account email_ | Web service `sluff-backend-pilot` (+ check for other services!). June 2026: suspended, 3 unpaid invoices; was billing ~$508/mo — see Billing history below. |
| Database | **Render PostgreSQL** | same Render account | `POSTGRES_CONNECT_STRING` env var on the backend service. Free-tier Postgres is deleted after 90 days of nonpayment/expiry. |
| Email (transactional) | **SendGrid** | _fill in account email_ | Sends as noreply@playsluff.com. `SENDGRID_API_KEY` env var. |
| Source code | **GitHub** | mmcmillan1999/sluff-project | `main` = deploy branch, `Local_Dev` = dev branch. |
| AI providers (bot brains) | OpenAI, Anthropic, Google AI Studio, Groq | _fill in account emails_ | Keys in backend/.env locally and Render env vars in prod. |

## URLs

- Production frontend: https://playsluff.com (Netlify, custom domain)
- Production backend: https://api.playsluff.com (custom domain → Render)
- Render direct: https://sluff-backend-pilot.onrender.com
- Health check: `GET /health` (DB-aware), `GET /api/ping`

## Billing history & lessons (June 2026)

- Render billed **~$500/month from Aug 2025 through May 2026 (~$5,500 total)**, including months when the site was unused. Three invoices (Dec 2025, Jan 2026, Mar 2026) went unpaid → service suspended.
- **Lesson: a friends-and-family app needs ~$15/mo on Render** (Starter web service ~$7 + smallest Postgres ~$6–7). Check the workspace for extra services, oversized instance types, autoscaling, and preview environments. Review the first invoice after any change.
- Set a calendar reminder: review Render + Squarespace + SendGrid billing every 6 months.

## Recovery runbook (site is down — do these in order)

1. **Backend up?** `curl https://sluff-backend-pilot.onrender.com/health` — 503 with `x-render-routing: suspend` header = Render suspended the service (billing). Render dashboard → resume.
2. **Domain resolving?** `nslookup playsluff.com` — NXDOMAIN = registrar problem (Squarespace; check for clientHold / verification emails), since registration is paid through 2030.
3. **Frontend up?** Check the `.netlify.app` URL in the Netlify dashboard; if it works but the domain doesn't, it's DNS/registrar, not Netlify.
4. **DB alive?** `/health` returns `db: "down"` → check the Render Postgres instance and `POSTGRES_CONNECT_STRING`. Schema self-creates on boot (`backend/src/data/createTables.js`); a new empty DB "just works" but loses accounts/history.
5. **Bots broken?** `cd backend && node scripts/smoke-test-ai.js` — tests all four AI providers live.

## Deploy process

- Push/merge to `main` → Netlify builds frontend automatically (Vite, Node 22).
- Render deploys backend from `main` (`npm start`) — verify auto-deploy setting in Render.
- No CI; run `npm test` in both `frontend/` and `backend/` before merging to `main`.
