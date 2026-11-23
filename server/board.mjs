import { privateStateFile } from "./private-state-file.mjs";
import { randomUUID } from "node:crypto";
import Ajv from "ajv/dist/2020.js";
import { boardSchemas } from "./board-contract.mjs";
const ajv = new Ajv({ strict: false });
const validators = Object.fromEntries(
  Object.entries(boardSchemas).map(([key, schema]) => [
    key,
    ajv.compile({ ...schema, components: { schemas: boardSchemas } }),
  ]),
);
function fail(message, statusCode = 400) {
  throw Object.assign(new Error(message), { statusCode });
}
function validate(schema, value) {
  if (!validators[schema](value))
    fail(`Invalid ${schema} data. Check required fields and length limits.`);
}
const empty = (project) => ({
  project,
  goal: "",
  goalBy: "",
  goalAt: "",
  revision: 0,
  members: [],
  messages: [],
});
const requests = {
  read: "BoardRead",
  "check-in": "BoardCheckIn",
  post: "BoardPost",
  ack: "BoardAction",
  resolve: "BoardAction",
  "resolve-fyi": "BoardResolveFyi",
  goal: "BoardGoal",
  "prune-members": "BoardPruneMembers",
};
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
// New posts without attention: questions and blockers need action.
const postAttention = (kind) =>
  ["question", "blocker"].includes(kind) ? "action" : "fyi";
// Messages saved before attention existed also treat handoffs as action,
// so an old handoff that asks for something is never bulk-resolved as FYI.
export const attentionOf = (message) =>
  message.attention ||
  (["question", "blocker", "handoff"].includes(message.kind)
    ? "action"
    : "fyi");
