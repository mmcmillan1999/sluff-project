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