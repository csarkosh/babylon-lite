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
needed, the sixth's what the game costs as it streams its world past a moving camera, the seventh's
what the game's passes cost: a pass broken only on a frame that reads what lies behind a surface, a
pass with its own word on what it draws, one part of a picture drawn in place; the eighth's what a
load makes twice and what a mesh written in place costs a frame; the ninth's what a load holds the
browser's GPU thread with while it compiles pipelines.

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
  `pluginVertexVersion` after changing it in place; until the sixth tag it was uploaded when the mesh
  was next recorded).
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
  `thinInstances.pluginData`) wants `invalidateRenderBundles(engine)` after its version is bumped
  (until the sixth tag, which sends it when its version moves).

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

Tag `v1.39.3-dayhike.6`, each counted on Day Hike itself drawn by Lite, at three of its views on its low
and medium tiers (a still camera, a turning one over 300 frames, a walk of 100 m over 1,300), every call
the page makes to the GPU counted, with the pictures unchanged:

- **Thin instances written past the drawn count are sent.** An upload was held to the drawn count, so a
  matrix or a colour set past it was taken as sent and never was. The dirty range is held to the
  capacity, and `flushThinInstances(mesh, start, end)` marks a range of instances alone: a list can be
  written and sent before `setThinInstanceDrawCount` shows it.
- **Plugin data is sent when its version moves, by range, shown or hidden.** `thinInstances.pluginData`
  and `pluginVertexData` were written only while their draw was being recorded, so every change wanted
  `invalidateRenderBundles(engine)`, which records every draw of every pass, and each write sent the
  whole array. They are synchronised in the renderable's update now, for a hidden mesh as for a shown
  one, and `markThinInstancePluginData(mesh, start, end)` and `markPluginVertexData(mesh, start, end)`
  bump the version and name the floats that changed. Over the walk at the forest view on the medium
  tier: 122,402 draws recorded before, 13,508 after, with no call to `invalidateRenderBundles` (608
  before); under the turning camera, 5,635 and 735.
- **A mesh added or removed records only its own part of the opaque list.** The list's parts were cut
  by place, and a list built again dropped them all. They are cut where the renderables say (one in 24
  proposes a cut, made at the next change of pipeline), a list built again keeps its bundles, and a
  part is recorded again only where its draws differ. On a list of 180 draws a mesh added recorded 164
  before and 25 after; the same walk, 13,508 draws recorded to 11,899. The parts are smaller: a still
  frame replays 8 to 18 bundles where it replayed 7 to 13, and sets as many pipelines to within two.
- **A list's buffer made again records only its own part.** A thin-instance list that outgrew a buffer,
  or first drew through indirect arguments, marked every recorded draw of every pass stale.
  `bumpDrawEpoch` counts the change on the mesh, and a list's parts hold their meshes' counts. The same
  walk, 11,899 draws recorded to 2,491; the turning camera, 735 to 59.
- **`uniformBlocks` on a shader material**: the blocks of `createPluginUniformBlock`, bound after the
  material's storage buffers and read as `<name>.<field>` in both stages, so a shader material reads
  what the PBR plugins read and is not written a copy of it every frame.
- **`instanceAttributes` on a shader material**: per-instance attributes of the application's own for
  its thin instances, declared as a plugin's are and fed from `thinInstances.pluginData`. The direct
  thin-instance draw path only.
- **The lights buffer and a PBR mesh's own buffer are written only when their bytes changed.** A
  renderer that sets its lights every frame was sent 1,040 bytes a frame of a still view, and a mesh
  whose geometry is written in place the matrix it had. With the shader materials on the shared block,
  a still frame's buffer writes at the forest view go from 3 to 2 on the low tier and from 4 to 2 on
  the medium (what is left is the application's own: its block, and its mist banks' matrices).
- **A disposed mesh's plugin buffers are destroyed with it**, where they waited for the garbage
  collector.
- **The scene's bind group is set once a pass**, not also before the bundles, which discard it.

Tag `v1.39.3-dayhike.7`, each counted on Day Hike itself drawn by Lite at five of its views (a forest, a
trailhead, a meadow, a lake, a beach) on its low, medium and high tiers, every call the page makes to the
GPU counted, with a caller that adopts nothing drawing as it drew:

