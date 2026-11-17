// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ProjectReport } from "../src/ProjectReport";
import { primary, ready, repo, response } from "./ui-fixtures";

afterEach(cleanup);

const baseStatus = response().status!;
const finishedOne = {
  ...ready,
  path: "/tmp/done-1",
  branch: "codex/done-one",
  merged: true,
  isDirty: false,
  category: "finished" as const,
};
const finishedTwo = {
  ...finishedOne,
  path: "/tmp/done-2",
  branch: "codex/done-two",
};

it("discloses parked merged working copies across worker enabled, paused, and unavailable states without role=status", () => {
  const view = render(
    <ProjectReport
      status={{ ...baseStatus, worktrees: [primary, finishedOne] }}
      repo={repo}
      contexts={[]}
      worker={{ enabled: false, status: "paused", heartbeat: "", lastRun: null, error: null }}
      refreshing={false}
      titleRef={{ current: null }}
      onRefresh={vi.fn()}
      onChoose={vi.fn()}
      onBrowse={vi.fn()}
    />,
  );
  expect(
    screen.getByText(/1 already-combined working copy is still on disk\. Turn on background checks/),
  ).toBeVisible();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();

  view.rerender(
    <ProjectReport
      status={{ ...baseStatus, worktrees: [primary, finishedOne, finishedTwo] }}
      repo={repo}
      contexts={[]}
      worker={{ enabled: true, status: "idle", heartbeat: "", lastRun: null, error: null }}
      refreshing={false}
      titleRef={{ current: null }}
      onRefresh={vi.fn()}
      onChoose={vi.fn()}
      onBrowse={vi.fn()}
    />,
  );
  expect(
    screen.getByText(/2 already-combined working copies are still on disk \(held back by active runs/),
  ).toBeVisible();

  view.rerender(
    <ProjectReport
      status={{ ...baseStatus, worktrees: [primary, finishedOne] }}
      repo={repo}
      contexts={[]}
      refreshing={false}
      titleRef={{ current: null }}
      onRefresh={vi.fn()}
      onChoose={vi.fn()}
      onBrowse={vi.fn()}
    />,
  );
  expect(
    screen.getByText(/\(background check status is unavailable\)\./),
  ).toBeVisible();

  view.rerender(
    <ProjectReport
      status={{ ...baseStatus, worktrees: [primary, finishedOne] }}
      repo={{ ...repo, excludedBranches: [finishedOne.branch] }}
      contexts={[]}
      refreshing={false}
      titleRef={{ current: null }}
      onRefresh={vi.fn()}
      onChoose={vi.fn()}
      onBrowse={vi.fn()}
    />,
  );
  expect(screen.queryByText(/already-combined working/)).not.toBeInTheDocument();
});
