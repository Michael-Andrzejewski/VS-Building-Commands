using System;
using Vintagestory.API.Client;

namespace BuildingCommands;

/// <summary>
/// A simple window with a big text box and a Run button. Paste a list of
/// build commands into it (one per line, the same lines a /build script
/// file would hold) and press Run to execute them where you stand. Opened
/// by /build with no script name.
/// </summary>
public class BuildPasteDialog : GuiDialog
{
    private readonly Action<string> onRun;

    public BuildPasteDialog(ICoreClientAPI capi, Action<string> onRun) : base(capi)
    {
        this.onRun = onRun;
        Compose();
    }

    // Not bound to a toggle hotkey; opened on demand.
    public override string ToggleKeyCombinationCode => null;

    private void Compose()
    {
        ElementBounds textBounds = ElementBounds.Fixed(0, 40, 540, 320);
        ElementBounds runBounds = ElementBounds.Fixed(0, 372, 120, 30);
        ElementBounds cancelBounds = ElementBounds.Fixed(140, 372, 120, 30);

        // The background must be told about its children so FitToChildren
        // actually sizes to cover the text area and both buttons. Without
        // this the buttons render outside the interactive dialog box and
        // never receive clicks.
        ElementBounds bgBounds = ElementBounds.Fill.WithFixedPadding(GuiStyle.ElementToDialogPadding);
        bgBounds.BothSizing = ElementSizing.FitToChildren;
        bgBounds.WithChildren(textBounds, runBounds, cancelBounds);

        ElementBounds dialogBounds = ElementStdBounds
            .AutosizedMainDialog
            .WithAlignment(EnumDialogArea.CenterMiddle);

        SingleComposer = capi.Gui.CreateCompo("buildingcommands-paste", dialogBounds)
            .AddShadedDialogBG(bgBounds)
            .AddDialogTitleBar("Paste build commands, then Run", () => TryClose())
            .BeginChildElements()
                .AddTextArea(textBounds, null, CairoFont.WhiteSmallText(), "cmds")
                .AddButton("Run", OnRun, runBounds, CairoFont.WhiteSmallText())
                .AddButton("Cancel", OnCancel, cancelBounds, CairoFont.WhiteSmallText())
            .EndChildElements()
            .Compose();
    }

    private bool OnRun()
    {
        string text = SingleComposer.GetTextArea("cmds")?.GetText() ?? "";
        TryClose();
        onRun?.Invoke(text);
        return true;
    }

    private bool OnCancel()
    {
        TryClose();
        return true;
    }
}
