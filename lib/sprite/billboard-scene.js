import { registerPickSource } from "../picking/pick-contributor.js";
import { _addSceneRenderable, _getSceneRenderables, _observeSceneRenderables, _removeSceneRenderable } from "../scene/scene-renderable-collection.js";
// src/sprite/billboard-scene.ts
/**
* Adds a billboard sprite system (camera-facing or axis-locked) to the scene so it is rendered each frame and
* pickable. Adding a member again does nothing.
*/
function addBillboardSystemToScene(scene, system) {
	_addSceneRenderable(scene, "billboard", system, async (engine) => {
		const { buildBillboardRenderable } = await import("./billboard-renderable.js");
		const built = system._sceneBuilder ? system._sceneBuilder(engine, buildBillboardRenderable) : buildBillboardRenderable(engine, system);
		return {
			_renderable: built.renderable,
			_detach: () => built.dispose
		};
	}, () => registerPickSource(scene, system, () => import("../picking/billboard-pick-pipeline.js")));
}
/**
* Removes a billboard sprite system from the scene. It stops drawing and being pickable immediately; its
* scene-built GPU resources are released once in-flight frames finish. Returns `false` when the system was not
* in the scene.
*/
function removeBillboardSystemFromScene(scene, system) {
	return _removeSceneRenderable(scene, "billboard", system);
}
/** Returns a snapshot of the scene's billboard sprite systems, in add order. */
function getSceneBillboardSystems(scene) {
	return _getSceneRenderables(scene, "billboard");
}
/** Subscribes to the scene's billboard sprite system membership changes. The returned callback unsubscribes (idempotent). */
function onSceneBillboardSystemsChanged(scene, listener) {
	return _observeSceneRenderables(scene, "billboard", listener);
}
export { addBillboardSystemToScene, getSceneBillboardSystems, onSceneBillboardSystemsChanged, removeBillboardSystemFromScene };

//# sourceMappingURL=billboard-scene.js.map