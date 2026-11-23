import { execFileSync } from "node:child_process";
import { mkdir, writeFile, lstat, rm, mkdtemp } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { homedir, tmpdir, userInfo } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const USER_PATH_RE = /\/(?:Users|home)\/(?!(?:you|test)(?![A-Za-z0-9._-]))[A-Za-z0-9._-]+/;
const GUIDE_REPO_RE = /\/Users\/(?!(?:you|test)(?![A-Za-z0-9._-]))[A-Za-z0-9._-]+\/code\/merge-monitor/g;
const GENERIC_USERNAMES = new Set([
  "root",
  "user",
  "test",
  "node",
  "admin",
  "runner",
  "agent",
  "ci",
  "dev",
  "coder",
  "builder",
  "owner",
  "you",
  "alice",
  "ubuntu",
  "vscode",
  "codespace",
  "nobody",
]);

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertCleanExport(files) {
  const home = homedir();
  const checkHome =
    home &&
    !["/", "/Users/you", "/Users/test", "/home/you", "/home/test"].includes(home)
      ? home
      : "";
  let username = "";
  try {
    username = userInfo().username || "";
  } catch {
    /* userInfo may fail in minimal containers */
  }
  const usernameRe =
    username.length >= 4 && !GENERIC_USERNAMES.has(username.toLowerCase())
      ? new RegExp(`\\b${escapeRegex(username)}\\b`, "i")
      : null;

  for (const [path, data] of files) {
    const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
    if (
      USER_PATH_RE.test(text) ||
      (checkHome && text.includes(checkHome)) ||
      (usernameRe && usernameRe.test(text))
    ) {
      throw new Error(
        `Refusing export: personal path or username found in ${path}.`,
      );
    }
  }
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = process.argv[2] && resolve(process.argv[2]);
if (!output || output === root || output.startsWith(`${root}/`)) throw new Error("Choose a new output directory outside the repository.");
if (await lstat(output).then(() => true, (error) => { if (error.code === "ENOENT") return false; throw error; })) throw new Error("Output already exists; choose a new directory.");
const git = (args, encoding = "utf8") => execFileSync("git", ["-C", root, ...args], { encoding, maxBuffer: 32 * 1024 * 1024 });
if (git(["status", "--porcelain"]).trim()) throw new Error("Commit and verify the release candidate before exporting it.");
const commit = git(["rev-parse", "HEAD"]).trim();
const read = (path) => git(["show", `${commit}:${path}`], null);
const roots = new Set(["package.json", "package-lock.json", "index.html", "orchestrator.mjs", "tsconfig.json", "vite.config.ts", "vitest.config.ts", "eslint.config.mjs", "dispatch.config.example.json"]);
const publicDocs = new Set(["README.md", "CONTRIBUTING.md", "SECURITY.md", "LICENSE.txt"].map((name) => `docs/public-release/${name}`));
const guides = new Set(["docs/TEAM_BOARD.md", "docs/TEAM_WORKERS.md", "docs/TEAM_DISPATCH.md", "docs/SAVED_DECISIONS.md"]);
const allCommitted = git(["ls-tree", "-rz", "--name-only", commit]).split("\0").filter(Boolean);
const committedSet = new Set(allCommitted);
const source = allCommitted.filter((path) => roots.has(path) || publicDocs.has(path) || guides.has(path) || /^docs\/assets\/[a-z0-9-]+\.png$/.test(path) || /^(src|server|tests)\/.*\.(mjs|ts|tsx|css|json)$/.test(path) || /^scripts\/.*\.mjs$/.test(path));
const license = read("docs/public-release/LICENSE.txt");
const licensed = license.toString().startsWith("MIT License\n");
if (!licensed && !license.toString().startsWith("License decision pending\n")) throw new Error("Unrecognized release license. Review it before exporting.");
const files = new Map(source.map((path) => [path, read(path)]));
for (const path of guides) {
  if (!files.has(path)) continue;
  const cleaned = files
    .get(path)
    .toString()
    .replaceAll(root, "/absolute/path/to/merge-monitor")
    .replaceAll(GUIDE_REPO_RE, "/absolute/path/to/merge-monitor");
  files.set(path, Buffer.from(cleaned));
}
for (const [path, sourcePath] of Object.entries({ "README.md": "docs/public-release/README.md", "CONTRIBUTING.md": "docs/public-release/CONTRIBUTING.md", "SECURITY.md": "docs/public-release/SECURITY.md" })) files.set(path, read(sourcePath));
if (committedSet.has("docs/public-release/CHANGELOG.md")) {
  files.set("CHANGELOG.md", read("docs/public-release/CHANGELOG.md"));
}
files.set("LICENSE", license);
for (const path of ["docs/openapi.json"]) files.set(path, read(path));
const pkg = JSON.parse(files.get("package.json"));
pkg.license = licensed ? "MIT" : "UNLICENSED";
if (licensed) {
  pkg.description =
    pkg.description ||
    "Local loopback workspace for parallel coding agents to share goals, decisions, evidence-backed handoffs, and Git worktree overlap checks.";
  pkg.homepage = "https://garovartabedian.com/work/merge-monitor";
  pkg.repository = {
    type: "git",
    url: "https://github.com/Vartabg/merge-monitor-public.git",
  };
  pkg.bugs = {
    url: "https://github.com/Vartabg/merge-monitor-public/issues",
  };
  pkg.keywords = [
    "mcp",
    "model-context-protocol",
    "coding-agents",
    "multi-agent",
    "local-first",
    "git-worktrees",
    "developer-tools",
  ];
}
files.set("package.json", Buffer.from(`${JSON.stringify(pkg, null, 2)}\n`));
const lock = JSON.parse(files.get("package-lock.json"));
lock.packages[""].license = pkg.license;
files.set("package-lock.json", Buffer.from(`${JSON.stringify(lock, null, 2)}\n`));
files.set("monitor.config.example.json", Buffer.from(`${JSON.stringify({ repos: [{ id: "example", label: "Your project", path: "code/your-project" }], defaultRepo: "example" }, null, 2)}\n`));
files.set(".gitignore", Buffer.from("node_modules/\ndist/\ncoverage/\n*.log\n.DS_Store\n.env*\nmonitor.config.json\ndispatch.config.json\n"));
assertCleanExport(files);
const hashes = [...files].sort(([a], [b]) => a.localeCompare(b)).map(([path, data]) => ({ path, sha256: createHash("sha256").update(data).digest("hex") }));
files.set("RELEASE-MANIFEST.json", Buffer.from(`${JSON.stringify({ format: 1, sourceCommit: commit, publication: licensed ? "unpublished-candidate" : "blocked-license-selection", license: pkg.license, includesGitHistory: false, files: hashes }, null, 2)}\n`));
await mkdir(output, { recursive: false });
try {
  for (const [path, data] of files) { await mkdir(dirname(resolve(output, path)), { recursive: true }); await writeFile(resolve(output, path), data); }
  const scanReport = join(await mkdtemp(join(tmpdir(), "merge-monitor-public-scan-")), "report.json");
  console.log(`Redacted scan report: ${scanReport}`);
  execFileSync("gitleaks", ["dir", output, "--redact", "--no-banner", "--report-format", "json", "--report-path", scanReport], { stdio: "inherit" });
} catch (error) {
  await rm(output, { recursive: true, force: true });
  throw error;
}
console.log(`Unpublished source snapshot: ${output}\nSource: ${commit}\nFiles: ${files.size}\nLicense: ${pkg.license}\nNo private Git history, personal configuration, or internal planning documents included.`);
