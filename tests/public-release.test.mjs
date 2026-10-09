import { afterEach, expect, it } from "vitest";
import { mkdir, readFile, writeFile, readdir, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { repository } from "./fixtures.mjs";

const fixtures = [];
afterEach(async () => { await Promise.all(fixtures.splice(0).map((f) => f.cleanup())); });
async function candidate() {
  const f = await repository();
  fixtures.push(f);
  const put = async (path, body) => { await mkdir(dirname(join(f.path, path)), { recursive: true }); await writeFile(join(f.path, path), body); };
  await put("scripts/export-public.mjs", await readFile(new URL("../scripts/export-public.mjs", import.meta.url)));
  await put("package.json", JSON.stringify({ name: "fixture", private: true }));
  await put("package-lock.json", JSON.stringify({ packages: { "": {} } }));
  await put("docs/public-release/LICENSE.txt", "MIT License\nFixture for export tests.\n");
  for (const file of ["README.md", "CONTRIBUTING.md", "SECURITY.md"]) await put(`docs/public-release/${file}`, "Public documentation\n");
  await put("docs/openapi.json", "{}\n");
  await put("src/demo.ts", "export const demo = true;\n");
  await put("monitor.config.json", JSON.stringify({ path: "/private/local/project" }));
  await put("docs/plans/private.md", "Private plan marker\n");
  await put(".env", "PRIVATE_TEST_MARKER=example\n");
  f.git(["add", "."]);
  f.git(["commit", "-m", "release fixture"]);
  const bin = join(f.root, "bin");
  await mkdir(bin);
  await writeFile(join(bin, "gitleaks"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const run = (output) => execFileSync(process.execPath, [join(f.path, "scripts/export-public.mjs"), output], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, stdio: "pipe" });
  return { ...f, put, bin, run, output: join(f.root, "candidate") };
}

it("exports committed allowlisted files with hashes, excluding private config, plans and history", async () => {
  const f = await candidate();
  f.run(f.output);
  const manifest = JSON.parse(await readFile(join(f.output, "RELEASE-MANIFEST.json"), "utf8"));
  expect(manifest.sourceCommit).toBe(f.git(["rev-parse", "HEAD"]));
  expect(manifest.includesGitHistory).toBe(false);
  expect(await readdir(f.output)).not.toContain(".git");
  expect(await readdir(f.output)).not.toContain(".env");
  expect(await readFile(join(f.output, "monitor.config.json"), "utf8")).not.toContain("/private/local/project");
  expect(await readFile(join(f.output, "monitor.config.example.json"), "utf8")).toBe(await readFile(join(f.output, "monitor.config.json"), "utf8"));
  await expect(stat(join(f.output, "docs/plans/private.md"))).rejects.toThrow();
  for (const { path, sha256 } of manifest.files) expect(createHash("sha256").update(await readFile(join(f.output, path))).digest("hex")).toBe(sha256);
  expect(JSON.parse(await readFile(join(f.output, "package.json"), "utf8")).license).toBe("MIT");
});

it("refuses dirty sources and an existing destination without altering either", async () => {
  const f = await candidate();
  await f.put("src/demo.ts", "uncommitted change\n");
  expect(() => f.run(f.output)).toThrow();
  await expect(stat(f.output)).rejects.toThrow();
  f.git(["add", "."]); f.git(["commit", "-m", "update fixture"]);
  await mkdir(f.output); await writeFile(join(f.output, "keep.txt"), "keep\n");
  expect(() => f.run(f.output)).toThrow();
  expect(await readFile(join(f.output, "keep.txt"), "utf8")).toBe("keep\n");
});

it("removes only its new candidate if the secret scan rejects it", async () => {
  const f = await candidate();
  await writeFile(join(f.bin, "gitleaks"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  expect(() => f.run(f.output)).toThrow();
  await expect(stat(f.output)).rejects.toThrow();
  expect(await readFile(join(f.path, "src/demo.ts"), "utf8")).toContain("demo = true");
});

it("marks a candidate with a pending license as unlicensed and blocked for publication", async () => {
  const f = await candidate();
  await f.put("docs/public-release/LICENSE.txt", "License decision pending\nAll rights reserved.\n");
  f.git(["add", "."]); f.git(["commit", "-m", "pending license"]);
  f.run(f.output);
  const manifest = JSON.parse(await readFile(join(f.output, "RELEASE-MANIFEST.json"), "utf8"));
  expect(manifest.publication).toBe("blocked-license-selection");
  expect(manifest.license).toBe("UNLICENSED");
});
