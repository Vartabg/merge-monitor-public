import { describe, expect, it } from "vitest";
import { serve, freshStatus } from "./agent-check-fixture.mjs";
import { CHECKS, INTERPRETATION, run } from "../scripts/agent-check.mjs";

const args = (port, extra = []) => [
  "--repo",
  "demo",
  "--port",
  String(port),
  ...extra,
];
const reportOf = (result) => JSON.parse(result.stdout);

describe("agent-check", () => {
  it("fresh reports carry branch identity and safety limits", async () => {
    const { port } = await serve(freshStatus());
    const result = await run(args(port, ["--wait", "2"]));
    expect(result.exitCode).toBe(0);
    const report = reportOf(result);
    expect(report.schemaVersion).toBe(1);
    expect(report.availability).toBe("fresh");
    expect(report.project).toEqual({ id: "demo", label: "Demo" });
    expect(report.baseRef).toBe("refs/heads/main");
    expect(report.baseSha).toBe("b".repeat(40));
    expect(report.checks).toEqual(CHECKS);
    expect(report.checks.featureTests).toBe("not-run");
    const task = report.tasks.find((t) => t.branch === "feature-a");
    expect(task.headSha).toBe("a".repeat(40));
    expect(task.preview.outcome).toBe("clean");
    expect(report.interpretation).toBe(INTERPRETATION);
    expect(report.interpretation).toMatch(/not review or test approval/);
  });

  it("--branch filters tasks but keeps relevant shared-file conflicts", async () => {
    const { port } = await serve(freshStatus());
    const result = await run(
      args(port, ["--branch", "feature-a", "--wait", "2"]),
    );
    expect(result.exitCode).toBe(0);
    const report = reportOf(result);
    expect(report.tasks.map((t) => t.branch)).toEqual(["feature-a"]);
    expect(report.conflicts).toEqual([
      { file: "shared.ts", branches: ["feature-a", "feature-b"] },
    ]);
  });

  it("missing --branch fails without substituting another task", async () => {
    const { port } = await serve(freshStatus());
    const result = await run(args(port, ["--branch", "nope", "--wait", "2"]));
    expect(result.exitCode).toBe(2);
    const report = reportOf(result);
    expect(report.availability).toBe("unavailable");
    expect(report.tasks).toEqual([]);
    expect(report.reason).toMatch(/not found/);
  });

  it("default scope excludes primary, parked and finished work", async () => {
    const { port } = await serve(freshStatus());
    const result = await run(args(port, ["--wait", "2"]));
    const report = reportOf(result);
    expect(report.tasks.map((t) => t.branch).sort()).toEqual([
      "feature-a",
      "feature-b",
    ]);
    expect(report.primaryHousekeeping.map((t) => t.branch)).toEqual(["main"]);
    expect(report.tasks.every((t) => !t.isPrimary && !t.isParked)).toBe(true);
  });

  it("explicit parked, primary and finished branches are reported honestly", async () => {
    const { port } = await serve(freshStatus());
    const parked = reportOf(await run(args(port, ["--branch", "parked"])));
    expect(parked.tasks[0].isParked).toBe(true);
    expect(parked.branchSelection).toMatchObject({
      branch: "parked",
      isParked: true,
    });
    const primary = reportOf(await run(args(port, ["--branch", "main"])));
    expect(primary.tasks[0].isPrimary).toBe(true);
    const finished = await run(args(port, ["--branch", "old"]));
    expect(finished.exitCode).toBe(0);
    expect(reportOf(finished).tasks[0].category).toBe("finished");
  });

  it("user-provided notes surface without inferred ownership", async () => {
    const { port } = await serve(freshStatus());
    const report = reportOf(await run(args(port, ["--wait", "2"])));
    const task = report.tasks.find((t) => t.branch === "feature-a");
    expect(task.note).toEqual({
      source: "user-provided",
      title: "Add widget",
      purpose: "Support widgets",
      owner: "Garo",
    });
    expect(report.tasks.find((t) => t.branch === "feature-b").note).toBeNull();
  });

  it("stale and incomplete statuses never produce fresh advice", async () => {
    const stale = await serve(freshStatus({}, { stale: true }));
    const r1 = await run(args(stale.port, ["--wait", "0"]));
    expect(r1.exitCode).toBe(2);
    expect(reportOf(r1).availability).toBe("unavailable");
    expect(reportOf(r1).reason).toMatch(/stale/i);
    const incomplete = await serve(freshStatus({ incomplete: true }));
    const r2 = await run(args(incomplete.port, ["--wait", "0"]));
    expect(r2.exitCode).toBe(2);
    expect(reportOf(r2).reason).toMatch(/incomplete/i);
  });

  it("bounded wait recovers on cold start but stops polling on timeout", async () => {
    const cold = await serve((n) =>
      n < 3 ? { ...freshStatus(), status: null } : freshStatus(),
    );
    const ok = await run(args(cold.port, ["--wait", "5"]));
    expect(ok.exitCode).toBe(0);
    expect(cold.hits()).toBeGreaterThan(1);
    const down = await serve({ ...freshStatus(), status: null });
    const result = await run(args(down.port, ["--wait", "1"]));
    expect(result.exitCode).toBe(2);
    expect(reportOf(result).availability).toBe("unavailable");
    expect(down.hits()).toBeLessThanOrEqual(5);
  });

  it("strict argument validation rejects bad input with exit 2", async () => {
    for (const argv of [
      [],
      ["--port", "5173"],
      ["--repo", "demo", "--port", "80"],
      ["--repo", "demo", "--port", "99999"],
      ["--repo", "demo", "--port", "abc"],
      ["--repo", "demo", "--wait", "-1"],
      ["--repo", "demo", "--wait", "121"],
      ["--repo", "demo", "--bogus", "x"],
      ["--repo", "demo", "--branch"],
    ]) {
      const result = await run(argv);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/--help/);
    }
  });

  it("preserves the actual check timestamp and rejects mismatched or malformed evidence", async () => {
    const data = freshStatus({
      generatedAt: new Date(Date.now() - 3000).toISOString(),
    });
    const valid = await serve(data);
    expect(
      reportOf(await run(args(valid.port, ["--wait", "0"]))).checkedAt,
    ).toBe(data.status.generatedAt);
    for (const invalid of [
      { ...data, stale: undefined },
      { ...data, repoId: "wrong" },
      { ...data, status: { ...data.status, generatedAt: "unknown" } },
    ]) {
      const endpoint = await serve(invalid);
      expect((await run(args(endpoint.port, ["--wait", "0"]))).exitCode).toBe(
        2,
      );
    }
  });
  it("does not reuse saved notes from another project or working-copy path", async () => {
    const data = freshStatus(
      {},
      {
        taskContexts: [
          { ...freshStatus().taskContexts[0], path: "/old-copy" },
          { ...freshStatus().taskContexts[0], repoId: "other" },
        ],
      },
    );
    const endpoint = await serve(data);
    expect(
      reportOf(
        await run(
          args(endpoint.port, ["--branch", "feature-a", "--wait", "0"]),
        ),
      ).tasks[0].note,
    ).toBeNull();
  });
  it("rejects redirects and bounds a hung HTTP lookup", async () => {
    const redirect = await serve("redirect");
    expect((await run(args(redirect.port, ["--wait", "0"]))).exitCode).toBe(2);
    expect(redirect.paths).toEqual(["/api/repos"]);
    const hanging = await serve("hang");
    const started = Date.now();
    expect((await run(args(hanging.port, ["--wait", "0"]))).exitCode).toBe(2);
    expect(Date.now() - started).toBeLessThan(2500);
  });
  it("--help lists syntax and exits 0", async () => {
    const result = await run(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/--repo ID/);
    expect(result.stdout).toMatch(/--branch/);
    expect(result.stdout).toMatch(/--port/);
    expect(result.stdout).toMatch(/--wait/);
  });
});
