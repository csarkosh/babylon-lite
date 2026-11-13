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

All of them concern material plugins on the PBR material: Day Hike's look is a stack of plugins that,
on Babylon.js, edit the PBR shader at its named points and by regex.

Patches so far, tag `v1.39.3-dayhike.1`:

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

Each was proved on Day Hike's own plugins ported to WGSL (the atmosphere, the wet surfaces, the
foliage's wind and lighting, the distance fade) against Babylon.js 9.18 drawing the same scene with
the game's plugins: the pictures agree to within 0.11 of 255 on average.

Not patched yet, known to be wanted: per-instance attributes through the GPU-culled and LOD-partner
paths; PBR render pipelines made asynchronously (Lite makes them with `createRenderPipeline`, so a
material first drawn holds the frame while its pipeline compiles); a mesh added or removed without
the cached render bundle recorded again.
