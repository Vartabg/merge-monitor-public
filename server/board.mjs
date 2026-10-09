import { readFile, writeFile, rename, mkdir, unlink } from "node:fs/promises";
import { dirname } from "node:path";
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
  goal: "BoardGoal",
};
export async function createBoardStore(
  path,
  { now = () => new Date().toISOString() } = {},
) {
  let state = { version: 1, rooms: [] };
  try {
    state = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  validate("BoardState", state);
  let tail = Promise.resolve();
  function view(project, agent = "", source = state) {
    const room =
      source.rooms.find((r) => r.project === project) || empty(project);
    const member = room.members.find((m) => m.agent === agent);
    return structuredClone({
      room,
      asOf: now(),
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
    });
  }
  async function change(command, value) {
    if (!requests[command]) fail("Unknown board action.", 404);
    validate(requests[command], value);
    const next = structuredClone(state);
    let room = next.rooms.find((r) => r.project === value.project);
    if (!room) {
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
        if (room.members.length >= 100)
          fail("This room has reached its agent limit.", 409);
        member = { agent: value.agent, lastReadAt: "", lastReadSequence: 0 };
        room.members.push(member);
      }
      Object.assign(member, {
        task: value.task,
        scope: value.scope,
        state: value.state,
        checkedInAt: at,
      });
    } else if (!member)
      fail("Check in with a unique agent name before using this room.", 409);
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
      if (value.replyTo && !room.messages.some((m) => m.id === value.replyTo))
        fail("The original message is not in this project.", 404);
      const previous = room.messages.find(
        (m) => m.requestId === value.requestId,
      );
      if (previous) {
        if (Object.keys(value).some((k) => value[k] !== previous[k]))
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
        message.resolvedAt ||= at;
        message.resolvedBy ||= value.agent;
      }
    }
    validate("BoardState", next);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(next, null, 2), {
        mode: 0o600,
      });
      await rename(temporary, path);
    } catch (error) {
      await unlink(temporary).catch(() => {});
      throw error;
    }
    state = next;
    const result = view(value.project, value.agent);
    if (command === "read" || command === "check-in")
      result.unreadIds = before.unreadIds;
    return result;
  }
  return {
    view,
    command(command, input) {
      const result = tail.then(() => change(command, input));
      tail = result.catch(() => {});
      return result;
    },
  };
}
export async function boardRequest(path, req, board, monitor, body) {
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
    16384,
  );
  monitor.repo(value.project);
  return board.command(command, value);
}
