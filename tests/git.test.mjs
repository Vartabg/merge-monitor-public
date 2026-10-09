import { afterEach, describe, expect, it } from "vitest";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { repository } from "./fixtures.mjs";
import { resolveBase, previewMerge } from "../server/git.mjs";
import { inspectRepository } from "../server/inspection.mjs";

const fixtures = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
});
async function setup(branch) {
  const f = await repository(branch);
  fixtures.push(f);
  return f;
}

describe("real Git regressions", () => {
  it("preserves unusual filenames and counts a rename as one local change", async () => {
    const f = await setup();
    const path = await f.addTask(
      "rename",
      { "sp ace.txt": "local" },
      "WORKING",
      false,
    );
    f.git(["mv", "shared.txt", "new\nname.txt"], path);
    const status = await inspectRepository(f.repo, {
      readStatus: f.readStatus,
    });
    const task = status.worktrees.find((w) => w.branch === "codex/rename");
    expect(task.changedFiles).toEqual([
      "new\nname.txt",
      "shared.txt",
      "sp ace.txt",
    ]);
    expect(task.dirty).toBe(2);
  });
  it.each(["main", "master", "trunk"])(
    "resolves %s without assuming master",
    async (branch) => {
      const f = await setup(branch);
      expect((await resolveBase(f.repo)).ref).toBe(
        `refs/remotes/origin/${branch}`,
      );
    },
  );

  it("includes overlaps beyond file 80 and uncommitted files", async () => {
    const f = await setup();
    const files = Object.fromEntries(
      Array.from({ length: 85 }, (_, i) => [`a${i}.txt`, "task\n"]),
    );
    files["z-shared.txt"] = "one\n";
    await f.addTask("large", files);
    await f.addTask("working", { "z-shared.txt": "two\n" }, "WORKING", false);
    const status = await inspectRepository(f.repo, {
      readStatus: f.readStatus,
    });
    expect(status.conflicts).toContainEqual({
      file: "z-shared.txt",
      branches: ["codex/large", "codex/working"],
    });
    expect(
      status.worktrees.find((w) => w.branch === "codex/large").changedFiles,
    ).toHaveLength(86);
    expect(
      status.worktrees.find((w) => w.branch === "codex/large").category,
    ).toBe("attention");
  });

  it("previews without changing the primary branch, index, dirty files, or refs", async () => {
    const f = await setup();
    await f.addTask("clean", { "new.txt": "hello\n" });
    await writeFile(join(f.path, "shared.txt"), "local change\n");
    f.git(["add", "shared.txt"]);
    const before = {
      refs: f.git(["show-ref"]),
      status: f.git(["status", "--porcelain"]),
      branch: f.git(["branch", "--show-current"]),
    };
    const result = await previewMerge(f.repo, "codex/clean");
    expect(result.outcome).toBe("clean");
    expect({
      refs: f.git(["show-ref"]),
      status: f.git(["status", "--porcelain"]),
      branch: f.git(["branch", "--show-current"]),
    }).toEqual(before);
    expect(await readFile(join(f.path, "shared.txt"), "utf8")).toBe(
      "local change\n",
    );
  });

  it("detects conflicts with the current base, including base movement after inspection", async () => {
    const f = await setup();
    await f.addTask("conflict", { "shared.txt": "task\n" });
    const oldBase = (await resolveBase(f.repo)).sha;
    await writeFile(join(f.path, "shared.txt"), "base moved\n");
    f.git(["add", "."]);
    f.git(["commit", "-m", "base moved"]);
    f.git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
    expect(
      (await previewMerge(f.repo, "codex/conflict", { baseSha: oldBase }))
        .outcome,
    ).toBe("stale");
    expect((await previewMerge(f.repo, "codex/conflict")).outcome).toBe(
      "conflict",
    );
  });

  it("rejects malformed and missing branch names without executing shell text", async () => {
    const f = await setup();
    await expect(
      previewMerge(f.repo, "codex/x; echo injected"),
    ).rejects.toThrow();
    await expect(previewMerge(f.repo, "--help")).rejects.toThrow();
    await expect(previewMerge(f.repo, "codex/missing")).rejects.toThrow();
  });

  it("fails closed if the configured base cannot be resolved", async () => {
    const f = await setup();
    await expect(
      resolveBase({ ...f.repo, defaultBranch: "missing" }),
    ).rejects.toThrow();
  });

  it("keeps excluded branches out of readiness and recognizes already merged work", async () => {
    const f = await setup();
    await f.addTask("parked", { "parked.txt": "hold\n" });
    f.git(["worktree", "add", "-b", "codex/done", join(f.root, "done")]);
    f.rows.push({
      path: join(f.root, "done"),
      branch: "codex/done",
      primary: false,
      state: "COMPLETE",
      dirty: 0,
    });
    const status = await inspectRepository(
      { ...f.repo, excludedBranches: ["codex/parked"] },
      { readStatus: f.readStatus },
    );
    expect(
      status.worktrees.find((w) => w.branch === "codex/parked").category,
    ).toBe("attention");
    expect(
      status.worktrees.find((w) => w.branch === "codex/done").category,
    ).toBe("finished");
  });
});
