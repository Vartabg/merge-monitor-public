export const HELP_TEXT = `Usage: node scripts/agent-check.mjs --repo ID [--branch BRANCH] [--port PORT] [--wait SECONDS]
Read a shared project report without changing code or sending messages.
  --repo ID       Required configured project ID (GET /api/repos).
  --branch NAME   Optional exact branch. Missing branches fail without substitution.
  --port PORT     Local port 1024-65535, default 5173. Only 127.0.0.1 is contacted.
  --wait SECONDS  Fresh-report wait, 0-120, default 60. Zero permits one immediate
                 lookup with a one-second network budget. Redirects are rejected.
  --help, -h      Show this help.
Output: one JSON object. Use npm run --silent agent:check to omit npm's banner.
Exit 0: fresh report, possibly with problems. Exit 2: unavailable or invalid input.
A fresh report is not permission to merge, nor proof of tests or deployment.`;
const fail = (message) => {
  throw new Error(`${message} See --help for usage.`);
};
export function parseArgs(argv) {
  const options = {
    repo: null,
    branch: null,
    port: 5173,
    wait: 60,
    help: false,
  };
  const seen = new Set();
  for (let index = 0; index < argv.length; index++) {
    const [key, ...parts] = argv[index].split("=");
    if (key === "--help" || key === "-h") {
      if (parts.length) fail("Help takes no value.");
      options.help = true;
      continue;
    }
    if (!["--repo", "--branch", "--port", "--wait"].includes(key))
      fail(`Unknown argument ${key}.`);
    if (seen.has(key)) fail(`Repeated argument ${key}.`);
    seen.add(key);
    const value = parts.length ? parts.join("=") : argv[++index];
    if (!value || value.startsWith("--")) fail(`Missing value for ${key}.`);
    const field = key.slice(2);
    if (field === "port" || field === "wait") {
      if (!/^\d+(\.\d+)?$/.test(value)) fail(`Invalid ${key}.`);
      const number = Number(value);
      if (
        field === "port"
          ? !Number.isInteger(number) || number < 1024 || number > 65535
          : number < 0 || number > 120
      )
        fail(`Invalid ${key}.`);
      options[field] = number;
    } else options[field] = value;
  }
  if (!options.help && !options.repo?.trim())
    fail("Missing required --repo ID.");
  return options;
}
