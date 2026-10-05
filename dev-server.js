// Run the Apacom app, the test page and the six live sources on your own machine
// or in a GitHub Codespace, without Netlify:   node dev-server.js
// Needs Node 18 or newer. API keys come from environment variables (Codespaces secrets)
// or from a .env file next to this one (never commit that file).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8888;

// optional .env file
const envFile = path.join(root, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
const fnDir = path.join(root, "netlify", "functions");

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    // live sources: /.netlify/functions/<name>
    if (url.pathname.startsWith("/.netlify/functions/")) {
      const name = url.pathname.split("/").pop().replace(/[^a-z0-9-]/gi, "");
      const file = path.join(fnDir, name + ".mjs");
      if (!fs.existsSync(file)) { res.writeHead(404, { "content-type": "application/json" }); return res.end('{"ok":false,"error":"No such function"}'); }
      const chunks = []; for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const request = new Request(url.href, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body });
      const mod = await import(pathToFileURL(file).href);
      const response = await mod.default(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      return res.end(Buffer.from(await response.arrayBuffer()));
    }
    // pages from public/
    let p = decodeURIComponent(url.pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = path.join(root, "public", path.normalize(p).replace(/^(\.\.[/\\])+/, ""));
    if (!file.startsWith(path.join(root, "public")) || !fs.existsSync(file)) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    console.error(e);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: e.message }));
  }
}).listen(PORT, () => {
  const keys = ["ADZUNA_APP_ID", "ADZUNA_APP_KEY", "FT_CLIENT_ID", "FT_CLIENT_SECRET", "ANTHROPIC_API_KEY"];
  console.log(`\nApacom is running on port ${PORT}`);
  console.log(`  App:        http://localhost:${PORT}/`);
  console.log(`  Test page:  http://localhost:${PORT}/live.html`);
  console.log(`  Keys found: ${keys.filter(k => process.env[k]).join(", ") || "none yet"}\n`);
});
