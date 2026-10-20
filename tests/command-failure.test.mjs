import { expect, it } from "vitest";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { command, failureReason } from "../server/git.mjs";

it("includes the command's own stderr when it exits non-zero", async () => {
  const root = await mkdtemp(join(tmpdir(), "merge-monitor-cmd-"));
  try {
    // Stand-in for agent-task, which is not installed in CI or the cloud.
    const fake = join(root, "agent-task");
    await writeFile(
      fake,
      "#!/bin/sh\necho 'BLOCKED: Not a Git repository: /tmp/gone' >&2\nexit 2\n",
    );
    await chmod(fake, 0o755);
    const failure = await command(fake, ["status"]).catch((error) => error);
    expect(failure.message).toContain("inspection failed (exit 2)");
    expect(failure.message).toContain(
      "BLOCKED: Not a Git repository: /tmp/gone",
    );
    expect(failure.cause.code).toBe(2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("trims, caps and masks credentials in failure output", () => {
  const reason = failureReason({
    stderr: `  fatal: GITHUB_TOKEN=abc123 https://user:pw@example.com ghp_${"x".repeat(30)} Bearer abc.def\n${"y".repeat(600)}`,
  });
  expect(reason.length).toBeLessThanOrEqual(300);
  expect(reason).not.toMatch(/abc123|user:pw|ghp_x|abc\.def|\n/);
  expect(reason).toContain("GITHUB_TOKEN=[redacted]");
  expect(failureReason({ stderr: "", stdout: "" })).toBe("");
});
