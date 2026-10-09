// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { FocusWorkspace } from "../src/FocusWorkspace";
import { projectReport } from "../src/reportSummary";
import { primary, ready, repo, response } from "./ui-fixtures";
vi.mock("../src/api", () => ({ postJson: vi.fn().mockResolvedValue({}) }));
afterEach(cleanup);
const status = response().status!;
const conflict = {
  ...ready,
  path: "/conflict",
  branch: "codex/fix-search",
  category: "attention" as const,
  state: "CONFLICT-WITH-BASE",
  reason: "These changes conflict with the main version.",
};
const props = {
  status,
  contexts: [],
  repo,
  disabled: false,
  onAction: vi.fn(),
};

it("reports all active work while excluding primary housekeeping, parked and completed work", () => {
  const report = projectReport(
    {
      ...status,
      worktrees: [
        primary,
        conflict,
        ready,
        { ...ready, branch: "done", category: "finished" },
      ],
    },
    { ...repo, excludedBranches: [conflict.branch] },
  );
  expect(report.attention).toHaveLength(0);
  expect(report.ready).toEqual([ready]);
  expect(report.findings).toEqual([ready]);
  expect(report.explanation).toContain("Review and tests are still needed");
});
it("keeps inspected work and optional manual guidance stable while the report updates", async () => {
  const user = userEvent.setup();
  const view = render(<FocusWorkspace {...props} />);
  expect(
    screen.queryByRole("button", { name: "Copy the message" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Inspect Ready" }));
  expect(
    screen.queryByRole("button", { name: "Copy the message" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByText("Send a message manually"));
  await user.click(
    await screen.findByRole("button", { name: "Copy the message" }),
  );
  view.rerender(
    <FocusWorkspace
      {...props}
      status={{ ...status, worktrees: [primary, conflict, ready] }}
    />,
  );
  expect(screen.getByRole("article")).toHaveTextContent("Work: Ready");
  expect(
    screen.queryByRole("button", { name: "Inspect Fix search" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "I sent the message" }));
  expect(
    screen.getByText("Come back after your AI chat replies."),
  ).toBeVisible();
  await user.click(screen.getByText("Send a message manually"));
  expect(
    screen.getByRole("heading", { name: "Ready for review and tests." }),
  ).toBeVisible();
});
it("offers an honest empty report without turning primary edits into an unfinished task", () => {
  render(
    <FocusWorkspace
      {...props}
      status={{
        ...status,
        worktrees: [primary, { ...ready, category: "finished" }],
      }}
    />,
  );
  expect(
    screen.getByRole("heading", { name: "No unfinished work to check." }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /Copy/ }),
  ).not.toBeInTheDocument();
});
it("bounds the report and task browser, finds work, and returns focus to the report", async () => {
  const user = userEvent.setup();
  const worktrees = Array.from({ length: 19 }, (_, i) => ({
    ...ready,
    path: `/task-${i}`,
    branch: `codex/task-${i}`,
  }));
  render(<FocusWorkspace {...props} status={{ ...status, worktrees }} />);
  expect(screen.getAllByRole("button", { name: /^Inspect / })).toHaveLength(3);
  await user.click(screen.getByRole("button", { name: "See all work" }));
  expect(screen.getAllByRole("button", { name: /^Open / })).toHaveLength(6);
  await user.type(screen.getByRole("searchbox"), "task-18");
  await user.click(screen.getByRole("button", { name: "Open Task 18" }));
  expect(screen.getByRole("article")).toHaveTextContent("Task 18");
  expect(
    screen.getByRole("heading", { name: "Ready for review and tests." }),
  ).toHaveFocus();
  await user.click(
    screen.getByRole("button", { name: "← Back to project report" }),
  );
  expect(
    screen.getByRole("heading", {
      name: "Saved changes are ready for review.",
    }),
  ).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "See all work" }));
  await user.click(screen.getByRole("button", { name: "← Back", exact: true }));
  expect(
    screen.getByRole("heading", {
      name: "Saved changes are ready for review.",
    }),
  ).toHaveFocus();
});
it("does not substitute another work item if the selected one disappears", async () => {
  const user = userEvent.setup();
  const view = render(<FocusWorkspace {...props} />);
  await user.click(screen.getByRole("button", { name: "Inspect Ready" }));
  view.rerender(
    <FocusWorkspace {...props} status={{ ...status, worktrees: [conflict] }} />,
  );
  expect(
    screen.getByRole("heading", { name: "This work is no longer listed." }),
  ).toBeVisible();
});

it("keeps refresh focus while checking and prevents duplicate refresh requests", async () => {
  const user = userEvent.setup();
  const onRefresh = vi.fn();
  const view = render(<FocusWorkspace {...props} onRefresh={onRefresh} />);
  await user.click(screen.getByRole("button", { name: "Check project" }));
  view.rerender(<FocusWorkspace {...props} onRefresh={onRefresh} refreshing />);
  const button = screen.getByRole("button", { name: "Checking project…" });
  expect(button).toHaveFocus();
  expect(button).toHaveAttribute("aria-disabled", "true");
  await user.click(button);
  expect(onRefresh).toHaveBeenCalledOnce();
});
