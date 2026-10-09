// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { AgentRequest } from "../src/AgentRequest";
import { FocusWorkspace } from "../src/FocusWorkspace";
import { taskAdvice } from "../src/taskAdvice";
import { agentRequest } from "../src/taskPresentation";
import { ready, repo, response } from "./ui-fixtures";
const status = response().status!;
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("distinguishes a shared file from a confirmed clash and keeps a final check separate from completion", () => {
  expect(
    taskAdvice(
      { ...ready, category: "attention", overlappingFiles: ["page.tsx"] },
      false,
    ).explanation,
  ).toContain("how they should fit together");
  expect(
    taskAdvice({ ...ready, state: "CONFLICT-WITH-BASE" }, false).explanation,
  ).toContain("do not fit together yet");
  expect(taskAdvice(ready, false).explanation).toContain(
    "still need to check that they work",
  );
  expect(
    taskAdvice({ ...ready, category: "finished" }, false).explanation,
  ).toContain("does not tell us whether they are live");
  expect(taskAdvice(ready, true).title).toBe("This work is on hold.");
});
it("keeps the exact manually copied message through polling and offers a complete fallback path", async () => {
  const user = userEvent.setup();
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
    new Error("Denied"),
  );
  const view = render(
    <AgentRequest guided worktree={ready} status={status} disabled={false} />,
  );
  await user.click(screen.getByRole("button", { name: "Copy the message" }));
  const text = screen.getByRole("textbox", {
    name: "Message for your AI chat",
  }) as HTMLTextAreaElement;
  const original = agentRequest(ready, status);
  expect(text).toHaveFocus();
  expect(text.selectionStart).toBe(0);
  expect(text.selectionEnd).toBe(original.length);
  view.rerender(
    <AgentRequest
      guided
      worktree={{ ...ready, nextAction: "Newer advice" }}
      status={status}
      disabled={false}
    />,
  );
  expect(text).toHaveValue(original);
  await user.click(
    screen.getByRole("button", { name: "I copied it — continue" }),
  );
  expect(
    screen.getByRole("heading", { name: "Send the message in your AI chat." }),
  ).toHaveFocus();
  await user.click(screen.getByText("How do I paste?"));
  expect(screen.getByText(/On a phone or tablet/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "I sent the message" }));
  expect(
    screen.getByRole("heading", { name: "You can leave this page now." }),
  ).toHaveFocus();
  await user.click(
    screen.getByRole("button", { name: "Read the next step again" }),
  );
  expect(
    screen.getByRole("button", { name: "Copy the message" }),
  ).toHaveFocus();
});
it("shows completed evidence if work finishes while the message guidance is open", async () => {
  const user = userEvent.setup();
  const props = { contexts: [], repo, disabled: false, onAction: vi.fn() };
  const view = render(<FocusWorkspace {...props} status={status} />);
  await user.click(screen.getByRole("button", { name: "Inspect Ready" }));
  await user.click(screen.getByText("Send a message manually"));
  await screen.findByRole("button", { name: "Copy the message" });
  await user.click(screen.getByRole("button", { name: "Copy the message" }));
  view.rerender(
    <FocusWorkspace
      {...props}
      status={{ ...status, worktrees: [{ ...ready, category: "finished" }] }}
    />,
  );
  expect(
    screen.getByRole("heading", { name: "These changes have been combined." }),
  ).toBeVisible();
  expect(
    screen.getByText(/does not tell us whether they are live/),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "I sent the message" }),
  ).not.toBeInTheDocument();
});
