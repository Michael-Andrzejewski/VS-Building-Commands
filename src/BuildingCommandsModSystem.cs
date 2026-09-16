using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using Vintagestory.API.Client;
using Vintagestory.API.Common;
using Vintagestory.API.Config;
using Vintagestory.API.Datastructures;
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
///   /build &lt;name&gt;   run every command in a script file at once
///
/// Each coordinate may be absolute (100 64 -30) or tilde-relative to the
/// caller (~ ~2 ~-4), matching Minecraft. Block codes take the vanilla
/// game: domain by default, so "stonebricks-granite" resolves to
/// game:stonebricks-granite; "air" clears a block.
///
/// The core of each command lives in a Do* method that takes a plain token
/// list, so both the chat handlers and the /build script runner share the
/// exact same logic.
/// </summary>
public class BuildingCommandsModSystem : ModSystem
{
    // Hard ceiling on how many blocks one /fill or /clone may touch, so a
    // fat-fingered or runaway command can't try to rewrite a whole region
    // and stall the server. 512 x 512 x 2 worth of blocks.
    private const long MaxVolume = 524288;

    // How many ghost cells a preview will draw at most, so a giant build
    // doesn't produce a giant mesh/packet. The full build still places on
    // confirm; only the ghost is capped.
    private const int MaxPreviewCells = 60000;

    private const string ChannelName = "buildingcommands";

    private ICoreServerAPI sapi;
    private ICoreClientAPI capi;
    private IServerNetworkChannel serverChannel;
    private IClientNetworkChannel clientChannel;
    private GhostRenderer ghostRenderer;

    // Per-player pending preview: the build's command lines plus the anchor
    // block the client is currently aiming at (streamed from the client).
    private readonly Dictionary<string, PendingPreview> pending = new();

    // When set, GetOrigin uses this instead of the caller's feet, so /confirm
    // places the build at the ghost's anchor rather than where the player stands.
    private BlockPos originOverride;

    private class PendingPreview
    {
        public List<string> Lines;
        public BlockPos Anchor;
        public int Rotation;
    }

    // Whether the current command's caller has an entity, so ~relative
    // coordinates have an origin. Set per command in GetOrigin; commands are
    // handled one at a time on the server thread. When false, a ~ token is
    // rejected but absolute coordinates still work (e.g. from the console).
    private bool originAvailable;

    // Folder where /build reads .txt command scripts from.
    private string scriptFolder;

    public override void StartServerSide(ICoreServerAPI api)
    {
        sapi = api;

        scriptFolder = Path.Combine(GamePaths.DataPath, "BuildingCommands");
        try { Directory.CreateDirectory(scriptFolder); } catch { /* best effort */ }

        serverChannel = api.Network.RegisterChannel(ChannelName)
            .RegisterMessageType<OpenPasteDialogPacket>()
            .RegisterMessageType<RunPastedTextPacket>()
            .RegisterMessageType<PreviewPastedTextPacket>()
            .RegisterMessageType<PreviewCellsPacket>()
            .RegisterMessageType<PreviewStopPacket>()
            .RegisterMessageType<PreviewAnchorPacket>()
            .SetMessageHandler<RunPastedTextPacket>(OnRunPastedText)
            .SetMessageHandler<PreviewPastedTextPacket>(OnPreviewPastedText)
            .SetMessageHandler<PreviewAnchorPacket>(OnPreviewAnchor);

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

        RegisterCmd(api, "build", name =>
            api.ChatCommands.Create(name)
                .WithDescription("With a name, runs that .txt script from the BuildingCommands folder. With no name, opens a window to paste commands into. ~relative coords are measured from where you stand. Add a direction to turn the whole build, as in /build myhouse north; the script says which way it faces with a `facing` line, north if it says nothing. /build undo puts the world back exactly as it was before the last build, contents of replaced chests included. /build list shows available scripts.")
                .RequiresPrivilege(Privilege.controlserver)
                .WithArgs(p.OptionalWord("name"), p.OptionalWord("facing"))
                .HandleWith(OnBuild));

        RegisterCmd(api, "preview", name =>
            api.ChatCommands.Create(name)
                .WithDescription("Show a build as a translucent ghost at your crosshair without placing it. /preview &lt;script name&gt; &lt;direction&gt;, then aim where you want it and /confirm (or /cancel). The ghost turns with the build.")
                .RequiresPrivilege(Privilege.controlserver)
                .WithArgs(p.OptionalWord("name"), p.OptionalWord("facing"))
                .HandleWith(OnPreview));

        RegisterCmd(api, "confirm", name =>
            api.ChatCommands.Create(name)
                .WithDescription("Place the previewed build for real at the ghost's current spot.")
                .RequiresPrivilege(Privilege.controlserver)
                .HandleWith(OnConfirm));

        RegisterCmd(api, "cancel", name =>
            api.ChatCommands.Create(name)
                .WithDescription("Discard the current build preview.")
                .RequiresPrivilege(Privilege.controlserver)
                .HandleWith(OnCancel));

        api.Logger.Notification($"[buildingcommands] Ready. Put /build scripts (.txt) in: {scriptFolder}");
    }

    public override void StartClientSide(ICoreClientAPI api)
    {
        capi = api;
        clientChannel = api.Network.RegisterChannel(ChannelName)
            .RegisterMessageType<OpenPasteDialogPacket>()
            .RegisterMessageType<RunPastedTextPacket>()
            .RegisterMessageType<PreviewPastedTextPacket>()
            .RegisterMessageType<PreviewCellsPacket>()
            .RegisterMessageType<PreviewStopPacket>()
            .RegisterMessageType<PreviewAnchorPacket>()
            .SetMessageHandler<OpenPasteDialogPacket>(OnOpenPasteDialog)
            .SetMessageHandler<PreviewCellsPacket>(OnPreviewCells)
            .SetMessageHandler<PreviewStopPacket>(OnPreviewStop);

        ghostRenderer = new GhostRenderer(api, clientChannel);
        api.Event.RegisterRenderer(ghostRenderer, EnumRenderStage.Opaque, "buildingcommands-ghost");
    }

    private void OnOpenPasteDialog(OpenPasteDialogPacket packet)
    {
        var dialog = new BuildPasteDialog(capi,
            text => clientChannel.SendPacket(new RunPastedTextPacket { Text = text }),
            text => clientChannel.SendPacket(new PreviewPastedTextPacket { Text = text }));
        dialog.TryOpen();
    }

    private void OnPreviewCells(PreviewCellsPacket packet)
        => ghostRenderer?.SetCells(packet.X, packet.Y, packet.Z, packet.Ids);

    private void OnPreviewStop(PreviewStopPacket packet)
        => ghostRenderer?.Clear();

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
    //  Chat handlers — thin wrappers over the shared Do* core.
    // ─────────────────────────────────────────────────────────────────────
    private TextCommandResult OnFill(TextCommandCallingArgs args) => DoFill(ArgList(args, 9), args.Caller);
    private TextCommandResult OnSetblock(TextCommandCallingArgs args) => DoSetblock(ArgList(args, 5), args.Caller);
    private TextCommandResult OnClone(TextCommandCallingArgs args) => DoClone(ArgList(args, 10), args.Caller);
    private TextCommandResult OnBlockcode(TextCommandCallingArgs args) => DoBlockcode(ArgList(args, 1), args.Caller);

