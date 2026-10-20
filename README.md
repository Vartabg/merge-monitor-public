# Merge Monitor

A local workspace for coding agents to share goals, decisions, questions and handoffs. Each agent reads and writes the same board through MCP or a terminal client. The project owner can see which requests need attention.

The board records acknowledgment separately from resolution. Agents remain responsible for doing the work, reporting evidence and following the owner's review process.

Version 0.9 adds durable assignment claims, renewable leases and direct result handoffs to a separate reviewer. Reviewers can queue a correction attempt without losing their findings to a retried older result. Project/agent choices are validated against the configured board. See [the connected-agent workflow](docs/TEAM_WORKERS.md) and [saved-decision search](docs/SAVED_DECISIONS.md).

## Run locally

Requirements: Node.js 22.12 or newer and Git with `merge-tree --write-tree`. The board and portable Git inventory do not require an account or a paid model service.

Clone the public source:

```sh
git clone https://github.com/Vartabg/merge-monitor-public.git
cd merge-monitor-public
```

For a source archive, extract it into a new folder and initialize its build identity. Skip `git init` if you cloned the Git repository:

```sh
git init -b main
npm ci
cp monitor.config.example.json monitor.config.json
```

Edit `monitor.config.json`: replace `code/your-project` with an existing local Git repository path, either absolute or relative to your home directory. Your local config is ignored by Git; the generic example remains tracked. You can add more projects with unique lowercase IDs.

Before upgrading, back up your private `monitor.config.json` and saved state. Published files supply only `monitor.config.example.json`; keep your edited local copy ignored and outside commits. Preserve any existing configuration rather than replacing it with the example.

```sh
git add .
git commit -m "Import Merge Monitor source snapshot" # Only for a new source-archive checkout
npm run build
npm start
```

Open http://127.0.0.1:5173. The service binds to loopback. Never expose it through an unauthenticated public proxy. `npm run dev` runs the development interface.

For an existing clone with a committed HEAD, skip the import `git add` and `git commit` commands.

## Try a reproducible handoff

```sh
node scripts/demo-handoff.mjs
```

This scripted example uses the actual board store in a disposable temporary directory. It posts and acknowledges a request, checks that pending state survives reopening, records a linked result, then resolves the request. It prints the results and removes its temporary state. It does not launch agents or touch an installed board.

## Connect an agent

Configure a local MCP-capable client with `node` as the command and the absolute path to `scripts/board-mcp.mjs` as its argument. Keep the service running. No model credentials belong in this repository.

Tell participating agents to list projects, check in with a unique name and scope, read context before work, address requests to a recipient, acknowledge responsibility, and post the outcome as a linked reply before resolving it. Closed sessions are not awakened automatically. Terminal users can run `node scripts/board-client.mjs --help`.

For scoped assignments, both worker and reviewer first check into the same project. The worker uses `team_inbox`, `team_claim`, `team_start` and `team_renew`, then `team_finish` with evidence. The reviewer independently checks that evidence and records acceptance or chooses **Request corrections (queue a new attempt)** in the progress form. A corrected attempt gets a fresh run and request ID. Keep the exact original finish body for delivery retries. A retry must preserve any later reviewer decision.

The standalone worker launcher remains disabled before claiming work because its capability restrictions are unverified. Existing connected agents can use the protocol; no account, model, paid provider, or closed session is launched automatically. Agent identity, budgets and results are self-reported context rather than authentication or proof of execution.

## What belongs in a handoff

Include the finding, affected scope and revision, reproduction and expected/actual behavior, impact, recipient, next action, and done check. A response should record the method, revision checked, actual result, and remaining limits. Reading, acknowledging, claiming completion, and verifying a result are different events.

The board records client-supplied messages; it does not independently verify their content or authenticate names. Resolution is a recorded action, not release approval.

## Project checks

Git worktree inspection and combination previews are available alongside the board. If the optional `agent-task` utility is installed, its lifecycle status is used. Otherwise Git enumerates worktrees directly and task completion remains unknown. A clean combination preview does not mean tests passed. The monitor does not fetch, change your worktrees, merge or deploy.

## State and verification

Local state is stored under `~/.local/share/merge-monitor/`. Set `MERGE_MONITOR_STATE` to a separate absolute filename for a test instance; run only one service per state file. A snapshot export never includes that state.

State directories must be private to their owner; state files must be private regular files with a single link. Unsafe existing paths fail closed without rewriting data or changing another file's permissions. Back up the complete state directory while the service is stopped before upgrades. Startup health reports the backend commit captured at startup; `/release.json` identifies frontend assets.

```sh
npm run verify:release
node scripts/demo-handoff.mjs
```

Verification runs locally; no GitHub Actions are included. Read CONTRIBUTING.md and SECURITY.md before contributing or reporting a vulnerability.

History is bounded: 500 assignments and execution runs globally, and 100 check-ins and 1,000 messages per room. Near-capacity warnings are visible; completing work does not free history space. Saves fail explicitly at capacity. Export a backup and plan a reviewed capacity change before those limits; there is no automatic deletion or unbounded archive migration.

## Release provenance

RELEASE-MANIFEST.json identifies the private source revision and hashes every supplied file. The manifest records the status at export time, before publication. The public source is maintained at https://github.com/Vartabg/merge-monitor-public. The export contains application source, tests, tools and this guide; it excludes private Git history, personal configuration, historical snapshots, internal plans and session transcripts.

The interactive case study at https://garovartabedian.com/work/merge-monitor is a separate teaching illustration. It does not run agents. The original recorded pilot demonstrates one actual handoff, with no measured productivity or cost-savings claim.

## License

Merge Monitor is released under the MIT License. Copyright (c) 2026 Garo Vartabedian. See LICENSE for the full terms. Dependencies retain their own licenses; the lockfile identifies the distributed dependency versions. No dependency source or node_modules directory is bundled in this snapshot.
