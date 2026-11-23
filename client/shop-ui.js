// Credits and the shop: the 🪙 balance button and the Shop panel (Camp · Wear · Looks · Get credits).
// The browser only shows and asks; the server (server/shop.js, FestivalRoom.handleCamp) decides,
// takes the credits and answers with a "wallet" message (balance, unlocks, camp items, your camp).
import { PLOTS, plotById, plotRank, CAMP_ITEMS, campItemById, CREDIT_PACKS, CREDIT_TERMS, QUEST_REWARDS, HUNT, shopCatalog } from "../shared/economy.js";
import { checkSpot, groundCapacity, cleanCampItems, MUSIC_STYLES, DEFAULT_MUSIC } from "../shared/camps.js";
import { LAYOUT } from "../shared/venue.js";
import { QUESTS } from "../shared/quests-data.js";

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const coins = (n) => `${n.toLocaleString()} 🪙`;

export function setupShop({ mp, toast, account, camps, me }) {
  const room = mp.room;
  let wallet = { credits: account?.credits ?? 0, unlocks: account?.unlocks ?? [], campItems: account?.campItems ?? [], camp: null, crewCamp: null };
  let tab = "camp";
  let plotChoice = PLOTS[0].id;
  let spotWhy = "";   // why a spot here wouldn't work ("" = it would)

  const btn = $("shop-btn");
  btn.hidden = false;
  const paint = () => { btn.textContent = coins(wallet.credits); };
  paint();

  room.onMessage("wallet", (w) => {
    wallet = w;
    // Keep the account object other screens read (lock notes, 👕 panel) in step with purchases.
    if (account) { account.credits = w.credits; account.unlocks = [...w.unlocks]; account.campItems = [...w.campItems]; }
    paint();
    if (open()) render();
  });
  room.send("wallet");
  // Your own camp or your crew camp changed outside this panel (a campmate, or `npm run account --
  // camp-release`): get a fresh wallet.
  camps.onChange(() => {
    const name = account?.username ?? "", all = camps.all();
    const mineNow = all.find((c) => c.id === name.toLowerCase()) ?? null;
    const crewNow = all.find((c) => (c.mates ?? []).includes(name)) ?? null;
    if (JSON.stringify(mineNow) !== JSON.stringify(wallet.camp) || JSON.stringify(crewNow) !== JSON.stringify(wallet.crewCamp ?? null)) room.send("wallet");
    else if (open() && tab === "camp") render();
  });

  const open = () => !$("shop").hidden;
  function show(t = tab) {
    if ($("shop").hidden) room.send("wallet");   // fresh balance (e.g. credits granted from the command line)
    tab = t; $("shop").hidden = false; render();
  }
  function hide() { $("shop").hidden = true; camps.hidePreview(); }
  btn.onclick = () => (open() ? hide() : show());
  $("shop-close").onclick = hide;
  for (const b of document.querySelectorAll("#shop-tabs button")) b.onclick = () => show(b.dataset.tab);
  addEventListener("keydown", (e) => { if (e.code === "Escape" && open()) hide(); });

  const buyBtn = (id, price, label = `Buy · ${coins(price)}`) => {
    const b = el("button", { type: "button", className: "btn-sm", textContent: label });
    b.disabled = wallet.credits < price;
    if (b.disabled) b.title = `You need ${price - wallet.credits} more credits.`;
    b.onclick = () => room.send("buy", id);
    return b;
  };
  const row = (name, note, ...actions) => el("div", { className: "shop-row" }, el("div", {}, el("b", { textContent: name }), note ? el("div", { className: "small", textContent: note }) : ""), el("div", { className: "row" }, ...actions));
  const heading = (text) => el("h3", { className: "shop-h", textContent: text });

  function render() {
    for (const b of document.querySelectorAll("#shop-tabs button")) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
    if (tab !== "camp") camps.hidePreview();
    const body = $("shop-body");
    body.replaceChildren(...(tab === "camp" ? campTab() : tab === "credits" ? creditsTab() : unlockTab(tab)));
    if (tab === "camp") refreshSpot();
  }

  // ---------- Camp ----------
  function campTab() {
    const out = [];
    const mine = wallet.camp;
    if (!mine) {
      out.push(el("p", { className: "small", textContent: "Claim a camp spot in the Campground (south of the main stage). Walk to where you want it, pick a size, and claim it. Everyone will see your camp, even when you're offline." }));
      const sizes = el("div", { className: "chips" });
      for (const p of PLOTS) {
        const b = el("button", { type: "button", textContent: `${p.name} · ${coins(p.price)}` });
        b.setAttribute("aria-pressed", String(p.id === plotChoice));
        b.onclick = () => { plotChoice = p.id; render(); };
        sizes.append(b);
      }
      out.push(sizes, el("p", { id: "spot-why", className: "small spot-why" }));
      const claim = el("button", { type: "button", id: "spot-claim", textContent: `Claim this spot · ${coins(plotById(plotChoice).price)}`, onclick: () => room.send("camp", { action: "claim", plot: plotChoice }) });
      out.push(claim);
      if (wallet.crewCamp) out.push(...crewCampSection(wallet.crewCamp));
      return out;
    }
    const plot = plotById(mine.plot);
    out.push(el("p", {}, el("b", { textContent: `Your ${plot.name}` }), el("span", { className: "small", textContent: ` · ground space ${groundUsed(mine)}/${groundCapacity(mine.plot)}` })));
    const actions = el("div", { className: "row" });
    for (const p of PLOTS.filter((p) => plotRank(p.id) > plotRank(mine.plot))) {
      const cost = p.price - plot.price;
      const b = el("button", { type: "button", className: "btn-sm", textContent: `Upgrade to ${p.name} · ${coins(cost)}`, onclick: () => room.send("camp", { action: "upgrade", plot: p.id }) });
      b.disabled = wallet.credits < cost;
      actions.append(b);
    }
    plotChoice = mine.plot;
    actions.append(el("button", { type: "button", id: "spot-claim", className: "btn-sm btn-ghost", textContent: "Move camp here", onclick: () => room.send("camp", { action: "move" }) }));
    actions.append(el("button", { type: "button", className: "btn-sm btn-ghost", textContent: "Give back spot", onclick: () => {
      if (confirm("Give back your camp spot? Your items stay yours, but the credits for the spot aren't refunded.")) room.send("camp", { action: "release" });
    } }));
    out.push(actions, el("p", { id: "spot-why", className: "small spot-why" }));

    out.push(heading("Your camp"), ...itemRows(mine, "own"), ...musicChips(mine, "own"), ...shareSection(mine));
    if (wallet.crewCamp) out.push(...crewCampSection(wallet.crewCamp));
    return out;
  }

  // ---------- Camp items: your own camp ("own") or a crew camp you're part of ("crew") ----------
  const myName = () => account?.username ?? "";
  function itemRows(camp, which) {
    const rows = [], owned = wallet.campItems;
    for (const item of CAMP_ITEMS) {
      const has = owned.includes(item.id), up = camp.items.includes(item.id);
      const holder = up ? camp.by?.[item.id] ?? camp.owner : "";
      const note = [item.featured ? "★ Featured" : "", item.place === "edge" ? "Goes around the spot" : "Uses ground space", item.group === "tent" ? "One tent at a time" : ""].filter(Boolean).join(" · ");
      if (up && holder !== myName()) {
        // Someone else's: a campmate's in your camp (you can pack it away), or the owner's/another
        // campmate's in a crew camp (only they can).
        rows.push(row(`${item.name} ✓`, `Set up by ${holder}`, which === "own" ? itemBtn(item, true, which, camp) : ""));
        continue;
      }
      if (!has) { if (which === "own" || !wallet.camp) rows.push(row(item.name, note, buyBtn(item.id, item.price))); continue; }
      rows.push(row(item.name + (up ? " ✓" : ""), note, itemBtn(item, up, which, camp)));
    }
    return rows;
  }
  function itemBtn(item, up, which, camp) {
    const b = el("button", { type: "button", className: "btn-sm " + (up ? "btn-ghost" : ""), textContent: up ? "Pack away" : "Set up" });
    b.onclick = () => {
      if (!up) {   // quick check here; the server checks again
        const next = [...camp.items.filter((i) => !(item.group && campItemById(i)?.group === item.group)), item.id];
        if (!cleanCampItems(next, next, camp.plot).includes(item.id)) return toast("No ground space left. Pack something away or upgrade the spot.", "error");
      }
      room.send("camp", { action: "item", item: item.id, on: !up, camp: which });
    };
    return b;
  }
  // With the PA set up, pick what it plays (the owner, or whoever brought the PA to a crew camp).
  function musicChips(camp, which) {
    if (!camp.items.includes("pa") || (which === "crew" && (camp.by?.pa ?? camp.owner) !== myName())) return [];
    const chips = el("div", { className: "chips" });
    for (const m of MUSIC_STYLES) {
      const b = el("button", { type: "button", textContent: m.name, onclick: () => room.send("camp", { action: "music", style: m.id, camp: which }) });
      b.setAttribute("aria-pressed", String((camp.music ?? DEFAULT_MUSIC) === m.id));
      chips.append(b);
    }
    return [heading("PA music"), el("p", { className: "small", textContent: "Everyone near the camp hears it. Mute your own speakers with 🔊 by the map." }), chips];
  }

  // ---------- Crew camps ----------
  // Your camp: share it with your crew (they set up things they own), see and remove campmates.
  function shareSection(mine) {
    const out = [heading("Crew camp")];
    const mates = mine.mates ?? [];
    out.push(el("p", { className: "small", textContent: mates.length
      ? `Shared with ${mates.join(", ")}. They can set up their own things here; you can pack away anything to make room.`
      : "Share your camp with your crew: everyone in it can set up their own things here too. Nobody pays for anyone else's things." }));
    out.push(el("div", { className: "row" }, el("button", { type: "button", className: "btn-sm", textContent: mates.length ? "Add my crew" : "Share with my crew", onclick: () => room.send("camp", { action: "share" }) })));
    for (const n of mates) {
      out.push(row(n, "Campmate", el("button", { type: "button", className: "btn-sm btn-ghost", textContent: "Remove", onclick: () => {
        if (confirm(`Take ${n} off your camp? Their things go with them.`)) room.send("camp", { action: "unshare", name: n });
      } })));
    }
    return out;
  }
  // A crew camp you're part of (someone else's camp).
  function crewCampSection(crew) {
    const plot = plotById(crew.plot);
    return [
      heading(`${crew.owner}'s crew camp`),
      el("p", { className: "small", textContent: `${plot?.name ?? "Camp spot"} · ground space ${groundUsed(crew)}/${groundCapacity(crew.plot)}. Set up things you own here; they stay yours.` }),
      ...itemRows(crew, "crew"),
      ...musicChips(crew, "crew"),
      el("div", { className: "row" }, el("button", { type: "button", className: "btn-sm btn-ghost", textContent: "Leave crew camp", onclick: () => {
        if (confirm(`Leave ${crew.owner}'s crew camp? Your things come with you.`)) room.send("camp", { action: "leave" });
      } })),
    ];
  }
  const groundUsed = (c) => c.items.filter((id) => { const i = campItemById(id); return i?.place === "ground" && !i.group; }).length;

  // Is where I'm standing OK for my (new or moved) spot? Updates the line under the buttons + the outline.
  function refreshSpot() {
    const p = me();
    if (!p) return;
    const others = camps.all().filter((c) => c.id !== wallet.camp?.id);
    spotWhy = checkSpot(LAYOUT.items, others, { x: p.x, z: p.z, plot: plotChoice });
    const line = $("spot-why"), claim = $("spot-claim");
    if (line) { line.textContent = spotWhy || "✓ Your spot fits right here (the green outline)."; line.classList.toggle("bad", !!spotWhy); }
    if (claim) claim.disabled = !!spotWhy || (!wallet.camp && wallet.credits < plotById(plotChoice).price);
    camps.showPreview(plotChoice, p.x, p.z, !spotWhy);
  }

  // ---------- Wear / Looks ----------
  function unlockTab(kind) {
    const out = [el("p", { className: "small", textContent: kind === "wear"
      ? "Premium things to wear around the festival. Once you own one, put it on from the 👕 button."
      : "Premium characters and character parts. Once you own one, pick it from the 👕 button." })];
    for (const item of shopCatalog().filter((i) => i.kind === kind)) {
      const has = wallet.unlocks.includes(item.id);
      out.push(row(item.name, has ? "Owned" : "", has ? el("span", { className: "small", textContent: "✓ Yours" }) : buyBtn(item.id, item.price)));
    }
    return out;
  }

  // ---------- Get credits ----------
  function creditsTab() {
    const out = [heading("Earn credits"), el("p", { className: "small", textContent: "Side quests pay credits (the full reward the first time, a smaller one for repeats), and so does the daily scavenger hunt." })];
    for (const [id, r] of Object.entries(QUEST_REWARDS)) if (QUESTS[id]) out.push(row(QUESTS[id].name, `First time ${coins(r.first)} · repeats ${coins(r.repeat)}`));
    out.push(row("Daily scavenger hunt", `${HUNT.tokens} glowing tokens a day: ${coins(HUNT.perToken)} each, ${coins(HUNT.bonus)} for all ${HUNT.tokens}. Tap 🔍 Hunt at the top for hints.`));
    out.push(heading("Buy credits"), el("p", { className: "small", textContent: "Coming soon. Buying credits isn't open yet." }));
    for (const p of CREDIT_PACKS) {
      const b = el("button", { type: "button", className: "btn-sm", textContent: `$${p.usd.toFixed(2)}`, disabled: true });
      out.push(row(`${p.name}: ${coins(p.credits)}`, p.note ?? "", b));
    }
    out.push(el("p", { className: "small", textContent: CREDIT_TERMS }));
    return out;
  }

  // Called every frame: keep the spot check live while the Camp tab is open.
  let since = 0;
  function update(dt) {
    if (!open() || tab !== "camp") return;
    since += dt;
    if (since > 0.2) { since = 0; refreshSpot(); }
  }

  return { update, show, credits: () => wallet.credits };
}