    // ─────────────────────────────────────────────────────────────────────
    //  /build — run a whole script file of commands at once
    // ─────────────────────────────────────────────────────────────────────
    private TextCommandResult OnBuild(TextCommandCallingArgs args)
    {
        string name = args.Parsers[0].GetValue() as string;

        // No name: open the in-game paste window on the calling client.
        if (string.IsNullOrEmpty(name))
        {
            if (args.Caller.Player is IServerPlayer sp)
            {
                serverChannel.SendPacket(new OpenPasteDialogPacket(), sp);
                return TextCommandResult.Success("Opening the paste window. Paste your commands and press Run.");
            }
            return TextCommandResult.Error("Run /build with no name from in game to open the paste window, or /build &lt;name&gt; to run a script file.");
        }

        if (string.Equals(name, "list", StringComparison.OrdinalIgnoreCase)) return ListScripts();
        if (string.Equals(name, "undo", StringComparison.OrdinalIgnoreCase)) return UndoLast(args.Caller);
        return RunScript(name, args.Caller, args.Parsers[1].GetValue() as string);
    }

    // Client -> server: run the pasted text as commands for that player.
    private void OnRunPastedText(IServerPlayer fromPlayer, RunPastedTextPacket packet)
    {
        if (fromPlayer?.Entity == null) return;
        if (!fromPlayer.HasPrivilege(Privilege.controlserver))
        {
            fromPlayer.SendMessage(GlobalConstants.GeneralChatGroup, "You need the controlserver privilege to run build commands.", EnumChatType.CommandError);
            return;
        }

        var caller = new Caller
        {
            Player = fromPlayer,
            Entity = fromPlayer.Entity,
            Type = EnumCallerType.Player
        };

        string text = packet?.Text ?? "";
        string[] lines = text.Replace("\r\n", "\n").Replace("\r", "\n").Split('\n');
        (int ran, int errors, string firstError) = RunLines(lines, caller, 0, "a pasted build");

        string summary = $"Ran {ran} command(s) from paste";
        if (errors > 0) summary += $"; {errors} error(s), first at {firstError}";
        summary += ".";
        summary += _undoNote;
        fromPlayer.SendMessage(GlobalConstants.GeneralChatGroup, summary, EnumChatType.Notification);
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Preview / confirm / cancel
    // ─────────────────────────────────────────────────────────────────────
    private TextCommandResult OnPreview(TextCommandCallingArgs args)
    {
        if (args.Caller.Player is not IServerPlayer sp) return TextCommandResult.Error("Players only.");

        string name = args.Parsers[0].GetValue() as string;
        if (string.IsNullOrEmpty(name))
            return TextCommandResult.Error("Usage: /preview &lt;script name&gt;. Or press Preview in /build's paste window.");
        if (name.IndexOfAny(new[] { '/', '\\', ':' }) >= 0)
            return TextCommandResult.Error("Script name must be a plain file name.");

        string file = name.EndsWith(".txt", StringComparison.OrdinalIgnoreCase) ? name : name + ".txt";
        string path = Path.Combine(scriptFolder, file);
        if (!File.Exists(path))
            return TextCommandResult.Error($"No script '{file}' in {scriptFolder}. Use /build list to see scripts.");

        string[] lines;
        try { lines = File.ReadAllLines(path); }
        catch (Exception e) { return TextCommandResult.Error($"Could not read {file}: {e.Message}"); }

        if (!TryParseRotation(args.Parsers[1].GetValue() as string, ScriptFacing(lines), out int angle, out string ferr))
            return TextCommandResult.Error(ferr);
        return StartPreview(sp, lines, file, angle);
    }

    private TextCommandResult OnConfirm(TextCommandCallingArgs args)
    {
        if (args.Caller.Player is not IServerPlayer sp) return TextCommandResult.Error("Players only.");
        if (!pending.TryGetValue(sp.PlayerUID, out PendingPreview pend))
            return TextCommandResult.Error("No preview to confirm. Start one with /preview &lt;name&gt; or the Preview button.");
        if (pend.Anchor == null)
            return TextCommandResult.Error("Aim at a block so the ghost has a spot, then /confirm.");

        originOverride = pend.Anchor;
        (int ran, int errors, string firstError) = RunLines(pend.Lines, args.Caller, pend.Rotation, "a previewed build");
        originOverride = null;

        pending.Remove(sp.PlayerUID);
        serverChannel.SendPacket(new PreviewStopPacket(), sp);

        string summary = $"Placed {ran} command(s) at {pend.Anchor.X},{pend.Anchor.Y},{pend.Anchor.Z}";
        if (pend.Rotation != 0) summary += $", turned {pend.Rotation} degrees";
        if (errors > 0) summary += $"; {errors} error(s), first at {firstError}";
        summary += ".";
        summary += StuckNote();
        summary += _undoNote;
        return TextCommandResult.Success(summary);
    }

    private TextCommandResult OnCancel(TextCommandCallingArgs args)
    {
        if (args.Caller.Player is not IServerPlayer sp) return TextCommandResult.Error("Players only.");
        if (!pending.Remove(sp.PlayerUID)) return TextCommandResult.Error("No preview to cancel.");
        serverChannel.SendPacket(new PreviewStopPacket(), sp);
        return TextCommandResult.Success("Preview cancelled.");
    }

    private void OnPreviewPastedText(IServerPlayer fromPlayer, PreviewPastedTextPacket packet)
    {
        if (fromPlayer?.Entity == null) return;
        if (!fromPlayer.HasPrivilege(Privilege.controlserver))
        {
            fromPlayer.SendMessage(GlobalConstants.GeneralChatGroup, "You need the controlserver privilege to preview builds.", EnumChatType.CommandError);
            return;
        }

        string text = packet?.Text ?? "";
        string[] lines = text.Replace("\r\n", "\n").Replace("\r", "\n").Split('\n');
        TextCommandResult r = StartPreview(fromPlayer, lines, "paste");
        fromPlayer.SendMessage(GlobalConstants.GeneralChatGroup, r.StatusMessage,
            r.Status == EnumCommandStatus.Success ? EnumChatType.Notification : EnumChatType.CommandError);
    }

    private void OnPreviewAnchor(IServerPlayer fromPlayer, PreviewAnchorPacket packet)
    {
        if (pending.TryGetValue(fromPlayer.PlayerUID, out PendingPreview pend))
            pend.Anchor = new BlockPos(packet.X, packet.Y, packet.Z, packet.Dim);
    }

    private TextCommandResult StartPreview(IServerPlayer sp, string[] lines, string sourceLabel, int rotation = 0)
    {
        ComputePlan(lines, rotation, out int[] xs, out int[] ys, out int[] zs, out int[] ids, out bool capped);
        if (xs.Length == 0)
            return TextCommandResult.Error("That build has no visible blocks to preview (nothing but air, or only clone/blockcode lines).");

        pending[sp.PlayerUID] = new PendingPreview { Lines = new List<string>(lines), Anchor = null, Rotation = rotation };
        serverChannel.SendPacket(new PreviewCellsPacket { X = xs, Y = ys, Z = zs, Ids = ids }, sp);

        string msg = $"Previewing {xs.Length} block(s) from {sourceLabel}. Aim where you want it, then /confirm (or /cancel).";
        if (capped) msg += $" Preview capped at {MaxPreviewCells} blocks; the full build still places on confirm.";
        return TextCommandResult.Success(msg);
    }

    // Dry-run the fill/setblock lines against an origin of (0,0,0) to get the
    // set of blocks the build would place, as offsets for the ghost. keep and
    // replace-filter are shown as plain replace (their result depends on the
    // world at the final spot, which is not known until confirm); clone and
    // blockcode are skipped.
    private void ComputePlan(IEnumerable<string> lines, int rotation, out int[] xs, out int[] ys, out int[] zs, out int[] ids, out bool capped)
    {
        var map = new Dictionary<long, int>();
        capped = false;
        _runRotation = rotation;
        bool prevAvail = originAvailable;
        originAvailable = true;

        foreach (string raw in lines)
        {
            string line = (raw ?? "").Trim();
            if (line.Length == 0 || line.StartsWith("#") || line.StartsWith("//")) continue;
            if (line[0] == '/') line = line.Substring(1);

            string[] tok = line.Split((char[])null, StringSplitOptions.RemoveEmptyEntries);
            if (tok.Length == 0) continue;

            string cmd = tok[0].ToLowerInvariant();
            if (cmd == "fill") AddFillCells(tok, map, ref capped);
            else if (cmd == "setblock" || cmd == "cbsetblock") AddSetblockCells(tok, map, ref capped);
            else if (cmd == "lootchest") AddLootChestCell(tok, map, ref capped);
            else if (cmd == "spawner") AddSpawnerCell(tok, map, ref capped);
            else if (cmd == "ingots") AddIngotsCell(tok, map, ref capped);
            else if (cmd == "translocator") AddTranslocatorCell(tok, map, ref capped);

            if (capped) break;
        }

        originAvailable = prevAvail;
        _runRotation = 0;

        int n = map.Count;
        xs = new int[n]; ys = new int[n]; zs = new int[n]; ids = new int[n];
        int i = 0;
        foreach (var kv in map)
        {
            UnpackPos(kv.Key, out int x, out int y, out int z);
            xs[i] = x; ys[i] = y; zs[i] = z; ids[i] = kv.Value; i++;
        }
    }

    private void AddFillCells(string[] tok, Dictionary<long, int> map, ref bool capped)
    {
        if (tok.Length < 8) return;
        if (!ParseCoord(tok[1], 0, out int x1, out _)) return;
        if (!ParseCoord(tok[2], 0, out int y1, out _)) return;
        if (!ParseCoord(tok[3], 0, out int z1, out _)) return;
        if (!ParseCoord(tok[4], 0, out int x2, out _)) return;
        if (!ParseCoord(tok[5], 0, out int y2, out _)) return;
        if (!ParseCoord(tok[6], 0, out int z2, out _)) return;
        RotXZ(ref x1, ref z1, 0, 0);
        RotXZ(ref x2, ref z2, 0, 0);

        Block block = ResolveBlock(tok[7], out _);
        if (block == null) return;
        int bid = block.BlockId;
        string mode = tok.Length > 8 ? tok[8].ToLowerInvariant() : "replace";

        int minX = Math.Min(x1, x2), maxX = Math.Max(x1, x2);
        int minY = Math.Min(y1, y2), maxY = Math.Max(y1, y2);
        int minZ = Math.Min(z1, z2), maxZ = Math.Max(z1, z2);

        for (int x = minX; x <= maxX; x++)
            for (int y = minY; y <= maxY; y++)
                for (int z = minZ; z <= maxZ; z++)
                {
                    bool shell = x == minX || x == maxX || y == minY || y == maxY || z == minZ || z == maxZ;
                    int cellId;
                    if (mode == "hollow") cellId = shell ? bid : 0;
                    else if (mode == "outline") { if (!shell) continue; cellId = bid; }
                    else cellId = bid;

                    if (cellId == 0) continue; // air is invisible in the ghost
                    map[Pack(x, y, z)] = cellId;
                    if (map.Count >= MaxPreviewCells) { capped = true; return; }
                }
    }

    private void AddSetblockCells(string[] tok, Dictionary<long, int> map, ref bool capped)
    {
        if (tok.Length < 5) return;
        if (!ParseCoord(tok[1], 0, out int x, out _)) return;
        if (!ParseCoord(tok[2], 0, out int y, out _)) return;
        if (!ParseCoord(tok[3], 0, out int z, out _)) return;
        RotXZ(ref x, ref z, 0, 0);

        Block block = ResolveBlock(tok[4], out _);
        if (block == null || block.BlockId == 0) return;

        map[Pack(x, y, z)] = block.BlockId;
        if (map.Count >= MaxPreviewCells) capped = true;
    }

    // Pack a small signed offset (roughly +-1,000,000) into a long key.
    private static long Pack(int x, int y, int z)
    {
        long ux = (long)(x + 1048576) & 0x1FFFFF;
        long uy = (long)(y + 1048576) & 0x1FFFFF;
        long uz = (long)(z + 1048576) & 0x1FFFFF;
        return (ux << 42) | (uy << 21) | uz;
    }

    private static void UnpackPos(long key, out int x, out int y, out int z)
    {
        x = (int)((key >> 42) & 0x1FFFFF) - 1048576;
        y = (int)((key >> 21) & 0x1FFFFF) - 1048576;
        z = (int)(key & 0x1FFFFF) - 1048576;
    }

    /// Names any directional block the run could not turn, so a wrong-facing
    /// chest or stair is reported rather than left to be noticed in the world.
    private string StuckNote()
    {
        if (_rotStuck.Count == 0) return "";
        var names = new List<string>(_rotStuck);
        names.Sort();
        string shown = string.Join(", ", names.GetRange(0, Math.Min(4, names.Count)));
        if (names.Count > 4) shown += $" and {names.Count - 4} more";
        return $" {names.Count} block type(s) could not be turned and were placed unrotated: {shown}.";
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Undo
    //
    //  Every write goes through Rec first, which remembers the block that was
    //  already there, and the block entity's own data when it had one, so a
    //  chest the build paved over comes back with its contents. A position is
    //  recorded once, the FIRST time the build touches it, because a script
    //  usually clears a volume to air and then builds into it, and what we want
    //  back is the world as it stood before any of that.
    // ─────────────────────────────────────────────────────────────────────

    private const int MaxUndoCells = 1000000;   // about 12 MB of record
    private const int UndoDepth = 5;            // builds remembered per player

    private class BuildUndo
    {
        public string Label;
        public int Dim;
        public bool Truncated;
        public readonly Dictionary<long, int> Before = new Dictionary<long, int>();
        public readonly Dictionary<long, byte[]> Entities = new Dictionary<long, byte[]>();
    }

    private readonly Dictionary<string, List<BuildUndo>> undoHistory = new Dictionary<string, List<BuildUndo>>();
    private BuildUndo _recording;
    private string _undoNote = "";

    private static string UndoKey(Caller caller)
    {
        return caller?.Player?.PlayerUID ?? "console";
    }

    private void Rec(BlockPos pos)
    {
        if (_recording == null) return;

        long k = Pack(pos.X, pos.Y, pos.Z);
        if (_recording.Before.ContainsKey(k)) return;
        if (_recording.Before.Count >= MaxUndoCells) { _recording.Truncated = true; return; }

        if (_recording.Before.Count == 0) _recording.Dim = pos.dimension;

        Block cur = sapi.World.BlockAccessor.GetBlock(pos);
        _recording.Before[k] = cur?.BlockId ?? 0;

        // A block entity holds what a bare block id cannot: a chest's contents,
        // a sign's text, a translocator's repair state.
        BlockEntity be = sapi.World.BlockAccessor.GetBlockEntity(pos);
        if (be == null) return;
        try
        {
            var tree = new TreeAttribute();
            be.ToTreeAttributes(tree);
            _recording.Entities[k] = tree.ToBytes();
        }
        catch { }
    }

    private void FinishRecording(Caller caller)
    {
        BuildUndo rec = _recording;
        _recording = null;
        _undoNote = "";
        if (rec == null || rec.Before.Count == 0) return;

        if (rec.Truncated)
        {
            _undoNote = $" This build changed more than {MaxUndoCells} blocks, so it was not recorded and /build undo cannot reverse it.";
            return;
        }

        string key = UndoKey(caller);
        if (!undoHistory.TryGetValue(key, out List<BuildUndo> hist))
        {
            hist = new List<BuildUndo>();
            undoHistory[key] = hist;
        }
        hist.Add(rec);
        while (hist.Count > UndoDepth) hist.RemoveAt(0);
        _undoNote = $" /build undo will put back {rec.Before.Count} block(s).";
    }

    private TextCommandResult UndoLast(Caller caller)
    {
        string key = UndoKey(caller);
        if (!undoHistory.TryGetValue(key, out List<BuildUndo> hist) || hist.Count == 0)
            return TextCommandResult.Error("Nothing to undo. /build undo only reverses builds run since the server started, and keeps the last " + UndoDepth + ".");

        BuildUndo rec = hist[hist.Count - 1];
        hist.RemoveAt(hist.Count - 1);

        // Lowest first, so a block is back before anything that leans on it.
        var cells = new List<int[]>(rec.Before.Count);
        foreach (var kv in rec.Before)
        {
            UnpackPos(kv.Key, out int x, out int y, out int z);
            cells.Add(new[] { y, x, z, kv.Value });
        }
        cells.Sort((a, b) => a[0].CompareTo(b[0]));

        var ba = sapi.World.GetBlockAccessorBulkUpdate(true, true);
        var pos = new BlockPos(0, 0, 0, rec.Dim);
        foreach (int[] c in cells)
        {
            pos.Set(c[1], c[0], c[2]);
            ba.SetBlock(c[3], pos);
        }
        ba.Commit();

        // Now the blocks are back, refill the ones that carried their own data.
        int entities = 0;
        foreach (var kv in rec.Entities)
        {
            UnpackPos(kv.Key, out int x, out int y, out int z);
            pos.Set(x, y, z);
            BlockEntity be = sapi.World.BlockAccessor.GetBlockEntity(pos);
            if (be == null) continue;
            try
            {
                ITreeAttribute tree = TreeAttribute.CreateFromBytes(kv.Value);
                // The game's own schematic loader stamps the position into the
                // tree before loading it, because the saved copy carries the
                // position it was written at. Same here.
                tree.SetInt("posx", pos.X);
                tree.SetInt("posy", pos.InternalY);
                tree.SetInt("posz", pos.Z);
                be.FromTreeAttributes(tree, sapi.World);
                be.MarkDirty(true);
                entities++;
            }
            catch { }
        }

        string summary = $"Undid {rec.Label}: put back {cells.Count} block(s)";
        if (entities > 0) summary += $", including {entities} with their own contents";
        summary += ".";
        summary += hist.Count > 0
            ? $" {hist.Count} earlier build(s) can still be undone."
            : " That was the last one on record.";
        return TextCommandResult.Success(summary);
    }

    private TextCommandResult ListScripts()
    {
        try
        {
            if (!Directory.Exists(scriptFolder)) return TextCommandResult.Success($"No scripts folder yet: {scriptFolder}");
            string[] files = Directory.GetFiles(scriptFolder, "*.txt");
            if (files.Length == 0) return TextCommandResult.Success($"No .txt scripts in {scriptFolder}");
            var names = new List<string>(files.Length);
            foreach (string f in files) names.Add(Path.GetFileNameWithoutExtension(f));
            return TextCommandResult.Success($"Scripts in {scriptFolder}: {string.Join(", ", names)}");
        }
        catch (Exception e)
        {
            return TextCommandResult.Error(e.Message);
        }
    }

    private TextCommandResult RunScript(string name, Caller caller, string facing = null)
    {
        // Only allow a plain file name; no path separators, so scripts can
        // only come from the BuildingCommands folder.
        if (name.IndexOfAny(new[] { '/', '\\', ':' }) >= 0)
            return TextCommandResult.Error("Script name must be a plain file name, no folders.");

        string file = name.EndsWith(".txt", StringComparison.OrdinalIgnoreCase) ? name : name + ".txt";
        string path = Path.Combine(scriptFolder, file);
        if (!File.Exists(path))
            return TextCommandResult.Error($"No script '{file}' in {scriptFolder}. Drop a .txt file of commands there, or use /build list.");

        string[] lines;
        try { lines = File.ReadAllLines(path); }
        catch (Exception e) { return TextCommandResult.Error($"Could not read {file}: {e.Message}"); }

        if (!TryParseRotation(facing, ScriptFacing(lines), out int angle, out string ferr))
            return TextCommandResult.Error(ferr);

        (int ran, int errors, string firstError) = RunLines(lines, caller, angle, file);

        string summary = $"Ran {ran} command(s) from {file}";
        if (angle != 0) summary += $", turned {angle} degrees to face {FacingOrder[Mod4(ScriptFacing(lines) - angle / 90)]}";
        if (errors > 0) summary += $"; {errors} error(s), first at {firstError}";
        summary += ".";
        summary += StuckNote();
        summary += _undoNote;
        return TextCommandResult.Success(summary);
    }

    /// <summary>
    /// Runs each line as one of this mod's commands, using the caller as the
    /// origin for tilde coordinates. Shared by the /build script runner and
    /// the paste window. Returns how many ran, how many errored, and the
    /// first error text. Blank lines and lines starting with # or // are
    /// skipped; a leading / is optional.
    /// </summary>
    // Set once at the start of each script run: a 5% chance that every serpent
    // spawner in this structure becomes a kraken spawner instead.
    private bool _runKrakenMode;

    // Horizontal rotation applied to this whole run, in degrees: 0, 90, 180 or
    // 270, clockwise seen from above. Directional block codes this run could
    // not turn are collected so the summary can name them.
    private int _runRotation;
    private readonly HashSet<string> _rotStuck = new HashSet<string>();

    private (int ran, int errors, string firstError) RunLines(IEnumerable<string> lines, Caller caller, int rotation = 0, string label = "a build")
    {
        int ran = 0, errors = 0, lineNo = 0;
        string firstError = null;
        _runKrakenMode = sapi.World.Rand.NextDouble() < 0.05;
        _runRotation = rotation;
        _rotStuck.Clear();
        _recording = new BuildUndo { Label = label };

        foreach (string raw in lines)
        {
            lineNo++;
            string line = (raw ?? "").Trim();
            if (line.Length == 0 || line.StartsWith("#") || line.StartsWith("//")) continue;
            if (line[0] == '/') line = line.Substring(1);

            string[] tok = line.Split((char[])null, StringSplitOptions.RemoveEmptyEntries);
            if (tok.Length == 0) continue;

            string cmd = tok[0].ToLowerInvariant();
            if (cmd == "facing") continue;          // a declaration, not a command
            var a = new List<string>(tok.Length - 1);
            for (int i = 1; i < tok.Length; i++) a.Add(tok[i]);

            TextCommandResult r;
            switch (cmd)
            {
                case "fill": r = DoFill(a, caller); break;
                case "setblock":
                case "cbsetblock": r = DoSetblock(a, caller); break;
                case "clone": r = DoClone(a, caller); break;
                case "lootchest": r = DoLootChest(a, caller); break;
                case "spawner": r = DoSpawner(a, caller); break;
                case "ingots": r = DoIngots(a, caller); break;
                case "translocator": r = DoTranslocator(a, caller); break;
                case "scatter": r = DoScatter(a, caller); break;
                case "blockcode": r = DoBlockcode(a, caller); break;
                default: r = TextCommandResult.Error($"unknown command '{cmd}' (fill, setblock, clone, lootchest, spawner, translocator, ingots, scatter, blockcode)"); break;
            }

            if (r.Status == EnumCommandStatus.Success)
            {
                ran++;
            }
            else
            {
                errors++;
                if (firstError == null) firstError = $"line {lineNo}: {r.StatusMessage}";
            }
        }

        _runRotation = 0;
        FinishRecording(caller);
        return (ran, errors, firstError);
    }

    // ─────────────────────────────────────────────────────────────────────
    //  /fill
    // ─────────────────────────────────────────────────────────────────────
    private TextCommandResult DoFill(IList<string> a, Caller caller)
    {
        GetOrigin(caller, out int ox, out int oy, out int oz, out int dim);

        if (!ParseCoord(A(a, 0), ox, out int x1, out string e0)) return TextCommandResult.Error(e0);
        if (!ParseCoord(A(a, 1), oy, out int y1, out string e1)) return TextCommandResult.Error(e1);
        if (!ParseCoord(A(a, 2), oz, out int z1, out string e2)) return TextCommandResult.Error(e2);
        if (!ParseCoord(A(a, 3), ox, out int x2, out string e3)) return TextCommandResult.Error(e3);
        if (!ParseCoord(A(a, 4), oy, out int y2, out string e4)) return TextCommandResult.Error(e4);
        if (!ParseCoord(A(a, 5), oz, out int z2, out string e5)) return TextCommandResult.Error(e5);
        RotXZ(ref x1, ref z1, ox, oz);
        RotXZ(ref x2, ref z2, ox, oz);

        Block block = ResolveBlock(A(a, 6), out string berr);
        if (block == null) return TextCommandResult.Error(berr);

        string mode = (A(a, 7) ?? "replace").ToLowerInvariant();
        string filterCode = A(a, 8);
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
                            Rec(pos);
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

                    Rec(pos);
                    ba.SetBlock(block.BlockId, pos);
                    changed++;
                }

        ba.Commit();
        return TextCommandResult.Success($"Filled {changed} block(s) with {block.Code} [{mode}] in ({minX},{minY},{minZ})-({maxX},{maxY},{maxZ}).");
    }

    // ─────────────────────────────────────────────────────────────────────
    //  /setblock
    // ─────────────────────────────────────────────────────────────────────
    private TextCommandResult DoSetblock(IList<string> a, Caller caller)
    {
        GetOrigin(caller, out int ox, out int oy, out int oz, out int dim);

        if (!ParseCoord(A(a, 0), ox, out int x, out string e0)) return TextCommandResult.Error(e0);
        if (!ParseCoord(A(a, 1), oy, out int y, out string e1)) return TextCommandResult.Error(e1);
        if (!ParseCoord(A(a, 2), oz, out int z, out string e2)) return TextCommandResult.Error(e2);
        RotXZ(ref x, ref z, ox, oz);

        Block block = ResolveBlock(A(a, 3), out string berr);
        if (block == null) return TextCommandResult.Error(berr);

        string mode = (A(a, 4) ?? "replace").ToLowerInvariant();
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

        Rec(pos);
        acc.SetBlock(block.BlockId, pos);
        acc.MarkBlockDirty(pos);
        return TextCommandResult.Success($"Set {block.Code} at ({x},{y},{z}).");
    }

    // ─────────────────────────────────────────────────────────────────────
    //  /clone
    // ─────────────────────────────────────────────────────────────────────
    private TextCommandResult DoClone(IList<string> a, Caller caller)
    {
        GetOrigin(caller, out int ox, out int oy, out int oz, out int dim);

        if (!ParseCoord(A(a, 0), ox, out int x1, out string e0)) return TextCommandResult.Error(e0);
        if (!ParseCoord(A(a, 1), oy, out int y1, out string e1)) return TextCommandResult.Error(e1);
        if (!ParseCoord(A(a, 2), oz, out int z1, out string e2)) return TextCommandResult.Error(e2);
        if (!ParseCoord(A(a, 3), ox, out int x2, out string e3)) return TextCommandResult.Error(e3);
        if (!ParseCoord(A(a, 4), oy, out int y2, out string e4)) return TextCommandResult.Error(e4);
        if (!ParseCoord(A(a, 5), oz, out int z2, out string e5)) return TextCommandResult.Error(e5);
        if (!ParseCoord(A(a, 6), ox, out int dx, out string e6)) return TextCommandResult.Error(e6);
        if (!ParseCoord(A(a, 7), oy, out int dy, out string e7)) return TextCommandResult.Error(e7);
        if (!ParseCoord(A(a, 8), oz, out int dz, out string e8)) return TextCommandResult.Error(e8);
        RotXZ(ref x1, ref z1, ox, oz);
        RotXZ(ref x2, ref z2, ox, oz);
        RotXZ(ref dx, ref dz, ox, oz);

        string mode = (A(a, 9) ?? "replace").ToLowerInvariant();
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
                    Rec(wp);
                    ba.SetBlock(id, wp);
                    changed++;
                }

        ba.Commit();
        return TextCommandResult.Success($"Cloned {changed} block(s) to ({dx},{dy},{dz}) [{mode}].");
    }

