# Janus

Janus is a local app for managing AI agent resources in one place: **Skills**, **Sub-agents**, **MCP servers**, and **Projects**. Keep one canonical copy of each resource, and Janus syncs it into every enabled IDE/CLI platform (Claude, Cursor, Codex, and others), both globally and per project.

Janus runs on your machine. There is no cloud service, no account, and no database. Data lives in the file system and a `settings.json` file.

## Features

- **One source of truth.** Edit a skill once. Janus copies it to every enabled platform and project.
- **Skills and Sub-agents.** Create, rename, edit `SKILL.md` files, and assign them to projects.
- **MCP servers.** Add, test, and remove MCP server entries across platform configs.
- **Projects.** Discover git projects under a folder, import them, and choose which skills and sub-agents each project uses.
- **Platform sync.** Sync on app start or with the Sync button. Janus copies changes into all platform folders.
- **Live updates.** A file watcher detects renames and edits made outside the app and refreshes the UI.
- **Installable web UI.** The UI is a PWA. You can install it from Chrome or Edge.
- **Self-update.** Janus can check for and apply updates from its git checkout.

## Architecture

| Part | Folder | Tech |
|------|--------|------|
| API | `janus-api/` | Fastify, TypeScript, Node.js 20+ |
| Web UI | `janus-webui/` | React 19, Vite, Tailwind CSS, Zustand |
| Installer and CLI | `scripts/` | PowerShell, `janus` command |

The API serves REST endpoints under `/api` and a Server-Sent Events stream at `/api/events`. The web UI talks to it at `http://127.0.0.1:47911`.

## Requirements

- Windows 10 or 11
- [Node.js](https://nodejs.org/) 20 or newer
- PowerShell 5.1 or newer
- Administrator rights only if you install into `Program Files` or register the Windows service

## Quick start

### Install (Windows)

Clone the repository and run the installer from the repo root:

```powershell
git clone https://github.com/ArminDashti/janus.git
cd janus
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-local.ps1
```

The first install asks where to put Janus:

1. `%LOCALAPPDATA%\Janus` (default, no admin needed)
2. `%APPDATA%\Janus`
3. `%ProgramFiles%\Janus` (admin, UAC prompt)
4. A custom absolute folder

The installer builds `Janus.exe`, which bundles the API and the web UI. It then adds the install folder to your user `PATH` and starts the background service.

Open a **new** terminal after installing, then run:

```powershell
janus doctor
```

### Run in development

```bash
# Terminal 1: API on http://127.0.0.1:47911
cd janus-api
npm install
npm run dev

# Terminal 2: web UI on http://127.0.0.1:8006
cd janus-webui
npm install
npm run dev
```

To point the web UI at a different API, set `VITE_API_BASE_URL` in `janus-webui`.

## CLI

After installing, use the `janus` command:

| Command | What it does |
|---------|--------------|
| `janus doctor` | Check the installation |
| `janus status` | Show whether the service is running |
| `janus run [--port=N] [--no-open]` | Run the server in the foreground |
| `janus port [--port=N]` | Show or change the port (default `47911`) |
| `janus service start\|stop\|restart\|status` | Control the background service |
| `janus update` | Update Janus from git |
| `janus rebuild [--remove-data=no\|yes] [-y]` | Rebuild the installed app |
| `janus stop` | Stop the app |
| `janus remove` / `janus uninstall` | Remove Janus |

To update an existing install, run `scripts\install-local.ps1` again. It replaces `Janus.exe` and keeps your `settings.json` and logs.

## Configuration

Janus stores its data in the install folder:

| Path | Contents |
|------|----------|
| `settings.json` | App settings. Created on install and kept on update. |
| `logs\infos\YYYY-MM-DD.txt` | Info log, one file per day |
| `logs\warnings\YYYY-MM-DD.txt` | Warning log |
| `logs\errors\YYYY-MM-DD.txt` | Error log |
| `Skills\` | Canonical skill store. Janus copies skills from here to each platform. |

| Variable | Default | Description |
|----------|---------|-------------|
| `JANUS_API_BIND` | `127.0.0.1:47911` | Host and port the API binds to |
| `JANUS_APP_ROOT` | Package folder | Data directory (settings, imported projects) |
| `VITE_API_BASE_URL` | `http://127.0.0.1:47911` | API URL used by the web UI in development |

The API has no authentication. It is meant for local use only and binds to `127.0.0.1` by default. Do not expose it to a network.

## API overview

Full list: [`docs/endpoints.md`](docs/endpoints.md).

- `GET /api/health`: liveness check
- `GET /api/events`: SSE stream of `scan-changed` events
- `GET /api/scan`: cached scan of skills, sub-agents, and MCPs
- `POST /api/sync`: sync resource changes into all enabled platforms
- `GET|PUT /api/settings`: read or save settings
- `/api/resources/:type/...`: create, rename, assign, and delete resources
- `/api/mcps`, `/api/platforms`, `/api/projects/...`: manage MCPs, platforms, and projects

## Project layout

```
janus/
├── janus-api/        Fastify API (TypeScript)
│   └── src/
│       ├── server.ts         Server, health, SSE
│       ├── cli.ts            janus CLI entry
│       ├── routes/index.ts   All /api routes
│       └── services/         Scanner, sync, assignment, watcher, updates
├── janus-webui/      React + Vite PWA
│   └── src/
│       ├── main.tsx          App entry, SSE connection
│       ├── api/              HTTP client
│       ├── stores/           Zustand store
│       ├── components/       UI components
│       └── pages/            Skills, Sub-agents, MCPs, Projects, Settings
├── scripts/          Installer, build, and service scripts (PowerShell)
└── docs/             Design notes, endpoints, directory tree
```

## Development

Use the existing scripts:

```bash
# janus-api
npm run typecheck     # TypeScript check
npm run build         # Same check as typecheck (no emit)
npm start             # Run without hot reload

# janus-webui
npm run build         # Production build
npm run preview       # Serve the production build
```

Self-check for the skill store:

```bash
cd janus-api
npx tsx scripts/check-skill-store.ts
```

## Troubleshooting

- **`janus` is not recognized.** Open a new terminal. The installer updates your user `PATH`, and existing terminals do not see the change.
- **Install or uninstall fails.** Run PowerShell as Administrator. This is needed for `Program Files` installs and for registering the Windows service.
- **The UI shows no data.** Check that the API is running (`janus status`) and that the web UI points to the correct URL.
- **Something broke after an update.** Check the logs in `logs\errors\`.

## Contributing

1. Fork the repo and create a branch.
2. Make your change and run the checks listed under [Development](#development).
3. Open a pull request with a clear description of what changed and why.

## Documentation

- [`docs/description.md`](docs/description.md): project overview
- [`docs/endpoints.md`](docs/endpoints.md): API endpoints
- [`docs/dir-tree.md`](docs/dir-tree.md): directory tree
- [`docs/modules/platform-sync.md`](docs/modules/platform-sync.md): platform sync
- [`janus-api/README.md`](janus-api/README.md): API details
- [`janus-webui/README.md`](janus-webui/README.md): web UI details
