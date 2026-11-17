import { resolve } from "node:path";

const key = "MERGE_MONITOR_STALE_HOURS";
// Returns the stale threshold to write into the LaunchAgent, or "" for the service default (72h).
// Unset keeps the value from the previous install; an empty value clears it.
export function staleHoursSetting(value, previousPlist = "") {
  if (value === undefined)
    return (
      previousPlist.match(
        new RegExp(`<key>${key}</key><string>([^<]*)</string>`),
      )?.[1] || ""
    );
  if (value === "") return "";
  if (!/^\d+(\.\d+)?$/.test(value) || !(Number(value) > 0))
    throw new Error(`${key} must be a positive number of hours.`);
  return value;
}
export const staleHoursEntry = (hours) =>
  hours ? `<key>${key}</key><string>${hours}</string>` : "";

export const xmlEscape = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

export function renderLaunchAgentPlist({
  label,
  programArguments,
  workingDirectory,
  environmentVariables = {},
  stdoutPath,
  stderrPath,
  runAtLoad = true,
  keepAlive = true,
  throttleInterval = 10,
}) {
  const argsXml = programArguments
    .map((arg) => `<string>${xmlEscape(arg)}</string>`)
    .join("");
  const envXml = Object.entries(environmentVariables)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(
      ([envKey, envValue]) =>
        `<key>${xmlEscape(envKey)}</key><string>${xmlEscape(envValue)}</string>`,
    )
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n` +
    `<plist version="1.0"><dict>\n` +
    `<key>Label</key><string>${xmlEscape(label)}</string>\n` +
    `<key>ProgramArguments</key><array>${argsXml}</array>\n` +
    `<key>WorkingDirectory</key><string>${xmlEscape(workingDirectory)}</string>\n` +
    `<key>EnvironmentVariables</key><dict>${envXml}</dict>\n` +
    `<key>RunAtLoad</key>${runAtLoad ? "<true/>" : "<false/>"}` +
    `<key>KeepAlive</key>${keepAlive ? "<true/>" : "<false/>"}` +
    `<key>ThrottleInterval</key><integer>${throttleInterval}</integer>\n` +
    `<key>StandardOutPath</key><string>${xmlEscape(stdoutPath)}</string>\n` +
    `<key>StandardErrorPath</key><string>${xmlEscape(stderrPath)}</string>\n` +
    `</dict></plist>\n`
  );
}

export function renderServerPlist({
  nodePath,
  root,
  port,
  pathEnv,
  staleHours,
  stdoutPath,
  stderrPath,
}) {
  return renderLaunchAgentPlist({
    label: "com.garo.merge-monitor",
    programArguments: [nodePath, resolve(root, "server/index.mjs")],
    workingDirectory: root,
    environmentVariables: {
      PATH: pathEnv,
      PORT: String(port),
      ...(staleHours ? { [key]: String(staleHours) } : {}),
    },
    stdoutPath,
    stderrPath,
  });
}

export function renderDispatchPlist({
  nodePath,
  root,
  configPath,
  origin,
  statePath,
  pathEnv,
  stdoutPath,
  stderrPath,
}) {
  return renderLaunchAgentPlist({
    label: "com.garo.merge-monitor.dispatch",
    programArguments: [
      nodePath,
      resolve(root, "scripts/dispatch.mjs"),
      "--config",
      configPath,
      "--origin",
      origin,
      "--state",
      statePath,
    ],
    workingDirectory: root,
    environmentVariables: { PATH: pathEnv },
    stdoutPath,
    stderrPath,
  });
}
