# Building Commands

A small Vintage Story code mod that adds Minecraft-style building commands, so structures can be placed from plain coordinate text (the way an AI drives `/fill` and `/setblock` in Minecraft) instead of Vintage Story's tool-based WorldEdit selection.

## Commands

All commands need the `controlserver` privilege (you have it in single player).

### `/fill x1 y1 z1 x2 y2 z2 <block> [mode] [filter]`
Fills the cuboid between the two corners.

- **Modes:** `replace` (default, overwrite everything), `keep` (only into air or replaceable blocks), `hollow` (shell of `<block>`, interior set to air), `outline` (shell only, interior untouched), `destroy` (same as replace here, no item drops).
- **Filter:** with `replace` you may add a block code; only blocks matching it are replaced. Example: `/fill ~-5 ~ ~-5 ~5 ~ ~5 game:soil-medium-none replace game:sand-normal`.

### `/setblock x y z <block> [mode]`
Sets one block. Modes: `replace` (default), `keep`, `destroy`.

> Note: in some mod sets another mod already registers `/setblock`. When that happens this mod logs a warning and registers it as **`/cbsetblock`** instead. `/fill`, `/clone`, and `/blockcode` normally keep their bare names.

### `/clone x1 y1 z1 x2 y2 z2 dx dy dz [mode]`
Copies the source cuboid so its minimum corner lands at `dx dy dz`. Modes: `replace` (default), `masked` (skip air, paste only solid blocks). The source is buffered first, so overlapping source and destination is safe.

### `/blockcode <search>`
Lists up to 50 registered block codes containing the search term, so you can find the exact code to build with. Example: `/blockcode stonebrick` returns `game:stonebricks-granite, game:stonebricks-andesite, ...`.

### `/build <name> [direction]` and `/build` (paste window)
Runs an entire script of commands at once, so you never paste hundreds of lines by hand.

- `/build <name>` runs a plain-text `<name>.txt` file from the scripts folder (see Batch building below).
- `/build <name> <direction>` turns the whole build so it faces `north`, `east`, `south` or `west`. You can also give a plain angle: `/build myhouse 90`.
- `/build` with no name opens an in-game window where you paste a command list and press Run. Handy when the commands come from somewhere you cannot save to a file.
- `/build list` shows the available scripts.

Either way, tilde coordinates are measured from where you stand when you run it, so the whole structure lands around you.

### Turning a build
A script says which way it faces as written with a `facing` line near the top:

```
facing south
```

`/build myhouse north` then works out the angle for you: a build declared `facing south` turns 180 degrees, and one declared `facing west` turns 90. A script with no `facing` line is taken to face north, so an existing script is unaffected by `/build <name> north`.

Turning rewrites the block codes as well as the coordinates, so stairs, fences, glass panes, ladders, doors, beds, slanted roofing, logs and planks all come out pointing the right way. The mod asks each block to turn itself first, exactly as worldedit does; for the few that carry a compass word in their code but never implement rotation (chests are the common one, and worldedit gets those wrong too) it rewrites the direction word instead. Anything it still cannot turn is named in the summary line rather than left for you to find in the world.

`clone` is the one exception: it copies blocks that are already in the world, so their own orientation is whatever it was. Its coordinates turn, its contents do not.

### `/preview <name> [direction]`, `/confirm`, `/cancel`
Place a build naturally by seeing it first. `/preview <name>` (or the **Preview** button in the paste window) projects the build as a translucent ghost at the block your crosshair is on, and the ghost follows your look. Aim it where you want, then:

- `/confirm` places it for real at that spot.
- `/cancel` discards it.

`/preview <name> <direction>` turns the ghost too, and `/confirm` places what the ghost showed. Nothing is written to the world until you confirm. The ghost shows fill and setblock blocks (air is invisible); clone lines still place on confirm but are not drawn in the ghost. Large builds cap the ghost at 60000 blocks, but the full build still places.

## Coordinates

Each coordinate is either **absolute** (`100 64 -30`) or **tilde-relative** to the caller (`~ ~2 ~-4`), exactly like Minecraft. Tilde coordinates need a player caller; absolute coordinates also work from the server console.

## Block codes

Codes default to the vanilla `game:` domain, so `stonebricks-granite` resolves to `game:stonebricks-granite`. Include a domain for modded blocks (`somemod:theirblock`). `air` clears a block. Use `/blockcode` to discover exact variant codes.

## Batch building with /build

For anything past a few lines, write the commands to a `.txt` file and run them all with one command. The mod prints the exact folder path in the log on load; by default it is:

`%APPDATA%\VintagestoryData\BuildingCommands\`

Drop a file like `dungeon.txt` there, then run `/build dungeon`. In the file:

- One command per line; the leading `/` is optional (`fill ...` or `/fill ...`).
- Only this mod's commands run (`fill`, `setblock`, `clone`, `blockcode`).
- A `facing <direction>` line declares which way the build faces, so `/build <name> <direction>` can turn it. It is a declaration, not a command, and does not count toward the total.
- Blank lines and lines starting with `#` or `//` are ignored, so you can comment your build.
- Tilde coordinates are all measured from where you stand when you run `/build`, so a whole structure lands around you.

Ready-to-run scripts are in `examples/` (and generated by `tools/gen.js`, run with `node tools/gen.js`): `dungeon`, `ruin`, `portal` (a sunken circular portal with pillars and glow), `shipwreck-huge` (a ~120-block aged-wood hull tilted on its side, with devastation growths bursting out and many collapsed chests), `shipwreck-small`, `shipwreck-medium` (upright, heavily holed), and `city` (a ~40x40 flooded ruin of crumbling towers). They are all heavily ruined, tilde-relative, and use only collapsed `lootchest` chests. The big ones (`shipwreck-huge`, `city`) place a couple thousand blocks, so give them a few seconds. `/build list` lists what you have.

Besides the chat commands, scripts (and the paste window) also accept a `lootchest` directive:

    lootchest x y z [1-4] [north|east|south|west]

It places a collapsed ruin chest and stocks it with randomized loot the same way the game fills its lore-location chests: it drops `stackrandomizer` loot tokens into the slots and resolves them into real items (gears, ruined weapons, copper tools, ingots, ore, worn clothing, lanterns, lore scrolls, and the occasional temporal treasure). The optional `1-4` picks which collapsed shape; the side is the facing.

## Limits

A single `/fill` or `/clone` is capped at 524288 blocks so a runaway command cannot stall the server. Split larger builds into passes.

## Building

`dotnet build -c Release` compiles the mod and deploys `BuildingCommands_<version>.zip` to `%APPDATA%\VintagestoryData\Mods`, replacing the previous build. Requires the Vintage Story API DLLs at `%APPDATA%\Vintagestory`.
