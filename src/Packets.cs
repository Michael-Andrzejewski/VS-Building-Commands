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
