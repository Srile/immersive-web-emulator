import {
	BoxGeometry,
	Color,
	DirectionalLight,
	DoubleSide,
	LineBasicMaterial,
	LineSegments,
	Mesh,
	MeshBasicMaterial,
	Object3D,
	PerspectiveCamera,
	Raycaster,
	Scene,
	Vector3,
	WebGLRenderer,
} from 'three';
import { XRPlane, XRPlaneOrientation } from './api/XRPlane';

import { BoxLineGeometry } from 'three/examples/jsm/geometries/BoxLineGeometry';
import XRSpace from 'webxr-polyfill/src/api/XRSpace';
import { mat4 } from 'gl-matrix';

const DEFAULT_CAMERA_POSITION = [0, 1.6, 0];
const PLANE_CONFIG = {
	FLOOR: {
		orientation: XRPlaneOrientation.Horizontal,
		quaternion: [0, 0, 0, 1],
	},
	CEILING: {
		orientation: XRPlaneOrientation.Horizontal,
		quaternion: [0, 0, 1, 0],
	},
	RIGHT: {
		orientation: XRPlaneOrientation.Vertical,
		quaternion: [0, 0, 0.7071068, 0.7071068],
	},
	LEFT: {
		orientation: XRPlaneOrientation.Vertical,
		quaternion: [0, 0, -0.7071068, 0.7071068],
	},
	FRONT: {
		orientation: XRPlaneOrientation.Vertical,
		quaternion: [0.7071068, 0, 0, 0.7071068],
	},
	BACK: {
		orientation: XRPlaneOrientation.Vertical,
		quaternion: [-0.7071068, 0, 0, 0.7071068],
	},
};
const DEFAULT_ROOM_DIMENSION = {
	x: 6,
	y: 3,
	z: 6,
};

const buildXRPlane = (width, length, position, planeConfig) => {
	const planeMatrix = new Float32Array(16);
	mat4.fromRotationTranslation(planeMatrix, planeConfig.quaternion, position);
	const planeSpace = new XRSpace();
	planeSpace._baseMatrix = planeMatrix;
	const points = [
		new DOMPointReadOnly(width, 0, length),
		new DOMPointReadOnly(width, 0, -length),
		new DOMPointReadOnly(-width, 0, -length),
		new DOMPointReadOnly(-width, 0, length),
		new DOMPointReadOnly(width, 0, length),
	];
	return new XRPlane(planeSpace, points, planeConfig.orientation);
};

class XRRoomFactory {
	constructor(scene) {
		this.scene = scene;
		this.roomObject = null;
		this.roomCollider = null;
		this.xrPlanes = [];
	}

	createRoom(x, y, z) {
		if (this.roomObject) this.scene.remove(this.roomObject);
		if (this.roomCollider) this.scene.remove(this.roomCollider);
		this.roomObject = new LineSegments(
			new BoxLineGeometry(
				x,
				y,
				z,
				Math.ceil(x * 2),
				Math.ceil(y * 2),
				Math.ceil(z * 2),
			),
			new LineBasicMaterial({ color: 0x808080 }),
		);
		this.roomObject.geometry.translate(0, y / 2, 0);
		this.scene.add(this.roomObject);
		this.xrPlanes = [
			buildXRPlane(x / 2, z / 2, [0, 0, 0], PLANE_CONFIG.FLOOR),
			buildXRPlane(x / 2, z / 2, [0, y, 0], PLANE_CONFIG.CEILING),
			buildXRPlane(y / 2, z / 2, [x / 2, y / 2, 0], PLANE_CONFIG.RIGHT),
			buildXRPlane(y / 2, z / 2, [-x / 2, y / 2, 0], PLANE_CONFIG.LEFT),
			buildXRPlane(x / 2, y / 2, [0, y / 2, z / 2], PLANE_CONFIG.BACK),
			buildXRPlane(x / 2, y / 2, [0, y / 2, -z / 2], PLANE_CONFIG.FRONT),
		];
		this.roomCollider = new Mesh(
			new BoxGeometry(x, y, z),
			new MeshBasicMaterial({
				side: DoubleSide,
			}),
		);
		this.roomCollider.visible = false;
		this.roomCollider.position.y = y / 2;
		this.scene.add(this.roomCollider);
	}
}

