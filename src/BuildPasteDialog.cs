using System;
using Vintagestory.API.Client;

namespace BuildingCommands;

/// <summary>
/// A window with Preview / Run / Cancel buttons and a big text box below
/// them. Paste build commands (one per line) and Run to execute, or Preview
/// to see them as a ghost. Opened by /build with no script name.
///
/// The buttons sit ABOVE the text area on purpose: an earlier layout put
/// them below and the clicks never registered, so this keeps them clear of
/// the text area entirely. Temporary click logging is included to confirm
/// the buttons receive input.
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
        // Buttons row directly under the title bar, text area below them.
        ElementBounds previewBounds = ElementBounds.Fixed(0, 34, 130, 30);
        ElementBounds runBounds = ElementBounds.Fixed(150, 34, 130, 30);
        ElementBounds cancelBounds = ElementBounds.Fixed(300, 34, 130, 30);
        ElementBounds textBounds = ElementBounds.Fixed(0, 74, 560, 320);

        ElementBounds bgBounds = ElementBounds.Fill.WithFixedPadding(GuiStyle.ElementToDialogPadding);
        bgBounds.BothSizing = ElementSizing.FitToChildren;
        bgBounds.WithChildren(previewBounds, runBounds, cancelBounds, textBounds);

        ElementBounds dialogBounds = ElementStdBounds
            .AutosizedMainDialog
            .WithAlignment(EnumDialogArea.CenterMiddle);

        SingleComposer = capi.Gui.CreateCompo("buildingcommands-paste", dialogBounds)
            .AddShadedDialogBG(bgBounds)
            .AddDialogTitleBar("Build commands: Preview or Run", () => TryClose())
            .BeginChildElements(bgBounds)
                .AddButton("Preview", OnPreview, previewBounds, CairoFont.WhiteSmallText())
                .AddButton("Run", OnRun, runBounds, CairoFont.WhiteSmallText())
                .AddButton("Cancel", OnCancel, cancelBounds, CairoFont.WhiteSmallText())
                .AddTextArea(textBounds, null, CairoFont.WhiteSmallText(), "cmds")
            .EndChildElements()
            .Compose();
    }

    // Temporary diagnostics: log every click reaching the dialog and whether
    // an element consumed it, so we can see if the buttons receive input.
    public override void OnMouseUp(MouseEvent args)
    {
        base.OnMouseUp(args);
        capi.Logger.Notification($"[buildingcommands] paste dialog mouseUp screen=({args.X},{args.Y}) handled={args.Handled}");
    }

    private bool OnPreview()
    {
        capi.Logger.Notification("[buildingcommands] Preview button clicked");
        string text = SingleComposer.GetTextArea("cmds")?.GetText() ?? "";
        TryClose();
        onPreview?.Invoke(text);
        return true;
    }

    private bool OnRun()
    {
        capi.Logger.Notification("[buildingcommands] Run button clicked");
        string text = SingleComposer.GetTextArea("cmds")?.GetText() ?? "";
        TryClose();
        onRun?.Invoke(text);
        return true;
    }

    private bool OnCancel()
    {
        capi.Logger.Notification("[buildingcommands] Cancel button clicked");
        TryClose();
        return true;
    }
}
