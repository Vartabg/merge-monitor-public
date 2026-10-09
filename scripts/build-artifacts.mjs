import { writeFile, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
await writeFile(
  "dist/release.json",
  JSON.stringify(
    { version, commit, builtAt: new Date().toISOString() },
    null,
    2,
  ),
);
console.log(`[Build] Production assets → version ${version}`);
