# Character parts: credits and license

Every model and texture in this folder was made with [MakeHuman](https://static.makehumancommunity.org/) / MPFB
from these CC0 (public domain) asset packs: MakeHuman system assets, Hair 01, Shoes 01, Eyebrows 01, Shirts 01,
Pants 01 and Skirts 01. CC0 means they can be used, changed and shared freely, including commercially.

Thanks to the asset authors credited in those packs, including Toigo, Cortu, Elvs, Joepal, Namuhekam,
Skalldyrssuppe, Frankyaye, Scailman, Culturalibre, Rehmanpolanski, Sonntag78 and Mindfront.

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