- **A render task's pass broken before the meshes an application names: `enableRenderTaskBreak`.** A
  surface that reads what lies behind it wants the frame as drawn so far. Lite's own way
  (`enableRenderTaskTransmission`) copies the frame into a 1,024 x 1,024 texture whatever the frame's
  size, breaks the pass only before its own refractive materials, leaves them blended, and records the
  whole opaque list as one bundle whenever a mesh is shown or hidden. A break is made only on a frame
  that shows a mesh marked `afterBreak`: the opaque draws, then the pass begun again over what they
  stored, with the marked meshes first (an opaque one tests and writes depth) and the see-through
  draws after. The colour kept between the halves is the task's own size; a multisampled task's first
  half is resolved straight into it, so it costs no copy; the depth is kept by one triangle where
  asked; `onBreak` hands the frame's encoder over between the halves. A PBR material on a marked mesh
  has its bind group made when a draw list is built, so a plugin's `bindTextures` hands the kept
  textures on, after a resize as before it. On the high tier with a lake's surface drawn so, opaque
  over the kept frame: 12 passes a frame with the lake in view where there were 10 (the second half and
  the depth's triangle), 10 at the forest as before; under a turning camera 227 draws recorded in 300
  frames, as without a break (209 to 236).
- **A render task shows or hides a mesh by its own word: `setTaskMeshVisible`.** A hidden mesh was in
  no pass and a shown one in every pass that lists it, so what one pass alone needed was shown
  everywhere for its frame, or drawn in the main view as nothing. A task's word on a mesh outranks the
  mesh's; only that task's recorded parts that hold the mesh are recorded again. The lake's plants
  stand in the shore panorama's pass whatever the frame's view holds, and its surface in the rain's
  cover map: 18 draws recorded in 120 frames of a moving sky before, none after.
- **A draw range can mark only its own mesh's recorded draw stale**: `setMeshDrawRange`'s fourth
  argument. It marked every recorded draw of every pass stale and moved every scene's version. The sea
  draws only the rings that hold water: 240,900 indices a frame fewer at the meadow, on either tier,
  and nothing recorded for it. Shadow and geometry passes record by the scene's version and are not
  told: for a mesh drawn in one, leave it off.
- **A task clears its viewport alone and writes alpha 1 where it drew: `clearViewport`,
  `alphaWhereDrawn`** on a render task's configuration. A task that draws one part of a larger picture
  through its camera's viewport cleared the whole picture, and a PBR material cut out by its alpha
  left the alpha it was cut at. One triangle lays the clear colour and the depth's clear value over
  the viewport before the draws, and one after them writes an alpha of 1 wherever the depth is no
  longer its clear value. A sector of the lake's shore panorama is drawn straight into its column: 14
  passes on a sector's frame where there were 15, and its own target gone.
- **A range of a plugin uniform block written alone**: `writePluginUniformBlock`'s start and end. The
  game sends the run of the block's words that moved: on a still frame of the low tier with every
  clock held, no buffer write where there was one of 5,312 bytes; on the medium tier 2,424 bytes in the
  frame's three writes where there were 7,728 (the anti-aliasing's jitter moves two words of the
  block); with the clocks running, 1,600 to 4,900 bytes a frame on the low tier where there were 6,200
  to 9,300, and nothing saved on the medium, where the words that move stand at both ends of the block.
- **A public way to a pass of one's own**: `getGpuDevice`, `getFrameEncoder`,
  `getRenderTargetAttachments`, `createCustomTask`, for what an application read through private
  fields.
- **A shader material lets go of the textures it claimed.** It let go of `texture.texture` as the
  facade read at that moment: for a facade over a render target, whose texture is made again when the
  frame's passes are recorded, a texture it had never claimed, which its first release destroys. That
  was the target's live texture. A fix, not a hook; the PBR and standard materials' claims are as they
  were.
