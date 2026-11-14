import { ThrowLiteError } from "../../lite-error.js";
import { enabledPlugins, pluginSignature } from "./plugin-bridge-shared.js";
// src/material/plugin/pbr-plugin-vertex-data.ts
var STAGE_VERTEX = 1;
var STAGE_FRAGMENT = 2;
var FRAG_POINT_TO_SLOT = {
	CUSTOM_FRAGMENT_MAIN_BEGIN: "SV",
	CUSTOM_FRAGMENT_UPDATE_ALPHA: "AT",
	CUSTOM_FRAGMENT_UPDATE_DIFFUSE: "AC",
	CUSTOM_FRAGMENT_BEFORE_LIGHTS: "MF",
	CUSTOM_FRAGMENT_LIGHT: "LD",
	CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: "NI",
	CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: "BC"
};
var VERT_POINT_TO_SLOT = {
	CUSTOM_VERTEX_MAIN_BEGIN: "VR",
	CUSTOM_VERTEX_UPDATE_WORLDPOS: "VW",
	CUSTOM_VERTEX_MAIN_END: "VB"
};
/** @internal Stable signature including vertex-stage declarations. */
function pbrVertexPluginSignature(plugins) {
	const parts = [pluginSignature(plugins)];
	for (const plugin of plugins) if (plugin.isEnabled !== false) parts.push(JSON.stringify(plugin.getVaryings?.() ?? null), JSON.stringify(plugin.getInstanceAttributes?.() ?? null), JSON.stringify(plugin.getVertexAttributes?.() ?? null));
	return parts.join("|");
}
/** @internal Build a PBR plugin fragment with custom vertex-stage resources. */
function buildPbrVertexPluginFragment(plugins, index) {
	const enabled = enabledPlugins(plugins);
	if (enabled.length === 0) return { _id: `plugin-${index}` };
	let helpers = ``;
	let vertexHelpers = ``;
	const fragmentSlots = {};
	const vertexSlots = {};
	const uboFields = [];
	const varyings = [];
	const bindings = [];
	const instanceAttributes = [];
	const vertexAttributes = [];
	let materialUboVertexVisible = false;
	const append = (bucket, key, code) => {
		bucket[key] = `${bucket[key] ?? ""} ${code}`;
	};
	for (const plugin of enabled) {
		const fragmentCode = plugin.getCustomCode?.("fragment");
		if (fragmentCode) for (const point of Object.keys(fragmentCode)) {
			const code = fragmentCode[point];
			if (!code) continue;
			if (point === "CUSTOM_FRAGMENT_DEFINITIONS") {
				helpers = `${helpers} ${code}`;
				continue;
			}
			const slot = FRAG_POINT_TO_SLOT[point];
			if (slot) append(fragmentSlots, slot, code);
		}
		const vertexCode = plugin.getCustomCode?.("vertex");
		if (vertexCode) for (const point of Object.keys(vertexCode)) {
			const code = vertexCode[point];
			if (code && point === "CUSTOM_VERTEX_DEFINITIONS") {
				vertexHelpers = `${vertexHelpers} ${code}`;
				continue;
			}
			const slot = VERT_POINT_TO_SLOT[point];
			if (code && slot) append(vertexSlots, slot, code);
		}
		for (const field of plugin.getUniforms?.()?.ubo ?? []) {
			uboFields.push({
				_name: field.name,
				_type: field.type
			});
			materialUboVertexVisible ||= field.visibility === "vertex" || field.visibility === "vertex-fragment";
		}
		for (const attribute of plugin.getVertexAttributes?.() ?? []) vertexAttributes.push({
			_name: attribute.name,
			_type: attribute.type,
			_gpuFormat: attribute.format,
			_arrayStride: attribute.stride,
			_stepMode: "vertex",
			_bufferGroup: "plugin-vertex",
			_offset: attribute.offset
		});
		for (const attribute of plugin.getInstanceAttributes?.() ?? []) instanceAttributes.push({
			_name: attribute.name,
			_type: attribute.type,
			_gpuFormat: attribute.format,
			_arrayStride: attribute.stride,
			_stepMode: "instance",
			_bufferGroup: "ti-plugin",
			_offset: attribute.offset
		});
		for (const varying of plugin.getVaryings?.() ?? []) {
			assertFloatVaryingType(varying.type);
			varyings.push({
				_name: varying.name,
				_type: varying.type
			});
		}
		for (const sampler of plugin.getSamplers?.() ?? []) {
			const visibility = sampler.visibility === "vertex" ? STAGE_VERTEX : sampler.visibility === "vertex-fragment" ? 3 : STAGE_FRAGMENT;
			bindings.push({
				_name: sampler.texture,
				_type: {
					_kind: "texture",
					_textureType: sampler.depthTexture ? "texture_depth_2d" : sampler.textureType ?? "texture_2d<f32>",
					_sampleType: sampler.sampleType
				},
				_visibility: visibility
			});
			if (sampler.sampler) bindings.push({
				_name: sampler.sampler,
				_type: {
					_kind: "sampler",
					_samplerType: sampler.samplerType ?? "sampler"
				},
				_visibility: visibility
			});
		}
	}
	return {
		_id: `plugin-${index}`,
		_helperFunctions: helpers || void 0,
		_vertexHelperFunctions: vertexHelpers || void 0,
		_fragmentSlots: Object.keys(fragmentSlots).length ? fragmentSlots : void 0,
		_vertexSlots: Object.keys(vertexSlots).length ? vertexSlots : void 0,
		_varyings: varyings.length ? varyings : void 0,
		_vertexAttributes: vertexAttributes.length || instanceAttributes.length ? [...vertexAttributes, ...instanceAttributes] : void 0,
		_uboFields: uboFields.length ? uboFields : void 0,
		_bindings: bindings.length ? bindings : void 0,
		_pc: materialUboVertexVisible ? exposeMaterialUboToVertex : void 0
	};
}
function exposeMaterialUboToVertex(composed) {
	const spec = composed._materialUboSpec;
	if (!spec) ThrowLiteError(535);
	const declaration = `struct MaterialUniforms{${spec._structBody}}@group(1)@binding(1)var<uniform>material:MaterialUniforms;`;
	const entries = composed._meshBGLDescriptor.entries.map((entry) => entry.binding === 1 ? {
		...entry,
		visibility: entry.visibility | STAGE_VERTEX
	} : entry);
	return {
		...composed,
		_vertexWGSL: `${declaration}${composed._vertexWGSL}`,
		_meshBGLDescriptor: {
			...composed._meshBGLDescriptor,
			entries
		}
	};
}
function assertFloatVaryingType(type) {
	if (type !== "f32" && type !== "vec2f" && type !== "vec3f" && type !== "vec4f" && type !== "vec2<f32>" && type !== "vec3<f32>" && type !== "vec4<f32>") ThrowLiteError(536, type);
}
export { buildPbrVertexPluginFragment, pbrVertexPluginSignature };

//# sourceMappingURL=pbr-plugin-vertex-data.js.map