// dayhike: a light's fields changed in place reach the lights buffer when its version moves.
/** Say that a light's fields were changed in place (its specular colour, a hemispheric light's colours, any
*  field without a setter of its own), so the scene's lights buffer is written again. */
function markLightDirty(light) {
	light._bumpLightVersion?.();
}
export { markLightDirty };
