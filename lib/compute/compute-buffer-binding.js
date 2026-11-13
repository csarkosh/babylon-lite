import { ThrowLiteError } from "../lite-error.js";
// src/compute/compute-buffer-binding.ts
/** @internal Validate and normalize one buffer binding without importing either resource module. */
function _resolveComputeBufferBinding(engine, decl, input, isExpected, isWritable, writable, dynamic, minBindingSize, maxBindingSize, alignment) {
	const range = typeof input === "object" && input !== null && "buffer" in input ? input : { buffer: input };
	const buffer = range.buffer;
	if (!buffer || typeof buffer !== "object" || !isExpected(buffer)) ThrowLiteError(1080, decl.name);
	if (buffer._destroyed || !buffer._buffer) ThrowLiteError(1081, decl.name);
	if (buffer._engine !== engine) ThrowLiteError(1082, decl.name);
	if (writable && !isWritable(buffer)) ThrowLiteError(1083, decl.name);
	const offset = range.offset ?? 0;
	if (!Number.isInteger(offset) || offset < 0 || offset % alignment !== 0) ThrowLiteError(1084, decl.name, alignment);
	let size = range.size;
	if (size === void 0 && dynamic) {
		size = minBindingSize || void 0;
		if (!size) ThrowLiteError(1085, decl.name);
	}
	if (size !== void 0 && (!Number.isInteger(size) || size <= 0 || (size & 3) !== 0)) ThrowLiteError(1086, decl.name);
	const boundSize = size ?? buffer.byteLength - offset;
	if (boundSize <= 0) ThrowLiteError(1087, decl.name);
	if (boundSize < minBindingSize) ThrowLiteError(1088, decl.name, boundSize, minBindingSize);
	if (boundSize > maxBindingSize) ThrowLiteError(1089, decl.name, maxBindingSize);
	if (offset + boundSize > buffer.byteLength) ThrowLiteError(1090, decl.name, buffer.byteLength);
	return {
		_state: {
			_buffer: buffer,
			_offset: offset,
			_size: size
		},
		...dynamic ? { _dynamic: {
			_alignment: alignment,
			_maxOffset: buffer.byteLength - offset - boundSize
		} } : {}
	};
}
/** @internal Resolve the current GPU handle after validating the resource remains registered. */
function _getComputeBufferBindingResource(engine, state, isRegistered) {
	const binding = state;
	const buffer = binding._buffer;
	if (buffer._destroyed || !buffer._buffer || buffer._engine !== engine || !isRegistered(engine, buffer)) ThrowLiteError(1091);
	return {
		buffer: buffer._buffer,
		offset: binding._offset,
		...binding._size !== void 0 ? { size: binding._size } : {}
	};
}
export { _getComputeBufferBindingResource, _resolveComputeBufferBinding };

//# sourceMappingURL=compute-buffer-binding.js.map