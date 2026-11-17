import { expect, it } from "vitest";
import { buildWakePrompt, harnessCommand, planWakes, shellQuote, validateConfig, wakeKey } from "../scripts/dispatch.mjs";

const agent = { boardAgent: "op-helper", project: "example", harness: "opencode", cwd: "/Users/test/code/your-project" };
const config = { agents: [agent], intervalSeconds: 30 };
const assignment = { id: "a-1", owner: "op-helper", status: "queued", revision: 2, title: "Do the thing", purpose: "Why", scope: "Files X", acceptance: "Tests pass" };

it("validates config and rejects a harness the board could pick", () => {
  expect(validateConfig(config).agents).toHaveLength(1);
  expect(() => validateConfig({ agents: [{ ...agent, harness: "anything-board-says" }] })).toThrow(/Unknown harness/);
  expect(() => validateConfig({ agents: [] })).toThrow(/non-empty/);
});

it("quotes shell text so board content cannot break out of the prompt", () => {
  expect(shellQuote("a'b; rm -rf /")).toBe("'a'\\''b; rm -rf /'");
  expect(harnessCommand(agent, "hi")).toBe("opencode '/Users/test/code/your-project' --prompt 'hi'");
  expect(harnessCommand({ ...agent, harness: "muse" }, "hi")).toBe("muse 'hi'");
});

it("builds a wake prompt that orders claim-first and never merge", () => {
  const prompt = buildWakePrompt(agent, assignment);
  expect(prompt).toContain("team_claim");
  expect(prompt).toContain("Do not merge");
  expect(prompt).toContain("assignment a-1");
});

it("wakes once per revision, never for others' or malformed work", () => {
  const inbox = new Map([["example:op-helper", { assignments: [assignment] }]]);
  const first = planWakes(config, inbox, { wakes: {} });
  expect(first).toHaveLength(1);
  expect(first[0].key).toBe(wakeKey(agent, assignment));
  expect(planWakes(config, inbox, { wakes: { [first[0].key]: "t" } })).toHaveLength(0);
  expect(planWakes(config, new Map([["example:op-helper", { assignments: [{ ...assignment, revision: 3 }] }]]),
    { wakes: { [first[0].key]: "t" } })).toHaveLength(1); // a requeue at a new revision wakes again
  expect(planWakes(config, new Map([["example:op-helper", { assignments: [{ ...assignment, owner: "someone-else" }] }]]), { wakes: {} })).toHaveLength(0);
  expect(planWakes(config, new Map([["example:op-helper", { assignments: [{ ...assignment, title: "x".repeat(500) }] }]]), { wakes: {} })).toHaveLength(0);
});
