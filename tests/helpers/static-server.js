/* ============================================================
   Wetalk QA - dependency-free static file server

   Used by the end-to-end tests (and handy for manual previews).
   Serves the repo root exactly like GitHub Pages would: static
   files, directory index.html, correct MIME types, no caching.

   CLI:
     node tests/helpers/static-server.js --port 8104 --root .
   ============================================================ */
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".nojekyll": "text/plain; charset=utf-8",
  ".task": "application/octet-stream",
};

function send(res, status, body, headers) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.writeHead(status, Object.assign(
    {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Length": payload.length,
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
    headers || {}
  ));
  res.end(payload);
}

/**
 * Create (but do not start) the static server.
 * @param {string} rootDir directory to serve
 */
function createStaticServer(rootDir) {
  const root = path.resolve(rootDir || path.join(__dirname, "..", ".."));

  return http.createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return send(res, 405, "Method Not Allowed");
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    } catch (err) {
      return send(res, 400, "Bad Request");
    }

    const relative = pathname.replace(/^\/+/, "");
    let filePath = path.resolve(root, relative);
    if (filePath !== root && !filePath.startsWith(root + path.sep)) {
      return send(res, 403, "Forbidden");
    }

    let stat = null;
    try {
      stat = fs.statSync(filePath);
    } catch (err) {
      stat = null;
    }

    if (stat && stat.isDirectory()) {
      filePath = path.join(filePath, "index.html");
      try {
        stat = fs.statSync(filePath);
      } catch (err) {
        stat = null;
      }
    }

    if (!stat || !stat.isFile()) {
      return send(res, 404, "404 Not Found: " + pathname);
    }

    let body;
    try {
      body = fs.readFileSync(filePath);
    } catch (err) {
      return send(res, 500, "Internal Server Error");
    }

    const ext = path.extname(filePath).toLowerCase();
    const headers = { "Content-Type": MIME[ext] || "application/octet-stream" };
    if (pathname === "/" || pathname.endsWith(".html")) {
      headers["Content-Security-Policy"] = "";
    }
    if (req.method === "HEAD") {
      res.writeHead(200, Object.assign(headers, { "Content-Length": body.length }));
      return res.end();
    }
    return send(res, 200, body, headers);
  });
}

/**
 * Start the static server on a port (0 = pick a free port).
 * Resolves with { server, port, baseURL, close() }.
 */
function startServer(options) {
  options = options || {};
  const port = options.port === undefined ? 0 : options.port;
  const host = options.host || "127.0.0.1";
  const root = options.root || path.join(__dirname, "..", "..");
  const server = createStaticServer(root);

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      resolve({
        server,
        port: actualPort,
        host,
        baseURL: "http://" + host + ":" + actualPort + "/",
        close() {
          return new Promise((done) => server.close(() => done()));
        },
      });
    });
  });
}

module.exports = { createStaticServer, startServer, MIME };

// ---------- CLI ----------
if (require.main === module) {
  const args = process.argv.slice(2);
  function argValue(name, fallback) {
    const idx = args.indexOf(name);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
  }
  const port = Number(argValue("--port", "8104"));
  const root = argValue("--root", path.join(__dirname, "..", ".."));
  startServer({ port, root }).then((handle) => {
    console.log("Serving " + path.resolve(root) + " at " + handle.baseURL);
    console.log("Press Ctrl+C to stop.");
    process.on("SIGINT", () => {
      handle.close().then(() => process.exit(0));
    });
  }).catch((err) => {
    console.error("Failed to start server:", err.message);
    process.exit(1);
  });
}
