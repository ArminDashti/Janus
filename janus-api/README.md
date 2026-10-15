# janus-api

Local HTTP API for [janus-webui](https://github.com/ArminDashti/janus-webui). Manages AI agent resources (skills, rules, hooks, sub-agents, MCPs) across platforms and projects.

## Requirements

- Node.js 20+
- Windows (for service install/start/stop via `sc.exe`)

## Quick start

```bash
npm install
npm run dev
```

The API listens on `http://127.0.0.1:47911` by default. Point janus-webui at that URL (or set `VITE_API_BASE_URL`).

## CLI

Run via `npm run janus -- <command>`, or `npx janus <command>` after `npm link`:

| Command | Description |
|---------|-------------|
| `janus` / `janus run` | Start the HTTP server in the foreground |
| `janus status` | Show Windows service status |
| `janus start` | Start the Windows service |
| `janus stop` | Stop the Windows service |
| `janus restart` | Restart the Windows service |
| `janus install` | Register as a Windows service (auto-start) |
| `janus uninstall` | Remove the Windows service |

`install` and `uninstall` require an elevated (Administrator) shell.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `JANUS_API_BIND` | `127.0.0.1:47911` | Host and port to bind |
| `JANUS_APP_ROOT` | package directory | Data directory (settings, instructions, imported projects) |

## Development

```bash
npm run dev
```

Uses `tsx watch` for hot reload on source changes.

```bash
npm run typecheck
npm run build
npm start
```

## Windows service

Install registers a service named `janus` that runs:

`node` → `tsx` → `src/cli.ts run`

No separate build step is required for the service binary path.

After install:

```bash
janus start
janus status
```

## CORS and static assets

Allowed origins: `http://127.0.0.1:8006`, `http://localhost:8006` (Vite dev server).

Static files:

- `/logos/*` — platform logos from `resources/logos/`
- `/branding/*` — branding images from `resources/branding/`

## Skill store

Skills are mastered in `<app root>\Skills` (`%LOCALAPPDATA%\Janus\Skills` when installed).
Sync on app start and on the Sync button copies store skills over every platform and
project copy. Self-check: `npx tsx scripts/check-skill-store.ts`.

## API overview

- `GET /api/health` — liveness check
- `GET /api/events` — SSE stream (`scan-changed` events)
- Settings, scan, files, resources, MCPs, platforms, projects, instructions, refactor — see `src/routes/index.ts`

## External rename / modify sync

Skills renamed or modified outside the app are reflected automatically:

- The file watcher (`src/services/watcher.service.ts`) observes project/global skill
  folders and emits `scan-changed` over SSE so the UI re-scans.
- Content edits fan out to same-name clones that still match the previous hash
  (`src/services/skill-sync.service.ts`).
- Name drift is reconciled on every scan (`src/services/skill-name-sync.service.ts`):
  - a folder renamed on disk rewrites `SKILL.md` `name:` (and all same-UUID clones follow);
  - `name:` edited in `SKILL.md` renames the folder (and all same-UUID clones follow);
  - with no prior scan history to disambiguate, the folder name is authoritative.
