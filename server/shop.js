// The shop and credit rewards: all the rules about credits, with no networking in here (the game room
// calls these; test/economy.test.js tests them directly). The server is the only place balances change.
import { UNLOCK_PRICES, campItemById, CREDIT_PACKS, QUEST_REWARDS, DAILY_REPEAT_CAP, unlockableById, shopCatalog } from "../shared/economy.js";

export { unlockableById, shopCatalog };

// Buy one thing. Returns { ok, text, balance } or { error }.
export function buy(store, accountId, itemId) {
  const a = store.get(accountId);
  if (!a || typeof itemId !== "string") return { error: "Couldn't find that." };
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
  if (camp && camp.price > 0) {
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
