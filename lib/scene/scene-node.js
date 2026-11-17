import { allocateMat4 } from "../math/_matrix-allocator.js";
import { attachWorldMatrixState, composeTrsLocalMatrixIntoBuffer, createWorldMatrixState, peekWorldMatrixState } from "./world-matrix-state.js";
import { ObservableVec3 } from "../math/observable-vec3.js";
import { ObservableQuat } from "../math/observable-quat.js";
import { eulerXYZToQuatTuple, quatToEulerXYZTuple } from "../math/quat-euler.js";
// src/scene/scene-node.ts
/** Create a live bidirectional EulerProxy backed by the given ObservableQuat.
*
*  Euler⇄quaternion is many-to-one and `quatToEulerXYZTuple` is unstable at gimbal lock
*  (e.g. yaw near ±π/2), so re-deriving Euler from the quaternion on every read makes
*  per-axis updates (`node.rotation.x = …; node.rotation.y = …`) lossy and can flip the
*  node. To stay stable, the proxy caches the Euler triple it last applied and reuses it
*  while the quaternion is unchanged; it only re-derives from the quaternion when the
*  quaternion was written externally (detected via its version counter). */
function createEulerProxy(rq) {
	let ex = 0;
	let ey = 0;
	let ez = 0;
	let syncedVersion = -1;
	const sync = () => {
		if (rq.version !== syncedVersion) {
			const e = quatToEulerXYZTuple(rq.x, rq.y, rq.z, rq.w);
			ex = e[0];
			ey = e[1];
			ez = e[2];
			syncedVersion = rq.version;
		}
	};
	const apply = (x, y, z) => {
		ex = x;
		ey = y;
		ez = z;
		const [a, b, c, d] = eulerXYZToQuatTuple(x, y, z);
		rq.set(a, b, c, d);
		syncedVersion = rq.version;
	};
	return {
		get x() {
			sync();
			return ex;
		},
		set x(v) {
			sync();
			apply(v, ey, ez);
		},
		get y() {
			sync();
			return ey;
		},
		set y(v) {
			sync();
			apply(ex, v, ez);
		},
		get z() {
			sync();
			return ez;
		},
		set z(v) {
			sync();
			apply(ex, ey, v);
		},
		set: apply
	};
}
/** Create a SceneNode with given TRS (position and scaling in cartesian, rotation as quaternion).
*  Omitted values default to the identity transform (applied once, in `initSceneNodeTransform`). */
function createSceneNode(name, px, py, pz, qx, qy, qz, qw, sx, sy, sz) {
	return createSceneNodeCore(name, null, px, py, pz, qx, qy, qz, qw, sx, sy, sz);
}
function createSceneNodeFromMatrix(name, matrix, translation, rotation, scale) {
	const node = createSceneNodeCore(name, matrix, translation?.x, translation?.y, translation?.z, rotation?.x, rotation?.y, rotation?.z, rotation?.w, scale?.x, scale?.y, scale?.z);
	node._localMatrixLocked = translation ? void 0 : true;
	return node;
}
function createSceneNodeCore(name, matrix, px, py, pz, qx, qy, qz, qw, sx, sy, sz) {
	const node = initSceneNodeTransform({
		name,
		children: []
	}, px, py, pz, qx, qy, qz, qw, sx, sy, sz);
	if (matrix) node._localMatrix = matrix;
	return node;
}
/** Add the common SceneNode transform contract to an existing object. */
function initSceneNodeTransform(partialNode, px = 0, py = 0, pz = 0, qx = 0, qy = 0, qz = 0, qw = 1, sx = 1, sy = 1, sz = 1) {
	let localMatrix;
	const wm = createWorldMatrixState(() => {
		if (node._localMatrix) return node._localMatrix;
		localMatrix ??= allocateMat4();
		composeTrsLocalMatrixIntoBuffer(localMatrix, position, rq, scaling);
		return localMatrix;
	});
	const onWmDirty = () => {
		if (node._localMatrixLocked) return;
		node._localMatrix = void 0;
		wm.markLocalDirty();
	};
	const position = new ObservableVec3(px, py, pz, onWmDirty);
	const rq = new ObservableQuat(qx, qy, qz, qw, onWmDirty);
	const rotation = createEulerProxy(rq);
	const scaling = new ObservableVec3(sx, sy, sz, onWmDirty);
	const node = {
		...partialNode,
		position,
		rotationQuaternion: rq,
		rotation,
		scaling
	};
	Object.defineProperties(node, nodeAccessors);
	attachWorldMatrixState(node, wm);
	return node;
}
/** A node's `parent`, `worldMatrix` and `worldMatrixVersion`: one set of accessors for every node, each reading the
*  node's own world-matrix state. Written in the node's literal they were closures made a node, and the engine that
*  runs the page keeps a literal's first accessors with the shape every later node shares: the first node a page
*  made, and everything it reached (its children, their buffers, their device), could never be let go. The
*  properties are the node's own, enumerable and configurable, in the same places as before. */
var nodeAccessors = {
	parent: {
		get() {
			return peekWorldMatrixState(this).parent;
		},
		set(v) {
			peekWorldMatrixState(this).parent = v;
		},
		enumerable: true,
		configurable: true
	},
	worldMatrix: {
		get() {
			return peekWorldMatrixState(this).getWorldMatrix();
		},
		enumerable: true,
		configurable: true
	},
	worldMatrixVersion: {
		get() {
			return peekWorldMatrixState(this).getWorldMatrixVersion();
		},
		enumerable: true,
		configurable: true
	}
};
export { createEulerProxy, createSceneNode, createSceneNodeFromMatrix, initSceneNodeTransform };

//# sourceMappingURL=scene-node.js.map