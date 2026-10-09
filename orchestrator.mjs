#!/usr/bin/env node
// The production service owns scheduling, state, and the shared inspection engine.
const unsupported = process.argv.slice(2).filter((arg) => arg !== "--once");
if (unsupported.length) {
  console.error(
    "Use node orchestrator.mjs --once. Enable scheduled previews in the dashboard. This service does not merge or push project branches.",
  );
  process.exitCode = 1;
} else {
  const origin = `http://127.0.0.1:${Number(process.env.PORT || 5173)}`;
  try {
    const session = await fetch(`${origin}/api/session`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!session.ok)
      throw new Error("Could not create a local service session.");
    const { token } = await session.json();
    const response = await fetch(`${origin}/api/worker/run`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "X-Merge-Monitor-Token": token,
      },
      body: "{}",
      signal: AbortSignal.timeout(180_000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    console.log(
      `[Preview worker] ${result.status} → ${result.error || (result.enabled ? "Cycle completed" : "Paused; enable previews in the dashboard")}`,
    );
    if (result.error) process.exitCode = 1;
  } catch (error) {
    console.error(
      `[Preview worker] Unavailable → ${error.message}. Start the local production service first.`,
    );
    process.exitCode = 1;
  }
}
