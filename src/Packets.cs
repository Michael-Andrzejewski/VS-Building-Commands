using ProtoBuf;

namespace BuildingCommands;

// Server -> client: tells the calling client to open the paste window.
[ProtoContract]
public class OpenPasteDialogPacket
{
}

// Client -> server: the text pasted into the window, to run line by line.
[ProtoContract]
public class RunPastedTextPacket
{
    [ProtoMember(1)]
    public string Text;
}

// Client -> server: the pasted text, but to PREVIEW as a ghost instead of run.
[ProtoContract]
public class PreviewPastedTextPacket
{
    [ProtoMember(1)]
    public string Text;
}

// Server -> client: the block cells to render as a translucent ghost.
// Parallel arrays: cell i is at (X[i], Y[i], Z[i]) offset with block id Ids[i].
[ProtoContract]
public class PreviewCellsPacket
{
    [ProtoMember(1)]
    public int[] X;
    [ProtoMember(2)]
    public int[] Y;
    [ProtoMember(3)]
    public int[] Z;
    [ProtoMember(4)]
    public int[] Ids;
}

// Server -> client: stop rendering the ghost (on confirm or cancel).
[ProtoContract]
public class PreviewStopPacket
{
}

// Client -> server: where the player is currently aiming the ghost, so a
// later /confirm places the build there.
[ProtoContract]
public class PreviewAnchorPacket
{
    [ProtoMember(1)]
    public int X;
    [ProtoMember(2)]
    public int Y;
    [ProtoMember(3)]
    public int Z;
    [ProtoMember(4)]
    public int Dim;
}
