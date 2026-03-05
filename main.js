import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { initZoomSlider } from './slider.js';
import { createPerspCameraMover, createOrthoCameraMover } from './cammove.js';
import { initSidePanels } from './uipanels.js';
import { initDataFilesUI } from './datafiles.js';
import { parseDesignText, serializeDesignText } from './parser.js';
import { applyDesignToScene, updateDesignStyleInScene } from './scene.js';
import { Node, Net, Group, NodeType, Tristate } from './path.js';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

/* Section. */
const DEFAULT_SCENE_ID = "default";
let sceneSeq = 0;

const scenes = new Map();
let activeSceneId = DEFAULT_SCENE_ID;
let activeScene = null;

/* 2. Camera Setup */
const maincamera = new THREE.PerspectiveCamera(
	60,
	window.innerWidth / window.innerHeight,
	0.1,
	1000
);
maincamera.position.set(2, 2, 2);

const aspect = window.innerWidth / window.innerHeight;
const frustumSize = 4;
const topviewcamera = new THREE.OrthographicCamera(
	-(frustumSize * aspect) / 2,
	(frustumSize * aspect) / 2,
	frustumSize / 2,
	-frustumSize / 2,
	0.1,
	100000
);
topviewcamera.position.set(2, 2, 2);

let camera = maincamera;

/* 3. Renderer Setup */
const LEGACY_PIXEL_RATIO_CAP = 2.0;
const RENDER_PIXEL_RATIO_CAP = 1.25; // Cap pixel ratio to keep camera motion smooth.
const FPS_BOOST_RATIO_EST = (LEGACY_PIXEL_RATIO_CAP / RENDER_PIXEL_RATIO_CAP) ** 2;
const CAMERA_SPEED_COMPENSATION = 1 / FPS_BOOST_RATIO_EST;
const TOPVIEW_MOVE_SPEED_MULTIPLIER = 1.5;

const renderer = new THREE.WebGLRenderer({
	antialias : true,
	depth : true,
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER_PIXEL_RATIO_CAP));
document.body.appendChild(renderer.domElement);
const TOPVIEW_RULER_BREADTH_PX = 44;
const TOPVIEW_RULER_MINOR_MIN_PX = 18;
const TOPVIEW_RULER_MAJOR_MIN_PX = 78;
const topViewRulerOverlayEl = document.createElement("div");
topViewRulerOverlayEl.className = "topview-ruler-overlay";
topViewRulerOverlayEl.hidden = true;
topViewRulerOverlayEl.innerHTML = [
	'<div class = "topview-ruler-corner" aria-hidden = "true"></div>',
	'<div class = "topview-ruler-track top" aria-hidden = "true"></div>',
	'<div class = "topview-ruler-track left" aria-hidden = "true"></div>',
].join("");
document.body.appendChild(topViewRulerOverlayEl);
const topViewRulerCornerEl = topViewRulerOverlayEl.querySelector(".topview-ruler-corner");
const topViewRulerTopEl = topViewRulerOverlayEl.querySelector(".topview-ruler-track.top");
const topViewRulerLeftEl = topViewRulerOverlayEl.querySelector(".topview-ruler-track.left");
const topViewRulerState = { key : "", visible : false };

/* 4. Camera Controls */
const mainControls = new OrbitControls(maincamera, renderer.domElement);
mainControls.enableDamping = false;
mainControls.enabled = true;

const topviewControls = new OrbitControls(topviewcamera, renderer.domElement);
topviewControls.enableDamping = false;
topviewControls.enabled = false;

// Keep camera interaction speed consistent after reducing pixel ratio.
mainControls.rotateSpeed *= CAMERA_SPEED_COMPENSATION;
mainControls.panSpeed *= CAMERA_SPEED_COMPENSATION;
mainControls.zoomSpeed *= CAMERA_SPEED_COMPENSATION;
mainControls.autoRotateSpeed *= CAMERA_SPEED_COMPENSATION;

topviewControls.rotateSpeed *= CAMERA_SPEED_COMPENSATION;
topviewControls.panSpeed *= CAMERA_SPEED_COMPENSATION * TOPVIEW_MOVE_SPEED_MULTIPLIER;
topviewControls.zoomSpeed *= CAMERA_SPEED_COMPENSATION;
topviewControls.autoRotateSpeed *= CAMERA_SPEED_COMPENSATION;

let controls = mainControls;

/* 5. Additional Setup */

/* Section. */
// Note.
maincamera.position.set(2, 2, 2);
maincamera.lookAt(0, 0, 0);

topviewcamera.zoom = 0.01;
topviewcamera.updateProjectionMatrix();

mainControls.minDistance = 0.2;
mainControls.maxDistance = 200;

topviewControls.minZoom = 0.01;
topviewControls.maxZoom = 1000;

// Note.
function getActiveCamera() {
	return camera;
}

function getActiveControls() {
	return (getActiveCamera() === maincamera) ? mainControls : topviewControls;
}

// Note.
const zoomUI = initZoomSlider({
	getActiveCamera,
	getActiveControls,
	mainControls,
	topviewControls,
});

// Note.
const perspMover = createPerspCameraMover({
	getActiveCamera,
	getActiveControls,
	durationMs : 600,
	defaultCenter : new THREE.Vector3(0, 0, 0),
});

const topviewMover = createOrthoCameraMover({
	getCamera : () => topviewcamera,
	getControls : () => topviewControls,
	durationMs : 600,
	onAfterUpdate : () => zoomUI.syncSliderFromView(),
});

// Note.
const rotateZToggleEl = document.getElementById("mainAutoRotateZ");
const mainInvertZEl = document.getElementById("mainInvertZ");
const axisMainAllEl = document.getElementById("axisMainAll");
const axisMainXEl = document.getElementById("axisMainX");
const axisMainYEl = document.getElementById("axisMainY");
const axisMainZEl = document.getElementById("axisMainZ");
const axisTopAllEl = document.getElementById("axisTopAll");
const axisTopXEl = document.getElementById("axisTopX");
const axisTopYEl = document.getElementById("axisTopY");
const axisTopZEl = document.getElementById("axisTopZ");
let autoRotateZEnabled = false;
let mainCameraZInverted = false;
let mainViewportYFlipped = false;
let relayingMainFlipPointerEvent = false;
let axisVisibleMain = { x : true, y : true, z : true };
let axisVisibleTop = { x : true, y : true, z : false };
let isMainControlsInteracting = false;
const relayedMainFlipPointerEvents = new WeakSet();


const TOPVIEW_PAN_PIXELS_PER_SEC = 500 * CAMERA_SPEED_COMPENSATION * TOPVIEW_MOVE_SPEED_MULTIPLIER;
const TOPVIEW_MIN_GRID_PIXEL_SPACING = 6;
const TOPVIEW_TARGET_GRID_PIXEL_SPACING = 18;
const TOPVIEW_MAX_GRID_LINE_COUNT = 1800;
const MAINVIEW_MIN_GRID_PIXEL_SPACING = 3;
const MAINVIEW_TARGET_GRID_PIXEL_SPACING = 12;
const MAINVIEW_MIN_ABS_VIEW_Z_FOR_GRID = 0.02;
const MAINVIEW_HORIZON_DENSITY_CLAMP_Z = 0.08;
const MAINVIEW_GRID_HIDE_DISTANCE_IN_GRID_PITCH = 240;
const topviewPanPressed = new Set();
const MAINCAM_MOVE_GRID_PITCH_RATIO_PER_SEC = 5;
const MAINCAM_MOVE_FALLBACK_UNITS_PER_SEC = 12 * CAMERA_SPEED_COMPENSATION;
const maincamMovePressed = new Set();
const maincamMoveForward = new THREE.Vector3();
const maincamMoveRight = new THREE.Vector3();
const maincamMoveDelta = new THREE.Vector3();
const maincamMoveUp = new THREE.Vector3(0, 0, 1);
const maincamMoveTargetDelta = new THREE.Vector3();
const adaptiveGridViewDir = new THREE.Vector3();

function isTypingElement(el) {
	if (!el) return false;
	const tag = (el.tagName || "").toLowerCase();
	return el.isContentEditable || tag === "input" || tag === "textarea" || tag === "select";
}

function getTopViewPanDirFromKey(code) {
	switch (code) {
		case "ArrowUp":
		case "KeyW":
			return { x : 0, y : 1 };
		case "ArrowDown":
		case "KeyS":
			return { x : 0, y : -1 };
		case "ArrowLeft":
		case "KeyA":
			return { x : -1, y : 0 };
		case "ArrowRight":
		case "KeyD":
			return { x : 1, y : 0 };
		default:
			return null;
	}
}

function isMainCameraMoveKey(code) {
	switch (code) {
		case "KeyW":
		case "KeyA":
		case "KeyS":
		case "KeyD":
		case "Space":
		case "ShiftLeft":
		case "ShiftRight":
			return true;
		default:
			return false;
	}
}

function getMainCameraMoveUnitsPerSec() {
	const gridPitch = activeScene?.userData?.designRoot?.userData?.gridPitch;
	if (Number.isFinite(gridPitch) && gridPitch > 0) {
		return gridPitch * MAINCAM_MOVE_GRID_PITCH_RATIO_PER_SEC;
	}
	return MAINCAM_MOVE_FALLBACK_UNITS_PER_SEC;
}

function updateTopViewPan(dt) {
	if (!camera.isOrthographicCamera) return;
	if (topviewPanPressed.size === 0) return;

	let dx = 0;
	let dy = 0;
	for (const code of topviewPanPressed) {
		const dir = getTopViewPanDirFromKey(code);
		if (!dir) continue;
		dx += dir.x;
		dy += dir.y;
	}
	if (dx === 0 && dy === 0) return;

	const len = Math.hypot(dx, dy) || 1;
	dx /= len;
	dy /= len;

	const screenH = Math.max(1, renderer.domElement.clientHeight || window.innerHeight || 1);
	const worldPerPixel = (topviewcamera.top - topviewcamera.bottom) / (screenH * topviewcamera.zoom);
	const safeDt = Math.min(dt, 1 / 60); // Clamp delta time to avoid large animation jumps.
	const panDist = TOPVIEW_PAN_PIXELS_PER_SEC * worldPerPixel * safeDt;

	const move = new THREE.Vector3(dx * panDist, dy * panDist, 0);
	topviewcamera.position.add(move);
	topviewControls.target.add(move);
	// Note.
}

function updateMainCameraMove(dt) {
	if (!camera.isPerspectiveCamera) return;
	if (maincamMovePressed.size === 0) return;
	if (perspMover.isMoving()) return;
	const moveUnitsPerSec = getMainCameraMoveUnitsPerSec();

	const forwardAxis = (maincamMovePressed.has("KeyW") ? 1 : 0) + (maincamMovePressed.has("KeyS") ? -1 : 0);
	const strafeAxis = (maincamMovePressed.has("KeyD") ? 1 : 0) + (maincamMovePressed.has("KeyA") ? -1 : 0);
	const verticalAxis =
		(maincamMovePressed.has("Space") ? 1 : 0) +
		((maincamMovePressed.has("ShiftLeft") || maincamMovePressed.has("ShiftRight")) ? -1 : 0);

	if (forwardAxis === 0 && strafeAxis === 0 && verticalAxis === 0) return;

	maincamMoveForward.subVectors(mainControls.target, maincamera.position);
	maincamMoveForward.z = 0;
	if (maincamMoveForward.lengthSq() <= 1e-9) {
		maincamera.getWorldDirection(maincamMoveForward);
		maincamMoveForward.z = 0;
	}
	if (maincamMoveForward.lengthSq() > 1e-9) maincamMoveForward.normalize();
	else maincamMoveForward.set(0, 1, 0);

	maincamMoveRight.crossVectors(maincamMoveForward, maincamMoveUp).normalize();

	maincamMoveDelta.set(0, 0, 0);
	if (forwardAxis !== 0) maincamMoveDelta.addScaledVector(maincamMoveForward, forwardAxis);
	if (strafeAxis !== 0) maincamMoveDelta.addScaledVector(maincamMoveRight, strafeAxis);

	const safeDt = Math.min(dt, 1 / 60); // Clamp delta time to avoid large animation jumps.
	if (maincamMoveDelta.lengthSq() > 1e-9) {
		maincamMoveDelta.normalize().multiplyScalar(moveUnitsPerSec * safeDt);
	}
	if (verticalAxis !== 0) {
		const verticalSign = mainCameraZInverted ? -1 : 1;
		maincamMoveDelta.z += verticalAxis * verticalSign * moveUnitsPerSec * safeDt;
	}

	if (maincamMoveDelta.lengthSq() <= 1e-12) return;
	maincamera.position.add(maincamMoveDelta);
	maincamMoveTargetDelta.copy(maincamMoveDelta);
	mainControls.target.add(maincamMoveTargetDelta);
}

window.addEventListener("keyup", (e) => {
	if (topviewPanPressed.has(e.code)) topviewPanPressed.delete(e.code);
	if (maincamMovePressed.has(e.code)) maincamMovePressed.delete(e.code);
});

window.addEventListener("blur", () => {
	topviewPanPressed.clear();
	maincamMovePressed.clear();
});

// Note.
mainControls.autoRotateSpeed = 1.0; // Keep the default auto-rotate speed.

mainControls.addEventListener("start", () => {
  isMainControlsInteracting = true;
});
mainControls.addEventListener("end", () => {
  isMainControlsInteracting = false;
});

function setAutoRotateZ(enabled) {
  autoRotateZEnabled = !!enabled;
  if (rotateZToggleEl) rotateZToggleEl.checked = autoRotateZEnabled;
}

function shouldFlipMainViewportY() {
	return mainCameraZInverted && (getActiveCamera() === maincamera);
}

function mirrorClientYInCanvas(clientY) {
	const rect = renderer.domElement.getBoundingClientRect();
	return rect.top + (rect.height - (clientY - rect.top));
}

function blurActiveElementForCanvasPointer() {
	const ae = document.activeElement;
	if (!ae || ae === document.body || ae === renderer.domElement) return;
	ae.blur?.();
}

function relayPointerEventForMainFlip(e) {
	if (relayingMainFlipPointerEvent) return;
	if (!shouldFlipMainViewportY()) return;
	if (!e?.isTrusted) return;
	if (e.type === "pointerdown") blurActiveElementForCanvasPointer();

	const mirroredClientY = mirrorClientYInCanvas(e.clientY);
	const screenYOffset = mirroredClientY - e.clientY;
	const eventInit = {
		pointerId : e.pointerId,
		width : e.width,
		height : e.height,
		pressure : e.pressure,
		tangentialPressure : e.tangentialPressure,
		tiltX : e.tiltX,
		tiltY : e.tiltY,
		twist : e.twist,
		pointerType : e.pointerType,
		isPrimary : e.isPrimary,
		clientX : e.clientX,
		clientY : mirroredClientY,
		screenX : e.screenX,
		screenY : e.screenY + screenYOffset,
		button : e.button,
		buttons : e.buttons,
		ctrlKey : e.ctrlKey,
		shiftKey : e.shiftKey,
		altKey : e.altKey,
		metaKey : e.metaKey,
		bubbles : true,
		cancelable : true,
		composed : true,
	};

	const cloned = new PointerEvent(e.type, eventInit);
	relayedMainFlipPointerEvents.add(cloned);
	e.preventDefault();
	e.stopImmediatePropagation();

	relayingMainFlipPointerEvent = true;
	try {
		renderer.domElement.dispatchEvent(cloned);
	} finally {
		relayingMainFlipPointerEvent = false;
	}
}

for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) {
	renderer.domElement.addEventListener(type, relayPointerEventForMainFlip, true);
}

renderer.domElement.addEventListener("pointerdown", (e) => {
	if (!e?.isTrusted) return;
	blurActiveElementForCanvasPointer();
}, true);

function syncMainViewportYFlip() {
	const shouldFlip = shouldFlipMainViewportY();
	if (mainViewportYFlipped === shouldFlip) return;
	mainViewportYFlipped = shouldFlip;
	renderer.domElement.style.transformOrigin = "50% 50%";
	renderer.domElement.style.transform = shouldFlip ? "scaleY(-1)" : "";
}

function setMainCameraZInversion(enabled, { reflectPosition = true } = {}) {
	const on = !!enabled;
	mainCameraZInverted = on;
	if (mainInvertZEl) mainInvertZEl.checked = on;

	if (reflectPosition) {
		maincamera.position.z *= -1;
		for (const ctx of scenes.values()) {
			const pos = ctx?.view?.main?.pos;
			if (Array.isArray(pos) && pos.length >= 3 && Number.isFinite(pos[2])) {
				pos[2] *= -1;
			}
		}
	}

	maincamera.up.set(0, 0, 1);
	maincamera.lookAt(mainControls.target);
	mainControls.update();
	syncMainViewportYFlip();
}

if (rotateZToggleEl) {
  rotateZToggleEl.addEventListener("change", () => {
    setAutoRotateZ(rotateZToggleEl.checked);
  });
}

if (mainInvertZEl) {
	mainInvertZEl.addEventListener("change", () => {
		setMainCameraZInversion(mainInvertZEl.checked, { reflectPosition : true });
	});
	setMainCameraZInversion(mainInvertZEl.checked, { reflectPosition : false });
}

function syncAxisVisibilityControls() {
	if (axisMainXEl) axisMainXEl.checked = !!axisVisibleMain.x;
	if (axisMainYEl) axisMainYEl.checked = !!axisVisibleMain.y;
	if (axisMainZEl) axisMainZEl.checked = !!axisVisibleMain.z;
	if (axisTopXEl) axisTopXEl.checked = !!axisVisibleTop.x;
	if (axisTopYEl) axisTopYEl.checked = !!axisVisibleTop.y;
	if (axisTopZEl) axisTopZEl.checked = !!axisVisibleTop.z;

	if (axisMainAllEl) {
		const all = !!axisVisibleMain.x && !!axisVisibleMain.y && !!axisVisibleMain.z;
		const any = !!axisVisibleMain.x || !!axisVisibleMain.y || !!axisVisibleMain.z;
		axisMainAllEl.checked = all;
		axisMainAllEl.indeterminate = any && !all;
	}
	if (axisTopAllEl) {
		const all = !!axisVisibleTop.x && !!axisVisibleTop.y && !!axisVisibleTop.z;
		const any = !!axisVisibleTop.x || !!axisVisibleTop.y || !!axisVisibleTop.z;
		axisTopAllEl.checked = all;
		axisTopAllEl.indeterminate = any && !all;
	}
}

function bindAxisVisibilityControls() {
	const applyNow = () => {
		syncAxisVisibilityControls();
		syncAxisVisibilityForCamera(activeScene, getActiveCamera());
	};

	if (axisMainAllEl) {
		axisMainAllEl.addEventListener("change", () => {
			const v = !!axisMainAllEl.checked;
			axisVisibleMain = { x : v, y : v, z : v };
			applyNow();
		});
	}
	if (axisTopAllEl) {
		axisTopAllEl.addEventListener("change", () => {
			const v = !!axisTopAllEl.checked;
			axisVisibleTop = { x : v, y : v, z : v };
			applyNow();
		});
	}

	const bindOne = (el, cam, key) => {
		if (!el) return;
		el.addEventListener("change", () => {
			if (cam === "main") axisVisibleMain[key] = !!el.checked;
			else axisVisibleTop[key] = !!el.checked;
			applyNow();
		});
	};
	bindOne(axisMainXEl, "main", "x");
	bindOne(axisMainYEl, "main", "y");
	bindOne(axisMainZEl, "main", "z");
	bindOne(axisTopXEl, "top", "x");
	bindOne(axisTopYEl, "top", "y");
	bindOne(axisTopZEl, "top", "z");

	applyNow();
}

bindAxisVisibilityControls();

// Note.
const sidePanels = initSidePanels({
	left : { defaultCollapsed : true, defaultTab : "data" },
	right : { defaultCollapsed : false, defaultTab : "zoom" },
});

/* Section. */
function makeDefaultLayerTopState(design, layerIndex) {
	const w = (design.nx - 1) * design.dx;
	const h = (design.ny - 1) * design.dy;

	// Note.
	const z = layerIndex * design.layerGap;

	// Note.
	// Note.
	const D = Math.max(w, h) * 2.0 + design.layerGap * 2.0;

	// Note.
	// Note.
	const zMin = computeFitZoomForDesign(design);
	const zMax = zMin * 1000.0;

	return {
		pos : [0, 0, z + D],
		target : [0, 0, z],

		zoom : zMin,

		// Note.

		// Note.
		minZoom : zMin,
		maxZoom : zMax,
	};
}

function computeFitZoomForDesign(design) {
	// Note.
	const w = (design.nx - 1) * design.dx;
	const h = (design.ny - 1) * design.dy;

	const aspect = window.innerWidth / window.innerHeight;
	const frustumW = frustumSize * aspect; // Visible world width.
	const frustumH = frustumSize; // Visible world height.

	const eps = 1e-9;
	const ww = Math.max(Math.abs(w), eps);
	const hh = Math.max(Math.abs(h), eps);

	// Note.
	const zW = (frustumW * 0.5) / ww;
	const zH = (frustumH * 0.5) / hh;

	let zFit = Math.min(zW, zH);

	if (!Number.isFinite(zFit) || zFit <= 0) zFit = 1.0;
	return zFit;
}

function makeInitialViewForCtx(designOrNull) {
	const base = cloneViewState(INITIAL_VIEW_STATE ?? captureViewState());
	const v = {
		active : "persp",		// "persp" | "ortho"
		activeLayer : 0,
		main : base.main,
		top : base.top, // Fallback when no design is loaded.
		layers : [],
	};
	
	if (designOrNull) {
		// Note.
		const layerGap = designOrNull.layerGap ?? designOrNull.meta?.layerGap ?? (Math.max(designOrNull.dx, designOrNull.dy) * 2);

		const w = (designOrNull.nx - 1) * designOrNull.dx;
		const h = (designOrNull.ny - 1) * designOrNull.dy;

		const zCenter = (designOrNull.nlayer - 1) * layerGap * 0.5;
		const layerHeight = Math.max(layerGap, (designOrNull.nlayer - 1) * layerGap);
		const L = Math.max(1, w, h, layerHeight);
		const mainTarget = [0, 0, zCenter];
		const mainPos = [L, L, mainCameraZInverted ? -L : L];
		const checkpointDist = Math.hypot(mainPos[0] - mainTarget[0], mainPos[1] - mainTarget[1], mainPos[2] - mainTarget[2]);
		const requiredMaxDistance = Math.max(200, checkpointDist * 1.2);

		v.main = {
			...(v.main ?? {}),
			pos : mainPos,
			target : mainTarget,
			maxDistance : requiredMaxDistance,
		};
	}

	if (designOrNull) {
		v.layers = Array.from({ length : designOrNull.nlayer }, (_, L) => makeDefaultLayerTopState(designOrNull, L));
		// Note.
		v.top = v.layers[0];
	}

	return v;
}

