# FestiVille playtest brief

Thanks for playing! This is a test build, so things will break. The point is to find out where.
Play for 30–45 minutes, then write a short report (template at the bottom).

## Getting in

1. The server runs on Billiam's PC. Open **http://localhost:2567** in a browser on that PC.
2. Choose **Create account** and pick any name (3–16 letters, numbers or `_`) and a password with 8+ characters.
3. Pick a character (Classic, or Build your own) and press **Enter the festival**.
4. To test the premium items, ask Billiam to unlock premium for your account. He runs
   `npm.cmd run account -- unlock <your-name> premium` and it takes effect straight away.

Controls: WASD or the arrow keys to move, Shift to run, Space to jump, 1–9 for emotes, E to dance,
M for the map, scroll or +/- to zoom. The buttons on screen work too.

## What to try

Go through these in any order. For each one, note anything that looks wrong, feels clunky, or confuses you.

**First impressions**
- [ ] Sign-up and the character screen. Was anything unclear?
- [ ] The first 30 seconds in the festival. Do you know where to go and what to do?

**Getting around** (the map is about 400 × 400 m)
- [ ] Open the full map (M). Can you read it? Do any labels overlap?
- [ ] Walk from the Campground (south) over a bridge to the Main Field, then on to the Grove (west) and the East Side.
- [ ] Try to walk into the river away from a bridge, and into stages, tents and trees. You should be stopped and slide along, never go through or get stuck.
- [ ] Take the 🚌 shuttle from a shuttle stop (look for 🚌 on the map) to another section.

**Camps**
- [ ] Open the shop (the coin button), go to Camp, walk into the Campground and claim your free 10×10.
- [ ] Add a few camp items. Try upgrading to the 10×20 with credits.
- [ ] Premium only: claim the 20×20. It comes with an LED tent (change its color), a neon sign, string lights and a flag.
- [ ] Walk around inside your camp. Tents and items should be solid and the grass open.

**Rides**
- [ ] Ride the 🎡 Ferris wheel by the First Aid tent. Look around from the top. Is it slow and smooth? Is the view good?
- [ ] Premium only: drive the 🛺 golf cart. Is it faster than running? Does your character sit properly?
- [ ] Premium only: drive into 🅿️ golf cart parking (by the Ferris wheel, for one) and tap **Park here**. Does the cart stay, and can you get back in? Then try stepping out somewhere else: you should get a warning, and the cart goes back to your camp.

**Quests**
- [ ] Talk to someone with a yellow **!** above them and do a quest. Try Sunny's "Get Weird Run" (sponsored by Hippie Dips) and one of the timed ones (Vendor Rush or Soundcheck).
- [ ] Is it clear what to do, where to go, and when you're done?

**Stages and DJs** (🎧 button)
- [ ] Open the DJ panel. Is it clear how DJing works?
- [ ] You can sign up as a DJ, but **don't link anyone else's music**. Real mixes come later from DJs who own them.

**Looks and feel**
- [ ] How do the graphics look: lighting, shadows, glowing lights, the ground? Anything ugly or hard to see?
- [ ] How do the characters move: walking, running, turning, emotes, sitting on rides? Anything stiff, sliding or glitchy?
- [ ] Does it ever stutter or slow down? Where were you, and what was happening?

## Already known (no need to report these)

- When the server restarts, the game doesn't tell you. It just stops working until you reload.
- Mixcloud sets switch on and off with distance instead of fading.

## Report template

Save your report as `docs/playtest-reports/<your-name>-<date>.md`, or send it to Billiam.

```
# Playtest report: <your name>, <date>

Played for: <minutes>   Character: <classic/built>   Premium: <yes/no>   Browser: <name>

## Top 3 things to fix first
1.
2.
3.

## Bugs
For each: what you did → what you expected → what happened. Where on the map. How bad (blocks play / annoying / cosmetic).

## Confusing moments
Times you didn't know what to do or what something meant.

## Looks and animation
What looked or moved wrong, and what looked great.

## What was fun
What you'd want more of.

## Anything else
```
