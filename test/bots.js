// Two fake players walk in circles so you can watch the server work without a browser.
// Run the server first (npm start), then in a second terminal: npm run bots
// Each bot signs in first (the first run creates accounts BotA and BotB with a random password
// stored in data/bot-passwords.json, so later runs can sign back in).
import { Client } from "colyseus.js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";

const url = process.env.SERVER_URL || "ws://localhost:2567";
const api = url.replace(/^ws/, "http") + "/api";
const pwFile = new URL("../data/bot-passwords.json", import.meta.url);
let passwords = {};
try { passwords = JSON.parse(readFileSync(pwFile, "utf8")); } catch {}

async function signIn(name) {
  const post = (path, body) => fetch(`${api}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (passwords[name]) {
    const r = await post("login", { username: name, password: passwords[name] });
    if (r.ok) return (await r.json()).token;
  }
  passwords[name] = randomBytes(12).toString("base64url");
  const r = await post("signup", { username: name, password: passwords[name] });
  if (!r.ok) throw new Error(`${name} couldn't sign up: ${(await r.json()).error}`);
  mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
  writeFileSync(pwFile, JSON.stringify(passwords, null, 2));
  return (await r.json()).token;
}

async function bot(name, phase) {
  const room = await new Client(url).joinOrCreate("festival", { token: await signIn(name) });
  let seq = 0, t = phase;
  setInterval(() => {
    t += 0.05;
    room.send("input", { x: Math.cos(t), z: Math.sin(t), seq: ++seq });
  }, 50);
  return room;
}

const [a, b] = await Promise.all([bot("BotA", 0), bot("BotB", Math.PI)]);

setInterval(() => {
  const line = [];
  a.state.players.forEach((p) => line.push(`${p.name}(${p.x.toFixed(1)}, ${p.z.toFixed(1)})`));
  console.log(`BotA sees ${a.state.players.size} players: ${line.join("  ")}`);
}, 1000);

setTimeout(() => {
  const ok = a.state.players.size === 2 && b.state.players.size === 2;
  console.log(ok ? "\n✅ Both bots see each other moving." : "\n❌ Bots did not see each other.");
  a.leave(); b.leave();
  setTimeout(() => process.exit(ok ? 0 : 1), 300);
}, 5000);
