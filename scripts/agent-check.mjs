import { fileURLToPath } from "node:url";
import { parseArgs, HELP_TEXT } from "./agent-args.mjs";
import {
  readinessProblem,
  unavailableReport,
  buildFreshReport,
} from "./agent-report.mjs";
export { parseArgs } from "./agent-args.mjs";
export { CHECKS, INTERPRETATION } from "./agent-report.mjs";

export async function fetchJson(url, timeout) {
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(Math.max(1, Math.ceil(timeout))),
  });
  if (!response.ok)
    throw new Error(`Local API returned HTTP ${response.status}.`);
  return response.json();
}
export async function collectReport(
  options,
  {
    request = fetchJson,
    now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {},
) {
  const deadline = now() + Math.max(1000, options.wait * 1000);
  const base = `http://127.0.0.1:${options.port}`;
  const get = (path) =>
    request(base + path, Math.min(5000, Math.max(1, deadline - now())));
  let repo;
  const unavailable = (reason) => unavailableReport(options, repo, reason);
  try {
    const config = await get("/api/repos");
    repo = config?.repos?.find((r) => r.id === options.repo);
    if (!repo || !Array.isArray(repo.excludedBranches))
      return unavailable(
        "Project is not configured or its configuration is invalid.",
      );
  } catch {
    return unavailable(
      "Could not read the local project configuration. Check that Merge Monitor is running.",
    );
  }
  let reason;
  do {
    try {
      const data = await get(
        `/api/status?repo=${encodeURIComponent(options.repo)}`,
      );
      reason = readinessProblem(data, repo, now());
      if (!reason) return buildFreshReport(options, repo, data);
    } catch {
      reason = "The local status request failed or timed out.";
    }
    if (options.wait === 0 || now() >= deadline) break;
    await sleep(Math.min(500, Math.max(0, deadline - now())));
  } while (now() < deadline);
  return unavailable(`Fresh report unavailable: ${reason}`);
}
export async function run(argv, deps) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    return { exitCode: 2, stdout: "", stderr: `${error.message}\n` };
  }
  if (options.help)
    return { exitCode: 0, stdout: HELP_TEXT + "\n", stderr: "" };
  const report = await collectReport(options, deps);
  return {
    exitCode: report.availability === "fresh" ? 0 : 2,
    stdout: JSON.stringify(report) + "\n",
    stderr: "",
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await run(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