// Stale is derived at read time; stored check-ins are never rewritten.
export function staleAgents(room, asOf, hours) {
  const limit = Date.parse(asOf) - hours * 3600000;
  return room.members
    .filter(
      (m) =>
        m.agent !== "human" &&
        m.state !== "done" &&
        Date.parse(m.checkedInAt) < limit,
    )
    .map((m) => m.agent);
}
export async function createBoardStore(
  path,
  { now = () => new Date().toISOString(), staleAfterHours = 72 } = {},
) {
  if (!(staleAfterHours > 0)) fail("The stale threshold must be positive.");
  const file = await privateStateFile(path);
  let state = { version: 1, rooms: [] };
  try {
    state = await file.read();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  validate("BoardState", state);
  let tail = Promise.resolve();
  function view(project, agent = "", source = state) {
    const room =
      source.rooms.find((r) => r.project === project) || empty(project);
    const member = room.members.find((m) => m.agent === agent);
    const asOf = now();
    // Messages saved before attention existed keep it absent, so readers can tell them apart.
    return structuredClone({
      room,
      asOf,
      unreadIds: agent
        ? room.messages
            .filter(
              (m) =>
                m.sequence > (member?.lastReadSequence || 0) &&
                m.agent !== agent,
            )
            .map((m) => m.id)
        : [],
      pendingIds: agent
        ? room.messages
            .filter((m) => m.to === agent && !m.resolvedAt)
            .map((m) => m.id)
        : [],
      staleAfterHours,
      staleAgents: staleAgents(room, asOf, staleAfterHours),
    });
  }
  async function change(command, value, options = {}) {
    if (!requests[command]) fail("Unknown board action.", 404);
    validate(requests[command], value);
    const next = structuredClone(state);
    let room = next.rooms.find((r) => r.project === value.project);
    if (!room) {
      if (command === "prune-members") {
        if (value.agent !== "human")
          fail("Check in with a unique agent name before using this room.", 409);
        return view(value.project, value.agent);
      }
      if (next.rooms.length >= 100) fail("Board room limit reached.", 409);
      room = empty(value.project);
      next.rooms.push(room);
    }
    const at = now();
    let member = room.members.find((m) => m.agent === value.agent);
    const before = view(value.project, value.agent);
    if (command === "check-in") {
      if (!value.task.trim()) fail("Describe your task.");
      if (!member) {
        const limit =
          value.agent === "human" ||
          room.members.some((m) => m.agent === "human")
            ? 100
            : 99;
        if (room.members.length >= limit)
          fail(
            "This room has reached its agent limit. Prune finished check-ins before adding another agent.",
            409,
          );
        member = { agent: value.agent, lastReadAt: "", lastReadSequence: 0 };
        room.members.push(member);
      }
      Object.assign(member, {
        task: value.task,
        scope: value.scope,
        state: value.state,
        checkedInAt: at,
      });
    } else if (!member && !(command === "prune-members" && value.agent === "human"))
      fail("Check in with a unique agent name before using this room.", 409);
    if (command === "prune-members") {
      const openRecipients = new Set(
        room.messages.filter((m) => !m.resolvedAt && m.to).map((m) => m.to),
      );
      const staleSet = new Set(staleAgents(room, at, staleAfterHours));
      const protectedSet = new Set(options.protectedAgents || []);
      room.members = room.members.filter((m) => {
        if (
          m.agent === "human" ||
          m.agent === value.agent ||
          openRecipients.has(m.agent) ||
          protectedSet.has(m.agent)
        )
          return true;
        if (m.state === "done") return false;
        if (value.includeStale === true && staleSet.has(m.agent)) return false;
        return true;
      });
    }
    if (command === "read") {
      member.lastReadSequence = room.messages.at(-1)?.sequence || 0;
      member.lastReadAt = at;
    }
    if (command === "goal") {
      if (!value.goal.trim()) fail("Describe the shared goal.");
      if (value.revision !== room.revision)
        fail("The goal changed. Read the board before editing it again.", 409);
      Object.assign(room, {
        goal: value.goal,
        goalBy: value.agent,
        goalAt: at,
        revision: room.revision + 1,
      });
    }
    if (command === "post") {
      if (!value.text.trim()) fail("Write a message.");
      if (
        value.to &&
        value.to !== "human" &&
        !room.members.some((m) => m.agent === value.to)
      )
        fail("The recipient must check in to this project first.", 409);
      if (["question", "blocker", "handoff"].includes(value.kind) && !value.to)
        fail("Choose who should respond to this message.");
      if (value.finding && !["handoff", "blocker"].includes(value.kind))
        fail("A finding belongs on a handoff or blocker.");
      if (value.replyTo && !room.messages.some((m) => m.id === value.replyTo))
        fail("The original message is not in this project.", 404);
      const previous = room.messages.find(
        (m) => m.requestId === value.requestId,
      );
      if (previous) {
        const incomingAttention =
          previous.attention !== undefined
            ? value.attention || postAttention(value.kind)
            : value.attention;
        if (
          ["project", "agent", "to", "kind", "text", "replyTo", "requestId"].some(
            (k) => value[k] !== previous[k],
          ) ||
          incomingAttention !== previous.attention ||
          canonicalJson(value.finding ?? null) !==
            canonicalJson(previous.finding ?? null)
        )
          fail("This request ID belongs to a different message.", 409);
        return view(value.project, value.agent);
      }
      if (room.messages.length >= 1000)
        fail(
          "This room has reached 1,000 messages. Export it and start a new configured project room; no messages were discarded.",
          409,
        );
      room.messages.push({
        ...value,
        attention: value.attention || postAttention(value.kind),
        id: randomUUID(),
        sequence: (room.messages.at(-1)?.sequence || 0) + 1,
        at,
        acknowledgedAt: "",
        resolvedAt: "",
        resolvedBy: "",
      });
    }
    if (command === "ack" || command === "resolve") {
      const message = room.messages.find((m) => m.id === value.messageId);
      if (!message) fail("This message is not in the selected project.", 404);
      if (command === "ack") {
        if (message.to !== value.agent)
          fail("Only the addressed agent can acknowledge this message.", 403);
        message.acknowledgedAt ||= at;
      } else {
        if (![message.agent, message.to].includes(value.agent))
          fail("Only the sender or recipient can resolve this message.", 403);
        if (
          value.agent !== message.agent &&
          ["question", "blocker", "handoff"].includes(message.kind) &&
          !room.messages.some(
            (m) => m.replyTo === message.id && m.agent === value.agent,
          )
        )
          fail(
            "Post a reply describing the outcome before resolving this request.",
            409,
          );
        message.resolvedAt ||= at;
        message.resolvedBy ||= value.agent;
      }
    }
    if (command === "resolve-fyi") {
      // The caller lists the items it showed, so FYI posts that arrive later stay open.
      if (!value.note.trim()) fail("Add a short resolution note.");
      const chosen = value.messageIds.map((id) =>
        room.messages.find((m) => m.id === id),
      );
      if (chosen.some((m) => !m))
        fail("A listed message is not in the selected project.", 404);
      if (chosen.some((m) => m.to !== value.agent))
        fail("Only the recipient can bulk-resolve FYI messages.", 403);
      const allowed = (m) =>
        m.resolvedAt ||
        attentionOf(m) === "fyi" ||
        (value.includeOldHandoffs && !m.attention && m.kind === "handoff");
      if (!chosen.every(allowed))
        fail(
          "Only FYI messages, and old handoffs you confirmed, can be resolved in bulk.",
          409,
        );
      for (const message of chosen.filter((m) => !m.resolvedAt))
        Object.assign(message, {
          resolvedAt: at,
          resolvedBy: value.agent,
          resolutionNote: value.note,
        });
    }
    validate("BoardState", next);
    await file.save(next);
    state = next;
    const result = view(value.project, value.agent);
    if (command === "read" || command === "check-in")
      result.unreadIds = before.unreadIds;
    return result;
  }
  return {
    view,
    command(command, input, options) {
      const result = tail.then(() => change(command, input, options));
      tail = result.catch(() => {});
      return result;
    },
  };
}
export async function boardRequest(
  path,
  req,
  board,
  monitor,
  body,
  assignments,
) {
  if (path === "/api/board") {
    if (req.method !== "GET") fail("Use GET for this endpoint.", 405);
    const project = new URL(req.url, "http://localhost").searchParams.get(
      "project",
    );
    monitor.repo(project);
    return board.view(project);
  }
  const command = path.slice("/api/board/".length);
  if (!requests[command]) fail("Unknown board action.", 404);
  if (req.method !== "POST") fail("Use POST for this endpoint.", 405);
  const value = await body(
    req,
    Object.keys(boardSchemas[requests[command]].properties),
    // A bulk FYI resolution can list up to 1,000 message IDs.
    command === "resolve-fyi" ? 65536 : 16384,
  );
  monitor.repo(value.project);
  const protectedAgents =
    command === "prune-members" && typeof assignments?.list === "function"
      ? new Set(
          assignments
            .list()
            .filter(
              (a) => a.project === value.project && a.status !== "accepted",
            )
            .flatMap((a) => [a.owner, a.reviewer]),
        )
      : undefined;
  return board.command(command, value, { protectedAgents });
}
