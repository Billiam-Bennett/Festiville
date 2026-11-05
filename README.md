# FestiVille — Multiplayer Prototype

A virtual festival you can walk around with other people in real time, dance, form crews, and take on side quests solo or together. Hanging out is always free: quests are optional and give badges, never access.

This is the start of the real game: a 3D festival you can walk around in the browser, plus the server that keeps everyone in sync. There's no earlier Base44 game to connect to, so this client *is* the game.

## What's here

| File | What it does |
|---|---|
| `shared/sim.js` | Movement rules (speed, map bounds, input cleanup). Used by BOTH server and browser. |
| `server/schema.js` | The state every player sees: name, position, facing, emote. |
| `server/FestivalRoom.js` | One festival instance: 100 players max, 20 ticks/sec, server owns all positions. |
| `server/index.js` | Starts the game server on port 2567: game traffic, the vendor API, and the game page, all on one port. |
| `server/vendors.js` | Vendor listings (menus, upcoming stops) and their private edit keys, saved in `data/`. |
| `server/api.js` | The small web API vendors save through (`/api/vendors`). |
| `shared/listings.js` | The rules for what a vendor can edit (lengths, prices, dates), used by both the server and the edit page. |
| `client/vendor.html` + `vendor.js` | The page vendors use to edit their own stall, with a live preview. |
| `scripts/vendor-link.mjs` | Makes a vendor's private edit link (`npm run vendor-link -- <stall id>`). |
| `server/chat.js` | Chat rules: who hears a message (nearby or your crew), rate limits, optional blocked-word list. |
| `client/chat-ui.js` | Speech bubbles over heads, the chat log, the typing bar, and muting players. |
| `server/quests.js` | All crew and quest rules (invites, crew size, quest steps, timers, badges). No networking, so it's fully tested. |
| `shared/quests-data.js` | Quest content: who gives each quest, what they say, where things are. **Edit this to tweak or add quests.** |
| `client/quests-ui.js` | Quest givers, Talk button, quest dialog, tracker, glowing objectives, crew rings, invites, badges. |
| `client/index.html` | The game page: join screen, HUD, Emote button, phone joystick. |
| `client/main.js` | 3D scene setup and the game loop. |
| `shared/layout.js` | **What's on the grounds**, as plain data: every stage, stall, area, tent, light, character and quest spot. The festival builder edits this; the server saves it in `data/layout.json`. |
| `shared/venue.js` | Turns a layout into what the game reads (vendors, zones, quest positions), plus every vendor's starting menu. |
| `client/builder.html` + `builder.js` | **The festival builder**: a top-down map you edit with a walk-around 3D preview. Organizers only. |
| `server/layout.js` | Saves and version-history the festival layout; applies it on startup. |
| `scripts/layout.mjs` | Manage the layout from the command line (`npm run layout`): show, export, import, history, restore, reset. |
| `client/world.js` | Builds the 3D grounds from `venue.js`: perimeter fence and main gate, stages, food trucks and picnic tables, Shakedown Street tents, campground, trees, lights. |
| `client/truck.js` + `shared/truck-data.js` | The food-truck model vendors design (body/awning/stripe/trim colors + a roof topper), built from simple shapes. |
| `client/camera.js` | Third-person camera with zoom (wheel, pinch, +/- keys or buttons); tilts toward top-down as you pull out. |
| `client/map.js` | Draws the 2D festival map, used by both the minimap and the full map. |
| `client/venue-ui.js` | Vendor cards (menu + where they'll be next), waypoints, the minimap, the full map with vendor directory, and fading stalls that block the camera. |
| `client/controls.js` | WASD/arrows + Shift to run on desktop; touch joystick on phones (push to the edge to run). |
| `client/multiplayer.js` | Connects to the server, predicts your movement, draws other players smoothly. |
| `client/character.js` | Loads a character model, gives each player a copy, and plays Idle / Walk / Run / Dance based on how fast they move. |
| `client/cast.js` | Loads characters on demand and swaps them in when ready. |
| `shared/characters.js` | **The cast list**: every pickable character, free or premium. |
| `shared/accessories.js` + `client/accessories.js` | Cosmetic accessories (hats, glasses, glow stick, wings): the list the server validates, and the 3D shapes worn on the character. |
| `server/entitlements.js` | Decides who may use premium looks (unlocked per account; see below). |
| `server/accounts.js` | Player accounts: sign-up, sign-in sessions, and saved progress (badges, last look, premium unlocks), stored in `data/`. |
| `Dockerfile`, `deploy/` | Hosting: the server in Docker, with automatic HTTPS (Caddy), plus helper scripts for accounts, vendor links and backups. |
| `scripts/loadtest.mjs` | Load test: hundreds of fake players, to measure how many one server can hold (`npm run loadtest`). |
| `scripts/account.mjs` | Look after accounts from the command line (`npm run account`): list, unlock looks, reset passwords, staff, mutes, bans, reports. |
| `server/moderation.js` | Player reports (with the reported player's recent chat) and the log of staff actions, saved in `data/moderation.json`. |
| `client/moderation-ui.js` | The Report sheet, and the staff buttons (mute, kick, ban) on the player card. |
| `client/reports-ui.js` + `reports-data.js` | The staff **Reports screen** (🛡️ button): open reports by player, chat evidence, history, and decide in one tap. |
| `client/assets/characters/` | Character models (`.glb`) and their fitted animations (`.anims.json`). **Samples for now** (see "Adding characters"). |
| `scripts/retarget.mjs` | Fits Mixamo animations onto a character and writes its `.anims.json`. |
| `desktop/` + `Install FestiVille app.bat` | **The desktop app** (Electron): the game in its own window with the server built in, plus the one-time installer that makes the desktop icon. |
| `client/manifest.json`, `client/assets/icon-*.png` | App name and icon, so the game can be installed from the browser or added to a phone's home screen. |
| `scripts/serve-client.js` | Tiny web server for the game page (nothing extra to install). |
| `test/sim.test.js` | Movement tests (walk speed, run speed, no speed hacks, can't leave the map). |
| `test/quests.test.js` | Crew and quest tests: invites, crew cap, all three quests, timers, failing, cleanup. |
| `test/bots.js` | Two fake players that sign in and walk in circles, to prove the network part works. |

## Run it on your computer (about 5 minutes)

You need Node.js 20 or newer (`node -v` to check; get it at nodejs.org).

```bash
cd festiville
npm install
npm test          # movement, quest, vendor, chat and account tests; should say 64 pass
npm start         # game server runs at ws://localhost:2567
```

Leave that running. In a **second** terminal, check the network part with two fake players:

```bash
npm run bots
```

You should see both bots' positions change every second, then `✅ Both bots see each other moving.` (The first run creates accounts **BotA** and **BotB** with random passwords saved in `data/bot-passwords.json`, so later runs sign back in.)

## The desktop app (easiest way to run it)

FestiVille can run as a normal Windows app: double-click the icon and the game opens in its own window, with the server running inside it. No terminal needed.

**Set it up once:** in the festiville folder, double-click **`Install FestiVille app.bat`**. It installs what's needed (about 100 MB the first time) and puts a **FestiVille** icon on your desktop and in the Start menu. Run it again any time to reinstall or remake the icons.

**Use it:** double-click **FestiVille**. Close the window to stop the server.

- **FestiVille menu → New window as another player** (Ctrl+Shift+N): a second window signed in separately, for testing with two accounts.
- **Festival builder**, **Open in my web browser**, **Play on a phone (same Wi-Fi)** (shows the address to type on your phone).
- **Server log:** what the server printed (also saved in `data/server.log`).
- **Restart server:** after code changes. (Or just close FestiVille and open it again.)
- **View → Developer tools** if something looks broken.

If a server is already running (`npm start` in a terminal), the app uses that one instead of starting its own; close the terminal server first if you want the app's. The first time, Windows may ask whether to allow "Electron" on networks: allowing private networks lets phones on your Wi-Fi join.

**If the app doesn't open:** in `desktop/`, double-click **Start FestiVille with log**. It closes any stuck copy of the app, starts it, and records what happens in `data/launch.log`. `data/app-start.log` lists each startup step of every launch, so you can see how far it got.

You can also start it from a terminal with `npm run app`. The app lives in `desktop/` and isn't part of the hosted server (Docker ignores it). Players on a hosted server don't need it: in Edge or Chrome they can use **Install FestiVille** from the address bar or menu, and on phones **Add to Home Screen**.

## Play it

With the server still running, open another terminal:

```bash
npm run client    # game page at http://localhost:5173
```

Open http://localhost:5173 in **two browser windows**, create a different account in each (any username and a password of 8+ characters), and walk around. Each window should show the other player moving. If you run `npm run bots` at the same time, you'll see the bots walking circles too.

**Controls:** WASD or arrows to walk, hold Shift to run, **Space** to jump, **E** to dance, **1-9** or the **Emote** button for the rest: dance, bounce, fist pump, clap, wave, cheer, point, thumbs up and sit (everyone sees them; walking away ends a dance or stands you up; you can jump while running). On phones, use the joystick; push it to the edge to run. The emote list is `shared/emotes.js`.

**Getting around:** scroll the mouse wheel, press **+ / -**, or pinch to zoom the camera (all the way out gives a bird's-eye view). The minimap in the top-right corner shows you (pink arrow), crewmates (blue), other players (white), quest givers (yellow) and quest objectives. Tap it, press **M**, or tap **Map** for the full festival map: drag to pan, scroll or pinch to zoom, and pick a vendor from the list or the map.

## Accounts and saved progress

You sign in (or create an account) on the join screen before entering. The server then remembers you between visits:

- **Badges** stick — earn one, restart the server, it's still yours.
- **Your last character** is picked for you next time.
- **Premium looks unlocked for you** stay unlocked (see "Free vs premium looks").
- Signing in on a second device takes over: the first window is told "You signed in somewhere else."

Passwords are 8+ characters; usernames are 3–16 letters, numbers or `_`. Accounts are saved in `data/accounts.json` (passwords only as salted scrypt hashes, never as-is) and sign-ins in `data/sessions.json` (hashed tokens, 30-day expiry). Back up `data/`, don't commit it. Wrong passwords and rapid sign-ups are rate-limited, and a sign-in stays good across browser refreshes on the same device.

**Look after accounts from a second terminal** (works while the server is running):

```bash
npm run account -- list                          # everyone, with badges and unlocks
npm run account -- unlock billy bigvegas         # give billy the Big Vegas look
npm run account -- reset-password billy newpass123   # also signs them out everywhere
npm run account -- sign-out billy                # end all their sign-ins
```

There's no "forgot password" email yet — `reset-password` is how you help someone locked out.

## Moderation

**Anyone can report.** Tap a player → **Report** → pick a reason (harassment, hate speech, sexual content, spam, cheating, something else), optionally say what happened, **Send report**. "Also mute them for me" is ticked by default. The server attaches that player's last 10 chat lines from its own records, so reports can't be faked. Staff who are online get a toast straight away. One player can send at most 5 reports per 10 minutes, and reporting the same person twice just counts once.

**Festival staff** get a **STAFF** tag over their head and extra buttons on the player card: **Mute 15 min**, **Mute 1 day**, **Kick**, **Ban 1 day**, **Ban 7 days**, **Ban forever**, plus a reason box (a banned player sees the reason). Kicks and bans need a second tap. The server checks you're staff before doing anything. Staff can't act on other staff; that's done from the command line.

- **Muted** players can still walk, dance and do quests; their chat just doesn't send, and they're told for how long.
- **Kicked** players are removed with a message and can rejoin.
- **Banned** players are removed, signed out everywhere, and can't sign in until the ban ends (they see how long, and why).

**The Reports screen (in the game).** Staff and organizers get a 🛡️ button above the 👕 button, with a red count of open reports (it updates live). Tap it to review everything in one place:

- Reports are grouped **by player**, newest first: who reported them, the reason, any note, and how long ago.
- **Their recent chat** (captured by the server, so it can't be faked), crew messages marked in blue.
- **History:** how many earlier reports about them were already handled, and what staff did before.
- **Online / Offline / Muted / Banned** tags, so you know where things stand.
- **Decide right there:** Dismiss (nothing to do), Mute 15 min / 1 day, Kick, Ban 1 day / 7 days / forever, with an optional reason. Kicks and bans need a second tap. Mutes and bans work even if the player is offline or in another copy of the festival; Kick needs them online.

Any decision closes all that player's open reports and is logged (dismissals too). Reports closed from the command line disappear from the screen within a few seconds.

**From the command line** (works while the server is running; bans reach players within 5 seconds):

```bash
npm run account -- make-admin sam          # make sam a festival organizer (staff tools + the festival builder)
npm run account -- make-mod sam            # make sam festival staff (mute/kick/ban only; remove-mod to undo)
npm run account -- reports                 # open reports, with the reported player's chat
npm run account -- close-report r_1a2b3c   # nothing to do about it
npm run account -- history troll           # every report about them and what staff did
npm run account -- mute troll 30           # minutes, or "forever"; unmute to lift
npm run account -- ban troll 7 spam links  # days, or "forever", then a reason; unban to lift
```

A mute, kick or ban closes the open reports about that player. Everything staff do is logged in `data/moderation.json` (who, what, when, why).

The personal **Mute** button still only hides someone for you, until you leave. To hide words for everyone, add them to `BLOCKED_WORDS` in `server/chat.js`.

## Chat

Press **Enter** (or tap 💬) to talk. Your message pops up in a speech bubble over your head and in the chat log at the top left.

- **Nearby** (the default): everyone within about 25 m hears you, like talking out loud at a festival.
- **Crew**: once you're in a crew, tap the **Nearby** button (or press **Tab** while typing) to switch to **Crew**. Only your crew hears it, wherever they are on the grounds. Crew messages have a blue edge.
- **Mute:** tap a player and choose **Mute** to hide their messages and bubbles for the rest of your visit.

The server decides who hears what and limits spam (about 5 messages per 10 seconds). To hide words, add them to `BLOCKED_WORDS` in `server/chat.js`; they show up as `****`.

## The festival builder

You can lay out the whole festival visually — move the stages, add vendor stalls, draw new areas, place characters, string up lights — instead of editing code. Open **`/client/builder.html`** (from the running game: http://localhost:2567/client/builder.html) and sign in as an organizer.

**Become an organizer** (from a second terminal, server running):

```bash
npm run account -- make-admin <your username>
```

In the builder:
- **Add** anything from the left palette — click it, then click the map to drop it (hold Shift to place several).
- **New vendors:** place a **Vendor stall**, then in its panel pick **➕ New vendor…** to type a stall name, a short id, a tagline, and a starting menu (dish + price rows). Existing vendors keep their own menus; a brand-new one starts with what you type here and can later edit it with their vendor link (`npm run vendor-link -- <id>`).
- **Move** by dragging; **select** by clicking to edit it on the right (turn, size, color, label, which vendor or character…); **Delete** or press Delete.
- **Preview** switches to a 3D walk-around of exactly what players will see. **Map** switches back.
- **Undo/redo** with the arrows or Ctrl+Z / Ctrl+Y.
- **Publish** saves it and asks everyone in the game to refresh into the new grounds. **Start over** goes back to the built-in festival (nothing is live until you publish).

Quest givers (Juniper, Dex, Mama Rae) can be moved but not removed, since their quests need them. Lost & Found uses the **totem hiding spots** you place (at least 3), and Vendor Rush delivers to **camping tents marked "takes orders"** (at least 3); until you add enough, the usual ones are used. Each vendor and each character can be placed once.

Every publish keeps the previous version, so a bad edit is easy to undo:

```bash
npm run layout -- history            # list saved versions
npm run layout -- restore <file>     # put one back
npm run layout -- reset              # back to the built-in festival
npm run layout -- export mine.json   # save a copy / import mine.json to load one
```

The layout is saved in `data/layout.json`. Vendors still edit their own **listings** (menus, prices, upcoming stops) separately — see below.

## Food Court and Shakedown Street

- **Food Court** (west side): eight food trucks and picnic tables, including Hippie Dips and Mama Rae's Tacos.
- **Shakedown Street** (north-east): twelve pop-up tents selling tie-dye, pins, crystals, grilled cheese and more.

Tap any stall, or walk up to it and press **T** / tap **Browse**, to see its menu (or what it sells) and **where they'll be next**. **Take me there** drops a waypoint: a white light in the world and a marker on the minimap (an arrow on its rim when it's out of range). Arriving opens that vendor's card.

Where stalls stand comes from the layout (the festival builder, above). Each stall's **starting** listing (placeholders, apart from Hippie Dips) lives in `shared/venue.js`; vendors then keep their own listing up to date, as below.

## Vendors edit their own listings

Each stall has a private edit link. The vendor opens it on their phone and changes their stall name, description, website, menu with prices, and upcoming stops with dates. There's a live preview of the card players will see. Food vendors also get a **food truck designer** — pick body, awning, stripe and trim colors and a roof topper (hot dog, taco, ice cream, star…), with a live 3D preview; the truck updates in the game the moment they save. When they tap **Save**, every player in the game sees the change straight away, including the stall's sign. Past stops hide themselves.

**Make a link** (with the game server running, in a second window):

```bash
npm run vendor-link -- --list          # every stall id
npm run vendor-link -- hippiedips      # prints Hippie Dips' private edit link
```

Send the link to the vendor privately: anyone who has it can edit that stall. Running the command again makes a new link and the old one stops working. `--revoke` cancels a link without making a new one. Once the game is hosted, add `--base https://your-site` so the link points at the real address.

**Admin key (optional):** start the server with `FV_ADMIN_KEY` set to a long secret (12+ characters). That key can edit any stall, which is handy for fixing a listing yourself.

**Where edits are saved:** `data/vendors.json` (listings) and `data/vendor-keys.json` (a scrambled hash of each key, never the key itself). Back up the `data` folder, and don't share it or commit it. Saves are checked on the server (lengths, prices, real dates, safe website links) and rate-limited, and repeated wrong keys get locked out for a minute.

The grounds are fenced in (players stop just inside the fence); the main gate is on the south side past the campground.

## Crews and side quests

- **Crews:** click or tap another player, then **Invite to crew** (up to 4). Crewmates get a blue ring under them and share quest progress. **Leave crew** is in the crew panel.
- **Quest givers** have a yellow **!** over their heads (it disappears once you've earned their badge). Walk up and tap **Talk** (or press **T**).
- **Objectives** glow: tall light columns show where to go, and the tracker says how far away they are.
- **Badges** show under your name tag for everyone to see.

| Quest | Giver | Crew | What you do |
|---|---|---|---|
| Lost & Found | Juniper, near the middle | Solo or crew | Find 3 totem pieces hidden around the grounds (different spots each time), bring them back. Anyone in the crew can grab pieces. |
| Soundcheck | Dex, by the main stage | **Crew of 2+ only** | One person on the main stage marker and another on the side stage marker at the same time for 3 seconds. |
| Vendor Rush | Mama Rae, vendor row | Solo or crew | Carry taco orders from the stand to campground tents before time runs out (2:30). Bigger crews get more orders but can split the running. |

**Adding a quest:** add its giver and text in `shared/quests-data.js`, its rules in `server/quests.js` (a `tick…` function like the others), and what to draw in `client/quests-ui.js`. Add a test in `test/quests.test.js` so you know it works without playing through it.

**On your phone (same Wi-Fi):** find your computer's local IP address (for example `192.168.1.20`) and open `http://192.168.1.20:5173`. The page connects to the server at that same address automatically. Your computer's firewall may ask you to allow Node.

The page loads Three.js and the Colyseus client from the jsDelivr CDN, so the browser needs internet. If Colyseus ever fails to load from jsDelivr, change its line in the `importmap` in `client/index.html` to `https://esm.sh/colyseus.js@0.16`.

The game server also serves the page itself at http://localhost:2567, so `npm run client` is optional. Once hosted, just open your domain. To point a local page at a hosted server instead: `http://localhost:5173/?server=wss://your-server.com`.

## Adding characters

Players have two ways to look:

- **Build your own** (parts-based): pick a body (female or male), a skin tone, and for each slot (hair, eyebrows, top, bottom, shoes) a part and its color, or hit 🎲 Randomize. Built from MakeHuman (MPFB) CC0 art. This is where new looks should go.
- **Classic**: one of nine whole Mixamo characters (◀ ▶). Michelle, Remy, Sophie, Bryce, Kate and Jody are free; Big Vegas, Jackie and Adam are premium. They're listed in `shared/characters.js` (a `.glb` plus a `.anims.json` each, in `client/assets/characters/`).

Both are on the join screen and in the in-game 👕 panel, with a live 3D preview. Everyone sees what each player chose.

### Parts-based characters (the generator)

The catalog is `shared/parts.js`: the two bodies, the skin tone palette, the slots, every part (which bodies it fits, free or premium, its file), and the color palettes. There are 12 hairstyles, 3 eyebrow styles, 8 tops, 7 bottoms and 10 pairs of shoes. Every part is rigged to **one shared skeleton** with Mixamo bone names (`mixamorigHips`, `mixamorigHead`, …), so one animation set per body fits every combination.

A player's look is stored as a short **recipe** string: body, skin tone, then `slot=part:color` for each filled slot (colors are palette numbers):

```
female;3;hair=hair_bob:4;eyebrows=brows_soft:1;top=top_tank:2;bottom=bottom_shorts:8;shoes=shoes_sneakers:0
```

The server cleans every recipe (`normalizeRecipe()`), swaps premium parts the account hasn't unlocked for the free default, saves it as the player's default, and syncs it to everyone. A player has either a recipe or a classic look; the classic look is kept too, as a fallback (see below). Quest givers and NPCs can wear a recipe: set `recipe` next to `look` in `shared/quests-data.js` (`randomRecipe(seededRandom("their-id"))` gives a random one that's the same on every screen).

#### The part files

The bodies and parts are made from MakeHuman's free **CC0** assets by `scripts/make-parts.py` (Blender + the MPFB extension; credits in `client/assets/parts/CREDITS.md`):

```
client/assets/parts/manifest.json         every exported file, plus each clothing part's slot and hide bit
client/assets/parts/female/body.glb       base body (skin, eyes, eyelashes) + mixamorig* skeleton + hide masks
client/assets/parts/female/<file>.glb     one per part (the part's `file` in shared/parts.js)
client/assets/parts/female/anims.json     the body's animations: Idle, Walk, Run, Dance and the emotes
client/assets/parts/female/skins/*.webp   extra skin textures
client/assets/parts/male/…                the same for the male body
```

- **Bones:** every file uses the same `mixamorig*` bone names and rest pose as that body's `body.glb`. The game takes each part's skinned meshes and rebinds them to the player's body bones by name.
- **Scale:** meters. The two bodies keep their real heights (1.59 m and 1.73 m).
- **Colors:** hair and eyebrows are exported light grey and take the hair color swatches. Clothes keep their own printed colors and patterns (`tint: false` in `shared/parts.js`, so the builder shows no swatches for them). The skin tone tints the body.
- **Skin under clothes:** `body.glb` stores a mask per clothing slot (top, bottom, shoes) saying which skin each part covers, so the game hides that skin while it's worn and nothing pokes through.
- **Animations:** each body gets the classic characters' Idle/Walk/Run/Dance plus the emotes (CC0 clips from Quaternius' Universal Animation Library and KayKit Character Animations, and a few made in the script), all re-fitted to its skeleton by one command:
  ```bash
  npm run parts-anims
  ```
  It downloads the CC0 packs once into `.cache/` (not committed) and rewrites both `anims.json` files; the list of clips is at the top of `scripts/parts-anims.mjs`. After re-running `make-parts.py`, run it again. To add an emote: add its clip there, then a line to `shared/emotes.js`.

#### Adding a part

1. Install [Blender](https://www.blender.org/download/), then the **MPFB** extension, and load MakeHuman CC0 asset packs into MPFB (see "Making a realistic character with MakeHuman" below).
2. Add the asset's folder name to the right slot in `PARTS` at the top of `scripts/make-parts.py`, and run it:
   ```bash
   blender -b --python scripts/make-parts.py -- client/assets/parts
   ```
   (`--only top=<name>` exports just one part, for testing.) Then re-fit the animations as above.
3. Add a line to `PARTS` in `shared/parts.js`, e.g. `{ id: "top_mesh", name: "Mesh top", slot: "top", bodies: ["female", "male"], tier: "free", file: "<name>", tint: false }`. Ids are lowercase (`a-z 0-9 _ -`, up to 32 characters) and unique across parts, characters and accessories; `file` can be longer.
4. Restart the server (it prints the part list at startup) and refresh. Palettes are append-only: recipes store color numbers, so reordering a palette recolors everyone.

#### Before the art arrives (and when a file is missing)

The code works without any part files. If a body's `body.glb` is missing, players who built a character appear as their **classic** character instead (the builder says so), and everything else carries on. A missing part file is skipped with a console warning. Downloads are cached and shared: each file is fetched once, and everyone wearing a part shares its mesh and textures.

### Free vs premium looks

Each character has `tier: "free"` or `tier: "premium"` in `shared/characters.js`. Premium is cosmetic only: everyone can walk around, hang out, crew up and do quests no matter what they look like.

- The picker shows premium looks with a lock note. Players can preview them, but the **server** decides who actually gets one (`server/entitlements.js`), so it can't be unlocked by tinkering in the browser.
- Premium looks, accessories and character parts are unlocked **per account**: `npm run account -- unlock <username> <id>` (e.g. `bigvegas`, `wings`, `hair_afro`) (there are no payments yet, so this is how you grant one; a payment would later call the same thing). To unlock everything while testing, start the server with `FV_UNLOCK_ALL=1 npm start` (Windows: `set FV_UNLOCK_ALL=1 && npm start`).
- When payments come, `server/entitlements.js` is the one place to check a player's purchases (`canUseLook()`, `canUseAccessory()`, `canUsePart()`).

### Accessories

Players can top any character with cosmetic accessories on the join screen — tap the chips under **Accessories**. They animate with the character and everyone sees them. One per slot (head, face, back, hand); picking a second in a slot swaps it.

- **Free:** baseball cap, flower crown, sunglasses, glow stick.
- **Premium:** top hat, halo, heart glasses, fairy wings — unlocked per account, the same way as premium characters:
  ```bash
  npm run account -- unlock <username> wings      # also: tophat, halo, heartglasses
  ```
- **Change your look mid-game:** tap the 👕 button (next to 💬) to swap character (classic or built) and accessories without leaving the festival, with a live preview. Everyone sees the change live. The client sends an `appearance` message (`{ look, recipe, accessories }`); the server re-checks what the account may use, updates the room, and saves it as the player's new default.
- Accessories are cosmetic only and never affect gameplay. To add your own, add an entry to `shared/accessories.js` and its shape to `client/accessories.js`.

### Making a classic character with MakeHuman (free)

MakeHuman characters are free to use in games, including commercial ones (its built-in skins, hair and clothes are CC0; check the license on any community add-ons).

1. Install [Blender](https://www.blender.org/download/) (free).
2. In Blender: **Edit → Preferences → Get Extensions**, search **MPFB** (the MakeHuman plugin), install it. In its **Apply Assets** panel, follow the link to download the **system assets pack** (skins, hair, clothes) and load it.
3. Open the MPFB tab (press **N** in the 3D view) → **New human**. Use the **Model** sliders for body, age, height, face, then **Apply Assets** for skin, eyebrows, hair, and clothes (festival outfits: tank tops, shorts, boots, hats).
4. Export for rigging: **File → Export → FBX**.
5. Go to [mixamo.com](https://www.mixamo.com) (free Adobe account) → **Upload Character** → place the markers (chin, wrists, elbows, knees, groin) → Mixamo adds a skeleton. Download it as **FBX Binary, T-pose**.
6. While your character is selected in Mixamo, download **Idle**, **Walking** and **Running** (check **In Place**), plus a dance, as **FBX Binary, Without Skin**.
7. Convert each FBX to GLB in Blender: **File → Import → FBX**, then **File → Export → glTF 2.0**, format **glTF Binary (.glb)**. Include textures for the character.

(Mixamo's own ready-made characters skip steps 1–5: pick one on the Characters tab and start at step 6. Any human model you buy or download, from Sketchfab for example, also works from step 5.)

### Putting a classic character in the game

1. Put the model at `client/assets/characters/sam.glb` (use a short id, like `sam`).
2. Fit the animations to it:
   ```bash
   npm run retarget -- client/assets/characters/sam.glb Idle=idle.glb Walk=walking.glb Run=running.glb Dance=dance.glb
   ```
   It prints how many bones matched for each animation (should be all or nearly all) and saves `sam.anims.json` next to the model.
3. Add a line to `shared/characters.js`:
   ```js
   { id: "sam", name: "Sam", model: "characters/sam.glb", tier: "free" },
   ```
4. Refresh the game. Sam is in the picker.

Quest givers can wear any character too: set `look` on each giver in `shared/quests-data.js`.

**Performance:** each character is only downloaded when someone picks it or is standing near you in it, and everyone using the same character shares one copy. A few dozen realistic players is fine even on phones; for big crowds, the plan is lower-detail versions far from the camera (Milestone 3).

## How it works (the short version)

- The browser never tells the server where the player is, only which way the keys or joystick are pushed. The server moves everyone, which makes teleport and speed cheats impossible.
- Your own character moves instantly (prediction) and gets nudged if the server disagrees.
- Other players are smoothed between server updates so they don't jitter.
- `WORLD_HALF_SIZE` in `shared/sim.js` sets the map size (currently 200 × 200 meters); `WALK_LIMIT` keeps players inside the fence. Walking is 3 m/s and running 6.5 m/s.
- Quest rules run only on the server using the server's own positions, so nobody can fake finding an item or standing on a marker.
- Animations aren't sent over the network. Each browser works out Idle / Walk / Run from how fast a player is moving, so it costs no extra bandwidth. Only the emote is synced (`emote` and `emoteSeq` in `server/schema.js`; see `shared/emotes.js`).

## Next

- **Forgot-password emails:** for now, resets are done by hand with `npm run account -- reset-password`.
- **More quests,** including ones that unlock cosmetics (glow outfits, new dances).
- **Vendor photos and specials:** a stall photo and a "today's special" banner on the vendor card.
- **Scaling (Milestone 3):** split the grounds into zones so thousands can be online, with lower-detail characters far away.

## Hosting (when you want friends to join from anywhere)

The game server serves everything — the game page, sign-in, the vendor edit page and the multiplayer traffic — on one port, so hosting it is one program plus its `data` folder. The `deploy/` folder sets it up with **Docker** and **automatic HTTPS** (Caddy + a free Let's Encrypt certificate) on any Linux server.

### What it costs

| Players at once | Setup | Roughly |
|---|---|---|
| up to a few hundred | 1 server, 2 GB RAM (Hetzner CX22, DigitalOcean $12 droplet) | $5–12 / month |
| ~1,000 | bigger server or 2–3 servers, plus Postgres + Redis (see "Growing to 1,000+") | $40–80 / month |

Plus a domain name (~$12/year) if you want `play.yourfestival.com` instead of an IP address. New accounts at DigitalOcean, Google Cloud and others often come with free credit.

### Put it online (about 20 minutes)

1. **Make a server.** At your host, create an Ubuntu 24.04 server (2 GB RAM is plenty to start). Pick the region closest to most players (e.g. US East).
2. **Point a domain at it.** In your domain's DNS settings, add an **A record** like `play` → the server's IP address.
3. **Install Docker on it.** Log in (`ssh root@<server IP>`) and run: `curl -fsSL https://get.docker.com | sh`
4. **Copy the game there.** From your PC, in the folder above festiville: `scp -r festiville root@<server IP>:/opt/` (or upload it with WinSCP, or push it to GitHub and `git clone`). Don't copy `node_modules`.
5. **Start it:**
   ```bash
   cd /opt/festiville
   echo DOMAIN=play.yourfestival.com > deploy/.env
   docker compose -f deploy/docker-compose.yml up -d --build
   ```
6. **Open `https://play.yourfestival.com`.** The first load can take a minute while the HTTPS certificate is issued.

**Running things on the hosted server** (from `/opt/festiville`):

```bash
./deploy/account.sh make-mod <you>                       # any `npm run account` command
./deploy/vendor-link.sh hippiedips --base https://play.yourfestival.com
# the festival builder is at https://play.yourfestival.com/client/builder.html (sign in as an organizer)
./deploy/backup.sh                                       # saves accounts/vendors/reports to a .tar.gz
docker compose -f deploy/docker-compose.yml logs -f festiville    # watch the server log
```

**Updating:** copy the new files over, then run the `up -d --build` line again. Players' data lives in a Docker volume and isn't touched. **Back up** with `backup.sh` regularly and keep the copies somewhere else.

**Health check:** `https://your-domain/api/health` shows players online, rooms, memory, and how long game ticks take. Once a minute the server log also prints a `[stats]` line while people are playing.

### How many players can one server hold? Measure it

```bash
FV_SIGNUPS_PER_HOUR=100000 npm start          # on the server you're testing (Windows: set FV_SIGNUPS_PER_HOUR=100000 && npm start)
npm run loadtest -- 200                       # from another terminal: 200 fake players, 2 minutes
npm run loadtest -- 500 wss://play.yourfestival.com    # against the hosted server
```

Fake players (`lt_0001`, `lt_0002`, …) join, walk around and chat. Every 5 seconds it prints the response time (key press → server confirms the move; under 150 ms feels fine), updates per second (should stay near 20), and the server's tick time (fine under ~25 ms of its 50 ms budget). At the end it says whether the server coped. Past ~300 fake players, run the load test from a second computer so your own machine isn't the bottleneck. For the hosted test, `deploy/setup-server.sh` already raises the sign-up limit; afterwards set `FV_SIGNUPS_PER_HOUR=` (empty) in `deploy/.env` and run the `up -d` line again to go back to the default.

### Growing to 1,000+ players at once

Today each festival room holds 100 players (`FV_ROOM_SIZE`), and more rooms open as it fills, like separate copies of the festival. One Node process runs them all on a single CPU core. The load test tells you where that tops out. The path from there:

1. **Bigger rooms that stay smooth — zones.** Split the grounds into areas and only send each player what's near them. Then a copy of the festival can hold far more than 100 players, and crowds don't cost bandwidth for people across the field.
2. **Several game processes — Redis.** Colyseus can spread rooms over several processes or servers that share a Redis. That uses every CPU core and lets you add servers.
3. **A real database — Postgres.** With more than one process, accounts, vendors and reports can't live in JSON files anymore. They move to Postgres; the rest of the code keeps calling the same store methods.

Managed Postgres and Redis are about $15 each per month at DigitalOcean. Do the load test first: if one server already handles your expected crowd, you don't need any of this yet.

### Settings

Set these as environment variables (in `deploy/docker-compose.yml` under `environment:` when hosted):

| Setting | What it does |
|---|---|
| `PORT` | Port to listen on (default 2567). |
| `FV_DATA_DIR` | Where accounts, vendors and reports are saved (default `./data`). |
| `FV_TRUST_PROXY=1` | Behind an HTTPS proxy: use players' real IPs for rate limits (already on in `deploy/`). Only when the proxy is the only way in. |
| `FV_ROOM_SIZE` | Players per festival room (default 100). |
| `FV_SIGNUPS_PER_HOUR` | New accounts per IP per hour (default 10). |
| `FV_ADMIN_KEY` | Optional key that can edit any vendor stall. |
| `FV_UNLOCK_ALL=1` | Testing only: every premium look unlocked for everyone. |

**HTTPS matters:** players' passwords go to `/api/login` and `/api/signup`, so a public server must use HTTPS. The `deploy/` setup does that for you. Plain `http://localhost` is fine at home.
