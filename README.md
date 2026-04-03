<div align="center">
  <img src="frontend/public/graphite-logo.png" width="80" alt="Graphite" />
  <h1>Graphite</h1>
  <p><strong>Self-hosted PDF annotation with Excalidraw</strong></p>
  <p>
    Upload PDFs and images, annotate them with a full drawing toolkit, and export the results &mdash; all from your own server.
  </p>

  <a href="#quick-start"><img src="https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white" alt="Docker ready" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/ajclausen/graphite" alt="License" /></a>
</div>


---

## What is Graphite?

Graphite is a web app that renders PDF documents at full fidelity and overlays [Excalidraw](https://excalidraw.com)'s drawing canvas on top. Annotate schematics, mark up reports, sketch over blueprints — then export everything as a flattened PDF or image.

It runs as a single Docker container with an embedded SQLite database. No external services required.

## Features

- **PDF + image annotation** — Draw, highlight, and sketch directly on any page with Excalidraw's full toolkit
- **Multi-page navigation** — Annotations are saved per-page and restored when you return
- **High-fidelity rendering** — PDF.js renders documents at vector quality with deep zoom
- **Export** — Save annotated documents as flattened PDFs or PNG images
- **Document library** — Upload, rename, browse, and manage documents in list or grid view
- **Multi-user with auth** — Session-based authentication, admin panel, role-based access
- **Dark and light themes** — Toggle between themes with persisted preference
- **Self-contained** — Single Docker container, SQLite database, filesystem storage
- **Auto-save** — Annotations save automatically as you draw

## Quick Start

### 1. Clone and configure

```bash
git clone https://github.com/ajclausen/graphite.git
cd graphite
```

Create a `.env` file if you want to provide an explicit session secret:

```bash
echo "SESSION_SECRET=$(openssl rand -hex 32)" > .env
```

If you skip this, Graphite will generate a persistent session secret automatically and store it under `/data/session-secret` inside the container.

### 2. Start the container

```bash
docker compose up -d
```

### 3. Log in

Open **http://localhost:3000** and sign in with the default admin credentials:

| | |
|---|---|
| **Email** | `admin@graphite.local` |
| **Password** | Randomly generated on first boot and printed once in the container logs |

You will be prompted to set your real email and password on first login.

The bootstrap password is not shown in the UI. You must read it from the server/container logs after the first startup.

> **Tip:** To see the bootstrap credentials in the container logs:
> ```bash
> docker compose logs graphite | grep -A3 "Default admin"
> ```

If you are running Graphite in Unraid, open the container's log view after the first start and look for the `Default admin account created` block.

If you want to avoid checking logs, set `BOOTSTRAP_ADMIN_PASSWORD` yourself before first boot.

## Configuration

All configuration is via environment variables in `docker-compose.yml` or a `.env` file.

| Variable | Description | Default | Required |
|---|---|---|---|
| `SESSION_SECRET` | Signs session cookies. Optional; if unset, Graphite generates and persists one under `/data/session-secret` | auto-generated | No |
| `SESSION_SECRET_FILE` | Override path for the persisted auto-generated session secret | `/data/session-secret` | No |
| `BOOTSTRAP_ADMIN_PASSWORD` | Optional first-run admin password override. If unset, Graphite generates one and logs it once on first boot | auto-generated | No |
| `TRUST_PROXY` | Set to `1` when behind a reverse proxy (nginx, Caddy, Traefik) | — | No |
| `GRAPHITE_PORT` | Host port to expose | `3000` | No |

### Data persistence

All data (database, uploaded files, thumbnails) is stored in the `/data` volume inside the container. The `docker-compose.yml` maps this to a named Docker volume (`graphite-data`) that persists across restarts and upgrades.

To back up your data:

```bash
docker compose stop
docker cp $(docker compose ps -q graphite):/data ./graphite-backup
docker compose start
```

### Running behind a reverse proxy

For public deployments, place Graphite behind a reverse proxy that handles HTTPS. Set `TRUST_PROXY=1` so the app correctly reads client IPs and secure cookie flags.

**Caddy** (automatic HTTPS):

```
graphite.example.com {
    reverse_proxy localhost:3000
}
```

**nginx:**

```nginx
server {
    listen 443 ssl;
    server_name graphite.example.com;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    client_max_body_size 50M;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## User Management

Graphite uses an admin-managed user model. There is no self-registration — the admin creates accounts for users.

### How it works

1. **First boot** — A default admin account is created automatically
2. **Admin sets up their account** — On first login, the admin sets a real email and password
3. **Admin creates users** — From the admin panel, create accounts with temporary passwords
4. **Users log in** — Each user is prompted to set their own password on first login
5. **Per-user isolation** — Users only see their own documents

### Admin panel

Admins can access user management from the **Admin** button in the app header. From there you can:

- Create and delete user accounts
- Promote users to admin or demote admins
- Reset any user's password
- Change your own password

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite |
| Drawing | [Excalidraw](https://excalidraw.com) |
| PDF rendering | [react-pdf](https://github.com/wojtekmaj/react-pdf) (PDF.js) |
| State | Zustand |
| Backend | Express 4, TypeScript |
| Database | SQLite (better-sqlite3 via Knex.js) |
| Auth | express-session, Argon2id |
| Container | Node 20 Alpine, multi-stage Docker build |

## Development

### Prerequisites

- Node.js 20+
- npm 9+

### Setup

```bash
git clone https://github.com/ajclausen/graphite.git
cd graphite
npm install
```

Create the backend `.env`:

```bash
cp backend/.env.example backend/.env
```

Start the dev servers (frontend + backend with hot reload):

```bash
npm run dev
```

The app will be available at **http://localhost:5173** (frontend) proxying to **http://localhost:3001** (backend).

### Project structure

```
graphite/
  backend/
    src/
      auth/           # Session config, middleware, types
      db/             # Knex config, migrations
      routes/         # Express route handlers
      index.ts        # Server entry point
  frontend/
    src/
      api/            # Fetch wrapper, API client
      components/     # React components
      store/          # Zustand stores
      App.tsx         # Root component
  docker-compose.yml
  Dockerfile
```

### Building for production

```bash
# Build frontend
npm run build --workspace=frontend

# Build backend
npm run build --workspace=backend

# Or build the Docker image
docker build -t graphite .
```

## Security

Graphite is designed to be safe for public internet exposure when deployed behind HTTPS.

- **Argon2id** password hashing with OWASP-recommended parameters
- **Session-based auth** with httpOnly, Secure, SameSite=Lax cookies
- **CSRF protection** via SameSite cookies + Origin header validation
- **Rate limiting** on login (10 attempts / 15 min) and globally (300 req / 15 min)
- **Progressive account lockout** (30s / 5m / 30m delays after failed attempts)
- **Per-user data isolation** — all queries scoped by authenticated user
- **Path traversal protection** on file serving
- **Helmet** security headers including Content-Security-Policy
- **Non-root** Docker container user
- **No external dependencies** — no Redis, no PostgreSQL, no third-party auth

## License

[MIT](LICENSE)

## Acknowledgments

- [Excalidraw](https://excalidraw.com) for the drawing engine
- [PDF.js](https://mozilla.github.io/pdf.js/) via react-pdf for document rendering
- [Outfit](https://fonts.google.com/specimen/Outfit) and [Instrument Serif](https://fonts.google.com/specimen/Instrument+Serif) typefaces
