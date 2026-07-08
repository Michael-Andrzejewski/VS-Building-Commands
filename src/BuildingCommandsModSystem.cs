using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using Vintagestory.API.Common;
using Vintagestory.API.Config;
using Vintagestory.API.MathTools;
using Vintagestory.API.Server;

namespace BuildingCommands;

/// <summary>
/// Adds Minecraft-style building commands so structures can be placed from
/// plain coordinate text (the way an AI drives /fill and /setblock in
/// Minecraft), instead of Vintage Story's tool-based WorldEdit selection.
///
///   /fill x1 y1 z1 x2 y2 z2 &lt;block&gt; [replace|keep|hollow|outline|destroy] [filter]
///   /setblock x y z &lt;block&gt; [replace|keep|destroy]
///   /clone x1 y1 z1 x2 y2 z2 dx dy dz [replace|masked]
///   /blockcode &lt;search&gt;
///
/// Each coordinate may be absolute (100 64 -30) or tilde-relative to the
/// caller (~ ~2 ~-4), matching Minecraft. Block codes take the vanilla
/// game: domain by default, so "stonebricks-granite" resolves to
/// game:stonebricks-granite; "air" clears a block.
/// </summary>
public class BuildingCommandsModSystem : ModSystem
{
    // Hard ceiling on how many blocks one /fill or /clone may touch, so a
    // fat-fingered or runaway command can't try to rewrite a whole region
    // and stall the server. 512 x 512 x 2 worth of blocks.
    private const long MaxVolume = 524288;

    private ICoreServerAPI sapi;

    // Whether the current command's caller has an entity, so ~relative
    // coordinates have an origin. Set per command in GetOrigin; commands are
    // handled one at a time on the server thread. When false, a ~ token is
    // rejected but absolute coordinates still work (e.g. from the console).
    private bool originAvailable;

    public override void StartServerSide(ICoreServerAPI api)
    {
        sapi = api;

        var p = api.ChatCommands.Parsers;

        // Register the bare Minecraft-style names. If another loaded mod (or a
        // future game version) already claims one, fall back to a cb-prefixed
        // alias for just that command instead of aborting the whole mod.
        RegisterCmd(api, "fill", name =>
            api.ChatCommands.Create(name)
                .WithDescription("Fill a cuboid with a block. Coords are absolute or ~relative. Modes: replace (default), keep, hollow, outline, destroy. With replace you may add a filter block that must match.")
                .RequiresPrivilege(Privilege.controlserver)
                .WithArgs(
                    p.Word("x1"), p.Word("y1"), p.Word("z1"),
                    p.Word("x2"), p.Word("y2"), p.Word("z2"),
                    p.Word("block"),
                    p.OptionalWord("mode"),
                    p.OptionalWord("filter"))
                .HandleWith(OnFill));

        RegisterCmd(api, "setblock", name =>
            api.ChatCommands.Create(name)
                .WithDescription("Set a single block. Coords are absolute or ~relative. Modes: replace (default), keep, destroy.")
                .RequiresPrivilege(Privilege.controlserver)
                .WithArgs(
                    p.Word("x"), p.Word("y"), p.Word("z"),
                    p.Word("block"),
                    p.OptionalWord("mode"))
                .HandleWith(OnSetblock));

        RegisterCmd(api, "clone", name =>
            api.ChatCommands.Create(name)
                .WithDescription("Copy a cuboid to a destination (dx dy dz is where the region's minimum corner lands). Modes: replace (default), masked (skip air).")
                .RequiresPrivilege(Privilege.controlserver)
                .WithArgs(
                    p.Word("x1"), p.Word("y1"), p.Word("z1"),
                    p.Word("x2"), p.Word("y2"), p.Word("z2"),
                    p.Word("dx"), p.Word("dy"), p.Word("dz"),
                    p.OptionalWord("mode"))
                .HandleWith(OnClone));

        RegisterCmd(api, "blockcode", name =>
            api.ChatCommands.Create(name)
                .WithDescription("List registered block codes containing a search term, so you can find the exact code to build with.")
                .RequiresPrivilege(Privilege.controlserver)
                .WithArgs(p.Word("search"))
                .HandleWith(OnBlockcode));
    }

