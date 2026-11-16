import { ThrowLiteError } from "../lite-error.js";
import { F32 } from "../engine/typed-arrays.js";
import { _applyCameraViewport, _cameraChangeKey, getViewMatrix } from "../camera/camera.js";
import { buildRenderTarget, disposeRenderTarget } from "../engine/render-target.js";
import { _drawEpoch, _pipelineEpoch, _res, _vis } from "../engine/engine.js";
import { createEmptyUniformBuffer } from "../resource/empty-uniform-buffer.js";
import { retireGpuResources } from "../engine/gpu-resource-retirement.js";
import { getSceneBindGroupLayout } from "../render/scene-helpers.js";
import { ensureSceneLightState, refreshSceneLightsUBO } from "../render/scene-lights-ubo.js";
import "../shader/scene-uniforms-size.js";
import { _packSceneUniforms } from "./scene-uniforms-pack.js";
import { drawBindingLifecycle } from "../render/draw-binding-lifecycle.js";
// src/frame-graph/render-task-base.ts
/**
* Shared render-pass execution and automatic scene rendering. This module
* borrows renderables; the public render-task factory adds explicit ownership.
*
*   - `record()` builds bucketed `DrawBinding` lists from `_renderables`
*     (opaque / direct / transparent), sorts opaque + direct by
*     `order`, then creates a `RenderPass` wired to the task's render target.
*     The pass owns its
*     `GPURenderPassDescriptor` and the per-pass-encoder body lives in a
*     closure passed to `setRenderPassExecuteFunc`.
*   - Before `RenderPass._execute()` begins the GPU pass: writes the scene UBO, refreshes lights, updates
*     per-binding UBOs, mirrors live `scene.clearColor` + `clr` onto the
*     render pass. Shared task execution then calls `_execute()`. The
*     `RenderPass` itself patches the swapchain view + clearColor + loadOp
*     and brackets the body with `beginRenderPass` / `end`.
*
* Renderable population:
*   - Explicit: `addMeshToTask(task, mesh, opts)` builds a (mesh, material)
*     Renderable at `record()` time and selects explicit population.
*   - Auto scene mirror: copy the scene's renderables until explicit ownership entries exist.
*     Re-sync happens automatically when the scene's
*     `_renderableVersion` changes between frames (mesh add/remove, material swap).
*
* The engine `scRT` is just another `RenderTarget` here: a task that
* targets it (`rt`) or resolves into it (`rst`) re-reads its per-frame color view
* at execute time (the swap texture is re-acquired each frame). `clr: false`
* preserves color content, while `depthClear: false` preserves rt-owned depth,
* so multiple tasks can share a target in one frame.
*/
function createBindingGeneration(renderables, version) {
	return {
		_renderables: renderables,
		_opaqueBindings: [],
		_directBindings: [],
		_transparentBindings: [],
		_afterBreak: null,
		_ob: [],
		_lastVersion: version,
		_waiting: false,
		_pipelineEpoch
	};
}
/** Create a render pass task. GPU resources (target textures + descriptor)
*  are not allocated until `record()` runs (via `frameGraph.build()`).
*
*  Swapchain-targeted tasks acquire the swap view per-frame at execute time.
*  @internal Automatic tasks borrow renderables and do not expose explicit mesh population. */
function _createAutomaticRenderTask(config, engine, scene) {
	config.clr ??= true;
	const desc = config.rt._descriptor;
	const depthDesc = config.depth?._descriptor;
	const targetSignature = {
		_colorFormat: desc.format,
		_depthStencilFormat: depthDesc?.dFormat ?? desc.dFormat,
		_depthCompare: desc.depthCompare ?? depthDesc?.depthCompare,
		_sampleCount: desc.samples
	};
	const colorAttachment = {
		loadOp: "clear",
		storeOp: "store"
	};
	const updateContext = {
		targetWidth: 0,
		targetHeight: 0
	};
	const task = {
		...createBindingGeneration([], -1),
		name: config.name,
		_config: config,
		_ownsTargets: !config.sharedRt,
		engine,
		scene,
		_passes: [],
		_renderPassDescriptor: { colorAttachments: [colorAttachment] },
		_colorAttachment: colorAttachment,
		_sceneUBO: createEmptyUniformBuffer(engine, 368),
		_suData: new F32(92),
		_sceneUboCacheKey: [],
		_targetSignature: targetSignature,
		_getOutputInfo: () => task.enabled === false ? void 0 : {
			colorTexture: config.rt,
			resolveTexture: config.rst
		},
		_updateContext: updateContext,
		record() {
			if (task._disposed) ThrowLiteError(167);
			if (task._recordExplicit) task._recordExplicit(task, true);
			else _buildBindings(task, config.autoMirror !== false ? scene._renderables.slice() : task._renderables, true);
		},
		execute() {
			return executePass(task, engine, targetSignature);
		},
		dispose() {
			if (task._disposed) return;
			task._disposed = true;
			if (drawBindingLifecycle) drawBindingLifecycle._retire([
				task._opaqueBindings,
				task._directBindings,
				task._transparentBindings
			]);
			const pending = task._pendingMeshes;
			if (pending) pending.length = 0;
			for (const renderable of task._renderables) task._retireRenderable?.(task.engine, renderable);
			task._passes.length = task._opaqueBindings.length = task._directBindings.length = 0;
			task._transparentBindings.length = task._renderables.length = task._ob.length = 0;
			if (task._ownsTargets) {
				disposeRenderTarget(config.rt);
				disposeRenderTarget(config.rst);
			}
			if (!config.depth?._eager) disposeRenderTarget(config.depth);
			const buffer = task._sceneUBO;
			retireGpuResources(task.engine, () => buffer.destroy());
			task._batchState?._release(task.engine);
			task._batchState = void 0;
		}
	};
	return task;
}
/** Remove a mesh from this task's renderable + binding lists. Idempotent. */
function _removeMeshFromRenderTask(task, mesh) {
	if (!task._renderables) return;
	task._removeMesh?.(mesh);
	let removed = false;
	for (let i = task._renderables.length - 1; i >= 0; i--) if (task._renderables[i].mesh === mesh) {
		task._retireRenderable?.(task.engine, task._renderables[i]);
		task._renderables.splice(i, 1);
		removed = true;
	}
	for (const arr of [
		task._opaqueBindings,
		task._directBindings,
		task._transparentBindings
	]) for (let i = arr.length - 1; i >= 0; i--) if (arr[i].renderable.mesh === mesh) {
		if (drawBindingLifecycle) drawBindingLifecycle._retire([[arr[i]]]);
		arr.splice(i, 1);
		removed = true;
	}
	if (removed) {
		if (task._afterBreak) task._afterBreak = task._afterBreak.filter((binding) => binding.renderable.mesh !== mesh);
		const previous = task._batchState;
		task._batchState = previous?._select([
			task._opaqueBindings,
			task._directBindings,
			task._transparentBindings
		]);
		previous?._release(task.engine, [task._batchState]);
		// The list changed: its recorded parts are matched against it again, and those it left alone are kept.
		if (task._obParts && !task._executeWithTransmission) task._obList = true;
		else task._ob.length = 0;
		task._lastVersion = -1;
	}
}
/** Draws a recorded part of the opaque list at most: a part's visible meshes are one 32-bit key. */
var OPAQUE_PART = 32;
/** Where the opaque list is cut into parts. A cut is proposed by one renderable in OPAQUE_CUT (by a number given at
*  its first recording) and made at the next change of pipeline, or OPAQUE_CUT_WAIT draws on where there is none:
*  the cuts follow the renderables, not their places in the list, so a list that gains or loses a mesh has the same
*  parts but the one the mesh is in, and a part begins where a pipeline would be set anyway. */
var OPAQUE_CUT = 24;
var OPAQUE_CUT_WAIT = 8;
var _opaqueSerial = 0;
/** The end of the part of `list` that starts at `start`. */
function opaquePartEnd(list, start) {
	let end = start + 1;
	let waited = -1;
	list[start].renderable._os ??= _opaqueSerial++;
	for (; end < list.length && end - start < OPAQUE_PART; end++) {
		const binding = list[end];
		const proposes = (binding.renderable._os ??= _opaqueSerial++) % OPAQUE_CUT === 0;
		if (waited < 0 && proposes) waited = 0;
		if (waited >= 0 && (binding.pipeline !== list[end - 1].pipeline || waited++ >= OPAQUE_CUT_WAIT)) break;
	}
	return end;
}
/** Whether a recorded part holds the draws `list[start..end)` would record: the same bindings, or bindings made again
*  for the same renderables with the same pipelines that say (`_same`) what they draw with has not changed. */
function sameOpaquePart(part, list, start, end, key, stamp) {
	const recorded = part._bindings;
	if (part._key !== key || part._stamp !== stamp || recorded.length !== end - start) return false;
	for (let i = start; i < end; i++) {
		const now = list[i];
		const was = recorded[i - start];
		if (now !== was && (now.renderable !== was.renderable || now.pipeline !== was.pipeline || now._same === void 0 || now._same !== was._same)) return false;
	}
	return true;
}
function compareTransparentBindings(a, b) {
	return b._sortDistance - a._sortDistance || a.renderable.order - b.renderable.order;
}
function compareBindingOrder(a, b) {
	return a.renderable.order - b.renderable.order;
}
var _pipelineRanks = /* @__PURE__ */ new WeakMap();
var _pipelineRankNext = 0;
function pipelineRank(pipeline) {
	if (!pipeline) return -1;
	let rank = _pipelineRanks.get(pipeline);
	if (rank === void 0) _pipelineRanks.set(pipeline, rank = _pipelineRankNext++);
	return rank;
}
/** Opaque draws of one render order grouped by pipeline, so a recorded list changes pipeline once a pipeline. */
function compareOpaqueBindings(a, b) {
	return a.renderable.order - b.renderable.order || pipelineRank(a.pipeline) - pipelineRank(b.pipeline);
}
/** Per-frame back-to-front sort for transparent bindings using the active camera. */
function sortTransparentBindings(task, camera) {
	const arr = task._transparentBindings;
	if (arr.length <= 1 || !camera) return;
	const v = getViewMatrix(camera);
	for (const b of arr) {
		const wc = b.renderable._worldCenter;
		// An opaque draw of the half after a task's break stands before every see-through draw, by its order.
		b._sortDistance = b._late ? Infinity : wc ? wc[0] * v[2] + wc[1] * v[6] + wc[2] * v[10] + v[14] : 0;
	}
	arr.sort(compareTransparentBindings);
}
/** @internal Build and publish a complete binding generation. Explicit candidates defer retirement until task publication. */
function _buildBindings(task, renderables = task._renderables, record = false, publish = true, retainedOnFailure) {
	const config = task._config;
	const rt = config.rt;
	const previousBatchState = task._batchState;
	const generation = createBindingGeneration(renderables, task.scene._renderableVersion);
	if (record) {
		const buildTarget = (target, always) => {
			if (target && (always || task._ownsTargets || target._eager)) buildRenderTarget(target, task.engine);
		};
		buildTarget(rt);
		if (rt._descriptor.samples > 1) buildTarget(config.rst);
		buildTarget(config.depth, true);
		// What a task's break keeps is made once its targets are and before any draw is bound, so a material can bind it.
		task._break?._record(task);
	}
	const { _opaqueBindings: opaque, _directBindings: direct, _transparentBindings: transparent } = generation;
	// Only the tasks that are built again when a pipeline becomes ready may leave a mesh out meanwhile.
	const mayWait = config.autoMirror !== false || !!task._recordExplicit;
	try {
		for (const renderable of renderables) {
			const binding = renderable.bind(task.engine, task._targetSignature, mayWait);
			if (!binding) {
				generation._waiting = true;
				continue;
			}
			generation._batchState = task._targetSignature._collectBatches?.(generation._batchState, binding);
			// A mesh drawn after the task's break is listed with the see-through draws, which are drawn there; an opaque
			// one is marked to be drawn first among them.
			if (task._break && renderable.mesh?.afterBreak === true) {
				binding._late = !(renderable.isTransparent || renderable._transmissive);
				(generation._afterBreak ??= []).push(binding);
				transparent.push(binding);
			} else if (renderable.isTransparent || renderable._transmissive) transparent.push(binding);
			else if (renderable._direct) direct.push(binding);
			else opaque.push(binding);
		}
		opaque.sort(compareOpaqueBindings);
		direct.sort(compareBindingOrder);
		// The opaque draws of the half after a break lead the see-through list as it is built, by their order; the
		// frame's own sort keeps them there.
		if (generation._afterBreak) transparent.sort((a, b) => (a._late ? 0 : 1) - (b._late ? 0 : 1) || (a._late ? a.renderable.order - b.renderable.order : 0));
		if (record) refreshTaskSceneBindGroup(task, task.engine, false);
	} catch (error) {
		if (drawBindingLifecycle) drawBindingLifecycle._retire([
			generation._opaqueBindings,
			generation._directBindings,
			generation._transparentBindings
		], [
			task._opaqueBindings,
			task._directBindings,
			task._transparentBindings
		]);
		generation._batchState?._release(void 0, retainedOnFailure ?? [previousBatchState]);
		throw error;
	}
	if (record) {
		buildRenderPassDescriptor(task, rt);
		task._updateContext.targetWidth = rt._width;
		task._updateContext.targetHeight = rt._height;
	}
	if (publish) {
		if (drawBindingLifecycle) drawBindingLifecycle._retire([
			task._opaqueBindings,
			task._directBindings,
			task._transparentBindings
		], [
			opaque,
			direct,
			transparent
		]);
		// A list built again for a mesh added or removed keeps its recorded bundles: `executePassBody` matches the
		// recorded parts against the new list and records only those that differ.
		const recorded = !record && task._obParts && task._ob.length && !task._executeWithTransmission ? task._ob : null;
		Object.assign(task, generation);
		if (recorded) {
			task._ob = recorded;
			task._obList = true;
		}
		previousBatchState?._release(task.engine, [generation._batchState]);
	}
	return generation;
}
function buildRenderPassDescriptor(task, rt) {
	const config = task._config;
	const att = task._colorAttachment;
	att.view = rt._colorView;
	task._renderPassDescriptor.colorAttachments = rt._colorView ? [att] : [];
	const depthSrc = config.depth ?? rt;
	const depthView = depthSrc._depthView;
	let depthAttachment;
	if (depthView) {
		const dd = depthSrc._descriptor;
		const loadOp = (config.depth ? depthSrc._eager : config.depthClear === false) ? "load" : "clear";
		depthAttachment = {
			view: depthView,
			depthClearValue: dd.depthClearValue ?? 0,
			depthLoadOp: loadOp,
			depthStoreOp: "store"
		};
		if (dd.dFormat?.includes("stencil")) {
			depthAttachment.stencilClearValue = 0;
			depthAttachment.stencilLoadOp = loadOp;
			depthAttachment.stencilStoreOp = "store";
		}
	}
	task._renderPassDescriptor.depthStencilAttachment = depthAttachment;
}
function prepareRenderTaskPass(task, eng, targetSignature) {
	const sc = task.scene;
	const ready = task._waiting && task._pipelineEpoch !== _pipelineEpoch;
	if (task._config.autoMirror !== false) {
		if (ready || task._lastVersion !== sc._renderableVersion) _buildBindings(task, sc._renderables.slice());
	} else if (ready && task._recordExplicit) task._recordExplicit(task);
	refreshTaskSceneBindGroup(task, eng);
	const context = task._updateContext;
	const camera = task._config.cam ?? sc.camera;
	if (targetSignature._colorFormat) {
		if (!task._config._skipClusteredLights) sc._clusteredLightUpdater?.(camera, context.targetWidth, context.targetHeight);
		refreshSceneLightsUBO(eng, sc);
	}
	_writePassSceneUBO(task, eng, sc, camera);
	context._camera = camera;
	task._batchState?._reset();
	updateBindings(task._opaqueBindings, context);
	updateBindings(task._directBindings, context);
	updateBindings(task._transparentBindings, context);
	task._batchState?._flush(eng);
	sortTransparentBindings(task, camera);
}
function executePass(task, eng, targetSignature) {
	if (task.enabled === false) return 0;
	const sc = task.scene;
	prepareRenderTaskPass(task, eng, targetSignature);
	const att = task._colorAttachment;
	const cfg = task._config;
	if (cfg.rt._colorView) {
		if (cfg.rt === sc.surface.scRT) att.view = cfg.rt._colorView;
		att.resolveTarget = cfg.rst?._colorView ?? void 0;
		att.clearValue = cfg.clrColor ?? sc.clearColor;
		att.loadOp = cfg.clr ? "clear" : "load";
	}
	if (task._executeWithTransmission) return task._executeWithTransmission(targetSignature._sampleCount);
	if (task._break && task._afterBreak && shownAfterBreak(task._afterBreak)) return executePassBroken(task, eng, task._break, targetSignature._sampleCount);
	const pass = eng._currentEncoder.beginRenderPass(task._renderPassDescriptor);
	const draws = executePassBody(task, pass);
	pass.end();
	return draws;
}
/** Whether any draw of the half after a task's break would draw this frame. */
function shownAfterBreak(list) {
	for (const binding of list) {
		const mesh = binding.renderable.mesh;
		if (mesh.visible !== false && !mesh._skipColorDraw && mesh.thinInstances?.count !== 0) return true;
	}
	return false;
}
/** A task's pass in two halves (`enableRenderTaskBreak`): the opaque and direct draws, then, the pass begun again
*  over what the first half stored, the draws the application named and the see-through draws. Between them the
*  colour as drawn so far is kept: a multisampled target's first half is resolved into the kept texture in place of
*  the task's resolve target, at no copy, and a single-sampled target is copied; the depth is kept by one triangle
*  where asked. Reached only on a frame that shows a mesh drawn after the break. */
function executePassBroken(task, eng, brk, sampleCount) {
	const encoder = eng._currentEncoder;
	const cfg = task._config;
	const rt = cfg.rt;
	const descriptor = task._renderPassDescriptor;
	const att = task._colorAttachment;
	const resolve = att.resolveTarget;
	const kept = brk._color;
	if (kept && sampleCount > 1) att.resolveTarget = kept._view;
	let pass = encoder.beginRenderPass(descriptor);
	let draws = executePassBody(task, pass, false);
	pass.end();
	if (kept && !(sampleCount > 1)) encoder.copyTextureToTexture({ texture: rt._colorTexture }, { texture: kept.texture }, {
		width: kept.width,
		height: kept.height
	});
	brk._between(eng, encoder);
	// The second half loads what the first stored and resolves where the task resolves.
	att.resolveTarget = resolve;
	att.loadOp = "load";
	const depth = descriptor.depthStencilAttachment;
	const depthLoadOp = depth?.depthLoadOp;
	const stencilLoadOp = depth?.stencilLoadOp;
	if (depth) {
		depth.depthLoadOp = "load";
		if (stencilLoadOp) depth.stencilLoadOp = "load";
	}
	pass = encoder.beginRenderPass(descriptor);
	if (depth) {
		depth.depthLoadOp = depthLoadOp;
		if (stencilLoadOp) depth.stencilLoadOp = stencilLoadOp;
	}
	_applyCameraViewport(pass, cfg.cam ?? task.scene.camera, rt._width, rt._height);
	pass.setBindGroup(0, task._sceneBG);
	draws += drawList(pass, task._transparentBindings, eng, true);
	pass.end();
	return draws;
}
/** Body of the registered `RenderPass`. Receives the live render-pass encoder
*  and issues all draws (viewport/scissor, group(0) bind, opaque bundle replay,
*  then direct-draws non-transparent direct + transparent). Returns the draw count. */
function executePassBody(task, pass, seeThrough = true) {
	const eng = task.engine;
	const cfg = task._config;
	const rt = cfg.rt;
	const scene = task.scene;
	const opaqueBindings = task._opaqueBindings;
	const opaqueBundles = task._ob;
	const sceneBG = task._sceneBG;
	const camera = cfg.cam ?? scene.camera;
	_applyCameraViewport(pass, camera, rt._width, rt._height);
	// The opaque list is recorded in parts of at most OPAQUE_PART draws, a bundle each. When a mesh is shown or hidden,
	// or the list was built again for a mesh added or removed, and nothing else changed, only the parts whose draws or
	// set of visible meshes changed are recorded again.
	const all = !opaqueBundles.length || task._lastRes !== _res || task._obBG !== sceneBG || !task._obParts;
	if (all || task._obList || task._lastVis !== _vis) {
		// The count as it stands before anything is recorded: a mesh's buffer made again by a draw as it is recorded
		// has the parts looked at again on the next frame.
		const vis = _vis;
		const record = (start, end) => {
			const desc = rt._descriptor;
			const be = eng._device.createRenderBundleEncoder({
				colorFormats: desc.format ? [desc.format] : [],
				depthStencilFormat: task._targetSignature._depthStencilFormat,
				sampleCount: desc.samples
			});
			be.setBindGroup(0, sceneBG);
			drawList(be, opaqueBindings, eng, false, start, end);
			return be.finish();
		};
		// A part's visible meshes as a key, and (`stamp`) how often a buffer of one of its meshes was made again: a draw
		// with no mesh of its own is held to every such change.
		let stamp = 0;
		const visible = (start, end) => {
			let key = 0;
			stamp = 0;
			for (let i = start; i < end; i++) {
				const mesh = opaqueBindings[i].renderable.mesh;
				if (mesh?.visible !== false) key |= 1 << i - start;
				stamp = stamp + (mesh ? (mesh._gpu?._rec ?? 0) + (mesh.thinInstances?._rec ?? 0) : _drawEpoch) | 0;
			}
			return key;
		};
		let changed = true;
		if (all || task._obList) {
			// The list is cut into parts; a part recorded before is kept where its draws and visible meshes are the same.
			const recorded = all ? void 0 : task._obMap;
			const parts = task._obParts = [];
			const map = task._obMap = /* @__PURE__ */ new Map();
			for (let start = 0, end; start < opaqueBindings.length; start = end) {
				end = opaquePartEnd(opaqueBindings, start);
				const key = visible(start, end);
				let part = recorded?.get(opaqueBindings[start].renderable);
				if (part && sameOpaquePart(part, opaqueBindings, start, end, key, stamp)) part._bindings = opaqueBindings.slice(start, end);
				else part = {
					_key: key,
					_stamp: stamp,
					_bindings: opaqueBindings.slice(start, end),
					_bundle: key ? record(start, end) : null
				};
				parts.push(part);
				map.set(opaqueBindings[start].renderable, part);
			}
		} else {
			// Meshes were shown or hidden and the list stands: its parts stand too.
			changed = false;
			let start = 0;
			for (const part of task._obParts) {
				const end = start + part._bindings.length;
				const key = visible(start, end);
				if (part._key !== key || part._stamp !== stamp) {
					part._key = key;
					part._stamp = stamp;
					part._bundle = key ? record(start, end) : null;
					changed = true;
				}
				start = end;
			}
		}
		if (changed) {
			opaqueBundles.length = 0;
			for (const part of task._obParts) if (part._bundle) opaqueBundles.push(part._bundle);
		}
		task._lastVis = vis;
		task._lastRes = _res;
		task._obBG = sceneBG;
		task._obList = false;
	}
	let draws = opaqueBindings.length;
	if (opaqueBundles.length) pass.executeBundles(opaqueBundles);
	// The scene's bind group, set once a pass: the bundles carry their own and leave the pass with none.
	pass.setBindGroup(0, sceneBG);
	draws += drawList(pass, task._directBindings, eng);
	if (seeThrough) draws += drawList(pass, task._transparentBindings, eng, true);
	return draws;
}
function refreshTaskSceneBindGroup(task, eng, invalidateBundles = true) {
	const lightsUBO = ensureSceneLightState(eng, task.scene)._buffer;
	if (lightsUBO === task._lightsUBO) return;
	const sceneBG = eng._device.createBindGroup({
		layout: getSceneBindGroupLayout(eng),
		entries: [{
			binding: 0,
			resource: { buffer: task._sceneUBO }
		}, {
			binding: 1,
			resource: { buffer: lightsUBO }
		}]
	});
	task._lightsUBO = lightsUBO;
	task._sceneBG = sceneBG;
	if (invalidateBundles) task._ob = [];
}
/** Write the canonical SceneUniforms struct to the task-owned scene UBO.
*  Bails before touching scratch/GPU when all inputs are unchanged.
*  @internal Exported for unit testing of the scene-UBO change-detection guard. */
function _writePassSceneUBO(task, eng, scene, camera) {
	if (!camera) return;
	const v = camera.viewport;
	const rt = task._config.rt;
	const aspect = (task._config.cs ? eng.canvas.width / eng.canvas.height : rt._width / rt._height) * (v ? v.width / v.height : 1);
	if (drawBindingLifecycle) drawBindingLifecycle._setProjectionAspect(task._updateContext, aspect);
	const fog = scene.fog;
	const img = scene.imageProcessing;
	const wv = _cameraChangeKey(camera);
	const envTextures = scene._envTextures;
	const s = task._sceneUboCacheKey;
	if (s[0] === camera && s[1] === fog && s[2] === wv && s[3] === aspect && s[4] === img.exposure && s[5] === img.contrast && s[6] === envTextures) return;
	s[0] = camera;
	s[1] = fog;
	s[2] = wv;
	s[3] = aspect;
	s[4] = img.exposure;
	s[5] = img.contrast;
	s[6] = envTextures;
	const data = task._suData;
	_packSceneUniforms(data, eng, scene, camera, aspect);
	const contribs = scene._sceneUboContributors;
	if (contribs) for (const contributor of contribs) contributor(data, scene);
	eng._device.queue.writeBuffer(task._sceneUBO, 0, data);
}
function updateBindings(list, context) {
	for (const binding of list) binding.update?.(context);
}
/** @internal Iterate DrawBindings, deduping setPipeline.
*  Pass `transparent` only for transparent lists: shadow bindings are never
*  transparent, so their opaque/direct lists ignore colour-only draw omission. */
function drawList(enc, list, engine, transparent, start = 0, end = list.length) {
	let lp = null;
	let draws = 0;
	for (let i = start; i < end; i++) {
		const b = list[i];
		const mesh = b.renderable.mesh;
		if (mesh && (mesh.visible === false || transparent && mesh._skipColorDraw)) continue;
		if (b.pipeline !== lp) {
			enc.setPipeline(b.pipeline);
			lp = b.pipeline;
		}
		draws += b.draw(enc, engine);
	}
	return draws;
}
export { _buildBindings, _createAutomaticRenderTask, _removeMeshFromRenderTask, _writePassSceneUBO, drawList };

//# sourceMappingURL=render-task-base.js.map