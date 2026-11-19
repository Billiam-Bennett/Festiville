// Credits and the shop: the 🪙 balance button and the Shop panel (Camp · Wear · Looks · Get credits).
// The browser only shows and asks; the server (server/shop.js, FestivalRoom.handleCamp) decides,
// takes the credits and answers with a "wallet" message (balance, unlocks, camp items, whether you're a
// premium member, your camp).
import { PLOTS, plotById, plotRank, MEMBERSHIP, CAMP_ITEMS, CAMP_CATEGORIES, campItemById, PREMIUM_BUNDLE, LED_COLORS, cleanLedColor, GOLF_CART, CREDIT_PACKS, CREDIT_TERMS, QUEST_REWARDS, shopCatalog } from "../shared/economy.js";
import { checkSpot, groundCapacity, cleanCampItems } from "../shared/camps.js";
import { LAYOUT } from "../shared/venue.js";
import { QUESTS } from "../shared/quests-data.js";

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const coins = (n) => `${n.toLocaleString()} 🪙`;

export function setupShop({ mp, toast, account, camps, me }) {
  const room = mp.room;
  let wallet = { credits: account?.credits ?? 0, unlocks: account?.unlocks ?? [], campItems: account?.campItems ?? [], premium: false, camp: null };
  let tab = "camp";
  let plotChoice = PLOTS[0].id;
  let pickedPlot = false;   // has the player picked a size themselves (before that we suggest theirs)
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
  // Your own camp changed outside this panel (e.g. `npm run account -- camp-release`): get a fresh wallet.
  camps.onChange(() => {
    const mineNow = camps.all().find((c) => c.id === account?.username?.toLowerCase()) ?? null;
    if (JSON.stringify(mineNow) !== JSON.stringify(wallet.camp)) room.send("wallet");
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
  // The rule (shared/economy.js): everyone gets one free 10×10; the 10×20 is a credit upgrade; the
  // 20×20 comes with premium membership (with the premium bundle) and is never sold for credits.
  const plotTag = (p) => (p.premium ? (wallet.premium ? "included with premium" : `${MEMBERSHIP.name} members`) : p.price ? coins(p.price) : "free");
  const yourPlot = (p) => (p.premium ? `Your ${p.name.replace(" spot", "")} premium camp` : p.price ? `Your ${p.name}` : `Your free ${p.name.replace(" spot", "")}`);
  function campTab() {
    const out = [];
    const mine = wallet.camp;
    if (!mine) {
      if (!pickedPlot) plotChoice = (wallet.premium ? PLOTS.find((p) => p.premium) : PLOTS[0]).id;
      out.push(el("p", {}, el("b", { textContent: wallet.premium ? "Your 20×20 premium camp is waiting." : "Your free 10×10 is waiting." })));
      out.push(el("p", { className: "small", textContent: wallet.premium
        ? `As a ${MEMBERSHIP.name} member you get a 20×20 spot with the LED tent, neon name sign, string lights and camp flag. Walk to where you want it in the Campground and claim it. Everyone will see your camp, even when you're offline.`
        : `Every member gets one free 10×10 camp spot, like camping at a real festival. Walk to where you want it in the Campground and claim it. Everyone will see your camp, even when you're offline. ${MEMBERSHIP.name} members (${MEMBERSHIP.price} in the ${MEMBERSHIP.app} app) get a 20×20 with an LED tent, neon sign, lights and a flag, plus a golf cart.` }));
      const sizes = el("div", { className: "chips" });
      for (const p of PLOTS) {
        const locked = p.premium && !wallet.premium;
        const b = el("button", { type: "button", textContent: `${p.name.replace(" spot", "")} · ${plotTag(p)}`, className: locked ? "locked" : "" });
        b.setAttribute("aria-pressed", String(p.id === plotChoice));
        b.onclick = () => {
          if (locked) return toast(`The 20×20 comes with ${MEMBERSHIP.name} membership (${MEMBERSHIP.price} in the ${MEMBERSHIP.app} app). Your free 10×10 is ready to claim.`);
          plotChoice = p.id; pickedPlot = true; render();
        };
        sizes.append(b);
      }
      const choice = plotById(plotChoice);
      out.push(sizes, el("p", { id: "spot-why", className: "small spot-why" }));
      const label = choice.premium ? "Claim your 20×20 here" : choice.price ? `Claim this spot · ${coins(choice.price)}` : "Claim your free 10×10 here";
      out.push(el("button", { type: "button", id: "spot-claim", textContent: label, onclick: () => room.send("camp", { action: "claim", plot: plotChoice }) }));
      return out;
    }
    const plot = plotById(mine.plot);
    out.push(el("p", {}, el("b", { textContent: yourPlot(plot) }), el("span", { className: "small", textContent: ` · ground space ${groundUsed(mine)}/${groundCapacity(mine.plot)}` })));
    const actions = el("div", { className: "row" });
    for (const p of PLOTS.filter((p) => plotRank(p.id) > plotRank(mine.plot))) {
      const cost = p.premium ? 0 : Math.max(0, p.price - plot.price);
      const locked = p.premium && !wallet.premium;
      const text = locked ? `${p.name.replace(" spot", "")} · ${MEMBERSHIP.name} members` : p.premium ? `Upgrade to your ${p.name.replace(" spot", "")} · included` : `Upgrade to ${p.name} · ${coins(cost)}`;
      const b = el("button", { type: "button", className: "btn-sm", textContent: text, onclick: () => room.send("camp", { action: "upgrade", plot: p.id }) });
      b.disabled = locked || wallet.credits < cost;
      if (locked) b.title = `The 20×20 comes with ${MEMBERSHIP.name} membership. It isn't sold for credits.`;
      actions.append(b);
    }
    plotChoice = mine.plot;
    actions.append(el("button", { type: "button", id: "spot-claim", className: "btn-sm btn-ghost", textContent: "Move camp here", onclick: () => room.send("camp", { action: "move" }) }));
    actions.append(el("button", { type: "button", className: "btn-sm btn-ghost", textContent: "Give back spot", onclick: () => {
      const paid = plot.price > 0 ? " The credits for the bigger spot aren't refunded." : "";
      if (confirm(`Give back your camp spot? Your items stay yours, and you can claim a free 10×10 again any time.${paid}`)) room.send("camp", { action: "release" });
    } }));
    out.push(actions, el("p", { id: "spot-why", className: "small spot-why" }));

    const owned = wallet.campItems;
    for (const cat of CAMP_CATEGORIES) {
      out.push(heading(cat.name));
      for (const item of CAMP_ITEMS.filter((i) => i.cat === cat.id)) {
        const has = owned.includes(item.id), up = mine.items.includes(item.id);
        const bundled = wallet.premium && PREMIUM_BUNDLE.includes(item.id);
        const where = item.on === "tent" ? "Goes on your tent" : item.on === "firepit" ? "Goes over your fire pit" : item.place === "edge" ? "Goes around your spot" : "Uses ground space";
        const note = [item.featured ? "★ Featured" : "", bundled ? "Included with premium" : "", where, item.group === "tent" ? "One tent at a time" : item.group === "overfire" ? "One at a time over the fire" : ""].filter(Boolean).join(" · ");
        if (!has) {
          out.push(row(item.name, note, item.premium ? el("span", { className: "small", textContent: `${MEMBERSHIP.name} members` }) : buyBtn(item.id, item.price)));
          continue;
        }
        const toggle = el("button", { type: "button", className: "btn-sm " + (up ? "btn-ghost" : ""), textContent: up ? "Pack away" : "Set up" });
        toggle.onclick = () => {
          let next = up ? mine.items.filter((i) => i !== item.id) : [...mine.items.filter((i) => !(item.group && campItemById(i)?.group === item.group)), item.id];
          const cleaned = cleanCampItems(next, owned, mine.plot);
          if (!up && !cleaned.includes(item.id)) {
            const need = item.on === "tent" ? "Set up a tent first." : item.on === "firepit" ? "Set up your fire pit first." : "No ground space left. Pack something away or upgrade your spot.";
            return toast(need, "error");
          }
          room.send("camp", { action: "setup", items: cleaned });
        };
        out.push(row(item.name + (up ? " ✓" : ""), note, toggle));
        // The LED tent's colour, while it's set up.
        if (item.id === "tent_led" && up) {
          const chips = el("div", { className: "chips" });
          for (const c of LED_COLORS) {
            const b = el("button", { type: "button", textContent: "●", title: "LED tent colour" });
            b.style.color = c;
            b.setAttribute("aria-label", `LED tent colour ${c}`);
            b.setAttribute("aria-pressed", String(cleanLedColor(mine.led) === c));
            b.onclick = () => room.send("camp", { action: "led", color: c });
            chips.append(b);
          }
          out.push(chips);
        }
      }
    }
    // The golf cart: parked at your camp. Who gets one is GOLF_CART in shared/economy.js.
    out.push(heading("Ride"));
    if (wallet.cart) out.push(row(`🛺 ${GOLF_CART.name} ✓`, "Parked at your camp. Tap 🛺 to drive it anywhere on the grounds; park it and it goes back to your camp."));
    else if (Number.isInteger(GOLF_CART.price)) out.push(row(`🛺 ${GOLF_CART.name}`, "★ Faster than running, and everyone sees you ride in." + (GOLF_CART.premium ? " Included with premium." : ""), buyBtn(GOLF_CART.id, GOLF_CART.price)));
    else out.push(row(`🛺 ${GOLF_CART.name}`, `★ Comes with ${MEMBERSHIP.name} membership: faster than running, parked at your camp, and everyone sees you ride in.`, el("span", { className: "small", textContent: "Premium members" })));
    return out;
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
    const choice = plotById(plotChoice);
    if (claim) claim.disabled = !!spotWhy || (!wallet.camp && (wallet.credits < choice.price || (choice.premium && !wallet.premium)));
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
    const out = [heading("Earn credits"), el("p", { className: "small", textContent: "Side quests pay credits: the full reward the first time, a smaller one for repeats." })];
    for (const [id, r] of Object.entries(QUEST_REWARDS)) if (QUESTS[id]) out.push(row(QUESTS[id].name, `First time ${coins(r.first)} · repeats ${coins(r.repeat)}`));
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

  return { update, show, credits: () => wallet.credits, hasCart: () => !!wallet.cart };
}
