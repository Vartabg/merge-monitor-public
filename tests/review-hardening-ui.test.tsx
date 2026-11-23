// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import axe from "axe-core";
import App from "../src/App";
import { Board } from "../src/Board";
import { TeamDesk } from "../src/TeamDesk";
import { TaskContextEditor } from "../src/TaskContextEditor";
import { AssignmentPeople } from "../src/AssignmentPeople";
import { getJson, postJson } from "../src/api";
import { assignment } from "./team-fixtures";
import { ready, repo, response } from "./ui-fixtures";

vi.mock("../src/api", async () => {
  const actual = await vi.importActual<typeof import("../src/api")>("../src/api");
  return {
    ...actual,
    getJson: vi.fn(),
    postJson: vi.fn(),
  };
});

vi.mock("../src/useStatus", () => ({
  useStatus: () => ({
    data: response(),
    stale: false,
    error: null,
    refresh: vi.fn(),
    reload: vi.fn(),
  }),
}));

const at = "2026-11-22T12:00:00Z";
const baseBoardReport = {
  asOf: at,
  unreadIds: [],
  pendingIds: [],
  staleAfterHours: 72,
  staleAgents: ["stale-worker"],
  room: {
    project: "studio",
    goal: "Ship clean coordination.",
    goalBy: "coordinator",
    goalAt: at,
    revision: 1,
    members: [
      {
        agent: "done-worker",
        task: "Completed work",
        scope: "",
        state: "done",
        checkedInAt: at,
        lastReadAt: at,
        lastReadSequence: 1,
      },
      {
        agent: "stale-worker",
        task: "Old work",
        scope: "",
        state: "working",
        checkedInAt: "2026-10-01T00:00:00Z",
        lastReadAt: "",
        lastReadSequence: 0,
      },
    ],
    messages: [],
  },
};

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("handles non-JSON and empty HTTP responses cleanly in getJson without exposing SyntaxError", async () => {
  const realApi = await vi.importActual<typeof import("../src/api")>("../src/api");
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response("<html>502 Bad Gateway</html>", { status: 502 }))
    .mockResolvedValueOnce(new Response("", { status: 500 }))
    .mockResolvedValueOnce(new Response("", { status: 200 }));
  await expect(realApi.getJson("/api/repos")).rejects.toThrow(
    "The service could not complete this request. Try again.",
  );
  await expect(realApi.getJson("/api/repos")).rejects.toThrow(
    "The service could not complete this request. Try again.",
  );
  await expect(realApi.getJson("/api/repos")).rejects.toThrow(
    "The service returned an unreadable response. Try again.",
  );
  fetchSpy.mockRestore();
});

