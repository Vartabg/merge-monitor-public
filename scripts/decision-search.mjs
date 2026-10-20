// Local, deterministic retrieval. Source text remains data, never instructions.
const stop = new Set(
  "a an and are as at be been by for from i in into is it of on or our the this to we with agent agents project task please update implement build src app ts tsx js py tests".split(
    " ",
  ),
);
const words = (value) => [
  ...new Set(
    (
      String(value || "")
        .normalize("NFKC")
        .toLocaleLowerCase()
        .match(/[\p{L}\p{N}]+/gu) || []
    ).filter((word) => word.length > 1 && !stop.has(word)),
  ),
];

export function rankDecisions(records, query, limit = 5) {
  const terms = words(query).slice(0, 80);
  if (!terms.length) return [];
  return records
    .filter((record) => record.status !== "superseded")
    .map((record) => {
      const topic = new Set(words(record.topic));
      const body = new Set(
        words([record.text, record.quote, record.returnPoint].join(" ")),
      );
      const matchTerms = terms.filter(
        (term) => topic.has(term) || body.has(term),
      );
      const score = matchTerms.reduce(
        (sum, term) => sum + (topic.has(term) ? 3 : 1),
        0,
      );
      return { record, score, matchTerms };
    })
    .filter((match) => match.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (Date.parse(b.record.recordedAt) || 0) -
          (Date.parse(a.record.recordedAt) || 0) ||
        String(a.record.id).localeCompare(String(b.record.id)),
    )
    .slice(0, Math.max(0, Math.min(1000, limit)))
    .map(({ record, matchTerms }) => ({ ...record, matchTerms }));
}