    // ─────────────────────────────────────────────────────────────────────
    //  /blockcode
    // ─────────────────────────────────────────────────────────────────────
    private TextCommandResult DoBlockcode(IList<string> a, Caller caller)
    {
        string q = (A(a, 0) ?? "").ToLowerInvariant();
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
    //  /lootchest  — a collapsed ruin chest stocked like a lore location
    // ─────────────────────────────────────────────────────────────────────
    // Ruin-appropriate stackrandomizer loot pools (see game stackrandomizer).
    private static readonly string[] RuinLootTypes =
    {
        "gear", "resource", "ruinedweapon", "coppertool", "ingot", "ore",
        "cloth-lowstatus", "accessory-lowstatus", "lantern", "lore-research",
        "lore-diaries", "tuningcylinder"
    };

    // lootchest x y z [1-4] [north|east|south|west]
    // Places a collapsed ruin chest and fills its first few slots with loot,
    // the same way Vintage Story stocks lore-location chests: drop
    // stackrandomizer tokens into the slots and resolve them into real loot.
    private TextCommandResult DoLootChest(IList<string> a, Caller caller)
    {
        GetOrigin(caller, out int ox, out int oy, out int oz, out int dim);

        if (!ParseCoord(A(a, 0), ox, out int x, out string e0)) return TextCommandResult.Error(e0);
        if (!ParseCoord(A(a, 1), oy, out int y, out string e1)) return TextCommandResult.Error(e1);
        if (!ParseCoord(A(a, 2), oz, out int z, out string e2)) return TextCommandResult.Error(e2);
        RotXZ(ref x, ref z, ox, oz);

        var rnd = sapi.World.Rand;
        int variant;
        string typeArg = A(a, 3);
        if (typeArg != null && int.TryParse(typeArg, out int t) && t >= 1 && t <= 4) variant = t;
        // Only 2 and 3 render as a properly burst-open collapsed chest; 1 and 4
        // look near-intact. Default to those two for a real "ruined" look.
        else variant = (rnd.Next(2) == 0) ? 2 : 3;
        string collapsedType = "collapsed" + variant;

        string side = (A(a, 4) ?? "north").ToLowerInvariant();
        if (side != "north" && side != "east" && side != "south" && side != "west") side = "north";

        Block chest = sapi.World.GetBlock(new AssetLocation("game", "chest-" + side));
        if (chest == null) return TextCommandResult.Error($"Chest block game:chest-{side} not found.");

        var pos = new BlockPos(x, y, z, dim);
        var accessor = sapi.World.BlockAccessor;
        SettleOntoSupport(accessor, pos);

        // Place the chest AS a collapsed ruin chest: the block entity reads
        // its type from the placing item stack's attributes.
        var chestStack = new ItemStack(chest);
        chestStack.Attributes.SetString("type", collapsedType);
        Rec(pos);
        accessor.SetBlock(chest.BlockId, pos, chestStack);

        // Belt-and-suspenders: force the block entity's "type" field too, so it
        // always renders as the collapsed variant (and gets retrieveOnly +
        // changeIntoWhenEmpty -> clutter/chestrubble) even if the placing stack
        // did not carry the type through on this VS build.
        var beChest = accessor.GetBlockEntity(pos);
        if (beChest != null)
        {
            var tf = beChest.GetType().GetField("type");
            if (tf != null && tf.FieldType == typeof(string)) tf.SetValue(beChest, collapsedType);
        }
        accessor.MarkBlockDirty(pos);

        int lootSlots = 0;
        if (beChest is IBlockEntityContainer bec && bec.Inventory != null)
        {
            IInventory inv = bec.Inventory;
            int slotCount = inv.Count;
            int toFill = Math.Min(slotCount, 5 + rnd.Next(4));
            for (int idx = 0; idx < toFill; idx++)
            {
                string lootType = RuinLootTypes[rnd.Next(RuinLootTypes.Length)];
                Item randomizer = sapi.World.GetItem(new AssetLocation("game", "stackrandomizer-" + lootType));
                if (randomizer == null) continue;

                ItemSlot slot = inv[idx];
                slot.Itemstack = new ItemStack(randomizer, 1);
                if (randomizer is IResolvableCollectible resolvable)
                    resolvable.Resolve(slot, sapi.World); // becomes real loot (or empty if the roll misses)
                slot.MarkDirty();
                if (slot.Itemstack != null) lootSlots++;
            }
            beChest.MarkDirty(true);
        }

        return TextCommandResult.Success($"Placed a {collapsedType} chest at ({x},{y},{z}) with loot in {lootSlots} slot(s).");
    }

    private void AddLootChestCell(string[] tok, Dictionary<long, int> map, ref bool capped)
    {
        if (tok.Length < 4) return;
        if (!ParseCoord(tok[1], 0, out int x, out _)) return;
        if (!ParseCoord(tok[2], 0, out int y, out _)) return;
        if (!ParseCoord(tok[3], 0, out int z, out _)) return;
        RotXZ(ref x, ref z, 0, 0);

        string side = tok.Length > 5 ? tok[5].ToLowerInvariant() : "north";
        if (side != "north" && side != "east" && side != "south" && side != "west") side = "north";

        Block chest = sapi.World.GetBlock(new AssetLocation("game", "chest-" + side));
        if (chest == null) return;
        map[Pack(x, y, z)] = chest.BlockId;
        if (map.Count >= MaxPreviewCells) capped = true;
    }

    // spawner x y z [serpent|kraken]
    // Places an Underwater Horrors creature spawner. With no type it follows the
    // ruin rules: a 50% chance to place one at all, and 5% of structures (rolled
    // once per run) turn every serpent spawner into a kraken. Passing serpent or
    // kraken always places that one. Skips quietly if Underwater Horrors is
    // not installed.
    // translocator x y z [north|east|south|west]
    // A plain setblock leaves a static translocator UNREPAIRED, which is why a
    // scripted one looks broken. The game repairs it by bumping the block
    // entity's repairState up to RepairInteractionsRequired, so do that here.
    private TextCommandResult DoTranslocator(IList<string> a, Caller caller)
    {
        GetOrigin(caller, out int ox, out int oy, out int oz, out int dim);
        if (!ParseCoord(A(a, 0), ox, out int x, out string e0)) return TextCommandResult.Error(e0);
        if (!ParseCoord(A(a, 1), oy, out int y, out string e1)) return TextCommandResult.Error(e1);
        if (!ParseCoord(A(a, 2), oz, out int z, out string e2)) return TextCommandResult.Error(e2);
        RotXZ(ref x, ref z, ox, oz);

        string side = (A(a, 3) ?? "north").ToLowerInvariant();
        if (side != "north" && side != "east" && side != "south" && side != "west") side = "north";
        side = RotFacingArg(side);

        Block tl = sapi.World.GetBlock(new AssetLocation("game", "statictranslocator-normal-" + side));
        if (tl == null) return TextCommandResult.Error("Block game:statictranslocator-normal-" + side + " not found.");

        var pos = new BlockPos(x, y, z, dim);
        Rec(pos);
        sapi.World.BlockAccessor.SetBlock(tl.BlockId, pos);

        var be = sapi.World.BlockAccessor.GetBlockEntity(pos);
        if (be != null)
        {
            const System.Reflection.BindingFlags anyInst = System.Reflection.BindingFlags.Public
                | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance;
            var t = be.GetType();
            int required = 4;
            var reqF = t.GetField("RepairInteractionsRequired", anyInst);
            if (reqF != null && reqF.FieldType == typeof(int)) required = (int)reqF.GetValue(be);
            var stateF = t.GetField("repairState", anyInst);
            if (stateF != null && stateF.FieldType == typeof(int)) stateF.SetValue(be, required);
            var canF = t.GetField("canTeleport", anyInst);
            if (canF != null && canF.FieldType == typeof(bool)) canF.SetValue(be, true);
            be.MarkDirty(true);
        }
        sapi.World.BlockAccessor.MarkBlockDirty(pos);
        return TextCommandResult.Success($"Placed a repaired translocator at ({x},{y},{z}).");
    }

    private void AddTranslocatorCell(string[] tok, Dictionary<long, int> map, ref bool capped)
    {
        if (tok.Length < 4) return;
        if (!ParseCoord(tok[1], 0, out int x, out _)) return;
        if (!ParseCoord(tok[2], 0, out int y, out _)) return;
        if (!ParseCoord(tok[3], 0, out int z, out _)) return;
        RotXZ(ref x, ref z, 0, 0);
        string side = RotFacingArg(tok.Length > 4 ? tok[4].ToLowerInvariant() : "north");
        Block b = sapi.World.GetBlock(new AssetLocation("game", "statictranslocator-normal-" + side));
        if (b == null) return;
        map[Pack(x, y, z)] = b.BlockId;
        if (map.Count >= MaxPreviewCells) capped = true;
    }

    private TextCommandResult DoSpawner(IList<string> a, Caller caller)
    {
        GetOrigin(caller, out int ox, out int oy, out int oz, out int dim);
        if (!ParseCoord(A(a, 0), ox, out int x, out string e0)) return TextCommandResult.Error(e0);
        if (!ParseCoord(A(a, 1), oy, out int y, out string e1)) return TextCommandResult.Error(e1);
        if (!ParseCoord(A(a, 2), oz, out int z, out string e2)) return TextCommandResult.Error(e2);
        RotXZ(ref x, ref z, ox, oz);

        string typeArg = (A(a, 3) ?? "").ToLowerInvariant();
        bool kraken;
        if (typeArg == "serpent") kraken = false;
        else if (typeArg == "kraken") kraken = true;
        else
        {
            if (sapi.World.Rand.NextDouble() >= 0.85)
                return TextCommandResult.Success("No spawner here (missed the 85% roll).");
            kraken = _runKrakenMode;
        }

        string code = kraken ? "krakenspawner" : "serpentspawner";
        Block spawner = sapi.World.GetBlock(new AssetLocation("underwaterhorrors", code));
        if (spawner == null)
            return TextCommandResult.Error($"Spawner block underwaterhorrors:{code} not found (is Underwater Horrors installed?).");

        var pos = new BlockPos(x, y, z, dim);
        Rec(pos);
        sapi.World.BlockAccessor.SetBlock(spawner.BlockId, pos);
        sapi.World.BlockAccessor.MarkBlockDirty(pos);
        return TextCommandResult.Success($"Placed a {code} at ({x},{y},{z}).");
    }

    private void AddSpawnerCell(string[] tok, Dictionary<long, int> map, ref bool capped)
    {
        if (tok.Length < 4) return;
        if (!ParseCoord(tok[1], 0, out int x, out _)) return;
        if (!ParseCoord(tok[2], 0, out int y, out _)) return;
        if (!ParseCoord(tok[3], 0, out int z, out _)) return;
        RotXZ(ref x, ref z, 0, 0);
        Block b = sapi.World.GetBlock(new AssetLocation("underwaterhorrors", "serpentspawner"));
        if (b == null) return;
        map[Pack(x, y, z)] = b.BlockId;
        if (map.Count >= MaxPreviewCells) capped = true;
    }

    // ingots x y z <metal> <count>
    // Places a game:ingotpile and stocks it with <count> ingots of <metal>.
    // The pile is a block entity, so a plain setblock would render an empty
    // pile; we populate its inventory and re-tessellate.
    private TextCommandResult DoIngots(IList<string> a, Caller caller)
    {
        GetOrigin(caller, out int ox, out int oy, out int oz, out int dim);
        if (!ParseCoord(A(a, 0), ox, out int x, out string e0)) return TextCommandResult.Error(e0);
        if (!ParseCoord(A(a, 1), oy, out int y, out string e1)) return TextCommandResult.Error(e1);
        if (!ParseCoord(A(a, 2), oz, out int z, out string e2)) return TextCommandResult.Error(e2);
        RotXZ(ref x, ref z, ox, oz);

        string metal = (A(a, 3) ?? "copper").ToLowerInvariant();
        int count = 8;
        if (A(a, 4) != null && int.TryParse(A(a, 4), out int c)) count = Math.Max(1, Math.Min(64, c));

        // Modern ground storage, the same thing a player creates by
        // sneak-placing ingots. The legacy game:ingotpile block entity is no
        // longer created by any vanilla code path and renders invisible.
        Item ingot = sapi.World.GetItem(new AssetLocation("game", "ingot-" + metal));
        if (ingot == null) return TextCommandResult.Error($"Ingot item game:ingot-{metal} not found.");
        if (ingot.GetBehavior<Vintagestory.GameContent.CollectibleBehaviorGroundStorable>() == null)
            return TextCommandResult.Error($"game:ingot-{metal} is not ground-storable.");
        Block storage = sapi.World.GetBlock(new AssetLocation("game", "groundstorage"));
        if (storage == null) return TextCommandResult.Error("Block game:groundstorage not found.");

        var pos = new BlockPos(x, y, z, dim);
        var accessor = sapi.World.BlockAccessor;
        SettleOntoSupport(accessor, pos);
        Rec(pos);
        accessor.SetBlock(storage.BlockId, pos);

        if (accessor.GetBlockEntity(pos) is not Vintagestory.GameContent.BlockEntityGroundStorage be)
            return TextCommandResult.Error("Ground storage block entity did not spawn.");

        be.Inventory[0].Itemstack = new ItemStack(ingot, count);
        be.Inventory[0].MarkDirty();
        be.DetermineStorageProperties(null);
        be.MarkDirty(true);
        accessor.MarkBlockDirty(pos);
        return TextCommandResult.Success($"Placed a pile of {count} {metal} ingot(s) at ({x},{y},{z}).");
    }

    // scatter x y z <block> [count] — debris that settles onto the nearest
    // solid surface below the scripted spot instead of trusting a flat-floor
    // assumption. A spot buried in terrain, or with no support within 20
    // blocks below, places nothing (so scripts never leave floating debris).
    // count (1-8) stacks a small column upward from the support, letting
    // rubble mounds drape over uneven ground column by column.
    private TextCommandResult DoScatter(IList<string> a, Caller caller)
    {
        GetOrigin(caller, out int ox, out int oy, out int oz, out int dim);
        if (!ParseCoord(A(a, 0), ox, out int x, out string e0)) return TextCommandResult.Error(e0);
        if (!ParseCoord(A(a, 1), oy, out int y, out string e1)) return TextCommandResult.Error(e1);
        if (!ParseCoord(A(a, 2), oz, out int z, out string e2)) return TextCommandResult.Error(e2);
        RotXZ(ref x, ref z, ox, oz);

        Block block = ResolveBlock(A(a, 3), out string berr);
        if (block == null) return TextCommandResult.Error(berr);
        int count = 1;
        if (A(a, 4) != null && int.TryParse(A(a, 4), out int c)) count = Math.Max(1, Math.Min(8, c));

        var accessor = sapi.World.BlockAccessor;
        var pos = new BlockPos(x, y, z, dim);
        if (IsScatterSupport(accessor.GetBlock(pos)))
            return TextCommandResult.Success($"Scatter spot ({x},{y},{z}) is inside something solid; skipped.");

        int baseY = int.MinValue;
        var p = new BlockPos(x, 0, z, dim);
        for (int yy = y - 1; yy >= Math.Max(1, y - 20); yy--)
        {
            p.Y = yy;
            if (IsScatterSupport(accessor.GetBlock(p))) { baseY = yy + 1; break; }
        }
        if (baseY == int.MinValue)
            return TextCommandResult.Success($"No support below ({x},{y},{z}); skipped so nothing floats.");

        for (int i = 0; i < count; i++)
        {
            p.Y = baseY + i;
            Rec(p);
            accessor.SetBlock(block.BlockId, p);
        }
        return TextCommandResult.Success($"Scattered {count} block(s) at ({x},{baseY},{z}).");
    }

    // Support = something with a collision box. Water, kelp and other
    // collisionless blocks do not count, so debris sinks through them.
    private static bool IsScatterSupport(Block b)
    {
        return b != null && b.Id != 0 && b.CollisionBoxes != null && b.CollisionBoxes.Length > 0;
    }

    // Drops a loot position onto the nearest solid support below (12 blocks
    // max), so chests and ingot piles never hover over floor gaps or slope
    // dips. Keeps the given spot when it is already supported or when no
    // support is in reach (better a rare floater than lost loot).
    private static void SettleOntoSupport(IBlockAccessor accessor, BlockPos pos)
    {
        var p = new BlockPos(pos.X, pos.Y - 1, pos.Z, pos.dimension);
        if (IsScatterSupport(accessor.GetBlock(p))) return;
        for (int y = pos.Y - 2; y >= Math.Max(1, pos.Y - 12); y--)
        {
            p.Y = y;
            if (IsScatterSupport(accessor.GetBlock(p))) { pos.Y = y + 1; return; }
        }
    }

    // Finds a block entity's inventory whether it exposes IBlockEntityContainer
    // or just an "inventory" field (item piles do the latter).
    private static IInventory GetBlockEntityInventory(BlockEntity be)
    {
        if (be == null) return null;
        if (be is IBlockEntityContainer c && c.Inventory != null) return c.Inventory;
        for (Type t = be.GetType(); t != null; t = t.BaseType)
        {
            var f = t.GetField("inventory", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
            if (f != null && typeof(IInventory).IsAssignableFrom(f.FieldType)) return f.GetValue(be) as IInventory;
        }
        return null;
    }

    private void AddIngotsCell(string[] tok, Dictionary<long, int> map, ref bool capped)
    {
        if (tok.Length < 4) return;
        if (!ParseCoord(tok[1], 0, out int x, out _)) return;
        if (!ParseCoord(tok[2], 0, out int y, out _)) return;
        if (!ParseCoord(tok[3], 0, out int z, out _)) return;
        RotXZ(ref x, ref z, 0, 0);
        Block b = sapi.World.GetBlock(new AssetLocation("game", "ingotpile"));
        if (b == null) return;
        map[Pack(x, y, z)] = b.BlockId;
        if (map.Count >= MaxPreviewCells) capped = true;
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Helpers
    // ─────────────────────────────────────────────────────────────────────
    private static List<string> ArgList(TextCommandCallingArgs args, int count)
    {
        var list = new List<string>(count);
        for (int i = 0; i < count; i++) list.Add(args.Parsers[i].GetValue() as string);
        return list;
    }

    private static string A(IList<string> a, int i) => i >= 0 && i < a.Count ? a[i] : null;

    /// <summary>
    /// Caller's block position, used as the origin for ~relative coords, and
    /// the dimension writes go to. When the caller has no entity (server
    /// console) the origin is 0 and originAvailable is set false, so ~ tokens
    /// are rejected but absolute coordinates still work.
    /// </summary>
    private void GetOrigin(Caller caller, out int ox, out int oy, out int oz, out int dim)
    {
        // /confirm places the build at the ghost's anchor, not the player's feet.
        if (originOverride != null)
        {
            ox = originOverride.X;
            oy = originOverride.Y;
            oz = originOverride.Z;
            dim = originOverride.dimension;
            originAvailable = true;
            return;
        }

        var entity = caller?.Entity;
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
    // ─────────────────────────────────────────────────────────────────────
    //  Rotation
    //
    //  /build &lt;name&gt; &lt;direction&gt; turns the whole build so it faces that way.
    //  A script says which way it faces as written with a `facing` line; with
    //  no such line we assume north, so /build &lt;name&gt; north leaves an
    //  undeclared script exactly as it was.
    //
    //  Angles are degrees clockwise seen from above, which is the same sense
    //  the game uses in GetRotatedBlockCode: a facing's index runs east,
    //  north, west, south and rotating SUBTRACTS angle/90 from it. Coordinates
    //  and block variants have to share one convention or a turned build comes
    //  out with its stairs and fences pointing the wrong way.
    // ─────────────────────────────────────────────────────────────────────

    private static readonly string[] FacingOrder = { "east", "north", "west", "south" };

    private static int Mod4(int v) { return ((v % 4) + 4) % 4; }

    private static bool TryParseFacing(string word, out int index)
    {
        index = -1;
        if (string.IsNullOrEmpty(word)) return false;
        switch (word.ToLowerInvariant())
        {
            case "e": case "east": index = 0; return true;
            case "n": case "north": index = 1; return true;
            case "w": case "west": index = 2; return true;
            case "s": case "south": index = 3; return true;
        }
        return false;
    }

    /// Works out the angle that turns a build facing declaredIndex so that it
    /// faces whatever the player asked for. A bare number is taken as the angle.
    private static bool TryParseRotation(string word, int declaredIndex, out int angle, out string err)
    {
        angle = 0; err = null;
        if (string.IsNullOrWhiteSpace(word)) return true;
        if (TryParseFacing(word, out int want))
        {
            angle = Mod4(declaredIndex - want) * 90;
            return true;
        }
        if (int.TryParse(word, out int deg))
        {
            deg = ((deg % 360) + 360) % 360;
            if (deg % 90 == 0) { angle = deg; return true; }
        }
        err = $"'{word}' is not a direction. Use north, east, south or west, or an angle of 0, 90, 180 or 270.";
        return false;
    }

    /// Reads a leading `facing &lt;dir&gt;` declaration off a script. Absent, a build
    /// is taken to face north.
    private static int ScriptFacing(IEnumerable<string> lines)
    {
        foreach (string raw in lines)
        {
            string line = (raw ?? "").Trim();
            if (line.Length == 0 || line.StartsWith("#") || line.StartsWith("//")) continue;
            if (line[0] == '/') line = line.Substring(1);
            string[] tok = line.Split((char[])null, StringSplitOptions.RemoveEmptyEntries);
            if (tok.Length >= 2 && tok[0].Equals("facing", StringComparison.OrdinalIgnoreCase)
                && TryParseFacing(tok[1], out int idx)) return idx;
            break;                      // the first real line was not a declaration
        }
        return 1;                       // north
    }

    /// Turns a position about the build's origin. y is untouched.
    private void RotXZ(ref int x, ref int z, int ox, int oz)
    {
        if (_runRotation == 0) return;
        int dx = x - ox, dz = z - oz;
        switch (_runRotation)
        {
            case 90: x = ox - dz; z = oz + dx; break;
            case 180: x = ox - dx; z = oz - dz; break;
            case 270: x = ox + dz; z = oz - dx; break;
        }
    }

    /// Turns a compass word given as a command argument, such as the side on a
    /// translocator line.
    private string RotFacingArg(string side)
    {
        if (_runRotation == 0 || !TryParseFacing(side, out int idx)) return side;
        return FacingOrder[Mod4(idx - _runRotation / 90)];
    }

    private Block RotateBlock(Block b)
    {
        if (_runRotation == 0 || b == null || b.BlockId == 0) return b;

        // Ask the block itself first. Fences, stairs, slabs, panes, logs,
        // planks, ladders, doors, beds, shelves, lanterns and slanted roofing
        // all implement this; anything that does not hands its own code back.
        AssetLocation spun = null;
        try { spun = b.GetRotatedBlockCode(_runRotation); } catch { }
        if (spun != null && !spun.Equals(b.Code))
        {
            Block r = sapi.World.GetBlock(spun);
            if (r != null) return r;
            _rotStuck.Add(b.Code.ToShortString());
            return b;
        }

        // Some blocks carry a compass word in their code and still never
        // implement rotation; chests are the one a house actually hits, and the
        // game's own worldedit rotate leaves those facing the wrong way too.
        // Turn the word ourselves, and keep it only if that is a real block.
        AssetLocation byWord = SpinCompassWord(b.Code);
        if (byWord == null) return b;
        Block w = sapi.World.GetBlock(byWord);
        if (w != null) return w;
        _rotStuck.Add(b.Code.ToShortString());
        return b;
    }

    /// Rewrites any whole north/east/south/west segment of a block code.
    /// Returns null when the code holds no compass word, so a plain block is
    /// never touched.
    private AssetLocation SpinCompassWord(AssetLocation code)
    {
        string[] parts = code.Path.Split('-');
        bool hit = false;
        for (int i = 0; i < parts.Length; i++)
        {
            if (parts[i].Length < 4) continue;      // a whole word, not an ns/we axis letter
            if (!TryParseFacing(parts[i], out int idx)) continue;
            parts[i] = FacingOrder[Mod4(idx - _runRotation / 90)];
            hit = true;
        }
        return hit ? new AssetLocation(code.Domain, string.Join("-", parts)) : null;
    }

    private Block ResolveBlock(string code, out string err)
    {
        err = null;
        if (string.IsNullOrEmpty(code)) { err = "No block code given."; return null; }
        if (code.Equals("air", StringComparison.OrdinalIgnoreCase)) return sapi.World.GetBlock(0);

        AssetLocation loc = code.Contains(':') ? new AssetLocation(code) : new AssetLocation("game", code);
        Block b = sapi.World.GetBlock(loc);
        if (b == null) { err = $"Unknown block '{code}'. Use /blockcode {code} to find a valid code."; return null; }
        return RotateBlock(b);
    }
}