it("unifies primary navigation, aria-current, document title, and project storage across all three views", async () => {
  localStorage.setItem("merge-monitor.board-project", "second");
  vi.mocked(getJson).mockImplementation(async (url) =>
    url === "/api/repos"
      ? {
          repos: [
            { ...repo, id: "test", label: "Test" },
            { ...repo, id: "second", label: "Second" },
          ],
          defaultRepo: "test",
        }
      : url.startsWith("/api/board")
        ? { ...baseBoardReport, room: { ...baseBoardReport.room, project: "second" } }
        : { assignments: [assignment] },
  );

  // Board migrates legacy board-project key to merge-monitor.project
  const r1 = render(<Board />);
  await screen.findByText(baseBoardReport.room.goal);
  expect(document.title).toBe("Team board | Merge Monitor");
  expect(localStorage.getItem("merge-monitor.project")).toBe("second");
  expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Team board" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Project checks" })).not.toHaveAttribute("aria-current");
  expect(screen.getByRole("link", { name: "Assignments" })).not.toHaveAttribute("aria-current");
  r1.unmount();

  // Checks view shares nav and reads same project preference
  const r2 = render(<App />);
  expect(await screen.findByLabelText("Your project")).toHaveValue("second");
  expect(document.title).toBe("Project checks | Merge Monitor");
  expect(screen.getByRole("link", { name: "Project checks" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Team board" })).toHaveAttribute("href", "/");
  expect(screen.getByRole("link", { name: "Assignments" })).toHaveAttribute("href", "?view=team");
  r2.unmount();

  // TeamDesk shares nav including Project checks link
  render(<TeamDesk />);
  await screen.findByRole("button", { name: assignment.title });
  expect(document.title).toBe("Assignments | Merge Monitor");
  expect(screen.getByRole("link", { name: "Assignments" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Project checks" })).toHaveAttribute("href", "?view=checks");
});

it("focuses goal editor, resolves pruned-sender replies without 409, prunes finished check-ins without preliminary check-in, and sends explicit handoff attention", async () => {
  const prunedMessage = {
    id: "11111111-1111-1111-1111-111111111111",
    sequence: 1,
    project: "studio",
    agent: "retired-agent",
    to: "human",
    kind: "question",
    attention: "action",
    text: "Should we keep this?",
    at,
    acknowledgedAt: "",
    resolvedAt: "",
    resolvedBy: "",
    replyTo: "",
    requestId: "22222222-2222-2222-2222-222222222222",
  };
  const reportWithPruned = {
    ...baseBoardReport,
    room: { ...baseBoardReport.room, messages: [prunedMessage] },
  };
  vi.mocked(getJson).mockImplementation(async (url) =>
    url === "/api/repos"
      ? { repos: [{ id: "studio", label: "Studio", path: "/studio" }], defaultRepo: "studio" }
      : reportWithPruned,
  );
  vi.mocked(postJson).mockImplementation(async (path) => {
    if (path === "/api/board/prune-members") {
      return {
        ...reportWithPruned,
        room: {
          ...reportWithPruned.room,
          members: [baseBoardReport.room.members[1]],
        },
      };
    }
    return reportWithPruned;
  });

  const user = userEvent.setup();
  const { container } = render(<Board />);
  await screen.findAllByText(prunedMessage.text);

  // Edit goal moves focus directly to #shared-goal
  await user.click(screen.getByRole("button", { name: "Edit goal" }));
  expect(screen.getByLabelText("What should this team accomplish?")).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "Cancel" }));

  // Replying to a pruned sender defaults recipient to "" with an inline note
  await user.click(screen.getAllByRole("button", { name: /Reply to retired-agent/ })[0]);
  expect(screen.getByText(/retired-agent is no longer checked in/)).toBeInTheDocument();
  expect(screen.getByLabelText("Send to")).toHaveValue("");
  await user.type(screen.getByLabelText("Your reply"), "Yes, keep it.");
  await user.click(screen.getByRole("button", { name: "Send to board" }));
  expect(postJson).toHaveBeenCalledWith(
    "/api/board/post",
    expect.objectContaining({ to: "", replyTo: prunedMessage.id, text: "Yes, keep it." }),
  );

  // Posting a handoff defaults attention to "action" and supports switching to "fyi"
  vi.mocked(postJson).mockClear();
  await user.click(screen.getByRole("button", { name: "Post an update" }));
  await user.selectOptions(screen.getByLabelText("Message type"), "handoff");
  expect(screen.getByLabelText("Response expected")).toHaveValue("action");
  await user.selectOptions(screen.getByLabelText("Send to"), "done-worker");
  await user.type(screen.getByLabelText("What does the team need to know?"), "Please check.");
  await user.click(screen.getByRole("button", { name: "Send to board" }));
  expect(postJson).toHaveBeenCalledWith(
    "/api/board/post",
    expect.objectContaining({ kind: "handoff", attention: "action", to: "done-worker" }),
  );

  // Clear finished check-ins skips preliminary /api/board/check-in and reports exact removed count
  vi.mocked(postJson).mockClear();
  await user.click(screen.getByText(/Agent check-ins · 2 helpers/));
  await user.click(screen.getByRole("button", { name: "Clear finished check-ins" }));
  await waitFor(() =>
    expect(postJson).toHaveBeenCalledWith("/api/board/prune-members", {
      project: "studio",
      agent: "human",
    }),
  );
  expect(postJson).not.toHaveBeenCalledWith("/api/board/check-in", expect.anything());
  expect(screen.getByRole("status")).toHaveTextContent("Cleared 1 check-in.");

  const axeResult = await axe.run(container, {
    rules: { "color-contrast": { enabled: false } },
  });
  expect(axeResult.violations).toEqual([]);
});

it("unlocks background refresh after blurring an untouched assignment form, filters reviewers case-insensitively, and syncs untouched TaskContextEditor", async () => {
  let refreshPoll: () => void = () => {};
  const realInterval = globalThis.setInterval;
  vi.spyOn(globalThis, "setInterval").mockImplementation((cb, delay, ...args) => {
    if (delay !== 15000) return realInterval(cb, delay, ...args);
    refreshPoll = cb as () => void;
    return 0 as unknown as ReturnType<typeof setInterval>;
  });
  const initial = { ...assignment, status: "review" as const, revision: 2, summary: "Old" };
  const updated = { ...initial, revision: 3, summary: "Fresh from poll" };
  vi.mocked(getJson).mockResolvedValue({ assignments: [initial] });

  const user = userEvent.setup();
  const r = render(<TeamDesk />);
  await user.click(await screen.findByRole("button", { name: initial.title }));
  const summary = screen.getByLabelText("What changed?");
  await act(async () => {
    summary.focus();
  });
  // While focused, poll does not overwrite
  vi.mocked(getJson).mockResolvedValue({ assignments: [updated] });
  await act(async () => {
    refreshPoll();
  });
  expect(summary).toHaveValue("Old");
  // Blurring without editing unlocks the NEXT poll to sync cleanly
  await act(async () => {
    screen.getByRole("button", { name: "Back to assignments" }).focus();
  });
  await act(async () => {
    refreshPoll();
  });
  expect(screen.getByLabelText("What changed?")).toHaveValue("Fresh from poll");
  r.unmount();

  // AssignmentPeople: case-insensitive reviewer filtering & "You" display for "human"
  vi.mocked(getJson).mockImplementation(async (url) =>
    url === "/api/repos"
      ? { repos: [{ id: "studio", label: "Studio", path: "/studio" }], defaultRepo: "studio" }
      : {
          ...baseBoardReport,
          room: {
            ...baseBoardReport.room,
            members: [
              { ...baseBoardReport.room.members[0], agent: "Owner" },
              { ...baseBoardReport.room.members[0], agent: "owner" },
              { ...baseBoardReport.room.members[0], agent: "human" },
            ],
          },
        },
  );
  const p = render(<AssignmentPeople onReady={vi.fn()} />);
  await waitFor(() =>
    expect(screen.getByLabelText("Assigned to")).toHaveTextContent("Owner"),
  );
  await user.selectOptions(screen.getByLabelText("Assigned to"), "Owner");
  const reviewerOptions = Array.from(
    screen.getByLabelText("Reviewer").querySelectorAll("option"),
  ).map((o) => ({ value: o.getAttribute("value"), text: o.textContent }));
  expect(reviewerOptions).not.toContainEqual({ value: "owner", text: "owner" });
  expect(reviewerOptions).toContainEqual({ value: "human", text: "You" });
  p.unmount();

  // TaskContextEditor syncs background context updates when untouched
  const ctx1 = { repoId: "test", path: ready.path, branch: ready.branch, title: "First", purpose: "P1", owner: "O1", updatedAt: at };
  const ctx2 = { ...ctx1, title: "Updated remotely" };
  const t = render(
    <TaskContextEditor worktree={ready} repoId="test" context={ctx1} disabled={false} onAction={vi.fn()} />,
  );
  await user.click(screen.getByText("Edit the name and notes"));
  expect(screen.getByLabelText("Name for this work")).toHaveValue("First");
  t.rerender(
    <TaskContextEditor worktree={ready} repoId="test" context={ctx2} disabled={false} onAction={vi.fn()} />,
  );
  expect(screen.getByLabelText("Name for this work")).toHaveValue("Updated remotely");
});
