# OPERATIONS.md — Accounts, Billing, and Recovery Runbook

The "where is everything" file. Update this whenever an account, plan, or URL changes.
(No passwords or API keys in here — those live in password manager / .env files.)

## Accounts & services

| What | Provider | Account / login hint | Notes |
|---|---|---|---|
| Domain `playsluff.com` | **Squarespace Domains** (migrated from Google Domains) | Likely Google sign-in at account.squarespace.com | Registered 2025-07-25, **paid through 2030-07-25**. June 2026: on `clientHold` — verify contact email / account standing to reactivate. Nameservers: Google Cloud DNS. |
| Frontend hosting | **Netlify** (new acct, June 2026) | mmcmillan1999 / team "abc" | Site **playsluff.netlify.app**, auto-deploys `main`, env var `VITE_SERVER_URL` set. OLD account (site "sluff") is locked for non-payment — support contacted/owed balance TBD. |
| Backend hosting | **Render** | _fill in account email_ | Web service `sluff-backend-pilot` (+ check for other services!). June 2026: suspended, 3 unpaid invoices; was billing ~$508/mo — see Billing history below. |
| Database | **Render PostgreSQL** | same Render account | `POSTGRES_CONNECT_STRING` env var on the backend service. Free-tier Postgres is deleted after 90 days of nonpayment/expiry. |
| Email (transactional) | **Resend** (primary) / SendGrid (legacy fallback) | _fill in account email_ | Sends as noreply@playsluff.com. `RESEND_API_KEY` env var (preferred); falls back to `SENDGRID_API_KEY` only if Resend isn't set. **June 2026: switched to Resend after SendGrid ran out of credits. `playsluff.com` re-verified in Resend (needs SPF/DKIM DNS records live) — registration verification + password-reset emails working again.** If sends start 403'ing, re-check domain verification at resend.com/domains. |
| Source code | **GitHub** | mmcmillan1999/sluff-project | `main` = deploy branch, `Local_Dev` = dev branch. |
| AI providers (bot brains) | OpenAI, Anthropic, Google AI Studio, Groq | _fill in account emails_ | Keys in backend/.env locally and Render env vars in prod. |

## URLs

- Production frontend: https://playsluff.com (Netlify, custom domain)
- Production backend: https://api.playsluff.com (custom domain → Render)
- Render direct: https://sluff-backend-pilot.onrender.com
- Health check: `GET /health` (DB-aware), `GET /api/ping`

## Billing history & lessons (June 2026)

- Render billed **~$500/month from Aug 2025 through May 2026 (~$5,500 total)**, including months when the site was unused. Three invoices (Dec 2025, Jan 2026, Mar 2026) went unpaid → workspace suspended (DB included).
- **Root cause (May 2026 invoice CSV): `sluff-backend` was on a "Pro Ultra" instance at $0.6048/hr = ~$394/mo.** The fix is one dropdown: downsize to Starter (~$7/mo).
- Render workspace inventory (May 2026): `sluff-backend` (prod, Pro Ultra — DOWNSIZE), `sluff-backend-pilot` (staging, Starter $6), `Mosaic` (Standard $22 — separate project, not sluff), `SOTOS` (Starter $6 — separate project, not sluff), `sluff-db` (Postgres Basic-1gb, ~$17 — holds ALL game data; servers hold none).
- **Lesson: a friends-and-family app needs ~$15–25/mo on Render.** Review the first invoice after any change; billing email is the Yahoo address.
- Backup the DB anytime with `node backend/scripts/backup-db.js` (writes JSON dumps to backend/backups/, gitignored). Run one immediately after the DB comes back from suspension.
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
