import { ThrowLiteError } from "../../lite-error.js";
// src/particle/node/npe-registry-extra-basic.ts
/** Optional block table for the Basic Properties extension slice. */
async function loadBasicBlockEvaluator(className) {
	switch (className) {
		case "UpdateDirectionBlock": return (await import("./blocks/update-direction-block.js")).updateDirectionBlock;
		case "UpdateAngleBlock": return (await import("./blocks/update-angle-block.js")).updateAngleBlock;
		default: ThrowLiteError(759, className);
	}
}
export { loadBasicBlockEvaluator };

//# sourceMappingURL=npe-registry-extra-basic.js.map