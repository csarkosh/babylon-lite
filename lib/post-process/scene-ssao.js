import { ThrowLiteError } from "../lite-error.js";
import { createRenderTarget, disposeRenderTarget } from "../engine/render-target.js";
import { isRenderingContextRegistered } from "../engine/engine.js";
import { createDepthResolveTask } from "../frame-graph/depth-resolve-task.js";
import { buildFrameGraphTask, getFrameGraphTasks } from "../frame-graph/frame-graph.js";
import { addTaskAfter, removeTask } from "../frame-graph/frame-graph-actions.js";
import { createScreenSpaceAmbientOcclusionPostProcessTask } from "./screen-space-ambient-occlusion.js";
// src/post-process/scene-ssao.ts
var _pipelineStates = null;
function pipelineState(pipeline) {
	const state = _pipelineStates?.get(pipeline);
	if (!state) ThrowLiteError(810);
	return state;
}
/** Create an initially detached native scene-output SSAO pipeline. */
function createSceneSsaoPipeline(options, engine, scene, camera) {
	const pipeline = {
		name: options.name ?? "scene-ssao",
		camera,
		resolutionScale: options.resolutionScale ?? .5,
		radius: options.radius ?? .5,
		intensity: options.intensity ?? 1,
		base: options.base ?? 0,
		fadeEnd: options.fadeEnd ?? 60,
		attached: false
	};
	const state = {
		engine,
		scene,
		_disposed: false,
		_defaultTask: null,
		_baseRt: null,
		_baseRst: void 0,
		_priorOutputTexture: void 0,
		_tasks: [],
		_ownedTargets: [],
		_depthResolveTask: null,
		_aoTask: null,
		_gate: null,
		_sceneDispose: null
	};
	(_pipelineStates ??= /* @__PURE__ */ new WeakMap()).set(pipeline, state);
	return pipeline;
}
/** Attach a native scene-output SSAO pipeline to one fullscreen camera. */
function attachSceneSsaoPipeline(pipeline, camera = pipeline.camera) {
	const state = pipelineState(pipeline);
	if (state._disposed) ThrowLiteError(811, pipeline.name);
	if (pipeline.attached) {
		if (pipeline.camera !== camera) ThrowLiteError(812, pipeline.name);
		return;
	}
	const owningScene = state.scene;
	if (owningScene._sceneSsaoPipeline && owningScene._sceneSsaoPipeline !== pipeline) ThrowLiteError(813);
	pipeline.camera = camera;
	state._defaultTask = findDefaultTask(state.scene);
	owningScene._sceneSsaoPipeline = pipeline;
	try {
		createTasks(pipeline, state);
		state.scene._outputPipelineChange = (ready) => {
			if (ready) {
				state._defaultTask = findDefaultTask(state.scene);
				createTasks(pipeline, state);
				updateExecutionGate(pipeline, state);
			} else cleanupTasks(state);
		};
		state._gate = () => updateExecutionGate(pipeline, state);
		state.scene._beforeRender.push(state._gate);
		registerSceneDisposal(pipeline, state);
		setAttached(pipeline, true);
		updateExecutionGate(pipeline, state);
	} catch (error) {
		unregisterSceneDisposal(state);
		delete state.scene._outputPipelineChange;
		cleanupTasks(state);
		delete owningScene._sceneSsaoPipeline;
		throw error;
	}
}
/** Detach and release the owned graph chain while preserving the pipeline settings. */
function detachSceneSsaoPipeline(pipeline, camera = pipeline.camera) {
	const state = pipelineState(pipeline);
	if (!pipeline.attached || camera !== pipeline.camera) return;
	setAttached(pipeline, false);
	unregisterSceneDisposal(state);
	delete state.scene._outputPipelineChange;
	removeGate(state);
	cleanupTasks(state);
	const owningScene = state.scene;
	if (owningScene._sceneSsaoPipeline === pipeline) delete owningScene._sceneSsaoPipeline;
}
/** Permanently dispose a native scene-output SSAO pipeline. */
function disposeSceneSsaoPipeline(pipeline) {
	const state = pipelineState(pipeline);
	if (state._disposed) return;
	detachSceneSsaoPipeline(pipeline);
	state._disposed = true;
}
function setAttached(pipeline, attached) {
	pipeline.attached = attached;
}
function findDefaultTask(scene) {
	const tasks = getFrameGraphTasks(scene._frameGraph);
	const transmissionIndex = tasks.findIndex((task) => task.name === "transmission-image-processing");
	let task;
	if (transmissionIndex !== -1) {
		for (let i = transmissionIndex - 1; i >= 0; i--) if ("_renderables" in tasks[i]) {
			task = tasks[i];
			break;
		}
	} else task = tasks.find((candidate) => {
		const renderTask = candidate;
		return !!renderTask._config && "_renderables" in candidate && (renderTask._config.rt === scene.surface.scRT || renderTask._config.rst === scene.surface.scRT);
	});
	if (!task) ThrowLiteError(814);
	return task;
}
function createTasks(pipeline, state) {
	const scene = state.scene;
	const engine = state.engine;
	const surface = scene.surface;
	const render = state._defaultTask;
	const config = render._config;
	const baseRt = config.rt;
	const multisampled = (baseRt._descriptor.samples ?? 1) > 1;
	const transmission = getFrameGraphTasks(scene._frameGraph).some((task) => task.name === "transmission-image-processing");
	state._baseRt = baseRt;
	state._baseRst = config.rst;
	state._priorOutputTexture = scene._outputTexture;
	const source = createRenderTarget({
		lbl: `${pipeline.name}-source`,
		format: baseRt._descriptor.format ?? surface.format,
		samples: 1,
		size: surface
	});
	state._ownedTargets.push(source);
	if (multisampled) config.rst = source;
	else config.rt = source;
	let depth = config.depth ?? baseRt;
	if (multisampled) {
		depth = createRenderTarget({
			lbl: `${pipeline.name}-depth`,
			dFormat: "depth24plus-stencil8",
			samples: 1,
			size: surface
		});
		state._ownedTargets.push(depth);
		state._depthResolveTask = createDepthResolveTask({
			name: `${pipeline.name}-depth-resolve`,
			sourceTexture: baseRt,
			targetTexture: depth
		}, engine, scene);
		state._tasks.push(state._depthResolveTask);
	}
	const output = transmission || multisampled ? createRenderTarget({
		lbl: `${pipeline.name}-output${multisampled && !transmission ? "-msaa" : ""}`,
		format: baseRt._descriptor.format ?? surface.format,
		samples: multisampled && !transmission ? surface.msaaSamples : 1,
		size: surface
	}) : surface.scRT;
	if (output !== surface.scRT) state._ownedTargets.push(output);
	if (transmission) scene._outputTexture = output;
	const ao = createScreenSpaceAmbientOcclusionPostProcessTask({
		name: pipeline.name,
		sourceTexture: source,
		depthTexture: depth,
		targetTexture: output,
		resolveTexture: multisampled && !transmission ? surface.scRT : null,
		camera: pipeline.camera,
		resolutionScale: pipeline.resolutionScale,
		radius: pipeline.radius,
		intensity: pipeline.intensity,
		base: pipeline.base,
		fadeStart: pipeline.fadeEnd * .75,
		fadeEnd: pipeline.fadeEnd
	}, engine, scene);
	state._aoTask = ao;
	state._tasks.push(ao);
	let anchor = render;
	for (const task of state._tasks) {
		addTaskAfter(scene, task, anchor);
		anchor = task;
	}
	if (isRenderingContextRegistered(surface, scene)) {
		buildFrameGraphTask(scene._frameGraph, render);
		for (const task of state._tasks) buildFrameGraphTask(scene._frameGraph, task);
		rebuildTransmissionImageProcessing(state);
	}
}
function updateExecutionGate(pipeline, state) {
	const active = pipeline.attached && state.scene.camera === pipeline.camera;
	for (const task of state._tasks) task.executionEnabled = true;
	if (state._depthResolveTask) state._depthResolveTask.executionEnabled = active;
	if (state._aoTask) {
		state._aoTask.enabled = active;
		const resolutionScaleChanged = state._aoTask.resolutionScale !== pipeline.resolutionScale;
		state._aoTask.camera = pipeline.camera;
		state._aoTask.resolutionScale = pipeline.resolutionScale;
		state._aoTask.radius = pipeline.radius;
		state._aoTask.intensity = pipeline.intensity;
		state._aoTask.base = pipeline.base;
		state._aoTask.fadeStart = pipeline.fadeEnd * .75;
		state._aoTask.fadeEnd = pipeline.fadeEnd;
		if (resolutionScaleChanged && isRenderingContextRegistered(state.scene.surface, state.scene)) buildFrameGraphTask(state.scene._frameGraph, state._aoTask);
	}
}
function registerSceneDisposal(pipeline, state) {
	const dispose = () => {
		setAttached(pipeline, false);
		delete state.scene._outputPipelineChange;
		removeGate(state);
		state._tasks.length = 0;
		state._depthResolveTask = null;
		state._aoTask = null;
		const displacedBaseRt = state._defaultTask?._ownsTargets ? state._baseRt : null;
		restoreDefaultTask(state);
		disposeOwnedTargets(state);
		disposeRenderTarget(displacedBaseRt);
		const owningScene = state.scene;
		if (owningScene._sceneSsaoPipeline === pipeline) delete owningScene._sceneSsaoPipeline;
		state._sceneDispose = null;
		state._disposed = true;
	};
	state._sceneDispose = dispose;
	state.scene._disposables.push(dispose);
}
function unregisterSceneDisposal(state) {
	if (!state._sceneDispose) return;
	const index = state.scene._disposables.indexOf(state._sceneDispose);
	if (index !== -1) state.scene._disposables.splice(index, 1);
	state._sceneDispose = null;
}
function removeGate(state) {
	if (!state._gate) return;
	const index = state.scene._beforeRender.indexOf(state._gate);
	if (index !== -1) state.scene._beforeRender.splice(index, 1);
	state._gate = null;
}
function cleanupTasks(state) {
	for (let i = state._tasks.length - 1; i >= 0; i--) {
		const task = state._tasks[i];
		removeTask(state.scene, task);
		task.dispose();
	}
	state._tasks.length = 0;
	state._depthResolveTask = null;
	state._aoTask = null;
	restoreDefaultTask(state);
	disposeOwnedTargets(state);
}
function disposeOwnedTargets(state) {
	for (const target of state._ownedTargets.splice(0)) disposeRenderTarget(target);
}
function restoreDefaultTask(state) {
	if (state._defaultTask && state._baseRt) {
		state._defaultTask._config.rt = state._baseRt;
		state._defaultTask._config.rst = state._baseRst;
	}
	state.scene._outputTexture = state._priorOutputTexture;
	if (state._defaultTask && isRenderingContextRegistered(state.scene.surface, state.scene)) buildFrameGraphTask(state.scene._frameGraph, state._defaultTask);
	rebuildTransmissionImageProcessing(state);
	state._baseRt = null;
	state._baseRst = void 0;
	state._priorOutputTexture = void 0;
}
function rebuildTransmissionImageProcessing(state) {
	if (!isRenderingContextRegistered(state.scene.surface, state.scene)) return;
	const task = getFrameGraphTasks(state.scene._frameGraph).find((candidate) => candidate.name === "transmission-image-processing");
	if (task) buildFrameGraphTask(state.scene._frameGraph, task);
}
export { attachSceneSsaoPipeline, createSceneSsaoPipeline, detachSceneSsaoPipeline, disposeSceneSsaoPipeline };

//# sourceMappingURL=scene-ssao.js.map