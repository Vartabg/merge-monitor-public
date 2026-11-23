import { useEffect, useState } from "react";
import { getJson } from "./api";
import { loadSavedProject } from "./projectStorage";
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
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [owner, setOwner] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [reposError, setReposError] = useState("");
  const [boardError, setBoardError] = useState("");
  const [reposRetry, setReposRetry] = useState(0);
  const [boardRetry, setBoardRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getJson<Repos>("/api/repos", { signal: controller.signal })
      .then((value) => {
        if (controller.signal.aborted) return;
        const saved = loadSavedProject();
        setConfig(value);
        setReposError("");
        setProject((current) =>
          value.repos.some((repo) => repo.id === current)
            ? current
            : value.repos.some((repo) => repo.id === saved)
              ? saved
              : value.defaultRepo,
        );
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setReposError("Projects could not be loaded. Try again before saving.");
      });
    return () => controller.abort();
  }, [reposRetry]);

  useEffect(() => {
    onReady(false);
    setMembers([]);
    setOwner("");
    setReviewer("");
    if (!project) {
      setLoadingMembers(false);
      return;
    }
    setLoadingMembers(true);
    const controller = new AbortController();
    getJson<components["schemas"]["Board"]>(
      `/api/board?project=${encodeURIComponent(project)}`,
      { signal: controller.signal },
    )
      .then((value) => {
        if (controller.signal.aborted) return;
        setMembers(value.room.members.map((member) => member.agent));
        setBoardError("");
        setLoadingMembers(false);
        onReady(true);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLoadingMembers(false);
          setBoardError(
            "This project’s agents could not be loaded. Try again before saving.",
          );
        }
      });
    return () => controller.abort();
  }, [project, boardRetry, onReady]);

  const error = reposError || boardError;
  const peopleDisabled = !project || loadingMembers;

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
            setBoardError("");
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
          disabled={peopleDisabled}
          onChange={(event) => {
            const nextOwner = event.target.value;
            setOwner(nextOwner);
            if (nextOwner.toLowerCase() === reviewer.toLowerCase())
              setReviewer("");
          }}
        >
          <option value="">Choose an agent</option>
          {members.map((name) => (
            <option key={name} value={name}>
              {name === "human" ? "You" : name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Reviewer
        <select
          name="reviewer"
          required
          value={reviewer}
          disabled={peopleDisabled}
          onChange={(event) => setReviewer(event.target.value)}
        >
          <option value="">Choose a different reviewer</option>
          {members
            .filter((name) => name.toLowerCase() !== owner.toLowerCase())
            .map((name) => (
              <option key={name} value={name}>
                {name === "human" ? "You" : name}
              </option>
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
            onClick={() => {
              if (reposError) setReposRetry((value) => value + 1);
              else setBoardRetry((value) => value + 1);
            }}
          >
            Try again
          </button>
        </div>
      )}
    </fieldset>
  );
}
