// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { AssignmentProgress } from "../src/AssignmentProgress";
import { postJson } from "../src/api";
import { assignment } from "./team-fixtures";
vi.mock("../src/api", () => ({ postJson: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("offers an explicit new-attempt corrections choice and saves reviewer findings", async () => {
  const user = userEvent.setup(), onSave = vi.fn();
  const item = { ...assignment, status: "review" as const, revision: 4,
    summary: "First attempt", artifacts: ["/synthetic/first.md"] };
  const corrected = { ...item, status: "queued" as const, revision: 5,
    reviewNote: "Fix the missing boundary case." };
  vi.mocked(postJson).mockResolvedValue(corrected);
  render(<AssignmentProgress item={item} onSave={onSave} onBusy={vi.fn()} disabled={false} />);
  await user.tab();
  expect(screen.getByLabelText("Recorded progress")).toHaveFocus();
  expect(screen.queryByRole("option", { name: "Work underway" })).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Recorded progress"), "queued");
  expect(screen.getByRole("option", { name: "Request corrections (queue a new attempt)", selected: true })).toBeInTheDocument();
  expect(screen.getByLabelText("Review findings")).toBeRequired();
  expect(screen.getByLabelText("Evidence links or file paths")).not.toBeRequired();
  expect(screen.getAllByRole("status").some(node => node.textContent?.includes("prior run remains saved"))).toBe(true);
  await user.type(screen.getByLabelText("Review findings"), corrected.reviewNote);
  await user.click(screen.getByRole("button", { name: "Save progress" }));
  expect(postJson).toHaveBeenCalledWith("/api/assignments/update", expect.objectContaining({
    revision: 4, status: "queued", reviewNote: corrected.reviewNote, artifacts: item.artifacts,
  }));
  expect(onSave).toHaveBeenCalledWith(corrected);
});
