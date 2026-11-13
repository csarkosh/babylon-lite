import { ThrowLiteError } from "../lite-error.js";
import { BU } from "../engine/gpu-flags.js";
import { bumpVisibilityEpoch } from "../engine/engine.js";
import { _getStorageBufferHandle } from "../resource/storage-buffer.js";
import { _installMeshRetirementObserver } from "./mesh-dispose.js";
import { _getMeshScenes, _installMeshMaterialValidator, markMeshRenderableDirty } from "../scene/mesh-scene-registry.js";
import { _installShaderIndexedDrawResolver } from "../material/shader/shader-renderable.js";
// src/mesh/mesh-indexed-indirect-borrow.ts
var borrows = null;
var installed = false;
function assertMesh(mesh) {
	if (mesh._disposed) ThrowLiteError(662);
	if (mesh.thinInstances) ThrowLiteError(663);
	if (mesh.material?._buildGroup._materialFamily !== "shader") ThrowLiteError(664);
	if (mesh._gpu._ownsVertexBuffers !== false) ThrowLiteError(665);
}
function findSource(engine, handle) {
	for (const source of engine._storageBuffers ?? []) if (source._buffer === handle) {
		_getStorageBufferHandle(engine, source);
		return source;
	}
	ThrowLiteError(666);
}
function validate(engine, mesh, borrow) {
	assertMesh(mesh);
	if (mesh._gpu !== borrow.geometry || mesh._gpu.positionBuffer !== _getStorageBufferHandle(engine, borrow.vertices)) ThrowLiteError(667);
	if (borrow.indices && mesh._gpu.indexBuffer !== _getStorageBufferHandle(engine, borrow.indices)) ThrowLiteError(668);
	return _getStorageBufferHandle(engine, borrow.buffer);
}
/** Borrow the five GPU-authored indexed-indirect words at an aligned byte offset.
*  Pass null to restore the CPU draw. The allocation remains caller-owned; clones
*  require their own binding. GPU-role allocations and their producers must be
*  recreated/rerun after device loss. No argument word is read or overwritten. */
function setMeshIndexedIndirect(mesh, buffer, byteOffset = 0) {
	if (mesh._disposed) ThrowLiteError(669);
	if (buffer !== null && (!buffer || typeof buffer !== "object")) ThrowLiteError(670);
	const previous = borrows?.get(mesh);
	let next;
	if (buffer) {
		assertMesh(mesh);
		const engine = buffer._engine;
		_getStorageBufferHandle(engine, buffer);
		if (engine._currentEncoder) ThrowLiteError(671);
		if ((buffer._usage & BU.INDIRECT) === 0) ThrowLiteError(672);
		if (!Number.isSafeInteger(byteOffset) || byteOffset < 0 || byteOffset % 4 !== 0) ThrowLiteError(673);
		if (byteOffset > buffer.byteLength - 20) ThrowLiteError(674, byteOffset, buffer.byteLength);
		const vertices = findSource(engine, mesh._gpu.positionBuffer);
		const indices = mesh._gpu._ownsIndexBuffer === false ? findSource(engine, mesh._gpu.indexBuffer) : void 0;
		next = {
			buffer,
			byteOffset,
			geometry: mesh._gpu,
			vertices,
			indices
		};
		if (previous?.buffer === buffer && previous.byteOffset === byteOffset && previous.geometry === mesh._gpu) return;
	} else {
		if (byteOffset !== 0) ThrowLiteError(675);
		if (previous?.buffer._engine._currentEncoder) ThrowLiteError(676);
		if (!previous) return;
	}
	if (next) (borrows ??= /* @__PURE__ */ new WeakMap()).set(mesh, next);
	else borrows.delete(mesh);
	if (!installed) {
		installed = true;
		_installShaderIndexedDrawResolver({
			update(engine, mesh) {
				const borrow = borrows?.get(mesh);
				if (borrow) validate(engine, mesh, borrow);
			},
			draw(pass, engine, mesh) {
				const borrow = borrows?.get(mesh);
				if (!borrow) return false;
				pass.drawIndexedIndirect(validate(engine, mesh, borrow), borrow.byteOffset);
				return true;
			}
		});
		_installMeshRetirementObserver((retired) => borrows?.delete(retired));
		_installMeshMaterialValidator((target, material) => {
			if (borrows?.has(target)) {
				if (material?._buildGroup._materialFamily !== "shader") ThrowLiteError(677);
				if (target.thinInstances) ThrowLiteError(678);
			}
		});
	}
	bumpVisibilityEpoch();
	for (const scene of _getMeshScenes(mesh) ?? []) {
		for (const dispose of scene._meshDisposables.get(mesh) ?? []) {
			const packet = dispose.p;
			if (packet) packet._disposed = true;
		}
		scene._renderableVersion++;
	}
	markMeshRenderableDirty(mesh);
}
/** Report physical index capacity and CPU-known counts without GPU readback. */
function getMeshIndexedDrawInfo(mesh) {
	if (mesh._disposed) ThrowLiteError(679);
	if (mesh.thinInstances) ThrowLiteError(680);
	const indirect = borrows?.has(mesh) === true;
	return {
		mode: indirect ? "indirect" : "direct",
		indexCapacity: Math.floor(mesh._gpu.indexBuffer.size / (mesh._gpu.indexFormat === "uint16" ? 2 : 4)),
		indexCount: indirect ? null : mesh._gpu.indexCount,
		instanceCount: indirect ? null : 1
	};
}
export { getMeshIndexedDrawInfo, setMeshIndexedIndirect };

//# sourceMappingURL=mesh-indexed-indirect-borrow.js.map