---
name: app-lifecycle-cli
description: >-
  Use when the user wants a global CLI alias to manage an app (status, version, run, stop, port, update, rebuild, optional service). Scaffolds and registers it for PowerShell, cmd, bash, zsh. Docker apps use Compose; native apps install to LocalAppData.
metadata:
  author: "Armin Dashti"
  uuid: e24ca07a-2645-4192-b9ba-4e609de8a5ef
---

## Inputs (infer, don't ask unless unknowable)
- `<alias>`: given or project name, kebab-case; must not collide (`Get-Command`/`command -v`).
- `<App>`: folder/display name (default alias). Source dir = current project root.
- Mode: **Docker** if a compose file exists, else **Native**. `service` commands only if user asks, Native only.
- Default port: user > config > framework default > compose published port.

## Commands
| Command | Contract |
|---|---|
| `status` | installed?, version, mode, paths, running + PIDs/containers, port, URL check, service state. Exit 0 running / 3 stopped / 4 not installed |
| `version` | installed vs source version (manifest or `git describe`) + CLI version; flag mismatch |
| `run [--port=N]` | start on N (default saved port), wait ≤30s for URL, print/open it; no-op with status if already running |
| `stop` | full stop (rules below); idempotent |
| `port --port=N` | validate free 1–65535, save as default, restart if running; no flag = print |
| `update` | `git pull --ff-only` (+ `docker compose pull`), then rebuild keeping data; abort on pull failure |
| `rebuild [--remove-data=no\|yes]` | default `no`; `yes` wipes all data+config, confirms unless `-y` |
| `service status\|start\|stop\|restart` | service mode only, else exit 2 |
| `uninstall`, `help` | remove everything incl. CLI/PATH (confirm); usage |
Accept `--port=N` and `--port N`. Unknown input → usage, exit 2.

## Native mode
Layout: `%LOCALAPPDATA%\<App>\{app,data,logs}`, `config.json` (port, version, sourceDir, mode, runCmd), `run.pid`. Unix: `~/.local/share/<App>`, config in `~/.config/<App>`. Pass `PORT` and `APP_DATA_DIR` env.

Build by marker (`<pm>` from lockfile): Vite → build, serve `dist`; Next → `output: standalone`, `node server.js`; .NET → `dotnet publish -c Release`, run exe `--urls`; Rust/Go → release binary; Electron/Tauri/Flutter → packaged desktop build; `rebuild.config.json` (`build`,`output`,`run` with `{port}`) overrides all. Install only build output, never source.

**Full stop (before rebuild/update/port):** stop service (wait ≤30s) → kill PID tree (`taskkill /T /F`; Unix TERM process group, KILL after 10s) → kill any process running from `app\` or holding the port → verify none left and port free. Locked files: retry 3×, then fail; never half-install.

**Rebuild:** note running state → full stop → build into temp staging (fail = old install untouched) → `no`: replace `app\` only; `yes`: delete whole `<App>` dir, `%APPDATA%\<App>`, `~/.config/<App>`, `HKCU\Software\<App>`, write fresh config → move staging in → re-register service → restart if it was running → print status.

**Service:** Windows NSSM, else `sc.exe` (create/delete need elevation; say so, don't fail silently); Linux `systemctl --user` unit; macOS LaunchAgent. `run`/`stop` delegate to it.

## Docker mode (no service, no AppData install)
`docker compose -p <alias>`; config only in `%LOCALAPPDATA%\<App>\config.json`. Port via `${<ALIAS>_PORT:-default}` in the mapping (add if missing).
- run `up -d` + URL wait; stop `stop`; status `ps` + health + URL.
- rebuild no: `down --remove-orphans` → `build --no-cache --pull` → `up -d`.
- rebuild yes: `down -v --rmi local --remove-orphans`, delete bind-mount data inside project/AppData only, delete config, rebuild, start.

## Registration
Node ≥18: CLI in `<App>\cli` (built-ins only), `bin` entry, `npm link`. Else `.ps1` + `.cmd` shim (`powershell -NoProfile -ExecutionPolicy Bypass -File`) on user PATH; Unix `~/.local/bin/<alias>` + `chmod +x`, guarded PATH line in `.bashrc`/`.zshrc`. Non-elevated, idempotent. No `&&` (PS 5).

## Rules
Stream output and name each step; propagate failing exit codes; destructive commands list what they delete; detached logs to `logs\<App>.log` (rotate 10 MB); never delete outside the paths above.

## Verify, then report alias, mode, paths, port, uninstall
1. New shells: `help`, `version`.
2. `rebuild` → `run` → URL ok → `status` running.
3. `port` change works; `stop` leaves no process, port free.
4. Edit source → `rebuild` shows change, data kept; `--remove-data=yes -y` wipes data/config, fresh run works.
5. `rebuild` while running stops it cleanly first.
6. Service commands reflect real state.
