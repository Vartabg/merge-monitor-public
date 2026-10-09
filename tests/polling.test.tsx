// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useStatus } from "../src/useStatus";
import { response } from "./ui-fixtures";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("does not display a previous repo while switching or accept its late response", async () => {
  let resolveFirst: (value: Response) => void = () => undefined;
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ...response(), repoId: "second" })),
      ),
  );
  const hook = renderHook(({ id }) => useStatus(id), {
    initialProps: { id: "test" },
  });
  hook.rerender({ id: "second" });
  expect(hook.result.current.data).toBeNull();
  await waitFor(() => expect(hook.result.current.data?.repoId).toBe("second"));
  await act(async () => resolveFirst(new Response(JSON.stringify(response()))));
  expect(hook.result.current.data?.repoId).toBe("second");
});
it("retains the last successful data and marks it stale after a polling failure", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(response())))
      .mockRejectedValue(new Error("offline")),
  );
  const hook = renderHook(() => useStatus("test"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(hook.result.current.data?.status?.worktrees[0].branch).toBe("main");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(hook.result.current.data?.status?.worktrees[0].branch).toBe("main");
  expect(hook.result.current.stale).toBe(true);
  expect(hook.result.current.error).toContain("Connection lost");
});
