import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type net from "node:net";

const rootDir = process.cwd();
const distDir = path.join(rootDir, "dist", "public");
const port = Number(process.env.PW_UI_PORT || 4173);

function ensureBuildExists() {
  const indexPath = path.join(distDir, "index.html");
  if (!fs.existsSync(indexPath)) {
    throw new Error(
      `Playwright UI build not found at ${indexPath}. Run the build step before starting the Playwright web server.`,
    );
  }
}

async function main() {
  ensureBuildExists();
  const indexHtml = await fs.promises.readFile(path.join(distDir, "index.html"), "utf8");
  const connections = new Set<net.Socket>();
  const server = http.createServer(async (req, res) => {
    try {
      const requestPath = decodeURIComponent((req.url || "/").split("?")[0] || "/");
      const normalized = requestPath === "/" ? "/index.html" : requestPath;
      const relativePath = normalized.replace(/^\/+/, "");
      const candidatePath = path.resolve(distDir, relativePath);

      if (!candidatePath.startsWith(distDir)) {
        res.statusCode = 403;
        res.end("Forbidden");
        return;
      }

      if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) {
        const ext = path.extname(candidatePath).toLowerCase();
        const contentType =
          (
            {
              ".html": "text/html; charset=utf-8",
              ".js": "application/javascript; charset=utf-8",
              ".css": "text/css; charset=utf-8",
              ".json": "application/json; charset=utf-8",
              ".svg": "image/svg+xml",
              ".png": "image/png",
              ".jpg": "image/jpeg",
              ".jpeg": "image/jpeg",
              ".gif": "image/gif",
              ".webp": "image/webp",
              ".ico": "image/x-icon",
            } as Record<string, string>
          )[ext] || "application/octet-stream";

        res.statusCode = 200;
        res.setHeader("Content-Type", contentType);
        fs.createReadStream(candidatePath).pipe(res);
        return;
      }

      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(indexHtml);
    } catch (error) {
      res.statusCode = 500;
      res.end(`Playwright server error: ${String(error)}`);
    }
  });

  server.on("connection", (socket) => {
    connections.add(socket);
    socket.on("close", () => {
      connections.delete(socket);
    });
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
    for (const socket of connections) {
      socket.destroy();
    }
    setTimeout(() => process.exit(0), 1_000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  server.listen(port, "127.0.0.1", () => {
    console.log(`[playwright-web-server] serving ${distDir} on ${port}`);
  });
}

main().catch((error) => {
  console.error("[playwright-web-server] failed", error);
  process.exit(1);
});
