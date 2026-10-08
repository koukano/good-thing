import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const base = fileURLToPath(new URL("../public/", import.meta.url));
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".txt": "text/plain", ".xml": "application/xml" };
export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      const target = path.resolve(base, `.${pathname === "/" ? "/index.html" : pathname}`);
      if (!target.startsWith(base) || !["GET", "HEAD"].includes(req.method)) throw new Error();
      const bytes = await readFile(target);
      res.writeHead(200, { "Content-Type": types[path.extname(target)] || "application/octet-stream", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      res.end(req.method === "HEAD" ? undefined : bytes);
    } catch { res.writeHead(404); res.end("Not found"); }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer().listen(4173, "127.0.0.1", () => console.log("画面確認: http://127.0.0.1:4173 （終了はCtrl+C）"));
}
