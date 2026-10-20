import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { teamSchemas } from "../server/team-contract.mjs";
import { workerClient } from "./worker-client.mjs";
const operations = ["claim", "start", "renew", "finish", "cancel", "abandon"];
const description = {
  abandon:
    "Preserve this run as expired and reserved when its worker cannot be confirmed stopped. Alerts the reviewer and blocks replacement. Only cancel after confirming the owned worker has stopped.",
  claim:
    "Atomically claim one queued assignment owned by this checked-in agent. Keep the returned runId for fencing. Exact requestId retries return the same run. Never launch until the claim succeeds.",
  start:
    "Report starting a claimed run with its named adapter. This is a client report, not independent provider verification. Follow the assignment scope and required policies.",
  renew:
    "Renew a running worker lease at a workflow boundary. On failure stop work; never publish an expired or cancelled run result.",
  finish:
    "Save a bounded result as review or blocked and send an idempotent addressed handoff to the assigned reviewer. Does not accept the result or authorize a merge/deploy. Use exact requestId for retries.",
  cancel:
    "Cancel this agent's claim after its worker has stopped. Fences stale results and alerts its reviewer. This cannot kill a model process; the owning supervisor must stop it first.",
};
export const teamToolDefinitions = [
  {
    name: "team_inbox",
    description:
      "Get this connected agent's bounded owned queue, review queue, unresolved addressed messages and run leases. Counts disclose omitted items. This does not mark messages read or start work.",
    inputSchema: teamSchemas.TeamIdentity,
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "team_wait",
    description:
      "Wait up to 55 seconds for a connected agent inbox to change. Pass the previous cursor to avoid returning unchanged work. Returns the bounded inbox and new cursor. This listens for work; it does not wake closed chats or start providers.",
    inputSchema: {
      ...teamSchemas.TeamIdentity,
      properties: {
        ...teamSchemas.TeamIdentity.properties,
        seconds: { type: "integer", minimum: 1, maximum: 55 },
        after: { type: "string", maxLength: 64 },
      },
      required: ["project", "agent"],
    },
  },
  ...operations.map((command) => ({
    name: "team_" + command,
    description: description[command],
    inputSchema:
      teamSchemas["Team" + command[0].toUpperCase() + command.slice(1)],
  })),
];
export const teamToolNames = new Set(
  teamToolDefinitions.map((item) => item.name),
);
const cursor = (inbox) =>
  createHash("sha256").update(JSON.stringify(inbox)).digest("hex");
export async function teamToolCall(name, input, origin, options = {}) {
  const client = options.client || workerClient(origin);
  if (name === "team_inbox") return client.inbox(input);
  if (name === "team_wait") {
    const { seconds = 30, after = "", project, agent } = input;
    if (
      !Number.isInteger(seconds) ||
      seconds < 1 ||
      seconds > 55 ||
      typeof after !== "string" ||
      after.length > 64
    )
      throw Error("Use a 1–55 second wait and the previous inbox cursor.");
    const deadline = Date.now() + seconds * 1000;
    for (;;) {
      const inbox = await client.inbox({ project, agent }),
        next = cursor(inbox);
      if (next !== after) return { changed: true, cursor: next, inbox };
      if (Date.now() >= deadline)
        return { changed: false, cursor: next, inbox };
      await delay(Math.min(1000, deadline - Date.now()));
    }
  }
  const command = name.slice("team_".length);
  if (!operations.includes(command))
    throw Error("Choose a supported team worker tool.");
  return client[command](input);
}
