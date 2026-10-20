# Recover a saved decision

Common Ground owns the original saved words. In **Keep this**, choose **Save as a searchable decision**, record its project folder and topic, and leave missing terms explicit. Its source chat is the selected Codex chat. An optional pasted excerpt and turn reference help check the evidence; neither the excerpt nor the declared status is independently verified. Keep suggestions as proposed, open questions as unresolved, and replace old decisions by marking them superseded.

Merge Monitor MCP and terminal check-ins now include `savedDecisions` relevant to the agent's task and scope. Each result includes its declared status, original `codex://threads/<id>` link, optional source excerpt/turn, and return step. Check-in text and quote excerpts are capped at 600 characters and marked `truncated`; an intentional search returns the full saved words. At most five results are returned, with match/omission counts. Read receipts and request resolution remain separate.

Use `team_search_decisions` with the configured `project` and remembered `query`, or:

```sh
npm run --silent board -- decisions --project garovartabedian --query 'Excel landing menu'
```

The search includes active project board decisions and Common Ground decisions. Older relevant board decisions are included before filling the brief with recent ones. No lexical match returns no saved decision; it never guesses missing terms. Superseded Common Ground decisions remain in Common Ground but are omitted from agent recall. Board decisions retain their existing resolution semantics.

## Source and project boundary

The reader defaults to `~/Library/Application Support/Common Ground/settings.json`. An explicit alternate private state directory can be supplied as `MERGE_MONITOR_COMMON_GROUND_STATE_DIR` in the MCP or CLI process environment. Supply the canonical directory path; file/directory/ancestor symlinks are rejected. Only the fixed `settings.json` file is read, with a 48 KB ceiling, strict decision fields and validated source chat identifiers. Goals, drafts and unrelated note contents are never returned to the agent.

Project folders match a verified Git common directory, including linked worktrees and nested folders, or an exact canonical folder for non-Git projects. Similar names, parent directory prefixes and cloned remote URLs do not match. Only the selected configured project is searched. The reader does not run Git commands, read transcripts, call a model, write notes, contact Common Ground's server, or change installed app state.

An unavailable, oversized, malformed or unsafe store is labeled `decisionRecall.status: unavailable`, with no reconstructed terms. It does not fail a saved check-in. A valid store without matches is `available` with an empty result. An unavailable source is not evidence that a decision never existed. Every check reads current saved state; supersession is not hidden behind a cache.

## Verification and operating limits

Tests use private synthetic settings and real temporary Git primary/worktree/clone fixtures. They cover old decisions beyond recent noise, exact source links and unknowns, explicit source failure, cross-project isolation, malicious metadata, source symlinks, bounded excerpts, CLI/MCP parity, unchanged read receipts and refreshed status.

This integration can be verified against a private Common Ground preview by pointing the MCP/CLI process at that preview's canonical state directory. Building this feature does not lift Common Ground's existing installation and manual acceptance hold. Normal merged-source installation remains a separate release boundary.
