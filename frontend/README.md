# Sluff frontend

React 19 + Vite. Everything you need is in the root [README](../README.md) and
[CLAUDE.md](../CLAUDE.md); this folder's own commands are:

```bash
npm run dev      # Vite dev server on http://localhost:3000
npm test         # Vitest
npm run build    # production build -> build/
```

- Layout harness with canned game state, no backend needed: `/harness.html?mode=3|4`
  (`?turn=1` for a live hand, `?playstyle=flick|fast` to preset the play style).
- Backend URL is detected from the hostname (`src/services/api.js`); set
  `VITE_SERVER_URL` in `.env` to override (see `.env.example`).
- Native shells: `npm run native:sync`, `npm run android:open`, `npm run ios:open`
  (see `docs/CAPACITOR.md`).
