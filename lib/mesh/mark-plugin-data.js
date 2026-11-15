// Naming the part of a mesh's plugin data that changed (Day Hike's patch; no upstream source).
/**
* Say that the floats `start` to `end` (exclusive) of a mesh's `thinInstances.pluginData` were changed in place:
* `pluginVersion` is bumped, and only that range is written to the GPU at the next frame, whether the mesh is
* shown or hidden. Ranges named before the write are joined. A `pluginVersion` bumped by hand sends the whole
* array, as it did.
*/
function markThinInstancePluginData(mesh, start = 0, end) {
	const ti = mesh.thinInstances;
	if (!ti?.pluginData) return;
	const version = ti.pluginVersion ?? 0;
	// A bump made by hand and not sent yet leaves the whole array to send.
	const whole = ti._pluginMarked !== version && ti._pluginGpuVersion !== version;
	ti._pluginDirtyMin = whole ? 0 : Math.min(ti._pluginDirtyMin ?? Infinity, start);
	ti._pluginDirtyMax = whole ? Infinity : Math.max(ti._pluginDirtyMax ?? 0, end ?? ti.pluginData.length);
	ti.pluginVersion = ti._pluginMarked = version + 1;
}
/**
* Say that the floats `start` to `end` (exclusive) of a mesh's `pluginVertexData` were changed in place:
* `pluginVertexVersion` is bumped, and only that range is written to the GPU at the next frame, whether the
* mesh is shown or hidden. Ranges named before the write are joined. A `pluginVertexVersion` bumped by hand
* sends the whole array, as it did.
*/
function markPluginVertexData(mesh, start = 0, end) {
	if (!mesh.pluginVertexData) return;
	const version = mesh.pluginVertexVersion ?? 0;
	const whole = mesh._pluginVertexMarked !== version && mesh._gpu._pluginVertexVersion !== version;
	mesh._pluginVertexDirtyMin = whole ? 0 : Math.min(mesh._pluginVertexDirtyMin ?? Infinity, start);
	mesh._pluginVertexDirtyMax = whole ? Infinity : Math.max(mesh._pluginVertexDirtyMax ?? 0, end ?? mesh.pluginVertexData.length);
	mesh.pluginVertexVersion = mesh._pluginVertexMarked = version + 1;
}
export { markPluginVertexData, markThinInstancePluginData };
