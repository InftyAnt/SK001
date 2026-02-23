import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { initZoomSlider } from './slider.js';
import { createPerspCameraMover, createOrthoCameraMover } from './cammove.js';
import { initSidePanels } from './uipanels.js';
import { initDataFilesUI } from './datafiles.js';
import { parseDesignText } from './parser.js';
import { applyDesignToScene } from './scene.js';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

/* 1. Scene 생성 */
const DEFAULT_SCENE_ID = "default";
let sceneSeq = 0;

const scenes = new Map();
let activeSceneId = DEFAULT_SCENE_ID;
let activeScene = null;

/* 2. 카메라 생성 */
// 2-A. 메인 카메라 : 원근 카메라
const maincamera = new THREE.PerspectiveCamera(
	60, // fov
	window.innerWidth / window.innerHeight, // 종횡비
	0.1, // near
	1000 // far
);
maincamera.position.set(2, 2, 2);

// 2-B. 탑뷰 카메라 : 사영 카메라
const aspect = window.innerWidth / window.innerHeight
const frustumSize = 4
const topviewcamera = new THREE.OrthographicCamera(
	-(frustumSize * aspect) / 2, // 왼쪽 끝
	(frustumSize * aspect) / 2, // 오른쪽 끝
	frustumSize / 2, // 위쪽 끝
	-frustumSize / 2, // 아래쪽 끝
	0.1, // near
	1000 // far
);
topviewcamera.position.set(2, 2, 2);

// 2-C. 현재 카메라 : 위 카메라 중 하나 지정
let camera = maincamera;

