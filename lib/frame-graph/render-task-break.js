import { TU } from "../engine/gpu-flags.js";
import { getBilinearSampler } from "../resource/samplers.js";
import { createDepthGrab, recordDepthGrab } from "./transmission-depth-grab.js";
// A break of a render task's pass, with the frame as drawn so far kept (Day Hike's patch; no upstream source).
/**
* Break a render task's pass in two on the frames that show a mesh marked `afterBreak`, and keep the frame as the
* first half drew it for the second half to read.
*
* The first half is the task's opaque and direct draws, as ever. The second half begins the pass again over what
* the first stored and draws the meshes marked `afterBreak` and the see-through draws: a marked mesh with an opaque
* material is drawn first among them, by its render order, with its material's own pipeline, so it tests and writes
* depth; a marked see-through mesh keeps its place in the back-to-front order.
*
* What is kept, each a texture of the task's own size made again whenever the task is recorded (a resize):
*   - the colour (`color`, on by default), in the target's own format, one level, one sample a pixel. A multisampled
*     task's first half is resolved into it in place of the task's resolve target, so it costs no copy and no pass;
*     a single-sampled task's colour is copied into it (not from the canvas's own target);
*   - the depth (`depth`), `r32float` as stored, sample 0 of a multisampled depth: one pass of one triangle.
* `onBreak` is called between the halves with the frame's encoder, for passes of the application's own.
*
* A frame that shows no marked mesh is drawn exactly as a task without a break draws it: one pass, nothing kept.
* A PBR material's bind group for a marked mesh is made when a draw list is built, after the kept textures are, so
* its plugins' `bindTextures` may hand them on (`texture`, `depthTexture`). Call before the task is first recorded
* (before its scene is registered); not for a task with `enableRenderTaskTransmission`.
*/
function enableRenderTaskBreak(task, engine, options) {
	if (task._break) return task._break._handle;
	if (task._sceneBG) throw new Error("enableRenderTaskBreak: the task is already recorded");
	const keepColor = options?.color !== false;
	const keepDepth = options?.depth === true;
	const onBreak = options?.onBreak;
	const device = engine._device;
	let color = null;
	let depth = null;
	const release = () => {
		color?.texture.destroy();
		depth?.texture.texture.destroy();
		color = depth = null;
	};
	const handle = {
		get texture() {
			return color;
		},
		get depthTexture() {
			return depth?.texture ?? null;
		},
		breaks: 0
	};
	const state = task._break = {
		_handle: handle,
		_color: null,
		/** Makes what is kept, for the targets as the task has just built them. */
		_record(recorded) {
			release();
			const cfg = recorded._config;
			const rt = cfg.rt;
			const width = rt._width;
			const height = rt._height;
			const format = rt._descriptor.format;
			const multisampled = recorded._targetSignature._sampleCount > 1;
			// A single-sampled target is copied from, which the canvas's own texture does not allow.
			if (keepColor && format && width > 0 && height > 0 && (multisampled || rt._colorTexture && rt !== recorded.scene.surface.scRT)) {
				const texture = device.createTexture({
					label: `${recorded.name}-kept`,
					size: {
						width,
						height
					},
					format,
					usage: TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING | TU.COPY_DST
				});
				const view = texture.createView();
				color = {
					texture,
					view,
					sampler: getBilinearSampler(engine),
					width,
					height,
					invertY: false,
					_view: view
				};
			}
			const source = (cfg.depth ?? rt)._depthTexture;
			if (keepDepth && source && width > 0 && height > 0) depth = createDepthGrab(engine, source, width, height, multisampled);
			state._color = color;
		},
		/** Between the halves: the depth as the first half left it, then the application's own passes. */
		_between(eng, encoder) {
			if (depth) recordDepthGrab(eng, depth);
			handle.breaks++;
			onBreak?.(encoder);
		}
	};
	const dispose = task.dispose.bind(task);
	task.dispose = () => {
		release();
		state._color = null;
		dispose();
	};
	return handle;
}
export { enableRenderTaskBreak };
