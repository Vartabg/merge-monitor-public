import { afterEach, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { access, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runDispatch } from "../scripts/dispatch.mjs";
import {
  readValidDispatchConfig,
  reinstallLaunchAgent,
  removeLaunchAgentIfPresent,
  syncDispatchLaunchAgent,
} from "../scripts/install-service.mjs";
import {
  renderDispatchPlist,
  renderServerPlist,
  staleHoursSetting,
  xmlEscape,
} from "../scripts/service-env.mjs";

const tempDirs = [];
const servers = [];

afterEach(async () => {
  await Promise.all([
    ...tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    ...servers.splice(0).map((srv) => new Promise((done) => srv.close(() => done()))),
  ]);
});

const validBoardResponse = (project = "example") => ({
  room: {
    project,
    goal: "",
    goalBy: "",
    goalAt: "",
    revision: 0,
    members: [],
    messages: [],
  },
  asOf: new Date().toISOString(),
  unreadIds: [],
  pendingIds: [],
  staleAfterHours: 72,
  staleAgents: [],
});

it("renders LaunchAgent plists with adjacent key/string tags and XML escaping", () => {
  expect(xmlEscape(`a&b<c>"d"'e'`)).toBe("a&amp;b&lt;c&gt;&quot;d&quot;&apos;e&apos;");

  const serverXml = renderServerPlist({
    nodePath: "/usr/local/bin/node",
    root: "/Users/test/merge-monitor",
    port: 5199,
    pathEnv: "/usr/bin:/bin",
    staleHours: "48",
    stdoutPath: "/tmp/out.log",
    stderrPath: "/tmp/err.log",
  });
  expect(staleHoursSetting(undefined, serverXml)).toBe("48");
  expect(serverXml).toContain("<key>PORT</key><string>5199</string>");

  const dispatchXml = renderDispatchPlist({
    nodePath: "/usr/local/bin/node",
    root: "/Users/test/O'Brien/merge-monitor",
    configPath: "/Users/test/.config/merge-monitor/dispatch.json",
    origin: "http://127.0.0.1:5199",
    statePath: "/Users/test/.local/state/merge-monitor/dispatch-state.json",
    pathEnv: "/Users/test/.local/bin:/usr/bin:/bin",
    stdoutPath: "/tmp/dispatch.out.log",
    stderrPath: "/tmp/dispatch.error.log",
  });
  expect(dispatchXml).toContain("com.garo.merge-monitor.dispatch");
  expect(dispatchXml).toContain("&apos;");
  expect(dispatchXml).toContain("<string>--origin</string><string>http://127.0.0.1:5199</string>");
  expect(dispatchXml).toContain("<string>--state</string><string>/Users/test/.local/state/merge-monitor/dispatch-state.json</string>");
  expect(dispatchXml).toContain("<key>KeepAlive</key><true/>");
});

it("fails closed on invalid dispatch config, handles ENOENT removal, and rethrows EACCES", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mm-install-"));
  tempDirs.push(dir);
  const execute = async () => {
    throw new Error("should not execute launchctl on invalid config");
  };

  const badJsonPath = join(dir, "bad-json.json");
  await writeFile(badJsonPath, "{not-json", { mode: 0o600 });
  await expect(readValidDispatchConfig(badJsonPath)).rejects.toThrow(/Invalid dispatch config JSON/);

  const badSchemaPath = join(dir, "bad-schema.json");
  await writeFile(
    badSchemaPath,
    JSON.stringify({ agents: [{ boardAgent: "a", project: "p", harness: "unknown", cwd: "/tmp" }] }),
    { mode: 0o600 },
  );
  await expect(readValidDispatchConfig(badSchemaPath)).rejects.toThrow(/Unknown harness/);

  await expect(readValidDispatchConfig(join(dir, "missing.json"))).resolves.toBeNull();
  await expect(
    readValidDispatchConfig(join(dir, "unreadable.json"), {
      read: async () => {
        throw Object.assign(new Error("permission denied"), { code: "EACCES" });
      },
    }),
  ).rejects.toThrow(/permission denied/);

  const stalePlist = join(dir, "com.garo.merge-monitor.dispatch.plist");
  await writeFile(stalePlist, "<plist/>");
  const removed = await syncDispatchLaunchAgent({
    dispatchConfig: null,
    configPath: join(dir, "missing.json"),
    execute: async (cmd, args) => {
      expect(cmd).toBe("launchctl");
      expect(args[0]).toBe("print");
      throw Object.assign(new Error("missing"), { code: 113, stderr: "Could not find service" });
    },
    uid: 501,
    agentsDir: dir,
    nodePath: "/bin/node",
    root: dir,
    origin: "http://127.0.0.1:5173",
    statePath: join(dir, "dispatch-state.json"),
    pathEnv: "/bin",
    logsDir: dir,
  });
  expect(removed).toMatchObject({ installed: false, removed: true });
  await expect(access(stalePlist)).rejects.toThrow();

  await expect(
    readValidDispatchConfig(badSchemaPath).then(() => execute()),
  ).rejects.toThrow(/Unknown harness/);
});

