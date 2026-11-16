// What a pass of the application's own is drawn with (Day Hike's patch; no upstream source).
/** The engine's GPU device: for the pipelines, bind groups and textures of passes of the application's own. */
function getGpuDevice(engine) {
	return engine._device;
}
/** The command encoder of the frame being drawn, or undefined outside a frame: what a task's `execute` begins passes
*  of its own on, in its place among the frame's tasks. */
function getFrameEncoder(engine) {
	return engine._currentEncoder;
}
/** A render target's attachments as they now stand, into `into` (a new object without one): null before the target
*  is built, and made again when it is (a resize); a surface's own target (`scRT`) holds the canvas's texture of the
*  frame being drawn. Read them when a task is recorded, or in its `execute` for the canvas's. */
function getRenderTargetAttachments(target, into = {}) {
	into.colorTexture = target._colorTexture;
	into.colorView = target._colorView;
	into.depthTexture = target._depthTexture;
	into.depthView = target._depthView;
	into.width = target._width;
	into.height = target._height;
	return into;
}
/** A task of the application's own for a scene's frame graph (`addTask`, `addTaskAtStart`): `record` is called when
*  the frame graph is built (at registration and at every resize), `execute` once a frame in the task's place and
*  returns the draws it made, `dispose` with the scene. */
function createCustomTask(engine, scene, body) {
	return {
		name: body.name,
		engine,
		scene,
		_passes: [],
		record: body.record ?? (() => {}),
		execute: body.execute,
		dispose: body.dispose ?? (() => {})
	};
}
export { createCustomTask, getFrameEncoder, getGpuDevice, getRenderTargetAttachments };
