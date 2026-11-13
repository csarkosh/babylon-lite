import { ThrowLiteError } from "../lite-error.js";
import { _installDeviceFeaturesResolver } from "../engine/device.js";
import { createEngine } from "../engine/engine.js";
// src/compute/compute-engine-features.ts
var _installed = false;
function installRequiredFeatureResolver() {
	if (_installed) return;
	_installed = true;
	_installDeviceFeaturesResolver((adapter, features, options) => {
		for (const feature of options?.requiredFeatures ?? []) {
			if (!adapter.features.has(feature)) ThrowLiteError(1097, feature);
			if (!features.includes(feature)) features.push(feature);
		}
		return features;
	});
}
/** Create an engine after validating and requesting explicit adapter-supported WebGPU features. */
function createEngineWithFeatures(canvas, options) {
	installRequiredFeatureResolver();
	return createEngine(canvas, options);
}
export { createEngineWithFeatures };

//# sourceMappingURL=compute-engine-features.js.map