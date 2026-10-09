import { useCallback, useEffect, useState } from "react";
import { getJson, postJson } from "./api";
import type { StatusResponse } from "./types";

export function useStatus(repoId: string) {
  const [result, setResult] = useState<StatusResponse | null>(null);
  const [failure, setFailure] = useState<{
    repoId: string;
    message: string;
  } | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      let pending = false;
      try {
        const next = await getJson<StatusResponse>(
          `/api/status?repo=${encodeURIComponent(repoId)}`,
          {
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(8000),
            ]),
          },
        );
        if (!disposed && next.repoId === repoId) {
          setResult(next);
          setFailure(null);
          pending = next.refreshing;
        }
      } catch {
        if (!disposed)
          setFailure({
            repoId,
            message:
              "Connection lost. Start the local service or try refreshing. Any displayed data is from the last successful scan.",
          });
      } finally {
        if (!disposed) timer = setTimeout(poll, pending ? 1500 : 5000);
      }
    }
    void poll();
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [repoId, revision]);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  const refresh = useCallback(async () => {
    await postJson("/api/refresh", { repoId });
    reload();
  }, [repoId, reload]);
  const data = result?.repoId === repoId ? result : null;
  const error =
    failure?.repoId === repoId ? failure.message : data?.error || null;
  return {
    data,
    error,
    stale: !data || data.stale || Boolean(error),
    refresh,
    reload,
  };
}
