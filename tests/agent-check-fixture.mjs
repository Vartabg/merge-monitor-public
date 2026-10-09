import { afterEach } from "vitest";
import { createServer } from "node:http";
import { ready, response } from "./ui-fixtures";
export const repos = {
  repos: [
    {
      id: "demo",
      label: "Demo",
      path: "/tmp/demo",
      defaultBranch: "main",
      excludedBranches: ["parked"],
    },
  ],
  defaultRepo: "demo",
};

const wt = (over = {}) => ({
  ...ready,
  path: `/wt/${over.branch ?? "x"}`,
  branch: "x",
  primary: false,
  state: "ok",
  isDirty: false,
  headSha: "a".repeat(40),
  category: "working",
  reason: "r",
  nextAction: "n",
  preview: null,
  overlappingFiles: [],
  ...over,
});

export const freshStatus = (statusOver = {}, responseOver = {}) => ({
  ...response(),
  repoId: "demo",
  status: {
    ...response().status,
    repoId: "demo",
    label: "Demo",
    baseRef: "refs/heads/main",
    baseSha: "b".repeat(40),
    generatedAt: new Date().toISOString(),
    incomplete: false,
    worktrees: [
      wt({
        branch: "feature-a",
        overlappingFiles: ["shared.ts"],
        preview: {
          ...ready.preview,
          outcome: "clean",
          message: "Git can combine these commits.",
          files: [],
          checkedAt: new Date().toISOString(),
          baseSha: "b".repeat(40),
          headSha: "a".repeat(40),
        },
      }),
      wt({
        branch: "feature-b",
        headSha: "c".repeat(40),
        overlappingFiles: ["shared.ts"],
      }),
      wt({ branch: "main", primary: true, category: "ready", path: "/repo" }),
      wt({ branch: "parked", category: "working" }),
      wt({ branch: "old", category: "finished" }),
    ],
    conflicts: [{ file: "shared.ts", branches: ["feature-a", "feature-b"] }],
    fileMapSize: 1,
    ...statusOver,
  },
  error: null,
  refreshing: false,
  stale: false,
  worker: response().worker,
  history: [],
  taskContexts: [
    {
      repoId: "demo",
      path: "/wt/feature-a",
      branch: "feature-a",
      title: "Add widget",
      purpose: "Support widgets",
      owner: "Garo",
      updatedAt: new Date().toISOString(),
    },
  ],
  ...responseOver,
});

let servers = [];
export async function serve(statuses) {
  let n = 0;
  const paths = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    paths.push(url.pathname);
    if (statuses === "hang") return;
    if (statuses === "redirect" && url.pathname === "/api/repos") {
      res.writeHead(302, { Location: "/unexpected" });
      res.end();
      return;
    }
    const send = (code, body) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method !== "GET") return send(405, { error: "Use GET." });
    if (url.pathname === "/api/repos") return send(200, repos);
    if (url.pathname === "/api/status") {
      n += 1;
      return send(200, typeof statuses === "function" ? statuses(n) : statuses);
    }
    return send(404, { error: "nope" });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  return { port: server.address().port, hits: () => n, paths };
}
afterEach(async () => {
  await Promise.all(
    servers.map(
      (s) =>
        new Promise((r) => {
          s.closeAllConnections();
          s.close(r);
        }),
    ),
  );
  servers = [];
});
