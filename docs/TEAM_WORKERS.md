# Agents working together

Use one project room, unique agent identities, scoped assignments and a separate
reviewer. Connected agents now have an inbox and durable execution claims. They
can take work and deliver it to the reviewer without the owner relaying messages.
The existing Team assignments page shows their queued, working, review and
accepted records. A run lease is a worker report, not proof of provider activity.

## Connected-agent loop

1. Read the repository's required instructions and `team_projects`. Check in with
   a unique name, allowed scope and working state. Read `team_get_context`.
2. The coordinator creates an assignment through Team assignments or
   `team-queue.mjs create`. Select the exact project, checked-in owner and a
   different checked-in reviewer. Include acceptance checks and a declared budget.
3. The owner calls `team_inbox`, then `team_claim` with assignmentId and a fresh
   UUID requestId. Save the returned runId. A different claim cannot dispatch the
   same assignment; an exact retry returns the original claim.
4. Call `team_start` with that runId and an honest adapter label (for example,
   `connected-codex-agent`). Work only within the assignment and existing project
   rules. Call `team_renew` at boundaries within the two-minute lease. Stop on a
   failed renewal; preserve evidence and report the blocker.
5. Call `team_finish` with status `review` or `blocked`, a compact summary, up to
   five artifact paths/URLs and a fresh requestId. Save this exact request before
   sending; reuse it unchanged if the response is lost. The result is saved and
   an addressed handoff is delivered to the assignment's reviewer.
6. The reviewer calls `team_inbox` or `team_wait`, reads the artifact and runs the
   applicable independent checks. Acknowledge and resolve the addressed message
   after handling it. Record acceptance/rework through the normal assignment
   update with the current revision, evidence and a review note. To request
   corrections, choose **Request corrections (queue a new attempt)** (`queued`)
   from review; preserve the correction findings and evidence. The worker reads
   its inbox, claims with a fresh request ID and starts a new run. An exact
   retry of an earlier finish can redeliver its handoff but cannot replace later
   reviewer fields. A first finish publishes its complete evidence even if an
   operator already selected review. Acceptance does
   not authorize a merge or deployment. Check out as done after handoff.

`team_wait` returns a cursor; pass it as `after` to wait for a changed inbox. Each
call waits at most 55 seconds. The agent must keep its listener active; closed
chats are not awakened. Bounded inbox counts disclose omitted work. The tools do
not read private chat transcripts or auto-acknowledge messages.

These MCP tools are available after the verified service and MCP adapter are
updated/reconnected. Agents with terminal access can use the same protocol now:

```sh
node scripts/team-work.mjs inbox --project PROJECT_ID --agent WORKER_NAME
node scripts/team-work.mjs wait --project PROJECT_ID --agent REVIEWER_NAME --seconds 30
node scripts/team-work.mjs claim --input /absolute/path/claim.json
node scripts/team-work.mjs start --input /absolute/path/start.json
node scripts/team-work.mjs renew --input /absolute/path/renew.json
node scripts/team-work.mjs finish --input /absolute/path/result.json
```

Use `--origin http://127.0.0.1:5187` for an isolated test service. See
[OpenAPI](openapi.json) for exact JSON fields. Session tokens stay inside the local
client. Board text never selects an executable, account or provider. Names are
self-reported labels, not authenticated identities; use only trusted local
clients and preserve their original permissions and user-authorized scope.

## Failure and recovery

Claims persist across service restarts. Three claimed/running/expired runs can
reserve capacity at once; 500 total runs are retained. Expiry blocks late results
and replacement work. It does not prove the worker stopped. Confirm that the
owned worker stopped, then call `team_cancel` to release its reservation. When
cleanup is uncertain, call `team_abandon`: the run stays expired and reserved.
Do not cancel an uncertain worker merely to make room for new work.

The execution file is `${MERGE_MONITOR_STATE}.runtime/executions.json`, stored in
a private directory outside Git. One service owns each state file. Back it up
together with the existing board and assignment files before upgrading. Invalid
execution state stops startup; retain it for diagnosis and restore a known valid
backup with the service stopped. Never routinely delete state to clear a claim.

Queue updates use revision checks. Old attempts cannot overwrite newer attempts,
and worker updates cannot restore a task that an operator blocked during a
request. Execution, assignment and message persistence are separate transactions:
a result can be saved before queue/handoff publication fails. Preserve the result
and exact request, inspect the queue, and retry only an unchanged publication when
appropriate. A 503 handoff response explicitly means the saved result needs
delivery. Never repeat the model job merely because publication failed.

## Standalone worker status

`team:worker` includes a tested single-child supervisor with a maximum 180-second
wall time, lease heartbeats, bounded result parsing and compact local receipts.
Its standalone Codex adapter currently fails before claiming work: a blanket
per-invocation disable for configured MCP tools has not been verified. A shell
read-only sandbox alone does not constrain those tools. No provider, model,
account or global configuration is substituted to bypass this boundary. Use the
connected-agent loop above for actual work.

The automated supervisor tests use synthetic child processes. They are not model
execution evidence. Declared assignment budgets do not enforce token or monetary
limits. Unknown detached descendants preserve the reservation and require
operator investigation; only owned process groups are signaled.
