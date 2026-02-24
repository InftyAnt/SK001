/*  */
export function initZoomSlider({
	getActiveCamera,
	getActiveControls,
	mainControls,
	topviewControls,
	uiZoomId = "ui-zoom",
	zoomSliderId = "zoomSlider",
	zoomValueId = "zoomValue"
}) {
	/* 1. index.html 코드를 통해 배치한 슬라이더 오브젝트와 연결 */
	const zoomSlider = document.getElementById(zoomSliderId);
	const zoomValue = document.getElementById(zoomValueId);
	const uiZoom = document.getElementById(uiZoomId);
	
	if (!zoomSlider || !zoomValue || !uiZoom) {
		throw new Error("Zoom UI elements not found. Check index.html IDs.");
	}
	
	/* 2. 이벤트의 버블링(이벤트가 부모까지 전파됨)을 막음 */
	["pointerdown", "pointermove", "pointerup", "wheel"].forEach(ev => {
		uiZoom.addEventListener(ev, (e) => { e.stopPropagation(); }, { passive : false });	
	});
	
	function clamp01(x) {
		return Math.max(0, Math.min(1, x));
	}

	function toLogSafe(x) {
		return Math.max(x, 1e-9);
	}

	function tFromLogRange(value, minV, maxV) {
		const a = Math.log(toLogSafe(minV));
		const b = Math.log(toLogSafe(maxV));
		const denom = b - a;
		if (Math.abs(denom) < 1e-12) return 0;
		return clamp01((Math.log(toLogSafe(value)) - a) / denom);
	}

	function tToLogRange(t, minV, maxV) {
		const a = Math.log(toLogSafe(minV));
		const b = Math.log(toLogSafe(maxV));
		return Math.exp(a + (b - a) * clamp01(t));
	}

	function distanceToT(distance, minD, maxD) {
		return 1 - tFromLogRange(distance, minD, maxD);
	}

	function tToDistance(t, minD, maxD) {
		return tToLogRange(1 - t, minD, maxD);
	}

	function zoomToT(zoom, minZ, maxZ) {
		return tFromLogRange(zoom, minZ, maxZ);
	}

	function tToZoom(t, minZ, maxZ) {
		return tToLogRange(t, minZ, maxZ);
	}
	
	/* 3. 슬라이더와 카메라 배율 동기화 */
	let isProgrammaticUpdate = false;
	
	// 3-A. 카메라의 배율 정보로부터 슬라이더의 값을 동기화하는 함수 (배율 -> 슬라이더)
	function syncSliderFromView() {
		const cam = getActiveCamera();
		const ctl = getActiveControls();
		
		isProgrammaticUpdate = true;
		
		if (cam.isOrthographicCamera) {
			const z = cam.zoom;
			const zMin = ctl.minZoom ?? 0.1;
			const zMax = ctl.maxZoom ?? 10.0;
			
			const t = zoomToT(z, zMin, zMax);
			zoomSlider.value = Math.round(clamp01(t) * 1000);
			zoomValue.textContent = `x ${z.toFixed(2)}`;
		}
		else if (cam.isPerspectiveCamera) {
			const d = ctl.getDistance();
			const dMin = ctl.minDistance ?? 0.1;
			const dMax = ctl.maxDistance ?? 1000;
			
			const t = distanceToT(d, dMin, dMax);
			zoomSlider.value = Math.round(t * 1000);
			zoomValue.textContent = `dist ${d.toFixed(2)}`;
		}
		
		isProgrammaticUpdate = false;
	}
	
	// 3-B. 슬라이더의 값으로부터 카메라의 배율 정보를 적용하는 함수 (슬라이더 -> 배율)
	function applyViewFromSlider() {
		if (isProgrammaticUpdate) return;
		
		const cam = getActiveCamera();
		const ctl = getActiveControls();
		const t = (Number(zoomSlider.value) / 1000);
		
		if (cam.isOrthographicCamera) {
			const zMin = ctl.minZoom ?? 0.1;
			const zMax = ctl.maxZoom ?? 10.0;
			cam.zoom = tToZoom(t, zMin, zMax);
			cam.updateProjectionMatrix();
			ctl.update();
		}
		else if (cam.isPerspectiveCamera) {
			const dMin = ctl.minDistance ?? 0.1;
			const dMax = ctl.maxDistance ?? 1000;
			const newD = tToDistance(t, dMin, dMax);
			
			const dir = cam.position.clone().sub(ctl.target).normalize();
			cam.position.copy(ctl.target).add(dir.multiplyScalar(newD));
			ctl.update()
		}
		
		syncSliderFromView();
	}
	
	/* 4. 6-E의 동기화 함수를 각 이벤트 리스너를 통해 오브젝트와 연결 */
	zoomSlider.addEventListener("input", applyViewFromSlider);
	
	mainControls.addEventListener("change", () => {
		if (getActiveControls() == mainControls) syncSliderFromView();	
	})
	
	topviewControls.addEventListener("change", () => {
		if (getActiveControls() == topviewControls) syncSliderFromView();	
	})
	
	/* 5. 초기 동기화 */
	syncSliderFromView();
	
	/* 6. 함수 반환 */
	return { syncSliderFromView };
}
