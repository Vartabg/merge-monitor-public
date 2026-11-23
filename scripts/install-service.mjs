import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readSafeText, validateConfig } from "./dispatch.mjs";
import {
  DEFAULT_SERVICE_LABEL,
  SERVICE_LABEL_RE,
  renderDispatchPlist,
  renderServerPlist,
  serviceLabelSetting,
  staleHoursSetting,
  xmlEscape,
} from "./service-env.mjs";

export const DEFAULT_SERVER_LABEL = DEFAULT_SERVICE_LABEL;
const MAX_PLIST_BYTES = 64 * 1024;

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

async function readBoundedOwnerPlist(filePath) {
  const uid = process.getuid?.();
  const info = await lstat(filePath);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.nlink !== 1 ||
    (uid !== undefined && info.uid !== uid) ||
    info.size > MAX_PLIST_BYTES
  )
    return null;
  const handle = await open(
    filePath,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const fdInfo = await handle.stat();
    if (
      !fdInfo.isFile() ||
      fdInfo.dev !== info.dev ||
      fdInfo.ino !== info.ino ||
      fdInfo.size > MAX_PLIST_BYTES
    )
      return null;
    const chunks = [];
    const buf = Buffer.alloc(Math.min(16384, MAX_PLIST_BYTES + 1));
    let total = 0;
    for (;;) {
      const { bytesRead } = await handle.read(
        buf,
        0,
        Math.min(buf.length, MAX_PLIST_BYTES + 1 - total),
      );
      if (!bytesRead) break;
      total += bytesRead;
      if (total > MAX_PLIST_BYTES) return null;
      chunks.push(Buffer.from(buf.subarray(0, bytesRead)));
    }
    const raw = Buffer.concat(chunks, total);
    if (raw.includes(0)) return null; // Skip binary plists safely.
    return raw.toString("utf8");
  } finally {
    await handle.close();
  }
}

