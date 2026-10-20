import { readFile, realpath } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

export const { version } = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const execute = promisify(execFile);
const commitPattern = /^[a-f0-9]{40,64}$/;
export async function releaseIdentity(root) {
  const result = {
    version,
    commit: null,
    sourceDirty: null,
    startedAt: new Date().toISOString(),
  };
  try {
    const options = {
      cwd: root,
      timeout: 3000,
      maxBuffer: 1024 * 1024,
      encoding: "utf8",
    };
    const top = (
      await execute("git", ["rev-parse", "--show-toplevel"], options)
    ).stdout.trim();
    if ((await realpath(top)) !== (await realpath(root)))
      throw new Error("Not the application Git root.");
    const head = (
      await execute("git", ["rev-parse", "HEAD"], options)
    ).stdout.trim();
    const status = (await execute("git", ["status", "--porcelain"], options))
      .stdout;
    if (commitPattern.test(head)) {
      result.commit = head;
      result.sourceDirty = Boolean(status.trim());
    }
  } catch {
    // Portable source exports retain audited source provenance without Git history.
    try {
      const manifest = JSON.parse(
        await readFile(resolve(root, "RELEASE-MANIFEST.json"), "utf8"),
      );
      if (commitPattern.test(manifest.sourceCommit))
        result.commit = manifest.sourceCommit;
    } catch {
      /* Unknown provenance is reported explicitly. */
    }
  }
  return Object.freeze(result);
}
