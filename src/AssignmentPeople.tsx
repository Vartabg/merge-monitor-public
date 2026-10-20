import { useEffect, useState } from "react";
import { getJson } from "./api";
import type { Repos } from "./types";
import type { components } from "./api.generated";

export function AssignmentPeople({
  onReady,
}: {
  onReady: (ready: boolean) => void;
}) {
  const [config, setConfig] = useState<Repos>();
  const [project, setProject] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [owner, setOwner] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    getJson<Repos>("/api/repos", { signal: controller.signal })
      .then((value) => {
        if (controller.signal.aborted) return;
        setConfig(value);
        setProject((current) =>
          value.repos.some((repo) => repo.id === current)
            ? current
            : value.defaultRepo,
        );
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("Projects could not be loaded. Try again before saving.");
      });
    return () => controller.abort();
  }, [retry]);
  useEffect(() => {
    onReady(false);
    setMembers([]);
    setOwner("");
    setReviewer("");
    if (!project) return;
    const controller = new AbortController();
    getJson<components["schemas"]["Board"]>(
      `/api/board?project=${encodeURIComponent(project)}`,
      { signal: controller.signal },
    )
      .then((value) => {
        if (controller.signal.aborted) return;
        setMembers(value.room.members.map((member) => member.agent));
        setError("");
        onReady(true);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError(
            "This project’s agents could not be loaded. Try again before saving.",
          );
      });
    return () => controller.abort();
  }, [project, retry, onReady]);
  return (
    <fieldset className="team-fields team-wide">
      <legend>Project and people</legend>
      <label>
        Project
        <select
          name="project"
          required
          value={project}
          disabled={!config}
          onChange={(event) => {
            onReady(false);
            setProject(event.target.value);
          }}
        >
          <option value="">Choose a project</option>
          {config?.repos.map((repo) => (
            <option key={repo.id} value={repo.id}>
              {repo.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Assigned to
        <select
          name="owner"
          required
          value={owner}
          onChange={(event) => {
            setOwner(event.target.value);
            if (event.target.value === reviewer) setReviewer("");
          }}
        >
          <option value="">Choose an agent</option>
          {members.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </label>
      <label>
        Reviewer
        <select
          name="reviewer"
          required
          value={reviewer}
          onChange={(event) => setReviewer(event.target.value)}
        >
          <option value="">Choose a different reviewer</option>
          {members
            .filter((name) => name !== owner)
            .map((name) => (
              <option key={name}>{name}</option>
            ))}
        </select>
      </label>
      <p className="team-note team-wide">
        Both agents must check into this project’s board before you can assign
        work.
      </p>
      {error && (
        <div className="error-box team-wide" role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="button"
            onClick={() => setRetry((value) => value + 1)}
          >
            Try again
          </button>
        </div>
      )}
    </fieldset>
  );
}
