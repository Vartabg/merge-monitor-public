import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

// One service owns each file. This is atomic replacement, not a sandbox against
// hostile code running as the same OS user or a power-loss durability guarantee.
export async function privateStateFile(path, {
  maxBytes = 64 * 1024 * 1024,
  temporaryId = randomUUID,
} = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 2)
    throw new Error("Choose a finite state-file size limit.");
  const directory = dirname(path);
  const uid = process.getuid?.();
  const sameOwner = (info) => uid === undefined || info.uid === uid;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  async function checkDirectory() {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() ||
        (info.mode & 0o077) !== 0 || !sameOwner(info))
      throw new Error("State directory must be private, owner-controlled and nonsymlink. Restore its safe path and permissions before retrying.");
  }
  function checkRegular(info) {
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 ||
        (info.mode & 0o077) !== 0 || !sameOwner(info) || info.size > maxBytes)
      throw new Error("State file must be a bounded private single-link regular file. Restore a valid private file before retrying.");
  }
  async function checkFile() {
    try {
      const info = await lstat(path);
      checkRegular(info);
      return info;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }
  await checkDirectory();
  return {
    async read() {
      await checkDirectory();
      const original = await checkFile();
      if (!original) throw Object.assign(new Error("No saved state file exists."), { code: "ENOENT" });
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const info = await handle.stat();
        checkRegular(info);
        if (info.dev !== original.dev || info.ino !== original.ino)
          throw new Error("State file changed while opening it. Retry after other state writers have stopped.");
        const chunks = [], buffer = Buffer.alloc(Math.min(65536, maxBytes + 1));
        let size = 0;
        for (;;) {
          const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, maxBytes + 1 - size));
          if (!bytesRead) break;
          size += bytesRead;
          if (size > maxBytes) throw new Error("Saved state exceeds its size limit. Preserve it and reduce the state before retrying.");
          chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
        }
        checkRegular(await handle.stat());
        try { return JSON.parse(Buffer.concat(chunks, size).toString("utf8")); }
        catch { throw new Error("Saved state is not valid JSON. Restore a valid state file before retrying."); }
      } finally { await handle.close(); }
    },
    async save(value) {
      const bytes = Buffer.from(JSON.stringify(value, null, 2));
      if (bytes.length > maxBytes)
        throw new Error("State exceeds its size limit. Preserve the saved file and reduce the state before retrying.");
      await checkDirectory();
      await checkFile();
      const id = temporaryId();
      if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("Use a valid unique state temporary-file identifier.");
      const temporary = `${path}.${id}.tmp`;
      let handle, owned;
      try {
        handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        owned = await handle.stat();
        checkRegular(owned);
        await handle.writeFile(bytes);
        await handle.sync();
        await handle.close(); handle = undefined;
        await checkDirectory();
        await checkFile();
        const current = await lstat(temporary);
        checkRegular(current);
        if (current.dev !== owned.dev || current.ino !== owned.ino)
          throw new Error("State temporary file changed. Retry after other state writers have stopped.");
        await rename(temporary, path);
        owned = undefined;
      } finally {
        if (handle) await handle.close().catch(() => {});
        if (owned) {
          const current = await lstat(temporary).catch(() => null);
          if (current?.dev === owned.dev && current?.ino === owned.ino)
            await unlink(temporary).catch(() => {});
        }
      }
    },
  };
}
