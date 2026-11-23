# Character parts: credits and license

Every model and texture in this folder was made with [MakeHuman](https://static.makehumancommunity.org/) / MPFB.
Almost all of it comes from CC0 (public domain) assets, which can be used, changed and shared freely, including
commercially. The bags are CC-BY (Creative Commons Attribution): they can be used the same way, including
commercially, as long as their authors are credited, which the section "CC-BY assets (the bags)" below does.

- **MakeHuman asset packs** ([static.makehumancommunity.org/assets/assetpacks.html](https://static.makehumancommunity.org/assets/assetpacks.html),
  the `*_cc0.zip` downloads): system assets, Hair 01, Shoes 01, Eyebrows 01, Shirts 01, Pants 01, Skirts 01,
  Suits 01, Hats 01, Glasses 01, Masks 01 and Gloves 01. Every asset used is marked CC0 in its pack's
  `packs/*.json` (a few assets in those packs are CC-BY, and none of them are used here).
  - The white dinner jacket, pink blazer and pink trousers are halves of Toigo's `toigo_suit_with_dinner_jacket`
    and `toigo_female_suit_2` (Suits 01).
- **The MakeHuman 2 CC0 asset repository**
  ([Makehuman-2/MH2_Asset_Repository_CCO](https://github.com/Makehuman-2/MH2_Asset_Repository_CCO), releases
  `mh_system_CC0.zip` and `crude_kit_CC0.zip`):
  - MakeHuman legacy system assets: the puffer jacket, striped shirt, long-sleeve tee, logo tee, suit jacket,
    sports crop top, jeans, pencil skirt, leggings and belted shorts are the upper or lower halves of the system
    outfits `male_casualsuit02/03/04/05`, `male_elegantsuit01`, `female_casualsuit01/02`, `female_elegantsuit01`
    and `female_sportsuit01`; the fedoras are `fedora01` and `fedora_cocked`.
  - Crude Kit (Joel Palmius): the long coats (`crude_lab_coat_open_female`, `male_crude_labcoat`), the
    wide-brim hat, visor shades, masquerade mask, gloves and opera gloves.

The body shapes (builds and faces) are MPFB's own CC0 targets.

## CC-BY assets (the bags)

From the MakeHuman asset pack Equipment 03 (`equipment03_cc-by.zip`,
[static.makehumancommunity.org/assets/assetpacks/equipment03.html](https://static.makehumancommunity.org/assets/assetpacks/equipment03.html)),
each labelled CC-BY in the pack's `packs/equipment03.json` (Creative Commons Attribution; MakeHuman's asset FAQ
links [CC BY 2.5](https://creativecommons.org/licenses/by/2.5/)). Changes made for FestiVille: fitted to the
game's two bodies with MPFB, weighted to its Mixamo skeleton, exported as glTF with WebP textures at most
1024 px (512 px for the sling purse), and the sling purse reduced to about 6,000 vertices.

| In the game | Asset | Author | Source |
| --- | --- | --- | --- |
| Satchel (`bag_satchel`) | `punkduck_handbag01` | punkduck | [makehumancommunity.org/node/959](http://www.makehumancommunity.org/node/959) |
| Sling purse (`bag_sling`) | `elvs_sling_purse1` | Elvaerwyn | [makehumancommunity.org/node/1459](http://www.makehumancommunity.org/node/1459) |
| Shopping bag (`bag_shopping`) | `punkduck_shopping_bag01` (its print is punkduck's own logo) | punkduck | [makehumancommunity.org/node/967](http://www.makehumancommunity.org/node/967) |
| Suitcase (`bag_suitcase`) | `culturalibre_suitcase` | culturalibre, adapting an original model by Duion ([CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), [Blend Swap 66594](http://www.blendswap.com/blends/view/66594)) | [makehumancommunity.org/node/2550](http://www.makehumancommunity.org/node/2550) |

Thank you, punkduck, Elvaerwyn, culturalibre and Duion!

Thanks to the asset authors credited in those packs, including Toigo, Cortu, Elvs, Joepal, Namuhekam,
Skalldyrssuppe, Frankyaye, Scailman, Culturalibre, Rehmanpolanski, Sonntag78, Mindfront, Joel Palmius,
Jujube, Aethelraed Unraed, EWS, Spamrakuen, Grinsegold and Learning.

Regenerate everything with `scripts/make-parts.py` (instructions at the top of that file).

## Animations (`<body>/anims.json`)

Built by `scripts/parts-anims.mjs` (`npm run parts-anims`), which re-fits every clip to each body's skeleton:

| Clips | Source | License |
| --- | --- | --- |
| Wave, Cheer, Jump, SitDown, SitIdle, StandUp | [KayKit Character Animations](https://kaylousberg.itch.io/kaykit-character-animations) by Kay Lousberg (`Rig_Medium_Simulation`: Waving, Cheering, Sit_Floor_Down/Idle/StandUp; `Rig_Medium_MovementBasic`: Jump_Full_Short) | CC0 1.0 |
| Bounce, ThumbsUp | [Universal Animation Library](https://quaternius.com/packs/universalanimationlibrary.html) (Dance_Loop) and [Universal Animation Library 2](https://quaternius.com/packs/universalanimationlibrary2.html) (Yes) by Quaternius, Standard (free) editions | CC0 1.0 |
| Clap, Point, FistPump | Made in `scripts/parts-anims.mjs` (poses keyed on top of Idle) for this game | Same as this repository |
| Idle, Walk, Run, Dance | The classic characters' clips (`client/assets/characters/remy.anims.json`), as before | As the classic characters |

The script downloads the packs from a public mirror of the creators' free releases (`series-ai/jam-ready-assets` on GitHub, which keeps each pack's CC0 license file); the originals are at the links above. Thank you, Kay Lousberg and Quaternius!
