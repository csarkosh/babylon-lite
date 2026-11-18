import { ThrowLiteError } from "../lite-error.js";
import { retireGpuResourceBatch } from "../engine/gpu-resource-retirement.js";
import { _buildBindings, _createAutomaticRenderTask, _removeMeshFromRenderTask, _writePassSceneUBO, drawList } from "./render-task-base.js";
import { resolvePendingTaskMeshes, transactRenderTask } from "./render-task-transaction.js";
// src/frame-graph/render-task.ts
/** Create a render task, auto-mirroring the scene unless disabled or populated with `addMeshToTask`. */
function createRenderTask(config, engine, scene) {
	return _createAutomaticRenderTask(config, engine, scene);
}
/** Add a mesh with an optional per-pass material override. Before the first recording the add is
*  queued; afterwards it builds and binds synchronously, preserving the live generation on failure. */
function addMeshToTask(task, mesh, opts) {
	_enableTaskMeshPopulation(task);
	task._addMesh(mesh, opts);
}
/** @internal Install explicit population without retaining it in createRenderTask-only bundles. */
function _enableTaskMeshPopulation(task) {
	if (task._addMesh) return;
	task._pendingMeshes ??= [];
	task._addMesh = queueMesh;
	task._recordExplicit = transactRenderTask;
	task._retireRenderable = retireRenderable;
}
function retireRenderable(engine, renderable) {
	if (renderable._lifetimeDisposers) retireGpuResourceBatch(engine, renderable._lifetimeDisposers);
}
function queueMesh(mesh, opts) {
	if (this._disposed) ThrowLiteError(173);
	const material = opts?.material ?? mesh.material;
	if (!material) return;
	this._pendingMeshes.push({
		mesh,
		material
	});
	if (this._sceneBG) _rebindRenderTask(this);
}
/** Remove a mesh and its task-owned resources from this task. Idempotent. */
function removeMeshFromTask(task, mesh) {
	const pending = task._pendingMeshes;
	if (pending) {
		for (let index = pending.length - 1; index >= 0; index--) if (pending[index].mesh === mesh) pending.splice(index, 1);
	}
	_removeMeshFromRenderTask(task, mesh);
}
/** Show or hide a mesh in this task alone, whatever `mesh.visible` says: `true` draws it here though it is hidden
*  everywhere else, `false` leaves it out here though it is shown, `undefined` hands the word back to the mesh. Only
*  this task's recorded parts that hold the mesh are recorded again; no other task is touched. For a renderable with
*  one mesh (every PBR and standard draw, a see-through or thin-instanced shader draw): opaque plain meshes that share
*  one shader material are drawn together and follow the meshes' own word. */
function setTaskMeshVisible(task, mesh, visible) {
	const now = task._vo?.get(mesh);
	if (now === visible) return;
	if (visible === void 0) task._vo.delete(mesh);
	else (task._vo ??= /* @__PURE__ */ new Map()).set(mesh, visible);
	// The task looks at its parts' visible meshes again on its next frame.
	task._lastVis = void 0;
}
/** Whether `task` drew nothing on its last frame because a draw of its list waited for its pipeline (`drawWhole`). */
function isRenderTaskHeld(task) {
	return task._held === true;
}
/** Resolves once none of the pipelines the draws of `task` waited for, as its list was last built, is compiling (at
*  once where none waited). A draw list is built again on the task's next frame after a pipeline it waited for is in,
*  and meshes that joined meanwhile may wait for more: a task drawn on demand is drawn, and `isRenderTaskHeld` looked
*  at, after this resolves. */
function whenRenderTaskPipelinesIdle(task) {
	const waits = task._waits;
	return waits?.length ? Promise.all(waits).then(() => void 0) : Promise.resolve();
}
/** @internal Rebind an explicit task without rebuilding its render targets. */
function _rebindRenderTask(task) {
	transactRenderTask(task);
}
export { _buildBindings, _enableTaskMeshPopulation, _rebindRenderTask, resolvePendingTaskMeshes as _resolvePendingMeshes, _writePassSceneUBO, addMeshToTask, createRenderTask, drawList, isRenderTaskHeld, removeMeshFromTask, setTaskMeshVisible, whenRenderTaskPipelinesIdle };

//# sourceMappingURL=render-task.js.map