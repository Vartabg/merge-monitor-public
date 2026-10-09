import { useEffect, useRef, useState } from "react";
import { categories } from "./format";
import { contextFor, taskName } from "./taskPresentation";
import { taskKey } from "./nextTask";
import type { TaskContext, Worktree } from "./types";

const PAGE_SIZE = 6;
export function TaskPicker({
  tasks,
  contexts,
  onChoose,
  onBack,
}: {
  tasks: Worktree[];
  contexts: TaskContext[];
  onChoose: (key: string) => void;
  onBack: () => void;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    search.current?.focus();
  }, []);
  const needle = query.trim().toLowerCase();
  const matches = tasks.filter((task) => {
    const context = contextFor(task, contexts);
    return (
      !task.primary &&
      [
        task.branch,
        taskName(task.branch),
        context?.title || "",
        context?.owner || "",
        context?.purpose || "",
        ...task.changedFiles,
      ].some((value) => value.toLowerCase().includes(needle))
    );
  });
  const pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  return (
    <section className="task-picker" aria-labelledby="picker-title">
      <button className="text-button" onClick={onBack}>
        ← Back
      </button>
      <h2 id="picker-title">Choose the work to check</h2>
      <label htmlFor="task-search">Find your work</label>
      <input
        ref={search}
        id="task-search"
        type="search"
        placeholder="Type a name you recognize"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setPage(0);
        }}
      />
      <p className="helper" role="status">
        {matches.length
          ? `${matches.length} ${matches.length === 1 ? "item" : "items"} · Page ${currentPage + 1} of ${pages}`
          : "Nothing found. Try another name."}
      </p>
      <ul className="picker-list">
        {matches
          .slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
          .map((task) => {
            const name =
              contextFor(task, contexts)?.title || taskName(task.branch);
            return (
              <li key={taskKey(task)}>
                <button
                  aria-label={`Open ${name}`}
                  onClick={() => onChoose(taskKey(task))}
                >
                  <strong>{name}</strong>
                  <span>
                    {categories.find((c) => c.id === task.category)?.label}
                  </span>
                  <span aria-hidden="true" className="picker-arrow">
                    →
                  </span>
                </button>
              </li>
            );
          })}
      </ul>
      {pages > 1 && (
        <nav className="picker-pages" aria-label="Task pages">
          <button
            className="button secondary"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            Previous
          </button>
          <button
            className="button secondary"
            disabled={currentPage + 1 === pages}
            onClick={() => setPage(currentPage + 1)}
          >
            Next page
          </button>
        </nav>
      )}
    </section>
  );
}