- **A render target can keep its textures while its size stands: `keep`** on its descriptor. A plain
  target's textures were destroyed and made again at every recording of the frame's passes, a resize
  or not (a scene's groups built again for a mesh or a light that joined), and nobody held a claim on
  them. With it they stand while the size, the formats and the sample count do, and the target holds
  a claim on them. Over one load of the game's forest view on its medium tier the frame's passes are
  recorded twelve times with no resize among them: the scene's samples, their depth, their resolve and
  a mask were made twelve times each (80 MB of textures a recording), and once each with `keep`.

Tag `v1.39.3-dayhike.8`, each counted on Day Hike itself drawn by Lite (a load to a standing view, a
walk of 60 m, its end scene played whole), every call the page makes to the GPU counted and Lite's own
loops counted in a copy of its files, with a caller that adopts nothing drawing as it drew:

- **A scene let go no longer clears the PBR pipelines the other scenes draw with.** Every scene that
  built a PBR group cleared the page's whole cache of PBR layouts and pipelines as it was disposed, so
  a scene made for one picture (a bake, a probe) emptied it under every scene still drawing, whose
  next group build made each pipeline again, synchronously. Day Hike bakes seven far-tree pictures a
  load, a scene each: of the 106 to 128 PBR pipelines a load made, 55 to 61 were ones it had already
  made. The scenes that draw with the cache hold it, and it is cleared when the last is let go: a load
  asks the device for 75 to 98 render pipelines where it asked for 130 to 159, and for 134 to 174
  shader modules where it asked for 244 to 296.
- **One shader module a stage for every pipeline of a PBR layout.** A pipeline for a second target
  (a cover map's, a mask's, a reflection's) made the layout's two modules again from the same text.
  They are kept on the layout: on the medium tier, where 67 pipelines are made of 64 layouts, 168
  shader modules a load where there were 174; on the low tier a layout has one pipeline and nothing
  changes.
- **A draw range that stands, or moves over triangles already walked, reads nothing of the mesh.**
  `setMeshDrawRange` walked every index of its range before it looked whether the range was the one
  already set, and on a change took the bounds of the range's positions again. The test for a range
  that stands comes first; a range's source keeps the run of its index list it has walked, and a
  range is walked only where it reaches past the run; with `own`, a range of the very positions the
  mesh holds keeps the mesh's bounds. The game's sea sets its range where its run of wet rings
  changes (three times in a load and a 60 m walk by the trailhead): 1,266,330 indices walked and
  1,103,679 floats of positions read there before, 446,940 and none after.
- **A blended mesh can be ordered by a point of its own: `Mesh.sortOrigin`.** A task orders its
  see-through draws by the depth of each mesh's origin and only then by render order, so an
  application that orders them by place stood every such mesh at the world's origin with its vertices
  in world coordinates, and laid a moving one again every frame. `sortOrigin` is the world point the
  order measures a mesh's depth from; meshes given one point are ordered among themselves by render
  order alone, wherever their matrices put them. The driven car's glass rides the car's matrix: while
  the car moves, two buffer writes and 16,728 bytes a frame (its 697 vertices' positions and normals)
  become the one write of its own matrix, 144 bytes.
- **A plain mesh can draw from indirect arguments of its own: `enableMeshDrawArgs`.** A mesh whose
  list of triangles is written in place (`updateMeshGeometryCapacity`) drew its whole index capacity,
  the tail cleared and drawn as triangles of no area, in every pass that draws it; a draw range would
  hold it to the list, but is let go by every such write and records the draw again when set. With
  the mesh's count, first index and base vertex in five words of a buffer of its own, a list's write
  or a draw range writes those words and records nothing, and the tail is neither drawn nor cleared.
  Day Hike's steep ground is one such mesh, its list changed at every patch that lands or leaves: a
  frame draws 248,244 indices fewer on the low tier, 451,350 on the medium and 812,430 on the high,
  at every view counted, still, turning or walking.
- **What a task's break keeps can stand from one recording to the next: `keep`** on
  `RenderTaskBreakOptions`. The kept colour and depth were made again at every recording of the
  frame's passes (11.2 MB and 5.6 MB on the game's high tier, some twelve times a load with no
  resize); with `keep` they stand while the task's size, format and sample count do, the depth while
  the depth texture it reads does.
- **The first scene node a page makes can be let go.** A node's `parent`, `worldMatrix` and
  `worldMatrixVersion` were accessors written in its object literal, closures made a node; V8 keeps a
  literal's first accessors with the shape every later node shares, so the first node a page made,
  and all it reached (its meshes, their buffers, their device, destroyed or not), stayed reachable for
  the page's life: a whole renderer's worth after a tier is switched or a device is lost. The three
  are one set of accessors for every node, each node's own properties as before.
- **A task, or a scene, can make its PBR pipelines at once: `syncPipelines`** on a render task's
  configuration and on a scene. With `enableAsyncPbrPipelines` every task leaves a mesh out of its
  pass until the mesh's pipeline is ready, which a pass whose picture is drawn once and kept (a bake,
  a mask, a cover map, a reflection) cannot afford, so an application with such passes could move no
  pipeline off the main thread. A task that refuses makes its own as its draws are built. With the
  game's own pass waiting and its bakes' refusing, a load makes 28 render pipelines synchronously and
  49 off the main thread on the low tier (77 and none before) and 45 and 53 on the medium (98 and
  none); whether the game adopts it is for a timed machine to say.

Tag `v1.39.3-dayhike.9`, each counted on Day Hike itself loading from its landing page through Play to its
world being in, every pipeline and shader module the page asked for counted with its maker, on its low,
medium and high tiers. A pipeline made the synchronous way holds the browser's GPU thread while it
compiles, cold for 0.2 to 1.5 s each, and that thread presents the page's frames, a video's too:

- **A task can wait for its pipelines and draw whole or not at all: `drawWhole`** on a render task's
  configuration. A task whose picture is drawn once and kept (a bake, a mask, a map of what covers the
  ground, a reflection) had to make its pipelines at once (`syncPipelines`) under
  `enableAsyncPbrPipelines`, or keep a picture short of a mesh. Such a task asks for its pipelines off
  the main thread as the others do, and on a frame where a draw of its list waits for one it begins no
  pass and leaves its target as it stood; `isRenderTaskHeld(task)` says so of its last frame, and
  `whenRenderTaskPipelinesIdle(task)` resolves once the pipelines its list last waited for are in, so a
  bake waits before its draw and its read-back and a task drawn on demand is asked again. The count of
  pipelines compiling is the engine's, which `whenPbrPipelinesIdle` reads. `syncPipelines` outranks it.
- **A shader material's pipelines can be made off the main thread whenever it joins:
  `enableAsyncShaderMaterialPipelines`.** `enableAsyncShaderPipelineCompilation` prepares the shader
  materials a scene holds when it is registered; one that joins later made its pipeline the synchronous
  way at its first draw. Under this switch a forward pass's shader-material pipelines are asked for as
  the PBR ones are: a draw left out of a task that may wait until its pipeline is in, a task that refuses
  making its own at once, a refused ask made at once at the next build; the two share their pending
  pipelines, and `whenPbrPipelinesIdle` counts these too.
- **Lite's own helper pipelines are asked for off the main thread where their callers wait.** The read
  of a texture's pixels (`readTexturePixelsRGBA8`) made a module and a pipeline at every call (fourteen
  a load in Day Hike, two a far-tree bake): it keeps them a kind of read for the device, the first asked
  for with the asynchronous make. The RGBD decode of an environment's BRDF table and a format's mip-chain
  blit are asked for so before an awaiting caller (`createCustomEnvironment`, the glTF loader,
  `createTexture2DFromExternalImage`, `loadTexture2D`) first needs them; a caller that does not await
  (`createTexture2DFromPixels`, a cube's mips) makes the blit as it did, once a format.
- **The pipelines asked for off the main thread can be bounded a frame: `setPipelineAsksPerFrame`.** An
  ask still makes its shader modules on the main thread, and the browser compiles what one frame asked
  for together: a frame of Day Hike's load asked for 25 to 29 pipelines and 50 to 58 modules at once.
  With a bound, a draw whose pipeline would be one more waits as though its pipeline were compiling, and
  a frame after asks for it; the waits above wait for it too. A pipeline made at once is never put off.

With them Day Hike's load (its own pass waiting, its kept passes drawing whole, its own passes' pipelines
asked for off the main thread, four asks a frame) asks the device for no render or compute pipeline the
synchronous way from its renderer's making to its world being in but those named in its own notes, and
once its world is in it makes every pipeline at once again (`syncPipelines` on its scene).

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

