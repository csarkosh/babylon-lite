# Babylon Lite, as Day Hike uses it

This repository holds `@babylonjs/lite` as published on npm, with Day Hike's patches as commits on
top. It is not a fork of the Babylon-Lite repository: the published package is 13 MB packed, the
repository 240 MB that every clone and install would pay for. What is patched is therefore the
compiled `lib/` (one file a source module) and `index.d.ts`, not the TypeScript they were built from.

- The first commit on each `upstream` line is the npm tarball of that version, untouched
  (`package.json`'s `babylonLiteRelease.sourceVersion` records the Babylon-Lite commit it was built
  from). Tag `v<version>`.
- Day Hike's patches follow, each a commit that adds a hook or mends one, and no feature. Tag
  `v<version>-dayhike.<n>` for each state Day Hike depends on; Day Hike pins the tag
  (`"@babylonjs/lite": "github:csarkosh/babylon-lite#v<version>-dayhike.<n>"`).
- To move to a new Lite: commit the next tarball as `v<version>`, rebase the patch commits onto it,
  tag `v<version>-dayhike.1`, and point Day Hike at the tag. The compiled files change shape between
  versions (the `_chunks/` names carry hashes), so a patch may need its site found again; each
  commit's message says what the site is for.

The first three tags' patches concern material plugins on the PBR material: Day Hike's look is a
stack of plugins that, on Babylon.js, edit the PBR shader at its named points and by regex. The
fourth tag's concern what a frame costs the main thread, the fifth's what a whole view of the game
needed.

Patches so far. Tag `v1.39.3-dayhike.1`:

- **A plugin's BEFORE_LIGHTS code follows the features' code at that point.** The composer filled a
  slot in the order of the fragments' ids, so a plugin's code came before the reflectance feature's,
  where every glTF material's `colorF0` and `surfaceAlbedo` are declared.
- **The reflectance feature's `surfaceAlbedo` is a `var`**, as the plain path's is, so a plugin can
  change the albedo before the lights on a loaded material as on a made one.
- **BEFORE_FINALCOLORCOMPOSITION runs a PBR plugin's code once.** The plain bridge mapped the point
  to two slots the PBR template both carries; a fog there was applied twice. A fix, not a hook.
- **A plugin's per-instance attributes:** `MaterialPlugin.getInstanceAttributes()` declares
  instance-step vertex attributes, fed from the mesh's `thinInstances.pluginData` (bump
  `pluginVersion` after changing it in place). With `enablePbrMaterialPluginVertexData()`. The direct
  thin-instance draw path only: not with GPU culling or a LOD partner, which compact the matrices
  and do not compact this.
- **`CUSTOM_FRAGMENT_LIGHT`, a point inside the PBR light loop**, after a light's diffuse term is
  added and before its specular: the light's result is `pl` (`L`, `NdotL`, `atten`, `color`,
  `isHemi`), its entry `lights.lights[lightIndex]`, its shadow factor `sf`, and `directDiffuse` the
  running sum. The multi-light loop only.
- **`CUSTOM_VERTEX_DEFINITIONS`:** a plugin's helper functions for the vertex stage. With
  `enablePbrMaterialPluginVertexData()`.

Tag `v1.39.3-dayhike.2`:

- **A plugin's texture without a sampler of its own.** Each texture a plugin declared brought a
  sampler, and a stage has sixteen. A `PluginSamplerDecl` may leave `sampler` out (a texture read
  with `textureLoad`, or through another declaration's sampler), with `sampler: false` on its
  `PluginTextureBinding`. Its `textureType` also says `texture_2d_array<f32>`, and a `sampleType`
  reaches the bind group layout (`"unfilterable-float"` for a 32-bit float data texture).
- **`Camera.projectionHook`**, handed the projection a camera has just computed, to change it in
  place: a sub-pixel jitter for a temporal anti-aliasing of one's own, an oblique near plane for a
  mirror. The matrix is cached; bump `projectionVersion` when what the hook writes changes.

Tag `v1.39.3-dayhike.3`:

- **A plugin's per-vertex attributes:** `MaterialPlugin.getVertexAttributes()` declares vertex-step
  attributes in one interleaved buffer, fed from the mesh's `pluginVertexData` (bump
  `pluginVertexVersion` after changing it in place; it is uploaded when the mesh is next recorded).
  With `enablePbrMaterialPluginVertexData()`. Every mesh drawn with the material must carry the data.
- **A plugin's global directives for the fragment module:** `getFragmentDirectives()` returns text
  placed before everything else in it, e.g. `diagnostic(off,derivative_uniformity);` for a plugin
  that samples inside a branch or a loop.
- **The plain path's `colorF90` is a `var`**, as `colorF0` and `surfaceAlbedo` are, so a plugin can
  scale a dielectric's grazing reflectance with its F0.

