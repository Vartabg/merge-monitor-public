import { useState } from "react";
import { postJson } from "./api";
import { progressLabels } from "./assignmentTypes";
import type { Assignment, AssignmentUpdate } from "./assignmentTypes";

const next: Record<Assignment["status"], Assignment["status"][]> = {
  queued: ["queued", "working", "blocked"],
  working: ["working", "review", "blocked"],
  review: ["review", "accepted", "working", "blocked"],
  blocked: ["blocked", "queued", "working"],
  accepted: [],
};
export function AssignmentProgress({
  item,
  onSave,
  onBusy,
  disabled,
}: {
  item: Assignment;
  onSave: (value: Assignment) => void;
  onBusy: (busy: boolean) => void;
  disabled: boolean;
}) {
  const [status, setStatus] = useState(item.status);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input: AssignmentUpdate = {
      id: item.id,
      revision: item.revision,
      status,
      summary: String(data.get("summary") || "").trim(),
      artifacts: String(data.get("artifacts") || "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      reviewNote: String(data.get("reviewNote") || "").trim(),
    };
    setSaving(true);
    onBusy(true);
    setError("");
    try {
      onSave(await postJson<Assignment>("/api/assignments/update", input));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Progress could not be saved. Try again.",
      );
    } finally {
      setSaving(false);
      onBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <h3>Update progress</h3>
      <p className="team-note">
        Record what happened. This form does not run a helper or perform the
        review.
      </p>
      <fieldset className="team-fields" disabled={saving || disabled}>
        <legend className="sr-only">Progress and evidence</legend>
        <label className="team-wide">
          Recorded progress
          <select
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as Assignment["status"])
            }
          >
            {next[item.status].map((value) => (
              <option key={value} value={value}>
                {progressLabels[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="team-wide">
          What changed?
          <textarea
            name="summary"
            defaultValue={item.summary}
            required
            maxLength={1200}
            rows={3}
          />
        </label>
        <label className="team-wide">
          Evidence links or file paths
          <textarea
            name="artifacts"
            defaultValue={item.artifacts.join("\n")}
            required={status === "accepted"}
            maxLength={5124}
            rows={3}
            aria-describedby="evidence-help"
          />
        </label>
        <p id="evidence-help" className="team-note team-wide">
          Up to five web links or full file paths, one per line.
        </p>
        <label className="team-wide">
          Review findings
          <textarea
            name="reviewNote"
            defaultValue={item.reviewNote}
            required={status === "accepted"}
            maxLength={1600}
            rows={3}
          />
        </label>
      </fieldset>
      {error && (
        <div className="error-box" role="alert">
          <p>{error}</p>
          <p>
            For a newer version, return to assignments and open this work again.
          </p>
        </div>
      )}
      <button className="button" disabled={saving || disabled}>
        {saving ? "Saving…" : "Save progress"}
      </button>
      <p role="status" className="team-note">
        {saving ? "Saving progress…" : ""}
      </p>
    </form>
  );
}
