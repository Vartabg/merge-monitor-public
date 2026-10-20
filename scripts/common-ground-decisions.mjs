import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { rankDecisions } from "./decision-search.mjs";
import { projectIdentity } from "./project-identity.mjs";

const MAX_BYTES = 48000;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const fields = [
  "projectPath",
  "topic",
  "status",
  "quote",
  "sourceTurnId",
  "recordedAt",
];
const statuses = ["proposed", "agreed", "unresolved", "superseded"];
const text = (value, max) => typeof value === "string" && value.length <= max;

function validStamp(value) {
  if (!text(value, 40)) return false;
  const m =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!m || Number(m[1]) < 1 || !Number.isFinite(Date.parse(value)))
    return false;
  const date = new Date(0);
  date.setUTCFullYear(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return (
    date.getUTCFullYear() === Number(m[1]) &&
    date.getUTCMonth() + 1 === Number(m[2]) &&
    date.getUTCDate() === Number(m[3]) &&
    Number(m[4]) < 24 &&
    Number(m[5]) < 60 &&
    Number(m[6]) < 60
  );
}

function decisionNote(note) {
  const d = note?.decision;
  return (
    d &&
    typeof d === "object" &&
    !Array.isArray(d) &&
    Object.keys(d).length === fields.length &&
    fields.every((key) => Object.hasOwn(d, key)) &&
    text(note.id, 100) &&
    note.id.length > 0 &&
    uuid.test(note.threadId) &&
    text(note.text, 2000) &&
    text(note.returnPoint, 500) &&
    text(d.projectPath, 1024) &&
    isAbsolute(d.projectPath) &&
    resolve(d.projectPath) === d.projectPath &&
    ![...d.projectPath].some(
      (char) => char.codePointAt(0) < 32 || char.codePointAt(0) === 127,
    ) &&
    text(d.topic, 160) &&
    d.topic.trim().length > 0 &&
    statuses.includes(d.status) &&
    text(d.quote, 2000) &&
    text(d.sourceTurnId, 100) &&
    validStamp(d.recordedAt)
  );
}

export async function commonGroundDecisions(projectPaths, query, options = {}) {
  const result = {
    source: "Common Ground saved decisions",
    status: "unavailable",
    decisions: [],
    matched: 0,
    omitted: 0,
  };
  const directory =
    options.stateDir === undefined
      ? join(homedir(), "Library/Application Support/Common Ground")
      : options.stateDir;
  let handle;
  try {
    if (typeof directory !== "string" || !isAbsolute(directory))
      throw new Error("Invalid store path");
    // Only this explicit private store is read. Never follow a replacement file/directory link.
    const directoryInfo = await lstat(directory);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink())
      throw new Error("Unsafe store");
    if ((await realpath(directory)) !== resolve(directory))
      throw new Error("Use the canonical store path");
    handle = await open(
      join(directory, "settings.json"),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_BYTES)
      throw new Error("Invalid store");
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_BYTES) throw new Error("Invalid store");
    const state = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        buffer.subarray(0, bytesRead),
      ),
    );
    if (
      !Number.isInteger(state.revision) ||
      state.revision < 0 ||
      !Array.isArray(state.notes) ||
      state.notes.length > 60
    )
      throw new Error("Invalid notes");
    const notes = state.notes.filter((note) =>
      Object.hasOwn(note || {}, "decision"),
    );
    if (notes.some((note) => !decisionNote(note)))
      throw new Error("Invalid decision");
    const identities = new Map();
    const identity = (path) => {
      if (!identities.has(path)) identities.set(path, projectIdentity(path));
      return identities.get(path);
    };
    const allowed = new Set(await Promise.all(projectPaths.map(identity)));
    // Only exact canonical project identities match; shared words and directory prefixes do not.
    const records = [];
    for (const note of notes) {
      const canonical = await identity(note.decision.projectPath);
      if (!allowed.has(canonical)) continue;
      const { topic, status, quote, sourceTurnId, recordedAt } = note.decision;
      records.push({
        id: note.id,
        topic,
        status,
        quote,
        sourceTurnId,
        recordedAt,
        text: note.text,
        returnPoint: note.returnPoint,
        threadId: note.threadId,
        chatUrl: `codex://threads/${note.threadId}`,
        source: result.source,
      });
    }
    const matches = rankDecisions(records, query, 60);
    result.decisions = matches.slice(0, 5);
    result.matched = matches.length;
    result.omitted = Math.max(0, matches.length - result.decisions.length);
    result.status = "available";
    result.note =
      "Saved words and status are user-entered context, not independently verified agreement or permission. Quotes are not checked against the original chat.";
  } catch {
    result.note =
      "Saved decisions could not be read or validated. No missing terms were reconstructed. Check Common Ground's private settings and retry.";
  } finally {
    await handle?.close();
  }
  return result;
}