function captureViewState() {
	// Note.
	const ctx = scenes.get(activeSceneId);

	const v = ctx?.view ?? {
		active : (camera.isOrthographicCamera ? "ortho" : "persp"),
		activeLayer : 0,
		main : null,
		top : null,
		layers : [],
	};

	// Note.
	v.main = {
		pos : maincamera.position.toArray(),
		target : mainControls.target.toArray(),
		minDistance : mainControls.minDistance,
		maxDistance : mainControls.maxDistance,
	};

	// Note.
	const curTop = {
		pos : topviewcamera.position.toArray(),
		target : topviewControls.target.toArray(),
		zoom : topviewcamera.zoom,
		minZoom : topviewControls.minZoom,
		maxZoom : topviewControls.maxZoom,
	};

	// Note.
	v.active = (camera.isOrthographicCamera ? "ortho" : "persp");

	// Note.
	if (ctx?.design && Array.isArray(v.layers) && v.layers.length === ctx.design.nlayer) {
		const L = Math.max(0, Math.min(v.activeLayer | 0, v.layers.length - 1));
		if (v.active === "ortho") {
			v.layers[L] = curTop;
		}
	}

	// Note.
	v.top = curTop;

	return v;
}

function setAxesVisible(scene, vis) {
	if (!scene) return;
	const axX = scene.getObjectByName("axisX");
	const axY = scene.getObjectByName("axisY");
	const axZ = scene.getObjectByName("axisZ");
	if (axX) axX.visible = !!vis.x;
	if (axY) axY.visible = !!vis.y;
	if (axZ) axZ.visible = !!vis.z;
}

function syncAxisVisibilityForCamera(scene, activeCam) {
	if (!scene || !activeCam) return;
	const vis = activeCam.isOrthographicCamera ? axisVisibleTop : axisVisibleMain;
	const key = `${vis.x ? 1 : 0}${vis.y ? 1 : 0}${vis.z ? 1 : 0}${activeCam.isOrthographicCamera ? "o" : "p"}`;
	if (scene.userData.axisVisibilityKey === key) return;
	scene.userData.axisVisibilityKey = key;
	setAxesVisible(scene, vis);
}

function applyViewState(v) {
	if (!v) return;

	const ctx = scenes.get(activeSceneId);
	const design = ctx?.design ?? null;

	// Note.
	if (design) {
		if (!Array.isArray(v.layers) || v.layers.length !== design.nlayer) {
			const init = makeInitialViewForCtx(design);
			v.layers = init.layers;
			v.activeLayer = 0;
		}
	}

	// Note.
	setActiveCameraKind(v.active);

	// Note.
	if (v.main) {
		maincamera.position.fromArray(v.main.pos);
		mainControls.target.fromArray(v.main.target);
		mainControls.minDistance = v.main.minDistance ?? mainControls.minDistance;
		mainControls.maxDistance = v.main.maxDistance ?? mainControls.maxDistance;
		maincamera.up.set(0, 0, 1);
		maincamera.lookAt(mainControls.target);
		mainControls.update();
	}

	// Note.
	let topState = v.top;
	if (v.active === "ortho" && design && Array.isArray(v.layers) && v.layers.length === design.nlayer) {
		const L = Math.max(0, Math.min(v.activeLayer | 0, v.layers.length - 1));
		topState = v.layers[L] ?? topState;

		// Note.
		topviewControls.enableRotate = false;
		topviewcamera.up.set(0, 1, 0);
	}

	if (topState) {
		topviewcamera.position.fromArray(topState.pos);
		topviewControls.target.fromArray(topState.target);
		topviewcamera.zoom = topState.zoom ?? topviewcamera.zoom;
		topviewControls.minZoom = topState.minZoom ?? topviewControls.minZoom;
		topviewControls.maxZoom = topState.maxZoom ?? topviewControls.maxZoom;
		topviewcamera.updateProjectionMatrix();
		topviewcamera.lookAt(topviewControls.target);
		topviewControls.update();
	}

	onResize();
	zoomUI.syncSliderFromView();
	
	// Note.
	const root = activeScene?.userData?.designRoot;
	if (root?.userData?.setIsolatedLayer) {
		if (v.active === "ortho" && design) {
			root.userData.setIsolatedLayer(v.activeLayer | 0);
		} else {
			root.userData.setIsolatedLayer(null);
		}
	}

}

function cloneViewState(v) {
	return JSON.parse(JSON.stringify(v));
}

let INITIAL_VIEW_STATE = null;

function initScenes() {
	const ctx = {
		id : DEFAULT_SCENE_ID,
		isDefault : true,
		title : "Default",
		scene : makeDefaultScene(),
		view : null,
	};
	scenes.set(ctx.id, ctx);
	syncAxisLengthForCtx(ctx);
	syncCameraClipPlanesForCtx(ctx);
	activeScene = ctx.scene;
	
	// Note.
	{
		const { toPosition, toTarget } = computeMKeyMove();
		maincamera.position.copy(toPosition);
		mainControls.target.copy(toTarget);
		maincamera.lookAt(toTarget);
		mainControls.update();
	}

	// Note.
	topviewcamera.position.set(2, 2, 2);
	topviewControls.target.set(0, 0, 0);
	topviewcamera.zoom = 0.01;
	topviewcamera.updateProjectionMatrix();
	
	setActiveCameraKind("persp");
	zoomUI.syncSliderFromView();
	
	INITIAL_VIEW_STATE = captureViewState();
	ctx.view = makeInitialViewForCtx(null);
}

function setActiveSceneById(id) {
	if (!scenes.has(id)) return;
	if (id === activeSceneId) return;
	
	const cur = scenes.get(activeSceneId);
	if (cur) cur.view = captureViewState();
	
	activeSceneId = id;
	const next = scenes.get(id);
	activeScene = next.scene;
	syncAxisLengthForCtx(next);
	syncCameraClipPlanesForCtx(next);
	
	applyViewState(next.view);
	
	renderSceneList();
	
	renderCameraButtons();
	renderGroupTree();
	syncLayerStyleControls();
	syncSelectedNetForActiveScene();
	clearManualRoutePending("");
	closeDeleteConfirmModal();
}

async function addTextFilesAsScenes(files) {
	const templateView = cloneViewState(INITIAL_VIEW_STATE ?? captureViewState());
	let lastAddedId = null;
	
	for (const file of files) {
		const rawText = await file.text();
		
		sceneSeq += 1;
		const id = `file-${sceneSeq}`;
		lastAddedId = id;
		
		const s = createBaseScene();
		
		let design = null;
		try {
			design = parseDesignText(rawText);
			applyDesignToScene(s, design, { planeColor : 0x404040, planeOpacity : 0.0, gridLineColor : 0x575757, gridLineOpacity : 0.32 }); // Scene style defaults for loaded designs.
		} catch (err) {
			console.error("[parse/apply failed]", file.name, err);
			addPlaceholderCube(s, hashColor24(file.name));
		}
		
		const ctx = {
			id,
			isDefault : false,
			title : `Scene ${sceneSeq}`,
			fileMeta : { name : file.name, size : file.size, lastModified : file.lastModified },
			rawText,
			design,
			scene : s,
			view : design ? makeInitialViewForCtx(design) : cloneViewState(templateView),
		};
		
		syncAxisLengthForCtx(ctx);
		syncCameraClipPlanesForCtx(ctx);
		scenes.set(id, ctx);
	}
	
	renderSceneList();
	if (lastAddedId) setActiveSceneById(lastAddedId);
}

function buildEmptyProjectDesignText(spec) {
	const lines = [
		"DESIGN",
		`nlayer: ${spec.nlayer}`,
		`nx: ${spec.nx}`,
		`ny: ${spec.ny}`,
		`dx: ${spec.dx}`,
		`dy: ${spec.dy}`,
		`layerGap: ${spec.layerGap}`,
	];
	if (Number.isFinite(spec.bumpRadius) && spec.bumpRadius > 0) lines.push(`bumpRadius: ${spec.bumpRadius}`);
	if (Number.isFinite(spec.tsvRadius) && spec.tsvRadius > 0) lines.push(`tsvRadius: ${spec.tsvRadius}`);
	if (Number.isFinite(spec.viaRadius) && spec.viaRadius > 0) lines.push(`viaRadius: ${spec.viaRadius}`);
	lines.push("ENDDESIGN");
	return lines.join("\n");
}

function addEmptyProjectScene(spec) {
	if (!spec) throw new Error("Empty project spec is required.");
	sceneSeq += 1;
	const id = `empty-${sceneSeq}`;

	const s = createBaseScene();
	const rawText = buildEmptyProjectDesignText(spec);
	const design = parseDesignText(rawText);
	applyDesignToScene(s, design, { planeColor : 0x404040, planeOpacity : 0.0, gridLineColor : 0x575757, gridLineOpacity : 0.32 }); // Scene style defaults for loaded designs.

	const name = String(spec.name ?? "").trim() || `Project ${sceneSeq}`;
	const projectMeta = {
		kind : "empty",
		nlayer : design.nlayer,
		nx : design.nx,
		ny : design.ny,
		dx : design.dx,
		dy : design.dy,
		layerGap : design.layerGap,
		bumpRadius : design.bumpRadius,
		tsvRadius : design.tsvRadius,
		viaRadius : design.viaRadius,
		label : `${design.nlayer}L - ${design.nx}x${design.ny}`,
	};
	const ctx = {
		id,
		isDefault : false,
		title : name,
		fileMeta : { name : projectMeta.label },
		projectMeta,
		rawText,
		design,
		scene : s,
		view : makeInitialViewForCtx(design),
	};

	syncAxisLengthForCtx(ctx);
	syncCameraClipPlanesForCtx(ctx);
	scenes.set(id, ctx);
	renderSceneList();
	setActiveSceneById(id);
}

function sanitizeDownloadBaseName(v, fallback = "scene") {
	const raw = String(v ?? "").trim();
	const safe = raw.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim();
	return safe || fallback;
}

