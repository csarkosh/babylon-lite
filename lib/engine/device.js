import { ThrowLiteError } from "../lite-error.js";
// src/engine/device.ts
var _adapterOptionsHook = null;
/** Explicit feature selection, installed only by `createEngineWithFeatures`; bundles that never install it fold the check away. */
var _deviceFeaturesHook = null;
/** @internal Install adapter options for subsequent device creation (WebXR opt-in). */
function _installAdapterOptions(hook) {
	_adapterOptionsHook = hook;
}
/** @internal Adapter options for creation and pre-creation capability queries. */
function _getAdapterOptions() {
	return _adapterOptionsHook ? _adapterOptionsHook() : {};
}
/** @internal Install explicit `requestDevice` feature selection (used by `createEngineWithFeatures`). */
function _installDeviceFeaturesResolver(resolve) {
	_deviceFeaturesHook = resolve;
}
var OPTIONAL_DEVICE_FEATURES = [
	"float32-filterable",
	"texture-compression-astc",
	"texture-compression-bc",
	"texture-compression-etc2",
	"texture-compression-unaligned",
	"timestamp-query",
	"primitive-index"
];
/** Acquire a GPU device without a canvas or engine, e.g. while the rest of the app downloads.
*  A successful `createEngine` call takes ownership and destroys it on engine disposal.
*  Use `disposeDevice` if no engine takes ownership. */
async function createDevice(options) {
	const adapter = await navigator.gpu.requestAdapter({
		powerPreference: "high-performance",
		..._getAdapterOptions()
	});
	if (!adapter) ThrowLiteError(54);
	const features = OPTIONAL_DEVICE_FEATURES.filter((feature) => adapter.features.has(feature));
	return {
		_device: await adapter.requestDevice({
			requiredFeatures: _deviceFeaturesHook ? _deviceFeaturesHook(adapter, features, options) : features,
			requiredLimits: options?.requiredLimits
		}),
		_options: options
	};
}
export { _getAdapterOptions, _installAdapterOptions, _installDeviceFeaturesResolver, createDevice };

//# sourceMappingURL=device.js.map