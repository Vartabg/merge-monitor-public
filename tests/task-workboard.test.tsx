// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { TaskContextEditor } from "../src/TaskContextEditor";
import { AgentRequest } from "../src/AgentRequest";
import { TaskList } from "../src/TaskList";
import { postJson } from "../src/api";
import { ready, response } from "./ui-fixtures";
import { taskName, agentRequest } from "../src/taskPresentation";

vi.mock("../src/api", () => ({ postJson: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const status = response().status!;
const context = {
  repoId: "test",
  path: ready.path,
  branch: ready.branch,
  title: "Make search easier",
  purpose: "Help readers find a passage.",
  owner: "Search task in Codex",
  updatedAt: "2026-09-05T00:00:00Z",
};

it("uses explicit task context, keeps branch-derived names honest, and searches purpose and owner", () => {
  expect(taskName("codex/improve-search")).toBe("Improve search");
  render(
    <TaskList
      status={status}
      contexts={[context]}
      filter="all"
      query="Search task in Codex"
      disabled={false}
      onAction={vi.fn()}
    />,
  );
  expect(screen.getByText(context.title)).toBeInTheDocument();
  expect(
    screen.getByText(context.purpose, { selector: ".task-purpose" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Main project copy")).not.toBeInTheDocument();
});
it("saves purpose and owner with the exact task identity, and announces a failure without losing input", async () => {
  const user = userEvent.setup();
  const onAction = vi.fn();
  vi.mocked(postJson)
    .mockRejectedValueOnce(new Error("Saving failed. Try again."))
    .mockResolvedValueOnce(context);
  render(
    <TaskContextEditor
      worktree={ready}
      repoId="test"
      context={context}
      disabled={false}
      onAction={onAction}
    />,
  );
  await user.click(screen.getByText("Edit the name and notes"));
  await user.clear(screen.getByLabelText("Name for this work"));
  await user.type(
    screen.getByLabelText("Name for this work"),
    "Improve search",
  );
  await user.click(screen.getByRole("button", { name: "Save notes" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Saving failed");
  expect(screen.getByLabelText("Name for this work")).toHaveValue(
    "Improve search",
  );
  await user.click(screen.getByRole("button", { name: "Save notes" }));
  expect(postJson).toHaveBeenLastCalledWith("/api/task-context", {
    repoId: "test",
    path: ready.path,
    branch: ready.branch,
    title: "Improve search",
    purpose: context.purpose,
    owner: context.owner,
  });
  expect(await screen.findByRole("status")).toHaveTextContent("Notes saved");
  expect(onAction).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Save notes" })).toHaveFocus();
});
it("copies a review request with real evidence and provides selectable text when clipboard access fails", async () => {
  const user = userEvent.setup();
  const clipboard = vi.spyOn(navigator.clipboard, "writeText");
  render(
    <AgentRequest
      worktree={ready}
      status={status}
      context={context}
      disabled={false}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Copy review request" }));
  expect(clipboard).toHaveBeenCalledWith(
    expect.stringContaining("Review and test"),
  );
  expect(clipboard).toHaveBeenCalledWith(
    expect.stringContaining(context.purpose),
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "Paste it into Search task in Codex",
  );
  clipboard.mockRejectedValueOnce(new Error("Denied"));
  await user.click(screen.getByRole("button", { name: "Copy review request" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Select and copy");
  expect(screen.getByLabelText("Request to send to your agent")).toHaveValue(
    agentRequest(ready, status, context),
  );
});
it("does not present old evidence as a fresh instruction while disconnected", () => {
  render(<AgentRequest worktree={ready} status={status} disabled />);
  expect(
    within(
      screen.getByRole("group", { name: "Continue with your agent" }),
    ).getByRole("button"),
  ).toBeDisabled();
  expect(
    screen.getByText(/Refresh the board before copying/),
  ).toBeInTheDocument();
});