export default class XRScene {
	constructor() {
		this.renderer = null;
		this.camera = null;

		this.onCameraPoseUpdate = null;
		this.hitTestTarget = null;

		this._init();
	}

	_init() {
		const width = window.innerWidth;
		const height = window.innerHeight;

		const canvas = document.createElement('canvas');
		const context = canvas.getContext('webgl2', { antialias: true });
		context.globalCompositeOperation = 'destination-over';

		const renderer = new WebGLRenderer({ canvas: canvas, context: context });
		renderer.setSize(width, height);
		canvas.width = width;
		canvas.height = height;
		renderer.domElement.oncontextmenu = () => {
			return false;
		};

		const scene = new Scene();
		scene.background = new Color(0x444444);

		this.roomFactory = new XRRoomFactory(scene);
		this.roomFactory.createRoom(
			DEFAULT_ROOM_DIMENSION.x,
			DEFAULT_ROOM_DIMENSION.y,
			DEFAULT_ROOM_DIMENSION.z,
		);

		const camera = new PerspectiveCamera(90, width / height, 0.001, 1000.0);
		camera.position.fromArray(DEFAULT_CAMERA_POSITION);

		const light = new DirectionalLight(0xffffff, 4.0);
		light.position.set(-1, 1, -1);
		scene.add(light);

		// @TODO: only animate when headset pose change
		const animate = () => {
			requestAnimationFrame(animate);
			renderer.render(scene, camera);
			const canvas = renderer.domElement;
			var destCtx = canvas.getContext('2d');

			if (this.canvas) {
				destCtx.drawImage(this.appCanvas, 0, 0);
			}
		};

		animate();

		window.addEventListener(
			'resize',
			(_event) => {
				const width = window.innerWidth;
				const height = window.innerHeight;
				renderer.setSize(width, height);
				camera.aspect = width / height;
				camera.updateProjectionMatrix();
			},
			false,
		);

		this.renderer = renderer;
		this.scene = scene;
		this.camera = camera;
		this.raycaster = new Raycaster();
		this.hitTestTarget = new Object3D();
		this.hitTestMarker = new Object3D();
		this.hitTestMarker.rotateX(Math.PI / 2);
		this.hitTestTarget.add(this.hitTestMarker);
	}

	inject(canvasContainer) {
		const appendCanvas = () => {
			canvasContainer.appendChild(this.renderer.domElement);
		};

		if (document.body) {
			appendCanvas();
		} else {
			document.addEventListener('DOMContentLoaded', appendCanvas);
		}
	}

	eject() {
		const element = this.renderer.domElement;
		element.parentElement.removeChild(element);
	}

	setCanvas(canvas) {
		this.appCanvas = canvas;
	}

	updateCameraTransform(positionArray, quaternionArray) {
		this.camera.position.fromArray(positionArray);
		this.camera.quaternion.fromArray(quaternionArray);
	}

	createRoom(dimension) {
		this.roomFactory.createRoom(dimension.x, dimension.y, dimension.z);
	}

	getHitTestResults(origin, direction) {
		this.raycaster.set(
			new Vector3().fromArray(origin),
			new Vector3().fromArray(direction),
		);
		const targets = [];
		if (this.roomFactory.roomCollider) {
			targets.push(this.roomFactory.roomCollider);
		}
		const intersects = this.raycaster.intersectObjects(targets, true);

		const results = [];
		intersects.forEach((intersect) => {
			this.hitTestTarget.position.copy(intersect.point);
			this.hitTestTarget.lookAt(
				new Vector3().addVectors(intersect.point, intersect.face.normal),
			);
			this.hitTestTarget.updateWorldMatrix(false, true);

			results.push(
				mat4.fromValues(...this.hitTestMarker.matrixWorld.toArray()),
			);
		});
		return results;
	}

	get xrPlanes() {
		return this.roomFactory.xrPlanes;
	}
}
