import Ajv from "ajv/dist/2020.js";
import { teamSchemas } from "./team-contract.mjs";
import { createTeamWorkflow } from "./team-workflow.mjs";
const ajv = new Ajv({ strict: false });
const validators = Object.fromEntries(
  Object.entries(teamSchemas)
    .filter(([name]) => !["TeamInbox", "TeamRun", "TeamRuns"].includes(name))
    .map(([name, schema]) => [name, ajv.compile(schema)]),
);
const fail = (message, statusCode) => {
  throw Object.assign(new Error(message), { statusCode });
};
export function createTeamApi(dependencies) {
  const workflow = dependencies.executions
    ? createTeamWorkflow(dependencies)
    : null;
  return async function teamRequest(path, req, body) {
    const command = path.slice("/api/team/".length),
      reads = ["inbox", "runs"];
    if (
      ![
        "inbox",
        "runs",
        "claim",
        "start",
        "renew",
        "finish",
        "cancel",
        "abandon",
      ].includes(command)
    )
      fail("This team endpoint does not exist. Use the worker inbox.", 404);
    const method = reads.includes(command) ? "GET" : "POST";
    if (req.method !== method)
      fail(`Use ${method} for this team endpoint.`, 405);
    if (!workflow)
      fail(
        "Agent execution is unavailable. Restart the verified local service and retry.",
        503,
      );
    let value;
    if (method === "GET") {
      const params = new URL(req.url, "http://localhost").searchParams;
      const fields = command === "inbox" ? ["project", "agent"] : ["project"];
      if (
        [...params.keys()].some((key) => !fields.includes(key)) ||
        fields.some((key) => params.getAll(key).length !== 1)
      )
        fail("Choose one configured project and agent for the inbox.", 400);
      value = Object.fromEntries(params);
      if (command === "inbox" && !validators.TeamIdentity(value))
        fail(
          "Use the configured project and a valid agent identity, then retry.",
          400,
        );
      if (
        Object.values(value).some(
          (item) =>
            typeof item !== "string" ||
            !item.trim() ||
            item.length > 120 ||
            Array.from(item).some(
              (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
            ),
        )
      )
        fail("Use plain project and agent names, then retry.", 400);
    } else {
      const name = "Team" + command[0].toUpperCase() + command.slice(1),
        schema = teamSchemas[name];
      value = await body(req, Object.keys(schema.properties), 16384);
      if (!validators[name](value))
        fail(
          "This team request has invalid fields. Check the worker command and retry.",
          400,
        );
    }
    return workflow[command](value);
  };
}
