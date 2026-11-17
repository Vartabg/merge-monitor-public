import { expect, it } from "vitest";
import Ajv from "ajv/dist/2020.js";
import { contract } from "../server/contract.mjs";
import { response } from "./ui-fixtures";
import { inspectRepository } from "../server/inspection.mjs";
import { repository } from "./fixtures.mjs";

const ajv = new Ajv({ strict: false, allErrors: true });
const validate = (name) =>
  ajv.compile({
    ...contract.components.schemas[name],
    components: contract.components,
  });
it("keeps response fixtures and the generated UI contract aligned", () => {
  const check = validate("StatusResponse");
  expect(check(response()), JSON.stringify(check.errors)).toBe(true);
});
it("publishes an optional structured finding on board messages", () => {
  const check = validate("BoardMessage");
  const message = {
    project: "studio",
    agent: "reviewer",
    to: "writer",
    kind: "handoff",
    text: "Fix the rolling window.",
    replyTo: "",
    requestId: "7f0b3b2c-2a6d-4f4b-9a9b-1c2d3e4f5a6b",
    id: "0b7c1f2e-3d4a-4b5c-8d6e-7f8a9b0c1d2e",
    sequence: 1,
    at: "2026-10-07T20:00:00Z",
    acknowledgedAt: "",
    resolvedAt: "",
    resolvedBy: "",
  };
  expect(check(message), JSON.stringify(check.errors)).toBe(true);
  const finding = {
    claim: "Update 51 fails.",
    evidence: "",
    expected: "",
    actual: "",
    severity: "blocking",
    scope: "",
    doneCheck: "",
  };
  expect(check({ ...message, finding }), JSON.stringify(check.errors)).toBe(
    true,
  );
  expect(check({ ...message, finding: { ...finding, severity: "high" } })).toBe(
    false,
  );
});
it("produces inspection results that conform to the published schema", async () => {
  const fixture = await repository();
  try {
    await fixture.addTask("contract", { "task.txt": "change" });
    const result = await inspectRepository(fixture.repo, {
      readStatus: fixture.readStatus,
    });
    const check = validate("Status");
    expect(check(result), JSON.stringify(check.errors)).toBe(true);
  } finally {
    await fixture.cleanup();
  }
});
