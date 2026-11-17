import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, readFile, realpath, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { readSafeText, validateConfig } from "./dispatch.mjs";
import {
  renderDispatchPlist,
  renderServerPlist,
  staleHoursSetting,
} from "./service-env.mjs";

const SERVER_LABEL = "com.garo.merge-monitor";
const DISPATCH_LABEL = "com.garo.merge-monitor.dispatch";

const delay = (ms) => new Promise((done) => setTimeout(done, ms));

export const isUnloadedError = (error) =>
  Boolean(
    error &&
      (error.code === 113 ||
        error.stderr?.includes("Could not find service") ||
        error.stderr?.includes("No such process")),
  );

export async function isAgentLoaded(execute, target) {
  try {
    await execute("launchctl", ["print", target]);
    return true;
  } catch (error) {
    if (isUnloadedError(error)) return false;
    throw error;
  }
}

async function unloadIfLoaded({
  execute,
  uid,
  label,
  sleep = delay,
  waitMs = 300,
  maxWaitAttempts = 10,
}) {
  const target = `gui/${uid}/${label}`;
  if (!(await isAgentLoaded(execute, target))) return false;
  try {
    await execute("launchctl", ["bootout", target]);
  } catch (error) {
    if (!isUnloadedError(error)) throw error;
    return true;
  }
  for (let attempt = 0; attempt < maxWaitAttempts; attempt++) {
    if (!(await isAgentLoaded(execute, target))) return true;
    await sleep(waitMs);
  }
  throw new Error(
    `LaunchAgent ${label} did not unload within ${maxWaitAttempts * waitMs}ms.`,
  );
}

export async function reinstallLaunchAgent({
  execute,
  uid,
  label,
  plistPath,
  plistXml,
  sleep = delay,
  waitMs = 300,
  maxWaitAttempts = 10,
}) {
  await unloadIfLoaded({ execute, uid, label, sleep, waitMs, maxWaitAttempts });
  await writeFile(plistPath, plistXml, { mode: 0o600 });
  await execute("plutil", ["-lint", plistPath]);
  const domain = `gui/${uid}`;
  try {
    await execute("launchctl", ["bootstrap", domain, plistPath]);
  } catch (error) {
    if (error?.code !== 5) throw error;
    await sleep(500);
    await execute("launchctl", ["bootstrap", domain, plistPath]);
  }
}

export async function removeLaunchAgentIfPresent({
  execute,
  uid,
  label,
  plistPath,
  sleep = delay,
  waitMs = 300,
  maxWaitAttempts = 10,
}) {
  const wasLoaded = await unloadIfLoaded({
    execute,
    uid,
    label,
    sleep,
    waitMs,
    maxWaitAttempts,
  });
  let deletedPlist = false;
  await unlink(plistPath)
    .then(() => {
      deletedPlist = true;
    })
    .catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  return wasLoaded || deletedPlist;
}

export async function readValidDispatchConfig(
  configPath,
  { read = (filePath) => readSafeText(filePath), validate = validateConfig } = {},
) {
  let raw;
  try {
    raw = await read(configPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid dispatch config JSON at ${configPath}: ${error.message}`,
      { cause: error },
    );
  }
  return validate(parsed);
}

export async function syncDispatchLaunchAgent({
  dispatchConfig,
  configPath,
  execute,
  uid,
  agentsDir,
  nodePath,
  root,
  origin,
  statePath,
  pathEnv,
  logsDir,
  sleep = delay,
  waitMs = 300,
  maxWaitAttempts = 10,
}) {
  const plistPath = resolve(agentsDir, `${DISPATCH_LABEL}.plist`);
  if (dispatchConfig === null) {
    const removed = await removeLaunchAgentIfPresent({
      execute,
      uid,
      label: DISPATCH_LABEL,
      plistPath,
      sleep,
      waitMs,
      maxWaitAttempts,
    });
    return { installed: false, removed, label: DISPATCH_LABEL, plistPath };
  }
  const plistXml = renderDispatchPlist({
    nodePath,
    root,
    configPath,
    origin,
    statePath,
    pathEnv,
    stdoutPath: resolve(logsDir, "dispatch.out.log"),
    stderrPath: resolve(logsDir, "dispatch.error.log"),
  });
  await reinstallLaunchAgent({
    execute,
    uid,
    label: DISPATCH_LABEL,
    plistPath,
    plistXml,
    sleep,
    waitMs,
    maxWaitAttempts,
  });
  return { installed: true, removed: false, label: DISPATCH_LABEL, plistPath };
}

export async function runInstallService() {
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

  const logs = resolve(homedir(), ".local/state/merge-monitor");
  const agents = resolve(homedir(), "Library/LaunchAgents");
  const dispatchConfigPath =
    process.env.MERGE_MONITOR_DISPATCH_CONFIG ||
    resolve(homedir(), ".config/merge-monitor/dispatch.json");
  // Fail closed on malformed/invalid dispatch config before touching either LaunchAgent.
  const dispatchConfig = await readValidDispatchConfig(dispatchConfigPath);

  await mkdir(logs, { recursive: true, mode: 0o700 });
  await mkdir(agents, { recursive: true });

  const serverPlistPath = resolve(agents, `${SERVER_LABEL}.plist`);
  const staleHours = staleHoursSetting(
    process.env.MERGE_MONITOR_STALE_HOURS,
    await readFile(serverPlistPath, "utf8").catch((error) => {
      if (error.code === "ENOENT") return "";
      throw error;
    }),
  );
  const pathEnv = `${homedir()}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`;
  const uid = process.getuid();
  const serverXml = renderServerPlist({
    nodePath: process.execPath,
    root,
    port,
    pathEnv,
    staleHours,
    stdoutPath: resolve(logs, "out.log"),
    stderrPath: resolve(logs, "error.log"),
  });
  await reinstallLaunchAgent({
    execute,
    uid,
    label: SERVER_LABEL,
    plistPath: serverPlistPath,
    plistXml: serverXml,
  });
  const origin = `http://127.0.0.1:${port}`;
  console.log(
    `[Deploy] ${release.commit.slice(0, 8)} → ${origin} (${SERVER_LABEL}) · stale after ${staleHours || 72}h`,
  );

  const dispatchResult = await syncDispatchLaunchAgent({
    dispatchConfig,
    configPath: dispatchConfigPath,
    execute,
    uid,
    agentsDir: agents,
    nodePath: process.execPath,
    root,
    origin,
    statePath: resolve(logs, "dispatch-state.json"),
    pathEnv,
    logsDir: logs,
  });
  if (dispatchResult.installed) {
    console.log(
      `[Deploy] Dispatcher supervised (${DISPATCH_LABEL}) ← ${dispatchConfigPath}`,
    );
  } else if (dispatchResult.removed) {
    console.log(
      `[Deploy] Dispatcher LaunchAgent removed (${DISPATCH_LABEL}; ${dispatchConfigPath} absent)`,
    );
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  await runInstallService();
}