The sixth tag's were counted on the game itself, and proved by its pictures against the fifth tag's with
the game using every hook: the same bytes on the low tier at three views, still and after the walk
(but two pixels of one frame, by 1 of 255); on the medium tier, whose motes drift with the clock, the
same bytes at one view and all but four pixels at another with the clock held at one value on both
pages, and otherwise within what two runs of one build differ by (0.001 of 255 on average). The parts
were also driven on a stand-in device through thousands of random changes (meshes added, removed,
shown, hidden, buffers made again), each frame replaying exactly the list.

The seventh tag's were proved on the game, the page's clock held at one value from its first script.
Unchanged, it draws the same bytes on the seventh tag's files as on the sixth's at the five views on
the low tier, and its counts are the same. On the tiers with the post chain the temporal
anti-aliasing settles into one of a few states a few of 255 apart from one load of a page to the
next, whatever the build: with its history started again on every page the two builds drew the same
bytes at the forest and the beach, and elsewhere pictures within what loads differ by (between the
builds 0.003 to 0.032 of 255 on average, between two loads of one build 0.003 to 0.022). With the
game on every hook the low tier is again the same bytes at the five views, the chain tiers the same
bytes as a run of the unchanged game at two views of four and within the same floor at the others,
and the lake's shore panorama differs only where the reflected crowns are dithered, the screen-door
now laid on the picture's own columns. The break and the task's word were also driven on a
stand-in device through thousands of random changes, each frame issuing exactly the lists' draws in
the passes they belong to, and a build that uses neither recording exactly what the sixth tag records.

