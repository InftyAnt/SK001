import * as THREE from "three";

function clamp01(x) {
	return Math.max(0, Math.min(1, x));
}

function clamp11(x) {
	return Math.max(-1, Math.min(1, x));
}

function easeInOutCubic(u) {
	return u < 0.5 ? 4 * u * u * u : 1 - 4 * (1 - u) * (1 - u) * (1 - u);
}

function wrapPi(a) {
	a = (a + Math.PI) % (2 * Math.PI);
	if (a < 0) a += 2 * Math.PI;
	return a - Math.PI;
}

function shortestAngleDelta(a, b) {
	return wrapPi(b - a);
}

function vecToSphericalZ(v) {
	const r = v.length();
	if (r < 1e-12) return { r : 0, theta : 0, phi : 0 };
	
	const theta = Math.acos(clamp11(v.z / r));
	const phi = Math.atan2(v.y, v.x);
	return { r, theta, phi };
}

function sphericalZToVec(r, theta, phi, out = new THREE.Vector3()) {
	const s = Math.sin(theta);
	out.set(
		r * s * Math.cos(phi),
		r * s * Math.sin(phi),
		r * Math.cos(theta)
	);
	return out;
}

export function createPerspCameraMover({
	getActiveCamera,
	getActiveControls,
	durationMs = 600,
	defaultCenter = new THREE.Vector3(0, 0, 0),
}) {
	let anim = null;
	
	function isMoving() {
		return !!anim;
	}
	
	function moveTo({ toPosition, toTarget, center }) {
		const cam = getActiveCamera();
		const ctl = getActiveControls();
		
		const fromPosition = cam.position.clone();
		const fromTarget = ctl.target.clone();
		
		const C = (center ? center.clone() : defaultCenter.clone());
		
		const fromOff = fromPosition.clone().sub(C);
		const toOff = toPosition.clone().sub(C);
		
		const P0 = vecToSphericalZ(fromOff);
		const P1 = vecToSphericalZ(toOff);
		
		const dir0 = fromTarget.clone().sub(fromPosition);
		const dist0 = Math.max(dir0.length(), 1e-6);
		dir0.divideScalar(dist0);
		
		let dir1 = dir0.clone();
		let dist1 = dist0;
		
		if (toTarget) {
			dir1 = toTarget.clone().sub(toPosition);
			dist1 = Math.max(dir1.length(), 1e-6);
			dir1.divideScalar(dist1);
		}
		
		const D0 = vecToSphericalZ(dir0);
		const D1 = vecToSphericalZ(dir1);
		
		const dPhiPos = shortestAngleDelta(P0.phi, P1.phi);
		
		let dPhiDir = shortestAngleDelta(D0.phi, D1.phi);
		
		const start = performance.now();
		
		let resolveFn;
		const done = new Promise((resolve) => (resolveFn = resolve));
		
		anim = {
			start,
			C,
			r0 : P0.r, r1 : P1.r,
			th0 : P0.theta, th1 : P1.theta,
			ph0 : P0.phi, ph1 : P1.phi,
			
			dth0 : D0.theta, dth1 : D1.theta,
			dph0 : D0.phi, dph1 : D1.phi,
			dist0, dist1,
			
			toPosition : toPosition.clone(),
			toTarget : toTarget ? toTarget.clone() : null,
			
			resolve : resolveFn,
			dPhiPos,
			dPhiDir,
		};
		
		return done;
	}
	
	function update(now = performance.now()) {
		if (!anim) return;
		
		const cam = getActiveCamera();
		const ctl = getActiveControls();
		
		const u = clamp01((now - anim.start) / durationMs);
		const t = easeInOutCubic(u);
		
		const r = anim.r0 + (anim.r1 - anim.r0) * t;
		const theta = anim.th0 + (anim.th1 - anim.th0) * t;
		const phi = anim.ph0 + anim.dPhiPos * t;
		
		const off = sphericalZToVec(r, theta, phi);
		const pos = off.add(anim.C);
		
		const dtheta = anim.dth0 + (anim.dth1 - anim.dth0) * t;
		const dphi = anim.dph0 + anim.dPhiDir * t;
		
		const dir = sphericalZToVec(1, dtheta, dphi).normalize();
		
		const dist = anim.dist0 + (anim.dist1 - anim.dist0) * t;
		
		const target = pos.clone().add(dir.multiplyScalar(dist));
		
		cam.position.copy(pos);
		ctl.target.copy(target);
		cam.lookAt(ctl.target);
		ctl.update();
		
		if (u >= 1) {
			cam.position.copy(anim.toPosition);
			
			if (anim.toTarget) {
				ctl.target.copy(anim.toTarget);
			}
			
			cam.lookAt(ctl.target);
			ctl.update();
			
			const resolve = anim.resolve;
			anim = null;
			resolve();
		}
	}
	
	return { moveTo, update, isMoving };
}

export function createOrthoCameraMover({
	getCamera,
	getControls,
	durationMs = 600,
	onAfterUpdate = null,
}) {
	let anim = null;

	function isMoving() {
		return !!anim;
	}

	function cancel() {
		anim = null;
	}

	function lerpLog(a, b, t) {
		a = Math.max(a, 1e-9);
		b = Math.max(b, 1e-9);
		return Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * t);
	}

	function moveTo({
		toPosition,
		toTarget,
		toZoom,
		minZoom,
		maxZoom,
	}) {
		const cam = getCamera();
		const ctl = getControls();

		// Note.
		if (minZoom !== undefined) ctl.minZoom = minZoom;
		if (maxZoom !== undefined) ctl.maxZoom = maxZoom;

		const fromPosition = cam.position.clone();
		const fromTarget = ctl.target.clone();
		const fromZoom = cam.zoom;

		anim = {
			start : performance.now(),

			fromPosition,
			toPosition : toPosition.clone(),

			fromTarget,
			toTarget : toTarget.clone(),

			fromZoom,
			toZoom : Math.max(toZoom, 1e-9),
		};
	}

	function update(now = performance.now()) {
		if (!anim) return;

		const cam = getCamera();
		const ctl = getControls();

		const u = clamp01((now - anim.start) / durationMs);
		const t = easeInOutCubic(u);

		cam.position.lerpVectors(anim.fromPosition, anim.toPosition, t);
		ctl.target.lerpVectors(anim.fromTarget, anim.toTarget, t);

		cam.zoom = lerpLog(anim.fromZoom, anim.toZoom, t);
		cam.updateProjectionMatrix();

		cam.lookAt(ctl.target);
		ctl.update();

		if (onAfterUpdate) onAfterUpdate();

		if (u >= 1) {
			cam.position.copy(anim.toPosition);
			ctl.target.copy(anim.toTarget);
			cam.zoom = anim.toZoom;

			cam.updateProjectionMatrix();
			ctl.update();

			if (onAfterUpdate) onAfterUpdate();

			anim = null;
		}
	}

	return { moveTo, update, isMoving, cancel };
}
