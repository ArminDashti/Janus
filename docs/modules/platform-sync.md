# Module: Platform Sync

Responsibility: propagate the latest version of every canonical resource
(skill, sub-agent) into all enabled IDE/CLI locations, globally and per project.

Skills: the Janus store `%LOCALAPPDATA%\Janus\Skills` (`getSkillsStorePath()`) is the
master copy. Platform and project skill folders are copies. Sync (Sync button, boot,
`PUT /api/settings`) first imports skills missing from the store (never overwriting
store skills), then overwrites every existing copy from the store.

## Backend (`janus-api`)

- `services/platform-sync.service.ts`
  - `syncEnabledPlatformsToProjects()` — bootstraps enabled platform folders in
    all projects, rescans, then re-copies each project-assigned resource into
    every enabled platform via `assignmentService.assignToProject`.
  - `applyMcpEnableCascade()` — toggles MCP enabled state when platforms flip.
  - `removeUnselectedPlatformFolders()` — purges project folders of disabled IDEs.
- `routes/index.ts`
  - `PUT /api/settings` runs sync automatically when platforms change.
  - `POST /api/sync` — manual sync: runs `syncEnabledPlatformsToProjects()` and
    returns a fresh `ScanResult` in one round-trip (used by the WebUI Sync button).

## Frontend (`janus-webui`)

- `api/types.ts` / `api/client.ts` — `syncNow(): Promise<ScanResult>` calls `POST /api/sync`.
- `stores/appStore.ts` — `syncNow()` action sets the returned scan into state.
- `components/layout/Sidebar.tsx` — single "Sync" button (ArrowLeftRight icon) below the
  Resources nav group. Runs `loadSettings()` then `syncNow()` (which also rescans); disabled while syncing.

Dependencies: assignment, project-bootstrap, scanner, settings-store services.
Invariant: sync is source-of-truth-preserving — canonical copies overwrite
platform copies; it never edits the canonical source.
