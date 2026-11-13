import { ThrowLiteError } from "../lite-error.js";
import { retireGpuResources } from "../engine/gpu-resource-retirement.js";
// src/scene/scene-renderable-collection.ts
function getCollection(scene, family) {
	const collections = scene._renderableCollections ??= /* @__PURE__ */ new Map();
	let collection = collections.get(family);
	if (!collection) collections.set(family, collection = { _members: /* @__PURE__ */ new Map() });
	return collection;
}
/** @internal Add `entity` to its family's collection and schedule its render attachment with the scene's other
*  deferred render work. `register` installs feature registrations (e.g. a pick source) before the addition is
*  published; its result runs when the member leaves. Does nothing when `entity` is already a member. An
*  attachment whose member was removed (or removed and re-added) before it finished building is released, not
*  drawn. */
function _addSceneRenderable(scene, family, entity, attach, register) {
	const collection = getCollection(scene, family);
	const members = collection._members;
	if (members.has(entity)) return;
	const entry = { _unregister: register?.() };
	members.set(entity, entry);
	scene._deferredBuilders.push(async () => {
		if (members.get(entity) !== entry) return;
		const attachment = await attach(scene.surface.engine);
		if (members.get(entity) !== entry) {
			attachment._detach?.()();
			return;
		}
		entry._attachment = attachment;
		scene._renderables.push(attachment._renderable);
		scene._disposables.push(entry._dispose = () => attachment._detach?.()());
	});
	collection._publish?.({
		type: "added",
		entity
	});
}
/** @internal Remove `entity` from its family's collection. Its built renderable stops drawing immediately and its
*  GPU state is released after in-flight frames. Returns whether `entity` was a member. */
function _removeSceneRenderable(scene, family, entity) {
	const collection = scene._z ? void 0 : scene._renderableCollections?.get(family);
	const entry = collection?._members.get(entity);
	if (!entry) return false;
	collection._members.delete(entity);
	const renderable = entry._attachment?._renderable;
	const index = renderable ? scene._renderables.indexOf(renderable) : -1;
	if (index >= 0) {
		scene._renderables.splice(index, 1);
		scene._renderableVersion++;
	}
	const disposeIndex = entry._dispose ? scene._disposables.indexOf(entry._dispose) : -1;
	if (disposeIndex >= 0) scene._disposables.splice(disposeIndex, 1);
	entry._unregister?.();
	const release = entry._attachment?._detach?.();
	if (release) retireGpuResources(scene.surface.engine, release);
	collection._publish?.({
		type: "removed",
		entity
	});
	return true;
}
/** @internal Snapshot of a family's members, in add order. */
function _getSceneRenderables(scene, family) {
	const members = scene._z ? void 0 : scene._renderableCollections?.get(family)?._members;
	return members ? [...members.keys()] : [];
}
/** @internal Subscribe to a family's committed membership changes.
*
*  A change made by a listener is published after the current change reaches every listener. Listener failures do
*  not prevent later listeners from running; they are rethrown to the mutating caller once dispatch completes.
*  Scene disposal publishes no removals. The returned callback removes only this
*  registration and is idempotent. */
function _observeSceneRenderables(scene, family, listener) {
	if (scene._z) ThrowLiteError(858);
	const collection = getCollection(scene, family);
	const listeners = collection._listeners ??= /* @__PURE__ */ new Set();
	if (!collection._publish) {
		const pending = [];
		collection._publish = (event) => {
			if (pending.push(event) > 1) return;
			const failures = [];
			for (let i = 0; i < pending.length; i++) for (const subscribed of [...listeners]) if (listeners.has(subscribed)) try {
				subscribed(pending[i]);
			} catch (error) {
				failures.push(error);
			}
			pending.length = 0;
			if (failures.length) throw failures.length > 1 ? new AggregateError(failures) : failures[0];
		};
	}
	const subscribed = (event) => listener(event);
	listeners.add(subscribed);
	return () => {
		listeners.delete(subscribed);
	};
}
export { _addSceneRenderable, _getSceneRenderables, _observeSceneRenderables, _removeSceneRenderable };

//# sourceMappingURL=scene-renderable-collection.js.map