The eighth tag's were proved as the seventh's were, the page's clock held at one value from its first
script. Unchanged, the game draws the same bytes on the eighth tag's files as on the seventh's at the
five views on the low tier. With the car's glass on `sortOrigin` and the steep ground's mesh on
`enableMeshDrawArgs` the low tier is again the same bytes at those five views and at a sixth that
holds the parked car, and on the tiers with the post chain the pictures at the car and the forest
stand within what two loads of the seventh tag differ by (between the builds 2.4 to 5.4 % of pixels
by at most 9 to 14 of 255, between two loads of the seventh tag 2.3 to 5.7 % by at most 10 to 14).
With the game's own pass also waiting for its pipelines and its kept passes refusing, the low tier
is the same bytes at the five views once loaded. `setMeshDrawRange`, the indirect arguments, the
break's `keep` and `syncPipelines` were each driven on a stand-in device through thousands of random
changes (a range against the seventh tag call for call: the same throws, the same mesh after each),
and the scene node in Chrome itself: of 2,000 nodes made and dropped in a page with no device, the
first stays alive for good on the seventh tag's files and none on the eighth's. The break's `keep`
was not drawn in a page: the game does not break a pass yet.

The ninth tag's were driven on a stand-in device each through thousands of random frames (a task that
draws whole beside one that waits and one that refuses, meshes joining and leaving with pipelines one to
six frames late; shader-material binds through Lite's own `getOrCreateShaderPipeline` with asks that come
back late or are refused; reads, mip chains and decodes; bursts of forty meshes under a bound of four),
and with neither switch on a build that adopts nothing records exactly what the eighth tag records. In Day
Hike, from its landing page through Play to its world being in, at its trailhead: the pipelines made the
synchronous way fell from 78, 96 and 93 to 1, 1 and 2 on the low, medium and high tiers (57, 78 and 78
asked for off the main thread), none was made after the world was in in 20 seconds either way, the most
asks of one frame fell from 25 to 29 to 6 to 11 (the game's own post chain asks for its six to nine
together) and the most shader modules of one frame from 50 to 58 to 12 to 16; the low tier draws the same
bytes at its six standing views once loaded (at the trailhead one load of two came out a few pixels
apart, as loads of one build at times do).

Not patched yet, known to be wanted: a mesh that joins a recorded task built with what the mesh has
(an instance list, a colour a vertex) where the task builds it at once with the scene's last build
and an application keeps a hidden mesh in the scene to seed that build; the clear coat's lobe and
its share of the direct light taken from every light, where they come from a mesh's first light
alone, whatever its intensity; `keep` for a scene's own default pass's target; a shader material's
thin instances without the matrix buffer where the stage places them itself; an order among the
panes of one blended mesh; a depth bias on a PBR pipeline; the
depth grab of `enableRenderTaskTransmission` under a bundler (its module is loaded for its side
effect alone, which `"sideEffects": false` lets a bundler drop: the grab's `depthTexture` stays
null) and a `transmissive` shader material on a thin-instanced mesh (its renderable does not carry
the mark, so the pass is not broken for it); the PBR and standard materials letting go of the
textures they claimed, as the shader material now does; a scene's groups built again twice at one
join recording the frame's passes twice; per-instance attributes through the GPU-culled and LOD-partner
paths; shadow and geometry passes' pipelines made asynchronously; an opaque order that keeps a
pipeline's draws together across the places an application names for its materials (Day Hike's named
places set a pipeline 15 to 45 times a frame for 8 to 19 pipelines); a thin-instanced mesh joining a
built scene without every PBR renderable of the scene being built again (2,000 to 2,750 bind groups
made in one of the game's loads); one vertex buffer a mesh where there are four to six; the bound on asks
a frame counted by the page's own frame (every `renderFrame` begins a count now, a bake's on a surface of
its own too); the blit of a format made the synchronous way by a caller that does not await
(`createTexture2DFromPixels`, a cube's mips) and the transmission depth grab's pipeline made at a
recording.
