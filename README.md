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

## Coordinates

Each coordinate is either **absolute** (`100 64 -30`) or **tilde-relative** to the caller (`~ ~2 ~-4`), exactly like Minecraft. Tilde coordinates need a player caller; absolute coordinates also work from the server console.

## Block codes

Codes default to the vanilla `game:` domain, so `stonebricks-granite` resolves to `game:stonebricks-granite`. Include a domain for modded blocks (`somemod:theirblock`). `air` clears a block. Use `/blockcode` to discover exact variant codes.

## Limits

A single `/fill` or `/clone` is capped at 524288 blocks so a runaway command cannot stall the server. Split larger builds into passes.

## Building

`dotnet build -c Release` compiles the mod and deploys `BuildingCommands_<version>.zip` to `%APPDATA%\VintagestoryData\Mods`, replacing the previous build. Requires the Vintage Story API DLLs at `%APPDATA%\Vintagestory`.
