// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { TeamDesk } from "../src/TeamDesk";
import { getJson, postJson } from "../src/api";
import { assignment } from "./team-fixtures";
vi.mock("../src/api", () => ({ getJson: vi.fn(), postJson: vi.fn() }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks(); });
let refreshPoll: () => void;
const first = { ...assignment, status: "review" as const, revision: 3,
  summary: "First report", artifacts: ["/synthetic/first.md"] };
const corrected = { ...first, status: "queued" as const, revision: 4,
  summary: "Corrections requested", reviewNote: "Verify both release identities." };
async function open() {
  const realInterval = globalThis.setInterval;
  vi.spyOn(globalThis, "setInterval").mockImplementation((callback, delay, ...args) => {
    if (delay !== 15000) return realInterval(callback, delay, ...args);
    refreshPoll = callback as () => void;
    return 0 as unknown as ReturnType<typeof setInterval>;
  });
  vi.mocked(getJson).mockResolvedValue({ assignments: [first] });
  const user = userEvent.setup();
  render(<TeamDesk />);
  await act(async () => {});
  await user.click(screen.getByRole("button", { name: first.title }));
  return user;
}
async function poll(item = corrected) {
  vi.mocked(getJson).mockResolvedValue({ assignments: [item] });
  await act(async () => { refreshPoll(); });
}
it("refreshes an untouched open detail without losing history expansion or moving focus", async () => {
  const user = await open();
  const history = screen.getByText("Allowed work and recorded history");
  await user.click(history);
  history.focus();
  await poll();
  expect(screen.getAllByText(corrected.reviewNote).length).toBeGreaterThan(0);
  expect(screen.getByLabelText("Review findings")).toHaveValue(corrected.reviewNote);
  expect(history.closest("details")).toHaveAttribute("open");
  expect(history).toHaveFocus();
  expect(screen.queryByRole("button", { name: /Discard draft/ })).not.toBeInTheDocument();
});
it("preserves a dirty draft at its old revision and blocks stale saves until explicit reload", async () => {
  const user = await open();
  const findings = screen.getByLabelText("Review findings");
  await user.type(findings, "My unsaved review");
  await poll();
  expect(findings).toHaveValue("My unsaved review");
  expect(findings).toHaveFocus();
  expect(findings).toBeEnabled();
  expect(screen.getByText(/Latest saved progress: Queued/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save progress" })).toBeDisabled();
  fireEvent.submit(findings.closest("form")!);
  expect(postJson).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: /Discard draft and load latest/ }));
  expect(screen.getByLabelText("Review findings")).toHaveValue(corrected.reviewNote);
  await waitFor(() => expect(screen.getByRole("heading", { name: first.title })).toHaveFocus());
  vi.mocked(postJson).mockResolvedValue({ ...corrected, revision: 5 });
  await user.click(screen.getByRole("button", { name: "Save progress" }));
  expect(postJson).toHaveBeenCalledWith("/api/assignments/update", expect.objectContaining({ revision: 4 }));
});
it("keeps focused pristine fields and drafts visible when the remote result is accepted", async () => {
  await open();
  const summary = screen.getByLabelText("What changed?");
  await act(async () => { summary.focus(); });
  const done = { ...corrected, status: "accepted" as const, reviewNote: "Independent acceptance." };
  vi.mocked(getJson).mockResolvedValue({ assignments: [done] });
  await act(async () => { refreshPoll(); });
  expect(summary).toHaveFocus();
  expect(summary).toHaveValue(first.summary);
  expect(screen.getByText(/Latest saved progress: Accepted after review/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save progress" })).toBeDisabled();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /Discard draft and load latest/ }));
  expect(screen.getByText(done.reviewNote)).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("heading", { name: first.title })).toHaveFocus());
  expect(screen.queryByRole("button", { name: "Save progress" })).not.toBeInTheDocument();
});
it("does not regress a saved revision when a poll returns an older snapshot", async () => {
  const user = await open();
  vi.mocked(postJson).mockResolvedValue(corrected);
  await user.type(screen.getByLabelText("Review findings"), corrected.reviewNote);
  await user.click(screen.getByRole("button", { name: "Save progress" }));
  await act(async () => {});
  await poll(first);
  expect(screen.getAllByText(corrected.reviewNote).length).toBeGreaterThan(0);
  expect(screen.getByLabelText("Review findings")).toHaveValue(corrected.reviewNote);
});
it("keeps the original revision and draft recoverable during a rejected in-flight save", async () => {
  const user = await open();
  let rejectSave: (error: Error) => void = () => {};
  vi.mocked(postJson).mockImplementation(() => new Promise((_resolve, reject) => { rejectSave = reject; }));
  await user.type(screen.getByLabelText("Review findings"), "Unsaved result");
  await user.click(screen.getByRole("button", { name: "Save progress" }));
  await poll();
  expect(screen.getByRole("button", { name: /Discard draft/ })).toBeDisabled();
  expect(screen.getByLabelText("Review findings")).toHaveValue("Unsaved result");
  expect(postJson).toHaveBeenCalledWith("/api/assignments/update", expect.objectContaining({ revision: 3 }));
  await act(async () => { rejectSave(new Error("A newer update exists.")); });
  expect(screen.getByRole("alert")).toHaveTextContent("A newer update exists.");
  expect(screen.getByLabelText("Review findings")).toHaveValue("Unsaved result");
  expect(screen.getByRole("button", { name: /Discard draft/ })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Save progress" })).toBeDisabled();
});
