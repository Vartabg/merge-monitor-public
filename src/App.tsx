import { useEffect, useState } from "react";
import { getJson } from "./api";
import { RepoDashboard } from "./RepoDashboard";
import type { Repos } from "./types";
import { WorkGuide } from "./WorkGuide";

const PROJECT_KEY = "merge-monitor.project";
export default function App() {
  const [config, setConfig] = useState<Repos | null>(null);
  const [active, setActive] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    getJson<Repos>("/api/repos", { signal: controller.signal })
      .then((value) => {
        if (controller.signal.aborted) return;
        let remembered = "";
        try {
          remembered = localStorage.getItem(PROJECT_KEY) || "";
        } catch {
          /* A blocked preference store still allows project selection. */
        }
        setConfig(value);
        setActive(
          value.repos.some((repo) => repo.id === remembered)
            ? remembered
            : value.defaultRepo,
        );
        setError(null);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError(
            "Merge Monitor is not connected. Ask the person helping with your project to start it, then try again.",
          );
      });
    return () => controller.abort();
  }, [retry]);
  function chooseProject(id: string) {
    setActive(id);
    try {
      localStorage.setItem(PROJECT_KEY, id);
    } catch {
      /* Preferences are optional; the current project remains selected. */
    }
  }
  const repo = config?.repos.find((value) => value.id === active);
  return (
    <div className="shell focus-shell">
      <a className="skip-link" href="#main">
        Skip to project report
      </a>
      <header className="simple-header">
        <p className="app-name">Merge Monitor</p>
        <a href="/">Team board</a>
        <a href="?view=team">Team assignments</a>
        <h1>Catch clashing changes early.</h1>
        <p className="app-purpose">
          For projects built with multiple AI helpers. One shared report of what
          fits together and what needs coordination.
        </p>
      </header>
      <main id="main" tabIndex={-1}>
        {config && (
          <div className="project-selector">
            <label htmlFor="project">Your project</label>
            <select
              id="project"
              value={active}
              onChange={(e) => chooseProject(e.target.value)}
            >
              {config.repos.map((value) => (
                <option key={value.id} value={value.id}>
                  {value.label}
                </option>
              ))}
            </select>
          </div>
        )}
        {error ? (
          <div className="error-box" role="alert">
            <p>{error}</p>
            <button
              className="button"
              onClick={() => setRetry((value) => value + 1)}
            >
              Try again
            </button>
          </div>
        ) : repo ? (
          <RepoDashboard key={repo.id} repo={repo} />
        ) : (
          <p className="empty" role="status">
            Connecting to your projects…
          </p>
        )}
        <WorkGuide />
      </main>
    </div>
  );
}
