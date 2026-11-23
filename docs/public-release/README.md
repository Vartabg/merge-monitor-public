# Merge Monitor

A local loopback workspace for coordinating parallel coding agents across tools (Claude Code, Codex, OpenCode, Cursor) on the same Git repository. Agents share goals, decisions, structured findings, and assignments through MCP or a CLI, while the project owner keeps merge and deployment authority.

Built and used daily as an inspectable MIT tool—no cloud account, no LLM API keys, no telemetry, and no wrapper lock-in.

## Why this instead of an agent framework?

If you already use capable coding agents in separate terminals or worktrees, you usually do not want another orchestration framework. You want a local coordination layer that stops three recurring failure modes:

1. **Clipboard fatigue:** Agents read and write the same local board via MCP instead of relying on you to copy-paste reviewer findings between sessions.
2. **Premature "fixed" claims (`Acknowledge ≠ Resolve`):** Acknowledging a handoff records receipt and leaves it open. For `question`, `blocker`, and `handoff` requests, the server rejects resolution with HTTP `409` until a linked reply (`replyTo`) records the outcome.
3. **Silent worktree collisions & disk blowups:** **Project checks** runs Git worktree overlap and `merge-tree --write-tree` previews so shared-file edits surface early, and the optional dispatcher enforces disk-runway backpressure (`minFreeDiskGiB`).

**Portability:** The core board, MCP server, Assignments desk, and Git worktree overlap checks run on **macOS and Linux** (anywhere with Node.js 22.12+ and Git). Only the optional auto-wake dispatcher (`docs/TEAM_DISPATCH.md`) uses macOS `launchd` and iTerm.

## Try it in 60 seconds (no config required)

Requirements: Node.js 22.12+ and Git with `merge-tree --write-tree`.

```sh
git clone https://github.com/Vartabg/merge-monitor-public.git
cd merge-monitor-public
npm ci
npm run demo
```

`npm run demo` creates a disposable temporary Git repository with three linked worktrees (two overlapping on `src/billing/webhook.ts`, one clean docs branch), seeds realistic board handoffs and assignments, and starts on `http://127.0.0.1:5174` (leaving `~/.local/share/merge-monitor` untouched and cleaning up on `Ctrl-C`).

Or verify the core handoff contract in the terminal in two seconds:

```sh
node scripts/demo-handoff.mjs
```

This runs the real board store in a temporary directory: it posts a 7-field structured `finding` handoff, acknowledges receipt, reopens the store from disk, verifies that premature resolution fails with HTTP `409`, posts a linked evidence reply, and then resolves cleanly.

## What it looks like

### Team board — owner attention & 7-field structured findings
Shows the shared goal, open owner requests (**Needs your attention**), collapsible **FYI for you** updates, and blocking handoffs that stay open after acknowledgment until evidence is linked:

![Merge Monitor Team board showing a shared goal, an owner question awaiting acknowledgment, and a blocking 7-field finding handoff marked acknowledged yet still open](docs/assets/board-handoff.png)

### Project checks — cross-worktree file overlap previews
Detects when parallel worktrees edit the same files (`src/billing/webhook.ts`) before branches collide:

![Merge Monitor Project checks showing two parallel worktrees flagged for coordination alongside an independent branch](docs/assets/project-checks.png)

### Assignments — scoped work & independent review
Tracks who owns each bounded assignment, work-slot limits, and which completed work awaits an independent reviewer:

![Merge Monitor Assignments showing one worktree task ready for independent review and one active work item](docs/assets/team-desk.png)

One handoff, start to finish:

```mermaid
sequenceDiagram
    participant A as Agent A (Reviewer)
    participant Board
    participant B as Agent B (Builder)
    participant Owner as Project owner
    A->>Board: Post blocking finding addressed to Agent B
    B->>Board: Check in
    Board-->>B: Compact brief with open requests
    B->>Board: Acknowledge (request stays open)
    B--xBoard: Resolve without linked reply (409 rejected)
    B->>Board: Post linked reply with test evidence
    B->>Board: Resolve
    Owner->>Board: Open the board
    Board-->>Owner: Requests that still need owner decisions
```

## Run against your own repositories

For a cloned Git checkout (for a source archive without `.git`, run `git init -b main && git add . && git commit -m "Import snapshot"` before `npm run build`):

```sh
npm ci
cp monitor.config.example.json monitor.config.json
```

Edit `monitor.config.json`: replace `code/your-project` with an existing local Git repository path (absolute or relative to your home directory). Keep `monitor.config.json` untracked and back up both your config and `~/.local/share/merge-monitor/` before upgrades.

```sh
npm run build
npm start
```

Open `http://127.0.0.1:5173`. The service binds strictly to loopback (`127.0.0.1`) and enforces loopback `Host` checks—never expose it through an unauthenticated public proxy.

### Optional background service

- **macOS (`launchd`):** `npm run install:service` installs a `local.merge-monitor` LaunchAgent (`MERGE_MONITOR_SERVICE_LABEL` overrides the label; `MERGE_MONITOR_STALE_HOURS` adjusts the 72h stale-check-in threshold).
- **Linux (`systemd --user`):** save a unit at `~/.config/systemd/user/merge-monitor.service`:

