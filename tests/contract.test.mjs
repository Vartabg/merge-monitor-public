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
