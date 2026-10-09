// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import axe from "axe-core";
import App from "../src/App";
import { getJson } from "../src/api";
import { repo, response } from "./ui-fixtures";
import type { StatusResponse } from "../src/types";

const state = vi.hoisted(() => ({
  data: null as StatusResponse | null,
  stale: false,
  error: null as string | null,
  refresh: vi.fn(),
}));
vi.mock("../src/useStatus", () => ({
  useStatus: () => ({ ...state, reload: vi.fn() }),
}));
vi.mock("../src/api", () => ({
  getJson: vi.fn(),
  postJson: vi.fn().mockResolvedValue({}),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => {
  state.data = response();
  state.stale = false;
  state.error = null;
  state.refresh.mockClear();
  localStorage.clear();
  vi.mocked(getJson).mockResolvedValue({
    repos: [repo, { ...repo, id: "second", label: "Second project" }],
    defaultRepo: repo.id,
  });
});
async function mount() {
  const result = render(<App />);
  await screen.findByLabelText("Your project");
  return result;
}

it("starts with one primary action and keeps housekeeping and history optional", async () => {
  await mount();
  expect(screen.getAllByRole("button")).toHaveLength(3);
  expect(screen.getByRole("button", { name: "Check project" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Copy the message" }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Check project" }));
  expect(state.refresh).toHaveBeenCalledOnce();
  expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  expect(screen.queryByText("Main project copy")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Recent check results" }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByText("Check history and settings"));
  const summary = (await screen.findByText("Main project copy")).closest(
    "summary",
  )!;
  await userEvent.click(summary);
  expect(summary.closest("details")).toHaveAttribute("open");
  expect(screen.getByText("1 file with uncommitted edits")).toBeVisible();
});
it("keeps saved project selection across reloads and handles removed projects", async () => {
  await mount();
  await userEvent.selectOptions(
    screen.getByLabelText("Your project"),
    "second",
  );
  cleanup();
  await mount();
  expect(screen.getByLabelText("Your project")).toHaveValue("second");
  cleanup();
  vi.mocked(getJson).mockResolvedValue({ repos: [repo], defaultRepo: repo.id });
  await mount();
  expect(screen.getByLabelText("Your project")).toHaveValue("test");
});
it("keeps project selection usable when browser preference storage is blocked", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Blocked");
  });
  await mount();
  await userEvent.selectOptions(
    screen.getByLabelText("Your project"),
    "second",
  );
  expect(screen.getByLabelText("Your project")).toHaveValue("second");
});
it("replaces stale advice with one recovery action and disables project mutations", async () => {
  state.stale = true;
  state.error = "Connection lost.";
  await mount();
  expect(
    screen.getByRole("heading", { name: "We have lost the connection." }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /Copy/ }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  await userEvent.click(screen.getByText("Check history and settings"));
  expect(
    await screen.findByRole("button", { name: "Enable automatic checks" }),
  ).toBeDisabled();
});
it.each([
  "loaded",
  "loading",
  "error",
  "expanded",
  "handoff",
  "paste",
  "copy-failure",
  "browse",
])(
  "has no automated accessibility violations in the %s state",
  async (variant) => {
    if (variant === "loading") state.data = null;
    if (variant === "error") {
      state.error = "Connection lost.";
      state.stale = true;
    }
    const { container } = await mount();
    const user = userEvent.setup();
    if (["expanded", "handoff", "paste", "copy-failure"].includes(variant)) {
      await user.click(screen.getByRole("button", { name: "Inspect Ready" }));
    }
    if (["handoff", "paste", "copy-failure"].includes(variant)) {
      await user.click(screen.getByText("Send a message manually"));
      await screen.findByRole("button", { name: "Copy the message" });
    }
    if (variant === "expanded") {
      await user.click(screen.getByText("Why use Merge Monitor?"));
      await user.click(screen.getByText("Direct access for AI tools"));
      await user.click(screen.getByText("About this work"));
      await user.click(await screen.findByText("Add a name and notes"));
    }
    if (variant === "copy-failure") {
      vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
        new Error("Denied"),
      );
      await user.click(
        screen.getByRole("button", { name: "Copy the message" }),
      );
    }
    if (variant === "handoff" || variant === "paste") {
      await user.click(
        screen.getByRole("button", { name: "Copy the message" }),
      );
      expect(
        screen.getByRole("heading", {
          name: "Send the message in your AI chat.",
        }),
      ).toHaveFocus();
      if (variant === "handoff") {
        await user.click(
          screen.getByRole("button", { name: "I sent the message" }),
        );
        expect(
          screen.getByRole("heading", { name: "You can leave this page now." }),
        ).toHaveFocus();
      } else await user.click(screen.getByText("How do I paste?"));
    }
    if (variant === "browse")
      await user.click(screen.getByRole("button", { name: "See all work" }));
    const report = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(
      report.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("main")).toHaveAttribute("id", "main");
    expect(
      screen.getByRole("link", { name: "Skip to project report" }),
    ).toHaveAttribute("href", "#main");
  },
);