/* 3. Renderer 생성 */
const renderer = new THREE.WebGLRenderer({
	antialias : true,
	depth : true,
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

/* 4. 카메라 컨트롤 생성 */
// 4-A. 메인 카메라 컨트롤
const mainControls = new OrbitControls(maincamera, renderer.domElement);
mainControls.enableDamping = false;
mainControls.enabled = true;

// 4-B. 탑뷰 카메라 컨트롤
const topviewControls = new OrbitControls(topviewcamera, renderer.domElement);
topviewControls.enableDamping = false;
topviewControls.enabled = false;

// 4-C. 현재 카메라의 컨트롤
let controls = mainControls;

/* 5. 축 생성 */

/* 6. 카메라 및 컨트롤 설정 */
// 6-A. 초기 설정
maincamera.position.set(2, 2, 2);
maincamera.lookAt(0, 0, 0);

topviewcamera.zoom = 1.2;
topviewcamera.updateProjectionMatrix();

mainControls.minDistance = 0.2;
mainControls.maxDistance = 200;

topviewControls.minZoom = 0.01;
topviewControls.maxZoom = 10;

// 6-B. 유틸 함수 선언 및 정의
function getActiveCamera() {
	return camera;
}

function getActiveControls() {
	return (getActiveCamera() === maincamera) ? mainControls : topviewControls;
}

// 6-C. slider.js의 함수 호출
const zoomUI = initZoomSlider({
	getActiveCamera,
	getActiveControls,
	mainControls,
	topviewControls,
});

// 6-D. cammove.js의 함수 호출
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

// 6-F. 메인 카메라 Z축 자동 회전 토글
const rotateZToggleEl = document.getElementById("mainAutoRotateZ");
let autoRotateZEnabled = false;
let isMainControlsInteracting = false;


const TOPVIEW_PAN_PIXELS_PER_SEC = 500;
const topviewPanPressed = new Set();

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
	const panDist = TOPVIEW_PAN_PIXELS_PER_SEC * worldPerPixel * dt;

	const move = new THREE.Vector3(dx * panDist, dy * panDist, 0);
	topviewcamera.position.add(move);
	topviewControls.target.add(move);
	topviewcamera.lookAt(topviewControls.target);
	topviewControls.update();
	zoomUI.syncSliderFromView();
}

window.addEventListener("keyup", (e) => {
	if (topviewPanPressed.has(e.code)) topviewPanPressed.delete(e.code);
});

window.addEventListener("blur", () => {
	topviewPanPressed.clear();
});

// OrbitControls의 autoRotate는 카메라의 up축(현재는 Z축)을 기준으로 target 주위를 회전합니다.
mainControls.autoRotateSpeed = 1.0; // 필요하면 값 조절(기본: 2.0)

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

if (rotateZToggleEl) {
  rotateZToggleEl.addEventListener("change", () => {
    setAutoRotateZ(rotateZToggleEl.checked);
  });
}

// 6-E. uipanels.js의 함수 호출
initSidePanels({
	left : { defaultCollapsed : true, defaultTab : "info" },
	right : { defaultCollapsed : false, defaultTab : "zoom" },
});

/* 7. Scene 설정 */
function makeDefaultLayerTopState(design, layerIndex) {
	const w = (design.nx - 1) * design.dx;
	const h = (design.ny - 1) * design.dy;

	// 레이어 z
	const z = layerIndex * design.layerGap;

	// 카메라 높이(orthographic에서는 “보이는 크기”는 zoom이 결정하지만,
	// OrbitControls의 target/near-far 여유를 위해 적당히 위로 올려둡니다)
	const D = Math.max(w, h) * 2.0 + design.layerGap * 2.0;

	// 요구사항: “반 화면” 안에 들어가는 최대 배율을 구하고,
	// 그 값을 슬라이더의 최소 배율로, 최대 배율은 100배로
	const zMin = computeFitZoomForDesign(design);
	const zMax = zMin * 100.0;

	return {
		pos : [0, 0, z + D],
		target : [0, 0, z],

		// 초기 배율은 요구사항에 맞춘 값으로
		zoom : zMin,

		// 슬라이더 범위
		minZoom : zMin,
		maxZoom : zMax,
	};
}

function computeFitZoomForDesign(design) {
	// 화면(프러스텀) 기준 “반 화면” 안에 (w,h) 사각형이 들어가도록 하는 최대 zoom
	const w = (design.nx - 1) * design.dx;
	const h = (design.ny - 1) * design.dy;

	const aspect = window.innerWidth / window.innerHeight;
	const frustumW = frustumSize * aspect; // 화면에 해당하는 월드 폭
	const frustumH = frustumSize;          // 화면에 해당하는 월드 높이

	const eps = 1e-9;
	const ww = Math.max(Math.abs(w), eps);
	const hh = Math.max(Math.abs(h), eps);

	// “반 화면” 제약: w*zoom <= frustumW/2  AND  h*zoom <= frustumH/2
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
		top : base.top,			// design 없는 경우 fallback
		layers : [],
	};
	
	if (designOrNull) {
		// 메인 카메라 초기 상태도 "M 키" 규칙으로 고정
		const layerGap = designOrNull.layerGap ?? designOrNull.meta?.layerGap ?? (Math.max(designOrNull.dx, designOrNull.dy) * 2);

		const w = (designOrNull.nx - 1) * designOrNull.dx;
		const h = (designOrNull.ny - 1) * designOrNull.dy;

		const zCenter = (designOrNull.nlayer - 1) * layerGap * 0.5;

		v.main = {
			...(v.main ?? {}),
			pos : [w, h, zCenter],
			target : [0, 0, zCenter],
		};
	}

	if (designOrNull) {
		v.layers = Array.from({ length : designOrNull.nlayer }, (_, L) => makeDefaultLayerTopState(designOrNull, L));
		// top은 사용 안 하더라도 유지
		v.top = v.layers[0];
	}

	return v;
}

function captureViewState() {
	// 현재 scene ctx의 layer 상태를 함께 업데이트하기 위해 ctx를 읽습니다
	const ctx = scenes.get(activeSceneId);

	const v = ctx?.view ?? {
		active : (camera.isOrthographicCamera ? "ortho" : "persp"),
		activeLayer : 0,
		main : null,
		top : null,
		layers : [],
	};

	// 항상 main은 갱신
	v.main = {
		pos : maincamera.position.toArray(),
		target : mainControls.target.toArray(),
		minDistance : mainControls.minDistance,
		maxDistance : mainControls.maxDistance,
	};

	// top은 “현재 topviewcamera 상태”
	const curTop = {
		pos : topviewcamera.position.toArray(),
		target : topviewControls.target.toArray(),
		zoom : topviewcamera.zoom,
		minZoom : topviewControls.minZoom,
		maxZoom : topviewControls.maxZoom,
	};

	// 현재 활성 카메라 종류 기록
	v.active = (camera.isOrthographicCamera ? "ortho" : "persp");

	// 디자인이 있고, 레이어별 topview를 쓰는 상태면 해당 레이어 상태만 갱신
	if (ctx?.design && Array.isArray(v.layers) && v.layers.length === ctx.design.nlayer) {
		const L = Math.max(0, Math.min(v.activeLayer | 0, v.layers.length - 1));
		if (v.active === "ortho") {
			v.layers[L] = curTop;
		}
	}

	// fallback top도 항상 최신으로
	v.top = curTop;

	return v;
}

