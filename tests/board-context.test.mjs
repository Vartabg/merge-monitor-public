import { expect, it } from "vitest";
import {
  compactContext,
  messageDetail,
  projectInstructionFiles,
} from "../scripts/board-context.mjs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const messages = Array.from({ length: 100 }, (_, i) => ({
  id: String(i),
  sequence: i + 1,
  agent: "writer",
  to: i < 10 ? "reviewer" : "",
  kind: i % 10 === 0 ? "decision" : "update",
  text: `Message ${i}: ${"Context ".repeat(350)}`,
  replyTo: "",
  acknowledgedAt: "",
  resolvedAt: "",
}));
const report = {
  room: {
    project: "studio",
    goal: "Coordinate a release.",
    revision: 3,
    goalBy: "human",
    members: [],
    messages,
  },
  asOf: "2026-09-11T19:00:00Z",
  unreadIds: messages.map((m) => m.id),
  pendingIds: [],
};
it("bounds context, retains oldest pending requests and decisions, and makes every omission explicit", () => {
  const before = structuredClone(report);
  const brief = compactContext(report, "reviewer", [
    { path: "/project/AGENTS.md", sha256: "example" },
  ]);
  expect(brief.messages.length).toBeLessThanOrEqual(18);
  expect(brief.messages.slice(0, 8).map((m) => m.id)).toEqual(
    messages.slice(0, 8).map((m) => m.id),
  );
  expect(brief.counts.openRequestsForYou).toBe(10);
  expect(brief.counts.omittedOpenRequests).toBe(2);
  expect(brief.messages.every((m) => m.text.length <= 600)).toBe(true);
  expect(brief.messages.every((m) => m.truncated)).toBe(true);
  expect(JSON.stringify(brief).length).toBeLessThan(
    JSON.stringify(report).length / 5,
  );
  expect(brief.guidance).toContain("not a replacement");
  expect(brief.guidance).toContain("does not mark");
  expect(report).toEqual(before);
});
it("loads exact truncated content and its reply parent without mixing projects", () => {
  const r = structuredClone(report);
  r.room.messages[2].replyTo = "1";
  const detail = messageDetail(r, "2");
  expect(detail.message.text).toBe(messages[2].text);
  expect(detail.original.id).toBe("1");
  expect(() => messageDetail(r, "absent")).toThrow(
    "not in the selected project",
  );
});
it("fingerprints original instruction files without returning their contents and detects changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "board-context-"));
  const fetcher = async () =>
    new Response(JSON.stringify({ repos: [{ id: "studio", path: root }] }));
  try {
    await writeFile(
      join(root, "AGENTS.md"),
      "Follow the local verification policy.",
    );
    const first = await projectInstructionFiles(
      "http://127.0.0.1:5173",
      "studio",
      fetcher,
    );
    expect(first).toHaveLength(1);
    expect(JSON.stringify(first)).not.toContain("Follow the local");
    await writeFile(join(root, "AGENTS.md"), "Updated policy.");
    const second = await projectInstructionFiles(
      "http://127.0.0.1:5173",
      "studio",
      fetcher,
    );
    expect(first[0].sha256).not.toBe(second[0].sha256);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("flags stale teammates, counts unread and separates actions from FYI for the agent", () => {
  const member = (agent, lastReadSequence = 0) => ({
    agent,
    task: "Work",
    scope: "",
    state: "working",
    checkedInAt: "2026-09-01T00:00:00Z",
    lastReadAt: "",
    lastReadSequence,
  });
  const base = {
    id: "",
    agent: "writer",
    to: "reviewer",
    text: "Done.",
    replyTo: "",
    acknowledgedAt: "",
    resolvedAt: "",
  };
  const brief = compactContext(
    {
      room: {
        ...report.room,
        members: [member("reviewer", 1), member("writer"), member("idle")],
        messages: [
          { ...base, id: "a", sequence: 1, kind: "question" },
          { ...base, id: "b", sequence: 2, kind: "handoff", attention: "fyi" },
          { ...base, id: "c", sequence: 3, kind: "update", to: "" },
          { ...base, id: "d", sequence: 4, kind: "update", to: "other" },
        ],
      },
      asOf: report.asOf,
      unreadIds: [],
      pendingIds: [],
      staleAfterHours: 72,
      staleAgents: ["writer"],
    },
    "reviewer",
  );
  expect(brief.staleAfterHours).toBe(72);
  expect(brief.teammates.map((m) => [m.agent, m.stale])).toEqual([
    ["writer", true],
    ["idle", false],
  ]);
  expect(brief.yourTask.stale).toBe(false);
  expect(brief.counts).toMatchObject({
    openRequestsForYou: 2,
    openActionsForYou: 1,
    unreadForYou: 2,
    staleTeammates: 1,
  });
  expect(brief.messages.find((m) => m.id === "b").attention).toBe("fyi");
});
