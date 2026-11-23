import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { getJson, postJson } from "./api";
import { AppHeader } from "./AppHeader";
import { BoardComposer } from "./BoardComposer";
import { BoardGoal } from "./BoardGoal";
import type { GoalDraft } from "./BoardGoal";
import { BoardMembers } from "./BoardMembers";
import { BoardMessageCard } from "./BoardMessageCard";
import { formatDate, isFyi, requestKinds } from "./boardHelpers";
import type { Message, Report } from "./boardHelpers";
import { CapacityNotice } from "./CapacityNotice";
import { loadSavedProject, saveProject } from "./projectStorage";
import type { Repos } from "./types";
import "./styles/board.css";

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
        const saved = loadSavedProject();
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
      <AppHeader
        view="board"
        kicker="Shared context. Clear next steps."
        title="Keep your agents in sync."
        purpose="One place for the plan, questions, and handoffs. Your helpers share updates here so you can focus on decisions."
      />
      <main id="main" tabIndex={-1}>
        {error && (
          <div className="error-box" role="alert">
            <p>{error}</p>
            <button
              type="button"
              className="button"
              onClick={() => setRetry((r) => r + 1)}
            >
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
                  saveProject(e.target.value);
                }}
              >
                {config.repos.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            {project ? (
              <ProjectBoard key={project} project={project} />
            ) : (
              <p className="empty" role="status">
                No projects are configured yet.
              </p>
            )}
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
  const [goalEdit, setGoalEdit] = useState<GoalDraft>();
  const [kind, setKind] = useState<Message["kind"]>("update");
  const [to, setTo] = useState("");
  const [attention, setAttention] = useState<"action" | "fyi">("action");
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [prunedSender, setPrunedSender] = useState("");
  const [filter, setFilter] = useState("open");
  const [limit, setLimit] = useState(10);
  const [fyiNote, setFyiNote] = useState("Read. No action needed.");
  const [oldConfirmed, setOldConfirmed] = useState(false);
  const epoch = useRef(0);
  const alive = useRef(true);
  const requestId = useRef(crypto.randomUUID());
  const postButton = useRef<HTMLButtonElement>(null);
  const goalButton = useRef<HTMLButtonElement>(null);
  const replyTrigger = useRef<HTMLButtonElement | null>(null);

  function closeComposer() {
    setComposing(false);
    setPrunedSender("");
    const target = replyTrigger.current?.isConnected
      ? replyTrigger.current
      : postButton.current;
    replyTrigger.current = null;
    requestAnimationFrame(() => target?.focus());
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
    const beforeMembers = data?.room.members.length ?? 0;
    try {
      if (command !== "prune-members") {
        await postJson<Report>("/api/board/check-in", {
          project,
          agent: "human",
          task: "Project direction and decisions",
          scope: "Shared goal and questions for the project owner",
          state: "idle",
        });
      }
      const report = await postJson<Report>(`/api/board/${command}`, {
        project,
        agent: "human",
        ...fields,
      });
      if (!alive.current) return false;
      epoch.current += 1;
      setData(report);
      setError("");
      if (command === "prune-members") {
        const removed = Math.max(0, beforeMembers - report.room.members.length);
        setNotice(
          removed > 0
            ? `Cleared ${removed} check-in${removed === 1 ? "" : "s"}.`
            : "No check-ins were eligible to clear (open requests or active assignments remain).",
        );
      } else {
        setNotice("Saved to the shared board.");
      }
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
        ...(kind === "handoff" ? { attention } : {}),
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

  function compose(message?: Message, trigger?: HTMLButtonElement) {
    replyTrigger.current = trigger || null;
    setComposing(true);
    setSaveError("");
    setKind("update");
    setAttention("action");
    const sender = message?.agent || "";
    const senderAvailable =
      !sender ||
      sender === "human" ||
      Boolean(data?.room.members.some((m) => m.agent === sender));
    setTo(senderAvailable ? sender : "");
    setPrunedSender(senderAvailable ? "" : sender);
    setReplyTo(message?.id || "");
    setText("");
    requestId.current = crypto.randomUUID();
  }

  if (!data && !error) return <p role="status">Loading shared context…</p>;
  const room = data?.room;
  const messages = room?.messages || [];
  const requests = messages.filter(
    (m) => (requestKinds.includes(m.kind) || !isFyi(m)) && !m.resolvedAt,
  );
  const forYou = messages.filter((m) => m.to === "human" && !m.resolvedAt);
  const needsYou = forYou.filter((m) => !isFyi(m));
  const fyi = forYou.filter(isFyi);
  // Saved before attention existed: shown as action until the owner confirms them.
  const oldHandoffs = forYou.filter(
    (m) => !m.attention && m.kind === "handoff",
  );
  const bulk = oldConfirmed ? [...fyi, ...oldHandoffs] : fyi;
  const stale = new Set(data?.staleAgents || []);
  const helpers = room?.members.filter((m) => m.agent !== "human") || [];
  const visible = [...messages]
    .reverse()
    .filter(
      (m) =>
        filter === "all" ||
        (filter === "decisions" ? m.kind === "decision" : requests.includes(m)),
    );
  const disabled = busy || !!error;

  const renderCard = (m: Message) => (
    <BoardMessageCard
      key={m.id}
      message={m}
      messages={messages}
      disabled={disabled}
      composing={composing}
      onReply={(target, button) => compose(target, button)}
      onAck={(messageId) => void act("ack", { messageId })}
      onResolve={(messageId) => void act("resolve", { messageId })}
    />
  );

  return (
    <>
      {error && (
        <div className="error-box" role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="button"
            onClick={() => setRetry((r) => r + 1)}
          >
            Reconnect
          </button>
        </div>
      )}
      {saveError && (
        <p role="alert" className="error-box">
          {saveError}
        </p>
      )}
      <p role="status" className="board-byline">
        {notice}
      </p>
      <p className="board-connection">
        {error
          ? "Connection interrupted"
          : `Board connected · checked ${data ? formatDate(data.asOf) : ""}`}
      </p>
      {room && (
        <>
          <CapacityNotice
            label="Board messages"
            used={room.messages.length}
            limit={1000}
          />
          <CapacityNotice
            label="Project check-ins"
            used={room.members.length}
            limit={100}
          />
          {room.members.length >= 80 && (
            <p className="board-byline">
              Open <strong>Agent check-ins</strong> below to clear finished
              check-ins without deleting messages.
            </p>
          )}
          <BoardGoal
            room={room}
            goalEdit={goalEdit}
            disabled={disabled}
            goalButtonRef={goalButton}
            onStartEdit={() =>
              setGoalEdit({ text: room.goal, revision: room.revision })
            }
            onChangeDraft={(nextText) =>
              setGoalEdit((prev) => (prev ? { ...prev, text: nextText } : prev))
            }
            onAdoptRevision={(revision) =>
              setGoalEdit((prev) => (prev ? { ...prev, revision } : prev))
            }
            onSave={() =>
              goalEdit
                ? act("goal", {
                    goal: goalEdit.text,
                    revision: goalEdit.revision,
                  })
                : Promise.resolve(false)
            }
            onCancel={closeGoal}
          />
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
                {needsYou.slice(0, 5).map(renderCard)}
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
            {fyi.length + oldHandoffs.length > 0 && (
              <details className="board-fyi">
                <summary>
                  FYI for you · {fyi.length}
                  {oldHandoffs.length
                    ? ` · ${oldHandoffs.length} older handoffs to check`
                    : ""}
                </summary>
                <p className="board-byline">
                  Reports of finished work. No decision needed.
                </p>
                <ul className="board-messages">{fyi.map(renderCard)}</ul>
                {oldHandoffs.length > 0 && (
                  <>
                    <h3>Older handoffs</h3>
                    <p className="board-byline">
                      Sent before FYI existed, so they count as needing you.
                      Check them before resolving.
                    </p>
                    <ul className="board-messages">
                      {oldHandoffs.map(renderCard)}
                    </ul>
                  </>
                )}
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!bulk.length) return;
                    if (
                      await act("resolve-fyi", {
                        messageIds: bulk.map((m) => m.id),
                        note: fyiNote,
                        ...(oldConfirmed ? { includeOldHandoffs: true } : {}),
                      })
                    )
                      setOldConfirmed(false);
                  }}
                >
                  <label htmlFor="fyi-note">Resolution note</label>
                  <input
                    id="fyi-note"
                    required
                    maxLength={300}
                    value={fyiNote}
                    onChange={(e) => setFyiNote(e.target.value)}
                  />
                  {oldHandoffs.length > 0 && (
                    <label className="board-check">
                      <input
                        type="checkbox"
                        checked={oldConfirmed}
                        onChange={(e) => setOldConfirmed(e.target.checked)}
                      />
                      I checked the {oldHandoffs.length} older handoffs. None
                      need action; resolve them too.
                    </label>
                  )}
                  <button
                    type="submit"
                    className="button"
                    disabled={disabled || !bulk.length}
                  >
                    Mark {bulk.length} {bulk.length === 1 ? "item" : "items"}{" "}
                    resolved
                  </button>
                </form>
              </details>
            )}
          </section>
          <section aria-labelledby="conversation-heading">
            <div className="board-section-head">
              <h2 id="conversation-heading">Team conversation</h2>
              <button
                type="button"
                className="button"
                ref={postButton}
                disabled={disabled || composing}
                onClick={() => compose()}
              >
                Post an update
              </button>
            </div>
            {composing && (
              <BoardComposer
                members={room.members}
                kind={kind}
                to={to}
                attention={attention}
                text={text}
                replyTo={replyTo}
                prunedSender={prunedSender}
                disabled={disabled}
                onChangeKind={(nextKind) => {
                  setKind(nextKind);
                  if (nextKind === "handoff") setAttention("action");
                  requestId.current = crypto.randomUUID();
                }}
                onChangeTo={(nextTo) => {
                  setTo(nextTo);
                  requestId.current = crypto.randomUUID();
                }}
                onChangeAttention={(nextAttention) => {
                  setAttention(nextAttention);
                  requestId.current = crypto.randomUUID();
                }}
                onChangeText={(nextText) => {
                  setText(nextText);
                  requestId.current = crypto.randomUUID();
                }}
                onSubmit={send}
                onCancel={closeComposer}
              />
            )}
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
                  type="button"
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
                {visible.slice(0, limit).map(renderCard)}
              </ul>
            )}
            {visible.length > limit && (
              <button
                type="button"
                className="button secondary"
                onClick={() => setLimit((n) => n + 20)}
              >
                Show more messages
              </button>
            )}
          </section>
          <BoardMembers
            helpers={helpers}
            stale={stale}
            staleAfterHours={data?.staleAfterHours ?? 72}
            disabled={disabled}
            onPrune={(includeStale) =>
              act(
                "prune-members",
                includeStale ? { includeStale: true } : {},
              )
            }
          />
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
              . Each agent reads the board at workflow boundaries; for opt-in
              assignment wakes on macOS, see <code>docs/TEAM_DISPATCH.md</code>.
            </p>
          </details>
        </>
      )}
    </>
  );
}
