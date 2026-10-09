# Public release candidate

This work prepares a new public source snapshot. It does not change the visibility of the private working repository, expose its history, merge other pending feature work, or publish a package.

## Publication decisions

- The release uses MIT, matching JobPilot, with copyright held by Garo Vartabedian.
- Publish a fresh audited snapshot to the separate Vartabg/merge-monitor-public repository. Exported files and hashes are reviewed before publication.
- The owner authorized shipping the prepared release on October 9, 2026. Update the website source link and release status after anonymous access works.

## Prepare and inspect

From a clean, committed task worktree after `npm run verify`:

```sh
node scripts/demo-handoff.mjs
node scripts/export-public.mjs /absolute/path/to/new-candidate-directory
```

The exporter copies committed files from an allowlist, identifies a selected MIT license or a pending decision, writes generic configuration and public documentation, produces per-file SHA-256 hashes, and runs a redacted Gitleaks scan. Existing output directories and dirty worktrees are rejected. Failed exports remove only their newly created output directory. It never copies .git, live state, personal config, internal plans or historical snapshots.

Follow the exported README in a separate copy: initialize a new Git repository, configure a disposable sample project, install dependencies, commit the imported source, and run verification plus the scripted handoff. Test without agent-task on PATH to confirm portability. Preserve the manifest and local verification report with the candidate.

Before publishing, inspect the actual archive and its manifest for sensitive material, confirm dependencies and licenses, and link the published source from the case study. The owner must approve the reviewed candidate; preparation alone is not publication authorization.

## Scope

This candidate starts with the existing board workflow. The separate structured-finding and outcome-evidence branches are not included or represented as shipped. The illustration teaches an evidence-first workflow; the board does not enforce the truth of submitted verification claims.
