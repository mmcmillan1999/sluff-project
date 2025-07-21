--- START FILE: README.md ---
# Sluff Project Monorepo

## Overview

This repository contains the full source code for the Sluff card game, organized as a monorepo.

-   **`/backend`**: Contains the Node.js, Express, and Socket.IO server. This handles all game logic, authentication, and database interactions.
-   **`/frontend`**: Contains the React client application, built with Create React App. This is the user interface for the game.
-   **`/scripts`**: Contains utility scripts for development, such as generating AI context files.

## Deployment & Environments

The project uses a GitFlow-style branching model with two primary environments:

1.  **Staging (`stage` branch):**
    *   **Purpose:** A pilot/testing environment that mirrors production. All new features are merged and tested here first.
    *   **Frontend:** Deployed on Netlify at `sluff-pilot.netlify.app`.
    *   **Backend:** Deployed on Render at `sluff-backend-pilot.onrender.com`.

2.  **Production (`main` branch):**
    *   **Purpose:** The live environment for all users. Code is only promoted here after being verified on Staging.
    *   **Frontend:** Deployed on Netlify at `sluff.netlify.app`.
    *   **Backend:** Deployed on Render at `sluff-backend.onrender.com`.

Both environments connect to the same production PostgreSQL database.

---
## Render Deployment Settings

### Staging / Pilot (`sluff-backend-pilot`)
*   **Service URL:** `https://sluff-backend-pilot.onrender.com`
*   **Repository Branch:** `stage`
*   **Build & Deploy:**
    *   **Root Directory:** `backend`
    *   **Build Command:** `npm install`
    *   **Start Command:** `npm start`
*   **Environment Variables:**
    *   `CLIENT_ORIGIN`: `https://sluff-pilot.netlify.app`
    *   `DATABASE_URL`: `[hidden in Render]`
    *   `JWT_SECRET`: `[hidden in Render]`
    *   `AI_SECRET_KEY`: `[hidden in Render]`
    *   `ADMIN_SECRET`: `[hidden in Render]`

### Production (`sluff-backend`)
*   **Service URL:** `https://sluff-backend.onrender.com`
*   **Repository Branch:** `main`
*   **Build & Deploy:**
    *   **Root Directory:** `backend`
    *   **Build Command:** `npm install`
    *   **Start Command:** `npm start`
*   **Environment Variables:**
    *   `CLIENT_ORIGIN`: `https://sluff.netlify.app`
    *   `DATABASE_URL`: `[hidden in Render]`
    *   `JWT_SECRET`: `[hidden in Render]`
    *   `AI_SECRET_KEY`: `[hidden in Render]`
    *   `ADMIN_SECRET`: `[hidden in Render]`

--- END FILE: README.md ---