    /// <summary>
    /// Register a command under its bare name, or under "cb" + name if the
    /// bare name is already taken, so one collision can't stop the rest.
    /// </summary>
    private void RegisterCmd(ICoreServerAPI api, string name, Action<string> build)
    {
        try
        {
            build(name);
        }
        catch (Exception)
        {
            string alt = "cb" + name;
            try
            {
                build(alt);
                api.Logger.Warning($"[buildingcommands] Command /{name} is already taken; registered it as /{alt} instead.");
            }
            catch (Exception e2)
            {
                api.Logger.Error($"[buildingcommands] Could not register /{name} or /{alt}: {e2.Message}");
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    //  /fill
    // ─────────────────────────────────────────────────────────────────────
    private TextCommandResult OnFill(TextCommandCallingArgs args)
    {
        GetOrigin(args, out int ox, out int oy, out int oz, out int dim);

        if (!ParseCoord(Str(args, 0), ox, out int x1, out string e0)) return TextCommandResult.Error(e0);
        if (!ParseCoord(Str(args, 1), oy, out int y1, out string e1)) return TextCommandResult.Error(e1);
        if (!ParseCoord(Str(args, 2), oz, out int z1, out string e2)) return TextCommandResult.Error(e2);
        if (!ParseCoord(Str(args, 3), ox, out int x2, out string e3)) return TextCommandResult.Error(e3);
        if (!ParseCoord(Str(args, 4), oy, out int y2, out string e4)) return TextCommandResult.Error(e4);
        if (!ParseCoord(Str(args, 5), oz, out int z2, out string e5)) return TextCommandResult.Error(e5);

        Block block = ResolveBlock(Str(args, 6), out string berr);
        if (block == null) return TextCommandResult.Error(berr);

        string mode = (Str(args, 7) ?? "replace").ToLowerInvariant();
        string filterCode = Str(args, 8);
        Block filter = null;
        if (!string.IsNullOrEmpty(filterCode))
        {
            if (mode != "replace") return TextCommandResult.Error("A filter block is only allowed with mode 'replace'.");
            filter = ResolveBlock(filterCode, out string ferr);
            if (filter == null) return TextCommandResult.Error(ferr);
        }

        int minX = Math.Min(x1, x2), maxX = Math.Max(x1, x2);
        int minY = Math.Min(y1, y2), maxY = Math.Max(y1, y2);
        int minZ = Math.Min(z1, z2), maxZ = Math.Max(z1, z2);

        long volume = (long)(maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1);
        if (volume > MaxVolume)
            return TextCommandResult.Error($"That is {volume} blocks, over the {MaxVolume} limit. Fill a smaller region.");

        if (mode != "replace" && mode != "keep" && mode != "hollow" && mode != "outline" && mode != "destroy")
            return TextCommandResult.Error($"Unknown mode '{mode}'. Use replace, keep, hollow, outline, or destroy.");

        var ba = sapi.World.GetBlockAccessorBulkUpdate(true, true);
        int airId = 0;
        int changed = 0;
        var pos = new BlockPos(0, 0, 0, dim);

        for (int x = minX; x <= maxX; x++)
            for (int y = minY; y <= maxY; y++)
                for (int z = minZ; z <= maxZ; z++)
                {
                    pos.Set(x, y, z);
                    bool shell = x == minX || x == maxX || y == minY || y == maxY || z == minZ || z == maxZ;

                    switch (mode)
                    {
                        case "keep":
                            {
                                Block cur = ba.GetBlock(pos);
                                if (cur != null && !cur.IsReplacableBy(block)) continue;
                                break;
                            }
                        case "hollow":
                            ba.SetBlock(shell ? block.BlockId : airId, pos);
                            changed++;
                            continue;
                        case "outline":
                            if (!shell) continue;
                            break;
                        case "replace":
                            if (filter != null)
                            {
                                Block cur = ba.GetBlock(pos);
                                if (cur == null || cur.BlockId != filter.BlockId) continue;
                            }
                            break;
                        // "destroy" behaves like replace here (no item drops).
                    }

                    ba.SetBlock(block.BlockId, pos);
                    changed++;
                }

        ba.Commit();
        return TextCommandResult.Success($"Filled {changed} block(s) with {block.Code} [{mode}] in ({minX},{minY},{minZ})-({maxX},{maxY},{maxZ}).");
    }

    // ─────────────────────────────────────────────────────────────────────
    //  /setblock
    // ─────────────────────────────────────────────────────────────────────
    private TextCommandResult OnSetblock(TextCommandCallingArgs args)
    {
        GetOrigin(args, out int ox, out int oy, out int oz, out int dim);

        if (!ParseCoord(Str(args, 0), ox, out int x, out string e0)) return TextCommandResult.Error(e0);
        if (!ParseCoord(Str(args, 1), oy, out int y, out string e1)) return TextCommandResult.Error(e1);
        if (!ParseCoord(Str(args, 2), oz, out int z, out string e2)) return TextCommandResult.Error(e2);

        Block block = ResolveBlock(Str(args, 3), out string berr);
        if (block == null) return TextCommandResult.Error(berr);

        string mode = (Str(args, 4) ?? "replace").ToLowerInvariant();
        if (mode != "replace" && mode != "keep" && mode != "destroy")
            return TextCommandResult.Error($"Unknown mode '{mode}'. Use replace, keep, or destroy.");

        var acc = sapi.World.BlockAccessor;
        var pos = new BlockPos(x, y, z, dim);

        if (mode == "keep")
        {
            Block cur = acc.GetBlock(pos);
            if (cur != null && !cur.IsReplacableBy(block))
                return TextCommandResult.Success($"Kept existing {cur.Code} at ({x},{y},{z}).");
        }

        acc.SetBlock(block.BlockId, pos);
        acc.MarkBlockDirty(pos);
        return TextCommandResult.Success($"Set {block.Code} at ({x},{y},{z}).");
    }

    // ─────────────────────────────────────────────────────────────────────
    //  /clone
    // ─────────────────────────────────────────────────────────────────────
    private TextCommandResult OnClone(TextCommandCallingArgs args)
    {
        GetOrigin(args, out int ox, out int oy, out int oz, out int dim);

        if (!ParseCoord(Str(args, 0), ox, out int x1, out string e0)) return TextCommandResult.Error(e0);
        if (!ParseCoord(Str(args, 1), oy, out int y1, out string e1)) return TextCommandResult.Error(e1);
        if (!ParseCoord(Str(args, 2), oz, out int z1, out string e2)) return TextCommandResult.Error(e2);
        if (!ParseCoord(Str(args, 3), ox, out int x2, out string e3)) return TextCommandResult.Error(e3);
        if (!ParseCoord(Str(args, 4), oy, out int y2, out string e4)) return TextCommandResult.Error(e4);
        if (!ParseCoord(Str(args, 5), oz, out int z2, out string e5)) return TextCommandResult.Error(e5);
        if (!ParseCoord(Str(args, 6), ox, out int dx, out string e6)) return TextCommandResult.Error(e6);
        if (!ParseCoord(Str(args, 7), oy, out int dy, out string e7)) return TextCommandResult.Error(e7);
        if (!ParseCoord(Str(args, 8), oz, out int dz, out string e8)) return TextCommandResult.Error(e8);

        string mode = (Str(args, 9) ?? "replace").ToLowerInvariant();
        if (mode != "replace" && mode != "masked")
            return TextCommandResult.Error($"Unknown mode '{mode}'. Use replace or masked.");

        int minX = Math.Min(x1, x2), maxX = Math.Max(x1, x2);
        int minY = Math.Min(y1, y2), maxY = Math.Max(y1, y2);
        int minZ = Math.Min(z1, z2), maxZ = Math.Max(z1, z2);

        int sx = maxX - minX + 1, sy = maxY - minY + 1, sz = maxZ - minZ + 1;
        long volume = (long)sx * sy * sz;
        if (volume > MaxVolume)
            return TextCommandResult.Error($"That is {volume} blocks, over the {MaxVolume} limit. Clone a smaller region.");

        // Read the whole source into a buffer first so an overlapping
        // destination can't read blocks we already overwrote.
        var read = sapi.World.BlockAccessor;
        int[] buf = new int[volume];
        var rp = new BlockPos(0, 0, 0, dim);
        int i = 0;
        for (int x = minX; x <= maxX; x++)
            for (int y = minY; y <= maxY; y++)
                for (int z = minZ; z <= maxZ; z++)
                {
                    rp.Set(x, y, z);
                    Block b = read.GetBlock(rp);
                    buf[i++] = b?.BlockId ?? 0;
                }

        var ba = sapi.World.GetBlockAccessorBulkUpdate(true, true);
        var wp = new BlockPos(0, 0, 0, dim);
        int changed = 0;
        i = 0;
        for (int x = 0; x < sx; x++)
            for (int y = 0; y < sy; y++)
                for (int z = 0; z < sz; z++)
                {
                    int id = buf[i++];
                    if (mode == "masked" && id == 0) continue;
                    wp.Set(dx + x, dy + y, dz + z);
                    ba.SetBlock(id, wp);
                    changed++;
                }

        ba.Commit();
        return TextCommandResult.Success($"Cloned {changed} block(s) to ({dx},{dy},{dz}) [{mode}].");
    }

    // ─────────────────────────────────────────────────────────────────────
    //  /blockcode
    // ─────────────────────────────────────────────────────────────────────
    private TextCommandResult OnBlockcode(TextCommandCallingArgs args)
    {
        string q = (Str(args, 0) ?? "").ToLowerInvariant();
        if (q.Length == 0) return TextCommandResult.Error("Give a search term, e.g. /blockcode stonebrick");

        var matches = new List<string>();
        const int limit = 50;
        foreach (Block b in sapi.World.Blocks)
        {
            if (b?.Code == null || b.Id == 0) continue;
            string code = b.Code.ToString();
            if (code.IndexOf(q, StringComparison.OrdinalIgnoreCase) >= 0)
            {
                matches.Add(code);
                if (matches.Count >= limit) break;
            }
        }

        if (matches.Count == 0) return TextCommandResult.Success($"No block codes match '{q}'.");

        var sb = new StringBuilder();
        sb.Append(matches.Count >= limit ? $"First {limit} matches for '{q}': " : $"{matches.Count} match(es) for '{q}': ");
        sb.Append(string.Join(", ", matches));
        return TextCommandResult.Success(sb.ToString());
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Helpers
    // ─────────────────────────────────────────────────────────────────────
    private static string Str(TextCommandCallingArgs args, int index)
        => args.Parsers[index].GetValue() as string;

    /// <summary>
    /// Caller's block position, used as the origin for ~relative coords, and
    /// the dimension writes go to. When the caller has no entity (server
    /// console) the origin is 0 and originAvailable is set false, so ~ tokens
    /// are rejected but absolute coordinates still work.
    /// </summary>
    private void GetOrigin(TextCommandCallingArgs args, out int ox, out int oy, out int oz, out int dim)
    {
        var entity = args.Caller?.Entity;
        if (entity == null)
        {
            ox = oy = oz = dim = 0;
            originAvailable = false;
            return;
        }
        ox = (int)Math.Floor(entity.Pos.X);
        oy = (int)Math.Floor(entity.Pos.Y);
        oz = (int)Math.Floor(entity.Pos.Z);
        dim = entity.Pos.Dimension;
        originAvailable = true;
    }

    /// <summary>Absolute integer, or ~ / ~offset relative to origin.</summary>
    private bool ParseCoord(string tok, int origin, out int val, out string err)
    {
        val = 0;
        err = null;
        if (string.IsNullOrEmpty(tok)) { err = "Missing a coordinate."; return false; }

        if (tok[0] == '~')
        {
            if (!originAvailable) { err = "~relative coordinates need a player caller; use absolute coordinates from the console."; return false; }
            if (tok.Length == 1) { val = origin; return true; }
            string rest = tok.Substring(1);
            if (int.TryParse(rest, NumberStyles.Integer, CultureInfo.InvariantCulture, out int off)) { val = origin + off; return true; }
            if (double.TryParse(rest, NumberStyles.Float, CultureInfo.InvariantCulture, out double doff)) { val = origin + (int)Math.Floor(doff); return true; }
            err = $"Bad relative coordinate '{tok}'.";
            return false;
        }

        if (int.TryParse(tok, NumberStyles.Integer, CultureInfo.InvariantCulture, out int abs)) { val = abs; return true; }
        if (double.TryParse(tok, NumberStyles.Float, CultureInfo.InvariantCulture, out double dabs)) { val = (int)Math.Floor(dabs); return true; }
        err = $"Bad coordinate '{tok}'.";
        return false;
    }

    /// <summary>Resolve a block code (game: domain by default; "air" clears).</summary>
    private Block ResolveBlock(string code, out string err)
    {
        err = null;
        if (string.IsNullOrEmpty(code)) { err = "No block code given."; return null; }
        if (code.Equals("air", StringComparison.OrdinalIgnoreCase)) return sapi.World.GetBlock(0);

        AssetLocation loc = code.Contains(':') ? new AssetLocation(code) : new AssetLocation("game", code);
        Block b = sapi.World.GetBlock(loc);
        if (b == null) err = $"Unknown block '{code}'. Use /blockcode {code} to find a valid code.";
        return b;
    }
}
