using System.Collections.Generic;
using Vintagestory.API.Client;
using Vintagestory.API.Common;
using Vintagestory.API.MathTools;

namespace BuildingCommands;

/// <summary>
/// Renders the pending build as a translucent ghost at the block the player
/// is aiming at, and streams that anchor back to the server so a later
/// /confirm places the build there. Active only while a preview is running.
/// </summary>
public class GhostRenderer : IRenderer
{
    private readonly ICoreClientAPI capi;
    private readonly IClientNetworkChannel channel;

    private MeshRef meshRef;
    private bool active;

    private BlockPos anchor = new BlockPos(0);
    private BlockPos lastSent;
    private float sendAccum;

    public double RenderOrder => 0.5;
    public int RenderRange => 128;

    public GhostRenderer(ICoreClientAPI capi, IClientNetworkChannel channel)
    {
        this.capi = capi;
        this.channel = channel;
    }

    /// <summary>Build the ghost mesh from the streamed cells and start rendering.</summary>
    public void SetCells(int[] xs, int[] ys, int[] zs, int[] ids)
    {
        DisposeMesh();

        MeshData combined = null;
        int n = xs?.Length ?? 0;
        for (int i = 0; i < n; i++)
        {
            Block block = capi.World.GetBlock(ids[i]);
            if (block == null || block.Id == 0) continue;

            capi.Tesselator.TesselateBlock(block, out MeshData bm);
            if (bm == null) continue;

            bm.Translate(xs[i], ys[i], zs[i]);
            if (combined == null) combined = bm;
            else combined.AddMeshData(bm);
        }

        if (combined == null || combined.VerticesCount == 0)
        {
            active = false;
            return;
        }

        meshRef = capi.Render.UploadMesh(combined);
        active = true;
        lastSent = null;
        sendAccum = 0;
    }

    public void Clear()
    {
        active = false;
        DisposeMesh();
    }

    public void OnRenderFrame(float dt, EnumRenderStage stage)
    {
        if (!active || meshRef == null) return;

        IClientPlayer player = capi.World.Player;
        if (player?.Entity == null) return;

        // Anchor to the block the crosshair is on; fall back to the player's
        // own block when looking at open sky.
        BlockSelection bs = player.CurrentBlockSelection;
        anchor = bs?.Position != null ? bs.Position.Copy() : player.Entity.Pos.AsBlockPos;

        IRenderAPI rpi = capi.Render;
        Vec3d cam = player.Entity.CameraPos;

        rpi.GlDisableCullFace();
        rpi.GlToggleBlend(true);

        IStandardShaderProgram prog = rpi.PreparedStandardShader(anchor.X, anchor.Y, anchor.Z);
        prog.Tex2D = capi.BlockTextureAtlas.AtlasTextures[0].TextureId;
        prog.RgbaTint = new Vec4f(0.55f, 0.85f, 1f, 0.42f);
        prog.ModelMatrix = new Matrixf()
            .Identity()
            .Translate((float)(anchor.X - cam.X), (float)(anchor.Y - cam.Y), (float)(anchor.Z - cam.Z))
            .Values;
        prog.ViewMatrix = rpi.CameraMatrixOriginf;
        prog.ProjectionMatrix = rpi.CurrentProjectionMatrix;
        rpi.RenderMesh(meshRef);
        prog.Stop();

        rpi.GlToggleBlend(false);
        rpi.GlEnableCullFace();

        // Throttle-stream the anchor to the server when it changes.
        sendAccum += dt;
        if (sendAccum >= 0.15f && (lastSent == null || !lastSent.Equals(anchor)))
        {
            sendAccum = 0;
            lastSent = anchor.Copy();
            channel.SendPacket(new PreviewAnchorPacket { X = anchor.X, Y = anchor.Y, Z = anchor.Z, Dim = anchor.dimension });
        }
    }

    private void DisposeMesh()
    {
        if (meshRef != null)
        {
            capi.Render.DeleteMesh(meshRef);
            meshRef = null;
        }
    }

    public void Dispose()
    {
        DisposeMesh();
    }
}
