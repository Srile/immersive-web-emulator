import { XRAnchor, XRAnchorSet } from './api/XRAnchor';
import XRFrame, {
	PRIVATE as XRFRAME_PRIVATE,
} from 'webxr-polyfill/src/api/XRFrame';
import XRSession, {
	PRIVATE as XRSESSION_PRIVATE,
} from 'webxr-polyfill/src/api/XRSession';

import API from 'webxr-polyfill/src/api/index';
import EX_API from './api/index';
import EmulatedXRDevice from './EmulatedXRDevice';
import { POLYFILL_ACTIONS } from '../src/devtool/js/actions';
import WebXRPolyfill from 'webxr-polyfill/src/WebXRPolyfill';
import XRHitTestResult from './api/XRHitTestResult';
import XRHitTestSource from './api/XRHitTestSource';
import { XRPlaneSet } from './api/XRPlane';
import XRReferenceSpace from 'webxr-polyfill/src/api/XRReferenceSpace';
import XRRigidTransform from 'webxr-polyfill/src/api/XRRigidTransform';
import XRSpace from 'webxr-polyfill/src/api/XRSpace';
import XRSystem from 'webxr-polyfill/src/api/XRSystem';
import XRTransientInputHitTestResult from './api/XRTransientInputHitTestResult';
import XRTransientInputHitTestSource from './api/XRTransientInputHitTestSource';
import { XR_COMPATIBLE } from 'webxr-polyfill/src/constants';
import { mat4 } from 'gl-matrix';

