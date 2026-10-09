import { afterEach, beforeEach, expect, it } from "vitest";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv from "ajv/dist/2020.js";
import { createApi } from "../server/api.mjs";
import { createAssignmentStore } from "../server/assignments.mjs";
import { contract } from "../server/contract.mjs";

let folder, server, origin, token, store;
const input = {
  title: "Repair saved status",
  project: "Studio",
  purpose: "Trust the work queue.",
  owner: "Muse",
  model: "muse-spark-1.3-contributor",
  reviewer: "Gemini",
  scope: "Assignment files only",
  acceptance: "Regression passes",
  budget: "12 model steps",
};
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "team-api-"));
  store = await createAssignmentStore(join(folder, "queue.json"));
  server = createServer(createApi({}, {}, store));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  token = (await (await fetch(`${origin}/api/session`)).json()).token;
});
afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(folder, { recursive: true, force: true });
});
function post(path, value, headers = {}) {
  return fetch(`${origin}${path}`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "X-Merge-Monitor-Token": token,
      ...headers,
    },
    body: JSON.stringify(value),
  });
}
it("creates, lists and updates assignments with schema-aligned persistent responses", async () => {
  const made = await post("/api/assignments", input);
  expect(made.status).toBe(201);
  const assignment = await made.json();
  const check = new Ajv({ strict: false }).compile({
    ...contract.components.schemas.Assignment,
    components: contract.components,
  });
  expect(check(assignment), JSON.stringify(check.errors)).toBe(true);
  const list = await (await fetch(`${origin}/api/assignments`)).json();
  expect(list.assignments).toEqual([assignment]);
  const update = {
    id: assignment.id,
    revision: 1,
    status: "working",
    summary: "Implementation started.",
    artifacts: [],
    reviewNote: "",
  };
  expect((await post("/api/assignments/update", update)).status).toBe(200);
  expect((await post("/api/assignments/update", update)).status).toBe(409);
  expect(
    (await createAssignmentStore(join(folder, "queue.json"))).list()[0].status,
  ).toBe("working");
});
it("rejects hostile reads, unauthenticated writes, unknown fields and oversized input", async () => {
  expect(
    (
      await fetch(`${origin}/api/assignments`, {
        headers: { Origin: "https://evil.invalid" },
      })
    ).status,
  ).toBe(403);
  for (const path of ["/api/assignments", "/api/assignments/update"]) {
    expect(
      (await post(path, input, { "X-Merge-Monitor-Token": "" })).status,
    ).toBe(403);
    expect(
      (await post(path, { ...input, command: "run something" })).status,
    ).toBe(400);
    expect(
      (await post(path, { ...input, title: "x".repeat(17000) })).status,
    ).toBe(413);
  }
  expect((await fetch(`${origin}/api/assignments/update`)).status).toBe(405);
  expect((await fetch(`${origin}/api/assignments/missing`)).status).toBe(404);
  expect(store.list()).toEqual([]);
});
it("requires review and evidence before acceptance and never launches work", async () => {
  const made = await (await post("/api/assignments", input)).json();
  const update = {
    id: made.id,
    revision: 1,
    status: "accepted",
    summary: "Claimed complete",
    artifacts: [],
    reviewNote: "",
  };
  expect(
    (await post("/api/assignments/update", update)).status,
  ).toBeGreaterThanOrEqual(400);
  expect(store.list()[0].status).toBe("queued");
  expect(
    (await post("/api/assignments", { ...input, reviewer: input.owner }))
      .status,
  ).toBe(400);
});
