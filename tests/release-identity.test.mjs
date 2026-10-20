import { expect, it } from "vitest";
import { writeFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { releaseIdentity } from "../server/release.mjs";
import { repository } from "./fixtures.mjs";

it("captures backend commit once, independently of later frontend and Git changes", async () => {
  const fixture = await repository();
  try {
    const before = fixture.git(["rev-parse", "HEAD"]);
    const identity = await releaseIdentity(fixture.path);
    expect(identity.commit).toBe(before);
    expect(identity.sourceDirty).toBe(false);
    await mkdir(join(fixture.path, "dist"));
    await writeFile(
      join(fixture.path, "dist/release.json"),
      JSON.stringify({ commit: "b".repeat(40) }),
    );
    fixture.git(["add", "."]);
    fixture.git(["commit", "-m", "new frontend"]);
    expect(identity.commit).toBe(before);
    expect((await releaseIdentity(fixture.path)).commit).not.toBe(before);
  } finally {
    await fixture.cleanup();
  }
});
it("reports export provenance or unknown identity honestly without a Git checkout", async () => {
  const folder = await mkdtemp(join(tmpdir(), "mm-release-"));
  try {
    expect((await releaseIdentity(folder)).commit).toBeNull();
    await writeFile(
      join(folder, "RELEASE-MANIFEST.json"),
      JSON.stringify({ sourceCommit: "a".repeat(40) }),
    );
    const identity = await releaseIdentity(folder);
    expect(identity.commit).toBe("a".repeat(40));
    expect(identity.sourceDirty).toBeNull();
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
