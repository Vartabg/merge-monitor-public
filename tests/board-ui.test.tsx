// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import axe from "axe-core";
import { Board } from "../src/Board";
import { getJson, postJson } from "../src/api";
vi.mock("../src/api", () => ({ getJson: vi.fn(), postJson: vi.fn() }));
const at = "2026-09-11T15:00:00Z";
const report = {
  asOf: at,
  unreadIds: [],
  pendingIds: [],
  room: {
    project: "studio",
    goal: "Ship a working booking flow.",
    goalBy: "coordinator",
    goalAt: at,
    revision: 1,
    members: [
      {
        agent: "backend",
        task: "Build available times",
        scope: "API only",
        state: "working",
        checkedInAt: at,
        lastReadAt: at,
        lastReadSequence: 0,
      },
    ],
    messages: [],
  },
};
const question = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  sequence: 1,
  project: "studio",
  agent: "backend",
  to: "human",
  kind: "question",
  text: "Should we allow weekend bookings?",
  at,
  acknowledgedAt: "",
  resolvedAt: "",
  resolvedBy: "",
  replyTo: "",
  requestId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
};
beforeEach(() => {
  localStorage.clear();
  vi.mocked(getJson).mockImplementation(async (url) =>
    url === "/api/repos"
      ? {
          repos: [
            { id: "studio", label: "Studio", path: "/studio" },
            { id: "other", label: "Other", path: "/other" },
          ],
          defaultRepo: "studio",
        }
      : report,
  );
  vi.mocked(postJson).mockResolvedValue(report);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("presents a goal and one clear next step without claiming agents are online", async () => {
  const { container } = render(<Board />);
  await screen.findByText(report.room.goal);
  expect(
    screen.getByRole("heading", { name: "Needs your attention" }),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/No open requests addressed to you/),
  ).toBeInTheDocument();
  expect(screen.queryByText(/online/i)).not.toBeInTheDocument();
  const result = await axe.run(container, {
    rules: { "color-contrast": { enabled: false } },
  });
  expect(result.violations).toEqual([]);
});
it("keeps a rejected draft and sends replies as the project owner", async () => {
  const user = userEvent.setup();
  render(<Board />);
  await user.click(
    await screen.findByRole("button", { name: "Post an update" }),
  );
  await user.type(
    screen.getByLabelText("What does the team need to know?"),
    "Keep the first release small.",
  );
  vi.mocked(postJson).mockImplementation(async (path) => {
    if (path === "/api/board/post") throw new Error("Disconnected.");
    return report;
  });
  await user.click(screen.getByRole("button", { name: "Send to board" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Disconnected");
  expect(screen.getByLabelText("What does the team need to know?")).toHaveValue(
    "Keep the first release small.",
  );
  expect(postJson).toHaveBeenCalledWith(
    "/api/board/post",
    expect.objectContaining({
      project: "studio",
      agent: "human",
      text: "Keep the first release small.",
    }),
  );
});
it("distinguishes acknowledgment from resolution and provides accessible reply controls", async () => {
  vi.mocked(getJson).mockImplementation(async (url) =>
    url === "/api/repos"
      ? { repos: [{ id: "studio", label: "Studio" }], defaultRepo: "studio" }
      : { ...report, room: { ...report.room, messages: [question] } },
  );
  const user = userEvent.setup();
  const { container } = render(<Board />);
  await screen.findAllByText(question.text);
  await user.click(
    screen.getAllByRole("button", { name: "Acknowledge message 1" })[0],
  );
  await waitFor(() =>
    expect(postJson).toHaveBeenCalledWith("/api/board/ack", {
      project: "studio",
      agent: "human",
      messageId: question.id,
    }),
  );
  expect(postJson).not.toHaveBeenCalledWith(
    "/api/board/resolve",
    expect.anything(),
  );
  const result = await axe.run(container, {
    rules: { "color-contrast": { enabled: false } },
  });
  expect(result.violations).toEqual([]);
});
it("clears the old room and draft when switching projects", async () => {
  const user = userEvent.setup();
  render(<Board />);
  await user.click(
    await screen.findByRole("button", { name: "Post an update" }),
  );
  await user.type(
    screen.getByLabelText("What does the team need to know?"),
    "Private to this project.",
  );
  vi.mocked(getJson).mockImplementation(async () => ({
    ...report,
    room: { ...report.room, project: "other", goal: "Other project goal" },
  }));
  await user.selectOptions(screen.getByLabelText("Your project"), "other");
  await screen.findByText("Other project goal");
  expect(
    screen.queryByDisplayValue("Private to this project."),
  ).not.toBeInTheDocument();
  expect(screen.queryByText(report.room.goal)).not.toBeInTheDocument();
});
it("makes disconnection explicit and disables actions instead of showing stale data as current", async () => {
  vi.mocked(getJson).mockImplementation(async (url) => {
    if (url === "/api/repos")
      return {
        repos: [{ id: "studio", label: "Studio" }],
        defaultRepo: "studio",
      };
    throw new Error("Offline");
  });
  const { container } = render(<Board />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Updates paused");
  expect(
    screen.queryByRole("button", { name: "Post an update" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Reconnect" })).toBeEnabled();
  const result = await axe.run(container, {
    rules: { "color-contrast": { enabled: false } },
  });
  expect(result.violations).toEqual([]);
});
it("shows a sent update and restores focus while protecting an in-progress draft", async () => {
  const user = userEvent.setup();
  render(<Board />);
  const button = await screen.findByRole("button", { name: "Post an update" });
  await user.click(button);
  expect(button).toBeDisabled();
  await user.type(
    screen.getByLabelText("What does the team need to know?"),
    "The interface check is complete.",
  );
  vi.mocked(postJson).mockResolvedValue({
    ...report,
    room: {
      ...report.room,
      messages: [
        {
          ...question,
          agent: "human",
          to: "",
          kind: "update",
          text: "The interface check is complete.",
        },
      ],
    },
  });
  await user.click(screen.getByRole("button", { name: "Send to board" }));
  await screen.findByText("The interface check is complete.");
  await waitFor(() => expect(button).toHaveFocus());
  expect(screen.getByRole("button", { name: "All updates" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
