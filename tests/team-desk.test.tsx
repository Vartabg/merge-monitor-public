// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { TeamDesk } from "../src/TeamDesk";
import { getJson, postJson } from "../src/api";
import { assignment } from "./team-fixtures";
vi.mock("../src/api", () => ({ getJson: vi.fn(), postJson: vi.fn() }));
beforeEach(() => {
  vi.mocked(getJson).mockResolvedValue({ assignments: [assignment] });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("records a new assignment and opens its saved details", async () => {
  const user = userEvent.setup();
  vi.mocked(postJson).mockResolvedValue(assignment);
  render(<TeamDesk />);
  await screen.findByRole("button", { name: assignment.title });
  await user.click(screen.getByRole("button", { name: "Add an assignment" }));
  for (const [label, text] of [
    ["Work name", assignment.title],
    ["Project", "Studio"],
    ["Why it matters", "Keep work recoverable."],
    ["Assigned to", "Muse"],
    ["Model or tool", assignment.model],
    ["Reviewer", "Gemini"],
    ["Allowed work", "Assignment files"],
    ["Acceptance checks", assignment.acceptance],
    ["Time or usage limit", "12 model steps"],
  ])
    await user.type(screen.getByLabelText(label), text);
  await user.click(screen.getByRole("button", { name: "Save assignment" }));
  await waitFor(() =>
    expect(postJson).toHaveBeenCalledWith(
      "/api/assignments",
      expect.objectContaining({ owner: "Muse", reviewer: "Gemini" }),
    ),
  );
  expect(
    await screen.findByRole("heading", { name: assignment.title }),
  ).toHaveFocus();
});
it("updates progress against the opened revision and keeps rejected edits for recovery", async () => {
  const user = userEvent.setup();
  vi.mocked(postJson).mockRejectedValue(
    new Error("A newer update exists. Reload the assignment and try again."),
  );
  render(<TeamDesk />);
  await user.click(
    await screen.findByRole("button", { name: assignment.title }),
  );
  await user.selectOptions(
    screen.getByLabelText("Recorded progress"),
    "working",
  );
  await user.type(screen.getByLabelText("What changed?"), "Starting repair.");
  await user.click(screen.getByRole("button", { name: "Save progress" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("newer update");
  expect(screen.getByLabelText("What changed?")).toHaveValue(
    "Starting repair.",
  );
  expect(postJson).toHaveBeenCalledWith(
    "/api/assignments/update",
    expect.objectContaining({ revision: 1, status: "working" }),
  );
});
it("requires evidence for acceptance and shows accepted work without an edit form", async () => {
  const user = userEvent.setup();
  const review = { ...assignment, status: "review" as const, revision: 3 };
  vi.mocked(getJson).mockResolvedValue({ assignments: [review] });
  const done = {
    ...review,
    status: "accepted" as const,
    revision: 4,
    summary: "Verified repair",
    artifacts: ["https://example.com/evidence"],
    reviewNote: "Gemini reviewed the diff; Codex reran tests.",
  };
  vi.mocked(postJson).mockResolvedValue(done);
  render(<TeamDesk />);
  await user.click(
    await screen.findByRole("button", { name: assignment.title }),
  );
  await user.selectOptions(
    screen.getByLabelText("Recorded progress"),
    "accepted",
  );
  expect(screen.getByLabelText("Evidence links or file paths")).toBeRequired();
  expect(screen.getByLabelText("Review findings")).toBeRequired();
  await user.type(screen.getByLabelText("What changed?"), done.summary);
  await user.type(
    screen.getByLabelText("Evidence links or file paths"),
    done.artifacts[0],
  );
  await user.type(screen.getByLabelText("Review findings"), done.reviewNote);
  await user.click(screen.getByRole("button", { name: "Save progress" }));
  await screen.findByText(done.reviewNote);
  expect(
    screen.queryByRole("button", { name: "Save progress" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Evidence 1/ })).toHaveAttribute(
    "href",
    done.artifacts[0],
  );
});
it("recovers a failed connection and returns focus to the selected work", async () => {
  const user = userEvent.setup();
  vi.mocked(getJson).mockRejectedValueOnce(new Error("Offline"));
  render(<TeamDesk />);
  await user.click(await screen.findByRole("button", { name: "Try again" }));
  await user.click(
    await screen.findByRole("button", { name: assignment.title }),
  );
  await user.click(screen.getByRole("button", { name: "Back to assignments" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: assignment.title }),
    ).toHaveFocus(),
  );
});