export async function findSupersededLaunchAgents(
  agentsDir,
  targetScriptPath,
  targetLabel,
) {
  let entries;
  try {
    entries = await readdir(agentsDir);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const expectedArg = `<string>${xmlEscape(resolve(targetScriptPath))}</string>`;
  const found = [];
  for (const name of entries) {
    if (!name.endsWith(".plist")) continue;
    const plistPath = resolve(agentsDir, name);
    let xml;
    try {
      xml = await readBoundedOwnerPlist(plistPath);
    } catch {
      continue;
    }
    if (!xml) continue;
    const argsBlock = xml.match(
      /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/,
    )?.[1];
    if (!argsBlock || !argsBlock.includes(expectedArg)) continue;
    const label = xml
      .match(/<key>Label<\/key>\s*<string>([^<]+)<\/string>/)?.[1]
      ?.trim();
    if (!label || !SERVICE_LABEL_RE.test(label) || label === targetLabel)
      continue;
    found.push({ label, plistPath, xml });
  }
  return found;
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

export async function reinstallLaunchAgent({
  execute,
  uid,
  label,
  plistPath,
  plistXml,
  superseded = [],
  sleep = delay,
  waitMs = 300,
  maxWaitAttempts = 10,
}) {
  const tmpPath = `${plistPath}.${randomUUID()}.tmp`;
  let handle;
  let tmpOwned = false;
  try {
    handle = await open(
      tmpPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    tmpOwned = true;
    await handle.writeFile(plistXml, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    // Validate the new plist before unloading any live or superseded LaunchAgent.
    await execute("plutil", ["-lint", tmpPath]);

    for (const old of superseded) {
      await removeLaunchAgentIfPresent({
        execute,
        uid,
        label: old.label,
        plistPath: old.plistPath,
        sleep,
        waitMs,
        maxWaitAttempts,
      });
    }
    await unloadIfLoaded({
      execute,
      uid,
      label,
      sleep,
      waitMs,
      maxWaitAttempts,
    });

    const existing = await lstat(plistPath).catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    if (existing && (existing.isSymbolicLink() || !existing.isFile()))
      throw new Error(`Refusing to overwrite non-regular plist at ${plistPath}.`);

    await rename(tmpPath, plistPath);
    tmpOwned = false;
  } finally {
    if (handle) await handle.close().catch(() => {});
    if (tmpOwned) await unlink(tmpPath).catch(() => {});
  }

  const domain = `gui/${uid}`;
  try {
    await execute("launchctl", ["bootstrap", domain, plistPath]);
  } catch (error) {
    if (error?.code !== 5) throw error;
    await sleep(500);
    await execute("launchctl", ["bootstrap", domain, plistPath]);
  }
}

export async function readValidDispatchConfig(
  configPath,
  {
    read = (filePath) => readSafeText(filePath),
    validate = validateConfig,
  } = {},
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
  label = `${DEFAULT_SERVICE_LABEL}.dispatch`,
  sleep = delay,
  waitMs = 300,
  maxWaitAttempts = 10,
}) {
  const plistPath = resolve(agentsDir, `${label}.plist`);
  const superseded = await findSupersededLaunchAgents(
    agentsDir,
    resolve(root, "scripts/dispatch.mjs"),
    label,
  );
  if (dispatchConfig === null) {
    let removed = await removeLaunchAgentIfPresent({
      execute,
      uid,
      label,
      plistPath,
      sleep,
      waitMs,
      maxWaitAttempts,
    });
    for (const old of superseded) {
      if (
        await removeLaunchAgentIfPresent({
          execute,
          uid,
          label: old.label,
          plistPath: old.plistPath,
          sleep,
          waitMs,
          maxWaitAttempts,
        })
      )
        removed = true;
    }
    return { installed: false, removed, label, plistPath };
  }
  const plistXml = renderDispatchPlist({
    label,
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
    label,
    plistPath,
    plistXml,
    superseded,
    sleep,
    waitMs,
    maxWaitAttempts,
  });
  return { installed: true, removed: false, label, plistPath };
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

  const serverLabel = serviceLabelSetting(
    process.env.MERGE_MONITOR_SERVICE_LABEL,
  );
  const dispatchLabel = `${serverLabel}.dispatch`;
  const logs = resolve(homedir(), ".local/state/merge-monitor");
  const agents = resolve(homedir(), "Library/LaunchAgents");
  const dispatchConfigPath =
    process.env.MERGE_MONITOR_DISPATCH_CONFIG ||
    resolve(homedir(), ".config/merge-monitor/dispatch.json");
  // Fail closed on malformed/invalid dispatch config before touching either LaunchAgent.
  const dispatchConfig = await readValidDispatchConfig(dispatchConfigPath);

  await mkdir(logs, { recursive: true, mode: 0o700 });
  await mkdir(agents, { recursive: true });

  const serverPlistPath = resolve(agents, `${serverLabel}.plist`);
  const supersededServers = await findSupersededLaunchAgents(
    agents,
    resolve(root, "server/index.mjs"),
    serverLabel,
  );
  const previousServerPlist =
    (await readBoundedOwnerPlist(serverPlistPath).catch((error) => {
      if (error?.code === "ENOENT") return "";
      throw error;
    })) ||
    supersededServers[0]?.xml ||
    "";
  const staleHours = staleHoursSetting(
    process.env.MERGE_MONITOR_STALE_HOURS,
    previousServerPlist,
  );
  const pathEnv = `${homedir()}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`;
  const uid = process.getuid();
  const serverXml = renderServerPlist({
    label: serverLabel,
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
    label: serverLabel,
    plistPath: serverPlistPath,
    plistXml: serverXml,
    superseded: supersededServers,
  });
  const origin = `http://127.0.0.1:${port}`;
  console.log(
    `[Deploy] ${release.commit.slice(0, 8)} → ${origin} (${serverLabel}) · stale after ${staleHours || 72}h`,
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
    label: dispatchLabel,
  });
  if (dispatchResult.installed) {
    console.log(
      `[Deploy] Dispatcher supervised (${dispatchLabel}) ← ${dispatchConfigPath}`,
    );
  } else if (dispatchResult.removed) {
    console.log(
      `[Deploy] Dispatcher LaunchAgent removed (${dispatchLabel}; ${dispatchConfigPath} absent)`,
    );
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  await runInstallService();
}