function setZAxisVisible(visible) {
	const z = activeScene?.getObjectByName("axisZ");
	if (z) z.visible = !!visible;
}

function applyViewState(v) {
	if (!v) return;

	const ctx = scenes.get(activeSceneId);
	const design = ctx?.design ?? null;

	// design이 있는 씬인데 layers가 없으면 초기값 생성
	if (design) {
		if (!Array.isArray(v.layers) || v.layers.length !== design.nlayer) {
			const init = makeInitialViewForCtx(design);
			v.layers = init.layers;
			v.activeLayer = 0;
		}
	}

	// 1) active 카메라 지정
	setActiveCameraKind(v.active);

	// 2) main 적용
	if (v.main) {
		maincamera.position.fromArray(v.main.pos);
		mainControls.target.fromArray(v.main.target);
		mainControls.minDistance = v.main.minDistance ?? mainControls.minDistance;
		mainControls.maxDistance = v.main.maxDistance ?? mainControls.maxDistance;
		maincamera.lookAt(mainControls.target);
		mainControls.update();
	}

	// 3) top 적용 (레이어 모드면 해당 레이어 상태를 사용)
	let topState = v.top;
	if (v.active === "ortho" && design && Array.isArray(v.layers) && v.layers.length === design.nlayer) {
		const L = Math.max(0, Math.min(v.activeLayer | 0, v.layers.length - 1));
		topState = v.layers[L] ?? topState;

		// 레이어 TopView는 회전 막고, 화면 위가 +Y가 되도록 설정(원하시면 변경 가능)
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
	
	// 레이어 격리 적용
	const root = activeScene?.userData?.designRoot;
	if (root?.userData?.setIsolatedLayer) {
		if (v.active === "ortho" && design) {
			root.userData.setIsolatedLayer(v.activeLayer | 0);
		} else {
			root.userData.setIsolatedLayer(null);
		}
	}
	
	setZAxisVisible(v.active !== "ortho");
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
	activeScene = ctx.scene;
	
	// main 카메라 초기 상태를 "M 키"와 동일하게 세팅
	{
		const { toPosition, toTarget } = computeMKeyMove();
		maincamera.position.copy(toPosition);
		mainControls.target.copy(toTarget);
		maincamera.lookAt(toTarget);
		mainControls.update();
	}

	// topview 카메라는 fallback 값(디자인 로드 전이므로 임시값)
	topviewcamera.position.set(2, 2, 2);
	topviewControls.target.set(0, 0, 0);
	topviewcamera.zoom = 1.2;
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
	
	applyViewState(next.view);
	
	renderSceneList();
	
	renderCameraButtons();
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
			applyDesignToScene(s, design); // scene.js가 design.layerGap을 쓰면 자동 적용
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
		scenes.set(id, ctx);
	}
	
	renderSceneList();
	if (lastAddedId) setActiveSceneById(lastAddedId);
}

const dataUI = initDataFilesUI({
	onFiles : (files) => addTextFilesAsScenes(files),
	onSelect : (id) => setActiveSceneById(id),
	onRemove : (id) => removeScene(id),
});

const cameraButtonsEl = document.getElementById("cameraButtons");

