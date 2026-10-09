import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";

if (process.platform !== "darwin")
  throw new Error(
    "This installer is for macOS. On other platforms, supervise npm start with your service manager.",
  );
const execute = promisify(execFile);
const root = await realpath(process.cwd());
const git = async (args) =>
  (
    await execute("git", ["-C", root, ...args], { encoding: "utf8" })
  ).stdout.trim();
const [gitDir, commonDir, branch, defaultRef, changes] = await Promise.all([
  git(["rev-parse", "--path-format=absolute", "--git-dir"]),
  git(["rev-parse", "--path-format=absolute", "--git-common-dir"]),
  git(["branch", "--show-current"]),
  git(["symbolic-ref", "refs/remotes/origin/HEAD"]),
  git(["status", "--porcelain"]),
]);
if (
  gitDir !== commonDir ||
  defaultRef !== `refs/remotes/origin/${branch}` ||
  changes
)
  throw new Error(
    "Deploy from the clean primary checkout after merging the release.",
  );
const release = JSON.parse(
  await readFile(resolve(root, "dist/release.json"), "utf8"),
);
if (release.commit !== (await git(["rev-parse", "HEAD"])))
  throw new Error("Build the merged commit before installing the service.");
const port = Number(process.env.PORT || 5173);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Choose a port between 1024 and 65535.");
const label = "com.garo.merge-monitor";
const logs = resolve(homedir(), ".local/state/merge-monitor");
const agents = resolve(homedir(), "Library/LaunchAgents");
await mkdir(logs, { recursive: true, mode: 0o700 });
await mkdir(agents, { recursive: true });
const xml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const path = resolve(agents, `${label}.plist`);
const target = `gui/${process.getuid()}/${label}`;
const running = await execute("launchctl", ["print", target])
  .then(() => true)
  .catch((error) => {
    if (error.code === 113) return false;
    if (error.stderr?.includes("Could not find service")) return false;
    throw error;
  });
if (running) await execute("launchctl", ["bootout", target]);
await writeFile(
  path,
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(resolve(root, "server/index.mjs"))}</string></array>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(`${homedir()}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`)}</string><key>PORT</key><string>${port}</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>${xml(resolve(logs, "out.log"))}</string>
<key>StandardErrorPath</key><string>${xml(resolve(logs, "error.log"))}</string>
</dict></plist>\n`,
  { mode: 0o600 },
);
await execute("plutil", ["-lint", path]);
await execute("launchctl", ["bootstrap", `gui/${process.getuid()}`, path]);
console.log(
  `[Deploy] ${release.commit.slice(0, 8)} → http://127.0.0.1:${port} (${label})`,
);
