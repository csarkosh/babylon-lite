import { TU } from "../engine/gpu-flags.js";
import { acquireGPUTexture } from "../resource/gpu-texture-acquire.js";
import { releaseGPUTexture } from "../resource/gpu-texture-release.js";
import { prepareMipmaps, recordPreparedMipmaps } from "../texture/mipmap-preparation.js";
import { mipLevelCount } from "../texture/mip-count.js";
import { _invalidateSceneUboCaches, registerEnvSceneUniforms } from "../scene/scene-ubo-extras.js";
import { i as polynomialToPreScaledHarmonics, n as loadBrdfImage, t as assembleEnvironmentTextures } from "../_chunks/env-helpers-jphSWtsp.js";
// dayhike: an environment the application draws itself (a sky of its own, drawn again as its light changes).
/**
* Create and publish a PBR environment whose cube the application fills, for a scene not yet registered and
* without an environment. The cube is `rgba16float`, linear, `size` texels a face, with a full mip chain unless
* `mipmaps` is false (with `lodGenerationScale: 0` a material reads level 0 whatever its roughness, as Babylon.js
* reads a reflection probe, and the mips are never looked at); draw
* into `faceViews[layer]` (level 0 of each of its six layers) with passes of your own, then call
* `update(polynomial)`: the mips are made from level 0 and the irradiance is replaced by `polynomial`, 27 floats
* in a `.env` file's order (x, y, z, xx, yy, zz, yz, zx, xy; three channels each), or left as it is when none is
* given. Nothing is lit by it until the first `update`.
*/
async function createCustomEnvironment(scene, options) {
	if (scene._z || scene._built || scene._envTextures) throw new Error("createCustomEnvironment: the scene must be unregistered and have no environment");
	const engine = scene.surface.engine;
	const size = options.size ?? 128;
	const image = await loadBrdfImage(options.brdfUrl);
	let brdfLut;
	try {
		const decode = await import("./rgbd-decode.js");
		// dayhike: the decode's pipeline asked for off the main thread, where it was made the synchronous way.
		await decode.prepareRgbdPipeline(engine._device, false);
		brdfLut = decode.decodeBrdfPng(engine, image);
	} finally {
		image.close();
	}
	if (scene._z || scene._built || scene._envTextures) {
		brdfLut.destroy();
		throw new Error("createCustomEnvironment: the scene was registered, disposed or given an environment meanwhile");
	}
	const device = engine._device;
	const texture = device.createTexture({
		size: [size, size, 6],
		mipLevelCount: options.mipmaps === false ? 1 : mipLevelCount(size, size),
		format: "rgba16float",
		usage: TU.TEXTURE_BINDING | TU.RENDER_ATTACHMENT | TU.COPY_DST | TU.COPY_SRC
	});
	const faceViews = [];
	const mipmaps = [];
	for (let face = 0; face < 6; face++) {
		faceViews.push(texture.createView({ dimension: "2d", baseArrayLayer: face, arrayLayerCount: 1, baseMipLevel: 0, mipLevelCount: 1 }));
		mipmaps.push(prepareMipmaps(engine, texture, face));
	}
	const textures = assembleEnvironmentTextures(texture, brdfLut, new Float32Array(27), options.lodGenerationScale ?? .8, engine);
	acquireGPUTexture(texture);
	acquireGPUTexture(brdfLut);
	let disposed = false;
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		if (scene._envTextures === textures) scene._envTextures = void 0;
		releaseGPUTexture(texture);
		releaseGPUTexture(brdfLut);
	};
	scene._disposables.push(dispose);
	scene._envTextures = textures;
	registerEnvSceneUniforms(scene);
	return {
		texture,
		faceViews,
		size,
		textures,
		update(polynomial) {
			if (disposed) return;
			if (texture.mipLevelCount > 1) {
				const encoder = engine._device.createCommandEncoder();
				for (const faceMipmaps of mipmaps) recordPreparedMipmaps(encoder, faceMipmaps);
				engine._device.queue.submit([encoder.finish()]);
			}
			if (polynomial) {
				textures.irradianceSH.set(polynomial);
				textures.sphericalHarmonics.set(polynomialToPreScaledHarmonics(polynomial));
			}
			_invalidateSceneUboCaches(scene);
		},
		dispose
	};
}
export { createCustomEnvironment };
