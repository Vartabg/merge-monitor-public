import { useEffect, useRef, useState } from "react";
import { getJson } from "./api";
import { AssignmentForm } from "./AssignmentForm";
import { AssignmentDetail } from "./AssignmentDetail";
import { progressLabels } from "./assignmentTypes";
import type { Assignment, Assignments } from "./assignmentTypes";
import "./styles/assignments.css";

export function TeamDesk() {
  const [items, setItems] = useState<Assignment[] | null>(null);
  const [selected, setSelected] = useState<Assignment | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [notice, setNotice] = useState("");
  const addButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    async function load() {
      if (pending) return;
      pending = true;
      try {
        const value = await getJson<Assignments>("/api/assignments", {
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setItems(value.assignments);
          setError(false);
        }
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        pending = false;
      }
    }
    void load();
    const timer = setInterval(() => {
      void load();
    }, 15000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [retry]);
  function save(item: Assignment) {
    setItems((current) => [
      item,
      ...(current || []).filter((value) => value.id !== item.id),
    ]);
    setCreating(false);
    setSelected(item);
    setNotice("Assignment saved.");
    setRetry((value) => value + 1);
  }
  function close() {
    const id = selected?.id;
    setSelected(null);
    setCreating(false);
    setNotice("");
    requestAnimationFrame(() => {
      if (id) document.getElementById(`assignment-${id}`)?.focus();
      else addButton.current?.focus();
    });
  }
  const visible = [...(items || [])].sort((a, b) => {
    const order = { blocked: 0, review: 1, working: 2, queued: 3, accepted: 4 };
    return (
      order[a.status] - order[b.status] ||
      b.updatedAt.localeCompare(a.updatedAt)
    );
  });
  return (
    <div className="shell focus-shell team-desk">
      <a className="skip-link" href="#main">
        Skip to assignments
      </a>
      <header className="simple-header">
        <a href="/" className="team-back">
          Merge Monitor · Team board
        </a>
        <h1>Your team’s work.</h1>
        <p className="app-purpose">
          See who owns each assignment, what they produced, and what needs
          review.
        </p>
      </header>
      <main id="main" tabIndex={-1}>
        <p className="team-note">
          Progress is recorded by the coordinator. Accepted work includes
          evidence and a named reviewer.
        </p>
        <p role="status" className="team-note">
          {notice}
        </p>
        {error && (
          <div className="error-box" role="alert">
            <p>
              The queue is not connected. Saved details may be out of date. Try
              again before updating work.
            </p>
            <button
              className="button"
              onClick={() => setRetry((value) => value + 1)}
            >
              Try again
            </button>
          </div>
        )}
        {creating ? (
          <AssignmentForm onSave={save} onCancel={close} disabled={error} />
        ) : selected ? (
          <AssignmentDetail
            key={`${selected.id}:${selected.revision}`}
            assignment={selected}
            disabled={error}
            onSave={save}
            onClose={close}
          />
        ) : (
          <>
            <div className="team-toolbar">
              <p>
                {items
                  ? `${items.filter((item) => item.status === "working").length} of 3 work slots in use`
                  : "Loading assignments…"}
              </p>
              <button
                ref={addButton}
                className="button"
                onClick={() => {
                  setCreating(true);
                  setNotice("");
                }}
                disabled={!items || error}
              >
                Add an assignment
              </button>
            </div>
            {items && items.length === 0 && (
              <section className="empty">
                <h2>Ready for the first assignment.</h2>
                <p>Give one helper a clear result, a limit, and a reviewer.</p>
              </section>
            )}
            <ul className="team-list" aria-label="Assignments">
              {visible.map((item) => (
                <li key={item.id}>
                  <p className="team-progress">
                    {progressLabels[item.status]} · {item.project}
                  </p>
                  <h2>
                    <button
                      id={`assignment-${item.id}`}
                      className="team-work-link"
                      onClick={() => {
                        setSelected(item);
                        setNotice("");
                      }}
                    >
                      {item.title}
                    </button>
                  </h2>
                  <p>{item.purpose}</p>
                  <p className="team-note">
                    {item.owner} · Review: {item.reviewer}
                  </p>
                  {item.summary && (
                    <p className="team-summary">{item.summary}</p>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}
