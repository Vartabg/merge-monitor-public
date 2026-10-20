import { expect, it, vi } from "vitest";
import {
  teamToolCall,
  teamToolDefinitions,
} from "../scripts/team-mcp-tools.mjs";
it("exposes the same scoped protocol to every MCP client and delegates mutations exactly", async () => {
  expect(teamToolDefinitions.map((item) => item.name)).toEqual(
    expect.arrayContaining([
      "team_inbox",
      "team_wait",
      "team_claim",
      "team_start",
      "team_renew",
      "team_finish",
      "team_cancel",
      "team_abandon",
    ]),
  );
  const input = {
    project: "Studio",
    agent: "worker",
    assignmentId: "id",
    requestId: "request",
  };
  const client = {
    claim: vi.fn(async (value) => ({ runId: "new", input: value })),
  };
  expect(
    await teamToolCall("team_claim", input, "http://127.0.0.1:5187", {
      client,
    }),
  ).toEqual({ runId: "new", input });
  expect(client.claim).toHaveBeenCalledOnce();
});
it("returns an inbox cursor then waits for an actual change, rather than dispatching duplicate work", async () => {
  vi.useFakeTimers();
  try {
    let inbox = { version: 1, requests: [], assignments: [], runs: [] };
    const client = { inbox: vi.fn(async () => inbox) },
      input = { project: "Studio", agent: "reviewer", seconds: 1 };
    const initial = await teamToolCall("team_wait", input, "unused", {
      client,
    });
    expect(initial.changed).toBe(true);
    const pending = teamToolCall(
      "team_wait",
      { ...input, after: initial.cursor },
      "unused",
      { client },
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect((await pending).changed).toBe(false);
    inbox = {
      ...inbox,
      requests: [{ id: "handoff", text: "Review this result." }],
    };
    const changed = await teamToolCall(
      "team_wait",
      { ...input, after: initial.cursor },
      "unused",
      { client },
    );
    expect(changed.changed).toBe(true);
    expect(changed.inbox.requests).toHaveLength(1);
    await expect(
      teamToolCall("team_wait", { ...input, seconds: 120 }, "unused", {
        client,
      }),
    ).rejects.toThrow("1–55");
  } finally {
    vi.useRealTimers();
  }
});
