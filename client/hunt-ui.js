// The daily scavenger hunt (server/hunt.js): today's tokens glow around the grounds, the "🔍 Hunt"
// counter sits in the top bar, and tapping it lists where to look. Walking over a token picks it up;
// the server checks you're really there and pays the credits.
const $ = (id) => document.getElementById(id);

export function setupHunt({ THREE, scene, mp, toast }) {
  const room = mp.room;
  let hunt = null;                  // the last "hunt" message: { day, spots: [{ i, x, z, hint, found }], perToken, bonus, resetsIn }
  let receivedAt = 0;
  const tokens = new Map();         // i -> 3D token
  const group = new THREE.Group();
  scene.add(group);

  // Shared materials and shapes: a gold coin with a soft beam so you can spot it from across the field.
  const coinGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.07, 28);
  const coinMat = new THREE.MeshStandardMaterial({ color: "#ffd36b", emissive: "#e0a93f", emissiveIntensity: 0.8, metalness: 0.6, roughness: 0.3 });
  const starMat = new THREE.MeshBasicMaterial({ color: "#fff6d8" });
  const beamGeo = new THREE.CylinderGeometry(0.22, 0.22, 9, 10, 1, true);
  const beamMat = new THREE.MeshBasicMaterial({ color: "#ffd36b", transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });

  function makeToken(s) {
    const g = new THREE.Group();
    g.position.set(s.x, 0, s.z);
    const coin = new THREE.Mesh(coinGeo, coinMat);
    coin.rotation.x = Math.PI / 2;
    coin.position.y = 1.1;
    const star = new THREE.Mesh(new THREE.CircleGeometry(0.14, 5), starMat);   // a little star face on each side
    star.position.y = 0.04; star.rotation.x = -Math.PI / 2;
    const back = star.clone(); back.position.y = -0.04; back.rotation.x = Math.PI / 2;
    coin.add(star, back);
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.y = 4.5;
    g.add(coin, beam);
    g.userData.coin = coin;
    g.userData.phase = s.i * 1.3;
    return g;
  }

  function rebuild() {
    for (const t of tokens.values()) group.remove(t);
    tokens.clear();
    for (const s of hunt?.spots ?? []) {
      if (s.found) continue;
      const t = makeToken(s);
      group.add(t);
      tokens.set(s.i, t);
    }
    render();
  }

  // ---------- Top-bar counter and the hint list ----------
  const count = () => (hunt?.spots ?? []).filter((s) => s.found).length;
  function render() {
    if (!hunt) return;
    const n = count(), total = hunt.spots.length;
    const pill = $("hud-hunt");
    pill.hidden = !total;
    pill.textContent = n >= total ? `🔍 Hunt done ✓` : `🔍 Hunt ${n}/${total}`;
    pill.classList.toggle("done", n >= total && total > 0);
    if ($("hunt").hidden) return;
    $("hunt-rules").textContent = `Find today's ${total} glowing tokens around the grounds. ${hunt.perToken} 🪙 each, and ${hunt.bonus} 🪙 more for finding all ${total}.`;
    $("hunt-list").replaceChildren(...hunt.spots.map((s) => {
      const li = document.createElement("li");
      li.className = s.found ? "found" : "";
      li.textContent = s.found ? `✓ Found` : s.hint;
      return li;
    }));
    const left = Math.max(0, hunt.resetsIn - (performance.now() - receivedAt) / 1000);
    const h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60);
    $("hunt-next").textContent = `New tokens in ${h ? `${h} h ` : ""}${m} min.`;
  }
  const open = () => { $("hunt").hidden = false; render(); };
  const close = () => ($("hunt").hidden = true);
  $("hud-hunt").onclick = () => ($("hunt").hidden ? open() : close());
  $("hud-hunt").onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("hud-hunt").click(); } };
  $("hunt-close").onclick = close;
  addEventListener("keydown", (e) => { if (e.code === "Escape") close(); });

  // ---------- Server messages ----------
  room.onMessage("hunt", (m) => {
    const newDay = hunt && hunt.day !== m.day;
    hunt = m;
    receivedAt = performance.now();
    rebuild();
    if (newDay) toast("A new scavenger hunt just started: new tokens are glowing around the grounds. Tap 🔍 Hunt for hints.", "big", 7000);
  });
  room.onMessage("huntFound", (m) => {
    const s = hunt?.spots.find((x) => x.i === m.i);
    if (s) s.found = true;
    const t = tokens.get(m.i);
    if (t) { group.remove(t); tokens.delete(m.i); }
    render();
    if (m.complete) toast(`Hunt complete! +${m.credits} 🪙 (with the ${m.bonus} 🪙 bonus). New tokens tomorrow.`, "big", 7000);
    else toast(`Token found! +${m.credits} 🪙 · Hunt ${m.found}/${m.total}`);
  });
  room.send("hunt");

  // ---------- Every frame: spin and bob ----------
  let t = 0;
  function update(dt) {
    t += dt;
    for (const g of tokens.values()) {
      const c = g.userData.coin;
      c.rotation.z += dt * 2.2;
      c.position.y = 1.1 + Math.sin(t * 2 + g.userData.phase) * 0.12;
    }
    beamMat.opacity = 0.14 + Math.sin(t * 2.5) * 0.05;
  }

  return { update, state: () => hunt };
}
