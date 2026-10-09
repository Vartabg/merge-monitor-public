import { useEffect, useRef, useState } from "react";
import { postJson } from "./api";
import type { Assignment, AssignmentCreate } from "./assignmentTypes";

const fields: {
  name: keyof AssignmentCreate;
  label: string;
  max: number;
  multiline?: boolean;
}[] = [
  { name: "title", label: "Work name", max: 120 },
  { name: "project", label: "Project", max: 120 },
  { name: "purpose", label: "Why it matters", max: 800, multiline: true },
  { name: "owner", label: "Assigned to", max: 120 },
  { name: "model", label: "Model or tool", max: 120 },
  { name: "reviewer", label: "Reviewer", max: 120 },
  { name: "scope", label: "Allowed work", max: 1600, multiline: true },
  {
    name: "acceptance",
    label: "Acceptance checks",
    max: 1600,
    multiline: true,
  },
  { name: "budget", label: "Time or usage limit", max: 400 },
];
export function AssignmentForm({
  onSave,
  onCancel,
  disabled,
}: {
  onSave: (assignment: Assignment) => void;
  onCancel: () => void;
  disabled: boolean;
}) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    title.current?.focus();
  }, []);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input = Object.fromEntries(
      fields.map(({ name }) => [name, String(data.get(name) || "").trim()]),
    ) as AssignmentCreate;
    setSaving(true);
    setError("");
    try {
      onSave(await postJson<Assignment>("/api/assignments", input));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The assignment could not be saved. Try again.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="team-panel" aria-labelledby="new-assignment">
      <h2 id="new-assignment" ref={title} tabIndex={-1}>
        Add an assignment
      </h2>
      <p>
        Give the helper a clear result to produce and a different person or
        agent to review it.
      </p>
      <form onSubmit={submit}>
        <fieldset disabled={saving || disabled} className="team-fields">
          <legend className="sr-only">Assignment details</legend>
          {fields.map(({ name, label, max, multiline }) => (
            <label key={name} className={multiline ? "team-wide" : ""}>
              {label}
              {multiline ? (
                <textarea name={name} required maxLength={max} rows={3} />
              ) : (
                <input name={name} required maxLength={max} />
              )}
            </label>
          ))}
        </fieldset>
        {error && (
          <p className="error-box" role="alert">
            {error}
          </p>
        )}
        <div className="team-actions">
          <button className="button" disabled={saving || disabled}>
            {saving ? "Saving…" : "Save assignment"}
          </button>
          <button
            className="button secondary"
            type="button"
            disabled={saving}
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
        <p role="status" className="team-note">
          {saving
            ? "Saving the assignment…"
            : "Saving adds this work to the queue. The coordinator arranges its execution."}
        </p>
      </form>
    </section>
  );
}
