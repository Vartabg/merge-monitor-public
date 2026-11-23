import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { startServer } from "../server/index.mjs";

const DEFAULT_DEMO_PORT = 5174;
const GIT_ISOLATION_FLAGS = [
  "-c",
  "user.name=Demo User",
  "-c",
  "user.email=demo@example.com",
  "-c",
  "commit.gpgsign=false",
  "-c",
  "init.defaultBranch=main",
];

export function parseDemoPort(argv = [], env = process.env) {
  let raw;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--port") {
      if (i + 1 >= argv.length) {
        throw new Error("Missing value after --port.");
      }
      raw = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--port=")) {
      raw = arg.slice("--port=".length);
    }
  }
  if (raw === undefined) raw = env.PORT;
  if (raw === undefined || raw === "") return DEFAULT_DEMO_PORT;
  if (!/^\d+$/.test(String(raw))) {
    throw new Error(`Invalid port "${raw}". Use an integer between 0 and 65535.`);
  }
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(`Invalid port "${raw}". Use an integer between 0 and 65535.`);
  }
  return parsed;
}

function git(cwd, args) {
  return execFileSync("git", [...GIT_ISOLATION_FLAGS, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function writeText(filePath, content) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

async function seedDemoRepository(tempRoot) {
  const repoDir = join(tempRoot, "demo-app");
  await mkdir(repoDir, { recursive: true });
  git(repoDir, ["init"]);
  await writeText(
    join(repoDir, "src/billing/webhook.ts"),
    [
      "export async function deliverWebhook(eventId: string, attempt = 1) {",
      "  const delayMs = attempt * 250;",
      "  return { eventId, attempt, delayMs, status: 'sent' };",
      "}",
      "",
    ].join("\n"),
  );
  await writeText(
    join(repoDir, "src/billing/idempotency.ts"),
    [
      "export function idempotencyKey(merchantId: string, eventId: string) {",
      "  return `${merchantId}:${eventId}`;",
      "}",
      "",
    ].join("\n"),
  );
  await writeText(
    join(repoDir, "docs/webhooks.md"),
    [
      "# Webhook delivery",
      "",
      "Billing webhooks use per-merchant idempotency keys.",
      "",
    ].join("\n"),
  );
  git(repoDir, ["add", "."]);
  git(repoDir, ["commit", "-m", "Initial checkout webhook baseline"]);

  const wtRetries = join(tempRoot, "wt-webhook-retries");
  git(repoDir, ["worktree", "add", "-b", "fix/webhook-retries", wtRetries, "main"]);
  await writeText(
    join(wtRetries, "src/billing/webhook.ts"),
    [
      "export async function deliverWebhook(eventId: string, attempt = 1) {",
      "  const cappedAttempt = Math.min(attempt, 3);",
      "  const delayMs = 2 ** cappedAttempt * 250;",
      "  return { eventId, attempt: cappedAttempt, delayMs, status: 'sent' };",
      "}",
      "",
    ].join("\n"),
  );
  git(wtRetries, ["add", "src/billing/webhook.ts"]);
  git(wtRetries, ["commit", "-m", "Cap webhook retry backoff at 3 attempts"]);

  const wtRateLimit = join(tempRoot, "wt-rate-limit");
  git(repoDir, ["worktree", "add", "-b", "feat/rate-limit-guard", wtRateLimit, "main"]);
  await writeText(
    join(wtRateLimit, "src/billing/webhook.ts"),
    [
      "export async function deliverWebhook(eventId: string, attempt = 1, merchantId = 'default') {",
      "  const delayMs = attempt * 250;",
      "  return { eventId, merchantId, attempt, delayMs, rateLimited: false, status: 'sent' };",
      "}",
      "",
    ].join("\n"),
  );
  git(wtRateLimit, ["add", "src/billing/webhook.ts"]);
  git(wtRateLimit, ["commit", "-m", "Add merchant rate-limit context to webhook delivery"]);

  const wtDocs = join(tempRoot, "wt-api-docs");
  git(repoDir, ["worktree", "add", "-b", "docs/webhook-notes", wtDocs, "main"]);
  await writeText(
    join(wtDocs, "docs/webhooks.md"),
    [
      "# Webhook delivery",
      "",
      "Billing webhooks use per-merchant idempotency keys and bounded retry delays.",
      "",
    ].join("\n"),
  );
  git(wtDocs, ["add", "docs/webhooks.md"]);
  git(wtDocs, ["commit", "-m", "Document bounded webhook retry delays"]);

  return { repoDir, wtRetries, wtRateLimit, wtDocs };
}

async function seedDemoWorkspace(service, repoDir) {
  const project = "demo-app";

  // 1. Check in synthetic agents first (required before setting goal or posting).
  const members = [
    {
      agent: "claude-builder",
      task: "Implement capped webhook retry backoff on fix/webhook-retries",
      scope: "src/billing/webhook.ts and retry unit tests",
      state: "working",
    },
    {
      agent: "codex-reviewer",
      task: "Review retry backoff and rate-limit branches for shared-file overlap",
      scope: "Read-only review of src/billing/* and test evidence",
      state: "working",
    },
    {
      agent: "opencode-tests",
      task: "Add per-merchant rate-limit guard tests on feat/rate-limit-guard",
      scope: "src/billing/webhook.ts and rate-limit fixtures",
      state: "idle",
    },
    {
      agent: "docs-helper",
      task: "Document webhook retry policy in docs/webhooks.md",
      scope: "docs/webhooks.md",
      state: "done",
    },
  ];
  for (const member of members) {
    await service.board.command("check-in", { project, ...member });
  }

  // 2. Set the shared project goal.
  await service.board.command("goal", {
    project,
    agent: "claude-builder",
    revision: 0,
    goal: "Ship webhook retry hardening without breaking idempotent billing callbacks.",
  });

  // 3. Post synthetic decision, owner question, FYI update, and blocking finding handoff (newest open request on top).
  await service.board.command("post", {
    project,
    agent: "claude-builder",
    to: "",
    kind: "decision",
    attention: "fyi",
    replyTo: "",
    requestId: randomUUID(),
    text: "Scope webhook idempotency keys per merchant account; never rewrite stored payload bodies during retries.",
  });

  await service.board.command("post", {
    project,
    agent: "claude-builder",
    to: "human",
    kind: "question",
    attention: "action",
    replyTo: "",
    requestId: randomUUID(),
    text: "Should failed billing webhooks dead-letter after 3 attempts (~3.5s total backoff) or 5 attempts before alerting support?",
  });

  await service.board.command("post", {
    project,
    agent: "docs-helper",
    to: "human",
    kind: "update",
    attention: "fyi",
    replyTo: "",
    requestId: randomUUID(),
    text: "Updated docs/webhooks.md on docs/webhook-notes with the bounded retry policy. No overlap with billing source files.",
  });

  await service.board.command("post", {
    project,
    agent: "codex-reviewer",
    to: "claude-builder",
    kind: "handoff",
    attention: "action",
    replyTo: "",
    requestId: randomUUID(),
    text: "Retry loop still drops the idempotency header on attempt 3 and overlaps with feat/rate-limit-guard on src/billing/webhook.ts. Reply with test output before resolving.",
    finding: {
      claim: "Attempt 3 omits the per-merchant idempotency key header after timeout recovery.",
      evidence: "src/billing/webhook.ts on fix/webhook-retries: retry helper rebuilds headers without merchantId.",
      expected: "Every retry attempt sends the original merchantId:eventId idempotency key.",
      actual: "Attempt 3 sends a request without the idempotency key, risking duplicate billing charges.",
      severity: "blocking",
      scope: "src/billing/webhook.ts and webhook retry tests only; coordinate with feat/rate-limit-guard.",
      doneCheck: "Retry unit test asserts identical idempotency key across attempts 1, 2, and 3.",
    },
  });
  const handoff = service.board
    .view(project)
    .room.messages.find((m) => m.kind === "handoff");

  // 4. Acknowledge the finding handoff — intentionally leaving it open/pending (Acknowledge != Resolve).
  if (handoff) {
    await service.board.command("ack", {
      project,
      agent: "claude-builder",
      messageId: handoff.id,
    });
  }

  // 5. Seed Assignments (?view=team) using exact canonical fields and valid transitions.
  const retryAssignment = await service.assignments.create({
    title: "Harden webhook retry backoff",
    project,
    purpose: "Prevent duplicate billing charges when downstream webhook receivers time out.",
    owner: "claude-builder",
    model: "claude",
    reviewer: "codex-reviewer",
    scope: "src/billing/webhook.ts and retry unit tests on fix/webhook-retries",
    acceptance: "3-attempt capped exponential backoff with preserved per-merchant idempotency key.",
    budget: "1 bounded task",
  });
  const retryWorking = await service.assignments.update({
    id: retryAssignment.id,
    revision: retryAssignment.revision,
    status: "working",
    summary: "Implementing capped exponential backoff in src/billing/webhook.ts.",
    artifacts: [],
    reviewNote: "",
  });
  await service.assignments.update({
    id: retryWorking.id,
    revision: retryWorking.revision,
    status: "review",
    summary: "Capped retry backoff implemented on fix/webhook-retries; awaiting independent review of idempotency header preservation.",
    artifacts: [join(repoDir, "src/billing/webhook.ts")],
    reviewNote: "",
  });

  const rateLimitAssignment = await service.assignments.create({
    title: "Add per-merchant rate-limit guard",
    project,
    purpose: "Prevent noisy merchants from saturating shared webhook delivery workers.",
    owner: "opencode-tests",
    model: "opencode",
    reviewer: "codex-reviewer",
    scope: "src/billing/webhook.ts and rate-limit fixtures on feat/rate-limit-guard",
    acceptance: "Rate-limit guard enforces merchant quota without dropping queued idempotency keys.",
    budget: "1 bounded task",
  });
  await service.assignments.update({
    id: rateLimitAssignment.id,
    revision: rateLimitAssignment.revision,
    status: "working",
    summary: "Adding merchant rate-limit context in src/billing/webhook.ts (shared-file overlap with fix/webhook-retries flagged in Project Checks).",
    artifacts: [],
    reviewNote: "",
  });
}

export async function startDemo({
  root = fileURLToPath(new URL("../", import.meta.url)),
  port = DEFAULT_DEMO_PORT,
} = {}) {
  const rawTempRoot = await mkdtemp(join(tmpdir(), "merge-monitor-demo-"));
  await chmod(rawTempRoot, 0o700);
  const tempRoot = await realpath(rawTempRoot);
  let closeServer = null;
  let cleanedUp = false;

  const cleanupDir = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    await rm(tempRoot, { recursive: true, force: true });
  };

  try {
    const { repoDir } = await seedDemoRepository(tempRoot);
    const configPath = join(tempRoot, "monitor.config.json");
    const stateDir = join(tempRoot, "state");
    await mkdir(stateDir, { mode: 0o700 });
    await chmod(stateDir, 0o700);
    const statePath = join(stateDir, "state.json");

    await writeFile(
      configPath,
      `${JSON.stringify(
        {
          repos: [
            {
              id: "demo-app",
              label: "Checkout API (demo)",
              path: repoDir,
              defaultBranch: "main",
            },
          ],
          defaultRepo: "demo-app",
        },
        null,
        2,
      )}\n`,
      { encoding: "utf8", mode: 0o600 },
    );

    const hasDist = await stat(resolve(root, "dist/index.html")).then(
      () => true,
      () => false,
    );

    const started = await startServer({
      root,
      port,
      configPath,
      statePath,
      startWorker: false,
      development: !hasDist,
    });
    closeServer = started.close;

    await seedDemoWorkspace(started.service, repoDir);
    await started.service.monitor.refresh("demo-app");

    const actualPort = started.server.address().port;
    const url = `http://127.0.0.1:${actualPort}`;

    let closePromise;
    const close = () => {
      if (closePromise) return closePromise;
      closePromise = (async () => {
        try {
          if (closeServer) await closeServer();
        } finally {
          await cleanupDir();
        }
      })();
      return closePromise;
    };

    return {
      url,
      port: actualPort,
      tempRoot,
      repoDir,
      development: !hasDist,
      service: started.service,
      close,
    };
  } catch (error) {
    if (closeServer) await closeServer().catch(() => undefined);
    await cleanupDir().catch(() => undefined);
    throw error;
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  let port;
  try {
    port = parseDemoPort(process.argv.slice(2), process.env);
  } catch (error) {
    console.error(`[Merge Monitor demo] ${error.message}`);
    process.exit(2);
  }
  try {
    const demo = await startDemo({ port });
    console.log("");
    console.log(
      `[Merge Monitor demo] Disposable workspace ready (mode: ${demo.development ? "vite-dev" : "production-dist"})`,
    );
    console.log(`  Board:          ${demo.url}/`);
    console.log(`  Assignments:    ${demo.url}/?view=team`);
    console.log(`  Project Checks: ${demo.url}/?view=checks`);
    console.log("");
    console.log(
      "  All repos, worktrees, and board state live in a temporary directory and are removed on exit.",
    );
    console.log("  Press Ctrl-C to stop.");
    for (const signal of ["SIGINT", "SIGTERM"]) {
      process.on(signal, () => {
        void demo.close().finally(() => process.exit(0));
      });
    }
  } catch (error) {
    if (error?.code === "EADDRINUSE") {
      const nextPort = port < 65535 ? port + 1 : 0;
      console.error(
        `[Merge Monitor demo] Port ${port} is in use. Retry with PORT=${nextPort} npm run demo.`,
      );
      process.exit(1);
    }
    console.error(`[Merge Monitor demo] Failed to start: ${error.message}`);
    process.exit(1);
  }
}