export default class CustomWebXRPolyfill extends WebXRPolyfill {
	constructor() {
		super();

		// Note: Experimental.
		//       Override some XR APIs to track active immersive session to
		//       enable to exit immersive by the extension.
		//       Exiting without user gesture in the page might violate security policy
		//       so there might be a chance that we remove this feature at some point.

		let activeImmersiveSession = null;
		const originalRequestSession = XRSystem.prototype.requestSession;
		XRSystem.prototype.requestSession = function (mode, enabledFeatures = {}) {
			return originalRequestSession
				.call(this, mode, enabledFeatures)
				.then((session) => {
					if (mode === 'immersive-vr' || mode === 'immersive-ar') {
						activeImmersiveSession = session;

						// DOM-Overlay API
						const optionalFeatures = enabledFeatures.optionalFeatures;
						const domOverlay = enabledFeatures.domOverlay;
						if (
							optionalFeatures &&
							optionalFeatures.includes('dom-overlay') &&
							domOverlay &&
							domOverlay.root
						) {
							const device = session[XRSESSION_PRIVATE].device;
							device.setDomOverlayRoot(domOverlay.root);
							session.domOverlayState = { type: 'screen' };
						}
					}
					return session;
				});
		};

		const originalEnd = XRSession.prototype.end;
		XRSession.prototype.end = function () {
			return originalEnd.call(this).then(() => {
				if (activeImmersiveSession === this) {
					activeImmersiveSession = null;
				}
			});
		};

		// add event listener for onreset event, but do nothing since we cannot re-center in emulator
		XRReferenceSpace.prototype.addEventListener = () => {};

		window.addEventListener(POLYFILL_ACTIONS.EXIT_IMMERSIVE, (_event) => {
			if (activeImmersiveSession && !activeImmersiveSession.ended) {
				activeImmersiveSession.end().then(() => {
					activeImmersiveSession = null;
				});
			}
		});

		XRSession.prototype.addTrackedAnchor = function (anchor) {
			if (this.trackedAnchors == null) this.trackedAnchors = new Set();
			this.trackedAnchors.add(anchor);
		};

		XRSession.prototype.getTrackedAnchors = function () {
			return this.trackedAnchors;
		};

		XRSession.prototype.hasTrackedAnchor = function (anchor) {
			return this.trackedAnchors.has(anchor);
		};

		XRSession.prototype.deleteTrackedAnchor = function (anchor) {
			if (this.trackedAnchors != null) {
				this.trackedAnchors.delete(anchor);
			}
		};

		XRSession.prototype.updateTargetFrameRate = function (frameRate) {
			console.log('now targeting', frameRate, 'fps');
		};

		/**
		 * @param {import('webxr-polyfill/src/api/XRRigidTransform').default} pose
		 * @param {import('webxr-polyfill/src/api/XRSpace').default} space
		 * @see https://immersive-web.github.io/anchors/#dom-xrframe-createanchor
		 */
		XRFrame.prototype.createAnchor = async function (pose, space) {
			const session = this[XRFRAME_PRIVATE].session;
			const localRefSpace = await session.requestReferenceSpace('local');

			const device = this[XRFRAME_PRIVATE].device;
			let currentSpaceTransform = null;
			if (
				space._specialType === 'target-ray' ||
				space._specialType === 'grip'
			) {
				currentSpaceTransform = device.getInputPose(
					space._inputSource,
					localRefSpace,
					space._specialType,
				).transform;
			} else {
				space._ensurePoseUpdated(device, this[XRFRAME_PRIVATE].id);
				localRefSpace._ensurePoseUpdated(device, this[XRFRAME_PRIVATE].id);
				currentSpaceTransform = localRefSpace._getSpaceRelativeTransform(space);
			}
			if (!currentSpaceTransform) throw 'error creating anchor';

			const currentSpaceBaseSpaceMatrix = new Float32Array(16);
			mat4.multiply(
				currentSpaceBaseSpaceMatrix,
				localRefSpace._baseMatrix,
				currentSpaceTransform.matrix,
			);
			const anchorSpaceBaseSpaceMatrix = new Float32Array(16);
			mat4.multiply(
				anchorSpaceBaseSpaceMatrix,
				currentSpaceBaseSpaceMatrix,
				pose.matrix,
			);
			const anchorSpace = new XRSpace();
			anchorSpace._baseMatrix = anchorSpaceBaseSpaceMatrix;
			const anchor = new XRAnchor(session, anchorSpace);
			session.addTrackedAnchor(anchor);
			return anchor;
		};

		Object.defineProperty(XRFrame.prototype, 'trackedAnchors', {
			get: function () {
				const session = this[XRFRAME_PRIVATE].session;
				return new XRAnchorSet(session.getTrackedAnchors());
			},
		});

		Object.defineProperty(XRFrame.prototype, 'detectedPlanes', {
			get: function () {
				const device = this[XRFRAME_PRIVATE].device;
				return new XRPlaneSet(device.xrScene.xrPlanes);
			},
		});

		// Extending XRSession and XRFrame for AR hitting test API.

		XRSession.prototype.requestHitTestSource = function (options) {
			const source = new XRHitTestSource(this, options);
			const device = this[XRSESSION_PRIVATE].device;
			device.addHitTestSource(source);
			return Promise.resolve(source);
		};

		XRSession.prototype.requestHitTestSourceForTransientInput = function (
			options,
		) {
			const source = new XRTransientInputHitTestSource(this, options);
			const device = this[XRSESSION_PRIVATE].device;
			device.addHitTestSourceForTransientInput(source);
			return Promise.resolve(source);
		};

		XRFrame.prototype.getHitTestResults = function (hitTestSource) {
			const device = this.session[XRSESSION_PRIVATE].device;
			const hitTestResults = device.getHitTestResults(hitTestSource);
			const results = [];
			for (const matrix of hitTestResults) {
				results.push(new XRHitTestResult(this, new XRRigidTransform(matrix)));
			}
			return results;
		};

		XRFrame.prototype.getHitTestResultsForTransientInput = function (
			hitTestSource,
		) {
			const device = this.session[XRSESSION_PRIVATE].device;
			const hitTestResults =
				device.getHitTestResultsForTransientInput(hitTestSource);
			if (hitTestResults.length === 0) {
				return [];
			}
			const results = [];
			for (const matrix of hitTestResults) {
				results.push(new XRHitTestResult(this, new XRRigidTransform(matrix)));
			}
			const inputSource = device.getInputSources()[0];
			return [new XRTransientInputHitTestResult(this, results, inputSource)];
		};

		//

		if (this.nativeWebXR) {
			// Note: Even if native WebXR API is available the extension overrides
			//       it with WebXR polyfill because the extension doesn't work with
			//       the native one (yet).
			overrideAPI(this.global);
			this.injected = true;
			this._patchNavigatorXR();
		} else {
			installEX_API(this.global);
			// Note: WebXR API polyfill can be overridden by native WebXR API on the latest Chrome 78
			//       after the extension is loaded but before loading page is completed
			//       if the native WebXR API is disabled via chrome://flags and the page includes
			//       WebXR origin trial.
			//       Here is a workaround. Check if XR class is native code when node is appended or
			//       the page is loaded. If it detects, override WebXR API with the polyfill.
			// @TODO: Remove this workaround if the major browser officially support native WebXR API
			let overridden = false;
			const overrideIfNeeded = () => {
				if (overridden) {
					return false;
				}
				if (isNativeFunction(this.global.XRSystem)) {
					overrideAPI(this.global);
					overridden = true;
					return true;
				}
				return false;
			};
			const observer = new MutationObserver((list) => {
				for (const record of list) {
					for (const node of record.addedNodes) {
						if (node.localName === 'script' && overrideIfNeeded()) {
							observer.disconnect();
							break;
						}
					}
					if (overridden) {
						break;
					}
				}
			});
			observer.observe(document, { subtree: true, childList: true });
			const onLoad = (_event) => {
				if (!overridden) {
					observer.disconnect();
					overrideIfNeeded();
				}
				document.removeEventListener('DOMContentLoaded', onLoad);
			};
			document.addEventListener('DOMContentLoaded', onLoad);
		}
	}

