using System;
using Vintagestory.API.Client;

namespace BuildingCommands;

/// <summary>
/// A simple window with a big text box and Preview / Run / Cancel buttons.
/// Paste a list of build commands (one per line, the same lines a /build
/// script file would hold). Run executes them where you stand; Preview shows
/// them as a movable ghost you place with /confirm. Opened by /build with no
/// script name.
/// </summary>
public class BuildPasteDialog : GuiDialog
{
    private readonly Action<string> onRun;
    private readonly Action<string> onPreview;

    public BuildPasteDialog(ICoreClientAPI capi, Action<string> onRun, Action<string> onPreview) : base(capi)
    {
        this.onRun = onRun;
        this.onPreview = onPreview;
        Compose();
    }

    // Not bound to a toggle hotkey; opened on demand.
    public override string ToggleKeyCombinationCode => null;

    private void Compose()
    {
        ElementBounds textBounds = ElementBounds.Fixed(0, 40, 560, 320);
        ElementBounds previewBounds = ElementBounds.Fixed(0, 372, 130, 30);
        ElementBounds runBounds = ElementBounds.Fixed(150, 372, 130, 30);
        ElementBounds cancelBounds = ElementBounds.Fixed(300, 372, 130, 30);

        // The background must be told about its children so FitToChildren
        // sizes to cover the text area and the buttons; otherwise the buttons
        // render outside the interactive box and never receive clicks.
        ElementBounds bgBounds = ElementBounds.Fill.WithFixedPadding(GuiStyle.ElementToDialogPadding);
        bgBounds.BothSizing = ElementSizing.FitToChildren;
        bgBounds.WithChildren(textBounds, previewBounds, runBounds, cancelBounds);

        ElementBounds dialogBounds = ElementStdBounds
            .AutosizedMainDialog
            .WithAlignment(EnumDialogArea.CenterMiddle);

        SingleComposer = capi.Gui.CreateCompo("buildingcommands-paste", dialogBounds)
            .AddShadedDialogBG(bgBounds)
            .AddDialogTitleBar("Paste build commands", () => TryClose())
            .BeginChildElements()
                .AddTextArea(textBounds, null, CairoFont.WhiteSmallText(), "cmds")
                .AddButton("Preview", OnPreview, previewBounds, CairoFont.WhiteSmallText())
                .AddButton("Run", OnRun, runBounds, CairoFont.WhiteSmallText())
                .AddButton("Cancel", OnCancel, cancelBounds, CairoFont.WhiteSmallText())
            .EndChildElements()
            .Compose();
    }

    private bool OnPreview()
    {
        string text = SingleComposer.GetTextArea("cmds")?.GetText() ?? "";
        TryClose();
        onPreview?.Invoke(text);
        return true;
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
