import { F32 } from "../../engine/typed-arrays.js";
import { createEmptyUniformBuffer } from "../../resource/empty-uniform-buffer.js";
import { computeUboLayout } from "../../shader/ubo-layout.js";
// A uniform buffer of the application's own that PBR material plugins read (Day Hike's patch; no upstream source).
/**
* Create a uniform block: one buffer, shared by every material whose plugins name it in
* `getUniformBlocks()`, read in their WGSL as `<name>.<field>`. Fill `data` at the byte
* offsets in `offsets` and send it with `writePluginUniformBlock`: one buffer write however
* many materials and meshes read it. For values that are the same for the whole scene and
* change every frame, which in a material's own uniforms cost a write a material.
*/
function createPluginUniformBlock(engine, name, fields, visibility = "fragment") {
	const spec = computeUboLayout(fields.map((field) => ({
		_name: field.name,
		_type: field.type
	})));
	return {
		name,
		visibility,
		data: new F32(spec._totalBytes / 4),
		offsets: spec._offsets,
		buffer: createEmptyUniformBuffer(engine, spec._totalBytes, `plugin-block-${name}`),
		_structBody: spec._structBody
	};
}
/** Send a uniform block's `data` to its buffer: all of it, or the bytes from `start` up to `end` alone (widened to
*  whole 4-byte words), for a block of which only a part moved. */
function writePluginUniformBlock(engine, block, start, end) {
	const data = block.data;
	if (start === void 0 && end === void 0) {
		engine._device.queue.writeBuffer(block.buffer, 0, data);
		return;
	}
	const from = Math.max(0, start ?? 0) & -4;
	const to = Math.min(data.byteLength, (end ?? data.byteLength) + 3 & -4);
	if (to > from) engine._device.queue.writeBuffer(block.buffer, from, data.buffer, data.byteOffset + from, to - from);
}
export { createPluginUniformBlock, writePluginUniformBlock };
