// The shop and credit rewards: all the rules about credits, with no networking in here (the game room
// calls these; test/economy.test.js tests them directly). The server is the only place balances change.
import { UNLOCK_PRICES, campItemById, PREMIUM_BUNDLE, GOLF_CART, CREDIT_PACKS, QUEST_REWARDS, DAILY_REPEAT_CAP, unlockableById, shopCatalog } from "../shared/economy.js";

export { unlockableById, shopCatalog };

// Buy one thing. Returns { ok, text, balance } or { error }.
// premium: the buyer is a premium member, so the premium bundle is already theirs.
export function buy(store, accountId, itemId, { premium = false } = {}) {
  const a = store.get(accountId);
  if (!a || typeof itemId !== "string") return { error: "Couldn't find that." };
  // The golf cart: only sold when GOLF_CART.price is set (shared/economy.js); premium members may already have one.
  if (itemId === GOLF_CART.id) {
    if (a.unlocks.includes(GOLF_CART.id) || (premium && GOLF_CART.premium)) return { error: "You already have a golf cart. It's parked at your camp." };
    if (!Number.isInteger(GOLF_CART.price)) return { error: GOLF_CART.premium ? "Golf carts come with premium membership." : "That isn't for sale." };
    const paid = store.changeCredits(accountId, -GOLF_CART.price, `buy:${itemId}`);
    if (paid.error) return paid;
    store.grant(accountId, GOLF_CART.id);
    return { ok: true, text: "You got a golf cart! It's parked at your camp. Tap 🛺 to drive it.", balance: paid.balance };
  }
  const unlock = UNLOCK_PRICES[itemId] != null ? unlockableById(itemId) : null;
  const camp = !unlock ? campItemById(itemId) : null;
  if (unlock && unlock.tier === "premium") {
    if (a.unlocks.includes(itemId)) return { error: `You already own ${unlock.name}.` };
    const price = UNLOCK_PRICES[itemId];
    const paid = store.changeCredits(accountId, -price, `buy:${itemId}`);
    if (paid.error) return paid;
    store.grant(accountId, itemId);
    return { ok: true, text: `You got ${unlock.name}!`, balance: paid.balance };
  }
  if (camp && premium && PREMIUM_BUNDLE.includes(itemId)) return { error: `${camp.name} comes with your premium camp. Set it up from the Camp tab.` };
  if (camp && camp.price > 0 && !camp.premium) {
    if (store.campItems(a).includes(itemId)) return { error: `You already own ${camp.name}.` };
    const paid = store.changeCredits(accountId, -camp.price, `buy:${itemId}`);
    if (paid.error) return paid;
    store.addCampItem(accountId, itemId);
    return { ok: true, text: `You got ${camp.name}! Set it up from the Camp tab.`, balance: paid.balance };
  }
  return { error: "That isn't for sale." };
}

// Credits for finishing a side quest: the full reward the first time, the smaller repeat reward
// after that, and repeats stop paying once a player has earned DAILY_REPEAT_CAP from repeats today
// (UTC). Returns the number of credits given (0 if none).
export function rewardQuest(store, accountId, questId, now = Date.now()) {
  const a = store.get(accountId);
  const r = QUEST_REWARDS[questId];
  if (!a || !r) return 0;
  const done = a.questsPaid?.[questId] ?? 0;
  const day = new Date(now).toISOString().slice(0, 10);
  const today = a.repeatEarned?.day === day ? a.repeatEarned.amount : 0;
  const amount = done === 0 ? r.first : Math.max(0, Math.min(r.repeat, DAILY_REPEAT_CAP - today));
  const extra = {
    questsPaid: { ...(a.questsPaid ?? {}), [questId]: done + 1 },
    ...(done > 0 ? { repeatEarned: { day, amount: today + amount } } : {}),
  };
  if (!amount) { Object.assign(a, extra); store.save(); return 0; }
  const out = store.changeCredits(accountId, amount, `quest:${questId}${done ? ":repeat" : ""}`, extra);
  return out.error ? 0 : amount;
}

// A real-money credit pack was paid for. This is what the payment provider's webhook should call once
// one is connected (planned: PayPal Business, on a PAYMENT.CAPTURE.COMPLETED event, with the capture
// id as paymentRef). paymentRef is the provider's payment id, so a webhook delivered twice only
// credits once. Returns { balance, credits } or { error }.
export function grantPack(store, accountId, packId, paymentRef) {
  const pack = CREDIT_PACKS.find((p) => p.id === packId);
  const a = store.get(accountId);
  if (!pack || !a) return { error: "Unknown pack or player." };
  if (typeof paymentRef !== "string" || !paymentRef) return { error: "Missing payment reference." };
  if ((a.payments ?? []).includes(paymentRef)) return { balance: store.balance(a), credits: 0, duplicate: true };
  const out = store.changeCredits(accountId, pack.credits, `pack:${packId}:${paymentRef}`, { payments: [...(a.payments ?? []), paymentRef] });
  return out.error ? out : { balance: out.balance, credits: pack.credits };
}
