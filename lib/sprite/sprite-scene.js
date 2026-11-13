import { ThrowLiteError } from "../lite-error.js";
import { _addSceneRenderable, _getSceneRenderables, _observeSceneRenderables, _removeSceneRenderable } from "../scene/scene-renderable-collection.js";
import { buildSpriteRenderable } from "./sprite-renderable.js";
// src/sprite/sprite-scene.ts
/**
* Adds a depth-hosted Sprite2D layer to the scene so it is drawn, depth-tested against scene geometry, once the
* scene builds. Adding a member again does nothing. Pure HUD layers (`depth: "none"`) are rendered by
* `createSpriteRenderer + registerSpriteRenderer` instead.
*/
function addDepthHostedSpriteLayerToScene(scene, layer) {
	if (layer.depth === "none") ThrowLiteError(935);
	_addSceneRenderable(scene, "depthSprite", layer, (engine) => {
		const built = buildSpriteRenderable(engine, layer);
		return {
			_renderable: built.renderable,
			_detach: () => built.dispose
		};
	});
}
/**
* Removes a depth-hosted Sprite2D layer from the scene. It stops drawing immediately; its scene-built GPU resources
* are released once in-flight frames finish. Returns `false` when the layer was not in the scene.
*/
function removeDepthHostedSpriteLayerFromScene(scene, layer) {
	return _removeSceneRenderable(scene, "depthSprite", layer);
}
/** Returns a snapshot of the scene's depth-hosted Sprite2D layers, in add order. */
function getSceneDepthHostedSpriteLayers(scene) {
	return _getSceneRenderables(scene, "depthSprite");
}
/** Subscribes to the scene's depth-hosted Sprite2D layer membership changes. The returned callback unsubscribes (idempotent). */
function onSceneDepthHostedSpriteLayersChanged(scene, listener) {
	return _observeSceneRenderables(scene, "depthSprite", listener);
}
export { addDepthHostedSpriteLayerToScene, getSceneDepthHostedSpriteLayers, onSceneDepthHostedSpriteLayersChanged, removeDepthHostedSpriteLayerFromScene };

//# sourceMappingURL=sprite-scene.js.map