function renderCameraButtons() {
	if (!cameraButtonsEl) return;

	const ctx = scenes.get(activeSceneId);
	const design = ctx?.design ?? null;

	cameraButtonsEl.innerHTML = "";

	// 1) Main(Persp)
	{
		const b = document.createElement("button");
		b.className = "camera-btn" + ((ctx?.view?.active ?? "persp") === "persp" ? " active" : "");
		b.dataset.cam = "main";
		b.textContent = "Main (Persp)";
		cameraButtonsEl.appendChild(b);
	}

	// 2) Layer TopViews (design 있을 때만)
	if (design) {
		for (let L = 0; L < design.nlayer; L++) {
			const b = document.createElement("button");
			const isActive = (ctx.view.active === "ortho" && (ctx.view.activeLayer | 0) === L);
			b.className = "camera-btn" + (isActive ? " active" : "");
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

	// 현재 상태 저장
	ctx.view = captureViewState();

	// main 모드로 전환
	ctx.view.active = "persp";
	applyViewState(ctx.view);
	renderCameraButtons();
}

function switchToLayerCamera(layerIndex) {
	const ctx = scenes.get(activeSceneId);
	const design = ctx?.design;
	if (!ctx || !design) return;

	// 현재 상태 저장(현재가 ortho면 기존 activeLayer의 layers[]가 갱신됨)
	ctx.view = captureViewState();

	const L = Math.max(0, Math.min(layerIndex | 0, design.nlayer - 1));

	// 레이어 모드로 전환
	ctx.view.active = "ortho";
	ctx.view.activeLayer = L;

	// 혹시 layers가 없으면 생성
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

initScenes();
renderSceneList();
renderCameraButtons();

function getScenesForUI() {
	const arr = [];
	for (const [id, ctx] of scenes.entries()) {
		const subtitle = ctx.isDefault
			? "기본 씬"
			: (ctx.fileMeta?.name ?? "");
		arr.push({
			id,
			title: ctx.title ?? id,
			subtitle,
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

	// material이 참조하는 texture들도 같이 정리
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

	// scene.js에서 designRoot만 갈아끼울 때 쓰는 포인터가 있다면 정리
	if (scene.userData?.designRoot) {
		scene.userData.designRoot = null;
	}

	disposeObject3D(scene);

	// 참조도 끊어두면 GC가 더 깔끔합니다
	scene.clear();
	scene.userData = {};
}

function removeScene(id) {
	if (id === DEFAULT_SCENE_ID) return;

	const ctx = scenes.get(id);
	if (!ctx) return;

	const deletingActive = (id === activeSceneId);

	// 1) 먼저 Map에서 제거 (UI에서 즉시 빠지게)
	scenes.delete(id);

	// 2) 활성 씬을 지우는 경우, 먼저 default로 전환
	if (deletingActive) {
		setActiveSceneById(DEFAULT_SCENE_ID);
	} else {
		renderSceneList();
	}

	// 3) 이제 안전하게 dispose (activeScene이 더 이상 이 scene을 쓰지 않는 상태)
	disposeSceneGraph(ctx.scene);

	// 4) renderer 내부 캐시 정리(선택, but 유용)
	if (renderer.renderLists?.dispose) renderer.renderLists.dispose();
	else renderCameraButtons();
}

/* 7. 반응형 (창 크기의 변화에 대응) */
function onResize() {
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	
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
	
	return s;
}

function setAxisOverlay(axisArrow, isTopView) {
	axisArrow.renderOrder = isTopView ? 1000 : 0;
	axisArrow.traverse((obj) => {
		if (!obj.material) return;
		const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
		for (const mat of mats) {
			mat.depthTest = !isTopView;
			mat.depthWrite = !isTopView;
			mat.transparent = true;
			mat.needsUpdate = true;
		}
		obj.renderOrder = isTopView ? 1000 : 0;
	});
}

function syncAxisOverlayForCamera(scene, activeCamera) {
	if (!scene || !activeCamera) return;
	const isTopView = !!activeCamera.isOrthographicCamera;
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

	// 1) design이 있으면 design 기준으로 계산 (가장 정확)
	const design = ctx?.design;
	if (design) {
		const layerGap = design.layerGap ?? design.meta?.layerGap ?? (Math.max(design.dx, design.dy) * 2);

		const w = (design.nx - 1) * design.dx;
		const h = (design.ny - 1) * design.dy;

		let x = w;
		let y = h;

		// 퇴화 케이스 방지
		if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9) {
			x = 2;
			y = 2;
		}

		const zCenter = (design.nlayer - 1) * layerGap * 0.5;

		const center = new THREE.Vector3(0, 0, zCenter);
		const toPosition = new THREE.Vector3(x, y, zCenter);

		// 원하시면 원점(0,0,0)을 보게 바꾸셔도 됩니다.
		const toTarget = center;

		return { toPosition, toTarget, center };
	}

	// 2) design이 없지만 designRoot가 있으면 bounding box로 근사
	const root = activeScene?.userData?.designRoot;
	if (root) {
		const box = new THREE.Box3().setFromObject(root);

		let x = 2 * box.max.x;
		let y = 2 * box.max.y;

		if (!Number.isFinite(x) || !Number.isFinite(y)) {
			x = 2;
			y = 2;
		}

		const zCenter = (box.min.z + box.max.z) * 0.5;

		const center = new THREE.Vector3(0, 0, zCenter);
		const toPosition = new THREE.Vector3(x, y, zCenter);
		const toTarget = center;

		return { toPosition, toTarget, center };
	}

	// 3) 완전 fallback
	return {
		toPosition : new THREE.Vector3(2, 3, 4),
		toTarget : new THREE.Vector3(0, 0, 0),
		center : new THREE.Vector3(0, 0, 0),
	};
}

function resetTopViewToInitial() {
	const ctx = scenes.get(activeSceneId);
	const design = ctx?.design;
	if (!ctx || !design) return;

	// 현재 선택된 레이어
	const L = Math.max(0, Math.min((ctx.view?.activeLayer ?? 0) | 0, design.nlayer - 1));

	// “초기 탑뷰 상태”를 다시 계산(현재 화면비/프러스텀 기준)
	const st = makeDefaultLayerTopState(design, L);

	// 카메라/컨트롤을 초기값으로 되돌림(즉시)
	topviewcamera.position.fromArray(st.pos);
	topviewControls.target.fromArray(st.target);
	topviewcamera.zoom = st.zoom;
	topviewControls.minZoom = st.minZoom;
	topviewControls.maxZoom = st.maxZoom;

	// Orthographic 프러스텀/프로젝션 업데이트
	onResize();
	topviewcamera.updateProjectionMatrix();

	topviewcamera.lookAt(topviewControls.target);
	topviewControls.update();

	// ctx.view에도 반영(다음 전환/저장 시 일관성 유지)
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

/* 8. 카메라 전환 */
// 8-A. 카메라 전환 후 화면 크기 조정 및 동기화
function afterToggleCamera() {
	onResize();
	zoomUI.syncSliderFromView();
}

// 8-B. 카메라 전환
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
	afterToggleCamera();
}

// 8-D. (예시) 특정 타겟을 향한 카메라 이동 함수를 M키와 바인드
window.addEventListener("keydown", (e) => {
	if (!e.repeat && !isTypingElement(document.activeElement)) {
		const panDir = getTopViewPanDirFromKey(e.code);
		if (panDir) {
			topviewPanPressed.add(e.code);
			if (camera.isOrthographicCamera) e.preventDefault();
		}
	}

	if (e.code !== "KeyM") return;

	// Main(Persp)일 때는 기존 동작 유지
	if (camera.isPerspectiveCamera) {
		const { toPosition, toTarget, center } = computeMKeyMove();
		perspMover.moveTo({ toPosition, toTarget, center });
		return;
	}

	// TopView(Ortho)일 때는 “초기 탑뷰 상태”로 부드럽게 복귀
	if (camera.isOrthographicCamera) {
		const ctx = scenes.get(activeSceneId);
		const design = ctx?.design;
		if (!design) return;

		const L = Math.max(0, Math.min((ctx.view?.activeLayer ?? 0) | 0, design.nlayer - 1));
		const st = makeDefaultLayerTopState(design, L);

		// view에도 즉시 반영(상태 일관성)
		if (ctx?.view && Array.isArray(ctx.view.layers) && ctx.view.layers[L]) {
			ctx.view.layers[L] = { ...st };
			ctx.view.top = { ...st };
		}

		// 프러스텀 갱신(필요 시)
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

/* 11. 애니메이션 */
const clock = new THREE.Clock();
function animate() {
	requestAnimationFrame(animate);
	
	const dt = clock.getDelta();
	
	mainControls.autoRotate = false;
	
	perspMover.update();
	topviewMover.update();
	updateTopViewPan(dt);
	
	mainControls.autoRotate = 
		autoRotateZEnabled &&
		(getActiveCamera() === maincamera) &&
		!perspMover.isMoving() &&
		!isMainControlsInteracting;
	
	getActiveControls().update();
	const activeCam = getActiveCamera();
	syncAxisOverlayForCamera(activeScene, activeCam);
	renderer.render(activeScene, activeCam);
}

animate();
