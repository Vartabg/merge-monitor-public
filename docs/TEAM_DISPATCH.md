# Dispatching work to closed chats

The team board holds work; it does not start chats (see TEAM_WORKERS.md). The dispatcher closes that gap: it watches
configured agents' inboxes and, when a queued assignment owned by one of them appears, opens that agent's chat with the
assignment as its first prompt. The woken agent then runs the normal claim → start → renew → finish loop.

## Run it

```bash
cp dispatch.config.example.json ~/.config/merge-monitor/dispatch.json   # edit names, project and cwd
node scripts/dispatch.mjs --config ~/.config/merge-monitor/dispatch.json --dry-run --once   # prove detection first
node scripts/dispatch.mjs --config ~/.config/merge-monitor/dispatch.json                     # watch and wake
```

Run one dispatcher per Mac, either manually in a terminal or supervised as a macOS LaunchAgent (`com.garo.merge-monitor.dispatch`) installed automatically by `npm run install:service` whenever `~/.config/merge-monitor/dispatch.json` exists. `npm run install:service` validates `dispatch.json` before modifying either LaunchAgent (`dispatch.out.log` / `dispatch.error.log` under `~/.local/state/merge-monitor/`). To stop and remove dispatcher supervision cleanly, delete or move `~/.config/merge-monitor/dispatch.json` and re-run `npm run install:service` (or run `launchctl bootout gui/$(id -u)/com.garo.merge-monitor.dispatch`; deleting the config without unloading triggers `KeepAlive` restarts). `--once` checks every configured inbox a single time. Wake and disk-hold records live in `~/.local/state/merge-monitor/dispatch-state.json`.

## What a wake does

1. Reads `team_inbox` for each configured `boardAgent` in its `project`.
2. For each queued assignment owned by that agent whose `id@revision` has never woken, opens a new iTerm window:
   `cd <cwd> && muse '<prompt>'` or `opencode '<cwd>' --prompt '<prompt>'`.
3. The prompt carries the bounded title, purpose, scope and acceptance, and orders the agent to read the board, claim
   with `team_claim`, start with `team_start`, work inside scope, verify, and `team_finish` for review. It also orders:
   **do not merge, push to the default branch, or deploy** — that stays with the owner.

A requeue at a new revision wakes again; the same revision never wakes twice. If the woken chat closes without
claiming, the lease/queue state is unchanged and the dispatcher will not re-wake that revision — requeue it (new
revision) or open the chat by hand.

## Pass 1: claim deadline, one dispatcher, wake cap

- All inboxes are fetched in parallel each cycle, and every wake is rechecked against a fresh inbox the second
  before the window opens (claimed or cancelled work never wakes).
- `claimDeadlineSeconds` (default 300): a wake whose assignment is still `queued` (or still `review` for a reviewer wake) after the deadline escalates once — a board `blocker` post to the agent from `dispatcherAgent` plus a macOS notification. Work that has left its waiting status counts as handled and never escalates.
- `minFreeDiskGiB` (default 50): free filesystem threshold (`1..500` GiB) checked at each agent's `cwd` via `statfs`. Projects below the floor (or failing the check) pause new wakes and post one `action` blocker to `human` until free space recovers.
- **Airspace advisories & reviewer wakes:** Owner wakes fetch `/api/status?repo=<project>` and attach active shared-file overlaps (when inspection is fresh and complete). Configured reviewers also wake automatically on `inbox.reviews` (`status === "review"`, one wake per revision) with bounded unverified worker summary/artifacts and instructions to verify independently without calling `team_claim`.
- One dispatcher per Mac: a pid lock next to the state file (`<state>.lock`). A live owner blocks a second
  dispatcher; a stale lock from a dead one is replaced.
- `maxWakesPerCycle` (default 2) caps new windows per cycle; the rest wait for the next cycle.

## Safety

- Board text never selects an executable, account or provider. The harness kind (`muse` or `opencode`) comes only
  from the local config; assignment fields are length-bounded and whitespace-collapsed before entering a prompt, and
  the prompt is shell-quoted.
- Names in config are self-reported board identities, same trust level as the board itself: trusted local clients only.
- A wake opens an interactive chat under the agent's normal permissions. It never runs the work headlessly and never
  merges anything.
- Messages alone do not wake: only queued assignments (the delegable, lease-carrying unit) dispatch a chat.

## Limits

- macOS + iTerm only (the launch is AppleScript). The woken chat must be able to reach the board service.
- OpenCode and Muse harnesses only. Other agents still read the board in their own chats.
- The dispatcher does not prove the agent acted; the board's check-in, claim lease and reviewer handoff remain the
  evidence, exactly as in the connected-agent loop.
