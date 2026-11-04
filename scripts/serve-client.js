// Tiny zero-dependency web server for the game client.
// Serves client/ and shared/ so the browser can load the same sim.js the server uses.
// Usage: npm run client  → open http://localhost:5173
// (The game server on port 2567 serves the same pages too; this is handy while editing the client.)
import http from "node:http";
import { serveStatic } from "../server/static.js";

const port = Number(process.env.CLIENT_PORT) || 5173;
http.createServer(async (req, res) => {
  if (!(await serveStatic(req, res))) res.writeHead(404).end("Not found");
}).listen(port, () => {
  console.log(`FestiVille client at http://localhost:${port}`);
});
