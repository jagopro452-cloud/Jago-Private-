import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function serveStatic(app: Express) {
  // Build output is dist/public (set in vite.config.ts); __dirname is server/
  const distPath = path.resolve(__dirname, "..", "dist", "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // IMPORTANT: Serve static files ONLY  from /public directory
  // Do NOT use catch-all middleware that might intercept /api requests
  app.use(express.static(distPath, {
    // Cache static assets (CSS, JS, images) for 1 year since they're hashed
    maxAge: '1y',
    // But don't cache index.html - it gets new asset hashes
    setHeaders: (res, filepath) => {
      if (filepath.endsWith('index.html')) {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
      }
    }
  }));

  // CRITICAL: Handle 404s for routes that weren't matched by API handlers or static files
  // This MUST only serve index.html for client-side routing (non-API paths)
  app.use((req, res) => {
    // NEVER serve index.html for API routes - they should 404 if not handled
    if (req.path.startsWith("/api/") || req.path.startsWith("/api") || 
        req.path.startsWith("/v1/") || req.path.startsWith("/v2/")) {
      return res.status(404).json({ message: "API endpoint not found" });
    }
    
    // For client routes, serve index.html (React Router will handle routing)
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
