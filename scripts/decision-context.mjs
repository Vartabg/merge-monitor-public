import { commonGroundDecisions } from "./common-ground-decisions.mjs";
import { rankDecisions } from "./decision-search.mjs";

export function relevantBoardDecisions(room, query) {
  const active = room.messages.filter(
    (m) => m.kind === "decision" && !m.resolvedAt && m.status !== "superseded",
  );
  const ranked = rankDecisions(
    active.map((m) => ({ ...m, recordedAt: m.at })),
    query,
  );
  const ids = new Set(ranked.map((m) => m.id));
  const remaining = 5 - ranked.length;
  const recent = remaining
    ? active.filter((m) => !ids.has(m.id)).slice(-remaining)
    : [];
  return [...ranked, ...recent].slice(0, 5);
}

export async function savedDecisionContext(
  origin,
  project,
  query,
  options = {},
) {
  try {
    const fetcher = options.fetcher || fetch;
    const response = await fetcher(`${new URL(origin).origin}/api/repos`, {
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error("No configured project");
    const config = await response.json();
    const repo = config.repos?.find((item) => item.id === project);
    if (!repo || typeof repo.path !== "string" || !repo.path.startsWith("/"))
      throw new Error("No configured project");
    return await commonGroundDecisions([repo.path], query, options);
  } catch {
    return {
      source: "Common Ground saved decisions",
      status: "unavailable",
      decisions: [],
      matched: 0,
      omitted: 0,
      note: "The configured project could not be checked. Saved decisions were not read.",
    };
  }
}

export function decisionQuery(room, agent) {
  const member = room.members.find((item) => item.agent === agent);
  return [member?.task, member?.scope].filter(Boolean).join(" ").slice(0, 2000);
}