	_patchNavigatorXR() {
		const devicePromise = requestXRDevice(this.global);
		this.xr = new XRSystem(devicePromise);
		Object.defineProperty(this.global.navigator, 'xr', {
			value: this.xr,
			configurable: true,
		});
	}
}

const requestXRDevice = async (global, _config) => {
	// resolve when receiving configuration parameters from content-script as an event
	return new Promise((resolve, _reject) => {
		const callback = (event) => {
			window.removeEventListener(POLYFILL_ACTIONS.DEVICE_INIT, callback);
			resolve(
				new EmulatedXRDevice(
					global,
					Object.assign({}, event.detail.deviceDefinition, {
						stereoEffect: event.detail.stereoEffect,
					}),
				),
			);
		};
		window.addEventListener(POLYFILL_ACTIONS.DEVICE_INIT, callback, false);
	});
};

// Easy native function detection.
const isNativeFunction = (func) => {
	return /\[native code\]/i.test(func.toString());
};

const overrideAPI = (global) => {
	console.log(
		'[Immersive Web Emulator] native WebXR API successfully overridden',
	);
	for (const className in API) {
		global[className] = API[className];
	}
	installEX_API(global);

	// Since (desktop) Chrome 88 WebGL(2)RenderingContext.makeXRCompatible() seems
	// to start to reject if no immersive XR device is plugged in.
	// So we need to override them, too. Otherwise JS engines/apps including
	// "await context.makeXRCompatible();" won't work with the extension.
	// See https://github.com/MozillaReality/WebXR-emulator-extension/issues/266
	if (typeof WebGLRenderingContext !== 'undefined') {
		overrideMakeXRCompatible(WebGLRenderingContext);
	}
	if (typeof WebGL2RenderingContext !== 'undefined') {
		overrideMakeXRCompatible(WebGL2RenderingContext);
	}
};

const installEX_API = (global) => {
	for (const className in EX_API) {
		global[className] = EX_API[className];
	}
};

const overrideMakeXRCompatible = (Context) => {
	Context.prototype.makeXRCompatible = function () {
		this[XR_COMPATIBLE] = true;
		// This is all fake, so just resolve immediately.
		return Promise.resolve();
	};
};
