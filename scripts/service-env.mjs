import { resolve } from "node:path";

const key = "MERGE_MONITOR_STALE_HOURS";
export const DEFAULT_SERVICE_LABEL = "local.merge-monitor";
export const SERVICE_LABEL_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/;

export function serviceLabelSetting(value) {
  if (value === undefined || value === "") return DEFAULT_SERVICE_LABEL;
  if (typeof value !== "string" || !SERVICE_LABEL_RE.test(value))
    throw new Error(
      "MERGE_MONITOR_SERVICE_LABEL must be 1..120 letters, digits, dots, underscores, or hyphens.",
    );
  return value;
}

// Returns the stale threshold to write into the LaunchAgent, or "" for the service default (72h).
// Unset keeps the valid value from the previous install; an empty value clears it.
export function staleHoursSetting(value, previousPlist = "") {
  if (value === undefined) {
    const extracted = previousPlist.match(
      new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`),
    )?.[1];
    if (
      extracted &&
      /^\d+(\.\d+)?$/.test(extracted) &&
      Number.isFinite(Number(extracted)) &&
      Number(extracted) > 0
    )
      return extracted;
    return "";
  }
  if (value === "") return "";
  if (
    !/^\d+(\.\d+)?$/.test(value) ||
    !Number.isFinite(Number(value)) ||
    !(Number(value) > 0)
  )
    throw new Error(`${key} must be a positive number of hours.`);
  return value;
}
export const staleHoursEntry = (hours) =>
  hours ? `<key>${key}</key><string>${xmlEscape(hours)}</string>` : "";

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
  if (!Number.isInteger(throttleInterval) || throttleInterval < 0)
    throw new Error("throttleInterval must be a non-negative integer.");
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
  label = DEFAULT_SERVICE_LABEL,
  nodePath,
  root,
  port,
  pathEnv,
  staleHours,
  stdoutPath,
  stderrPath,
}) {
  return renderLaunchAgentPlist({
    label,
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
  label = `${DEFAULT_SERVICE_LABEL}.dispatch`,
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
    label,
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
