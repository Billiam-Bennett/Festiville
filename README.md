# FestiVille — Multiplayer Prototype

A virtual festival you can walk around with other people in real time, dance, form crews, and take on side quests solo or together. Hanging out is always free: quests are optional and give badges, never access.

This is the start of the real game: a 3D festival you can walk around in the browser, plus the server that keeps everyone in sync. There's no earlier Base44 game to connect to, so this client *is* the game.

## What's here

| File | What it does |
|---|---|
| `shared/sim.js` | Movement rules: speed, the edge of the grounds, input cleanup, and **collision** (you can't walk through stages, stalls, tents, trees, the river or camps; players gently push apart). Used by BOTH server and browser. |
| `server/schema.js` | The state every player sees: name, position, facing, emote. |
| `server/FestivalRoom.js` | The festival room: 20 ticks/sec, server owns all positions (players per room: `FV_ROOM_SIZE`, see Scaling). |
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
| `client/world.js` | Builds the 3D grounds from `venue.js`: fence and main gate, stages with their genre signs, food trucks, Shakedown Street, paths, the river and bridges, forests, the Ferris wheel, art, shuttle stops, lights. |
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
| `scripts/tickbench.mjs` | What one game tick costs for 100–2,000 players, without networking (`npm run tickbench`). |
| `shared/dj.js` + `server/dj.js` + `client/dj-ui.js` | **Stage music**: DJ profiles, linked mixes on each stage, the open rules (who can DJ, order, set length), the record of who linked what, and in the browser the music fading with distance, mute and volume, and the 🎧 panel. |
| `shared/rides.js` + `server/rides.js` + `client/rides-ui.js` | **Rides**: the Ferris wheel, the golf cart, and the shuttle between sections. |
| `scripts/account.mjs` | Look after accounts from the command line (`npm run account`): list, unlock looks, reset passwords, staff, mutes, bans, reports. |
| `server/moderation.js` | Player reports (with the reported player's recent chat) and the log of staff actions, saved in `data/moderation.json`. |
| `client/moderation-ui.js` | The Report sheet, and the staff buttons (mute, kick, ban) on the player card. |
| `client/reports-ui.js` + `reports-data.js` | The staff **Reports screen** (🛡️ button): open reports by player, chat evidence, history, and decide in one tap. |
| `client/assets/characters/` | Character models (`.glb`) and their fitted animations (`.anims.json`). **Samples for now** (see "Adding characters"). |
| `scripts/retarget.mjs` | Fits Mixamo animations onto a character and writes its `.anims.json`. |
| `desktop/` + `Install FestiVille app.bat` | **The desktop app** (Electron): the game in its own window with the server built in, plus the one-time installer that makes the desktop icon. |
| `client/manifest.json`, `client/assets/icon-*.png` | App name and icon, so the game can be installed from the browser or added to a phone's home screen. |
| `scripts/serve-client.js` | Tiny web server for the game page (nothing extra to install). |
| `test/sim.test.js` | Movement and collision tests (speeds, no speed hacks, can't leave the grounds, stages stop you, sliding around, the river and bridges, players can't stand in each other, every quest spot still reachable). |
| `test/dj.test.js`, `test/rides.test.js` | Stage music rules and moderation; the Ferris wheel, golf cart and shuttle. |
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

**The bigger grounds:** the festival is four sections (see "The grounds" below), so there are faster ways around than running: **🚌 shuttle stops** in every section (walk up to one and pick where to go; free, but not while you're on a timed quest), the **🎡 Ferris wheel** (free; walk up and tap **Ride**, then look around with WASD or the joystick while you go round), and the **🛺 golf cart** for premium members. You can't walk through stages, stalls, tents, trees, other people's camps or the river: go round, or over a bridge.

**Stage music:** walk up to a stage while a DJ set is on and you'll hear it, loud up front and fading as you walk away. The **🔊** button at the top mutes it any time; the "now playing" card has a volume slider and a link to the DJ's page. **🎧** shows what's on every stage and is where DJs sign up.

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
- **Add** anything from the left palette — click it, then click the map to drop it (hold Shift to place several). Besides stages, stalls and areas there are **paths**, **rivers / lakes** (players can't walk into water), **bridges** (the way across), **forests** (one piece = a whole wood of solid tree trunks, kept clear of paths), the **Ferris wheel**, **art / service tents**, and **shuttle stops**.
- **Stages have a genre** (EDM, Rap / R&B, Rock / Alternative, Bluegrass & more, or open). Pick it in the stage's panel; DJs' mixes have to match it.
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

## The grounds: four sections

The grounds are about **400 × 400 m** (the fence is at ±199 m; it was ±99 m). That size is one number, `FENCE` in `shared/layout.js`: the walkable limit in `shared/sim.js`, the gate, the spawn point, the ground, the maps and the builder all follow it.

| Section | Where | What's there |
|---|---|---|
| **Main Field** | middle, north of the river | Main Stage (EDM), the path loop, the Food Court, the Ferris wheel, Info & First Aid |
| **East Side** | east, through the forest | East Stage (Rap / R&B), Shakedown Street, the Art Field |
| **The Grove** | west, through the forest | Garage Stage (Rock / Alternative), Back Porch Stage (Bluegrass & more), picnic tables |
| **Campground** | south of the river, by the gate | two big camping fields (West and East) with room for thousands of free 10×10 camps |

The three festival sections sit side by side with a belt of forest between them; **forest paths with string lights** go through the trees. The **Festival River** runs between them and the Campground, with a **river walk** along the bank and **three bridges** (the main one from the gate lane, two footbridges). You come in through the gate, walk up the lane between the two camping fields, and cross the main bridge.

**Nothing about the sections is locked in.** Their names, colors, which stage plays which genre, and what's in each are all layout data: rename or refill them in the festival builder. The layout is still capped at 24 hanging lamps (each is a real light), and a forest is drawn as two instanced meshes however many trees it has, so the bigger map stays phone-friendly.

A layout saved for the old small grounds is set aside (in `data/layout-history/`) the first time the new server starts, and the new four-section layout is used instead.

## Food Court and Shakedown Street

- **Food Court** (Main Field, just north of the main bridge): eight food trucks and picnic tables, including Hippie Dips and Mama Rae's Tacos.
- **Shakedown Street** (East Side): twelve pop-up tents selling tie-dye, pins, crystals, grilled cheese and more.

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

The grounds are fenced in (players stop just inside the fence); the main gate is on the south side, at the Entrance Plaza between the two camping fields.

## Crews and side quests

- **Crews:** click or tap another player, then **Invite to crew** (up to 4). Crewmates get a blue ring under them and share quest progress. **Leave crew** is in the crew panel.
- **Quest givers** have a yellow **!** over their heads (it disappears once you've earned their badge). Walk up and tap **Talk** (or press **T**).
- **Objectives** glow: tall light columns show where to go, and the tracker says how far away they are.
- **Badges** show under your name tag for everyone to see.

| Quest | Giver | Crew | What you do |
|---|---|---|---|
| Lost & Found | Juniper, near the middle | Solo or crew | Find 3 totem pieces hidden around the grounds (different spots each time), bring them back. Anyone in the crew can grab pieces. |
| Soundcheck | Dex, by the main stage | **Crew of 2+ only** | One person on the Main Stage marker and another on the East Stage marker (through the forest path) at the same time for 3 seconds. 4:00 to do it. |
| Vendor Rush | Mama Rae, Food Court | Solo or crew | Carry taco orders from the stand, over the bridge, to Campground tents before time runs out (4:00, up from 2:30 because the Campground is further now). Bigger crews get more orders but can split the running. |
| Get Weird Run | Sunny, by the gate | Solo or crew | **Sponsored by Hippie Dips.** Go to the Hippie Dips stall, talk to them, and hold the blender lid at the counter. 3:00. |

Every quest spot is checked against collision in the tests (`test/sim.test.js`): quest givers, the Soundcheck markers, totem hiding spots, the Vendor Rush tents and the fronts of the stalls can all be reached, and the Vendor Rush run fits in its time limit.

### Business (sponsored) quests

A business can sponsor a side quest. Vendor Rush is the model: a real vendor, a real stall, a real task, a time limit. A business quest is a normal quest (giver, dialogue, task, timer, reward) plus a **sponsor**: their name, their stall, and one line from them. The quest ends at their stall: walk there, talk to the vendor, and do the task at the counter. The sponsor shows as **"Sponsored by …"** in the quest dialog and the tracker. It's part of the quest, never a pop-up ad.

The example is **Get Weird Run**, sponsored by Hippie Dips. To add another, copy its entry in `shared/quests-data.js` (the template's fields are explained right there). It needs a giver in `GIVERS` (and a spot for them in the layout) and a reward in `QUEST_REWARDS`. It needs **no new code**. The same anti-farm rules apply: the full reward the first time, less on repeats, and repeats stop paying after 300 credits a day.

**There's no self-serve dashboard for businesses.** A business asks Billiam, and an organizer writes the quest.

**Adding a quest:** add its giver and text in `shared/quests-data.js`, its rules in `server/quests.js` (a `tick…` function like the others), and what to draw in `client/quests-ui.js`. Add a test in `test/quests.test.js` so you know it works without playing through it.

**On your phone (same Wi-Fi):** find your computer's local IP address (for example `192.168.1.20`) and open `http://192.168.1.20:5173`. The page connects to the server at that same address automatically. Your computer's firewall may ask you to allow Node.

The page loads Three.js and the Colyseus client from the jsDelivr CDN, so the browser needs internet. If Colyseus ever fails to load from jsDelivr, change its line in the `importmap` in `client/index.html` to `https://esm.sh/colyseus.js@0.16`.

The game server also serves the page itself at http://localhost:2567, so `npm run client` is optional. Once hosted, just open your domain. To point a local page at a hosted server instead: `http://localhost:5173/?server=wss://your-server.com`.

## Stages, genres and DJ music

DJs play their music on the stages **for free, for exposure**. Nobody is paid. A stage in FestiVille is how new DJs get heard, and the DJ's name links to their own page so the exposure lands somewhere.

- **Every stage has a genre**, set in the festival builder: EDM, Rap / R&B, Rock / Alternative, Bluegrass & more, or an open stage. It shows on the stage's sign and on the map. A DJ picks the genre of their mix, and it has to match the stage: a rap mix is refused on the EDM stage, with a suggestion of where it fits. (The game can't hear what's in a mix, so the genre is the DJ's word. Staff can stop a set that's on the wrong stage.)
- **Link, don't upload.** A DJ links a mix that's already on **SoundCloud, Mixcloud or YouTube** and the game plays that stream. No audio is ever stored on the FestiVille server; only the link is.
- **Music fades with distance:** loud at the stage, quiet across the field, silent in the Campground. Only the loudest stage you're near plays, so it's one stream at a time. Everyone hears the same moment of the set. SoundCloud and YouTube fade smoothly. Mixcloud's player has no volume control, so a Mixcloud set plays when you're near the stage and stops when you walk away.
- **Mute and volume, always:** 🔊 at the top of the screen mutes all stage music; the "now playing" card has a volume slider. Both are remembered on that device.
- **DJ profile:** a DJ name and a link to their own page. **🎧 → Play your music here** to sign up. The signup says it plainly, and the DJ has to tick it: **only your own music or your own mixes.**
- **Moderation and takedowns:** staff can **stop a set** (from the now-playing card or 🎧) and **remove a DJ** (all their sets stop and they can't link again until restored). **Every signup, link, stop and removal is on record**: who, when, and which link. It's kept in `data/dj.json` and shown to staff in 🎧. It works like player reports (`server/moderation.js`).

**Decisions that aren't made yet are settings, not code.** Who can DJ, who picks the order and how long a set is all live in `data/dj.json`. They can be changed while the server runs:

```bash
npm run account -- dj-rules                                 # show them
npm run account -- dj-rules signup=open order=schedule set=45
#   signup=approved   only DJs staff approve can link a mix (what a fresh server starts with)
#   signup=open       any member who signs up as a DJ
#   order=first-come  a mix goes on now, or queues behind what's playing (fresh server)
#   order=schedule    DJs pick a free start time
#   order=organizer   mixes wait until staff put them on
#   set=60            minutes per set (0 = until the DJ or staff end it)
npm run account -- dj-list                    # every DJ, and what's on each stage
npm run account -- dj-approve <username>
npm run account -- dj-remove <username> [reason]   # dj-restore <username> undoes it
npm run account -- dj-stop stage_main [reason]
npm run account -- dj-log [username]          # the record
```

A stage's DJ, mix link and times are data too (DJ slots in `data/dj.json`). Nothing about who plays where is hard-coded.

## Rides

- **🎡 Ferris wheel** (Main Field, by the Food Court). **Free**, like everything else about hanging out. Walk up, tap **Ride**, and you're in the gondola at the bottom (12 gondolas, 4 seats each). It goes round slowly (2½ minutes a turn) up to about 33 m, above everything else on the grounds. While you're up there the camera shows you the whole festival; look around with WASD, the arrows or the joystick. You can't walk, dance or start a quest while you're on it. You're set down at the bottom after one turn, or you can step off early whenever your gondola is near the ground. Everyone sees the wheel turning and who's in each gondola, because it turns on the room's clock.
- **🛺 Golf cart**. A premium status item, and the quick way around the bigger grounds. It's faster than running (11 m/s against 6.5), and everyone sees who's riding in one (gold trim). It's parked at your camp. Tap 🛺 to drive it anywhere; tap again to park it and it goes back to your camp. A cart is bigger than a person and can't go through things either. **Who gets one** is the `GOLF_CART` switch in `shared/economy.js`. **What's on now: it comes with premium membership.** Set `price` to a number of credits to also sell it in the shop to anyone. No passenger seat in this version.
- **🚌 Shuttle**. Stops in every section. Walk up to one, pick another stop, and you're there. It's free, but it doesn't run while your crew is on a timed quest (otherwise Vendor Rush would be one tap), or while you're in a golf cart.

## Credits and the shop

FestiVille has its own currency, **credits** (🪙). Every new player starts with **500**. Tap the 🪙 button in the game to open the **Shop**.

**Earning credits:** side quests pay credits as well as badges. You get the full reward the first time and a smaller one for repeats. Repeats stop paying after 300 credits a day, so quests can't be farmed.

| Quest | First time | Repeats |
|---|---|---|
| Lost & Found | 150 | 40 |
| Soundcheck | 250 | 70 |
| Vendor Rush | 200 | 60 |
| Get Weird Run (sponsored) | 180 | 50 |

**Spending credits:**

- **⛺ Camp.** **Every member, free or paid, gets one free 10×10 camp spot**, like camping at a real festival. Walk to where you want it in the Campground and claim it: a green outline shows it fits, and a red one comes with the reason it doesn't. One camp per account: **Move camp here** moves it for free, and **Give back spot** frees it (claim a free one again any time).
  - **10×20** is a credit upgrade (450 credits) for anyone.
  - **20×20 is for premium members** and isn't sold for credits. It comes with the **premium bundle**, the "you can find my camp in the dark" set: an **LED tent** (glows at night; pick its colour), the **neon name sign**, **string lights** and the **camp flag**. Non-members can still buy the sign, lights and flag for credits.
  - **Build it out as much as you like** with credits, bought or earned in quests. Then **Set up** or **Pack away** each thing:

    | | Things for your camp (credits) |
    |---|---|
    | Shelter | dome tent (free), bell tent 300, LED tent (premium), shade canopy 180, tent tapestry with your name 120, tent-top flag 60 |
    | Hanging out | camp chairs 60, cooler 40, fire pit 150, hammock 150, inflatable couch 140, picnic table 120, ground rug 50, cooking grate (on the fire pit) 40 |
    | Light and show | PA system 600 ★, string lights 80, camp flag 100, neon name sign 500 ★, laser rig 900 ★, disco ball 700 ★, fireworks launcher 800 ★, lit totem pole 450, lanterns on posts 120, glow stick border 40 |
    | Food and drink | grill and camp kitchen 250, mini taco stand (a little Mama Rae's) 500 ★, lemonade stand 200, campfire cooking pot (over the fire pit) 60 |
    | Social and fun | outdoor movie screen 700 ★, hot tub 850 ★, photo booth frame 300, camp signpost 80, flower garden 90, a camp dog 400 |

    Ground items need space in your spot, so bigger spots hold more. Edge items go around it. The tapestry and tent flag go on your tent, and the grate or pot go over your fire pit (one at a time), so those need it set up. Tents and ground items are solid; the open grass in your spot isn't, so friends can hang out in your camp. Everyone sees your camp, even while you're offline.
  - **Left out for now: the guestbook** (visitors leaving a message at your camp). It's a new message board players write on, so it needs its own moderation (reports, removal, a word filter) before it's safe. Everything else on the list is in.
- **🕶️ Wear.** Premium things to wear around the festival: festival totem, shutter shades, heart glasses, top hat, halo, fairy wings. Once you own one, put it on from 👕.
- **🧍 Looks.** Premium characters and character parts.
- **🪙 Credits.** How to earn credits, and the credit packs. Buying packs with real money is **not open yet**. The packs and the server hook (`grantPack` in `server/shop.js`) are ready for a payment provider. The plan is **PayPal Business**: a PayPal order for the pack, then PayPal's payment-captured webhook calls `grantPack` with the capture id, so a repeated webhook can't credit twice. Until that's connected, give credits from the command line:

```bash
npm run account -- credits <username>                 # balance and recent history
npm run account -- credits <username> +500 bought a pack
npm run account -- credits <username> -200 refund
npm run account -- camp-release <username>            # take back a camp spot (no refund)
```

**How it's kept honest:** balances only change on the server, and the browser only asks. Every credit earned or spent is a line in `data/credits-ledger.jsonl`: who, how much, the new balance, and why (`quest:soundcheck`, `buy:totem`, `camp:plot_10x10`, `console: …`). Camps are saved in `data/camps.json`.

**Changing prices or adding things:** everything is in `shared/economy.js`:

- starting credits, quest rewards and the daily cap
- credit packs
- camp spot sizes and prices (and which one is premium)
- camp items, their categories, and the premium bundle
- the golf cart switch (`GOLF_CART`)
- `UNLOCK_PRICES` for premium wearables and looks

A new camp item also needs its 3D shape in `buildItem()` in `client/camps.js`.

**Premium is the Hyre Personal membership** in the Hyre Not Fyre app ($5/month or $50/year). There's no separate FestiVille price, and FestiVille itself charges nothing. In the game it's an unlock on the account, the same unlock system premium looks use. The name and price players see are one setting (`MEMBERSHIP` in `shared/economy.js`). FestiVille accounts aren't linked to Hyre Not Fyre yet, so for now give Hyre Personal members their premium by hand:

```bash
npm run account -- unlock <username> premium     # the 20×20, the premium bundle, the golf cart
npm run account -- lock <username> premium       # undo
npm run account -- unlock <username> golfcart    # just a golf cart, for one account
``` A new wearable needs an entry in `shared/accessories.js` and a shape in `client/accessories.js`.

**The rules for credits** (also shown to players in the 🪙 Credits tab):

- **100 credits ≈ $1.** Bigger packs add a bonus: $4.99 → 500, $9.99 → 1,200 (+20%), $19.99 → 2,600 (+30%).
- Credits have **no cash value** and can't be exchanged for money. Purchases of credits and of things bought with credits are **not refundable**.
- Credits **can't be transferred** or gifted between players (this keeps out scams and resale of stolen accounts; gifting may come later).
- Credits **don't expire**.
- **Price tiers:**
  - small things, 40–150 credits, are reachable in one play session
  - mid-range things, 200–500, take a few days of play or a few dollars
  - showpieces, 600–1,000, are mostly bought, or take about a week of play

**Later: ad space for businesses.** Sponsored signs, banners and featured vendor spots will be sold to businesses **in dollars** (by invoice or PayPal), not in credits. Businesses expect receipts, and this keeps the player economy separate.

## Adding characters

Players have two ways to look:

- **Build your own** (parts-based): pick a body (female or male), a skin tone, and for each slot (hair, eyebrows, top, bottom, shoes) a part and its color, or hit 🎲 Randomize. Built from MakeHuman (MPFB) CC0 art. This is where new looks should go.
- **Classic**: one of nine whole Mixamo characters (◀ ▶). Michelle, Remy, Sophie, Bryce, Kate and Jody are free; Big Vegas, Jackie and Adam are premium. They're listed in `shared/characters.js` (a `.glb` plus a `.anims.json` each, in `client/assets/characters/`).

Both are on the join screen and in the in-game 👕 panel, with a live 3D preview. Everyone sees what each player chose.

### Parts-based characters (the generator)

The catalog is `shared/parts.js`: the two bodies, the skin tone palette, the body shapes, the slots, every part (which bodies it fits, free or premium, its file), and the color palettes. There are 12 hairstyles, 3 eyebrow styles, 15 tops, 11 bottoms, 10 pairs of shoes and 7 accessories (hats, shades, a mask, gloves), and each body comes in 4 builds (average, slim, heavy, athletic), 4 faces (classic, round, angular, heart) and 3 heights. Every part is rigged to **one shared skeleton** with Mixamo bone names (`mixamorigHips`, `mixamorigHead`, …), so one animation set per body fits every combination.

A player's look is stored as a short **recipe** string: body, skin tone, then `kind=id` for each body shape that isn't the default (build, face, height), then `slot=part:color` for each filled slot (colors are palette numbers):

```
female;3;hair=hair_bob:4;eyebrows=brows_soft:1;top=top_tank:2;bottom=bottom_shorts:8;shoes=shoes_sneakers:0
male;5;build=heavy;face=round;top=top_puffer:0;bottom=bottom_jeans:0;shoes=shoes_boots:0;accessory=acc_fedora:3
```

The server cleans every recipe (`normalizeRecipe()`), swaps premium parts the account hasn't unlocked for the free default, saves it as the player's default, and syncs it to everyone. A player has either a recipe or a classic look; the classic look is kept too, as a fallback (see below). Quest givers and NPCs can wear a recipe: set `recipe` next to `look` in `shared/quests-data.js` (`randomRecipe(seededRandom("their-id"))` gives a random one that's the same on every screen).

#### The part files

The bodies and parts are made from MakeHuman's free **CC0** assets by `scripts/make-parts.py` (Blender + the MPFB extension; credits in `client/assets/parts/CREDITS.md`):

```
client/assets/parts/manifest.json         every exported file, plus each clothing part's slot and hide bit
client/assets/parts/female/body.glb       base body (skin, eyes, eyelashes) + mixamorig* skeleton + hide masks + shape morphs
client/assets/parts/female/<file>.glb     one per part (the part's `file` in shared/parts.js)
client/assets/parts/female/anims.json     the body's animations: Idle, Walk, Run, Dance and the emotes
client/assets/parts/female/skins/*.webp   extra skin textures
client/assets/parts/male/…                the same for the male body
```

- **Bones:** every file uses the same `mixamorig*` bone names and rest pose as that body's `body.glb`. The game takes each part's skinned meshes and rebinds them to the player's body bones by name.
- **Scale:** meters. The two bodies keep their real heights (1.59 m and 1.73 m).
- **Colors:** hair and eyebrows are exported light grey and take the hair color swatches. Clothes keep their own printed colors and patterns (`tint: false` in `shared/parts.js`, so the builder shows no swatches for them). The skin tone tints the body.
- **Skin under clothes:** `body.glb` stores a mask per clothing slot (top, bottom, shoes, accessory) saying which skin each part covers, so the game hides that skin while it's worn and nothing pokes through.
- **Body shapes:** builds and faces are morph targets in `body.glb` (`build_heavy`, `face_round`, …; quantized and sparse, about 0.1–0.25 MB each). The game bakes the chosen ones into the body once and **refits every part to the shaped body** when it loads (each part vertex follows the nearest body surface), so parts are exported once per body, not once per shape. Height just scales the avatar. To add a shape: add it to `SHAPES` in `scripts/make-parts.py` (MPFB macros and/or targets), re-run it, then add it to `BUILDS` / `FACES` in `shared/parts.js`.
- **Outfit halves:** some tops and bottoms are halves of MakeHuman's one-piece system outfits, split at the hips by `make-parts.py` (entries like `("jeans", "male_casualsuit04", "lower")`).
- **Animations:** each body gets the classic characters' Idle/Walk/Run/Dance plus the emotes (CC0 clips from Quaternius' Universal Animation Library and KayKit Character Animations, and a few made in the script), all re-fitted to its skeleton by one command:
  ```bash
  npm run parts-anims
  ```
  It downloads the CC0 packs once into `.cache/` (not committed) and rewrites both `anims.json` files; the list of clips is at the top of `scripts/parts-anims.mjs`. After re-running `make-parts.py`, run it again. To add an emote: add its clip there, then a line to `shared/emotes.js`.

#### Adding a part

1. Install [Blender](https://www.blender.org/download/), then the **MPFB** extension, and load MakeHuman CC0 asset packs into MPFB (see "Making a realistic character with MakeHuman" below). The MakeHuman 2 CC0 repository on GitHub ([Makehuman-2/MH2_Asset_Repository_CCO](https://github.com/Makehuman-2/MH2_Asset_Repository_CCO), Releases) has the system assets and the Crude Kit as zips; without a Blender install, `pip install bpy` (Python 3.13) plus MPFB's source from GitHub also works headless.
2. Add the asset's folder name to the right slot in `PARTS` at the top of `scripts/make-parts.py`, and run it:
   ```bash
   blender -b --python scripts/make-parts.py -- client/assets/parts
   ```
   (`--only top=<name>` exports just one part, for testing, and leaves `body.glb` alone. `--keep-missing` keeps the existing files and hide bits of parts whose pack you don't have installed, so you can add parts without every pack on hand.) The default body doesn't change, so the animations don't need re-fitting unless you change the body itself.
3. Add a line to `PARTS` in `shared/parts.js`, e.g. `{ id: "top_mesh", name: "Mesh top", slot: "top", bodies: ["female", "male"], tier: "free", file: "<name>", tint: false }`. Ids are lowercase (`a-z 0-9 _ -`, up to 32 characters) and unique across parts, characters and accessories; `file` can be longer.
4. Restart the server (it prints the part list at startup) and refresh. Palettes are append-only: recipes store color numbers, so reordering a palette recolors everyone.

#### Before the art arrives (and when a file is missing)

The code works without any part files. If a body's `body.glb` is missing, players who built a character appear as their **classic** character instead (the builder says so), and everything else carries on. A missing part file is skipped with a console warning. Downloads are cached and shared: each file is fetched once, and everyone wearing a part shares its mesh and textures.

### Free vs premium looks

Each character has `tier: "free"` or `tier: "premium"` in `shared/characters.js`. Premium is cosmetic only: everyone can walk around, hang out, crew up and do quests no matter what they look like.

- The picker shows premium looks with a lock note. Players can preview them, but the **server** decides who actually gets one (`server/entitlements.js`), so it can't be unlocked by tinkering in the browser.
- Premium looks, accessories and character parts are unlocked **per account**: bought with credits in the 🪙 Shop, or granted with `npm run account -- unlock <username> <id>` (e.g. `bigvegas`, `wings`, `hair_afro`) (there are no payments yet, so this is how you grant one; a payment would later call the same thing). To unlock everything while testing, start the server with `FV_UNLOCK_ALL=1 npm start` (Windows: `set FV_UNLOCK_ALL=1 && npm start`).
- When payments come, `server/entitlements.js` is the one place to check a player's purchases (`canUseLook()`, `canUseAccessory()`, `canUsePart()`).

### Accessories

Players can top any character with cosmetic accessories on the join screen — tap the chips under **Accessories**. They animate with the character and everyone sees them. One per slot (head, face, back, hand); picking a second in a slot swaps it.

- **Free:** baseball cap, flower crown, sunglasses, glow stick.
- **Premium:** top hat, halo, heart glasses, shutter shades, festival totem, fairy wings. Buy them with credits in the 🪙 Shop, or unlock them per account the same way as premium characters:
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
- `FENCE` in `shared/layout.js` sets the size of the grounds (about 400 × 400 m); `WORLD_HALF_SIZE` and `WALK_LIMIT` in `shared/sim.js` follow it. Walking is 3 m/s, running 6.5 m/s, a golf cart 11 m/s.
- **Collision runs on the server**, in the same `shared/sim.js` the browser uses to predict your moves, so a modified browser can't walk through walls. What's solid comes from the layout (`TYPES[...].solid` in `shared/layout.js`: stages, stalls, tents, tables, the Ferris wheel and art are boxes; trees are their trunks; water is blocked except on a bridge) and from what's set up in camps. You slide along things instead of sticking to them. Players are small circles that gently drift apart (slower than walking, so nobody can be boxed in).
- Quest rules run only on the server using the server's own positions, so nobody can fake finding an item or standing on a marker.
- Animations aren't sent over the network. Each browser works out Idle / Walk / Run from how fast a player is moving, so it costs no extra bandwidth. Only the emote is synced (`emote` and `emoteSeq` in `server/schema.js`; see `shared/emotes.js`).

## Next

- **Forgot-password emails:** for now, resets are done by hand with `npm run account -- reset-password`.
- **More quests,** including ones that unlock cosmetics (glow outfits, new dances).
- **Vendor photos and specials:** a stall photo and a "today's special" banner on the vendor card.
- **Scaling:** zones (interest management) so one shared room can hold far more than 100 players. See "Scaling: one shared world".
- **Camp guestbooks**, once there's moderation for player-written notes.
- **More rides** (carousel, swings, bumper cars), and a passenger seat in the golf cart.

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

**To test one shared world**, start the server with `FV_ROOM_SIZE=1000` too, so every fake player lands in the same room instead of being split into rooms of 100: `FV_ROOM_SIZE=1000 FV_SIGNUPS_PER_HOUR=100000 npm start`.

`npm run tickbench` measures the game rules alone (movement, collision, quests, rides) for 100 to 2,000 players without any networking.

Fake players (`lt_0001`, `lt_0002`, …) join, walk around and chat. Every 5 seconds it prints the response time (key press → server confirms the move; under 150 ms feels fine), updates per second (should stay near 20), and the server's tick time (fine under ~25 ms of its 50 ms budget). At the end it says whether the server coped. Past ~300 fake players, run the load test from a second computer so your own machine isn't the bottleneck. For the hosted test, `deploy/setup-server.sh` already raises the sign-up limit; afterwards set `FV_SIGNUPS_PER_HOUR=` (empty) in `deploy/.env` and run the `up -d` line again to go back to the default.

### Scaling: one shared world

**The requirement:** everybody can interact with everybody, in one shared world. Today a room holds 100 players (`FV_ROOM_SIZE`) and more rooms open as it fills. That doesn't crash, but it splits people into copies of the festival, and that is **not** the answer.

**What's measured so far** (Nov 12, 2026):

- **The game rules are cheap.** `npm run tickbench`, on a 2-core cloud machine, with players crowded at the stages, the Food Court and the Campground, and some on quests and on the Ferris wheel:

  | players in one room | game tick, average | p95 | share of the 50 ms tick |
  |---|---|---|---|
  | 200 | 0.10 ms | 0.18 ms | 0.2% |
  | 500 | 0.30 ms | 0.47 ms | 0.6% |
  | 1,000 | 0.77 ms | 1.13 ms | 1.5% |
  | 2,000 | 1.74 ms | 2.78 ms | 3.5% |

  So movement, collision, the push between players and quests aren't what limits one shared room.
- **The real load test (`npm run loadtest -- 200` and `-- 500`) still needs to be run** on a machine that can install the packages. It measures what the tick bench can't: sending every player's moves to every other player. Run it with `FV_ROOM_SIZE=1000` so it tests one shared room (above).

**What to expect, and why zones are the next step:** with one room and no zones, every player gets every other player's moves, 20 times a second. That's roughly 25–30 bytes per moving player per update. This is an estimate, to be checked against the load test. Per player it comes to about **0.7 Mbit/s with 200 people online and 1.7 Mbit/s with 500**, and the server sends that to everyone: on the order of 140 Mbit/s and 850 Mbit/s. It grows with the square of the crowd, so a few hundred players in one room is where it hurts, especially on phones.

**The next step: zones (interest management) in one room.** One room holds everyone. The server only sends each player what's near them (say within 80–100 m), plus the far-away players at a low rate so the map still shows them. A crowd at the Main Stage then costs nothing for someone in the Campground, and anyone can still walk up to anyone, because walking closer is what brings them into view. Colyseus 0.16 has per-player views (`StateView`) for exactly this. Chat already works this way ("nearby" is 25 m). The new map's sections help too: the forest belts and the river keep crowds apart.

**After that, if the crowd outgrows one CPU core:** several game processes that share the world through **Redis**, and accounts, camps, vendors and the DJ record move from JSON files to **Postgres** (the code keeps calling the same store methods).

| Players at once | Setup | Roughly |
|---|---|---|
| a few hundred | 1 server, 2 GB RAM, plus zones | $5–12 / month |
| ~1,000 | 2–3 servers + Postgres + Redis | $40–80 / month |

Managed Postgres and Redis are about $15 each per month at DigitalOcean. Bandwidth is the thing to watch on the bill: zones are what keep it in the included allowance.

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
