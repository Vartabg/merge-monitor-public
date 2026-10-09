import { describe, expect, it, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createAssignmentStore } from "../server/assignments.mjs";
import {
  createFields,
  updateFields,
} from "../server/assignment-validation.mjs";

const CREATE_NAMES = [
  "title",
  "project",
  "purpose",
  "owner",
  "model",
  "reviewer",
  "scope",
  "acceptance",
  "budget",
];
const UPDATE_NAMES = [
  "id",
  "revision",
  "status",
  "summary",
  "artifacts",
  "reviewNote",
];
const RECORD_NAMES = [
  ...CREATE_NAMES,
  "id",
  "revision",
  "status",
  "summary",
  "artifacts",
  "reviewNote",
  "createdAt",
  "updatedAt",
  "history",
];
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const roots = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "assignments-"));
  roots.push(root);
  const path = join(root, "nested", "assignments.json");
  const store = await createAssignmentStore(path);
  return { root, path, store };
}

function validCreate(overrides = {}) {
  return {
    title: "Repair login redirect",
    project: "merge-monitor",
    purpose: "Fix the failing redirect so reviewers can sign in.",
    owner: "Garo",
    model: "Muse Spark",
    reviewer: "Codex",
    scope: "server/auth.mjs plus tests",
    acceptance: "Redirect lands on the dashboard with a valid session.",
    budget: "$0, local only",
    ...overrides,
  };
}

function validUpdate(record, overrides = {}) {
  return {
    id: record.id,
    revision: record.revision,
    status: "working",
    summary: "Started implementation.",
    artifacts: [],
    reviewNote: "",
    ...overrides,
  };
}

async function expectStatus(promise, statusCode) {
  try {
    await promise;
  } catch (error) {
    expect(error?.statusCode).toBe(statusCode);
    return error;
  }
  throw new Error(`Expected rejection with statusCode ${statusCode}.`);
}

async function toWorking(store, record, overrides = {}) {
  return store.update(validUpdate(record, overrides));
}

async function toReview(store, record, summary = "Ready for review.") {
  const working = await toWorking(store, record);
  return store.update(
    validUpdate(working, { status: "review", summary }),
  );
}

describe("field contract", () => {
  it("exports the exact create/update field names", () => {
    expect([...createFields].sort()).toEqual([...CREATE_NAMES].sort());
    expect([...updateFields].sort()).toEqual([...UPDATE_NAMES].sort());
  });
});

describe("creation", () => {
  it("creates a queued record with exact names and persists it", async () => {
    const { path, store } = await setup();
    const record = await store.create(validCreate());
    expect(Object.keys(record).sort()).toEqual([...RECORD_NAMES].sort());
    expect(record.id).toMatch(UUID_RE);
    expect(record.revision).toBe(1);
    expect(record.status).toBe("queued");
    expect(record.summary).toBe("");
    expect(record.artifacts).toEqual([]);
    expect(record.reviewNote).toBe("");
    expect(Date.parse(record.createdAt)).not.toBeNaN();
    expect(Date.parse(record.updatedAt)).not.toBeNaN();
    expect(record.history).toEqual([
      { at: record.createdAt, status: "queued", summary: "Assignment created." },
    ]);
    const persisted = JSON.parse(await readFile(path, "utf8"));
    expect(persisted).toEqual({ version: 1, assignments: [record] });
  });

  it("trims input and allows newlines only in multiline fields", async () => {
    const { store } = await setup();
    const record = await store.create(
      validCreate({ title: "  Padded title  ", purpose: "line one\nline two" }),
    );
    expect(record.title).toBe("Padded title");
    expect(record.purpose).toBe("line one\nline two");
    await expectStatus(
      store.create(validCreate({ title: "bad\ntitle" })),
      400,
    );
  });

  it("rejects bad create input with 400", async () => {
    const { store } = await setup();
    const cases = [
      ["unknown field", validCreate({ extra: "nope" })],
      ["missing field", (() => { const v = validCreate(); delete v.budget; return v; })()],
      ["null value", validCreate({ title: null })],
      ["array value", validCreate({ title: ["x"] })],
      ["non-string", validCreate({ title: 42 })],
      ["empty title", validCreate({ title: "   " })],
      ["overlong title", validCreate({ title: "t".repeat(121) })],
      ["overlong purpose", validCreate({ purpose: "p".repeat(801) })],
      ["control char", validCreate({ title: "bad\x01title" })],
      ["reviewer equals owner", validCreate({ reviewer: " garo " })],
    ];
    for (const [name, input] of cases) {
      await expectStatus(store.create(input), 400, name);
    }
    expect(store.list()).toHaveLength(0);
  });

  it("survives restart with identical records", async () => {
    const { path, store } = await setup();
    const first = await store.create(validCreate());
    const second = await store.create(
      validCreate({ title: "Second job", reviewer: "Gemini" }),
    );
    const reopened = await createAssignmentStore(path);
    expect(reopened.list()).toEqual([first, second]);
  });

  it("uses restrictive file and directory modes", async () => {
    const { path, store } = await setup();
    await store.create(validCreate());
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(dirname(path))).mode & 0o777).toBe(0o700);
  });

  it("returns clones from list()", async () => {
    const { store } = await setup();
    const record = await store.create(validCreate());
    const listed = store.list();
    listed[0].title = "mutated";
    listed.push(record);
    expect(store.list()).toEqual([record]);
  });
});

