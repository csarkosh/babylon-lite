import { addBillboardSystemToScene } from "../sprite/billboard-scene.js";
import { createParticleBlend } from "./particle-blend.js";
import { attachParticleMultiplyShader, buildParticleBlendBillboardRenderable } from "./particle-billboard-renderable.js";
// src/particle/particle-billboard-scene.ts
/** Add a facing billboard system using Babylon.js particle Multiply or MultiplyAdd rendering when requested.
*  Either way the system joins the scene's billboard collection (`getSceneBillboardSystems`, `removeBillboardSystemFromScene`),
*  and re-adding it with `addBillboardSystemToScene` keeps its particle passes. */
function addFacingBillboardSystemWithParticleBlend(scene, billboard, blendMode) {
	billboard.blendMode = createParticleBlend(blendMode);
	if (billboard.blendMode._particlePasses) {
		attachParticleMultiplyShader(billboard);
		billboard._sceneBuilder = (engine, buildBase) => buildParticleBlendBillboardRenderable(engine, billboard, buildBase);
	}
	addBillboardSystemToScene(scene, billboard);
}
export { addFacingBillboardSystemWithParticleBlend };

//# sourceMappingURL=particle-billboard-scene.js.map