it("polls bootout teardown, writes 0600 plist, retries bootstrap error 5, and fails on teardown timeout", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mm-reinstall-"));
  tempDirs.push(dir);
  const plistPath = join(dir, "test.plist");

  let printCount = 0;
  let bootCount = 0;
  const calls = [];
  await reinstallLaunchAgent({
    uid: 501,
    label: "com.garo.test",
    plistPath,
    plistXml: "<plist/>",
    sleep: async () => {},
    waitMs: 1,
    maxWaitAttempts: 5,
    execute: async (cmd, args) => {
      calls.push([cmd, ...args]);
      if (cmd === "launchctl" && args[0] === "print") {
        printCount++;
        if (printCount >= 3) throw Object.assign(new Error("gone"), { code: 113 });
        return { stdout: "", stderr: "" };
      }
      if (cmd === "launchctl" && args[0] === "bootstrap") {
        bootCount++;
        if (bootCount === 1) throw Object.assign(new Error("io"), { code: 5 });
      }
      return { stdout: "", stderr: "" };
    },
  });
  expect(bootCount).toBe(2);
  expect((await stat(plistPath)).mode & 0o777).toBe(0o600);
  expect(calls).toContainEqual(["plutil", "-lint", plistPath]);

  const untouchedPlist = join(dir, "never-deleted.plist");
  await writeFile(untouchedPlist, "<keep/>");
  await expect(
    removeLaunchAgentIfPresent({
      uid: 501,
      label: "com.garo.stuck",
      plistPath: untouchedPlist,
      sleep: async () => {},
      waitMs: 10,
      maxWaitAttempts: 2,
      execute: async () => ({ stdout: "", stderr: "" }),
    }),
  ).rejects.toThrow(/did not unload within 20ms/);
  expect(await readFile(untouchedPlist, "utf8")).toBe("<keep/>");
});

it("retries failed board check-ins, refreshes before expiry, and exits cleanly with lock removal on AbortSignal & SIGTERM", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mm-sig-"));
  tempDirs.push(dir);
  const configPath = join(dir, "dispatch.json");
  const statePath = join(dir, "dispatch-state.json");
  const lockPath = `${statePath}.lock`;

  await writeFile(
    configPath,
    JSON.stringify({
      intervalSeconds: 30,
      agents: [{ boardAgent: "op-builder", project: "example", harness: "opencode", cwd: dir }],
    }),
    { mode: 0o600 },
  );

  let checkInAttempts = 0;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    req.resume();
    const json = (code, payload) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    if (url.pathname === "/api/session") return json(200, { token: "a".repeat(64) });
    if (url.pathname === "/api/board/check-in") {
      checkInAttempts++;
      if (checkInAttempts === 1) return json(503, { error: "starting up" });
      return json(200, validBoardResponse());
    }
    if (url.pathname === "/api/team/inbox") {
      return json(200, { version: 1, assignments: [], reviews: [] });
    }
    return json(404, { error: "not found" });
  });
  servers.push(server);
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${server.address().port}`;

  // Retry check-in + AbortSignal prompt exit
  const controller = new AbortController();
  let checkInsAfterRetry = 0;
  const runPromise = runDispatch({
    configPath,
    origin,
    statePath,
    lockPath,
    checkInTtlMs: 60_000,
    signal: controller.signal,
    diskFreeGiB: async () => 200,
    log: () => {},
  });
  // Wait for cycle 1 check-in failure (1), then wait briefly and abort before full 30s interval
  await new Promise((r) => setTimeout(r, 150));
  controller.abort();
  await runPromise;
  expect(checkInAttempts).toBe(1);
  await expect(access(lockPath)).rejects.toThrow();

  // Real subprocess SIGTERM test verifying lock cleanup and check-in recovery
  const child = spawn(
    process.execPath,
    [
      resolve("scripts/dispatch.mjs"),
      "--config",
      configPath,
      "--origin",
      origin,
      "--state",
      statePath,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  // Wait until checkInAttempts >= 2 (subprocess retried & succeeded on cycle 1) and lock exists
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (checkInAttempts >= 2) {
      try {
        await access(lockPath);
        checkInsAfterRetry = checkInAttempts;
        break;
      } catch { /* wait */ }
    }
    await new Promise((r) => setTimeout(r, 30));
  }
  expect(checkInsAfterRetry).toBeGreaterThanOrEqual(2);

  child.kill("SIGTERM");
  const code = await new Promise((done) => child.once("exit", done));
  expect(code).toBe(0);
  await expect(access(lockPath)).rejects.toThrow();
});