function triggerTextDownload(filename, text) {
	const blob = new Blob([text], { type : "text/plain;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function saveTextWithPicker(filename, text) {
	if (typeof window.showSaveFilePicker === "function") {
		try {
			const handle = await window.showSaveFilePicker({
				suggestedName : filename,
				types : [{
					description : "Project Text Files",
					accept : { "text/plain" : [".txt", ".log", ".csv"] },
				}],
			});
			const writable = await handle.createWritable();
			await writable.write(text);
			await writable.close();
			return true;
		} catch (err) {
			if (err?.name === "AbortError" || err?.name === "NotAllowedError") return false;
			throw err;
		}
	}

	const typed = window.prompt("Save Project As", filename);
	if (typed === null) return false;
	const name = sanitizeDownloadBaseName(typed.trim(), filename);
	const forcedTxt = name.toLowerCase().endsWith(".txt") ? name : `${name}.txt`;
	triggerTextDownload(forcedTxt, text);
	return true;
}

function stripLegacyManualRouteBreakMeta(design) {
	if (!design || !Array.isArray(design.groups)) return;
	for (const g of design.groups) {
		for (const n of (g?.nets ?? [])) {
			if (!n?.meta || typeof n.meta !== "object") continue;
			if (!Object.prototype.hasOwnProperty.call(n.meta, "manualRouteBreak")) continue;
			delete n.meta.manualRouteBreak;
		}
	}
}

async function saveActiveSceneAsText() {
	const ctx = scenes.get(activeSceneId);
	const design = ctx?.design;
	if (!ctx || !design) {
		alert("Save failed: active scene has no design data.");
		return;
	}

	let text = "";
	try {
		stripLegacyManualRouteBreakMeta(design);
		text = serializeDesignText(design);
	} catch (err) {
		console.error("[serialize failed]", err);
		alert("Save failed: could not serialize current scene.");
		return;
	}

	const base = sanitizeDownloadBaseName(ctx.title ?? ctx.fileMeta?.name ?? activeSceneId, "scene");
	const filename = base.toLowerCase().endsWith(".txt") ? base : `${base}.txt`;
	try {
		await saveTextWithPicker(filename, text);
	} catch (err) {
		console.error("[save failed]", err);
		alert("Save failed: could not write file.");
	}
}

const dataUI = initDataFilesUI({
	onFiles : (files) => addTextFilesAsScenes(files),
	onSave : () => saveActiveSceneAsText(),
	onCreateEmptyProject : (spec) => addEmptyProjectScene(spec),
	onSelect : (id) => setActiveSceneById(id),
	onRemove : (id) => removeScene(id),
});

const cameraButtonsEl = document.getElementById("cameraButtons");
const cameraResetBtnEl = document.getElementById("cameraResetBtn");
const groupTreeEl = document.getElementById("groupTree");
const layerColorInputEl = document.getElementById("layerColorInput");
const layerOpacityInputEl = document.getElementById("layerOpacityInput");
const layerOpacityValueEl = document.getElementById("layerOpacityValue");
const gridColorInputEl = document.getElementById("gridColorInput");
const gridOpacityInputEl = document.getElementById("gridOpacityInput");
const gridOpacityValueEl = document.getElementById("gridOpacityValue");
const netInfoPanelEl = document.getElementById("netInfoPanel");
const manualRouteModeEl = document.getElementById("manualRouteMode");
const manualRouteCancelBtnEl = document.getElementById("manualRouteCancelBtn");
const manualRouteStatusEl = document.getElementById("manualRouteStatus");
const designModeSelectBtnEl = document.getElementById("designModeSelectBtn");
const designModeRouteBtnEl = document.getElementById("designModeRouteBtn");
const designNetOpenBtnEl = document.getElementById("designNetOpenBtn");
const designNetModalEl = document.getElementById("designNetModal");
const designNetCloseBtnEl = document.getElementById("designNetCloseBtn");
const designNetCancelBtnEl = document.getElementById("designNetCancelBtn");
const designNetGroupSelectEl = document.getElementById("designNetGroupSelect");
const designNetCreateGroupEl = document.getElementById("designNetCreateGroup");
const designNetNewGroupIdEl = document.getElementById("designNetNewGroupId");
const designNetNewGroupNameEl = document.getElementById("designNetNewGroupName");
const designNetNewGroupColorEl = document.getElementById("designNetNewGroupColor");
const designNetIdEl = document.getElementById("designNetId");
const designNetNameEl = document.getElementById("designNetName");
const designNetEnabledEl = document.getElementById("designNetEnabled");
const designNetStartSpecEl = document.getElementById("designNetStartSpec");
const designNetStartRadiusEl = document.getElementById("designNetStartRadius");
const designNetEndSpecEl = document.getElementById("designNetEndSpec");
const designNetEndRadiusEl = document.getElementById("designNetEndRadius");
const designNetPathInputEl = document.getElementById("designNetPathInput");
const designNetCreateBtnEl = document.getElementById("designNetCreateBtn");
const designNetCreateMsgEl = document.getElementById("designNetCreateMsg");
const deleteConfirmModalEl = document.getElementById("deleteConfirmModal");
const deleteConfirmTitleEl = document.getElementById("deleteConfirmTitle");
const deleteConfirmMessageEl = document.getElementById("deleteConfirmMessage");
const deleteConfirmCloseBtnEl = document.getElementById("deleteConfirmCloseBtn");
const deleteConfirmCancelBtnEl = document.getElementById("deleteConfirmCancelBtn");
const deleteConfirmConfirmBtnEl = document.getElementById("deleteConfirmConfirmBtn");
const NET_INFO_EMPTY_TEXT = "No net is selected yet. Click near a net in the viewport.";

function applyEnglishUiText() {
	document.documentElement.lang = "en";

	const setById = (id, text) => {
		const el = document.getElementById(id);
		if (el) el.textContent = text;
	};

	setById("newSceneOpenBtn", "New Project");
	setById("dataPickBtn", "Open Project");
	setById("dataSaveBtn", "Save Project");
	setById("newSceneModalTitle", "New Project");
	setById("newSceneCreateBtn", "Create Project");
	setById("designNetModalTitle", "Create Net");
	setById("deleteConfirmTitle", "Confirm Delete");
	setById("deleteConfirmCancelBtn", "Cancel");
	setById("deleteConfirmConfirmBtn", "Delete");

	const drop = document.getElementById("dataDrop");
	if (drop) {
		drop.setAttribute("aria-label", "Project file drop area");
		const titleEl = drop.querySelector(".dropzone-title");
		if (titleEl) titleEl.textContent = "Drop project files here";
	}

	document.querySelectorAll(".dock-btn.toggle[data-action=\"toggle\"]").forEach((btn) => {
		btn.title = "Collapse / Expand";
		btn.setAttribute("aria-label", "Collapse / Expand");
	});

	const cameraList = document.getElementById("cameraButtons");
	if (cameraList) cameraList.setAttribute("aria-label", "Camera list");

	const cameraHint = document.querySelector(".camera-hint");
	if (cameraHint) cameraHint.textContent = "Select either the Main or a Layer Top camera.";

	if (netInfoPanelEl) netInfoPanelEl.textContent = NET_INFO_EMPTY_TEXT;
	const modeSelectLabel = designModeSelectBtnEl?.querySelector?.("span");
	const modeRouteLabel = designModeRouteBtnEl?.querySelector?.("span");
	if (modeSelectLabel) modeSelectLabel.textContent = "Pointer";
	if (modeRouteLabel) modeRouteLabel.textContent = "Route";
	if (designModeSelectBtnEl) {
		designModeSelectBtnEl.title = "Pointer mode";
		designModeSelectBtnEl.setAttribute("aria-label", "Pointer mode");
	}
	if (designModeRouteBtnEl) {
		designModeRouteBtnEl.title = "Routing mode";
		designModeRouteBtnEl.setAttribute("aria-label", "Routing mode");
	}
	setById("manualRouteCancelBtn", "Clear Selection");
	setById("designNetOpenBtn", "Open Net Creator");
	setById("designNetCreateBtn", "Create Net");
	setById("designNetCancelBtn", "Cancel");
}

applyEnglishUiText();

let selectedNetNid = null;
const selectedNetHighlightOverlays = [];
const selectedNetDimmedMaterialStates = [];
const selectedNetDimmedMaterialSet = new Set();
const netHighlightDimOpacity = 0.08;
const netHighlightMatrix = new THREE.Matrix4();
const tmpWorldA = new THREE.Vector3();
const tmpWorldB = new THREE.Vector3();
const tmpScreenA = new THREE.Vector2();
const tmpScreenB = new THREE.Vector2();
const tmpProjected = new THREE.Vector3();
const pickRaycaster = new THREE.Raycaster();
const pickNdc = new THREE.Vector2();
const netFocusMainCenter = new THREE.Vector3();
const netFocusTopCenter = new THREE.Vector3();
const netFocusMainDir = new THREE.Vector3();
const netFocusTopOffset = new THREE.Vector3();
const netFocusTopTarget = new THREE.Vector3();
const netFocusTopPosition = new THREE.Vector3();
const netPickPointerDown = { active : false, x : 0, y : 0 };
const NET_PICK_MAX_DRAG_PX = 4;
const topGridHoverPointer = { inside : false, clientX : 0, clientY : 0 };
const topGridHoverRaycaster = new THREE.Raycaster();
const topGridHoverNdc = new THREE.Vector2();
const topGridHoverPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const topGridHoverHit = new THREE.Vector3();
const topGridPickWorld = new THREE.Vector3();
const topGridPickNode = { layer : 0, x : 0, y : 0 };
const topGridHoverRadiusKey = "topGridHoverRadius";
const topGridHoverMeshKey = "topGridHoverMesh";
const manualRouteCandidateRadiusKey = "manualRouteCandidateRadius";
const manualRouteCandidateMeshKey = "manualRouteCandidateMesh";
const manualRouteCandidateTransform = new THREE.Object3D();
const manualRouteState = {
	enabled : false,
	pending : null,
	statusMessage : "",
};
const MANUAL_ROUTE_SIDE_START = 1;
const MANUAL_ROUTE_SIDE_END = 2;
const deleteConfirmState = {
	pending : null,
};

function clamp01(v) {
	return Math.min(1, Math.max(0, v));
}

function getTopGridHoverMesh(scene) {
	return scene?.userData?.[topGridHoverMeshKey] ?? null;
}

function setTopGridHoverVisible(scene, visible) {
	const mesh = getTopGridHoverMesh(scene);
	if (mesh) mesh.visible = !!visible;
}

function ensureTopGridHoverMesh(scene, radius) {
	if (!scene || !Number.isFinite(radius) || radius <= 0) return null;
	const current = getTopGridHoverMesh(scene);
	const currentRadius = Number(scene.userData?.[topGridHoverRadiusKey]);
	if (current && Math.abs(currentRadius - radius) <= 1e-9) return current;

	if (current) {
		if (current.parent) current.parent.remove(current);
		current.geometry?.dispose?.();
		current.material?.dispose?.();
	}

	const geom = new THREE.CircleGeometry(radius, 32);
	const mat = new THREE.MeshBasicMaterial({
		color : 0xffffff,
		transparent : false,
		depthTest : false,
		depthWrite : false,
		side : THREE.DoubleSide,
	});
	const mesh = new THREE.Mesh(geom, mat);
	mesh.name = "topGridHover";
	mesh.renderOrder = 3000;
	mesh.visible = false;
	mesh.raycast = () => {};
	scene.add(mesh);
	scene.userData[topGridHoverMeshKey] = mesh;
	scene.userData[topGridHoverRadiusKey] = radius;
	return mesh;
}

function getManualRouteCandidateMesh(scene) {
	return scene?.userData?.[manualRouteCandidateMeshKey] ?? null;
}

function setManualRouteCandidateVisible(scene, visible) {
	const mesh = getManualRouteCandidateMesh(scene);
	if (!mesh) return;
	if (!visible) mesh.count = 0;
	mesh.visible = !!visible;
}

function ensureManualRouteCandidateMesh(scene, radius) {
	if (!scene || !Number.isFinite(radius) || radius <= 0) return null;
	const current = getManualRouteCandidateMesh(scene);
	const currentRadius = Number(scene.userData?.[manualRouteCandidateRadiusKey]);
	if (current && Math.abs(currentRadius - radius) <= 1e-9) return current;

	if (current) {
		if (current.parent) current.parent.remove(current);
		current.geometry?.dispose?.();
		current.material?.dispose?.();
	}

	const outer = radius;
	const inner = radius * 0.62;
	const geom = new THREE.RingGeometry(inner, outer, 32);
	const mat = new THREE.MeshBasicMaterial({
		color : 0xffbd8a,
		transparent : true,
		opacity : 0.96,
		depthTest : false,
		depthWrite : false,
		side : THREE.DoubleSide,
	});
	const mesh = new THREE.InstancedMesh(geom, mat, 8);
	mesh.name = "manualRouteCandidates";
	mesh.renderOrder = 2996;
	mesh.visible = false;
	mesh.count = 0;
	mesh.frustumCulled = false;
	mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
	mesh.raycast = () => {};
	scene.add(mesh);
	scene.userData[manualRouteCandidateMeshKey] = mesh;
	scene.userData[manualRouteCandidateRadiusKey] = radius;
	return mesh;
}

function updateManualRouteCandidateOverlay(activeCam) {
	const ctx = scenes.get(activeSceneId);
	const scene = ctx?.scene ?? null;
	if (!scene) return;

	const design = ctx?.design;
	const pending = manualRouteState.pending;
	if (!manualRouteState.enabled || !pending || !design || !activeCam?.isOrthographicCamera) {
		setManualRouteCandidateVisible(scene, false);
		return;
	}

	const layer = Number(pending.layer);
	const x = Number(pending.x);
	const y = Number(pending.y);
	const dx = Number(design.dx);
	const dy = Number(design.dy);
	if (!Number.isFinite(layer) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(dx) || !Number.isFinite(dy) || dx <= 0 || dy <= 0) {
		setManualRouteCandidateVisible(scene, false);
		return;
	}

	const nx = Math.max(1, Number(design.nx) | 0);
	const ny = Math.max(1, Number(design.ny) | 0);
	const nlayer = Math.max(1, Number(design.nlayer) | 0);
	if (x < 0 || x >= nx || y < 0 || y >= ny || layer < 0 || layer >= nlayer) {
		setManualRouteCandidateVisible(scene, false);
		return;
	}

	const minPitch = Math.min(dx, dy);
	if (!Number.isFinite(minPitch) || minPitch <= 0) {
		setManualRouteCandidateVisible(scene, false);
		return;
	}

	const layerGapRaw = Number(design.layerGap);
	const layerGap = (Number.isFinite(layerGapRaw) && layerGapRaw > 0) ? layerGapRaw : minPitch;
	const mesh = ensureManualRouteCandidateMesh(scene, minPitch * 0.30);
	if (!mesh) return;

	const found = findNetByNid(ctx, pending.nid);
	const net = found?.net ?? null;
	if (!net?.enabled) {
		setManualRouteCandidateVisible(scene, false);
		return;
	}
	const routeState = buildManualRouteNetState(net);
	const validateTarget = createManualRouteStepValidator(ctx, net, pending, routeState);
	if (typeof validateTarget !== "function") {
		setManualRouteCandidateVisible(scene, false);
		return;
	}
	const x0 = (nx - 1) * dx * 0.5;
	const y0 = (ny - 1) * dy * 0.5;
	const wz = (layer * layerGap) + Math.max(minPitch * 1e-3, 1e-5);
	let count = 0;

	for (let oy = -1; oy <= 1; oy++) {
		for (let ox = -1; ox <= 1; ox++) {
			if (ox === 0 && oy === 0) continue;
			const tx = x + ox;
			const ty = y + oy;
			if (tx < 0 || tx >= nx || ty < 0 || ty >= ny) continue;

			const verdict = validateTarget(layer, tx, ty);
			if (!verdict?.ok) continue;

			const wx = (tx * dx) - x0;
			const wy = (ty * dy) - y0;
			manualRouteCandidateTransform.position.set(wx, wy, wz);
			manualRouteCandidateTransform.rotation.set(0, 0, 0);
			manualRouteCandidateTransform.scale.set(1, 1, 1);
			manualRouteCandidateTransform.updateMatrix();
			mesh.setMatrixAt(count, manualRouteCandidateTransform.matrix);
			count += 1;
		}
	}

	mesh.count = count;
	mesh.instanceMatrix.needsUpdate = true;
	mesh.visible = count > 0;
}

function snapTopGridClientPointToWorld(activeCam, clientX, clientY, outWorld, rect = null, outGrid = null) {
	if (!activeCam?.isOrthographicCamera || !outWorld) return 0;
	const ctx = scenes.get(activeSceneId);
	const design = ctx?.design;
	if (!design) return 0;

	const dx = Number(design.dx);
	const dy = Number(design.dy);
	if (!Number.isFinite(dx) || !Number.isFinite(dy) || dx <= 0 || dy <= 0) return 0;

	const minPitch = Math.min(dx, dy);
	if (!Number.isFinite(minPitch) || minPitch <= 0) return 0;

	const nlayer = Math.max(1, Number(design.nlayer) | 0);
	const nx = Math.max(1, Number(design.nx) | 0);
	const ny = Math.max(1, Number(design.ny) | 0);
	const layerGapRaw = Number(design.layerGap);
	const layerGap = (Number.isFinite(layerGapRaw) && layerGapRaw > 0) ? layerGapRaw : minPitch;
	const activeLayerRaw = Number(ctx?.view?.activeLayer);
	const layerIndex = Math.max(0, Math.min(Number.isFinite(activeLayerRaw) ? (activeLayerRaw | 0) : 0, nlayer - 1));

	const viewportRect = rect ?? renderer.domElement.getBoundingClientRect();
	if (viewportRect.width <= 0 || viewportRect.height <= 0) return 0;

	const px = clientX - viewportRect.left;
	const py = clientY - viewportRect.top;
	topGridHoverNdc.x = (px / viewportRect.width) * 2 - 1;
	topGridHoverNdc.y = -((py / viewportRect.height) * 2 - 1);

	const layerZ = layerIndex * layerGap;
	topGridHoverPlane.setComponents(0, 0, 1, -layerZ);
	topGridHoverRaycaster.setFromCamera(topGridHoverNdc, activeCam);
	if (!topGridHoverRaycaster.ray.intersectPlane(topGridHoverPlane, topGridHoverHit)) return 0;

	const x0 = (nx - 1) * dx * 0.5;
	const y0 = (ny - 1) * dy * 0.5;
	const gx = Math.max(0, Math.min(nx - 1, Math.round((topGridHoverHit.x + x0) / dx)));
	const gy = Math.max(0, Math.min(ny - 1, Math.round((topGridHoverHit.y + y0) / dy)));
	outWorld.set((gx * dx) - x0, (gy * dy) - y0, layerZ);
	if (outGrid) {
		outGrid.layer = layerIndex;
		outGrid.x = gx;
		outGrid.y = gy;
	}
	return minPitch;
}

function updateTopGridHoverIndicator(activeCam) {
	const ctx = scenes.get(activeSceneId);
	const scene = ctx?.scene ?? null;
	if (!scene) return;
	if (!ctx?.design) {
		setTopGridHoverVisible(scene, false);
		return;
	}

	if (!topGridHoverPointer.inside || !activeCam?.isOrthographicCamera) {
		setTopGridHoverVisible(scene, false);
		return;
	}

	const minPitch = snapTopGridClientPointToWorld(activeCam, topGridHoverPointer.clientX, topGridHoverPointer.clientY, topGridHoverHit);
	if (!(minPitch > 0)) {
		setTopGridHoverVisible(scene, false);
		return;
	}

	const mesh = ensureTopGridHoverMesh(scene, minPitch * 0.2);
	if (!mesh) return;
	mesh.position.set(topGridHoverHit.x, topGridHoverHit.y, topGridHoverHit.z + Math.max(minPitch * 1e-3, 1e-5));
	mesh.visible = true;
}

function setTopViewRulerVisible(visible) {
	const show = !!visible;
	if (topViewRulerOverlayEl.hidden === !show && topViewRulerState.visible === show) return;
	if (!show) {
		topViewRulerOverlayEl.hidden = true;
		if (topViewRulerTopEl) topViewRulerTopEl.innerHTML = "";
		if (topViewRulerLeftEl) topViewRulerLeftEl.innerHTML = "";
		topViewRulerState.key = "";
		topViewRulerState.visible = false;
		return;
	}
	topViewRulerOverlayEl.hidden = false;
	topViewRulerState.visible = true;
}

function getTopViewRulerStep(rawStep) {
	const target = Math.max(1, Math.ceil(Number.isFinite(rawStep) ? rawStep : 1));
	let magnitude = 1;
	while (magnitude * 10 < target) magnitude *= 10;
	for (const base of [1, 2, 5, 10]) {
		const step = base * magnitude;
		if (step >= target) return step;
	}
	return target;
}

function formatTopViewRulerCoordinate(value, pitch) {
	const _pitch = pitch;
	void _pitch;
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return "0";

	const rounded = Math.round((numeric + Number.EPSILON) * 100) / 100;
	if (Math.abs(rounded) >= 10000) {
		return rounded.toExponential(2).replace(/e\+?(-?)0*(\d+)/, 'e$1$2');
	}

	let text = rounded.toFixed(2).replace(/\.?0+$/, "");
	if (text === "-0") text = "0";
	return text;
}

function getTopViewRulerWorldStep(pitch, worldPerPixel, minPixelSpacing) {
	const baseStep = Math.max(1e-9, Math.abs(Number(pitch) || 0) * 0.5);
	const raw = Math.max(baseStep, Math.abs(Number(worldPerPixel) || 0) * Math.max(1, Number(minPixelSpacing) || 1));
	return getTopViewRulerStep(raw / baseStep) * baseStep;
}

function buildTopViewRulerAxisHtml({
	rangeMin,
	rangeMax,
	rangeSpan,
	anchorValue,
	minorStep,
	majorStep,
	formatPitch,
	axis,
}) {
	if (!Number.isFinite(rangeSpan) || rangeSpan <= 0) return "";
	const isLeft = axis === "left";
	const posProp = isLeft ? "top" : "left";
	const safeMinorStep = Math.max(1e-9, Math.abs(Number(minorStep) || 0));
	const safeMajorStep = Math.max(safeMinorStep, Math.abs(Number(majorStep) || 0));
	const anchor = Number.isFinite(anchorValue) ? anchorValue : 0;
	let html = "";

	const appendTicks = (step, major) => {
		const startN = Math.ceil((rangeMin - anchor) / step);
		const endN = Math.floor((rangeMax - anchor) / step);
		for (let n = startN; n <= endN; n++) {
			const value = anchor + n * step;
			const ratioBase = (value - rangeMin) / rangeSpan;
			const ratio = isLeft ? (1 - ratioBase) : ratioBase;
			if (!Number.isFinite(ratio) || ratio < -0.01 || ratio > 1.01) continue;
			const pct = Math.max(0, Math.min(100, ratio * 100));
			const klass = major ? `topview-ruler-tick ${axis} major` : `topview-ruler-tick ${axis}`;
			html += `<div class = "${klass}" style = "${posProp} : ${pct.toFixed(4)}%;"></div>`;
			if (major) {
				const label = escapeHtml(formatTopViewRulerCoordinate(value, formatPitch));
				html += `<div class = "topview-ruler-label ${axis}" style = "${posProp} : ${pct.toFixed(4)}%;">${label}</div>`;
			}
		}
	};

	appendTicks(safeMinorStep, false);
	appendTicks(safeMajorStep, true);
	return html;
}

function updateTopViewRulerOverlay(activeCam) {
	const ctx = scenes.get(activeSceneId);
	const design = ctx?.design;
	if (!activeCam?.isOrthographicCamera || !design || !topViewRulerTopEl || !topViewRulerLeftEl || !topViewRulerCornerEl) {
		setTopViewRulerVisible(false);
		return;
	}

	const dx = Number(design.dx);
	const dy = Number(design.dy);
	const nx = Math.max(1, Number(design.nx) | 0);
	const ny = Math.max(1, Number(design.ny) | 0);
	if (!Number.isFinite(dx) || dx <= 0 || !Number.isFinite(dy) || dy <= 0 || nx <= 0 || ny <= 0) {
		setTopViewRulerVisible(false);
		return;
	}

	const rect = renderer.domElement.getBoundingClientRect();
	if (rect.width <= 0 || rect.height <= 0) {
		setTopViewRulerVisible(false);
		return;
	}

	const leftUiRect = document.getElementById("ui-left")?.getBoundingClientRect?.();
	const rightUiRect = document.getElementById("ui-right")?.getBoundingClientRect?.();
	const leftInset = Math.max(0, Math.min(window.innerWidth, Math.ceil(leftUiRect?.right ?? 0)));
	const rightInset = Math.max(0, Math.min(window.innerWidth, Math.ceil(window.innerWidth - (rightUiRect?.left ?? window.innerWidth))));
	const topTrackLeft = leftInset + TOPVIEW_RULER_BREADTH_PX;
	const topTrackRight = rightInset;
	const leftTrackLeft = leftInset;
	const availableTopWidth = window.innerWidth - topTrackLeft - topTrackRight;
	const availableLeftHeight = window.innerHeight - TOPVIEW_RULER_BREADTH_PX;
	if (availableTopWidth <= 64 || availableLeftHeight <= 64) {
		setTopViewRulerVisible(false);
		return;
	}

	const zoom = Math.max(1e-9, Number(activeCam.zoom) || 0);
	const worldWidth = Math.abs(activeCam.right - activeCam.left) / zoom;
	const worldHeight = Math.abs(activeCam.top - activeCam.bottom) / zoom;
	if (!Number.isFinite(worldWidth) || worldWidth <= 0 || !Number.isFinite(worldHeight) || worldHeight <= 0) {
		setTopViewRulerVisible(false);
		return;
	}

	const centerX = Number(topviewControls.target?.x) || 0;
	const centerY = Number(topviewControls.target?.y) || 0;
	const fullMinX = centerX - worldWidth * 0.5;
	const fullMaxX = centerX + worldWidth * 0.5;
	const fullMinY = centerY - worldHeight * 0.5;
	const fullMaxY = centerY + worldHeight * 0.5;
	const topTrackStartPx = Math.max(0, Math.min(rect.width, topTrackLeft - rect.left));
	const topTrackEndPx = Math.max(0, Math.min(rect.width, (window.innerWidth - topTrackRight) - rect.left));
	const leftTrackTopPx = Math.max(0, Math.min(rect.height, TOPVIEW_RULER_BREADTH_PX - rect.top));
	const leftTrackBottomPx = Math.max(0, Math.min(rect.height, window.innerHeight - rect.top));
	if (topTrackEndPx <= topTrackStartPx || leftTrackBottomPx <= leftTrackTopPx) {
		setTopViewRulerVisible(false);
		return;
	}

	const minX = fullMinX + (topTrackStartPx / rect.width) * worldWidth;
	const maxX = fullMinX + (topTrackEndPx / rect.width) * worldWidth;
	const maxY = fullMaxY - (leftTrackTopPx / rect.height) * worldHeight;
	const minY = fullMaxY - (leftTrackBottomPx / rect.height) * worldHeight;

	const worldPerPixelX = worldWidth / Math.max(1, rect.width);
	const worldPerPixelY = worldHeight / Math.max(1, rect.height);
	const minorStepX = getTopViewRulerWorldStep(dx, worldPerPixelX, TOPVIEW_RULER_MINOR_MIN_PX);
	const majorStepX = getTopViewRulerWorldStep(dx, worldPerPixelX, TOPVIEW_RULER_MAJOR_MIN_PX);
	const minorStepY = getTopViewRulerWorldStep(dy, worldPerPixelY, TOPVIEW_RULER_MINOR_MIN_PX);
	const majorStepY = getTopViewRulerWorldStep(dy, worldPerPixelY, TOPVIEW_RULER_MAJOR_MIN_PX);
	const layerIndex = Math.max(0, Math.min((ctx?.view?.activeLayer ?? 0) | 0, Math.max(0, (Number(design.nlayer) | 0) - 1)));

	const nextKey = [
		activeSceneId,
		layerIndex,
		leftInset,
		rightInset,
		window.innerHeight,
		centerX.toFixed(4),
		centerY.toFixed(4),
		minX.toFixed(4),
		maxX.toFixed(4),
		minY.toFixed(4),
		maxY.toFixed(4),
		minorStepX.toFixed(4),
		majorStepX.toFixed(4),
		minorStepY.toFixed(4),
		majorStepY.toFixed(4),
	].join("|");
	if (topViewRulerState.visible && topViewRulerState.key === nextKey) return;

	setTopViewRulerVisible(true);
	topViewRulerState.key = nextKey;

	topViewRulerCornerEl.style.left = `${leftTrackLeft}px`;
	topViewRulerCornerEl.style.width = `${TOPVIEW_RULER_BREADTH_PX}px`;
	topViewRulerCornerEl.style.height = `${TOPVIEW_RULER_BREADTH_PX}px`;

	topViewRulerTopEl.style.left = `${topTrackLeft}px`;
	topViewRulerTopEl.style.right = `${topTrackRight}px`;
	topViewRulerTopEl.style.height = `${TOPVIEW_RULER_BREADTH_PX}px`;
	topViewRulerLeftEl.style.left = `${leftTrackLeft}px`;
	topViewRulerLeftEl.style.top = `${TOPVIEW_RULER_BREADTH_PX}px`;
	topViewRulerLeftEl.style.width = `${TOPVIEW_RULER_BREADTH_PX}px`;

	topViewRulerTopEl.innerHTML = buildTopViewRulerAxisHtml({
		rangeMin : minX,
		rangeMax : maxX,
		rangeSpan : Math.max(1e-9, maxX - minX),
		anchorValue : 0,
		minorStep : minorStepX,
		majorStep : majorStepX,
		formatPitch : dx * 0.5,
		axis : "top",
	});
	topViewRulerLeftEl.innerHTML = buildTopViewRulerAxisHtml({
		rangeMin : minY,
		rangeMax : maxY,
		rangeSpan : Math.max(1e-9, maxY - minY),
		anchorValue : 0,
		minorStep : minorStepY,
		majorStep : majorStepY,
		formatPitch : dy * 0.5,
		axis : "left",
	});
}

function getDesignRenderOpts(ctx) {
	if (!ctx) return { planeColor : 0x404040, planeOpacity : 0.0, gridLineColor : 0x575757, gridLineOpacity : 0.32 };
	if (!ctx.ui) ctx.ui = {};
	if (!ctx.ui.layerStyle) {
		ctx.ui.layerStyle = { planeColor : "#404040", planeOpacity : 0.0, gridLineColor : "#575757", gridLineOpacity : 0.32 };
	}
	const colorHex = Number.parseInt(String(ctx.ui.layerStyle.planeColor).replace(/^#/, ""), 16);
	const gridHex = Number.parseInt(String(ctx.ui.layerStyle.gridLineColor ?? "#575757").replace(/^#/, ""), 16);
	return {
		planeColor : Number.isFinite(colorHex) ? colorHex : 0x404040,
		planeOpacity : clamp01(Number(ctx.ui.layerStyle.planeOpacity ?? 0.0)),
		gridLineColor : Number.isFinite(gridHex) ? gridHex : 0x575757,
		gridLineOpacity : clamp01(Number(ctx.ui.layerStyle.gridLineOpacity ?? 0.32)),
	};
}

function syncLayerStyleControls() {
	if (!layerColorInputEl || !layerOpacityInputEl || !layerOpacityValueEl || !gridColorInputEl || !gridOpacityInputEl || !gridOpacityValueEl) return;
	const ctx = scenes.get(activeSceneId);
	const hasDesign = !!ctx?.design;
	if (!hasDesign) setManualRouteEnabled(false);
	layerColorInputEl.disabled = !hasDesign;
	layerOpacityInputEl.disabled = !hasDesign;
	gridColorInputEl.disabled = !hasDesign;
	gridOpacityInputEl.disabled = !hasDesign;

	if (!hasDesign) {
		layerColorInputEl.value = "#404040";
		layerOpacityInputEl.value = "0";
		layerOpacityValueEl.textContent = "0.00";
		gridColorInputEl.value = "#575757";
		gridOpacityInputEl.value = "0.32";
		gridOpacityValueEl.textContent = "0.32";
		syncManualRouteUi();
		syncDesignNetBuilderUi();
		return;
	}
	if (!ctx.ui) ctx.ui = {};
	if (!ctx.ui.layerStyle) ctx.ui.layerStyle = { planeColor : "#404040", planeOpacity : 0.0, gridLineColor : "#575757", gridLineOpacity : 0.32 };
	layerColorInputEl.value = ctx.ui.layerStyle.planeColor;
	layerOpacityInputEl.value = String(ctx.ui.layerStyle.planeOpacity);
	layerOpacityValueEl.textContent = Number(ctx.ui.layerStyle.planeOpacity).toFixed(2);
	gridColorInputEl.value = ctx.ui.layerStyle.gridLineColor ?? "#575757";
	gridOpacityInputEl.value = String(ctx.ui.layerStyle.gridLineOpacity ?? 0.32);
	gridOpacityValueEl.textContent = Number(ctx.ui.layerStyle.gridLineOpacity ?? 0.32).toFixed(2);
	syncManualRouteUi();
	syncDesignNetBuilderUi();
}


function applyActiveLayerStyleFast() {
	const ctx = scenes.get(activeSceneId);
	if (!ctx?.design) return false;
	return updateDesignStyleInScene(ctx.scene, getDesignRenderOpts(ctx));
}


function escapeHtml(str) {
	return String(str ?? "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function setNetInfoPanelContent(info) {
	if (!netInfoPanelEl) return;
	if (!info) {
		netInfoPanelEl.textContent = NET_INFO_EMPTY_TEXT;
		return;
	}

	const metaJson = (info.meta && Object.keys(info.meta).length > 0)
		? JSON.stringify(info.meta)
		: "-";

	netInfoPanelEl.innerHTML = `
		<div class = "inspect-kv">
			<div class = "inspect-key">Net</div><div class = "inspect-value"><code>${escapeHtml(info.nid)}</code></div>
			<div class = "inspect-key">Name</div><div class = "inspect-value">${escapeHtml(info.name ?? "-")}</div>
			<div class = "inspect-key">Group</div><div class = "inspect-value">${escapeHtml(info.groupName ?? info.groupId ?? "-")}</div>
			<div class = "inspect-key">Points</div><div class = "inspect-value">${escapeHtml(String(info.pointsCount ?? "-"))}</div>
			<div class = "inspect-key">Layers</div><div class = "inspect-value">${escapeHtml(info.layersText ?? "-")}</div>
			<div class = "inspect-key">Meta</div><div class = "inspect-value"><code>${escapeHtml(metaJson)}</code></div>
		</div>
	`;
}

function disposeHighlightMaterial(material) {
	if (!material) return;
	if (Array.isArray(material)) {
		for (const m of material) m?.dispose?.();
		return;
	}
	material.dispose?.();
}

function restoreDimmedMaterials() {
	for (const item of selectedNetDimmedMaterialStates) {
		const mat = item?.material;
		if (!mat) continue;
		mat.opacity = item.opacity;
		mat.transparent = item.transparent;
		mat.depthWrite = item.depthWrite;
		mat.needsUpdate = true;
	}
	selectedNetDimmedMaterialStates.length = 0;
	selectedNetDimmedMaterialSet.clear();
}

function clearNetHighlight() {
	for (const obj of selectedNetHighlightOverlays) {
		if (!obj) continue;
		if (obj.parent) obj.parent.remove(obj);
		if (obj.userData?.highlightOwnsGeometry && obj.geometry) {
			obj.geometry.dispose?.();
		}
		disposeHighlightMaterial(obj.material);
	}
	selectedNetHighlightOverlays.length = 0;
	restoreDimmedMaterials();
}

function copyObjectTransform(src, dst) {
	if (!src || !dst) return;
	dst.matrixAutoUpdate = src.matrixAutoUpdate;
	if (src.matrixAutoUpdate) {
		dst.position.copy(src.position);
		dst.quaternion.copy(src.quaternion);
		dst.scale.copy(src.scale);
		dst.updateMatrix();
		return;
	}
	dst.matrix.copy(src.matrix);
	dst.matrixWorldNeedsUpdate = true;
}

function dimMaterial(mat) {
	if (!mat || selectedNetDimmedMaterialSet.has(mat)) return;
	selectedNetDimmedMaterialSet.add(mat);
	selectedNetDimmedMaterialStates.push({
		material : mat,
		opacity : mat.opacity,
		transparent : mat.transparent,
		depthWrite : mat.depthWrite,
	});
	mat.transparent = true;
	mat.opacity = netHighlightDimOpacity;
	mat.depthWrite = false;
	mat.needsUpdate = true;
}

function dimObjectMaterial(obj) {
	const mat = obj?.material;
	if (!mat) return;
	if (Array.isArray(mat)) {
		for (const m of mat) dimMaterial(m);
		return;
	}
	dimMaterial(mat);
}

function addSelectedInstancedOverlay(srcMesh, instanceIndices) {
	if (!srcMesh?.geometry || !srcMesh.parent) return 0;
	if (!Array.isArray(instanceIndices) || instanceIndices.length === 0) return 0;
	const srcMat = Array.isArray(srcMesh.material) ? srcMesh.material[0] : srcMesh.material;
	const mat = srcMat?.clone?.();
	if (!mat) return 0;
	mat.depthWrite = false;
	mat.polygonOffset = true;
	mat.polygonOffsetFactor = -1;
	mat.polygonOffsetUnits = -1;
	const inst = new THREE.InstancedMesh(srcMesh.geometry, mat, instanceIndices.length);
	copyObjectTransform(srcMesh, inst);
	inst.name = `${srcMesh.name}:selected`;
	inst.renderOrder = Math.max((srcMesh.renderOrder ?? 0) + 50, 80);
	inst.frustumCulled = srcMesh.frustumCulled;
	inst.raycast = () => {};
	inst.userData.isNetHighlightOverlay = true;
	inst.userData.highlightOwnsGeometry = false;

	for (let i = 0; i < instanceIndices.length; i++) {
		const srcIdx = instanceIndices[i];
		srcMesh.getMatrixAt(srcIdx, netHighlightMatrix);
		inst.setMatrixAt(i, netHighlightMatrix);
	}
	inst.instanceMatrix.needsUpdate = true;
	srcMesh.parent.add(inst);
	selectedNetHighlightOverlays.push(inst);
	return instanceIndices.length;
}

function addSelectedLineSegmentOverlay(srcLine, segmentIndices) {
	if (!srcLine?.geometry || !srcLine.parent) return 0;
	if (!Array.isArray(segmentIndices) || segmentIndices.length === 0) return 0;

	const pos = srcLine.geometry?.attributes?.position;
	if (!pos || pos.count < 2) return 0;

	const out = [];
	const maxSegCount = Math.floor(pos.count / 2);
	for (const segIdx of segmentIndices) {
		const i = segIdx | 0;
		if (i < 0 || i >= maxSegCount) continue;
		const i0 = i * 2;
		const i1 = i0 + 1;
		out.push(
			pos.getX(i0), pos.getY(i0), pos.getZ(i0),
			pos.getX(i1), pos.getY(i1), pos.getZ(i1),
		);
	}
	if (out.length < 6) return 0;

	const srcMat = Array.isArray(srcLine.material) ? srcLine.material[0] : srcLine.material;
	const mat = srcMat?.clone?.();
	if (!mat) return 0;
	mat.depthWrite = false;
	mat.polygonOffset = true;
	mat.polygonOffsetFactor = -1;
	mat.polygonOffsetUnits = -1;

	const geom = new THREE.BufferGeometry();
	geom.setAttribute("position", new THREE.Float32BufferAttribute(out, 3));
	const overlay = new THREE.LineSegments(geom, mat);
	copyObjectTransform(srcLine, overlay);
	overlay.name = `${srcLine.name}:selected`;
	overlay.renderOrder = Math.max((srcLine.renderOrder ?? 0) + 50, 80);
	overlay.frustumCulled = srcLine.frustumCulled;
	overlay.raycast = () => {};
	overlay.userData.isNetHighlightOverlay = true;
	overlay.userData.highlightOwnsGeometry = true;

	srcLine.parent.add(overlay);
	selectedNetHighlightOverlays.push(overlay);
	return out.length / 6;
}

function collectNetHighlightTargets(nid) {
	if (!activeScene || !nid) return 0;
	const sid = String(nid);
	const root = activeScene?.userData?.designRoot;
	const index = root?.userData?.componentNetIndex;
	const hasComponentIndex = (index instanceof Map);
	let selectedCount = 0;

	activeScene.traverse((obj) => {
		if (!obj) return;
		if (obj.userData?.isNetHighlightOverlay) return;

		if (obj.isLine) {
			const segmentNetIds = obj.userData?.segmentNetIds;
			if (Array.isArray(segmentNetIds) && segmentNetIds.length > 0) {
				const pos = obj.geometry?.attributes?.position;
				const segCount = Math.min(segmentNetIds.length, Math.floor((pos?.count ?? 0) / 2));
				if (segCount <= 0) return;

				const selectedSegments = [];
				let hasNonSelected = false;
				for (let i = 0; i < segCount; i++) {
					const segNid = String(segmentNetIds[i]);
					if (segNid === sid) selectedSegments.push(i);
					else hasNonSelected = true;
				}

				if (selectedSegments.length === 0) {
					if (obj.visible) dimObjectMaterial(obj);
					return;
				}

				selectedCount += selectedSegments.length;
				if (!obj.visible || !hasNonSelected) return;
				addSelectedLineSegmentOverlay(obj, selectedSegments);
				dimObjectMaterial(obj);
				return;
			}

			const lineNid = parseNidFromLineName(obj.name);
			if (!lineNid) return;
			if (String(lineNid) === sid) {
				selectedCount += 1;
				return;
			}
			if (obj.visible) dimObjectMaterial(obj);
			return;
		}

		if (!obj.isInstancedMesh || !hasComponentIndex) return;
		const keys = obj.userData?.pickKeys;
		if (!Array.isArray(keys) || keys.length === 0) return;

		const maxCount = Math.min(keys.length, obj.count ?? keys.length);
		const selectedIndices = [];
		let hasNonSelected = false;

		for (let i = 0; i < maxCount; i++) {
			const key = keys[i];
			const nids = index.get(key);
			const isSelected = (nids instanceof Set) && nids.has(sid);
			if (isSelected) selectedIndices.push(i);
			else hasNonSelected = true;
		}

		if (selectedIndices.length === 0) {
			if (obj.visible) dimObjectMaterial(obj);
			return;
		}

		selectedCount += selectedIndices.length;
		if (!hasNonSelected || !obj.visible) return;

		// Clone selected instances before dimming shared material so selected net keeps original opacity.
		addSelectedInstancedOverlay(obj, selectedIndices);
		dimObjectMaterial(obj);
	});

	return selectedCount;
}

function applyNetHighlight(nid) {
	if (!activeScene || !nid) return false;
	clearNetHighlight();
	const ctx = scenes.get(activeSceneId);
	if (!ctx?.design) return false;

	let found = false;
	for (const g of (ctx.design.groups ?? [])) {
		for (const n of (g.nets ?? [])) {
			if (String(n.nid) === String(nid) && !!n.enabled) {
				found = true;
				break;
			}
		}
		if (found) break;
	}
	if (!found) return false;

	const count = collectNetHighlightTargets(nid);
	return count > 0;
}

function parseNidFromLineName(name) {
	if (typeof name !== "string" || !name.startsWith("net:")) return null;
	const idx = name.lastIndexOf(":L");
	if (idx <= 4) return null;
	return name.slice(4, idx);
}

function distanceToSegmentSq(px, py, ax, ay, bx, by) {
	const abx = bx - ax;
	const aby = by - ay;
	const apx = px - ax;
	const apy = py - ay;
	const denom = (abx * abx) + (aby * aby);
	if (denom <= 1e-9) return (apx * apx) + (apy * apy);
	const t = Math.max(0, Math.min(1, ((apx * abx) + (apy * aby)) / denom));
	const qx = ax + (abx * t);
	const qy = ay + (aby * t);
	const dx = px - qx;
	const dy = py - qy;
	return (dx * dx) + (dy * dy);
}

function worldToScreen(vec3, cam, rect, outVec2) {
	tmpProjected.copy(vec3).project(cam);
	outVec2.set(
		((tmpProjected.x + 1) * 0.5) * rect.width,
		((1 - tmpProjected.y) * 0.5) * rect.height,
	);
}

function findNearestNetNidAtClientPoint(clientX, clientY, candidateNids = null) {
	if (!activeScene || !camera) return null;
	const rect = renderer.domElement.getBoundingClientRect();
	const px = clientX - rect.left;
	const pyRaw = clientY - rect.top;
	const py = shouldFlipMainViewportY() ? (rect.height - pyRaw) : pyRaw;
	const filter = (candidateNids && candidateNids.size > 0) ? candidateNids : null;

	let bestNid = null;
	let bestDistSq = Number.POSITIVE_INFINITY;

	activeScene.traverse((obj) => {
		if (!obj?.isLine || !obj.visible) return;
		const pos = obj.geometry?.attributes?.position;
		if (!pos || pos.count < 2) return;
		const segmentNetIds = obj.userData?.segmentNetIds;

		if (Array.isArray(segmentNetIds) && segmentNetIds.length > 0) {
			const segCount = Math.min(segmentNetIds.length, Math.floor(pos.count / 2));
			for (let i = 0; i < segCount; i++) {
				const nid = String(segmentNetIds[i]);
				if (filter && !filter.has(nid)) continue;
				const i0 = i * 2;
				const i1 = i0 + 1;
				tmpWorldA.fromBufferAttribute(pos, i0).applyMatrix4(obj.matrixWorld);
				tmpWorldB.fromBufferAttribute(pos, i1).applyMatrix4(obj.matrixWorld);

				worldToScreen(tmpWorldA, camera, rect, tmpScreenA);
				worldToScreen(tmpWorldB, camera, rect, tmpScreenB);

				const d2 = distanceToSegmentSq(px, py, tmpScreenA.x, tmpScreenA.y, tmpScreenB.x, tmpScreenB.y);
				if (d2 < bestDistSq) {
					bestDistSq = d2;
					bestNid = nid;
				}
			}
			return;
		}

		const nid = parseNidFromLineName(obj.name);
		if (!nid) return;
		if (filter && !filter.has(String(nid))) return;

		for (let i = 0; i < pos.count - 1; i++) {
			tmpWorldA.fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld);
			tmpWorldB.fromBufferAttribute(pos, i + 1).applyMatrix4(obj.matrixWorld);

			worldToScreen(tmpWorldA, camera, rect, tmpScreenA);
			worldToScreen(tmpWorldB, camera, rect, tmpScreenB);

			const d2 = distanceToSegmentSq(px, py, tmpScreenA.x, tmpScreenA.y, tmpScreenB.x, tmpScreenB.y);
			if (d2 < bestDistSq) {
				bestDistSq = d2;
				bestNid = String(nid);
			}
		}
	});

	return bestNid;
}

function resolveHitCandidateNids(hit) {
	if (!hit?.object) return null;
	if (hit.object.isLine) {
		const segmentNetIds = hit.object.userData?.segmentNetIds;
		if (Array.isArray(segmentNetIds) && segmentNetIds.length > 0) {
			const idxRaw = Number(hit.index);
			if (Number.isFinite(idxRaw)) {
				const idx = Math.max(0, idxRaw | 0);
				const nid = segmentNetIds[idx] ?? segmentNetIds[Math.floor(idx / 2)];
				if (nid !== undefined && nid !== null) return new Set([String(nid)]);
			}
		}
		const nid = parseNidFromLineName(hit.object.name);
		return nid ? new Set([String(nid)]) : null;
	}
	const keys = hit.object?.userData?.pickKeys;
	if (!Array.isArray(keys)) return null;
	const iid = hit.instanceId;
	if (!Number.isInteger(iid) || iid < 0 || iid >= keys.length) return null;
	const key = keys[iid];
	const root = activeScene?.userData?.designRoot;
	const index = root?.userData?.componentNetIndex;
	if (!(index instanceof Map)) return null;
	const nids = index.get(key);
	if (!(nids instanceof Set) || nids.size === 0) return null;
	return new Set([...nids].map((v) => String(v)));
}

function pickNearestNetFromClick(clientX, clientY) {
	if (!activeScene || !camera) return null;
	const rect = renderer.domElement.getBoundingClientRect();
	let pickClientX = clientX;
	let pickClientY = clientY;
	const minPitch = snapTopGridClientPointToWorld(camera, clientX, clientY, topGridPickWorld, rect);
	if (minPitch > 0) {
		worldToScreen(topGridPickWorld, camera, rect, tmpScreenA);
		pickClientX = rect.left + tmpScreenA.x;
		pickClientY = rect.top + tmpScreenA.y;
	}

	const px = pickClientX - rect.left;
	const pyRaw = pickClientY - rect.top;
	const py = shouldFlipMainViewportY() ? (rect.height - pyRaw) : pyRaw;
	pickNdc.x = (px / rect.width) * 2 - 1;
	pickNdc.y = -((py / rect.height) * 2 - 1);
	pickRaycaster.params.Line.threshold = 0.18;
	pickRaycaster.setFromCamera(pickNdc, camera);
	const hits = pickRaycaster.intersectObject(activeScene, true);

	for (const hit of hits) {
		const nids = resolveHitCandidateNids(hit);
		if (!nids || nids.size === 0) continue;
		if (nids.size === 1) return [...nids][0];
		const nearest = findNearestNetNidAtClientPoint(pickClientX, pickClientY, nids);
		if (nearest) return nearest;
	}

	return null;
}

function getNetInfoByNid(ctx, nid) {
	if (!ctx?.design || !nid) return null;
	for (const g of (ctx.design.groups ?? [])) {
		for (const n of (g.nets ?? [])) {
			if (String(n.nid) !== String(nid)) continue;
			if (!n.enabled) return null;
			const pts = typeof n.points === "function" ? n.points() : [];
			const layers = [...new Set(pts.map((p) => p.layer))].sort((a, b) => a - b);
			return {
				nid : n.nid,
				name : n.name ?? null,
				groupId : g.gid ?? null,
				groupName : g.name ?? null,
				pointsCount : pts.length,
				layersText : layers.length ? layers.join(", ") : "-",
				meta : n.meta ?? null,
			};
		}
	}
	return { nid, name : null, groupId : null, groupName : null, pointsCount : null, layersText : "-", meta : null };
}

function findNetByNid(ctx, nid) {
	if (!ctx?.design || !nid) return null;
	for (const g of (ctx.design.groups ?? [])) {
		for (const n of (g.nets ?? [])) {
			if (String(n.nid) !== String(nid)) continue;
			return { group : g, net : n };
		}
	}
	return null;
}

function toGridPointKey(layer, x, y) {
	return `${layer}:${x}:${y}`;
}

function isNodeAtGridPoint(node, layer, x, y) {
	if (!node) return false;
	const nx = Number(node.x);
	const ny = Number(node.y);
	const nl = Number(node.layer);
	return Number.isFinite(nx) &&
		Number.isFinite(ny) &&
		Number.isFinite(nl) &&
		nx === Number(x) &&
		ny === Number(y) &&
		nl === Number(layer);
}

function getNetRoutingTipNode(net, side) {
	if (!net) return null;
	const br = getNetManualRouteBreakMeta(net);
	if (br) {
		if (side === "start") return (br.side === "start") ? br.tip : br.reconnect;
		if (side === "end") return (br.side === "end") ? br.tip : br.reconnect;
	}
	const path = Array.isArray(net.path) ? net.path : null;
	if (!path || path.length === 0) {
		return (side === "start") ? net.start : net.end;
	}
	return (side === "start") ? path[0] : path[path.length - 1];
}

function getNetPointsForRouting(net) {
	if (!net) return [];
	if (typeof net.points === "function") {
		const pts = net.points();
		if (Array.isArray(pts)) return pts;
	}
	const out = [];
	if (net.start) out.push(net.start);
	if (Array.isArray(net.path)) out.push(...net.path);
	if (net.end) out.push(net.end);
	return out;
}

function buildOccupiedGridPointNetOwnersMap(ctx) {
	const out = new Map();
	const design = ctx?.design;
	if (!design) return out;

	for (const g of (design.groups ?? [])) {
		for (const n of (g.nets ?? [])) {
			const sid = String(n?.nid ?? "");
			if (!sid) continue;
			for (const p of getNetPointsForRouting(n)) {
				const x = Number(p?.x);
				const y = Number(p?.y);
				const layer = Number(p?.layer);
				if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(layer)) continue;
				const key = toGridPointKey(layer, x, y);
				let set = out.get(key);
				if (!set) {
					set = new Set();
					out.set(key, set);
				}
				set.add(sid);
			}
		}
	}

	return out;
}

function toDiagonalCellKey(layer, cellX, cellY) {
	return `${layer}:${cellX}:${cellY}`;
}

function getDiagonalCellOrientation(fromX, fromY, toX, toY) {
	const dx = Number(toX) - Number(fromX);
	const dy = Number(toY) - Number(fromY);
	if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
	if (Math.abs(dx) !== 1 || Math.abs(dy) !== 1) return null;
	return (dx === dy) ? "backslash" : "slash";
}

function buildDiagonalCellOccupancyMap(ctx) {
	const out = new Map();
	const design = ctx?.design;
	if (!design) return out;

	for (const g of (design.groups ?? [])) {
		for (const n of (g.nets ?? [])) {
			const path = Array.isArray(n?.path) ? n.path : null;
			// Only explicit routed segments should reserve diagonal cells.
			if (!path || path.length === 0) continue;
			const points = getNetPointsForRouting(n);
			if (!Array.isArray(points) || points.length < 2) continue;

			for (let i = 1; i < points.length; i++) {
				const a = points[i - 1];
				const b = points[i];
				if (isManualRouteBreakSegment(n, a, b)) continue;
				const ax = Number(a?.x);
				const ay = Number(a?.y);
				const al = Number(a?.layer);
				const bx = Number(b?.x);
				const by = Number(b?.y);
				const bl = Number(b?.layer);
				if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(al) ||
					!Number.isFinite(bx) || !Number.isFinite(by) || !Number.isFinite(bl)) {
					continue;
				}
				if (al !== bl) continue;

				const orient = getDiagonalCellOrientation(ax, ay, bx, by);
				if (!orient) continue;
				const cellX = Math.min(ax, bx);
				const cellY = Math.min(ay, by);
				const key = toDiagonalCellKey(al, cellX, cellY);
				let set = out.get(key);
				if (!set) {
					set = new Set();
					out.set(key, set);
				}
				set.add(orient);
			}
		}
	}

	return out;
}

function isDiagonalStepBlockedByOccupiedCell(diagonalMap, layer, fromX, fromY, toX, toY) {
	if (!(diagonalMap instanceof Map)) return false;
	const orient = getDiagonalCellOrientation(fromX, fromY, toX, toY);
	if (!orient) return false;
	const opposite = (orient === "backslash") ? "slash" : "backslash";
	const cellX = Math.min(Number(fromX), Number(toX));
	const cellY = Math.min(Number(fromY), Number(toY));
	const key = toDiagonalCellKey(Number(layer), cellX, cellY);
	const occupied = diagonalMap.get(key);
	return !!occupied?.has?.(opposite);
}

function toManualRouteNodeCoord(node) {
	const layer = Number(node?.layer);
	const x = Number(node?.x);
	const y = Number(node?.y);
	if (!Number.isFinite(layer) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
	return { layer, x, y };
}

function clearNetManualRouteBreakMeta(net) {
	if (!net) return false;
	let changed = false;
	if (Object.prototype.hasOwnProperty.call(net, "__manualRouteBreak")) {
		delete net.__manualRouteBreak;
		changed = true;
	}
	// Legacy cleanup: stop persisting transient routing metadata into file-save path.
	if (net.meta && typeof net.meta === "object" && Object.prototype.hasOwnProperty.call(net.meta, "manualRouteBreak")) {
		delete net.meta.manualRouteBreak;
		changed = true;
	}
	return changed;
}

function getNetManualRouteBreakMeta(net) {
	const raw = net?.__manualRouteBreak;
	if (!raw || typeof raw !== "object") return null;
	const side = (raw.side === "start" || raw.side === "end") ? raw.side : null;
	const tip = toManualRouteNodeCoord(raw.tip);
	const reconnect = toManualRouteNodeCoord(raw.reconnect);
	if (!side || !tip || !reconnect) return null;
	return { side, tip, reconnect };
}

function isManualRouteBreakSegment(net, aNode, bNode) {
	const br = getNetManualRouteBreakMeta(net);
	if (!br) return false;
	const tip = br.tip;
	const reconnect = br.reconnect;
	const direct =
		isNodeAtGridPoint(aNode, tip.layer, tip.x, tip.y) &&
		isNodeAtGridPoint(bNode, reconnect.layer, reconnect.x, reconnect.y);
	if (direct) return true;
	const reverse =
		isNodeAtGridPoint(aNode, reconnect.layer, reconnect.x, reconnect.y) &&
		isNodeAtGridPoint(bNode, tip.layer, tip.x, tip.y);
	return reverse;
}

function getManualRouteSideMask(side) {
	return (side === "end") ? MANUAL_ROUTE_SIDE_END : MANUAL_ROUTE_SIDE_START;
}

function getManualRouteOppositeMask(side) {
	return (side === "end") ? MANUAL_ROUTE_SIDE_START : MANUAL_ROUTE_SIDE_END;
}

function findManualRoutePointIndices(points, layer, x, y) {
	const out = [];
	if (!Array.isArray(points)) return out;
	for (let i = 0; i < points.length; i++) {
		if (isNodeAtGridPoint(points[i], layer, x, y)) out.push(i);
	}
	return out;
}

function buildManualRouteNetState(net) {
	const points = getNetPointsForRouting(net);
	const pointMasks = new Array(points.length).fill(0);
	const keyMasks = new Map();
	if (points.length === 0) return { points, pointMasks, keyMasks, breakEdge : null };

	let breakEdge = null;
	const br = getNetManualRouteBreakMeta(net);
	if (br) {
		for (let i = 1; i < points.length; i++) {
			const a = points[i - 1];
			const b = points[i];
			if (!isManualRouteBreakSegment(net, a, b)) continue;
			breakEdge = { a : i - 1, b : i };
			break;
		}
	}

	const adj = new Array(points.length);
	for (let i = 0; i < points.length; i++) adj[i] = [];
	for (let i = 1; i < points.length; i++) {
		const a = i - 1;
		const b = i;
		if (breakEdge && breakEdge.a === a && breakEdge.b === b) continue;
		adj[a].push(b);
		adj[b].push(a);
	}

	const flood = (seedIndex, bit) => {
		if (!Number.isFinite(seedIndex) || seedIndex < 0 || seedIndex >= points.length) return;
		const q = [seedIndex];
		const seen = new Set([seedIndex]);
		while (q.length > 0) {
			const idx = q.shift();
			pointMasks[idx] |= bit;
			for (const next of adj[idx]) {
				if (seen.has(next)) continue;
				seen.add(next);
				q.push(next);
			}
		}
	};

	flood(0, MANUAL_ROUTE_SIDE_START);
	flood(points.length - 1, MANUAL_ROUTE_SIDE_END);

	for (let i = 0; i < points.length; i++) {
		const p = points[i];
		const layer = Number(p?.layer);
		const x = Number(p?.x);
		const y = Number(p?.y);
		if (!Number.isFinite(layer) || !Number.isFinite(x) || !Number.isFinite(y)) continue;
		const key = toGridPointKey(layer, x, y);
		const prev = Number(keyMasks.get(key) || 0);
		keyMasks.set(key, prev | Number(pointMasks[i] || 0));
	}

	return { points, pointMasks, keyMasks, breakEdge };
}

function resolveManualRoutePendingFullIndex(routeState, pending) {
	if (!routeState || !pending) return null;
	const points = Array.isArray(routeState.points) ? routeState.points : [];
	if (points.length === 0) return null;
	const matches = findManualRoutePointIndices(points, pending.layer, pending.x, pending.y);
	if (matches.length === 0) return null;

	const sideMask = getManualRouteSideMask(pending.side);
	const preferred = matches.filter((idx) => (Number(routeState.pointMasks?.[idx] || 0) & sideMask) !== 0);
	const pick = (pending.side === "end") ? 0 : -1;
	if (preferred.length > 0) return preferred[(pick < 0) ? (preferred.length - 1) : 0];
	return matches[(pick < 0) ? (matches.length - 1) : 0];
}

function resolveManualRouteOppositePointIndex(routeState, pending, tipIndex, layer, x, y) {
	if (!routeState || !pending || !Number.isFinite(tipIndex)) return null;
	const points = Array.isArray(routeState.points) ? routeState.points : [];
	if (tipIndex < 0 || tipIndex >= points.length) return null;

	const oppositeMask = getManualRouteOppositeMask(pending.side);
	const matches = findManualRoutePointIndices(points, layer, x, y);
	if (matches.length === 0) return null;

	let candidates = matches.filter((idx) => (Number(routeState.pointMasks?.[idx] || 0) & oppositeMask) !== 0);
	if (pending.side === "start") {
		candidates = candidates.filter((idx) => idx > tipIndex);
		if (candidates.length === 0) return null;
		return Math.min(...candidates);
	}
	candidates = candidates.filter((idx) => idx < tipIndex);
	if (candidates.length === 0) return null;
	return Math.max(...candidates);
}

function setNetPathFromFullPoints(net, points) {
	if (!net) return;
	if (!Array.isArray(points) || points.length < 2) {
		net.path = null;
		return;
	}
	const mid = points.slice(1, -1);
	net.path = (mid.length > 0) ? mid : null;
}

function setNetManualRouteBreakMeta(net, pending) {
	if (!net) return false;
	if (!pending) return clearNetManualRouteBreakMeta(net);
	const side = (pending.side === "start" || pending.side === "end") ? pending.side : null;
	if (!side) return clearNetManualRouteBreakMeta(net);

	const routeState = buildManualRouteNetState(net);
	const tipIndex = resolveManualRoutePendingFullIndex(routeState, pending);
	if (tipIndex === null) return clearNetManualRouteBreakMeta(net);

	const reconnectIndex = (side === "start") ? (tipIndex + 1) : (tipIndex - 1);
	if (reconnectIndex < 0 || reconnectIndex >= routeState.points.length) {
		return clearNetManualRouteBreakMeta(net);
	}

	const tip = toManualRouteNodeCoord(routeState.points[tipIndex]);
	const reconnect = toManualRouteNodeCoord(routeState.points[reconnectIndex]);
	if (!tip || !reconnect) return clearNetManualRouteBreakMeta(net);
	if (tip.layer === reconnect.layer && tip.x === reconnect.x && tip.y === reconnect.y) {
		return clearNetManualRouteBreakMeta(net);
	}

	const prev = getNetManualRouteBreakMeta(net);
	const same = !!prev &&
		prev.side === side &&
		Number(prev?.tip?.layer) === tip.layer &&
		Number(prev?.tip?.x) === tip.x &&
		Number(prev?.tip?.y) === tip.y &&
		Number(prev?.reconnect?.layer) === reconnect.layer &&
		Number(prev?.reconnect?.x) === reconnect.x &&
		Number(prev?.reconnect?.y) === reconnect.y;
	if (same) return false;

	net.__manualRouteBreak = {
		side,
		tip,
		reconnect,
	};
	return true;
}

function createManualRouteStepValidator(ctx, net, pending, routeState) {
	if (!ctx?.design || !net || !pending || !routeState) return null;
	const fromLayer = Number(pending.layer);
	const fromX = Number(pending.x);
	const fromY = Number(pending.y);
	if (!Number.isFinite(fromLayer) || !Number.isFinite(fromX) || !Number.isFinite(fromY)) return null;

	const tipIndex = resolveManualRoutePendingFullIndex(routeState, pending);
	if (tipIndex === null) return null;
	const ownNid = String(net.nid ?? "");
	if (!ownNid) return null;

	const ownersMap = buildOccupiedGridPointNetOwnersMap(ctx);
	const diagonalCells = buildDiagonalCellOccupancyMap(ctx);

	return (toLayer, toX, toY) => {
		const layer = Number(toLayer);
		const x = Number(toX);
		const y = Number(toY);
		if (!Number.isFinite(layer) || !Number.isFinite(x) || !Number.isFinite(y)) {
			return { ok : false, reason : "Target point is invalid.", complete : false, oppositeIndex : null };
		}
		if (layer !== fromLayer) {
			return { ok : false, reason : "Target must be on the same layer as the selected endpoint.", complete : false, oppositeIndex : null };
		}

		const dx = Math.abs(x - fromX);
		const dy = Math.abs(y - fromY);
		if (!((dx <= 1) && (dy <= 1) && (dx + dy > 0))) {
			return { ok : false, reason : "Target must be one of the 8 neighboring points.", complete : false, oppositeIndex : null };
		}

		const targetKey = toGridPointKey(layer, x, y);
		const owners = ownersMap.get(targetKey);
		let oppositeIndex = null;
		if (owners && owners.size > 0) {
			const selfOnly = owners.size === 1 && owners.has(ownNid);
			if (!selfOnly) {
				return { ok : false, reason : "Target point is already occupied.", complete : false, oppositeIndex : null };
			}
			oppositeIndex = resolveManualRouteOppositePointIndex(routeState, pending, tipIndex, layer, x, y);
			if (oppositeIndex === null) {
				return { ok : false, reason : "Target point is already occupied.", complete : false, oppositeIndex : null };
			}
		}

		if (isDiagonalStepBlockedByOccupiedCell(diagonalCells, fromLayer, fromX, fromY, x, y)) {
			return { ok : false, reason : "Target diagonal crosses an occupied cell diagonal.", complete : false, oppositeIndex : null };
		}

		return { ok : true, reason : "", complete : oppositeIndex !== null, oppositeIndex };
	};
}

function computeNetBendCount(points) {
	if (!Array.isArray(points) || points.length < 3) return 0;
	let bends = 0;
	let prev = null;
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1];
		const b = points[i];
		const sx = Math.sign((Number(b?.x) || 0) - (Number(a?.x) || 0));
		const sy = Math.sign((Number(b?.y) || 0) - (Number(a?.y) || 0));
		const sz = Math.sign((Number(b?.layer) || 0) - (Number(a?.layer) || 0));
		if (sx === 0 && sy === 0 && sz === 0) continue;
		const sig = `${sx},${sy},${sz}`;
		if (prev !== null && prev !== sig) bends += 1;
		prev = sig;
	}
	return bends;
}

function refreshNetRouteMetrics(design, net) {
	if (!design || !net) return;
	const points = getNetPointsForRouting(net);
	net.bendCount = computeNetBendCount(points);
	net.pathLen = null;
	net.setPathLen?.(Number(design.dx) || 1, Number(design.dy) || 1);
}

function refreshDesignRouteMetrics(design) {
	if (!design) return;
	const dx = Number(design.dx) || 1;
	const dy = Number(design.dy) || 1;
	for (const g of (design.groups ?? [])) {
		g?.calcLen?.(dx, dy);
	}
}

function setDesignNetCreateMessage(text, isError = false) {
	if (!designNetCreateMsgEl) return;
	const message = String(text ?? "").trim();
	designNetCreateMsgEl.textContent = message;
	designNetCreateMsgEl.dataset.error = (message && isError) ? "1" : "0";
}

function isDesignNetModalOpen() {
	return !!designNetModalEl && !designNetModalEl.hidden;
}

function openDesignNetModal() {
	if (!designNetModalEl) return false;
	if (!scenes.get(activeSceneId)?.design) {
		setDesignNetCreateMessage("Load a design to create nets.", true);
		return false;
	}
	syncDesignNetBuilderUi();
	setDesignNetCreateMessage("");
	designNetModalEl.hidden = false;
	designNetModalEl.setAttribute("aria-hidden", "false");
	designNetIdEl?.focus?.();
	return true;
}

function closeDesignNetModal({ clearMessage = true } = {}) {
	if (!designNetModalEl) return;
	designNetModalEl.hidden = true;
	designNetModalEl.setAttribute("aria-hidden", "true");
	if (clearMessage) setDesignNetCreateMessage("");
}

function normalizeDesignToolNodeType(raw) {
	const t = String(raw ?? "").trim().toLowerCase();
	switch (t) {
		case NodeType.BUMP:
		case NodeType.TSV:
		case NodeType.VIA:
		case NodeType.GRID:
			return t;
		default:
			return null;
	}
}

function parseDesignToolMetaValue(raw) {
	const s = String(raw ?? "").trim();
	if (!s) return "";
	const sl = s.toLowerCase();
	if (sl === "true") return true;
	if (sl === "false") return false;
	if (sl === "null") return null;
	const n = Number(s);
	if (Number.isFinite(n)) return n;
	return s;
}

function parseDesignToolOptionalRadius(raw, label) {
	const s = String(raw ?? "").trim();
	if (!s) return null;
	const r = Number(s);
	if (!Number.isFinite(r) || r <= 0) {
		throw new Error(`${label} must be a positive number.`);
	}
	return r;
}

function applyDesignToolNodeRadius(node, radius, label) {
	if (!node || !Number.isFinite(radius) || radius <= 0) return;
	const t = String(node.type ?? "");
	if (t !== NodeType.BUMP && t !== NodeType.TSV && t !== NodeType.VIA) {
		throw new Error(`${label} is only supported for bump/tsv/via nodes.`);
	}
	if (!node.meta || typeof node.meta !== "object") node.meta = {};
	node.meta.radius = radius;
}

function parseDesignToolNodeSpec(raw, label) {
	const text = String(raw ?? "").trim();
	if (!text) {
		throw new Error(`${label} is required. Format: type x y layer`);
	}

	const toks = text.split(/\s+/);
	if (toks.length < 4) {
		throw new Error(`${label} is invalid. Format: type x y layer`);
	}

	const type = normalizeDesignToolNodeType(toks[0]);
	if (!type) {
		throw new Error(`${label} type must be one of bump/tsv/via/grid.`);
	}

	const x = Number(toks[1]);
	const y = Number(toks[2]);
	const layer = Number(toks[3]);
	if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(layer)) {
		throw new Error(`${label} coordinates must be integers.`);
	}

	const meta = {};
	for (const tok of toks.slice(4)) {
		const eq = tok.indexOf("=");
		if (eq <= 0) continue;
		const key = tok.slice(0, eq).trim();
		const valueRaw = tok.slice(eq + 1).trim();
		if (!key) continue;
		meta[key] = parseDesignToolMetaValue(valueRaw);
	}

	return new Node({ type, x, y, layer, meta });
}

function validateDesignToolNodeInBounds(design, node, label) {
	if (!design || !node) return;
	const x = Number(node.x);
	const y = Number(node.y);
	const layer = Number(node.layer);
	const nx = Math.max(1, Number(design.nx) | 0);
	const ny = Math.max(1, Number(design.ny) | 0);
	const nlayer = Math.max(1, Number(design.nlayer) | 0);
	if (x < 0 || x >= nx || y < 0 || y >= ny || layer < 0 || layer >= nlayer) {
		throw new Error(`${label} is out of design bounds.`);
	}
}

function parseDesignToolPathNodes(rawText) {
	const lines = String(rawText ?? "").split(/\r?\n/);
	const nodes = [];
	for (let i = 0; i < lines.length; i++) {
		const line = String(lines[i] ?? "").trim();
		if (!line) continue;
		nodes.push(parseDesignToolNodeSpec(line, `Path node ${i + 1}`));
	}
	return nodes;
}

function collectUniqueViaNodes(nodes) {
	const out = [];
	const seen = new Set();
	for (const node of (nodes ?? [])) {
		if (!node || String(node.type) !== NodeType.VIA) continue;
		const key = `${node.layer}:${node.x}:${node.y}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(new Node({
			type : NodeType.VIA,
			x : Number(node.x),
			y : Number(node.y),
			layer : Number(node.layer),
			meta : { ...(node.meta ?? {}) },
		}));
	}
	return out;
}

function syncDesignNetBuilderUi() {
	const ctx = scenes.get(activeSceneId);
	const design = ctx?.design;
	const hasDesign = !!design;
	const groups = Array.isArray(design?.groups) ? design.groups : [];
	const hasGroups = groups.length > 0;
	if (designNetOpenBtnEl) designNetOpenBtnEl.disabled = !hasDesign;
	if (!hasDesign && isDesignNetModalOpen()) closeDesignNetModal({ clearMessage : false });

	if (designNetGroupSelectEl) {
		const prev = String(designNetGroupSelectEl.value ?? "");
		designNetGroupSelectEl.innerHTML = "";
		if (hasGroups) {
			for (const g of groups) {
				const gid = String(g?.gid ?? "");
				if (!gid) continue;
				const name = String(g?.name ?? gid);
				const opt = document.createElement("option");
				opt.value = gid;
				opt.textContent = `${name} (${gid})`;
				designNetGroupSelectEl.appendChild(opt);
			}
			const keep = groups.some((g) => String(g?.gid ?? "") === prev);
			designNetGroupSelectEl.value = keep ? prev : String(groups[0]?.gid ?? "");
		} else {
			const opt = document.createElement("option");
			opt.value = "";
			opt.textContent = "(No groups)";
			designNetGroupSelectEl.appendChild(opt);
			designNetGroupSelectEl.value = "";
		}
	}

	const forceCreateGroup = hasDesign && !hasGroups;
	if (designNetCreateGroupEl) {
		if (forceCreateGroup) designNetCreateGroupEl.checked = true;
		designNetCreateGroupEl.disabled = !hasDesign || forceCreateGroup;
	}
	const createGroupMode = !!designNetCreateGroupEl?.checked || forceCreateGroup;

	const netControls = [
		designNetIdEl,
		designNetNameEl,
		designNetEnabledEl,
		designNetStartSpecEl,
		designNetStartRadiusEl,
		designNetEndSpecEl,
		designNetEndRadiusEl,
		designNetPathInputEl,
		designNetCreateBtnEl,
	];
	for (const el of netControls) {
		if (el) el.disabled = !hasDesign;
	}

	if (designNetGroupSelectEl) designNetGroupSelectEl.disabled = !hasDesign || createGroupMode || !hasGroups;
	if (designNetNewGroupIdEl) designNetNewGroupIdEl.disabled = !hasDesign || !createGroupMode;
	if (designNetNewGroupNameEl) designNetNewGroupNameEl.disabled = !hasDesign || !createGroupMode;
	if (designNetNewGroupColorEl) designNetNewGroupColorEl.disabled = !hasDesign || !createGroupMode;

	if (!hasDesign) {
		setDesignNetCreateMessage("Load a design to create nets.", true);
		return;
	}
	const curMsg = String(designNetCreateMsgEl?.textContent ?? "").trim();
	if (!curMsg || curMsg === "Load a design to create nets.") {
		setDesignNetCreateMessage("");
	}
}

function createNetFromDesignTool() {
	const ctx = scenes.get(activeSceneId);
	const design = ctx?.design;
	if (!ctx || !design) {
		setDesignNetCreateMessage("No active design is loaded.", true);
		return false;
	}
	if (!Array.isArray(design.groups)) design.groups = [];

	try {
		const nid = String(designNetIdEl?.value ?? "").trim();
		if (!nid) throw new Error("Net ID is required.");

		for (const g of design.groups) {
			for (const n of (g.nets ?? [])) {
				if (String(n?.nid ?? "") === nid) {
					throw new Error(`Net ID "${nid}" already exists.`);
				}
			}
		}

		const createGroupMode = !!designNetCreateGroupEl?.checked || design.groups.length === 0;
		let targetGroup = null;
		let pendingNewGroup = null;
		if (createGroupMode) {
			const gid = String(designNetNewGroupIdEl?.value ?? "").trim();
			if (!gid) throw new Error("New Group ID is required.");

			const exists = design.groups.some((g) => String(g?.gid ?? "") === gid);
			if (exists) throw new Error(`Group ID "${gid}" already exists.`);

			const gname = String(designNetNewGroupNameEl?.value ?? "").trim() || gid;
			const gcolor = String(designNetNewGroupColorEl?.value ?? "#66ccff");
			pendingNewGroup = new Group({
				name : gname,
				gid,
				nets : [],
				state : Tristate.ON,
				color : gcolor,
				meta : {},
			});
			targetGroup = pendingNewGroup;
		} else {
			const gid = String(designNetGroupSelectEl?.value ?? "").trim();
			if (!gid) throw new Error("Target Group is required.");
			targetGroup = design.groups.find((g) => String(g?.gid ?? "") === gid) ?? null;
			if (!targetGroup) throw new Error(`Group "${gid}" was not found.`);
		}

		const startNode = parseDesignToolNodeSpec(designNetStartSpecEl?.value, "Start node");
		const endNode = parseDesignToolNodeSpec(designNetEndSpecEl?.value, "End node");
		const startRadius = parseDesignToolOptionalRadius(designNetStartRadiusEl?.value, "Start radius");
		const endRadius = parseDesignToolOptionalRadius(designNetEndRadiusEl?.value, "End radius");
		applyDesignToolNodeRadius(startNode, startRadius, "Start radius");
		applyDesignToolNodeRadius(endNode, endRadius, "End radius");
		validateDesignToolNodeInBounds(design, startNode, "Start node");
		validateDesignToolNodeInBounds(design, endNode, "End node");

		const pathNodes = parseDesignToolPathNodes(designNetPathInputEl?.value);
		for (let i = 0; i < pathNodes.length; i++) {
			validateDesignToolNodeInBounds(design, pathNodes[i], `Path node ${i + 1}`);
		}

		const allNodes = [startNode, ...pathNodes, endNode];
		const viaNodes = collectUniqueViaNodes(allNodes);
		const netName = String(designNetNameEl?.value ?? "").trim() || nid;
		const enabled = !!designNetEnabledEl?.checked;
		const net = new Net({
			name : netName,
			nid,
			gid : String(targetGroup.gid),
			start : startNode,
			end : endNode,
			enabled,
			path : (pathNodes.length > 0) ? pathNodes : null,
			vias : viaNodes,
			pathLen : null,
			bendCount : 0,
			meta : {},
		});

		let committedGroup = false;
		let committedNet = false;
		try {
			if (pendingNewGroup) {
				design.groups.push(pendingNewGroup);
				ensureGroupUiState(ctx)?.expandedGroups?.add?.(pendingNewGroup.gid);
				committedGroup = true;
			}

			targetGroup.nets.push(net);
			committedNet = true;

			refreshGroupState(targetGroup);
			refreshNetRouteMetrics(design, net);
			refreshDesignRouteMetrics(design);
			reapplyActiveDesignVisibility();
			renderGroupTree();
			if (createGroupMode && designNetCreateGroupEl) designNetCreateGroupEl.checked = false;
			syncDesignNetBuilderUi();
			if (designNetGroupSelectEl) designNetGroupSelectEl.value = String(targetGroup.gid);
			selectNetByNid(null);
			setDesignNetCreateMessage(`Net "${nid}" created in group "${targetGroup.gid}".`);
		} catch (commitErr) {
			if (committedNet) {
				const netIdx = targetGroup.nets.lastIndexOf(net);
				if (netIdx >= 0) targetGroup.nets.splice(netIdx, 1);
			}
			if (committedGroup && pendingNewGroup) {
				const groupIdx = design.groups.lastIndexOf(pendingNewGroup);
				if (groupIdx >= 0) design.groups.splice(groupIdx, 1);
				ensureGroupUiState(ctx)?.expandedGroups?.delete?.(pendingNewGroup.gid);
			}
			throw commitErr;
		}

		if (designNetIdEl) designNetIdEl.value = "";
		if (designNetNameEl) designNetNameEl.value = "";
		if (designNetPathInputEl) designNetPathInputEl.value = "";
		designNetIdEl?.focus?.();
		return true;
	} catch (err) {
		const message = err?.message ? String(err.message) : "Failed to create net.";
		setDesignNetCreateMessage(message, true);
		return false;
	}
}

function getManualRouteDefaultStatusText() {
	if (!manualRouteState.enabled) return "Mode Off. Enable Manual Routing to edit.";
	if (!manualRouteState.pending) return "Click a route endpoint in Layer Top view.";
	const p = manualRouteState.pending;
	return `Endpoint selected: ${p.nid} @ (${p.x}, ${p.y}, L${p.layer}). Click one of 8 neighboring valid points.`;
}

function syncManualRouteUi() {
	const hasDesign = !!scenes.get(activeSceneId)?.design;
	if (manualRouteModeEl) {
		manualRouteModeEl.checked = !!manualRouteState.enabled;
		manualRouteModeEl.disabled = !hasDesign;
	}
	if (designModeSelectBtnEl) {
		const selectActive = !manualRouteState.enabled;
		designModeSelectBtnEl.disabled = !hasDesign;
		designModeSelectBtnEl.classList.toggle("active", selectActive);
		designModeSelectBtnEl.setAttribute("aria-pressed", String(selectActive));
	}
	if (designModeRouteBtnEl) {
		const routeActive = !!manualRouteState.enabled;
		designModeRouteBtnEl.disabled = !hasDesign;
		designModeRouteBtnEl.classList.toggle("active", routeActive);
		designModeRouteBtnEl.setAttribute("aria-pressed", String(routeActive));
	}
	if (manualRouteCancelBtnEl) {
		manualRouteCancelBtnEl.disabled = !manualRouteState.enabled || !hasDesign;
	}
	if (manualRouteStatusEl) {
		const custom = String(manualRouteState.statusMessage ?? "").trim();
		manualRouteStatusEl.textContent = custom || getManualRouteDefaultStatusText();
	}
}

function setManualRouteStatus(message = "") {
	manualRouteState.statusMessage = String(message ?? "");
	syncManualRouteUi();
}

function clearManualRoutePending(statusMessage = "") {
	manualRouteState.pending = null;
	setManualRouteStatus(statusMessage);
}

function setManualRouteEnabled(enabled) {
	manualRouteState.enabled = !!enabled;
	if (manualRouteState.enabled) {
		selectNetByNid(null);
		setManualRouteStatus("");
		return;
	}
	clearManualRoutePending("");
}

function findManualRouteEndpointAtGridPoint(ctx, layer, x, y) {
	const design = ctx?.design;
	if (!design) return null;
	const preferredNid = selectedNetNid ? String(selectedNetNid) : null;
	let preferred = null;
	let fallback = null;

	const pushCandidate = (candidate) => {
		if (!candidate) return;
		if (!fallback) fallback = candidate;
		if (preferredNid && String(candidate.net?.nid) === preferredNid && !preferred) preferred = candidate;
	};

	for (const g of (design.groups ?? [])) {
		for (const n of (g.nets ?? [])) {
			if (!n?.enabled) continue;

			const br = getNetManualRouteBreakMeta(n);
			const tipStart = getNetRoutingTipNode(n, "start");
			const tipEnd = getNetRoutingTipNode(n, "end");
			const startAnchor = br ? tipStart : n.start;
			const endAnchor = br ? tipEnd : n.end;
			const startConnected =
				!!tipStart &&
				!!n.start &&
				!isNodeAtGridPoint(tipStart, Number(n.start.layer), Number(n.start.x), Number(n.start.y));
			const endConnected =
				!!tipEnd &&
				!!n.end &&
				!isNodeAtGridPoint(tipEnd, Number(n.end.layer), Number(n.end.x), Number(n.end.y));
			// Once an endpoint side is already connected, that fixed start/end point should not be selectable again.
			const hitStartEndpoint = !startConnected && isNodeAtGridPoint(n.start, layer, x, y);
			const hitEndEndpoint = !endConnected && isNodeAtGridPoint(n.end, layer, x, y);
			const hitStartTip = !!br && isNodeAtGridPoint(tipStart, layer, x, y);
			const hitEndTip = !!br && isNodeAtGridPoint(tipEnd, layer, x, y);
			const hitStart = hitStartEndpoint || hitStartTip;
			const hitEnd = hitEndEndpoint || hitEndTip;

			if (hitStart && startAnchor) {
				pushCandidate({
					group : g,
					net : n,
					side : "start",
					anchor : {
						layer : Number(startAnchor.layer),
						x : Number(startAnchor.x),
						y : Number(startAnchor.y),
					},
				});
			}
			if (hitEnd && endAnchor) {
				pushCandidate({
					group : g,
					net : n,
					side : "end",
					anchor : {
						layer : Number(endAnchor.layer),
						x : Number(endAnchor.x),
						y : Number(endAnchor.y),
					},
				});
			}
		}
	}

	return preferred ?? fallback;
}

function beginManualRouteFromEndpoint(endpoint) {
	if (!endpoint?.net || !endpoint?.side || !endpoint?.anchor) {
		clearManualRoutePending("Endpoint is invalid.");
		return false;
	}

	manualRouteState.pending = {
		nid : String(endpoint.net.nid),
		side : endpoint.side,
		layer : Number(endpoint.anchor.layer),
		x : Number(endpoint.anchor.x),
		y : Number(endpoint.anchor.y),
	};
	const breakChanged = setNetManualRouteBreakMeta(endpoint.net, manualRouteState.pending);
	if (breakChanged) reapplyActiveDesignVisibility();
	setManualRouteStatus("");
	return true;
}

function applyManualRouteStep(ctx, targetLayer, targetX, targetY) {
	const pending = manualRouteState.pending;
	if (!pending) return false;
	const found = findNetByNid(ctx, pending.nid);
	if (!found?.net?.enabled) {
		clearManualRoutePending("Selected route is unavailable.");
		return false;
	}

	const net = found.net;
	const routeState = buildManualRouteNetState(net);
	const tipIndex = resolveManualRoutePendingFullIndex(routeState, pending);
	if (tipIndex === null) {
		clearManualRoutePending("Could not resolve route endpoint.");
		return false;
	}

	const validateTarget = createManualRouteStepValidator(ctx, net, pending, routeState);
	if (typeof validateTarget !== "function") {
		clearManualRoutePending("Could not resolve route endpoint.");
		return false;
	}

	const toLayer = Number(targetLayer);
	const toX = Number(targetX);
	const toY = Number(targetY);
	const verdict = validateTarget(toLayer, toX, toY);
	if (!verdict?.ok) {
		setManualRouteStatus(verdict?.reason || "Target point is invalid.");
		return false;
	}

	const points = Array.isArray(routeState.points) ? routeState.points.slice() : [];
	if (points.length < 2 || tipIndex < 0 || tipIndex >= points.length) {
		clearManualRoutePending("Could not resolve route endpoint.");
		return false;
	}

	if (verdict.complete && Number.isFinite(verdict.oppositeIndex)) {
		const oppositeIndex = Number(verdict.oppositeIndex);
		let merged = null;
		if (pending.side === "start") {
			if (oppositeIndex <= tipIndex || oppositeIndex >= points.length) {
				setManualRouteStatus("Could not resolve opposite-side route state.");
				return false;
			}
			merged = [...points.slice(0, tipIndex + 1), ...points.slice(oppositeIndex)];
		} else {
			if (oppositeIndex < 0 || oppositeIndex >= tipIndex) {
				setManualRouteStatus("Could not resolve opposite-side route state.");
				return false;
			}
			merged = [...points.slice(0, oppositeIndex + 1), ...points.slice(tipIndex)];
		}
		setNetPathFromFullPoints(net, merged);
		clearNetManualRouteBreakMeta(net);
		manualRouteState.pending = null;
		refreshNetRouteMetrics(ctx.design, net);
		refreshDesignRouteMetrics(ctx.design);
		reapplyActiveDesignVisibility();
		setManualRouteStatus(`Route completed for net "${net.nid}". Click a route endpoint to continue editing.`);
		return true;
	}

	const insertIndex = (pending.side === "start") ? (tipIndex + 1) : tipIndex;
	const newNode = new Node({
		type : NodeType.GRID,
		x : toX,
		y : toY,
		layer : toLayer,
		meta : {},
	});
	points.splice(insertIndex, 0, newNode);
	setNetPathFromFullPoints(net, points);

	manualRouteState.pending = {
		nid : String(net.nid),
		side : pending.side,
		layer : Number(toLayer),
		x : Number(toX),
		y : Number(toY),
	};
	setNetManualRouteBreakMeta(net, manualRouteState.pending);

	refreshNetRouteMetrics(ctx.design, net);
	refreshDesignRouteMetrics(ctx.design);
	reapplyActiveDesignVisibility();

	setManualRouteStatus(`Connected to (${toX}, ${toY}, L${toLayer}). Click another neighboring valid point, or clear selection.`);
	return true;
}

function tryHandleManualRouteClick(clientX, clientY) {
	if (!manualRouteState.enabled) return false;
	const ctx = scenes.get(activeSceneId);
	if (!ctx?.design) {
		setManualRouteStatus("Load a design before manual routing.");
		return true;
	}
	if (!camera?.isOrthographicCamera) {
		setManualRouteStatus("Manual routing works in Layer Top camera.");
		return true;
	}

	const minPitch = snapTopGridClientPointToWorld(camera, clientX, clientY, topGridPickWorld, null, topGridPickNode);
	if (!(minPitch > 0)) {
		setManualRouteStatus("Could not resolve a grid point from this click.");
		return true;
	}

	if (!manualRouteState.pending) {
		const endpoint = findManualRouteEndpointAtGridPoint(ctx, topGridPickNode.layer, topGridPickNode.x, topGridPickNode.y);
		if (!endpoint) {
			setManualRouteStatus("No route endpoint at this point. Click a route endpoint first.");
			return true;
		}
		beginManualRouteFromEndpoint(endpoint);
		return true;
	}

	applyManualRouteStep(ctx, topGridPickNode.layer, topGridPickNode.x, topGridPickNode.y);
	return true;
}

function computeNetFocusData(ctx, nid) {
	if (!ctx?.design || !nid) return null;
	const found = findNetByNid(ctx, nid);
	if (!found?.net?.enabled) return null;
	if (!found?.net || typeof found.net.points !== "function") return null;
	const points = found.net.points();
	if (!Array.isArray(points) || points.length === 0) return null;

	const design = ctx.design;
	const dx = Number(design.dx) || 1;
	const dy = Number(design.dy) || 1;
	const layerGap = Number(design.layerGap ?? design?.meta?.layerGap) || Math.max(dx, dy);
	const x0 = (design.nx - 1) * dx * 0.5;
	const y0 = (design.ny - 1) * dy * 0.5;
	const toWX = (n) => ((Number(n?.x) || 0) * dx) - x0;
	const toWY = (n) => ((Number(n?.y) || 0) * dy) - y0;
	const toWZ = (n) => ((Number(n?.layer) || 0) * layerGap);

	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let minZ = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	let maxZ = Number.NEGATIVE_INFINITY;

	const layers = [...new Set(points.map((p) => p.layer | 0))].sort((a, b) => a - b);
	let focusLayer = layers[0] ?? 0;
	const activeLayer = Number(ctx?.view?.activeLayer);
	if (layers.length > 1 && Number.isFinite(activeLayer)) {
		let best = focusLayer;
		let bestDist = Math.abs(best - activeLayer);
		for (const L of layers) {
			const d = Math.abs(L - activeLayer);
			if (d < bestDist) {
				best = L;
				bestDist = d;
			}
		}
		focusLayer = best;
	}

	for (const p of points) {
		const wx = toWX(p);
		const wy = toWY(p);
		const wz = toWZ(p);
		if (wx < minX) minX = wx;
		if (wy < minY) minY = wy;
		if (wz < minZ) minZ = wz;
		if (wx > maxX) maxX = wx;
		if (wy > maxY) maxY = wy;
		if (wz > maxZ) maxZ = wz;
	}

	netFocusMainCenter.set(
		(minX + maxX) * 0.5,
		(minY + maxY) * 0.5,
		(minZ + maxZ) * 0.5,
	);

	let topMinX = Number.POSITIVE_INFINITY;
	let topMinY = Number.POSITIVE_INFINITY;
	let topMaxX = Number.NEGATIVE_INFINITY;
	let topMaxY = Number.NEGATIVE_INFINITY;
	let topCount = 0;
	for (const p of points) {
		if ((p.layer | 0) !== focusLayer) continue;
		const wx = toWX(p);
		const wy = toWY(p);
		if (wx < topMinX) topMinX = wx;
		if (wy < topMinY) topMinY = wy;
		if (wx > topMaxX) topMaxX = wx;
		if (wy > topMaxY) topMaxY = wy;
		topCount += 1;
	}
	if (topCount > 0) {
		netFocusTopCenter.set(
			(topMinX + topMaxX) * 0.5,
			(topMinY + topMaxY) * 0.5,
			focusLayer * layerGap,
		);
	}
	else {
		netFocusTopCenter.set(netFocusMainCenter.x, netFocusMainCenter.y, focusLayer * layerGap);
	}

	const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
	return { centerMain : netFocusMainCenter.clone(), centerTop : netFocusTopCenter.clone(), focusLayer, span };
}

function focusCameraOnNetByNid(nid) {
	const ctx = scenes.get(activeSceneId);
	const focus = computeNetFocusData(ctx, nid);
	if (!ctx || !focus) return false;

	if (camera.isOrthographicCamera) {
		const design = ctx.design;
		if (!design) return false;
		const L = Math.max(0, Math.min(focus.focusLayer | 0, design.nlayer - 1));
		const desiredZoom = topviewcamera.zoom;
		const desiredMinZoom = topviewControls.minZoom;
		const desiredMaxZoom = topviewControls.maxZoom;

		if ((ctx.view?.active ?? "persp") !== "ortho" || ((ctx.view?.activeLayer ?? -1) | 0) !== L) {
			switchToLayerCamera(L);
		}

		netFocusTopOffset.subVectors(topviewcamera.position, topviewControls.target);
		if (netFocusTopOffset.lengthSq() <= 1e-9) {
			const st = makeDefaultLayerTopState(design, L);
			netFocusTopOffset.set(
				st.pos[0] - st.target[0],
				st.pos[1] - st.target[1],
				st.pos[2] - st.target[2],
			);
		}

		netFocusTopTarget.copy(focus.centerTop);
		netFocusTopPosition.copy(netFocusTopTarget).add(netFocusTopOffset);

		topviewMover.moveTo({
			toPosition : netFocusTopPosition.clone(),
			toTarget : netFocusTopTarget.clone(),
			toZoom : desiredZoom,
			minZoom : desiredMinZoom,
			maxZoom : desiredMaxZoom,
		});
		return true;
	}

	netFocusMainDir.subVectors(maincamera.position, mainControls.target);
	if (netFocusMainDir.lengthSq() <= 1e-9) netFocusMainDir.set(1, 1, 1);
	const dirLen = netFocusMainDir.length();
	netFocusMainDir.normalize();

	const fallbackScale =
		Number(ctx?.design?.layerGap) ||
		Number(activeScene?.userData?.designRoot?.userData?.gridPitch) ||
		1;
	const minDist = Math.max(2, fallbackScale * 4, focus.span * 2.2);
	const dist = Math.max(minDist, dirLen);
	const toTarget = focus.centerMain.clone();
	const toPosition = toTarget.clone().addScaledVector(netFocusMainDir, dist);

	mainControls.maxDistance = Math.max(mainControls.maxDistance, dist * 1.5);
	perspMover.moveTo({ toPosition, toTarget, center : toTarget.clone() });
	return true;
}

function selectNetByNid(nid, { openInspectTab = true } = {}) {
	if (!nid) {
		selectedNetNid = null;
		clearNetHighlight();
		setNetInfoPanelContent(null);
		return false;
	}
	const ctx = scenes.get(activeSceneId);
	const found = findNetByNid(ctx, nid);
	if (!found?.net?.enabled) {
		selectedNetNid = null;
		clearNetHighlight();
		setNetInfoPanelContent(null);
		return false;
	}
	selectedNetNid = String(nid);
	const ok = applyNetHighlight(selectedNetNid);
	if (!ok) {
		selectedNetNid = null;
		setNetInfoPanelContent(null);
		return false;
	}
	setNetInfoPanelContent(getNetInfoByNid(ctx, selectedNetNid));
	if (openInspectTab) sidePanels?.right?.setActiveTab?.("inspect", { expand : true });
	return true;
}

function focusAndSelectNetByIndex(gIdx, nIdx) {
	const ctx = scenes.get(activeSceneId);
	const design = ctx?.design;
	if (!ctx || !design) return;
	if (!Number.isFinite(gIdx) || !Number.isFinite(nIdx)) return;
	if (gIdx < 0 || gIdx >= design.groups.length) return;
	const group = design.groups[gIdx];
	if (!group || nIdx < 0 || nIdx >= group.nets.length) return;
	const net = group.nets[nIdx];
	if (!net || !net.enabled) return;

	selectNetByNid(net.nid);
	focusCameraOnNetByNid(net.nid);
}

function selectNearestNetAtClientPoint(clientX, clientY) {
	if (manualRouteState.enabled) return;
	const nid = pickNearestNetFromClick(clientX, clientY);
	selectNetByNid(nid);
}

function syncSelectedNetForActiveScene() {
	if (!selectedNetNid) {
		clearNetHighlight();
		setNetInfoPanelContent(null);
		return;
	}
	const ok = applyNetHighlight(selectedNetNid);
	if (!ok) {
		selectedNetNid = null;
		setNetInfoPanelContent(null);
		return;
	}
	const ctx = scenes.get(activeSceneId);
	setNetInfoPanelContent(getNetInfoByNid(ctx, selectedNetNid));
}

function isDeleteConfirmModalOpen() {
	return !!deleteConfirmModalEl && !deleteConfirmModalEl.hidden;
}

function closeDeleteConfirmModal() {
	if (!deleteConfirmModalEl) return;
	deleteConfirmModalEl.hidden = true;
	deleteConfirmModalEl.setAttribute("aria-hidden", "true");
	deleteConfirmState.pending = null;
	if (deleteConfirmMessageEl) {
		deleteConfirmMessageEl.textContent = "";
	}
}

function openDeleteConfirmModal(pending) {
	if (!deleteConfirmModalEl || !pending) return false;
	deleteConfirmState.pending = pending;
	if (deleteConfirmTitleEl) {
		deleteConfirmTitleEl.textContent = pending.title || "Confirm Delete";
	}
	if (deleteConfirmMessageEl) {
		deleteConfirmMessageEl.textContent = pending.message || "Are you sure you want to delete this item?";
	}
	deleteConfirmModalEl.hidden = false;
	deleteConfirmModalEl.setAttribute("aria-hidden", "false");
	deleteConfirmConfirmBtnEl?.focus?.();
	return true;
}

function removeGroupAtIndex(gIdx) {
	const ctx = scenes.get(activeSceneId);
	const design = ctx?.design;
	if (!ctx || !design || !Array.isArray(design.groups)) return false;
	if (!Number.isFinite(gIdx) || gIdx < 0 || gIdx >= design.groups.length) return false;

	const group = design.groups[gIdx];
	const gid = String(group?.gid ?? "");
	const removedNids = new Set((group?.nets ?? []).map((n) => String(n?.nid ?? "")));

	design.groups.splice(gIdx, 1);
	if (gid) ensureGroupUiState(ctx)?.expandedGroups?.delete?.(gid);

	if (selectedNetNid && removedNids.has(String(selectedNetNid))) {
		selectedNetNid = null;
	}
	if (manualRouteState.pending && removedNids.has(String(manualRouteState.pending.nid ?? ""))) {
		clearManualRoutePending("Endpoint cleared because the net was deleted.");
	}

	refreshDesignRouteMetrics(design);
	reapplyActiveDesignVisibility();
	renderGroupTree();
	syncDesignNetBuilderUi();
	return true;
}

function removeNetAtIndex(gIdx, nIdx) {
	const ctx = scenes.get(activeSceneId);
	const design = ctx?.design;
	if (!ctx || !design || !Array.isArray(design.groups)) return false;
	if (!Number.isFinite(gIdx) || !Number.isFinite(nIdx)) return false;
	if (gIdx < 0 || gIdx >= design.groups.length) return false;

	const group = design.groups[gIdx];
	if (!group || !Array.isArray(group.nets)) return false;
	if (nIdx < 0 || nIdx >= group.nets.length) return false;

	const removedNet = group.nets[nIdx];
	const removedNid = String(removedNet?.nid ?? "");
	group.nets.splice(nIdx, 1);
	refreshGroupState(group);

	if (selectedNetNid && String(selectedNetNid) === removedNid) {
		selectedNetNid = null;
	}
	if (manualRouteState.pending && String(manualRouteState.pending.nid ?? "") === removedNid) {
		clearManualRoutePending("Endpoint cleared because the net was deleted.");
	}

	refreshDesignRouteMetrics(design);
	reapplyActiveDesignVisibility();
	renderGroupTree();
	syncDesignNetBuilderUi();
	return true;
}

function runDeleteConfirmAction() {
	const pending = deleteConfirmState.pending;
	if (!pending) return false;

	let ok = false;
	if (pending.kind === "group") {
		ok = removeGroupAtIndex(Number(pending.gIdx));
	} else if (pending.kind === "net") {
		ok = removeNetAtIndex(Number(pending.gIdx), Number(pending.nIdx));
	}

	closeDeleteConfirmModal();
	return ok;
}

function ensureGroupUiState(ctx) {
	if (!ctx) return null;
	if (!ctx.ui) ctx.ui = {};
	if (!ctx.ui.expandedGroups) {
		// Note.
		ctx.ui.expandedGroups = new Set();
	}
	return ctx.ui;
}

function refreshGroupState(group) {
	const flags = (group?.nets ?? []).map((n) => !!n.enabled);
	if (flags.length === 0) {
		group.state = "off";
		return;
	}
	if (flags.every(Boolean)) group.state = "on";
	else if (flags.some(Boolean)) group.state = "partial";
	else group.state = "off";
}

function reapplyActiveDesignVisibility() {
	const ctx = scenes.get(activeSceneId);
	if (!ctx?.design) return;

	// Note.
	const preservedView = captureViewState();
	ctx.view = preservedView;

	applyDesignToScene(ctx.scene, ctx.design, getDesignRenderOpts(ctx));
	syncSelectedNetForActiveScene();
	syncAxisLengthForCtx(ctx);
	syncCameraClipPlanesForCtx(ctx);
	applyViewState(preservedView);
}

function renderGroupTree() {
	if (!groupTreeEl) return;

	const ctx = scenes.get(activeSceneId);
	const design = ctx?.design;

	groupTreeEl.innerHTML = "";

	if (!design || !Array.isArray(design.groups) || design.groups.length === 0) {
		const empty = document.createElement("div");
		empty.className = "group-tree-empty";
		empty.textContent = "Load a design to show the group/net visibility tree.";
		groupTreeEl.appendChild(empty);
		return;
	}

	const ui = ensureGroupUiState(ctx);

	design.groups.forEach((group, gIdx) => {
		refreshGroupState(group);
		const open = ui.expandedGroups.has(group.gid);

		const gWrap = document.createElement("div");
		const gRow = document.createElement("div");
		gRow.className = "group-row";

		const exp = document.createElement("button");
		exp.type = "button";
		exp.className = "group-expand";
		exp.dataset.role = "group-expand";
		exp.dataset.gidx = String(gIdx);
		exp.textContent = open ? "v" : ">";
		exp.title = open ? "Collapse" : "Expand";
		const chk = document.createElement("input");
		chk.type = "checkbox";
		chk.className = "group-check";
		chk.dataset.role = "group-check";
		chk.dataset.gidx = String(gIdx);
		chk.checked = (group.state === "on");
		chk.indeterminate = (group.state === "partial");

		const label = document.createElement("span");
		label.className = "group-label";
		label.textContent = `${group.name ?? group.gid} (${group.nets.length})`;
		const gDelete = document.createElement("button");
		gDelete.type = "button";
		gDelete.className = "tree-delete-btn";
		gDelete.dataset.role = "group-delete";
		gDelete.dataset.gidx = String(gIdx);
		gDelete.textContent = "Delete";
		gDelete.title = "Delete this group and all nets in it";

		gRow.append(exp, chk, label, gDelete);
		gWrap.appendChild(gRow);

		if (open) {
			const children = document.createElement("div");
			children.className = "group-children";
			group.nets.forEach((net, nIdx) => {
				const nRow = document.createElement("div");
				nRow.className = "net-row";
				const nChk = document.createElement("input");
				nChk.type = "checkbox";
				nChk.className = "net-check";
				nChk.dataset.role = "net-check";
				nChk.dataset.gidx = String(gIdx);
				nChk.dataset.nidx = String(nIdx);
				nChk.checked = !!net.enabled;
				const nLabel = document.createElement("span");
				nLabel.className = "net-label";
				nLabel.textContent = net.name ?? net.nid;
				const nFocus = document.createElement("button");
				nFocus.type = "button";
				nFocus.className = "net-focus-btn";
				nFocus.dataset.role = "net-focus";
				nFocus.dataset.gidx = String(gIdx);
				nFocus.dataset.nidx = String(nIdx);
				nFocus.textContent = "Focus";
				nFocus.title = "Focus camera on this net and select it";
				nFocus.disabled = !net.enabled;
				const nDelete = document.createElement("button");
				nDelete.type = "button";
				nDelete.className = "tree-delete-btn";
				nDelete.dataset.role = "net-delete";
				nDelete.dataset.gidx = String(gIdx);
				nDelete.dataset.nidx = String(nIdx);
				nDelete.textContent = "Delete";
				nDelete.title = "Delete this net";
				nRow.append(nChk, nLabel, nFocus, nDelete);
				children.appendChild(nRow);
			});
			gWrap.appendChild(children);
		}

		groupTreeEl.appendChild(gWrap);
	});
}

function renderCameraButtons() {
	if (!cameraButtonsEl) return;

	const ctx = scenes.get(activeSceneId);
	const design = ctx?.design ?? null;

	cameraButtonsEl.innerHTML = "";

	// 1) Main(Persp)
	{
		const b = document.createElement("button");
		b.className = "camera-btn camera-btn-main" + ((ctx?.view?.active ?? "persp") === "persp" ? " active" : "");
		b.dataset.cam = "main";
		b.textContent = "Main (Persp)";
		cameraButtonsEl.appendChild(b);
	}

	// Note.
	if (design) {
		for (let L = 0; L < design.nlayer; L++) {
			const b = document.createElement("button");
			const isActive = (ctx.view.active === "ortho" && (ctx.view.activeLayer | 0) === L);
			b.className = "camera-btn camera-btn-layer" + (isActive ? " active" : "");
			b.dataset.cam = "layer";
			b.dataset.layer = String(L);
			b.textContent = `Layer ${L} (Top)`;
			cameraButtonsEl.appendChild(b);
		}
	}
}

function switchToMainCamera() {
	const ctx = scenes.get(activeSceneId);
	if (!ctx) return;

	// Note.

	// Note.
	ctx.view.active = "persp";
	applyViewState(ctx.view);
	renderCameraButtons();
}

function switchToLayerCamera(layerIndex) {
	const ctx = scenes.get(activeSceneId);
	const design = ctx?.design;
	if (!ctx || !design) return;

	// Note.
	ctx.view = captureViewState();

	const L = Math.max(0, Math.min(layerIndex | 0, design.nlayer - 1));

	// Note.
	ctx.view.active = "ortho";
	ctx.view.activeLayer = L;

	// Note.
	if (!Array.isArray(ctx.view.layers) || ctx.view.layers.length !== design.nlayer) {
		const init = makeInitialViewForCtx(design);
		ctx.view.layers = init.layers;
	}

	applyViewState(ctx.view);
	renderCameraButtons();
}

if (cameraButtonsEl) {
	cameraButtonsEl.addEventListener("click", (e) => {
		const btn = e.target?.closest?.("button");
		if (!btn) return;

		const cam = btn.dataset.cam;
		if (cam === "main") {
			switchToMainCamera();
			return;
		}
		if (cam === "layer") {
			switchToLayerCamera(Number(btn.dataset.layer));
			return;
		}
	});
}

if (cameraResetBtnEl) {
	cameraResetBtnEl.addEventListener("click", () => {
		resetActiveCameraView();
	});
}

if (manualRouteModeEl) {
	manualRouteModeEl.addEventListener("change", () => {
		setManualRouteEnabled(manualRouteModeEl.checked);
	});
}

if (designModeSelectBtnEl) {
	designModeSelectBtnEl.addEventListener("click", () => {
		setManualRouteEnabled(false);
	});
}

if (designModeRouteBtnEl) {
	designModeRouteBtnEl.addEventListener("click", () => {
		setManualRouteEnabled(true);
	});
}

if (manualRouteCancelBtnEl) {
	manualRouteCancelBtnEl.addEventListener("click", () => {
		clearManualRoutePending("Selection cleared. Click a route endpoint in Layer Top view.");
	});
}

if (designNetCreateGroupEl) {
	designNetCreateGroupEl.addEventListener("change", () => {
		syncDesignNetBuilderUi();
	});
}

if (designNetCreateBtnEl) {
	designNetCreateBtnEl.addEventListener("click", () => {
		createNetFromDesignTool();
	});
}

if (designNetOpenBtnEl) {
	designNetOpenBtnEl.addEventListener("click", () => {
		openDesignNetModal();
	});
}

if (designNetCloseBtnEl) {
	designNetCloseBtnEl.addEventListener("click", () => {
		closeDesignNetModal();
	});
}

if (designNetCancelBtnEl) {
	designNetCancelBtnEl.addEventListener("click", () => {
		closeDesignNetModal();
	});
}

if (designNetModalEl) {
	designNetModalEl.addEventListener("click", (e) => {
		const closeRole = e.target?.closest?.("[data-role=\"design-net-close\"]");
		if (!closeRole) return;
		closeDesignNetModal();
	});
}

if (deleteConfirmCloseBtnEl) {
	deleteConfirmCloseBtnEl.addEventListener("click", () => {
		closeDeleteConfirmModal();
	});
}

if (deleteConfirmCancelBtnEl) {
	deleteConfirmCancelBtnEl.addEventListener("click", () => {
		closeDeleteConfirmModal();
	});
}

if (deleteConfirmConfirmBtnEl) {
	deleteConfirmConfirmBtnEl.addEventListener("click", () => {
		runDeleteConfirmAction();
	});
}

if (deleteConfirmModalEl) {
	deleteConfirmModalEl.addEventListener("click", (e) => {
		const closeRole = e.target?.closest?.("[data-role=\"delete-confirm-close\"]");
		if (!closeRole) return;
		closeDeleteConfirmModal();
	});
}

window.addEventListener("keydown", (e) => {
	if (e.key !== "Escape") return;
	if (isDeleteConfirmModalOpen()) {
		e.preventDefault();
		closeDeleteConfirmModal();
		return;
	}
	if (!isDesignNetModalOpen()) return;
	e.preventDefault();
	closeDesignNetModal();
});

for (const el of [
	designNetGroupSelectEl,
	designNetNewGroupIdEl,
	designNetNewGroupNameEl,
	designNetNewGroupColorEl,
	designNetIdEl,
	designNetNameEl,
	designNetEnabledEl,
	designNetStartSpecEl,
	designNetStartRadiusEl,
	designNetEndSpecEl,
	designNetEndRadiusEl,
	designNetPathInputEl,
]) {
	if (!el) continue;
	const ev = (el.tagName === "SELECT" || el.type === "checkbox" || el.type === "color") ? "change" : "input";
	el.addEventListener(ev, () => {
		if (!scenes.get(activeSceneId)?.design) return;
		setDesignNetCreateMessage("");
	});
}

initScenes();
renderSceneList();
renderCameraButtons();
renderGroupTree();
syncLayerStyleControls();
syncManualRouteUi();
syncDesignNetBuilderUi();

function getScenesForUI() {
	const arr = [];
	for (const [id, ctx] of scenes.entries()) {
		const subtitle = ctx.isDefault
			? "Default Scene"
			: (ctx.fileMeta?.name ?? "");
		arr.push({
			id,
			title: ctx.title ?? id,
			subtitle : (ctx.isDefault ? "Default Scene" : subtitle),
			isDefault: !!ctx.isDefault,
		});
	}
	
	arr.sort((a, b) => (a.isDefault === b.isDefault ? 0 : (a.isDefault ? -1 : 1)));
	return arr;
}

function renderSceneList() {
	if (!dataUI?.render) return;
	dataUI.render({ scenes: getScenesForUI(), activeId: activeSceneId });
}

function disposeMaterial(mat) {
	if (!mat) return;

	// Note.
	for (const k in mat) {
		const v = mat[k];
		if (v && typeof v === "object" && v.isTexture) {
			v.dispose();
		}
	}
	mat.dispose();
}

function disposeObject3D(root) {
	if (!root) return;

	root.traverse((obj) => {
		if (obj.geometry) {
			obj.geometry.dispose();
		}

		if (obj.material) {
			if (Array.isArray(obj.material)) {
				for (const m of obj.material) disposeMaterial(m);
			} else {
				disposeMaterial(obj.material);
			}
		}
	});
}

function disposeSceneGraph(scene) {
	if (!scene) return;

	// Note.
	if (scene.userData?.designRoot) {
		scene.userData.designRoot = null;
	}

	disposeObject3D(scene);

	// Note.
	scene.userData = {};
}

function removeScene(id) {
	if (id === DEFAULT_SCENE_ID) return;

	const ctx = scenes.get(id);
	if (!ctx) return;

	const deletingActive = (id === activeSceneId);

	// Note.
	scenes.delete(id);

	// Note.
	if (deletingActive) {
		setActiveSceneById(DEFAULT_SCENE_ID);
	} else {
		renderSceneList();
		renderGroupTree();
		syncLayerStyleControls();
	}

	// Note.
	disposeSceneGraph(ctx.scene);

	// Note.
	if (renderer.renderLists?.dispose) renderer.renderLists.dispose();
	else {
		renderCameraButtons();
		renderGroupTree();
	}
}

/* Section. */
function onResize() {
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER_PIXEL_RATIO_CAP));
	
	const aspect = window.innerWidth / window.innerHeight;
	
	if (camera.isPerspectiveCamera) {
		camera.aspect = aspect;
		camera.updateProjectionMatrix();
	}
	else if (camera.isOrthographicCamera) {
		camera.left = -(frustumSize * aspect) / 2;
		camera.right = (frustumSize * aspect) / 2;
		camera.top = frustumSize / 2;
		camera.bottom = -frustumSize / 2;
		camera.updateProjectionMatrix();
	}

	const ctx = scenes.get(activeSceneId);
	if (ctx) syncCameraClipPlanesForCtx(ctx);
}
window.addEventListener('resize', onResize);

function computeRectRangeForCtx(ctx) {
	const design = ctx?.design;
	if (design) {
		const w = (design.nx - 1) * design.dx;
		const h = (design.ny - 1) * design.dy;
		return Math.max(1, w, h);
	}

	const root = ctx?.scene?.userData?.designRoot;
	if (root) {
		const box = new THREE.Box3().setFromObject(root);
		if (box.isEmpty()) return 10;
		return Math.max(1, box.max.x - box.min.x, box.max.y - box.min.y);
	}

	return 10;
}

function computeLongestBoxEdgeForCtx(ctx) {
	const design = ctx?.design;
	if (design) {
		const w = (design.nx - 1) * design.dx;
		const h = (design.ny - 1) * design.dy;
		const layerGap = design.layerGap ?? design.meta?.layerGap ?? (Math.max(design.dx, design.dy) * 2);
		const z = Math.max(layerGap, (design.nlayer - 1) * layerGap);
		return Math.max(1, w, h, z);
	}

	const root = ctx?.scene?.userData?.designRoot;
	if (root) {
		const box = new THREE.Box3().setFromObject(root);
		if (box.isEmpty()) return 10;
		const size = box.getSize(new THREE.Vector3());
		return Math.max(1, size.x, size.y, size.z);
	}

	return 10;
}

function syncCameraClipPlanesForCtx(ctx) {
	const longest = computeLongestBoxEdgeForCtx(ctx);
	const near = Math.max(0.01, longest / 10000);
	const far = Math.max(near * 10, longest * 10);

	for (const cam of [maincamera, topviewcamera]) {
		cam.near = near;
		cam.far = far;
		cam.updateProjectionMatrix();
	}
}

function setAxisLengthFromRectRange(scene, rectRange) {
	if (!scene) return;
	const axisLen = Math.max(2, rectRange * 2);
	const headLen = Math.max(0.6, axisLen * 0.05);
	const headWidth = Math.max(0.3, axisLen * 0.025);

	const axX = scene.getObjectByName("axisX");
	if (axX?.setLength) {
		axX.position.set(-axisLen * 0.5, 0, 0);
		axX.setLength(axisLen, headLen, headWidth);
	}

	const axY = scene.getObjectByName("axisY");
	if (axY?.setLength) {
		axY.position.set(0, -axisLen * 0.5, 0);
		axY.setLength(axisLen, headLen, headWidth);
	}

	const axZ = scene.getObjectByName("axisZ");
	if (axZ?.setLength) {
		axZ.position.set(0, 0, -axisLen * 0.5);
		axZ.setLength(axisLen, headLen, headWidth);
	}
}

function syncAxisLengthForCtx(ctx) {
	if (!ctx?.scene) return;
	const rectRange = computeRectRangeForCtx(ctx);
	setAxisLengthFromRectRange(ctx.scene, rectRange);
}

function makeDefaultScene() {
	const s = new THREE.Scene();
	
	const axX = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(-10, 0, 0), 20, 0xff0000, 0.5);
	axX.name = "axisX";
	setAxisOverlay(axX, false);
	s.add(axX);

	const axY = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -10, 0), 20, 0x00ff00, 0.5);
	axY.name = "axisY";
	setAxisOverlay(axY, false);
	s.add(axY);

	const axZ = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -10), 20, 0x0000ff, 0.5);
	axZ.name = "axisZ";
	setAxisOverlay(axZ, false);
	s.add(axZ);

	const geometry = new THREE.BoxGeometry(1, 1, 1);
	const material = new THREE.MeshStandardMaterial({ color: 0x44aa88 });
	const cube = new THREE.Mesh(geometry, material);
	s.add(cube);

	s.add(new THREE.AmbientLight(0xffffff, 0.4));
	const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
	dirLight.position.set(3, 5, 2);
	s.add(dirLight);

	const infDirLight = new THREE.DirectionalLight(0xffffff, 0.35);
	// Note.
	infDirLight.position.set(1, 1, 1);
	s.add(infDirLight);

	return s;
}

function createBaseScene() {
	const s = new THREE.Scene();
	
	const axX = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(-10, 0, 0), 20, 0xff0000, 0.5);
	axX.name = "axisX";
	setAxisOverlay(axX, false);
	s.add(axX);

	const axY = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -10, 0), 20, 0x00ff00, 0.5);
	axY.name = "axisY";
	setAxisOverlay(axY, false);
	s.add(axY);

	const axZ = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -10), 20, 0x0000ff, 0.5);
	axZ.name = "axisZ";
	setAxisOverlay(axZ, false);
	s.add(axZ);
	
	s.add(new THREE.AmbientLight(0xffffff, 0.4));
	const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
	dirLight.position.set(3, 5, 2);
	s.add(dirLight);

	const infDirLight = new THREE.DirectionalLight(0xffffff, 0.35);
	// Note.
	infDirLight.position.set(1, 1, 1);
	s.add(infDirLight);
	
	return s;
}

function setAxisOverlay(axisArrow, isTopView) {
	const targetRenderOrder = isTopView ? 1000 : 0;
	if (axisArrow.renderOrder !== targetRenderOrder) axisArrow.renderOrder = targetRenderOrder;
	axisArrow.traverse((obj) => {
		if (!obj.material) return;
		const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
		for (const mat of mats) {
			let changed = false;
			const nextDepth = !isTopView;
			if (mat.depthTest !== nextDepth) {
				mat.depthTest = nextDepth;
				changed = true;
			}
			if (mat.depthWrite !== nextDepth) {
				mat.depthWrite = nextDepth;
				changed = true;
			}
			if (mat.transparent !== true) {
				mat.transparent = true;
				changed = true;
			}
			if (changed) mat.needsUpdate = true;
		}
		if (obj.renderOrder !== targetRenderOrder) obj.renderOrder = targetRenderOrder;
	});
}

function syncAxisOverlayForCamera(scene, activeCamera) {
	if (!scene || !activeCamera) return;
	const isTopView = !!activeCamera.isOrthographicCamera;
	if (scene.userData.axisOverlayIsTop === isTopView) return;
	scene.userData.axisOverlayIsTop = isTopView;
	for (const axisName of ["axisX", "axisY", "axisZ"]) {
		const axis = scene.getObjectByName(axisName);
		if (axis) setAxisOverlay(axis, isTopView);
	}
}

function addPlaceholderCube(scene, color24) {
	const geometry = new THREE.BoxGeometry(1, 1, 1);
	const material = new THREE.MeshStandardMaterial({ color: color24 >>> 0 });
	scene.add(new THREE.Mesh(geometry, material));
}

function hashColor24(str) {
	let h = 2166136261;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return (h >>> 0) & 0xFFFFFF;
}

function setActiveCameraKind(kind) {
	if (kind === "ortho") {
		camera = topviewcamera;
		topviewControls.enabled = true;
		mainControls.enabled = false;
	} else {
		camera = maincamera;
		mainControls.enabled = true;
		topviewControls.enabled = false;
	}
	afterToggleCamera();
}

function computeMKeyMove() {
	const ctx = scenes.get(activeSceneId);

	// Note.
	const design = ctx?.design;
	if (design) {
		const layerGap = design.layerGap ?? design.meta?.layerGap ?? (Math.max(design.dx, design.dy) * 2);

		const w = (design.nx - 1) * design.dx;
		const h = (design.ny - 1) * design.dy;
		const layerHeight = Math.max(layerGap, (design.nlayer - 1) * layerGap);

		const L = Math.max(1, w, h, layerHeight);
		let x = L;
		let y = L;
		let z = mainCameraZInverted ? -L : L;

		// Note.
		if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9 && Math.abs(z) < 1e-9) {
			x = 2;
			y = 2;
			z = 2;
		}

		const zCenter = (design.nlayer - 1) * layerGap * 0.5;

		const center = new THREE.Vector3(0, 0, zCenter);
		const toPosition = new THREE.Vector3(x, y, z);

		// Note.
		const toTarget = center;

		return { toPosition, toTarget, center };
	}

	// Note.
	const root = activeScene?.userData?.designRoot;
	if (root) {
		const box = new THREE.Box3().setFromObject(root);
		const size = box.getSize(new THREE.Vector3());
		const center = box.getCenter(new THREE.Vector3());

		const L = Math.max(2, size.x, size.y, size.z);
		let x = L;
		let y = L;
		let z = mainCameraZInverted ? -L : L;

		if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
			x = 2;
			y = 2;
			z = 2;
		}

		const toPosition = new THREE.Vector3(x, y, z);
		const toTarget = center;

		return { toPosition, toTarget, center };
	}

	// Note.
	return {
		toPosition : new THREE.Vector3(2, 3, mainCameraZInverted ? -4 : 4),
		toTarget : new THREE.Vector3(0, 0, 0),
		center : new THREE.Vector3(0, 0, 0),
	};
}

function resetTopViewToInitial() {
	const ctx = scenes.get(activeSceneId);
	const design = ctx?.design;
	if (!ctx || !design) return;

	// Clamp the active layer index.
	const L = Math.max(0, Math.min((ctx.view?.activeLayer ?? 0) | 0, design.nlayer - 1));

	// Note.
	const st = makeDefaultLayerTopState(design, L);

	// Note.
	topviewcamera.position.fromArray(st.pos);
	topviewControls.target.fromArray(st.target);
	topviewcamera.zoom = st.zoom;
	topviewControls.minZoom = st.minZoom;
	topviewControls.maxZoom = st.maxZoom;

	// Note.
	onResize();
	topviewcamera.updateProjectionMatrix();

	topviewcamera.lookAt(topviewControls.target);
	topviewControls.update();

	// Note.
	if (!ctx.view) ctx.view = makeInitialViewForCtx(design);
	ctx.view.active = "ortho";
	ctx.view.activeLayer = L;

	if (!Array.isArray(ctx.view.layers) || ctx.view.layers.length !== design.nlayer) {
		ctx.view.layers = makeInitialViewForCtx(design).layers;
	}
	ctx.view.layers[L] = {
		pos : st.pos,
		target : st.target,
		zoom : st.zoom,
		minZoom : st.minZoom,
		maxZoom : st.maxZoom,
	};
	ctx.view.top = { ...ctx.view.layers[L] };

	zoomUI.syncSliderFromView();
}

function resetActiveCameraView() {
	// Main(Persp) reset
	if (camera.isPerspectiveCamera) {
		const { toPosition, toTarget, center } = computeMKeyMove();
		const checkpointDist = toPosition.distanceTo(toTarget);
		mainControls.maxDistance = Math.max(mainControls.maxDistance, checkpointDist * 1.2);
		perspMover.moveTo({ toPosition, toTarget, center });
		return true;
	}

	// TopView(Ortho) reset
	if (camera.isOrthographicCamera) {
		const ctx = scenes.get(activeSceneId);
		const design = ctx?.design;
		if (!design) return false;

		const L = Math.max(0, Math.min((ctx.view?.activeLayer ?? 0) | 0, design.nlayer - 1));
		const st = makeDefaultLayerTopState(design, L);

		if (ctx?.view && Array.isArray(ctx.view.layers) && ctx.view.layers[L]) {
			ctx.view.layers[L] = { ...st };
			ctx.view.top = { ...st };
		}

		onResize();
		topviewMover.moveTo({
			toPosition : new THREE.Vector3().fromArray(st.pos),
			toTarget : new THREE.Vector3().fromArray(st.target),
			toZoom : st.zoom,
			minZoom : st.minZoom,
			maxZoom : st.maxZoom,
		});
		return true;
	}

	return false;
}

/* Section. */
// 8-A. After camera toggle, sync viewport and zoom UI.
function afterToggleCamera() {
	syncMainViewportYFlip();
	onResize();
	zoomUI.syncSliderFromView();
}

// Note.
function toggleCamera() {
	if (camera.isPerspectiveCamera) {
		camera = topviewcamera
		topviewControls.enabled = true;
		mainControls.enabled = false;
	}
	else if (camera.isOrthographicCamera) {
		camera = maincamera
		mainControls.enabled = true;
		topviewControls.enabled = false;
	}
	maincamMovePressed.clear();
	topviewPanPressed.clear();
	afterToggleCamera();
}

// 8-D. Keyboard input for camera movement.
window.addEventListener("keydown", (e) => {
	const isTyping = isTypingElement(document.activeElement);
	if (!isTyping) {
		const panDir = getTopViewPanDirFromKey(e.code);
		if (panDir && camera.isOrthographicCamera) e.preventDefault();
		if (isMainCameraMoveKey(e.code) && camera.isPerspectiveCamera) e.preventDefault();
	}

	if (!e.repeat && !isTyping) {
		const panDir = getTopViewPanDirFromKey(e.code);
		if (panDir) {
			topviewPanPressed.add(e.code);
			if (camera.isOrthographicCamera) e.preventDefault();
		}
		if (isMainCameraMoveKey(e.code) && camera.isPerspectiveCamera) {
			maincamMovePressed.add(e.code);
		}
	}

	if (e.code === "KeyM") return;
	if (e.code !== "KeyM") return;

	// Note.
	if (camera.isPerspectiveCamera) {
		const { toPosition, toTarget, center } = computeMKeyMove();
		const checkpointDist = toPosition.distanceTo(toTarget);
		mainControls.maxDistance = Math.max(mainControls.maxDistance, checkpointDist * 1.2);
		perspMover.moveTo({ toPosition, toTarget, center });
		return;
	}

	// Note.
	if (camera.isOrthographicCamera) {
		const ctx = scenes.get(activeSceneId);
		const design = ctx?.design;
		if (!design) return;

		const L = Math.max(0, Math.min((ctx.view?.activeLayer ?? 0) | 0, design.nlayer - 1));
		const st = makeDefaultLayerTopState(design, L);

		// Note.
		if (ctx?.view && Array.isArray(ctx.view.layers) && ctx.view.layers[L]) {
			ctx.view.layers[L] = { ...st };
			ctx.view.top = { ...st };
		}

		// Note.
		onResize();

		topviewMover.moveTo({
			toPosition : new THREE.Vector3().fromArray(st.pos),
			toTarget : new THREE.Vector3().fromArray(st.target),
			toZoom : st.zoom,
			minZoom : st.minZoom,
			maxZoom : st.maxZoom,
		});
		return;
	}
});

function _updateAdaptiveGridVisibilityLegacy(scene, activeCam) {
	const root = scene?.userData?.designRoot;
	const lines = root?.userData?.gridLineMeshes;
	const gridPitch = root?.userData?.gridPitch;
	if (!lines || !Array.isArray(lines) || lines.length === 0) return;

	// Note.
	if (!Number.isFinite(gridPitch) || gridPitch <= 0) {
		if (root.userData.gridLinesVisible !== true) {
			root.userData.gridLinesVisible = true;
			for (const m of lines) m.visible = true;
		}
		return;
	}

	// Note.
	if (activeCam?.isPerspectiveCamera) {
		const screenH = Math.max(1, renderer.domElement.clientHeight || window.innerHeight || 1);
		const dist = activeCam.position.distanceTo(mainControls.target);
		if (!Number.isFinite(dist) || dist <= 0) {
			if (root.userData.gridLinesVisible !== true) {
				root.userData.gridLinesVisible = true;
				for (const m of lines) m.visible = true;
			}
			return;
		}

		const farLimit = gridPitch * MAINVIEW_GRID_HIDE_DISTANCE_IN_GRID_PITCH;
		const tooFar = dist >= farLimit;

		const vFovRad = THREE.MathUtils.degToRad(activeCam.fov);
		const worldViewHeight = 2 * dist * Math.tan(vFovRad * 0.5);
		const worldPerPixel = worldViewHeight / screenH;
		const pixelSpacing = gridPitch / Math.max(1e-9, worldPerPixel);
		const tooDense = pixelSpacing < MAINVIEW_MIN_GRID_PIXEL_SPACING;

		const show = !tooFar && !tooDense;
		if (root.userData.gridLinesVisible !== show) {
			root.userData.gridLinesVisible = show;
			for (const m of lines) m.visible = show;
		}
		return;
	}

	if (!activeCam?.isOrthographicCamera) {
		if (root.userData.gridLinesVisible !== true) {
			root.userData.gridLinesVisible = true;
			for (const m of lines) m.visible = true;
		}
		return;
	}

	const screenH = Math.max(1, renderer.domElement.clientHeight || window.innerHeight || 1);
	const worldPerPixel = (activeCam.top - activeCam.bottom) / (screenH * activeCam.zoom);
	const pixelSpacing = gridPitch / Math.max(1e-9, worldPerPixel);
	const show = pixelSpacing >= TOPVIEW_MIN_GRID_PIXEL_SPACING;
	if (root.userData.gridLinesVisible !== show) {
		root.userData.gridLinesVisible = show;
		for (const m of lines) m.visible = show;
	}
}

/* Section. */
function getGridLodLevels(root) {
	const levels = root?.userData?.gridLineLodLevels;
	if (Array.isArray(levels) && levels.length > 0) return levels;

	const baseMeshes = root?.userData?.gridLineMeshes;
	if (!Array.isArray(baseMeshes) || baseMeshes.length === 0) return [];
	const baseStep = Math.max(1, Number(root?.userData?.gridLineCurrentStep) || 1);
	return [{ step : baseStep, meshes : baseMeshes }];
}

function chooseGridLodStep(levels, minStep) {
	if (!Array.isArray(levels) || levels.length === 0) return 1;
	const safeMinStep = Math.max(1, Math.ceil(Number(minStep) || 1));
	let chosen = Math.max(1, Number(levels[levels.length - 1]?.step) || 1);
	for (const level of levels) {
		const step = Math.max(1, Number(level?.step) || 1);
		if (step >= safeMinStep) {
			chosen = step;
			break;
		}
	}
	return chosen;
}

function applyGridLodState(root, visible, minStep = 1) {
	if (!root?.userData) return;
	const levels = getGridLodLevels(root);
	if (levels.length === 0) return;

	const nextStep = visible ? chooseGridLodStep(levels, minStep) : null;
	const stateKey = visible ? `1:${nextStep}` : "0";
	if (root.userData.gridLineLodStateKey === stateKey) return;

	root.userData.gridLineLodStateKey = stateKey;
	root.userData.gridLinesVisible = !!visible;
	if (visible && Number.isFinite(nextStep)) root.userData.gridLineCurrentStep = nextStep;

	for (const level of levels) {
		const step = Math.max(1, Number(level?.step) || 1);
		const levelVisible = !!visible && step === nextStep;
		const meshes = Array.isArray(level?.meshes) ? level.meshes : [];
		for (const mesh of meshes) {
			if (mesh && mesh.visible !== levelVisible) mesh.visible = levelVisible;
		}
	}
}

function estimateGridLineCountFromLevel(level) {
	const meshes = Array.isArray(level?.meshes) ? level.meshes : null;
	const mesh = meshes && meshes.length > 0 ? meshes[0] : null;
	const posCount = Number(mesh?.geometry?.attributes?.position?.count);
	if (!Number.isFinite(posCount) || posCount <= 0) return Number.POSITIVE_INFINITY;
	return Math.max(0, Math.floor(posCount / 2));
}

function findGridLodLevel(levels, step) {
	if (!Array.isArray(levels) || levels.length === 0) return null;
	const s = Math.max(1, Number(step) || 1);
	for (const level of levels) {
		const lvStep = Math.max(1, Number(level?.step) || 1);
		if (lvStep === s) return level;
	}
	return null;
}

function updateAdaptiveGridVisibility(scene, activeCam) {
	const root = scene?.userData?.designRoot;
	if (!root?.userData) return;
	const levels = getGridLodLevels(root);
	if (levels.length === 0) return;

	const gridPitch = Number(root.userData.gridPitch);
	if (!Number.isFinite(gridPitch) || gridPitch <= 0) {
		applyGridLodState(root, true, 1);
		return;
	}

	const maxStep = Math.max(1, Number(levels[levels.length - 1]?.step) || 1);
	const screenH = Math.max(1, renderer.domElement.clientHeight || window.innerHeight || 1);

	if (activeCam?.isPerspectiveCamera) {
		// Main camera compromise: never draw grid to avoid heavy horizon overdraw.
		applyGridLodState(root, false);
		return;
	}

	if (activeCam?.isOrthographicCamera) {
		const worldPerPixel = (activeCam.top - activeCam.bottom) / (screenH * activeCam.zoom);
		if (!Number.isFinite(worldPerPixel) || worldPerPixel <= 0) {
			applyGridLodState(root, false);
			return;
		}

		const pixelSpacing = gridPitch / Math.max(1e-9, worldPerPixel);
		const maxPixelSpacing = pixelSpacing * maxStep;
		if (!Number.isFinite(pixelSpacing) || pixelSpacing <= 0 || maxPixelSpacing < TOPVIEW_MIN_GRID_PIXEL_SPACING) {
			applyGridLodState(root, false);
			return;
		}

		let minStep = TOPVIEW_TARGET_GRID_PIXEL_SPACING / Math.max(1e-9, pixelSpacing);
		if (TOPVIEW_MAX_GRID_LINE_COUNT > 0) {
			let guard = 0;
			let chosenStep = chooseGridLodStep(levels, minStep);
			while (guard < levels.length) {
				const level = findGridLodLevel(levels, chosenStep);
				const lineCount = estimateGridLineCountFromLevel(level);
				if (lineCount <= TOPVIEW_MAX_GRID_LINE_COUNT) break;
				const nextStep = chooseGridLodStep(levels, chosenStep + 1);
				if (nextStep === chosenStep) break;
				chosenStep = nextStep;
				guard += 1;
			}
			minStep = Math.max(minStep, chosenStep);
		}
		applyGridLodState(root, true, minStep);
		return;
	}

	applyGridLodState(root, true, 1);
}

let lastFrameTimeMs = performance.now();
function animate() {
	requestAnimationFrame(animate);
	
	const nowMs = performance.now();
	const dt = Math.max(0, (nowMs - lastFrameTimeMs) / 1000);
	lastFrameTimeMs = nowMs;
	
	mainControls.autoRotate = false;
	
	perspMover.update();
	topviewMover.update();
	updateTopViewPan(dt);
	updateMainCameraMove(dt);
	
	mainControls.autoRotate = 
		autoRotateZEnabled &&
		(getActiveCamera() === maincamera) &&
		!perspMover.isMoving() &&
		!isMainControlsInteracting;
	
	getActiveControls().update();
	const activeCam = getActiveCamera();
	syncAxisOverlayForCamera(activeScene, activeCam);
	syncAxisVisibilityForCamera(activeScene, activeCam);
	updateAdaptiveGridVisibility(activeScene, activeCam);
	updateTopViewRulerOverlay(activeCam);
	updateTopGridHoverIndicator(activeCam);
	updateManualRouteCandidateOverlay(activeCam);
	renderer.render(activeScene, activeCam);
}

animate();

renderer.domElement.addEventListener("pointermove", (e) => {
	topGridHoverPointer.inside = true;
	topGridHoverPointer.clientX = e.clientX;
	topGridHoverPointer.clientY = e.clientY;
});

renderer.domElement.addEventListener("pointerenter", (e) => {
	topGridHoverPointer.inside = true;
	topGridHoverPointer.clientX = e.clientX;
	topGridHoverPointer.clientY = e.clientY;
});

renderer.domElement.addEventListener("pointerleave", () => {
	topGridHoverPointer.inside = false;
	const scene = scenes.get(activeSceneId)?.scene;
	setTopGridHoverVisible(scene, false);
});

renderer.domElement.addEventListener("pointerdown", (e) => {
	if (e.button !== 0) return;
	const clientY = relayedMainFlipPointerEvents.has(e) ? mirrorClientYInCanvas(e.clientY) : e.clientY;
	netPickPointerDown.active = true;
	netPickPointerDown.x = e.clientX;
	netPickPointerDown.y = clientY;
});

function handleNetPickPointerUp(e) {
	if (e.button !== 0) return;
	if (!netPickPointerDown.active) return;
	const clientY = relayedMainFlipPointerEvents.has(e) ? mirrorClientYInCanvas(e.clientY) : e.clientY;

	const dx = e.clientX - netPickPointerDown.x;
	const dy = clientY - netPickPointerDown.y;
	const movedDistSq = (dx * dx) + (dy * dy);
	netPickPointerDown.active = false;

	if (movedDistSq > (NET_PICK_MAX_DRAG_PX * NET_PICK_MAX_DRAG_PX)) return;
	if (manualRouteState.enabled) {
		tryHandleManualRouteClick(e.clientX, clientY);
		return;
	}
	selectNearestNetAtClientPoint(e.clientX, clientY);
}

renderer.domElement.addEventListener("pointerup", handleNetPickPointerUp);
window.addEventListener("pointerup", handleNetPickPointerUp);

renderer.domElement.addEventListener("pointercancel", () => {
	netPickPointerDown.active = false;
	topGridHoverPointer.inside = false;
	const scene = scenes.get(activeSceneId)?.scene;
	setTopGridHoverVisible(scene, false);
});

window.addEventListener("blur", () => {
	netPickPointerDown.active = false;
	topGridHoverPointer.inside = false;
	const scene = scenes.get(activeSceneId)?.scene;
	setTopGridHoverVisible(scene, false);
});

if (groupTreeEl) {
	groupTreeEl.addEventListener("click", (e) => {
		const groupDeleteBtn = e.target?.closest?.("button[data-role=\"group-delete\"]");
		if (groupDeleteBtn) {
			const ctx = scenes.get(activeSceneId);
			const design = ctx?.design;
			const gIdx = Number(groupDeleteBtn.dataset.gidx);
			if (!ctx || !design || !Array.isArray(design.groups)) return;
			if (!Number.isFinite(gIdx) || gIdx < 0 || gIdx >= design.groups.length) return;
			const group = design.groups[gIdx];
			const label = String(group?.name ?? group?.gid ?? "this group");
			const count = Math.max(0, Number(group?.nets?.length) || 0);
			const netText = `${count} net${count === 1 ? "" : "s"}`;
			openDeleteConfirmModal({
				kind : "group",
				gIdx,
				title : "Delete Group",
				message : `Delete group "${label}" and ${netText}?`,
			});
			return;
		}

		const netDeleteBtn = e.target?.closest?.("button[data-role=\"net-delete\"]");
		if (netDeleteBtn) {
			const ctx = scenes.get(activeSceneId);
			const design = ctx?.design;
			const gIdx = Number(netDeleteBtn.dataset.gidx);
			const nIdx = Number(netDeleteBtn.dataset.nidx);
			if (!ctx || !design || !Array.isArray(design.groups)) return;
			if (!Number.isFinite(gIdx) || !Number.isFinite(nIdx)) return;
			if (gIdx < 0 || gIdx >= design.groups.length) return;
			const group = design.groups[gIdx];
			if (!group || !Array.isArray(group.nets) || nIdx < 0 || nIdx >= group.nets.length) return;
			const net = group.nets[nIdx];
			const netLabel = String(net?.name ?? net?.nid ?? "this net");
			openDeleteConfirmModal({
				kind : "net",
				gIdx,
				nIdx,
				title : "Delete Net",
				message : `Delete net "${netLabel}"?`,
			});
			return;
		}

		const netFocusBtn = e.target?.closest?.("button[data-role=\"net-focus\"]");
		if (netFocusBtn) {
			const gIdx = Number(netFocusBtn.dataset.gidx);
			const nIdx = Number(netFocusBtn.dataset.nidx);
			focusAndSelectNetByIndex(gIdx, nIdx);
			return;
		}

		const btn = e.target?.closest?.("button[data-role=\"group-expand\"]");
		if (!btn) return;
		const ctx = scenes.get(activeSceneId);
		const design = ctx?.design;
		if (!ctx || !design) return;
		const ui = ensureGroupUiState(ctx);
		const gIdx = Number(btn.dataset.gidx);
		if (!Number.isFinite(gIdx) || gIdx < 0 || gIdx >= design.groups.length) return;
		const gid = design.groups[gIdx].gid;
		if (ui.expandedGroups.has(gid)) ui.expandedGroups.delete(gid);
		else ui.expandedGroups.add(gid);
		renderGroupTree();
	});

	groupTreeEl.addEventListener("change", (e) => {
		const t = e.target;
		const ctx = scenes.get(activeSceneId);
		const design = ctx?.design;
		if (!ctx || !design) return;

		if (t?.dataset?.role === "group-check") {
			const gIdx = Number(t.dataset.gidx);
			if (!Number.isFinite(gIdx) || gIdx < 0 || gIdx >= design.groups.length) return;
			const g = design.groups[gIdx];
			const on = !!t.checked;
			for (const n of g.nets) n.enabled = on;
			refreshGroupState(g);
			reapplyActiveDesignVisibility();
			renderGroupTree();
			return;
		}

		if (t?.dataset?.role === "net-check") {
			const gIdx = Number(t.dataset.gidx);
			const nIdx = Number(t.dataset.nidx);
			if (!Number.isFinite(gIdx) || !Number.isFinite(nIdx)) return;
			if (gIdx < 0 || gIdx >= design.groups.length) return;
			const g = design.groups[gIdx];
			if (nIdx < 0 || nIdx >= g.nets.length) return;
			g.nets[nIdx].enabled = !!t.checked;
			refreshGroupState(g);
			reapplyActiveDesignVisibility();
			renderGroupTree();
		}
	});
}


if (layerColorInputEl) {
	layerColorInputEl.addEventListener("input", () => {
		const ctx = scenes.get(activeSceneId);
		if (!ctx?.design) return;
		if (!ctx.ui) ctx.ui = {};
		if (!ctx.ui.layerStyle) ctx.ui.layerStyle = { planeColor : "#404040", planeOpacity : 0.0, gridLineColor : "#575757", gridLineOpacity : 0.32 };
		ctx.ui.layerStyle.planeColor = layerColorInputEl.value;
		if (!applyActiveLayerStyleFast()) reapplyActiveDesignVisibility();
		syncLayerStyleControls();
	});
}

if (layerOpacityInputEl) {
	layerOpacityInputEl.addEventListener("input", () => {
		const ctx = scenes.get(activeSceneId);
		if (!ctx?.design) return;
		if (!ctx.ui) ctx.ui = {};
		if (!ctx.ui.layerStyle) ctx.ui.layerStyle = { planeColor : "#404040", planeOpacity : 0.0, gridLineColor : "#575757", gridLineOpacity : 0.32 };
		ctx.ui.layerStyle.planeOpacity = clamp01(Number(layerOpacityInputEl.value));
		if (!applyActiveLayerStyleFast()) reapplyActiveDesignVisibility();
		syncLayerStyleControls();
	});
}


if (gridColorInputEl) {
	gridColorInputEl.addEventListener("input", () => {
		const ctx = scenes.get(activeSceneId);
		if (!ctx?.design) return;
		if (!ctx.ui) ctx.ui = {};
		if (!ctx.ui.layerStyle) ctx.ui.layerStyle = { planeColor : "#404040", planeOpacity : 0.0, gridLineColor : "#575757", gridLineOpacity : 0.32 };
		ctx.ui.layerStyle.gridLineColor = gridColorInputEl.value;
		if (!applyActiveLayerStyleFast()) reapplyActiveDesignVisibility();
		syncLayerStyleControls();
	});
}


if (gridOpacityInputEl) {
	gridOpacityInputEl.addEventListener("input", () => {
		const ctx = scenes.get(activeSceneId);
		if (!ctx?.design) return;
		if (!ctx.ui) ctx.ui = {};
		if (!ctx.ui.layerStyle) ctx.ui.layerStyle = { planeColor : "#404040", planeOpacity : 0.0, gridLineColor : "#575757", gridLineOpacity : 0.32 };
		ctx.ui.layerStyle.gridLineOpacity = clamp01(Number(gridOpacityInputEl.value));
		if (!applyActiveLayerStyleFast()) reapplyActiveDesignVisibility();
		syncLayerStyleControls();
	});
}