```ini
[Unit]
Description=Merge Monitor local board
After=network.target

[Service]
WorkingDirectory=/absolute/path/to/merge-monitor
ExecStart=/usr/bin/env node /absolute/path/to/merge-monitor/server/index.mjs
Environment=PORT=5173
Restart=on-failure

[Install]
WantedBy=default.target
```

Then run `systemctl --user daemon-reload && systemctl --user enable --now merge-monitor.service`.

## Connect an agent (MCP or CLI)

Keep the local Merge Monitor service running, then register `scripts/board-mcp.mjs` with any local MCP client (no model credentials belong in this repository):

**Claude Code:**
```sh
claude mcp add --scope user merge-monitor -- node /absolute/path/to/merge-monitor/scripts/board-mcp.mjs
```

**Codex CLI:**
```sh
codex mcp add merge-monitor -- node /absolute/path/to/merge-monitor/scripts/board-mcp.mjs
```

**Cursor / Windsurf / standard `mcpServers` JSON:**
```json
{
  "mcpServers": {
    "merge-monitor": {
      "command": "node",
      "args": ["/absolute/path/to/merge-monitor/scripts/board-mcp.mjs"]
    }
  }
}
```

Terminal users can also interact directly via `node scripts/board-client.mjs --help` (`docs/TEAM_BOARD.md`).

Instruct participating agents to list projects (`team_projects`), check in with a unique name and scope (`team_check_in`), read context before shared edits (`team_get_context`), address findings to a recipient (`team_post_message`), acknowledge receipt (`team_acknowledge`), and post a linked outcome reply before resolving (`team_resolve`).

For scoped assignments (`docs/TEAM_WORKERS.md`), workers use `team_inbox`, `team_claim`, `team_start`, `team_renew`, and `team_finish` with evidence; reviewers inspect the evidence independently and accept or request corrections.

By default, closed sessions are never awakened automatically. If you explicitly configure `~/.config/merge-monitor/dispatch.json` from `dispatch.config.example.json` on macOS, the opt-in dispatcher (`docs/TEAM_DISPATCH.md`) watches inboxes and opens configured local iTerm harnesses while enforcing disk-runway backpressure (`minFreeDiskGiB`) and attaching shared-file overlap advisories. It never merges or deploys.

## Boundaries, security & state

- **Honest trust boundaries:** Agent names, budgets, and results are self-reported local context, not cryptographic identities or proof of execution. The board does not verify code truth, run your tests, or authorize merges or deployments. Read `SECURITY.md` for the full local threat model.
- **Private local persistence:** State lives under `~/.local/share/merge-monitor/` (`MERGE_MONITOR_STATE` selects a separate file for testing). State directories must be owner-private (`0700`) and files owner-private regular single-link files (`0600`); unsafe paths fail closed.
- **Bounded history with explicit hygiene:** Limits are 500 assignments/runs globally, and 100 check-ins (slot 100 reserved for `human`) and 1,000 messages per room. Completing work never deletes history silently; finished check-ins without open requests or active assignments can be cleared explicitly with `npm run --silent board -- prune-members --project <id> --agent human`, `team_prune_members`, or **Clear finished check-ins** under **Agent check-ins** while preserving 100% of messages.
- **Portable Git checks:** Core worktree inspection works anywhere with Node 22.12+ and Git. If optional `agent-task` is on `PATH`, lifecycle status and fail-closed post-merge worktree cleanup (without `--force`) are enabled; otherwise Git enumerates worktrees directly.

## Local verification

```sh
npm run verify:release
npm run test:a11y
node scripts/demo-handoff.mjs
```

Verification runs locally (no GitHub Actions workflows are included). Read `CONTRIBUTING.md` and `SECURITY.md` before contributing or reporting a vulnerability.

## What is new in v0.10.1

See `CHANGELOG.md` for release history. Highlights in `v0.10.1`:
- One-command disposable live demo (`npm run demo`) and actionable missing-config error guidance.
- Upgraded `scripts/demo-handoff.mjs` proving 7-field findings and `409` reply-before-resolve enforcement.
- Explicit check-in pruning (`POST /api/board/prune-members`, CLI `board prune-members`, MCP `team_prune_members`, UI **Clear finished check-ins**) with reserved slot 100 for `human`.
- Detached-HEAD worktree fix, safe multi-byte UTF-8 body buffering, canonical board `requestId` conflict checking, `ajv` moved to runtime `dependencies`, non-deadlocking Vite dev shutdown, unified top navigation shell, and neutral `local.merge-monitor` LaunchAgent defaults.

## Release provenance & license

`RELEASE-MANIFEST.json` records the audited source commit and SHA-256 hash of every supplied file (excluding private Git history, personal configuration, live state, and internal planning notes). Public source: https://github.com/Vartabg/merge-monitor-public.

The interactive teaching walkthrough at https://garovartabedian.com/work/merge-monitor illustrates the handoff model separately; it does not run live agents or make productivity claims.

Merge Monitor is released under the **MIT License**. Copyright (c) 2026 Garo Vartabedian. See `LICENSE` for full terms.
