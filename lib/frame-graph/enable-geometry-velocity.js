import { ThrowLiteError } from "../lite-error.js";
import { installPbrGeometryVelocity } from "../material/pbr/pbr-geometry-velocity-hooks.js";
import { installGeometryDeformationVelocity } from "../material/geometry-deformation-hooks.js";
import { a as geometryVelocityOutput, s as pbr_geometry_velocity_exports } from "../_chunks/pbr-geometry-velocity-C3bLyu7-.js";
import { i as geometry_deformation_velocity_exports } from "../_chunks/geometry-deformation-velocity-QbC_pOFq.js";
// src/frame-graph/enable-geometry-velocity.ts
var enabled = null;
/**
* Enable previous material-point motion for PBR/Standard geometry before scene registration.
* The ordinary geometry path keeps its existing behavior and does not retain this feature.
*/
function enableGeometryVelocity(task, options = {}) {
	const target = task.geometryLinearVelocityTexture;
	if (!target || target._disposed || !task._paramsData) ThrowLiteError(1223);
	const previousDepth = options.previousDepth ?? false;
	if (enabled?.has(task)) {
		if (enabled.get(task) !== previousDepth) ThrowLiteError(1224);
		return;
	}
	if (previousDepth && !["rgba16float", "rgba32float"].includes(target._descriptor.format ?? "")) ThrowLiteError(1225);
	if (task.scene?._built) ThrowLiteError(1226);
	task._paramsData[18] = previousDepth ? 1 : 0;
	const previousValidation = task._validateCamera;
	if (previousDepth) task._validateCamera = (camera) => {
		previousValidation?.(camera);
		if (camera.ortho) ThrowLiteError(1227);
	};
	installPbrGeometryVelocity(pbr_geometry_velocity_exports);
	installGeometryDeformationVelocity(geometry_deformation_velocity_exports, geometryVelocityOutput);
	const preload = task._preload;
	task._preload = async () => {
		await preload();
		const create = task._createPbrGeometryView;
		if (create) task._createPbrGeometryView = (source, config) => {
			const view = create(source, config);
			view._geometryVelocity = true;
			view._velocityExclusions = config.velocityExclusions;
			return view;
		};
	};
	(enabled ??= /* @__PURE__ */ new WeakMap()).set(task, previousDepth);
}
export { enableGeometryVelocity };

//# sourceMappingURL=enable-geometry-velocity.js.map