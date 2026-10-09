import {
  compactContext,
  projectInstructionFiles,
  messageDetail,
} from "./board-context.mjs";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv/dist/2020.js";
import { boardSchemas } from "../server/board-contract.mjs";
const validateBoard = new Ajv({ strict: false }).compile({
  ...boardSchemas.Board,
  components: { schemas: boardSchemas },
});
export function boardClient(origin = "http://127.0.0.1:5173", fetcher = fetch) {
  const url = new URL(origin);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Use a local HTTP origin, with no path or credentials.");
  async function request(path, init = {}) {
    const response = await fetcher(`${url.origin}${path}`, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    const value = await response.json();
    if (!response.ok)
      throw new Error(value.error || "The local board is unavailable.");
    return value;
  }
  return async (command, input) => {
    let result;
    if (command === "view")
      result = await request(
        `/api/board?project=${encodeURIComponent(input.project)}`,
      );
    else {
      const { token } = await request("/api/session");
      const value =
        command === "post"
          ? { to: "", replyTo: "", requestId: randomUUID(), ...input }
          : input;
      result = await request(`/api/board/${command}`, {
        method: "POST",
        headers: {
          Origin: url.origin,
          "Content-Type": "application/json",
          "X-Merge-Monitor-Token": token,
        },
        body: JSON.stringify(value),
      });
    }
    if (!validateBoard(result) || result.room.project !== input.project)
      throw new Error("The board returned an invalid or mismatched report.");
    return result;
  };
}
export async function runBoard(args, fetcher = fetch) {
  const [command, ...rest] = args;
  const commands = [
    "brief",
    "context",
    "message",
    "view",
    "check-in",
    "post",
    "ack",
    "resolve",
    "goal",
    "wait",
  ];
  if (!commands.includes(command))
    throw new Error(
      "Use: board context|message|brief|view|check-in|post|ack|resolve|goal|wait --project ID [--agent NAME] [--input FILE] [--origin http://127.0.0.1:5173]. Wait accepts --after SEQUENCE --seconds 1..60.",
    );
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (
      ![
        "--project",
        "--agent",
        "--input",
        "--origin",
        "--after",
        "--seconds",
      ].includes(rest[i]) ||
      !rest[i + 1] ||
      options[rest[i]] !== undefined
    )
      throw new Error("Provide each supported option once, with a value.");
    options[rest[i]] = rest[i + 1];
  }
  const client = boardClient(options["--origin"], fetcher);
  const input = options["--input"]
    ? JSON.parse(await readFile(resolve(options["--input"]), "utf8"))
    : {};
  if (options["--project"]) input.project = options["--project"];
  if (options["--agent"]) input.agent = options["--agent"];
  if (!input.project || (!["view"].includes(command) && !input.agent))
    throw new Error(
      "Supply a project and a unique agent name (view needs only a project).",
    );
  if (
    command !== "wait" &&
    (options["--after"] !== undefined || options["--seconds"] !== undefined)
  )
    throw new Error("--after and --seconds are only used with wait.");
  if (command === "context") {
    const report = await client("view", { project: input.project });
    const files = await projectInstructionFiles(
      options["--origin"] || "http://127.0.0.1:5173",
      input.project,
      fetcher,
    );
    return compactContext(report, input.agent, files);
  }
  if (command === "message")
    return messageDetail(
      await client("view", { project: input.project }),
      input.messageId,
    );
  if (command === "wait") {
    const seconds = Number(options["--seconds"] || 30),
      after = Number(options["--after"] || 0);
    if (
      !Number.isInteger(seconds) ||
      seconds < 1 ||
      seconds > 60 ||
      !Number.isInteger(after) ||
      after < 0
    )
      throw new Error(
        "Wait needs seconds from 1 to 60 and a nonnegative sequence.",
      );
    const deadline = Date.now() + seconds * 1000;
    do {
      const result = await client("view", { project: input.project });
      const relevant = result.room.messages.some(
        (m) =>
          m.sequence > after &&
          m.agent !== input.agent &&
          (!m.to || m.to === input.agent),
      );
      if (relevant)
        return {
          available: true,
          ...(await client("read", {
            project: input.project,
            agent: input.agent,
          })),
        };
      if (Date.now() >= deadline) break;
      await new Promise((r) =>
        setTimeout(r, Math.min(1000, deadline - Date.now())),
      );
    } while (Date.now() <= deadline);
    return { available: false, project: input.project, after };
  }
  return client(command === "brief" ? "read" : command, input);
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    console.log(JSON.stringify(await runBoard(process.argv.slice(2)), null, 2));
  } catch (error) {
    console.error(`[Team board] ${error.message}`);
    process.exitCode = 2;
  }
}
