# Changelog

All notable public releases of Merge Monitor are documented here.

## v0.10.1 — 2026-11-23

### Added
- **One-command disposable demo (`npm run demo`):** Boots Merge Monitor against a temporary synthetic Git repository with overlapping worktrees, a seeded board goal, a blocking 7-field finding handoff (acknowledged yet still open), and sample assignments—cleaning up completely on exit without touching `~/.local/share/merge-monitor` or requiring `monitor.config.json`.
- **Explicit board check-in pruning:** Added `POST /api/board/prune-members`, CLI `board prune-members [--include-stale]`, MCP `team_prune_members`, and the UI **Clear finished check-ins** control to reclaim completed check-in slots without deleting any message history or pruning agents with open requests. Reserved slot 100 for `human`.
- **Upgraded terminal proof (`scripts/demo-handoff.mjs`):** Now demonstrates the 7-field structured `finding` schema and verifies HTTP `409` rejection on premature resolution without a linked reply.
- **Public UI screenshots & copy-paste MCP setup snippets** for Claude Code, Codex CLI, and standard `mcpServers` JSON in `README.md`, plus a Linux `systemd --user` service example.

### Fixed & Hardened
- Moved `ajv` from `devDependencies` to runtime `dependencies`.
- Fixed detached-HEAD worktree handling in `server/worktrees.mjs` and `server/decisions.mjs`.
- Switched request body reading in `server/api.mjs` to `Buffer.concat` for safe multi-byte UTF-8 chunking.
- Enforced canonical `requestId` payload conflict checking on board retries, monotonic execution timestamps across backward clock steps, worker schedule generation guards, and tightened fresh `finish` validation.
- Hardened optional macOS dispatcher (`scripts/dispatch.mjs`) with escalation retry/fallback, anti-spam throttling, lock-before-load serialization, inbox truncation guard, and `pruneWakes` reclamation.
- Neutralized default LaunchAgent label to `local.merge-monitor` (with automatic migration from legacy labels and atomic `0600` temp plist validation via `plutil -lint`).
- Added actionable missing-config guidance in `server/config.mjs` and non-deadlocking Vite HMR teardown in `server/index.mjs`.
- Unified the frontend header shell (`src/AppHeader.tsx`), shared project storage (`src/projectStorage.ts`), modularized `src/Board.tsx`, and added safe non-JSON API error handling.

## v0.10.0 — 2026-11-17

- Structured 7-field `finding` evidence on handoffs and blockers with reply-before-resolve enforcement (`409`).
- Local Air Traffic Control: shared-file worktree overlap advisories, disk-runway backpressure (`minFreeDiskGiB`), automatic builder-to-reviewer wakes, and optional fail-closed post-merge worktree cleanup when `agent-task` is installed.
- Optional macOS session wake dispatcher (`scripts/dispatch.mjs`, `docs/TEAM_DISPATCH.md`).
- Loopback `Host` enforcement across all static/dev/API routes, terminal/BiDi control sanitization, owner-private atomic state files, and automated pre-export privacy/secret gating.

## v0.8.1 — 2026-10-09

- First public MIT source snapshot: local shared board, compact context briefs, MCP adapter (`scripts/board-mcp.mjs`), terminal CLI (`scripts/board-client.mjs`), portable Git worktree inspection, and reproducible handoff demo.
