import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { teamToolCall } from "./team-mcp-tools.mjs";
export async function runTeamWork(args) {
  const [command, ...rest] = args;
  if (
    ![
      "inbox",
      "wait",
      "claim",
      "start",
      "renew",
      "finish",
      "cancel",
      "abandon",
    ].includes(command)
  )
    throw Error(
      "Use team-work inbox|wait|claim|start|renew|finish|cancel|abandon with --project/--agent or --input FILE.",
    );
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    if (
      ![
        "--project",
        "--agent",
        "--input",
        "--origin",
        "--seconds",
        "--after",
      ].includes(key) ||
      !rest[i + 1] ||
      options[key] !== undefined
    )
      throw Error("Use each supported option once with a value.");
    options[key] = rest[i + 1];
  }
  const input = options["--input"]
    ? JSON.parse(await readFile(resolve(options["--input"]), "utf8"))
    : {};
  for (const key of ["project", "agent"])
    if (options["--" + key]) input[key] = options["--" + key];
  if (!input.project || !input.agent)
    throw Error(
      "Supply the configured project and your checked-in agent identity.",
    );
  if (command !== "wait" && (options["--seconds"] || options["--after"]))
    throw Error("Only wait accepts seconds and an inbox cursor.");
  if (command === "wait") {
    if (options["--seconds"]) input.seconds = Number(options["--seconds"]);
    if (options["--after"]) input.after = options["--after"];
  }
  return teamToolCall(
    "team_" + command,
    input,
    options["--origin"] || "http://127.0.0.1:5173",
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    console.log(
      JSON.stringify(await runTeamWork(process.argv.slice(2)), null, 2),
    );
  } catch (error) {
    console.error(`[Team work] ${error.message}`);
    process.exitCode = 1;
  }
}
