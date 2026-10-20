import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

async function descriptor(path) {
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 4096)
      throw new Error("Invalid Git descriptor");
    const buffer = Buffer.alloc(4097);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 4096) throw new Error("Invalid Git descriptor");
    return buffer.subarray(0, bytesRead).toString("utf8").trim();
  } finally {
    await handle.close();
  }
}

// Compare Git common directories rather than path prefixes or remote URLs.
// This reads bounded Git descriptors only; it never runs a repository command.
export async function projectIdentity(path) {
  const canonical = await realpath(path).catch(() => resolve(path));
  try {
    let root = canonical,
      marker;
    for (let depth = 0; depth < 32; depth++) {
      marker = join(root, ".git");
      const found = await lstat(marker).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (found) break;
      if (dirname(root) === root) return `path:${canonical}`;
      root = dirname(root);
    }
    const info = await lstat(marker);
    if (info.isSymbolicLink()) return `path:${canonical}`;
    let gitdir = marker;
    if (info.isFile()) {
      const match = /^gitdir: (.+)$/.exec(await descriptor(marker));
      if (!match) return `path:${canonical}`;
      gitdir = resolve(dirname(marker), match[1]);
    }
    const directory = await lstat(gitdir);
    if (!directory.isDirectory() || directory.isSymbolicLink())
      return `path:${canonical}`;
    const common = await descriptor(join(gitdir, "commondir")).catch(
      (error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      },
    );
    if (common === "") return `path:${canonical}`;
    const target = common === null ? gitdir : resolve(gitdir, common);
    const [targetInfo, config, objects] = await Promise.all([
      lstat(target),
      lstat(join(target, "config")),
      lstat(join(target, "objects")),
    ]);
    const head = await descriptor(join(target, "HEAD"));
    if (
      !targetInfo.isDirectory() ||
      targetInfo.isSymbolicLink() ||
      !config.isFile() ||
      config.isSymbolicLink() ||
      !objects.isDirectory() ||
      objects.isSymbolicLink() ||
      !/^(?:ref: refs\/[^\s]+|[a-f0-9]{40,64})$/.test(head)
    )
      return `path:${canonical}`;
    return `git:${await realpath(target)}`;
  } catch {
    return `path:${canonical}`;
  }
}
