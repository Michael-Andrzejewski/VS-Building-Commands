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
        ElementBounds textBounds = ElementBounds.Fixed(0, 34, 540, 320);
        ElementBounds runBounds = ElementBounds.Fixed(0, 364, 120, 28);
        ElementBounds cancelBounds = ElementBounds.Fixed(140, 364, 120, 28);

        ElementBounds bgBounds = ElementBounds.Fill.WithFixedPadding(GuiStyle.ElementToDialogPadding);
        bgBounds.BothSizing = ElementSizing.FitToChildren;

        ElementBounds dialogBounds = ElementStdBounds
            .AutosizedMainDialog
            .WithAlignment(EnumDialogArea.CenterMiddle);

        SingleComposer = capi.Gui.CreateCompo("buildingcommands-paste", dialogBounds)
            .AddShadedDialogBG(bgBounds)
            .AddDialogTitleBar("Paste build commands, then Run", () => TryClose())
            .BeginChildElements(bgBounds)
                .AddTextArea(textBounds, null, CairoFont.WhiteSmallText(), "cmds")
                .AddSmallButton("Run", OnRun, runBounds)
                .AddSmallButton("Cancel", OnCancel, cancelBounds)
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
