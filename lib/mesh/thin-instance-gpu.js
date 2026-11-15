import { F32, U32 } from "../engine/typed-arrays.js";
import { BU } from "../engine/gpu-flags.js";
import { bumpVisibilityEpoch } from "../engine/engine.js";
import { retireGpuResources } from "../engine/gpu-resource-retirement.js";
import { packMat4IntoF32 } from "../math/pack-mat4-into-f32.js";
import { writeMeshIndexedIndirectArgs } from "./mesh-indexed-indirect.js";
// src/mesh/thin-instance-gpu.ts
/** Thin instance GPU buffer sync — dynamically loaded only by scenes with thin instances.
*  Keeps the standard renderable chunk unchanged for scenes without thin instances. */
/** @internal Sync CPU thin-instance data to GPU buffers, optionally with STORAGE usage for compute culling. */
function syncThinInstanceGpuData(engine, ti, hasColor) {
	const device = engine._device;
	const needsStorage = ti._gpuCullingEnabled;
	let retiredMatrix = null;
	let retiredColor = null;
	let recreated = false;
	if (ti._version !== ti._gpuVersion) {
		const byteSize = ti.count * 64;
		let bufferRecreated = false;
		if (!ti._gpuBuffer || ti._gpuBuffer.size < byteSize) {
			if (ti._gpuBuffer) retiredMatrix = ti._gpuBuffer;
			ti._gpuBuffer = device.createBuffer({
				label: "thin-instance-matrices",
				size: Math.max(ti._capacity * 64, 4),
				usage: BU.VERTEX | BU.COPY_DST | BU.STORAGE
			});
			bufferRecreated = true;
			recreated = true;
		}
		// The dirty range is held to the capacity, not to the drawn count: instances written past the count
		// (a list made ready before it is shown) are sent too.
		const dirtyMin = bufferRecreated ? 0 : ti._dirtyMin;
		const dirtyMax = Math.min(bufferRecreated ? Math.max(ti.count, ti._dirtyMax) : ti._dirtyMax, ti._capacity);
		if (dirtyMax > dirtyMin) {
			const minByte = dirtyMin * 64;
			const maxByte = dirtyMax * 64;
			if (ti.matrices instanceof F32) device.queue.writeBuffer(ti._gpuBuffer, minByte, ti.matrices.buffer, ti.matrices.byteOffset + minByte, maxByte - minByte);
			else {
				const neededFloats = ti._capacity * 16;
				if (!ti._uploadF32 || ti._uploadF32.length < neededFloats) ti._uploadF32 = new F32(neededFloats);
				const upload = ti._uploadF32;
				for (let i = dirtyMin; i < dirtyMax; i++) packMat4IntoF32(upload, ti.matrices, i * 16, i * 16);
				device.queue.writeBuffer(ti._gpuBuffer, minByte, upload.buffer, upload.byteOffset + minByte, maxByte - minByte);
			}
		}
		ti._dirtyMin = ti._capacity;
		ti._dirtyMax = 0;
		ti._gpuVersion = ti._version;
	}
	if (hasColor && ti.colors) {
		if (ti._colorVersion !== ti._colorGpuVersion || ti._colorGpuBufferStorage !== needsStorage) {
			const colorByteSize = ti.count * 16;
			let colorRecreated = false;
			if (!ti._colorGpuBuffer || ti._colorGpuBuffer.size < colorByteSize || ti._colorGpuBufferStorage !== needsStorage) {
				if (ti._colorGpuBuffer) retiredColor = ti._colorGpuBuffer;
				ti._colorGpuBuffer = device.createBuffer({
					label: "thin-instance-colors",
					size: Math.max(ti._capacity * 16, 4),
					usage: BU.VERTEX | BU.COPY_DST | (needsStorage ? BU.STORAGE : 0)
				});
				ti._colorGpuBufferStorage = needsStorage;
				colorRecreated = true;
				recreated = true;
			}
			const cMin = colorRecreated ? 0 : ti._colorDirtyMin;
			const cMax = Math.min(colorRecreated ? Math.max(ti.count, ti._colorDirtyMax) : ti._colorDirtyMax, ti._capacity);
			if (cMax > cMin) device.queue.writeBuffer(ti._colorGpuBuffer, cMin * 16, ti.colors.buffer, ti.colors.byteOffset + cMin * 16, (cMax - cMin) * 16);
			ti._colorDirtyMin = ti._capacity;
			ti._colorDirtyMax = 0;
			ti._colorGpuVersion = ti._colorVersion;
		}
	}
	if (retiredMatrix || retiredColor) retireGpuResources(engine, () => {
		retiredMatrix?.destroy();
		retiredColor?.destroy();
	});
	if (recreated) bumpVisibilityEpoch();
	return recreated;
}
/** Sync stable indirect arguments, using their CPU words for geometry and the count as upload acknowledgement. */
function syncThinInstanceDrawArgs(engine, ti, gpu) {
	if (!ti._drawArgsBuffer) {
		ti._drawArgsBuffer = engine._device.createBuffer({
			size: 20,
			usage: BU.INDIRECT | BU.COPY_DST
		});
		ti._drawArgsData = new U32(5);
		ti._drawArgsInstanceCount = -1;
		bumpVisibilityEpoch();
	}
	const args = ti._drawArgsData;
	const baseVertex = gpu._baseVertex ?? 0;
	if (args[0] !== gpu.indexCount || args[2] !== (gpu._firstIndex ?? 0) || (args[3] | 0) !== baseVertex || ti._drawArgsInstanceCount !== ti.count) {
		writeMeshIndexedIndirectArgs(args, gpu, ti.count);
		ti._drawArgsInstanceCount = -1;
		engine._device.queue.writeBuffer(ti._drawArgsBuffer, 0, args.buffer, args.byteOffset, args.byteLength);
		ti._drawArgsInstanceCount = ti.count;
	}
	return ti._drawArgsBuffer;
}
/** Sync thin-instance vertex data and return stable indirect args only after a direct draw's count changes. */
function syncThinInstanceForDraw(engine, ti, hasColor, gpu) {
	syncThinInstanceGpuData(engine, ti, hasColor);
	if (!ti._drawArgsBuffer && (ti._drawArgsInstanceCount ??= ti.count) === ti.count) return null;
	return syncThinInstanceDrawArgs(engine, ti, gpu);
}
/** Sync thin instance matrix + optional color GPU buffers and bind to vertex slots. */
function syncThinInstanceBuffers(engine, ti, pass, slot, hasColor, drawBuffers, withPluginData = true) {
	syncThinInstanceGpuData(engine, ti, hasColor);
	if (ti.pluginData && withPluginData) {
		if (!ti._pluginGpuBuffer || ti._pluginGpuBuffer.size < ti.pluginData.byteLength) {
			const retired = ti._pluginGpuBuffer;
			if (retired) retireGpuResources(engine, () => {
				retired.destroy();
			});
			ti._pluginGpuBuffer = engine._device.createBuffer({
				label: "thin-instance-plugin",
				size: Math.max(ti.pluginData.byteLength, 4),
				usage: BU.VERTEX | BU.COPY_DST
			});
			ti._pluginGpuVersion = void 0;
		}
		if (ti._pluginGpuVersion !== (ti.pluginVersion ?? 0)) {
			engine._device.queue.writeBuffer(ti._pluginGpuBuffer, 0, ti.pluginData.buffer, ti.pluginData.byteOffset, ti.pluginData.byteLength);
			ti._pluginGpuVersion = ti.pluginVersion ?? 0;
		}
		pass.setVertexBuffer(slot++, ti._pluginGpuBuffer);
	}
	const matrixBuffer = drawBuffers?.matrixBuffer ?? ti._gpuBuffer;
	if (matrixBuffer) pass.setVertexBuffer(slot++, matrixBuffer);
	if (hasColor) {
		const colorBuffer = drawBuffers?.colorBuffer ?? ti._colorGpuBuffer;
		if (colorBuffer) pass.setVertexBuffer(slot++, colorBuffer);
	}
	return slot;
}
export { syncThinInstanceBuffers, syncThinInstanceDrawArgs, syncThinInstanceForDraw, syncThinInstanceGpuData };

//# sourceMappingURL=thin-instance-gpu.js.map