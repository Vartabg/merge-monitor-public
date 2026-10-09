import { boardRequest } from "./board.mjs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { contextFields, saveTaskContext } from "./task-context.mjs";
import { assignmentRequest } from "./assignment-api.mjs";

function fail(message, statusCode = 400) {
  throw Object.assign(new Error(message), { statusCode });
}
function send(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(body));
}
async function body(req, fields, limit = 4096) {
  if (req.headers["content-type"]?.split(";")[0] !== "application/json")
    fail("Send JSON with Content-Type: application/json.", 415);
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > limit) fail("The request is too large.", 413);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail("The request must contain valid JSON.");
  }
  if (
    !value ||
    Array.isArray(value) ||
    typeof value !== "object" ||
    Object.keys(value).some((k) => !fields.includes(k))
  )
    fail("The request contains unsupported fields.");
  return value;
}
function requireMethod(req, method) {
  if (req.method !== method) fail(`Use ${method} for this endpoint.`, 405);
}

export function createApi(monitor, worker, assignments, board) {
  const token = randomBytes(32).toString("hex");
  return async function api(
    req,
    res,
    next = () => send(res, 404, { error: "This endpoint does not exist." }),
  ) {
    let path;
    try {
      path = new URL(req.url || "/", "http://localhost").pathname;
    } catch {
      return send(res, 400, { error: "Use a valid local dashboard URL." });
    }
    if (!path.startsWith("/api/")) return next();
    try {
      const port = req.socket.localPort;
      const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
      if (!hosts.includes(req.headers.host))
        fail("Use the local Merge Monitor address.", 403);
      const origin = req.headers.origin;
      if (origin && !hosts.map((host) => `http://${host}`).includes(origin))
        fail("Requests must come from the local dashboard.", 403);
      if (req.headers["sec-fetch-site"] === "cross-site")
        fail("Cross-site requests are not allowed.", 403);
      if (req.method === "POST") {
        const incoming = req.headers["x-merge-monitor-token"];
        if (
          !origin ||
          typeof incoming !== "string" ||
          !/^[a-f0-9]{64}$/.test(incoming) ||
          !timingSafeEqual(Buffer.from(incoming), Buffer.from(token))
        )
          fail("Refresh the dashboard session and try again.", 403);
      }
      if (path === "/api/assignments" || path.startsWith("/api/assignments/")) {
        const result = await assignmentRequest(path, req, assignments, body);
        return send(res, result.code, result.data);
      }
      if (path === "/api/board" || path.startsWith("/api/board/")) {
        return send(
          res,
          200,
          await boardRequest(path, req, board, monitor, body),
        );
      }
      switch (path) {
        case "/api/health":
          requireMethod(req, "GET");
          return send(res, 200, {
            ok: true,
            version: "0.8.1",
            at: new Date().toISOString(),
          });
        case "/api/session":
          requireMethod(req, "GET");
          return send(res, 200, { token });
        case "/api/repos":
          requireMethod(req, "GET");
          return send(res, 200, monitor.config);
        case "/api/status": {
          requireMethod(req, "GET");
          const id =
            new URL(req.url, "http://localhost").searchParams.get("repo") ||
            monitor.config.defaultRepo;
          return send(res, 200, {
            ...monitor.view(id),
            taskContexts: (monitor.store.get().taskContexts || []).filter(
              (item) => item.repoId === id,
            ),
            worker: worker.view(),
            history: monitor.store
              .get()
              .history.filter((e) => !e.repoId || e.repoId === id)
              .slice(0, 20),
          });
        }
        case "/api/task-context": {
          requireMethod(req, "POST");
          return send(
            res,
            200,
            await saveTaskContext(monitor, await body(req, contextFields)),
          );
        }
        case "/api/refresh": {
          requireMethod(req, "POST");
          const value = await body(req, ["repoId"]);
          if (typeof value.repoId !== "string")
            fail("Choose a configured repository.");
          monitor.repo(value.repoId);
          monitor.refresh(value.repoId).catch(() => undefined); // Repository error is returned in subsequent status responses.
          return send(res, 202, { accepted: true });
        }
        case "/api/worker": {
          requireMethod(req, "POST");
          const value = await body(req, ["enabled"]);
          if (typeof value.enabled !== "boolean")
            fail("Choose whether to enable or pause the preview worker.");
          return send(res, 200, await worker.setEnabled(value.enabled));
        }
        case "/api/worker/run":
          requireMethod(req, "POST");
          await body(req, []);
          return send(res, 200, await worker.run());
        case "/api/preview": {
          requireMethod(req, "POST");
          const value = await body(req, [
            "repoId",
            "branch",
            "headSha",
            "baseSha",
          ]);
          if (
            typeof value.repoId !== "string" ||
            typeof value.branch !== "string" ||
            ![value.headSha, value.baseSha].every(
              (s) => typeof s === "string" && /^[0-9a-f]{40,64}$/.test(s),
            )
          )
            fail("Refresh the repository and select a task to preview.");
          return send(
            res,
            200,
            await monitor.runPreview(value.repoId, value.branch, {
              headSha: value.headSha,
              baseSha: value.baseSha,
            }),
          );
        }
        default:
          return send(res, 404, { error: "This endpoint does not exist." });
      }
    } catch (error) {
      send(res, error.statusCode || 500, {
        error:
          error.message ||
          "The request could not be completed. Refresh and try again.",
      });
    }
  };
}
