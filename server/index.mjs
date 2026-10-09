import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createService } from "./service.mjs";

export async function startServer({
  root = fileURLToPath(new URL("../", import.meta.url)),
  port = Number(process.env.PORT || 5173),
  statePath,
  startWorker = true,
  development = false,
} = {}) {
  const service = await createService(root, { statePath, startWorker });
  const dist = resolve(root, "dist");
  if (!development) await stat(resolve(dist, "index.html"));
  let vite;
  const server = createServer((req, res) => {
    void service.api(req, res, async () => {
      try {
        if (vite) return vite.middlewares(req, res);
        if (!["GET", "HEAD"].includes(req.method)) {
          res.writeHead(405);
          res.end();
          return;
        }
        const requested = decodeURIComponent(
          new URL(req.url, "http://localhost").pathname,
        );
        const file = resolve(
          dist,
          `.${requested === "/" ? "/index.html" : requested}`,
        );
        if (!file.startsWith(`${dist}${sep}`)) {
          res.writeHead(403);
          res.end();
          return;
        }
        const types = {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".json": "application/json",
          ".svg": "image/svg+xml",
        };
        if (!types[extname(file)]) {
          res.writeHead(404);
          res.end();
          return;
        }
        const bytes = await readFile(file);
        res.writeHead(200, {
          "Content-Type": types[extname(file)],
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": file.includes(`${sep}assets${sep}`)
            ? "public, max-age=31536000, immutable"
            : "no-cache",
          "Content-Security-Policy":
            "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        });
        res.end(req.method === "HEAD" ? undefined : bytes);
      } catch (error) {
        res.writeHead(error.code === "ENOENT" ? 404 : 400);
        res.end("The requested file is unavailable.");
      }
    });
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  if (development) {
    const { createServer: createVite } = await import("vite");
    const { default: react } = await import("@vitejs/plugin-react");
    vite = await createVite({
      root,
      configFile: false,
      plugins: [react()],
      server: { middlewareMode: true, hmr: { server }, host: "127.0.0.1" },
    });
    server.on("close", () => {
      void vite.close();
    });
  }
  await new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", accept);
  });
  server.on("close", service.close);
  return { server, service };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const { server } = await startServer({
    development: process.argv.includes("--dev"),
  });
  console.log(
    `[Merge Monitor] Listening → http://127.0.0.1:${server.address().port}`,
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      server.close(() => process.exit(0));
      server.closeIdleConnections();
    });
}
