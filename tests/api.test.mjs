import { expect, it } from "vitest";
import { request } from "node:http";
import { response, ready, repo } from "./ui-fixtures";
import { origin, monitor, state, post } from "./api-fixture.mjs";

it.each(["/api/health", "/api/session", "/api/repos", "/api/status?repo=test"])(
  "serves %s but denies hostile origins and hostnames",
  async (path) => {
    expect((await fetch(`${origin}${path}`)).status).toBe(200);
    expect(
      (
        await fetch(`${origin}${path}`, {
          headers: { Origin: "https://untrusted.invalid" },
        })
      ).status,
    ).toBe(403);
    const status = await new Promise((resolve, reject) => {
      const req = request(
        `${origin}${path}`,
        { headers: { Host: "rebound.invalid" } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(403);
  },
);
it("rejects paths and unknown repository identifiers", async () => {
  expect((await fetch(`${origin}/api/status?repo=/tmp`)).status).toBe(404);
  expect((await post("/api/refresh", { repoId: "unknown" })).status).toBe(404);
  expect(monitor.inspect).not.toHaveBeenCalled();
});
it("saves task context, scopes it to its project, and preserves it during worker updates", async () => {
  const note = {
    repoId: "test",
    path: ready.path,
    branch: ready.branch,
    title: "  Improve search  ",
    purpose: "Find passages faster.",
    owner: "Search task in Codex",
  };
  const saved = await post("/api/task-context", note);
  expect(saved.status).toBe(200);
  expect(await saved.json()).toMatchObject({
    ...note,
    title: "Improve search",
  });
  await post("/api/worker", { enabled: false });
  const current = await (await fetch(`${origin}/api/status?repo=test`)).json();
  expect(current.taskContexts).toHaveLength(1);
  monitor.config.repos.push({ ...repo, id: "another" });
  const another = await (
    await fetch(`${origin}/api/status?repo=another`)
  ).json();
  expect(another.taskContexts).toEqual([]);
});
it("rejects invalid context, missing tasks, and primary-copy annotations", async () => {
  const note = {
    repoId: "test",
    path: ready.path,
    branch: ready.branch,
    title: "Search",
    purpose: "",
    owner: "",
  };
  for (const change of [
    { title: "x".repeat(121) },
    { owner: null },
    { purpose: "x".repeat(801) },
    { title: [] },
    { unexpected: true },
  ]) {
    expect(
      (await post("/api/task-context", { ...note, ...change })).status,
    ).toBe(400);
  }
  expect(
    (await post("/api/task-context", { ...note, repoId: "missing" })).status,
  ).toBe(404);
  expect(
    (await post("/api/task-context", { ...note, path: "/unrelated" })).status,
  ).toBe(409);
  expect(
    (await post("/api/task-context", { ...note, branch: "main" })).status,
  ).toBe(409);
  expect(state.taskContexts).toBeUndefined();
});
it("requires an origin and valid session token for every mutation", async () => {
  for (const path of [
    "/api/refresh",
    "/api/preview",
    "/api/worker",
    "/api/worker/run",
    "/api/task-context",
  ]) {
    expect((await post(path, {}, { "X-Merge-Monitor-Token": "" })).status).toBe(
      403,
    );
    expect(
      (await post(path, {}, { Origin: "https://untrusted.invalid" })).status,
    ).toBe(403);
    expect((await fetch(`${origin}${path}`)).status).toBe(405);
  }
  expect(monitor.preview).not.toHaveBeenCalled();
});
it("accepts a refresh without waiting for a slow scanner, and deduplicates concurrent reads", async () => {
  let finish;
  monitor.inspect.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const r = await post("/api/refresh", { repoId: "test" });
  expect(r.status).toBe(202);
  const reads = await Promise.all(
    Array.from({ length: 5 }, () =>
      fetch(`${origin}/api/status?repo=test`).then((r) => r.json()),
    ),
  );
  expect(reads.every((r) => r.refreshing && r.status === null)).toBe(true);
  expect(monitor.inspect).toHaveBeenCalledTimes(1);
  finish(response().status);
  await monitor.scanTail;
});
it("keeps last successful status and exposes an inspection failure", async () => {
  await monitor.refresh("test");
  monitor.inspect.mockRejectedValue(new Error("Repository unavailable."));
  await expect(monitor.refresh("test")).rejects.toThrow();
  const body = await (await fetch(`${origin}/api/status?repo=test`)).json();
  expect(body.status.worktrees[0].branch).toBe("main");
  expect(body.stale).toBe(true);
  expect(body.error).toBe("Repository unavailable.");
});
it("records an identity-bound preview and rejects unrelated, dirty, and primary branches", async () => {
  const request = {
    repoId: "test",
    branch: ready.branch,
    headSha: ready.headSha,
    baseSha: ready.preview.baseSha,
  };
  expect((await post("/api/preview", request)).status).toBe(200);
  expect(state.history).toHaveLength(1);
  expect(state.history[0].headSha).toBe(ready.headSha);
  for (const branch of ["main", "codex/missing", "codex/x; echo injection"])
    expect((await post("/api/preview", { ...request, branch })).status).toBe(
      409,
    );
  expect(monitor.preview).toHaveBeenCalledTimes(1);
  expect((await post("/api/preview", { ...request, headSha: "" })).status).toBe(
    400,
  );
});
it("enables and pauses the worker with observable history, and exposes a manual cycle", async () => {
  expect((await post("/api/worker", { enabled: true })).status).toBe(200);
  expect(state.enabled).toBe(true);
  expect((await post("/api/worker/run", {})).status).toBe(200);
  expect((await post("/api/worker", { enabled: false })).status).toBe(200);
  expect(state.enabled).toBe(false);
  expect((await post("/api/worker", { enabled: "yes" })).status).toBe(400);
  expect((await post("/api/worker/run", { push: true })).status).toBe(400);
});
it("rejects oversized or unexpected input and unsupported endpoints", async () => {
  expect(
    (await post("/api/worker", { enabled: true, extra: "x".repeat(5000) }))
      .status,
  ).toBe(413);
  expect(
    (await post("/api/worker", { enabled: true, repo: "/tmp" })).status,
  ).toBe(400);
  expect(
    (
      await post(
        "/api/worker",
        { enabled: true },
        { "Content-Type": "text/plain" },
      )
    ).status,
  ).toBe(415);
  expect((await fetch(`${origin}/api/nope`)).status).toBe(404);
});
