import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { getJson, postJson } from "./api";
import type { components } from "./api.generated";
import type { Repos } from "./types";
import "./styles/board.css";
type Report = components["schemas"]["Board"];
type Message = components["schemas"]["BoardMessage"];
const labels = {
  update: "Update",
  decision: "Decision",
  question: "Question",
  blocker: "Needs help",
  handoff: "Ready for the next agent",
};
const person = (agent: string) => (agent === "human" ? "You" : agent);
const date = (at: string) =>
  new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
export function Board() {
  const [config, setConfig] = useState<Repos>();
  const [project, setProject] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    getJson<Repos>("/api/repos", { signal: controller.signal })
      .then((value) => {
        if (controller.signal.aborted) return;
        let saved = "";
        try {
          saved = localStorage.getItem("merge-monitor.board-project") || "";
        } catch {
          /* Optional preference. */
        }
        setConfig(value);
        setProject(
          value.repos.some((r) => r.id === saved)
            ? saved
            : value.repos.some((r) => r.id === "merge-monitor")
              ? "merge-monitor"
              : value.defaultRepo,
        );
        setError("");
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError(
            "The board is not connected. Start Merge Monitor and try again.",
          );
      });
    return () => controller.abort();
  }, [retry]);
  return (
    <div className="shell focus-shell board-shell">
      <a className="skip-link" href="#main">
        Skip to team board
      </a>
      <header className="simple-header">
        <nav className="board-nav" aria-label="Main navigation">
          <span className="app-name">Merge Monitor</span>
          <a href="?view=checks">Project checks</a>
          <a href="?view=team">Assignments</a>
        </nav>
        <p className="board-kicker">Shared context. Clear next steps.</p>
        <h1>Keep your agents in sync.</h1>
        <p className="app-purpose">
          One place for the plan, questions, and handoffs. Your helpers share
          updates here so you can focus on decisions.
        </p>
      </header>
      <main id="main" tabIndex={-1}>
        {error && (
          <div className="error-box" role="alert">
            <p>{error}</p>
            <button className="button" onClick={() => setRetry((r) => r + 1)}>
              Try again
            </button>
          </div>
        )}
        {config ? (
          <>
            <div className="project-selector">
              <label htmlFor="board-project">Your project</label>
              <select
                id="board-project"
                value={project}
                onChange={(e) => {
                  setProject(e.target.value);
                  try {
                    localStorage.setItem(
                      "merge-monitor.board-project",
                      e.target.value,
                    );
                  } catch {
                    /* Optional preference. */
                  }
                }}
              >
                {config.repos.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <ProjectBoard key={project} project={project} />
          </>
        ) : (
          !error && <p role="status">Connecting to your board…</p>
        )}
      </main>
    </div>
  );
}
function ProjectBoard({ project }: { project: string }) {
  const [data, setData] = useState<Report>();
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [composing, setComposing] = useState(false);
  const [goalEdit, setGoalEdit] = useState<{
    text: string;
    revision: number;
  }>();
  const [kind, setKind] = useState<Message["kind"]>("update");
  const [to, setTo] = useState("");
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [filter, setFilter] = useState("open");
  const [limit, setLimit] = useState(10);
  const epoch = useRef(0);
  const alive = useRef(true);
  const requestId = useRef(crypto.randomUUID());
  const postButton = useRef<HTMLButtonElement>(null);
  const goalButton = useRef<HTMLButtonElement>(null);
  function closeComposer() {
    setComposing(false);
    requestAnimationFrame(() => postButton.current?.focus());
  }
  function closeGoal() {
    setGoalEdit(undefined);
    requestAnimationFrame(() => goalButton.current?.focus());
  }
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    let pending = false;
    async function load() {
      if (pending) return;
      pending = true;
      const current = epoch.current;
      try {
        const report = await getJson<Report>(
          `/api/board?project=${encodeURIComponent(project)}`,
          { signal: controller.signal },
        );
        if (!controller.signal.aborted && current === epoch.current) {
          setData(report);
          setError("");
        }
      } catch {
        if (!controller.signal.aborted && current === epoch.current)
          setError(
            "Updates paused. What you see may be out of date. Reconnect before sending a message.",
          );
      } finally {
        pending = false;
      }
    }
    void load();
    const timer = setInterval(() => {
      void load();
    }, 3000);
    return () => {
      alive.current = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [project, retry]);
  async function act(command: string, fields: object) {
    setBusy(true);
    setSaveError("");
    setNotice("");
    epoch.current += 1;
    try {
      await postJson<Report>("/api/board/check-in", {
        project,
        agent: "human",
        task: "Project direction and decisions",
        scope: "Shared goal and questions for the project owner",
        state: "idle",
      });
      const report = await postJson<Report>(`/api/board/${command}`, {
        project,
        agent: "human",
        ...fields,
      });
      if (!alive.current) return false;
      epoch.current += 1;
      setData(report);
      setError("");
      setNotice("Saved to the shared board.");
      return true;
    } catch (e) {
      if (alive.current)
        setSaveError(
          e instanceof Error
            ? e.message
            : "Could not save. Your draft is still here.",
        );
      return false;
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    if (
      await act("post", {
        kind,
        to,
        text,
        replyTo,
        requestId: requestId.current,
      })
    ) {
      closeComposer();
      setFilter("all");
      setLimit(10);
      setText("");
      setReplyTo("");
      requestId.current = crypto.randomUUID();
    }
  }
  function compose(message?: Message) {
    setComposing(true);
    setSaveError("");
    setKind("update");
    setTo(message?.agent || "");
    setReplyTo(message?.id || "");
    setText("");
    requestId.current = crypto.randomUUID();
    requestAnimationFrame(() =>
      document.getElementById("board-message")?.focus(),
    );
  }
  if (!data && !error) return <p role="status">Loading shared context…</p>;
  const room = data?.room;
  const messages = room?.messages || [];
  const requests = messages.filter(
    (m) => ["question", "blocker", "handoff"].includes(m.kind) && !m.resolvedAt,
  );
  const needsYou = requests.filter((m) => m.to === "human");
  const visible = [...messages]
    .reverse()
    .filter(
      (m) =>
        filter === "all" ||
        (filter === "decisions" ? m.kind === "decision" : requests.includes(m)),
    );
  const disabled = busy || !!error;
  function messageCard(m: Message) {
    const original =
      m.replyTo && messages.find((item) => item.id === m.replyTo);
    return (
      <li key={m.id} className="board-message">
        <div className="board-message-meta">
          <strong>{labels[m.kind]}</strong>
          <time dateTime={m.at}>{date(m.at)}</time>
        </div>
        <p className="board-byline">
          {person(m.agent)} → {m.to ? person(m.to) : "Everyone on this project"}
        </p>
        {original && (
          <p className="board-reply-context">
            Reply to {person(original.agent)}: {original.text.slice(0, 160)}
            {original.text.length > 160 ? "…" : ""}
          </p>
        )}
        <p className="board-body">
          {m.text.length > 360 ? `${m.text.slice(0, 320).trimEnd()}…` : m.text}
        </p>
        {m.text.length > 360 && (
          <details className="board-message-details">
            <summary>
              Read full message<span className="sr-only"> {m.sequence}</span>
            </summary>
            <p className="board-body">{m.text}</p>
          </details>
        )}
        <p className="board-status">
          {m.resolvedAt
            ? `Resolved by ${person(m.resolvedBy)} · ${date(m.resolvedAt)}`
            : m.acknowledgedAt
              ? `Acknowledged ${date(m.acknowledgedAt)} · still open`
              : m.to
                ? "Awaiting acknowledgment"
                : "Shared with the project"}
        </p>
        {!m.resolvedAt && (
          <div className="board-actions">
            <button
              className="button secondary"
              disabled={disabled || composing}
              onClick={() => compose(m)}
            >
              Reply
              <span className="sr-only">
                {" "}
                to {person(m.agent)} message {m.sequence}
              </span>
            </button>
            {m.to === "human" && !m.acknowledgedAt && (
              <button
                className="button secondary"
                disabled={disabled}
                onClick={() => void act("ack", { messageId: m.id })}
              >
                Acknowledge
                <span className="sr-only"> message {m.sequence}</span>
              </button>
            )}
            {(m.to === "human" || m.agent === "human") && (
              <button
                className="button secondary"
                disabled={disabled}
                onClick={() => void act("resolve", { messageId: m.id })}
              >
                Mark resolved
                <span className="sr-only"> message {m.sequence}</span>
              </button>
            )}
          </div>
        )}
      </li>
    );
  }
  return (
    <>
      {error && (
        <div className="error-box" role="alert">
          <p>{error}</p>
          <button className="button" onClick={() => setRetry((r) => r + 1)}>
            Reconnect
          </button>
        </div>
      )}
      <p className="board-connection">
        {error
          ? "Connection interrupted"
          : `Board connected · checked ${data ? date(data.asOf) : ""}`}
      </p>
      {room && (
        <>
          <section className="board-goal" aria-labelledby="goal-heading">
            <div className="board-section-head">
              <h2 id="goal-heading">Our shared goal</h2>
              <button
                className="button secondary"
                ref={goalButton}
                disabled={disabled || !!goalEdit}
                onClick={() =>
                  setGoalEdit({ text: room.goal, revision: room.revision })
                }
              >
                {room.goal ? "Edit goal" : "Set a goal"}
              </button>
            </div>
            {goalEdit ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (
                    await act("goal", {
                      goal: goalEdit.text,
                      revision: goalEdit.revision,
                    })
                  )
                    closeGoal();
                }}
              >
                <label htmlFor="shared-goal">
                  What should this team accomplish?
                </label>
                <textarea
                  id="shared-goal"
                  required
                  maxLength={1200}
                  value={goalEdit.text}
                  onChange={(e) =>
                    setGoalEdit({ ...goalEdit, text: e.target.value })
                  }
                />
                <div className="board-actions">
                  <button className="button" disabled={disabled}>
                    Save goal
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={closeGoal}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <p className="board-goal-text">
                {room.goal ||
                  "Give your helpers one clear outcome to work toward."}
              </p>
            )}
            {room.goal && (
              <p className="board-byline">
                Updated by {person(room.goalBy)} · {date(room.goalAt)}
              </p>
            )}
          </section>
          <section
            className="board-attention"
            aria-labelledby="attention-heading"
          >
            <h2 id="attention-heading">
              Needs your attention
              {needsYou.length ? ` · ${needsYou.length}` : ""}
            </h2>
            {needsYou.length ? (
              <ul className="board-messages">
                {needsYou.slice(0, 5).map(messageCard)}
              </ul>
            ) : (
              <p>
                No open requests addressed to you. Agents can handle their
                handoffs here.
              </p>
            )}
            {needsYou.length > 5 && (
              <p>
                {needsYou.length - 5} more requests appear under Open requests
                below.
              </p>
            )}
          </section>
          <section aria-labelledby="conversation-heading">
            <div className="board-section-head">
              <h2 id="conversation-heading">Team conversation</h2>
              <button
                className="button"
                ref={postButton}
                disabled={disabled || composing}
                onClick={() => compose()}
              >
                Post an update
              </button>
            </div>
            {composing && (
              <form className="board-compose" onSubmit={send}>
                <label htmlFor="board-message">
                  {replyTo ? "Your reply" : "What does the team need to know?"}
                </label>
                <textarea
                  id="board-message"
                  value={text}
                  required
                  maxLength={4000}
                  onChange={(e) => {
                    setText(e.target.value);
                    requestId.current = crypto.randomUUID();
                  }}
                />
                <div className="board-form-row">
                  <label>
                    Message type
                    <select
                      value={kind}
                      onChange={(e) => {
                        setKind(e.target.value as Message["kind"]);
                        requestId.current = crypto.randomUUID();
                      }}
                    >
                      {Object.entries(labels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Send to
                    <select
                      value={to}
                      required={["question", "blocker", "handoff"].includes(
                        kind,
                      )}
                      onChange={(e) => {
                        setTo(e.target.value);
                        requestId.current = crypto.randomUUID();
                      }}
                    >
                      <option value="">Everyone on this project</option>
                      {!room.members.some((m) => m.agent === "human") && (
                        <option value="human">You</option>
                      )}
                      {room.members.map((m) => (
                        <option key={m.agent} value={m.agent}>
                          {person(m.agent)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="board-actions">
                  <button className="button" disabled={disabled}>
                    Send to board
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={closeComposer}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
            {saveError && (
              <p role="alert" className="error-box">
                {saveError}
              </p>
            )}
            <p role="status" className="board-byline">
              {notice}
            </p>
            <div
              className="board-filters"
              role="group"
              aria-label="Show messages"
            >
              {[
                ["open", `Open requests (${requests.length})`],
                ["all", "All updates"],
                ["decisions", "Decisions"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  className="button secondary"
                  aria-pressed={filter === value}
                  onClick={() => {
                    setFilter(value);
                    setLimit(10);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {!messages.length ? (
              <div className="board-empty">
                <h3>Your first shared conversation starts here.</h3>
                <p>
                  Set a goal, then connect a helper. When an agent checks in or
                  sends a handoff, it will appear on this board.
                </p>
              </div>
            ) : !visible.length ? (
              <p className="board-empty">
                {filter === "open"
                  ? "No open requests. See All updates for the conversation."
                  : "No decisions have been shared yet."}
              </p>
            ) : (
              <ul className="board-messages">
                {visible.slice(0, limit).map(messageCard)}
              </ul>
            )}
            {visible.length > limit && (
              <button
                className="button secondary"
                onClick={() => setLimit((n) => n + 20)}
              >
                Show more messages
              </button>
            )}
          </section>
          <details className="board-details">
            <summary>
              Agent check-ins ·{" "}
              {room.members.filter((m) => m.agent !== "human").length} helpers
            </summary>
            <p className="board-byline">
              Check-ins are updates from agents, not proof that they are still
              running. Names are supplied by local clients.
            </p>
            <ul className="board-members">
              {room.members
                .filter((m) => m.agent !== "human")
                .map((m) => (
                  <li key={m.agent}>
                    <h3>{m.agent}</h3>
                    <p>{m.task}</p>
                    <p className="board-byline">
                      {m.state} · checked in {date(m.checkedInAt)}
                      {Date.parse(data!.asOf) - Date.parse(m.checkedInAt) >
                        1800000 && m.state !== "done"
                        ? " · needs a fresh check-in"
                        : ""}
                    </p>
                    {m.scope && <p>Scope: {m.scope}</p>}
                    <p className="board-byline">
                      {m.lastReadAt
                        ? `Last read ${date(m.lastReadAt)} · through message ${m.lastReadSequence}`
                        : "No recorded board read yet"}
                    </p>
                  </li>
                ))}
            </ul>
          </details>
          <details className="board-details">
            <summary>Connect a helper</summary>
            <p>Give a local coding agent this instruction:</p>
            <p className="board-instruction">
              Use the Merge Monitor team board for project{" "}
              <strong>{project}</strong>. Check in with your task, read updates
              when you resume, and post questions or handoffs to the responsible
              agent.
            </p>
            <p>
              Connected agents use the <code>merge-monitor</code> tools.
              Terminal setup and commands are in <code>docs/TEAM_BOARD.md</code>
              . Each agent must participate; updates do not wake a closed chat.
            </p>
          </details>
        </>
      )}
    </>
  );
}
