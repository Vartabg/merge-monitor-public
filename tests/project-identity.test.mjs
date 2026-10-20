import { afterEach, beforeEach, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectIdentity } from "../scripts/project-identity.mjs";
import { commonGroundDecisions } from "../scripts/common-ground-decisions.mjs";

const run = promisify(execFile);
let root;
beforeEach(async () => { root = await realpath(await mkdtemp(join(tmpdir(), "project-identity-"))); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const git = (...args) => run("git", ["-c", "core.hooksPath=/dev/null", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", ...args], {
  cwd: root, env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" },
});
async function repositories() {
  const primary = join(root, "portfolio"), linked = join(root, "linked"), clone = join(root, "clone");
  await git("init", "--initial-branch=main", primary);
  await git("-C", primary, "commit", "--allow-empty", "-m", "Fixture");
  await git("-C", primary, "worktree", "add", "-b", "fixture-linked", linked);
  await git("clone", "--no-hardlinks", primary, clone);
  return { primary, linked, clone };
}

it("shares identity across a real linked worktree while isolating a clone and a prefix sibling", async () => {
  const { primary, linked, clone } = await repositories();
  const sibling = `${primary}-archive`;
  await git("init", "--initial-branch=main", sibling);
  const id = await projectIdentity(primary);
  expect(id).toBe(`git:${join(primary, ".git")}`);
  expect(await projectIdentity(linked)).toBe(id);
  const primaryNested = join(primary, "src", "work"), linkedNested = join(linked, "src", "work");
  await Promise.all([mkdir(primaryNested, { recursive: true }), mkdir(linkedNested, { recursive: true })]);
  expect(await projectIdentity(primaryNested)).toBe(id);
  expect(await projectIdentity(linkedNested)).toBe(id);
  expect(await projectIdentity(clone)).not.toBe(id);
  expect(await projectIdentity(sibling)).not.toBe(id);
});

it("recalls decisions saved from another worktree but never from a clone", async () => {
  const { primary, linked, clone } = await repositories();
  const stateDir = join(root, "private");
  await mkdir(stateDir);
  const decision = (id, projectPath) => ({
    id, threadId: "0199fd60-2c00-7000-8000-000000000001", kind: "decision", text: "Excel handler", returnPoint: "Settle scope",
    decision: { projectPath, topic: "Excel offering", status: "unresolved", quote: "Excel handler", sourceTurnId: "", recordedAt: "2026-10-19T12:00:00Z" },
  });
  await writeFile(join(stateDir, "settings.json"), JSON.stringify({ revision: 1, notes: [decision("primary", primary), decision("linked", linked), decision("clone", clone)] }));
  const result = await commonGroundDecisions([linked], "Excel", { stateDir });
  expect(result.status).toBe("available");
  expect(result.decisions.map((d) => d.id).sort()).toEqual(["linked", "primary"]);
});

it("does not unify malformed commondir paths pointing at a non-Git ancestor", async () => {
  const paths = [join(root, "first"), join(root, "second")];
  for (const path of paths) {
    const gitdir = join(path, ".git");
    await mkdir(gitdir, { recursive: true });
    await writeFile(join(gitdir, "commondir"), "../../\n");
  }
  expect(await projectIdentity(paths[0])).toBe(`path:${paths[0]}`);
  expect(await projectIdentity(paths[1])).toBe(`path:${paths[1]}`);
});

it("rejects an empty commondir instead of treating its own directory as a valid shared Git root", async () => {
  const primary = join(root, "portfolio");
  await git("init", "--initial-branch=main", primary);
  await writeFile(join(primary, ".git", "commondir"), "\n");
  expect(await projectIdentity(primary)).toBe(`path:${primary}`);
});

it("canonicalizes an ordinary project alias without trusting a symlinked Git marker", async () => {
  const primary = join(root, "portfolio"), alias = join(root, "alias"), impostor = join(root, "impostor");
  await git("init", "--initial-branch=main", primary);
  await symlink(primary, alias);
  expect(await projectIdentity(alias)).toBe(await projectIdentity(primary));
  await mkdir(impostor);
  await symlink(join(primary, ".git"), join(impostor, ".git"));
  expect(await projectIdentity(impostor)).toBe(`path:${impostor}`);
});
