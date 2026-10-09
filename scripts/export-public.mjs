import { execFileSync } from "node:child_process";
import { mkdir, writeFile, lstat, rm, mkdtemp } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = process.argv[2] && resolve(process.argv[2]);
if (!output || output === root || output.startsWith(`${root}/`)) throw new Error("Choose a new output directory outside the repository.");
if (await lstat(output).then(() => true, (error) => { if (error.code === "ENOENT") return false; throw error; })) throw new Error("Output already exists; choose a new directory.");
const git = (args, encoding = "utf8") => execFileSync("git", ["-C", root, ...args], { encoding, maxBuffer: 32 * 1024 * 1024 });
if (git(["status", "--porcelain"]).trim()) throw new Error("Commit and verify the release candidate before exporting it.");
const commit = git(["rev-parse", "HEAD"]).trim();
const read = (path) => git(["show", `${commit}:${path}`], null);
const roots = new Set(["package.json", "package-lock.json", "index.html", "orchestrator.mjs", "tsconfig.json", "vite.config.ts", "vitest.config.ts", "eslint.config.mjs"]);
const source = git(["ls-tree", "-rz", "--name-only", commit]).split("\0").filter((path) => roots.has(path) || /^(src|server|tests)\/.*\.(mjs|ts|tsx|css|json)$/.test(path) || /^scripts\/.*\.mjs$/.test(path) || /^docs\/public-release\/[^/]+\.(md|txt)$/.test(path));
const license = read("docs/public-release/LICENSE.txt");
const licensed = license.toString().startsWith("MIT License\n");
if (!licensed && !license.toString().startsWith("License decision pending\n")) throw new Error("Unrecognized release license. Review it before exporting.");
const files = new Map(source.map((path) => [path, read(path)]));
for (const [path, sourcePath] of Object.entries({ "README.md": "docs/public-release/README.md", "CONTRIBUTING.md": "docs/public-release/CONTRIBUTING.md", "SECURITY.md": "docs/public-release/SECURITY.md" })) files.set(path, read(sourcePath));
files.set("LICENSE", license);
for (const path of ["docs/openapi.json"]) files.set(path, read(path));
const pkg = JSON.parse(files.get("package.json"));
pkg.license = licensed ? "MIT" : "UNLICENSED";
files.set("package.json", Buffer.from(`${JSON.stringify(pkg, null, 2)}\n`));
const lock = JSON.parse(files.get("package-lock.json"));
lock.packages[""].license = pkg.license;
files.set("package-lock.json", Buffer.from(`${JSON.stringify(lock, null, 2)}\n`));
files.set("monitor.config.json", Buffer.from(`${JSON.stringify({ repos: [{ id: "example", label: "Your project", path: "code/your-project" }], defaultRepo: "example" }, null, 2)}\n`));
files.set("monitor.config.example.json", files.get("monitor.config.json"));
files.set(".gitignore", Buffer.from("node_modules/\ndist/\ncoverage/\n*.log\n.DS_Store\n.env*\nmonitor.config.json\n"));
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
