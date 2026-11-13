// src/engine/device-dispose.ts
/** Destroy an unclaimed device, including one passed to a failed `createEngine` call.
*  Once an engine owns it, `disposeEngine` destroys it and this function is a no-op.
*  Repeated disposal is harmless. */
function disposeDevice(device) {
	if (!device._claimed) {
		device._claimed = true;
		device._device.destroy();
	}
}
export { disposeDevice };

//# sourceMappingURL=device-dispose.js.map