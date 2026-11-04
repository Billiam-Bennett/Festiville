// Serves the game page (client/) and the shared code it imports (shared/). Nothing else is reachable.
import { readFile } from "node:fs/promises";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWED = ["client", "shared"];
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".glb": "model/gltf-binary", ".json": "application/json",
};

// Returns true if it handled the request.
export async function serveStatic(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const url = new URL(req.url, "http://x");
  let path;
  try { path = decodeURIComponent(url.pathname); } catch { res.writeHead(400).end("Bad request"); return true; }
  if (path === "/" || path === "/client") {
    res.writeHead(302, { Location: "/client/" + url.search }).end();
    return true;
  }
  if (path.endsWith("/")) path += "index.html";
  const rel = normalize(path).replace(/^[/\\]+/, "");
  if (!ALLOWED.some((d) => rel.startsWith(d + "/") || rel.startsWith(d + "\\"))) return false;
  try {
    const body = await readFile(join(root, rel));
    res.writeHead(200, { "Content-Type": TYPES[extname(rel)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    res.writeHead(404).end("Not found");
  }
  return true;
}