describe("updates", () => {
  it("advances queued -> working -> review -> accepted with evidence", async () => {
    const { store } = await setup();
    const created = await store.create(validCreate());
    const working = await toWorking(store, created);
    expect(working.revision).toBe(2);
    const review = await store.update(
      validUpdate(working, { status: "review", summary: "Ready." }),
    );
    expect(review.revision).toBe(3);
    const accepted = await store.update(
      validUpdate(review, {
        status: "accepted",
        summary: "Looks good.",
        artifacts: ["/tmp/report.md"],
        reviewNote: "Verified evidence.",
      }),
    );
    expect(accepted.revision).toBe(4);
    expect(accepted.history.map((event) => event.status)).toEqual([
      "queued",
      "working",
      "review",
      "accepted",
    ]);
    expect(accepted.history).toHaveLength(4);
  });

  it("serializes simultaneous same-revision updates without losing history", async () => {
    const { store } = await setup();
    const created = await store.create(validCreate());
    const payload = validUpdate(created, {
      status: "working",
      summary: "Take one.",
    });
    const [first, second] = await Promise.allSettled([
      store.update(payload),
      store.update({ ...payload }),
    ]);
    const fulfilled = [first, second].filter((r) => r.status === "fulfilled");
    const rejected = [first, second].filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason?.statusCode).toBe(409);
    const [listed] = store.list();
    expect(listed.revision).toBe(2);
    expect(listed.summary).toBe("Take one.");
    expect(listed.history).toHaveLength(2);
    expect(listed.history[1]).toEqual({
      at: listed.updatedAt,
      status: "working",
      summary: "Take one.",
    });
  });

  it("rejects stale revisions and unknown ids", async () => {
    const { store } = await setup();
    const created = await store.create(validCreate());
    const working = await toWorking(store, created);
    await expectStatus(
      store.update(validUpdate(created, { summary: "Stale write." })),
      409,
    );
    await expectStatus(
      store.update(
        validUpdate({ ...working, id: "12345678-1234-1234-1234-123456789abc" }),
      ),
      404,
    );
    expect(store.list()[0].revision).toBe(2);
  });

  it("enforces transition gates with 409", async () => {
    const { store } = await setup();
    const created = await store.create(validCreate());
    await expectStatus(
      store.update(validUpdate(created, { status: "review" })),
      409,
    );
    const working = await toWorking(store, created);
    await expectStatus(
      store.update(
        validUpdate(working, {
          status: "accepted",
          summary: "Skip review.",
          artifacts: ["/tmp/x.md"],
          reviewNote: "note",
        }),
      ),
      409,
    );
    const blocked = await store.update(
      validUpdate(working, { status: "blocked", summary: "Blocked." }),
    );
    await expectStatus(
      store.update(validUpdate(blocked, { status: "review" })),
      409,
    );
    const reopened = await store.update(
      validUpdate(blocked, { status: "queued", summary: "Requeued." }),
    );
    expect(reopened.status).toBe("queued");
  });

  it("requires evidence for accepted with 400", async () => {
    const { store } = await setup();
    const created = await store.create(validCreate());
    const review = await toReview(store, created);
    await expectStatus(
      store.update(validUpdate(review, { status: "accepted", summary: "No files." })),
      400,
    );
    await expectStatus(
      store.update(
        validUpdate(review, {
          status: "accepted",
          summary: "No note.",
          artifacts: ["/tmp/x.md"],
          reviewNote: "   ",
        }),
      ),
      400,
    );
  });

  it("keeps accepted records immutable", async () => {
    const { store } = await setup();
    const review = await toReview(store, await store.create(validCreate()));
    const accepted = await store.update(
      validUpdate(review, {
        status: "accepted",
        summary: "Done.",
        artifacts: ["https://example.com/report"],
        reviewNote: "Checked.",
      }),
    );
    await expectStatus(store.update(validUpdate(accepted)), 409);
    await expectStatus(
      store.update(validUpdate(accepted, { summary: "Edit note." })),
      409,
    );
    expect(store.list()[0].revision).toBe(4);
  });

  it("allows same-status updates except accepted", async () => {
    const { store } = await setup();
    const working = await toWorking(store, await store.create(validCreate()));
    const again = await store.update(
      validUpdate(working, { summary: "Still working." }),
    );
    expect(again.revision).toBe(3);
    expect(again.history).toHaveLength(3);
  });

  it("caps working assignments at three and frees slots", async () => {
    const { store } = await setup();
    const records = [];
    for (let i = 0; i < 4; i += 1) {
      records.push(await store.create(validCreate({ title: `Job ${i}` })));
    }
    for (let i = 0; i < 3; i += 1) {
      records[i] = await toWorking(store, records[i]);
    }
    await expectStatus(toWorking(store, records[3]), 409);
    records[0] = await store.update(
      validUpdate(records[0], { status: "review", summary: "For review." }),
    );
    records[3] = await toWorking(store, records[3]);
    expect(records[3].status).toBe("working");
    expect(store.list().filter((a) => a.status === "working")).toHaveLength(3);
  });

  it("rejects bad update input and unsafe links with 400", async () => {
    const { store } = await setup();
    const created = await store.create(validCreate());
    const badLinks = [
      "ftp://example.com/x",
      "javascript:alert(1)",
      "//example.com/x",
      "relative/path.md",
      "http://user:pass@example.com/",
      "/abs/path/with\nnewline",
      "/abs/path/with\x01control",
      "https://",
      "notaurl",
    ];
    for (const link of badLinks) {
      await expectStatus(
        store.update(validUpdate(created, { artifacts: [link] })),
        400,
      );
    }
    await expectStatus(
      store.update(validUpdate(created, { artifacts: ["ok", "2", "3", "4", "5", "6"] })),
      400,
    );
    await expectStatus(store.update(validUpdate(created, { revision: 0 })), 400);
    await expectStatus(store.update(validUpdate(created, { status: "done" })), 400);
    await expectStatus(store.update(validUpdate(created, { summary: "" })), 400);
    await expectStatus(
      store.update({ ...validUpdate(created), unknown: true }),
      400,
    );
    const good = await store.update(
      validUpdate(created, { artifacts: ["/tmp/a.md"] }),
    );
    expect(good.artifacts).toEqual(["/tmp/a.md"]);
  });

  it("leaves memory unchanged after failed writes and recovers", async () => {
    const { store } = await setup();
    const created = await store.create(validCreate());
    const working = await toWorking(store, created);
    await expectStatus(
      store.update(validUpdate(created, { summary: "Stale." })),
      409,
    );
    expect(store.list()).toEqual([working]);
    const review = await store.update(
      validUpdate(working, { status: "review", summary: "Recovered." }),
    );
    expect(review.revision).toBe(3);
  });

  it("caps stored assignments at 500 with 409", async () => {
    const { store } = await setup();
    for (let i = 0; i < 500; i += 1) {
      await store.create(validCreate({ title: `Job ${i}` }));
    }
    expect(store.list()).toHaveLength(500);
    await expectStatus(store.create(validCreate({ title: "Overflow" })), 409);
    expect(store.list()).toHaveLength(500);
  });
});

describe("corrupt state", () => {
  it("refuses invalid files and never overwrites them", async () => {
    const root = await mkdtemp(join(tmpdir(), "assignments-"));
    roots.push(root);
    const cases = [
      ["not json", "this is not json{{{"],
      ["wrong version", JSON.stringify({ version: 2, assignments: [] })],
      ["missing key", JSON.stringify({ version: 1 })],
      ["extra top-level key", JSON.stringify({ version: 1, assignments: [], extra: 1 })],
    ];
    for (const [name, bytes] of cases) {
      const path = join(root, `${name.replace(/\W+/g, "-")}.json`);
      await writeFile(path, bytes, { mode: 0o600 });
      await expect(createAssignmentStore(path)).rejects.toThrow();
      expect(await readFile(path, "utf8")).toBe(bytes);
    }
  });

  it("refuses persisted records with extra fields or weak evidence", async () => {
    const { path, store } = await setup();
    const created = await store.create(validCreate());
    const raw = JSON.parse(await readFile(path, "utf8"));
    raw.assignments[0] = { ...created, injected: true };
    const bytes = JSON.stringify(raw);
    await writeFile(path, bytes);
    await expect(createAssignmentStore(path)).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe(bytes);
  });
});
