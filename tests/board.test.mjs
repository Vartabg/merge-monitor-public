import { afterEach, beforeEach, expect, it } from "vitest";
import {
  mkdtemp,
  rm,
  mkdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { attentionOf, createBoardStore } from "../server/board.mjs";
let folder, path, store;
const checkin = (agent, project = "studio") => ({
  project,
  agent,
  task: `Work by ${agent}`,
  scope: "Own task only",
  state: "working",
});
const message = (agent = "writer", to = "reviewer", project = "studio") => ({
  project,
  agent,
  to,
  kind: "handoff",
  text: "Review the saved work.",
  replyTo: "",
  requestId: randomUUID(),
});
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "board-test-"));
  path = join(folder, "board.json");
  store = await createBoardStore(path);
  await store.command("check-in", checkin("writer"));
  await store.command("check-in", checkin("reviewer"));
});
afterEach(() => rm(folder, { recursive: true, force: true }));
it("carries a handoff across separate readers and restart without confusing receipt with completion", async () => {
  const report = await store.command("post", message());
  const id = report.room.messages[0].id;
  store = await createBoardStore(path);
  const first = await store.command("read", {
    project: "studio",
    agent: "reviewer",
  });
  expect(first.unreadIds).toEqual([id]);
  expect(first.pendingIds).toEqual([id]);
  const second = await store.command("read", {
    project: "studio",
    agent: "reviewer",
  });
  expect(second.unreadIds).toEqual([]);
  expect(second.pendingIds).toEqual([id]);
  await store.command("ack", {
    project: "studio",
    agent: "reviewer",
    messageId: id,
  });
  expect(store.view("studio", "reviewer").pendingIds).toEqual([id]);
  await store.command("resolve", {
    project: "studio",
    agent: "reviewer",
    messageId: id,
  });
  expect(store.view("studio", "reviewer").pendingIds).toEqual([]);
  expect(
    (await createBoardStore(path)).view("studio").room.messages[0].resolvedBy,
  ).toBe("reviewer");
});
it("isolates projects and rejects missing recipients, invalid replies and unrelated acknowledgments", async () => {
  await store.command("check-in", checkin("outsider"));
  await store.command("check-in", checkin("reviewer", "other"));
  const saved = await store.command("post", message());
  const id = saved.room.messages[0].id;
  expect(store.view("other").room.messages).toEqual([]);
  await expect(
    store.command("ack", {
      project: "other",
      agent: "reviewer",
      messageId: id,
    }),
  ).rejects.toMatchObject({ statusCode: 404 });
  await expect(
    store.command("ack", {
      project: "studio",
      agent: "outsider",
      messageId: id,
    }),
  ).rejects.toMatchObject({ statusCode: 403 });
  await expect(
    store.command("resolve", {
      project: "studio",
      agent: "outsider",
      messageId: id,
    }),
  ).rejects.toMatchObject({ statusCode: 403 });
  await expect(
    store.command("post", message("writer", "absent")),
  ).rejects.toMatchObject({ statusCode: 409 });
  await expect(
    store.command("post", { ...message(), replyTo: randomUUID() }),
  ).rejects.toMatchObject({ statusCode: 404 });
  await expect(store.command("post", message("writer", ""))).rejects.toThrow(
    "Choose who",
  );
});
it("serializes concurrent messages, deduplicates retries, and rejects request ID reuse with different content", async () => {
  const values = Array.from({ length: 20 }, () => message());
  await Promise.all(values.map((v) => store.command("post", v)));
  await store.command("post", values[0]);
  expect(store.view("studio").room.messages.map((m) => m.sequence)).toEqual(
    Array.from({ length: 20 }, (_, i) => i + 1),
  );
  await expect(
    store.command("post", { ...values[0], text: "Different content" }),
  ).rejects.toMatchObject({ statusCode: 409 });
  expect(
    (await createBoardStore(path)).view("studio").room.messages,
  ).toHaveLength(20);
});
it("rejects stale goal edits without losing the newer decision", async () => {
  const value = {
    project: "studio",
    agent: "writer",
    revision: 0,
    goal: "Ship a booking flow.",
  };
  await store.command("goal", value);
  await expect(
    store.command("goal", {
      ...value,
      agent: "reviewer",
      goal: "Change the plan.",
    }),
  ).rejects.toMatchObject({ statusCode: 409 });
  expect(store.view("studio").room.goal).toBe(value.goal);
});
it("preserves existing folder permissions and recovers from a failed save without changing memory", async () => {
  const mode = (await stat(folder)).mode & 0o777;
  const original = store.view("studio").room;
  await rm(path);
  await mkdir(path);
  await expect(store.command("post", message())).rejects.toThrow();
  expect(store.view("studio").room).toEqual(original);
  await rm(path, { recursive: true });
  await store.command("post", message());
  expect((await stat(folder)).mode & 0o777).toBe(mode);
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  expect(
    JSON.parse(await readFile(path, "utf8")).rooms[0].messages,
  ).toHaveLength(1);
});
it("rejects malformed saved data and invalid fields instead of resetting state", async () => {
  await expect(
    store.command("post", { ...message(), command: "execute" }),
  ).rejects.toThrow("Invalid");
  await expect(
    store.command("check-in", { ...checkin("writer"), state: "online" }),
  ).rejects.toThrow("Invalid");
  await writeFile(path, JSON.stringify({ version: 2, rooms: [] }));
  await expect(createBoardStore(path)).rejects.toThrow("Invalid BoardState");
});
it("includes prior shared context on a first check-in and lets agents ask the owner before the owner visits", async () => {
  const saved = await store.command("post", {
    ...message("writer", "human"),
    kind: "question",
  });
  const joined = await store.command("check-in", checkin("new-agent"));
  expect(joined.unreadIds).toEqual([saved.room.messages[0].id]);
  expect(store.view("studio", "human").pendingIds).toEqual([
    saved.room.messages[0].id,
  ]);
});
it("keeps unread work pending when an agent checks in again without reading the full board", async () => {
  await store.command("post", message());
  const joined = await store.command("check-in", checkin("reviewer"));
  expect(
    joined.room.members.find((m) => m.agent === "reviewer").lastReadSequence,
  ).toBe(0);
  expect(
    joined.room.members.find((m) => m.agent === "reviewer").lastReadAt,
  ).toBe("");
  expect(joined.unreadIds).toHaveLength(1);
});
it("separates action from FYI and bulk-resolves only the listed FYI items addressed to the caller", async () => {
  await store.command("check-in", checkin("human"));
  const post = (fields) =>
    store.command("post", { ...message("writer", "human"), ...fields });
  await post({ kind: "update", text: "Shipped the API." });
  await post({ kind: "handoff", text: "PR merged." });
  await post({ kind: "question", text: "Weekends?" });
  await post({ kind: "handoff", text: "Approve deploy?", attention: "action" });
  await post({ kind: "update", text: "Arrived later." });
  const room = store.view("studio", "human").room;
  expect(room.messages.map((m) => m.attention)).toEqual([
    "fyi",
    "fyi",
    "action",
    "action",
    "fyi",
  ]);
  const [shipped, merged, question, approve, later] = room.messages;
  const resolve = (messageIds, agent = "human") =>
    store.command("resolve-fyi", {
      project: "studio",
      agent,
      messageIds,
      note: "Read. No action needed.",
    });
  await expect(resolve([shipped.id, question.id])).rejects.toMatchObject({
    statusCode: 409,
  });
  await expect(resolve([shipped.id], "reviewer")).rejects.toMatchObject({
    statusCode: 403,
  });
  await expect(
    store.command("resolve-fyi", {
      project: "studio",
      agent: "human",
      messageIds: [shipped.id],
      note: "   ",
    }),
  ).rejects.toThrow("note");
  await resolve([shipped.id, merged.id]);
  await resolve([shipped.id, merged.id]);
  const after = (await createBoardStore(path)).view("studio", "human");
  const byId = Object.fromEntries(after.room.messages.map((m) => [m.id, m]));
  expect(byId[shipped.id]).toMatchObject({
    resolvedBy: "human",
    resolutionNote: "Read. No action needed.",
    acknowledgedAt: "",
  });
  expect(after.pendingIds).toEqual([question.id, approve.id, later.id]);
});
it("derives attention for messages saved before it existed without rewriting them", async () => {
  await store.command("check-in", checkin("human"));
  await store.command("post", {
    ...message("writer", "human"),
    kind: "update",
  });
  const saved = JSON.parse(await readFile(path, "utf8"));
  for (const m of saved.rooms[0].messages) delete m.attention;
  for (const [sequence, kind] of [
    [2, "blocker"],
    [3, "handoff"],
  ])
    saved.rooms[0].messages.push({
      ...saved.rooms[0].messages[0],
      id: randomUUID(),
      requestId: randomUUID(),
      sequence,
      kind,
    });
  await writeFile(path, JSON.stringify(saved));
  const legacy = await createBoardStore(path);
  const old = legacy.view("studio", "human").room.messages;
  expect(old.map(attentionOf)).toEqual(["fyi", "action", "action"]);
  expect(old.every((m) => m.attention === undefined)).toBe(true);
  expect(await readFile(path, "utf8")).not.toContain("attention");
  const resolve = (ids, includeOldHandoffs) =>
    legacy.command("resolve-fyi", {
      project: "studio",
      agent: "human",
      messageIds: ids,
      note: "Checked.",
      ...(includeOldHandoffs ? { includeOldHandoffs } : {}),
    });
  const [update, blocker, handoff] = old.map((m) => m.id);
  await expect(resolve([update, handoff])).rejects.toMatchObject({
    statusCode: 409,
  });
  await expect(resolve([handoff, blocker], true)).rejects.toMatchObject({
    statusCode: 409,
  });
  await legacy.command("post", {
    ...message("writer", "human"),
    attention: "action",
    text: "Approve the deploy?",
  });
  const newAction = legacy.view("studio").room.messages.at(-1).id;
  await expect(resolve([newAction], true)).rejects.toMatchObject({
    statusCode: 409,
  });
  await resolve([update, handoff], true);
  expect(legacy.view("studio", "human").pendingIds).toEqual([
    blocker,
    newAction,
  ]);
});
it("marks old unfinished check-ins stale at read time with a configurable threshold", async () => {
  let clock = "2026-10-01T00:00:00.000Z";
  const timed = (hours) =>
    createBoardStore(join(folder, `timed-${hours ?? "default"}.json`), {
      now: () => clock,
      ...(hours ? { staleAfterHours: hours } : {}),
    });
  const board = await timed();
  await board.command("check-in", checkin("old-worker"));
  await board.command("check-in", { ...checkin("finished"), state: "done" });
  await board.command("check-in", checkin("human"));
  const stored = await readFile(join(folder, "timed-default.json"), "utf8");
  clock = "2026-10-03T23:00:00.000Z";
  expect(board.view("studio").staleAgents).toEqual([]);
  clock = "2026-10-04T01:00:00.000Z";
  const report = board.view("studio");
  expect(report.staleAfterHours).toBe(72);
  expect(report.staleAgents).toEqual(["old-worker"]);
  expect(report.room.members[0].state).toBe("working");
  expect(await readFile(join(folder, "timed-default.json"), "utf8")).toBe(
    stored,
  );
  await board.command("check-in", checkin("old-worker"));
  expect(board.view("studio").staleAgents).toEqual([]);
  clock = "2026-10-01T00:00:00.000Z";
  const strict = await timed(1);
  await strict.command("check-in", checkin("brief-worker"));
  clock = "2026-10-01T02:00:00.000Z";
  expect(strict.view("studio").staleAgents).toEqual(["brief-worker"]);
  await expect(timed(-1)).rejects.toThrow("stale threshold");
});
