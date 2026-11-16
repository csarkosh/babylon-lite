import { ThrowLiteError } from "../lite-error.js";
import { TU } from "./gpu-flags.js";
import { acquireGPUTexture } from "../resource/gpu-texture-acquire.js";
import { releaseGPUTexture } from "../resource/gpu-texture-release.js";
// src/engine/render-target.ts
/**
* RenderTarget — describes and owns the GPU textures for a render pass.
*
* A RenderTarget is a pure-state description of color + depth/stencil
* attachments. GPU textures are allocated during the frame graph build
* phase (`buildRenderTarget`) and freed on dispose or rebuild.
*
* `createRenderTargetTexture` (texture/rtt.ts) eagerly allocates and marks
* the target so subsequent build calls are no-ops, allowing the color or depth
* view to be wired as a sampled texture before the frame graph is built.
*/
/** Description of a render target — what to create, not the GPU objects themselves. */
var REVERSE_DEPTH_COMPARE = "greater-equal";
function resolveDirectRenderTargetSize(descriptor) {
	const size = descriptor.size;
	return "canvas" in size ? size.canvas : size;
}
/** @internal Construct a render target whose size is known not to use a scaled surface descriptor. */
function _createDirectRenderTarget(descriptor) {
	return {
		_descriptor: descriptor,
		_resolveSize: resolveDirectRenderTargetSize,
		_colorTexture: null,
		_colorView: null,
		_depthTexture: null,
		_depthView: null,
		_width: 0,
		_height: 0
	};
}
/** Create a render target descriptor (GPU textures allocated by `buildRenderTarget`). */
function createRenderTarget(descriptor) {
	const rt = _createDirectRenderTarget(descriptor);
	if ("surface" in descriptor.size) {
		_resolveRenderTargetSize(descriptor);
		rt._resolveSize = _resolveRenderTargetSize;
	}
	return rt;
}
/** Allocate GPU textures for the render target. Idempotent for fixed eager targets;
*  surface-sized eager targets may synchronize through `_syncEager`. A
*  color texture is allocated whenever the descriptor has a `format`; depth
*  is allocated whenever it has a `depthStencilFormat`. */
function buildRenderTarget(rt, engine) {
	if (rt._eager) {
		rt._syncEager?.(engine);
		return;
	}
	const desc = rt._descriptor;
	const size = (rt._resolveSize ?? resolveDirectRenderTargetSize)(desc);
	const device = engine._device;
	// `keep`: the target's textures stand while its size, formats and sample count do, where they are made again at
	// every build (every recording of a frame's passes); and the target holds a claim on them, so a material that
	// bound one through a texture facade does not destroy it by letting go of it. Not for a target an eager factory
	// builds, which stands and holds its own claim already.
	const keep = desc.keep === true && !rt._noKeep;
	if (keep && rt._keptDevice === device && rt._width === size.width && rt._height === size.height && textureStands(rt._colorTexture, desc.format, desc.samples) && textureStands(rt._depthTexture, desc.dFormat, desc.samples)) return;
	disposeRenderTarget(rt);
	rt._width = size.width;
	rt._height = size.height;
	if (desc.format) {
		rt._colorTexture = device.createTexture(_createRenderTargetTextureDescriptor(desc, size, desc.format, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING | TU.COPY_SRC | TU.COPY_DST));
		rt._colorView = rt._colorTexture.createView();
	}
	if (desc.dFormat) {
		rt._depthTexture = device.createTexture(_createRenderTargetTextureDescriptor(desc, size, desc.dFormat, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING));
		rt._depthView = rt._depthTexture.createView();
	}
	if (keep) {
		rt._keptDevice = device;
		rt._claimed = true;
		if (rt._colorTexture) acquireGPUTexture(rt._colorTexture);
		if (rt._depthTexture) acquireGPUTexture(rt._depthTexture);
	}
}
/** Whether an attachment is what a descriptor asks for: none where it names no format. */
function textureStands(texture, format, samples) {
	return format ? !!texture && texture.format === format && texture.sampleCount === (samples ?? 1) : !texture;
}
/** @internal Shared attachment allocation descriptor; opt-in factories add their own texture settings. */
function _createRenderTargetTextureDescriptor(descriptor, size, format, usage) {
	return {
		label: descriptor.lbl,
		size,
		format,
		sampleCount: descriptor.samples,
		usage
	};
}
/** Free owned attachments, including sampled eager targets with an explicit owner hook.
*  Eager wrappers without a hook (swapchain, geometry/shadow outputs) remain externally owned. */
function disposeRenderTarget(rt) {
	if (!rt || rt._eager && !rt._disposeAttachments) return;
	const color = rt._colorTexture;
	const depth = rt._depthTexture;
	rt._colorTexture = rt._depthTexture = null;
	rt._colorView = rt._depthView = null;
	rt._width = rt._height = 0;
	if (rt._disposeAttachments) rt._disposeAttachments(color, depth);
	else if (rt._claimed) {
		// A kept target lets go of its claim: a texture another holder still claims lives until that holder lets go.
		rt._claimed = false;
		try {
			if (color) releaseGPUTexture(color);
		} finally {
			if (depth) releaseGPUTexture(depth);
		}
	} else try {
		color?.destroy();
	} finally {
		if (rt._ownsDepthTexture !== false) depth?.destroy();
	}
}
/** @internal Resolve the descriptor's current allocation dimensions. */
function _resolveRenderTargetSize(desc) {
	const size = desc.size;
	if ("surface" in size) {
		const scale = size.scale;
		if (!Number.isFinite(scale) || scale <= 0) ThrowLiteError(66, scale);
		const canvas = size.surface.canvas;
		return {
			width: Math.floor(canvas.width * scale) || 1,
			height: Math.floor(canvas.height * scale) || 1
		};
	}
	return "canvas" in size ? size.canvas : size;
}
export { REVERSE_DEPTH_COMPARE, _createDirectRenderTarget, _createRenderTargetTextureDescriptor, _resolveRenderTargetSize, buildRenderTarget, createRenderTarget, disposeRenderTarget };

//# sourceMappingURL=render-target.js.map