Tag `v1.39.3-dayhike.4`, each counted on a replay of Day Hike's own draw lists (352 draws at the
trailhead) with the pictures unchanged:

- **One uniform buffer a PBR material**, shared by the meshes drawn with it. A renderable made its
  own, so a material whose uniforms changed was written once a mesh: 353 buffer writes a frame with
  a plugin whose uniforms move every frame, 72 after (one a material).
- **The opaque list is recorded in pipeline order within a render order**, so a recorded bundle
  changes pipeline once a pipeline: 97 changes for 329 draws before, 4 after. The picture is the
  same but where two opaque surfaces lie at exactly the same depth.
- **`enableAsyncPbrPipelines()`**: a forward pass's PBR pipelines are made with
  `createRenderPipelineAsync`, a mesh is left out of the draw list while its pipeline compiles and
  joins it on the frame after, and `whenPbrPipelinesIdle()` resolves when none is compiling. Without
  it the frame that first draws a material waits for the compile (3.1 s for the trailhead on a T4).
  A pipeline that fails is made again the synchronous way, so its error is reported as before.
  Forward passes only: shadow and geometry passes still make theirs when first drawn.
- **`createPluginUniformBlock(engine, name, fields)`**: a uniform buffer of the application's own
  that plugins name in `getUniformBlocks()` and read as `<name>.<field>`, sent with
  `writePluginUniformBlock`. For what is the same for the whole scene and moves every frame (the
  sun, the air, a wind's clock): one write a frame, where the materials' own uniforms cost one a
  material (2 writes a frame at the trailhead, the block and the scene's). With
  `enablePbrMaterialPluginVertexData()`.
- **The opaque list is recorded in parts of 32 draws**, and `setMeshVisible` records again only the
  parts whose visible meshes changed. One bundle held the whole list, so a frustum cull that hides
  what leaves the view recorded every draw on most frames of a turning camera: 11,326 draws
  recorded over 300 frames before, 1,076 after. Every other invalidation records every part, as
  before. Data that is uploaded when its draw is recorded (`pluginVertexData`,
  `thinInstances.pluginData`) wants `invalidateRenderBundles(engine)` after its version is bumped.

Tag `v1.39.3-dayhike.5`, found by drawing one whole view of the game in Lite (141 draws and the game's
post chain) and comparing it with the game's own picture:

- **An environment the application draws itself: `createCustomEnvironment`.** A cube target with the
  layers' views to draw into, used as a PBR material's image-based light, with `update()` when it has
  been drawn again. Day Hike's sky is drawn, not loaded.
- **A light changed in place is written again: `markLightDirty`.** A light's fields set directly
  (its intensity, its colour) were not uploaded.
- **A projection hook is handed a matrix written whole.** The perspective writer sets five entries
  and left a hook's own last edit in the others, so a jitter added there summed frame on frame.
- **A mesh's plugin instance data is bound only where the material declares it.** Under a material
  whose plugins declare no instance attributes it landed in the matrices' slot.
- **A texture made from pixels can have its smaller levels: `mipMaps`** on
  `createTexture2DFromPixels`, which made one level and ignored the option.
- **PBR in linear light for a post chain: `enablePbrLinearOutput`.** The fragment always ended with
  the display's curve and a clamp; a frame graded by a post chain wants the colour before them.

The first tag's patches were proved on Day Hike's own plugins ported to WGSL (the atmosphere, the wet surfaces, the
foliage's wind and lighting, the distance fade) against Babylon.js 9.18 drawing the same scene with
the game's plugins: the pictures agree to within 0.11 of 255 on average. The second tag's were proved by probes of what
the terrain, the water and the post chain need: ten textures on one sampler with a float table read
by `textureLoad`, and a projection moved by the hook through a chain of passes with a history. The
third tag's were proved on the terrain's whole material ported to WGSL (the layer blend, the road,
trail and feature paints, the far cover and its sun term, the wet surfaces) against the game's own
picture of its terrain at twelve views: the pictures agree to within 0.12 of 255 on average.

The fourth tag's were counted, then timed on a rented Windows machine with an NVIDIA T4 against the
third tag, main thread a frame: a view whose plugin uniforms move every frame 2.28 ms to 0.33 (0.2
with the shared block), a still forest view 0.41 to 0.16, a turning view under a frustum cull 0.37 to
0.28, a world whose meshes and instance lists change 3.38 to 1.40; that last one's frames over 5 ms
are buffer uploads and did not change.

The fifth tag's were proved on that whole view: with them Lite's picture of Day Hike's forest is
within 0.75 of 255 of the game's on its low tier (111 draws) and within 0.91 on its medium tier with
the game's post chain (141 draws, six passes, the temporal anti-aliasing settled).

Not patched yet, known to be wanted: per-instance attributes through the GPU-culled and LOD-partner
paths; shadow and geometry passes' pipelines made asynchronously; a mesh added or removed with only
its part of the opaque list recorded again.
