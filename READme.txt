--- START FILE: README.md ---
# Sluff Project Monorepo

## Overview

This repository contains the full source code for the Sluff card game, organized as a monorepo.

-   **`/backend`**: Contains the Node.js, Express, and Socket.IO server. This handles all game logic, authentication, and database interactions.
-   **`/frontend`**: Contains the React client application, built with Create React App. This is the user interface for the game.
-   **`/scripts`**: Contains utility scripts for development, such as generating AI context files.

## Local Development Setup

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn
- PostgreSQL database (or use the provided connection string)

### Quick Start

1. **Clone the repository**
   ```bash
   git clone [repository-url]
   cd sluff-project
   ```

2. **Backend Setup**
   ```bash
   cd backend
   cp .env.example .env
   # Edit .env with your configuration
   npm install
   npm run dev
   ```
   The backend will start on http://localhost:3005
   
   **Note:** The `npm run dev` command will automatically kill any process running on port 3005 before starting.

3. **Frontend Setup** (in a new terminal)
   ```bash
   cd frontend
   cp .env.example .env
   # Edit .env if needed (default settings work for local dev)
   npm install
   npm start
   ```
   The frontend will start on http://localhost:3003
   
   **Note:** If port 3003 is in use, Create React App will prompt you to use a different port.

### Handling Port Conflicts

#### Backend
- `npm run dev` - Automatically kills any process on port 3005 before starting
- `npm run dev:simple` - Runs without port killing (traditional nodemon)
- `npm run kill-port` - Manually kill process on port 3005

#### Frontend
- Create React App will automatically detect if port 3003 is in use and offer an alternative
- You'll see a prompt asking if you want to run on a different port (e.g., 3004)

### Environment Configuration

Both frontend and backend use `.env` files for configuration. Example files are provided:
- `backend/.env.example` - Copy to `backend/.env` and configure
- `frontend/.env.example` - Copy to `frontend/.env` and configure

For local development, the default settings in the example files should work out of the box.

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