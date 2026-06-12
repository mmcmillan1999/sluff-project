# Sluff

A real-time multiplayer trick-taking card game with AI bot opponents powered by modern LLMs.

- **`/frontend`** — React 19 + Vite client. Card physics engine, viewport-based responsive layout, Socket.IO client.
- **`/backend`** — Node.js + Express + Socket.IO server. Game engine, auth (JWT), PostgreSQL, multi-provider AI bot service.
- **`/docs`** — Living documentation (`docs/archive/` holds historical reports).

## Quick start

```bash
# Backend (port 3005)
cd backend
npm install
cp .env.example .env   # fill in values
npm run dev:simple

# Frontend (port 3000)
cd frontend
npm install
npm run dev
```

## Deployment

- **Frontend**: Netlify, auto-deploys from `main` (`netlify.toml` at repo root).
- **Backend**: Render web service (`npm start`).
- **Database**: PostgreSQL on Render (`POSTGRES_CONNECT_STRING`).

## Testing

```bash
cd backend && npm test        # game logic / integration suite
cd frontend && npm test       # component + physics tests (Vitest)
```

See `CLAUDE.md` for architecture details and development conventions.
