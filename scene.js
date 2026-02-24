// design_scene.js
import * as THREE from "three";

/**
 * scene에 이전 디자인이 있으면 제거 + dispose
 */
function removeOldDesignRoot(scene) {
	const old = scene.userData?.designRoot;
	if (!old) return;

	old.traverse((obj) => {
		if (obj.geometry) obj.geometry.dispose();
		if (obj.material) {
			if (Array.isArray(obj.material)) {
				for (const m of obj.material) m.dispose();
			} else {
				obj.material.dispose();
			}
		}
	});
	scene.remove(old);
	scene.userData.designRoot = null;
}

/**
 * Design 데이터를 THREE.Scene에 적용
 * - 레이어 평면
 * - 그리드 점
 * - 넷 라인(그룹 색상)
 *
 * @param {THREE.Scene} scene
 * @param {any} design  // path.js의 Design 인스턴스라고 가정
 * @param {Object} [opts]
 * @param {number} [opts.layerGap]    // 레이어 간격 (world unit)
 * @param {number} [opts.pointSize]   // 그리드 점 크기
 * @param {number} [opts.planeOpacity]
 * @param {number} [opts.zLift]       // 선/점이 평면과 z-fighting 안 나도록 살짝 올리는 값
 */
export function applyDesignToScene(scene, design, opts = {}) {
	removeOldDesignRoot(scene);
	
	// 기본 옵션
	const layerGap = opts.layerGap ?? design.layerGap;

	// 그리드 점(구체) 렌더 옵션
	const gridRadius = opts.gridRadius ?? (Math.min(design.dx, design.dy) * 0.10);
	const gridOpacity = opts.gridOpacity ?? 0.45;
	const gridSegments = opts.gridSegments ?? 16;
	const showGridBalls = opts.showGridBalls ?? false;

	// 평면/겹침 방지
	const planeOpacity = opts.planeOpacity ?? 1.0;
	const planeColor = opts.planeColor ?? 0x404040;
	const zLift = opts.zLift ?? (layerGap * 0.005);
	
	// bump/tsv/via 시각화 옵션
	const bumpRadius = opts.bumpRadius ?? design.bumpRadius ?? (Math.min(design.dx, design.dy) * 0.18);
	const tsvRadius = opts.tsvRadius ?? design.tsvRadius ?? (Math.min(design.dx, design.dy) * 0.24);
	const viaRadius = opts.viaRadius ?? design.viaRadius ?? (Math.min(design.dx, design.dy) * 0.14);

	// 매끄러움(세그먼트)
	const diskSegments = opts.diskSegments ?? 32;			// bump/tsv 원
	const viaSegments = opts.viaSegments ?? 20;				// via 원통

	// z-fighting 방지(평면보다 살짝 띄우기)
	const diskZ = opts.diskZ ?? Math.max(zLift * 4, layerGap * 0.002);
	
	const viaRingInnerRatio = opts.viaRingInnerRatio ?? 0.65;
	const viaRingSegments = opts.viaRingSegments ?? 48;
	const viaRingZ = opts.viaRingZ ?? (diskZ + zLift);

	// net 노드(색 구체) 렌더 옵션
	const netNodeRadius = opts.netNodeRadius ?? (gridRadius * 1.55);
	const netNodeOpacity = opts.netNodeOpacity ?? 0.95;
	const netNodeSegments = opts.netNodeSegments ?? 20;

	// net 노드를 그리드보다 위에 보이게 살짝 더 띄우는 값
	const netNodeZ = opts.netNodeZ ?? Math.max(zLift * 3, gridRadius * 0.20);
	
	// 그리드 중앙 정렬: (0..nx-1, 0..ny-1) -> 원점 기준
	const x0 = (design.nx - 1) * design.dx * 0.5;
	const y0 = (design.ny - 1) * design.dy * 0.5;

	function layerZ(layerIndex) {
		return layerIndex * layerGap;
	}

	function nodeToWorld(node, extraZ = 0) {
		const wx = node.x * design.dx - x0;
		const wy = node.y * design.dy - y0;
		const wz = layerZ(node.layer) + extraZ;
		return new THREE.Vector3(wx, wy, wz);
	}

	// 디자인 루트(이것만 통째로 갈아끼우면 됩니다)
	const root = new THREE.Group();
	root.name = "designRoot";
	scene.add(root);
	scene.userData.designRoot = root;
	
	// root 생성 직후에 추가
	const layerGroups = [];
	for (let L = 0; L < design.nlayer; L++) {
		const g = new THREE.Group();
		g.name = `layerGroup:L${L}`;
		root.add(g);
		layerGroups.push(g);
	}

	// via는 레이어 격리 시 숨길 그룹
	const viaGroup = new THREE.Group();
	viaGroup.name = "viaGroup";
	root.add(viaGroup);
	
	const viaRings = [];
	root.userData.viaRings = viaRings;
	const gridLineMeshes = [];
	root.userData.gridLineMeshes = gridLineMeshes;
	root.userData.gridPitch = Math.min(design.dx, design.dy);

	// 격리 토글 함수(외부에서 main.js가 호출)
	root.userData.layerGroups = layerGroups;
	root.userData.viaGroup = viaGroup;
	root.userData.setIsolatedLayer = (layerOrNull) => {
		const iso = (layerOrNull === null || layerOrNull === undefined) ? null : (layerOrNull | 0);
		
		for (const r of viaRings) r.visible = (iso !== null);

		for (let L = 0; L < layerGroups.length; L++) {
			layerGroups[L].visible = (iso === null) ? true : (L === iso);
		}

		// TopView(레이어)에서는 via(원통) 숨김
		viaGroup.visible = (iso === null);
	};

	// 초기 상태: 전체 표시
	root.userData.setIsolatedLayer(null);

	// =========================
	// 1) 레이어 평면
	// =========================
	const w = (design.nx - 1) * design.dx;
	const h = (design.ny - 1) * design.dy;

	for (let L = 0; L < design.nlayer; L++) {
		const planeGeo = new THREE.PlaneGeometry(w, h, 1, 1);
		const planeMat = new THREE.MeshBasicMaterial({
			color : planeColor,
			transparent : true,
			opacity : planeOpacity,
			side : THREE.DoubleSide,
			depthTest : true,
			depthWrite : planeOpacity >= 0.999,
			polygonOffset : true,
			polygonOffsetFactor : 1,
			polygonOffsetUnits : 1,
		});

		const plane = new THREE.Mesh(planeGeo, planeMat);
		plane.position.set(0, 0, layerZ(L));
		plane.renderOrder = -20;
		layerGroups[L].add(plane);
	}
	
	// =========================
	// 1.5) 그리드 선 (레이어별 LineSegments)
	// =========================
	const gridLineStep = Math.max(1, opts.gridLineStep ?? 1);     // 1이면 모든 줄, 2면 한 줄 건너
	const pc = new THREE.Color(planeColor);
	const planeLuma = (0.2126 * pc.r) + (0.7152 * pc.g) + (0.0722 * pc.b);
	const autoGridLineColor = (planeLuma > 0.55) ? 0x1f1f1f : 0xd0d0d0;
	const gridLineColor = opts.gridLineColor ?? autoGridLineColor; // 레이어 색 대비 자동 보정
	const gridLineZ = opts.gridLineZ ?? (zLift * 0.25);           // plane 위로 살짝

	function buildGridLinesGeometry() {
	const pos = [];

	// 세로줄 (x 고정, y 변화)
	for (let xi = 0; xi < design.nx; xi += gridLineStep) {
		const x = xi * design.dx - x0;
		const yA = 0 * design.dy - y0;
		const yB = (design.ny - 1) * design.dy - y0;
		pos.push(x, yA, 0,  x, yB, 0);
	}

	// 가로줄 (y 고정, x 변화)
	for (let yi = 0; yi < design.ny; yi += gridLineStep) {
		const y = yi * design.dy - y0;
		const xA = 0 * design.dx - x0;
		const xB = (design.nx - 1) * design.dx - x0;
		pos.push(xA, y, 0,  xB, y, 0);
	}

	const g = new THREE.BufferGeometry();
	g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
	return g;
	}

	const gridLineGeom = buildGridLinesGeometry();
	const gridLineMat = new THREE.LineBasicMaterial({
	color: gridLineColor,
	transparent: true,
	opacity: 0.9,
	depthTest: true,   // 윗 레이어(불투명) 뒤의 격자는 가려지도록 유지
	depthWrite: false,
	});

	for (let L = 0; L < design.nlayer; L++) {
	const lines = new THREE.LineSegments(gridLineGeom, gridLineMat);
	lines.position.set(0, 0, layerZ(L) + gridLineZ);
	lines.name = `gridLines:L${L}`;
	lines.renderOrder = -15; // plane(-20) 위
	layerGroups[L].add(lines);
	gridLineMeshes.push(lines);
	}

	// =========================
	// 2) 그리드 점 (레이어별 Instanced Sphere 1개)
	//    - 대형 데이터에서 성능 비용이 커서 기본 비활성화
	// =========================
	if (showGridBalls) {
		for (let L = 0; L < design.nlayer; L++) {
			const geom = new THREE.SphereGeometry(gridRadius, gridSegments, gridSegments);
			const mat = new THREE.MeshBasicMaterial({
				color : 0xaaaaaa,
				transparent : false,
				depthTest : true,
				depthWrite : true,
			});

			const count = design.nx * design.ny;
			const inst = new THREE.InstancedMesh(geom, mat, count);

			const m = new THREE.Matrix4();
			const q = new THREE.Quaternion(); // 회전 없음
			const s = new THREE.Vector3(1, 1, 1);
			const p = new THREE.Vector3();

			const z = layerZ(L) + zLift * 0.5;

			let idx = 0;
			for (let y = 0; y < design.ny; y++) {
				for (let x = 0; x < design.nx; x++) {
					p.set(x * design.dx - x0, y * design.dy - y0, z);
					m.compose(p, q, s);
					inst.setMatrixAt(idx++, m);
				}
			}

			inst.instanceMatrix.needsUpdate = true;
			inst.name = `gridBalls:L${L}`;
			inst.renderOrder = -10;
			layerGroups[L].add(inst);
		}
	}

	// =========================
	// 3) 넷 라인 (레이어별로 분리해서 layerGroups[L]에 추가)
	// =========================
	for (const g of design.groups) {
		const color = new THREE.Color(g.color ?? "#FFFFFF");

		for (const n of g.nets) {
			if (!n.enabled) continue;

			const p = n.points();
			if (p.length < 2) continue;

			let curL = p[0].layer;
			let seg = [nodeToWorld(p[0], zLift)];

			function flush(layerIndex, pts) {
				if (!pts || pts.length < 2) return;

				const geom = new THREE.BufferGeometry().setFromPoints(pts);
				const mat = new THREE.LineBasicMaterial({
					color,
					transparent : false,
					depthTest : true,
					depthWrite : true,
				});

				const line = new THREE.Line(geom, mat);
				line.name = `net:${n.nid}:L${layerIndex}`;
				if (layerIndex >= 0 && layerIndex < layerGroups.length) {
					layerGroups[layerIndex].add(line);
				}
			}

			for (let i = 1; i < p.length; i++) {
				const node = p[i];

				if (node.layer !== curL) {
					flush(curL, seg);
					curL = node.layer;
					seg = [nodeToWorld(node, zLift)];
				} else {
					seg.push(nodeToWorld(node, zLift));
				}
			}
			flush(curL, seg);
		}
	}
	
	// =========================
	// 4) bump / tsv : 디스크(원), via : 원통
	// =========================
	function getNetColor(g, n) {
		// NET 안에서 color : "#..." 같은 걸 넣어두셨다면 우선 사용 가능
		if (n.meta && n.meta.color) return String(n.meta.color);
		return String(g.color ?? "#FFFFFF");
	}

	function nodeKey(node) {
		return `${node.type}:${node.layer}:${node.x}:${node.y}`;
	}

	function viaKey(x, y, a, b) {
		const lo = Math.min(a, b);
		const hi = Math.max(a, b);
		return `via:${lo}:${hi}:${x}:${y}`;
	}

	// colorStr -> (Set+Array)
	const bumpByColor = new Map();	// bump disks
	const tsvByColor = new Map();	// tsv disks
	const viaByColor = new Map();	// via cylinders (segments)

	function pushUnique(map, colorStr, key, payload) {
		let obj = map.get(colorStr);
		if (!obj) {
			obj = { set : new Set(), arr : [] };
			map.set(colorStr, obj);
		}
		if (obj.set.has(key)) return;
		obj.set.add(key);
		obj.arr.push(payload);
	}

	// 4-1) 수집: bump/tsv는 노드 자체, via는 “연결할 두 레이어”까지 계산해서 저장
	for (const g of design.groups) {
		const colorStr = String(g.color ?? "#FFFFFF");

		for (const n of g.nets) {
			if (!n.enabled) continue;

			const c = getNetColor(g, n);
			const pts = n.points();

			for (let i = 0; i < pts.length; i++) {
				const cur = pts[i];

				// bump / tsv : 디스크
				if (cur.type === "bump") {
					pushUnique(bumpByColor, c, nodeKey(cur), cur);
					continue;
				}
				if (cur.type === "tsv") {
					pushUnique(tsvByColor, c, nodeKey(cur), cur);
					continue;
				}

				// via : 두 레이어 연결 원통
				if (cur.type === "via") {
					const prev = (i > 0) ? pts[i - 1] : null;
					const next = (i + 1 < pts.length) ? pts[i + 1] : null;

					let a = null;
					let b = null;

					// 보통 prev.layer != cur.layer 또는 cur.layer != next.layer 중 하나가 성립합니다.
					if (prev && prev.layer !== cur.layer) {
						a = prev.layer;
						b = cur.layer;
					} else if (next && next.layer !== cur.layer) {
						a = cur.layer;
						b = next.layer;
					} else {
						continue; // 레이어 변화가 없는 via면 스킵
					}

					pushUnique(viaByColor, c, viaKey(cur.x, cur.y, a, b), {
						x : cur.x,
						y : cur.y,
						a,
						b,
					});
				}
			}
		}
	}

	// 4-2) bump 디스크 인스턴싱
	for (const [colorStr, pack] of bumpByColor.entries()) {
		const all = pack.arr;
		if (all.length === 0) continue;

		// 레이어별로 분리해서 각각 layerGroups[L]에 추가
		const byLayer = new Map();
		for (const node of all) {
			const L = node.layer | 0;
			if (L < 0 || L >= layerGroups.length) continue;
			if (!byLayer.has(L)) byLayer.set(L, []);
			byLayer.get(L).push(node);
		}

		for (const [L, nodes] of byLayer.entries()) {
			if (nodes.length === 0) continue;

			const geom = new THREE.CircleGeometry(bumpRadius, diskSegments);
			const mat = new THREE.MeshBasicMaterial({
				color : new THREE.Color(colorStr),
				transparent : false,
				opacity : 1.0,
				side : THREE.DoubleSide,
				depthTest : true,
				depthWrite : true,
				polygonOffset : true,
				polygonOffsetFactor : -1,
				polygonOffsetUnits : -1,
			});

			const inst = new THREE.InstancedMesh(geom, mat, nodes.length);

			const M = new THREE.Matrix4();
			const Q = new THREE.Quaternion();
			const S = new THREE.Vector3(1, 1, 1);

			for (let i = 0; i < nodes.length; i++) {
				const p = nodeToWorld(nodes[i], diskZ);
				M.compose(p, Q, S);
				inst.setMatrixAt(i, M);
			}

			inst.instanceMatrix.needsUpdate = true;
			inst.name = `bumpDisks:L${L}:${colorStr}`;
			inst.renderOrder = 30;
			layerGroups[L].add(inst);
		}
	}

	// 4-3) tsv 디스크 인스턴싱
	for (const [colorStr, pack] of tsvByColor.entries()) {
		const all = pack.arr;
		if (all.length === 0) continue;

		// 레이어별로 분리해서 각각 layerGroups[L]에 추가
		const byLayer = new Map();
		for (const node of all) {
			const L = node.layer | 0;
			if (L < 0 || L >= layerGroups.length) continue;
			if (!byLayer.has(L)) byLayer.set(L, []);
			byLayer.get(L).push(node);
		}

		for (const [L, nodes] of byLayer.entries()) {
			if (nodes.length === 0) continue;

			const geom = new THREE.CircleGeometry(tsvRadius, diskSegments);
			const mat = new THREE.MeshBasicMaterial({
				color : new THREE.Color(colorStr),
				transparent : false,
				opacity : 1.0,
				side : THREE.DoubleSide,
				depthTest : true,
				depthWrite : true,
				polygonOffset : true,
				polygonOffsetFactor : -1,
				polygonOffsetUnits : -1,
			});

			const inst = new THREE.InstancedMesh(geom, mat, nodes.length);

			const M = new THREE.Matrix4();
			const Q = new THREE.Quaternion();
			const S = new THREE.Vector3(1, 1, 1);

			for (let i = 0; i < nodes.length; i++) {
				const p = nodeToWorld(nodes[i], diskZ);
				M.compose(p, Q, S);
				inst.setMatrixAt(i, M);
			}

			inst.instanceMatrix.needsUpdate = true;
			inst.name = `tsvDisks:L${L}:${colorStr}`;
			inst.renderOrder = 30;
			layerGroups[L].add(inst);
		}
	}

	// 4-4) via 원통 인스턴싱 (두 레이어를 연결)
	for (const [colorStr, pack] of viaByColor.entries()) {
		const all = pack.arr;
		if (all.length === 0) continue;

		// 유효한 via만 필터링
		const vias = [];
		for (const v of all) {
			const z0 = layerZ(v.a);
			const z1 = layerZ(v.b);
			const h = Math.abs(z1 - z0);
			if (h > 1e-9) vias.push(v);
		}
		if (vias.length === 0) continue;

		// 높이 1짜리 원통을 만들고, Z축 방향으로 세워둔 뒤(scale.z로 높이 조절)
		const geom = new THREE.CylinderGeometry(1, 1, 1, viaSegments, 1, false);
		geom.rotateX(Math.PI / 2); // 기본(Y축) -> Z축

		const mat = new THREE.MeshBasicMaterial({
			color : new THREE.Color(colorStr),
			transparent : true,
			opacity : 0.95,
			depthWrite : false,
		});

		const inst = new THREE.InstancedMesh(geom, mat, vias.length);

		const M = new THREE.Matrix4();
		const Q = new THREE.Quaternion();

		for (let i = 0; i < vias.length; i++) {
			const v = vias[i];

			// plane 위 디스크와 살짝 정렬하고 싶으면 +diskZ를 쓰셔도 됩니다.
			const z0 = layerZ(v.a);
			const z1 = layerZ(v.b);

			const midZ = (z0 + z1) * 0.5;
			const h = Math.abs(z1 - z0);

			// (x,y)는 grid 좌표 -> world
			const wx = v.x * design.dx - x0;
			const wy = v.y * design.dy - y0;

			const P = new THREE.Vector3(wx, wy, midZ);
			const height = Math.max(1e-6, h - zLift * 2); // 살짝 짧게(겹침 방지)
			const S = new THREE.Vector3(viaRadius, viaRadius, height);

			M.compose(P, Q, S);
			inst.setMatrixAt(i, M);
		}

		inst.instanceMatrix.needsUpdate = true;
		inst.name = `viaCylinders:${colorStr}`;
		inst.renderOrder = 25;
		viaGroup.add(inst);
	}
	
	// 4-5) via 위치 표시용 도넛 링(레이어별, TopView에서 보이게 layerGroups에 추가)
	for (const [colorStr, pack] of viaByColor.entries()) {
		const all = pack.arr;
		if (all.length === 0) continue;

		// (L|x|y) 중복 제거
		const byLayer = new Map(); // L -> { set:Set, arr:[{x,y}] }

		function pushRing(L, x, y) {
			L = L | 0;
			if (L < 0 || L >= layerGroups.length) return;

			let obj = byLayer.get(L);
			if (!obj) {
				obj = { set : new Set(), arr : [] };
				byLayer.set(L, obj);
			}

			const k = `${x}:${y}`;
			if (obj.set.has(k)) return;

			obj.set.add(k);
			obj.arr.push({ x, y });
		}

		// via는 두 레이어(a,b)에 “접속점”이 생기므로 양쪽 레이어에 링 표시
		for (const v of all) {
			pushRing(v.a, v.x, v.y);
			pushRing(v.b, v.x, v.y);
		}

		for (const [L, obj] of byLayer.entries()) {
			const pts = obj.arr;
			if (pts.length === 0) continue;

			const outerR = viaRadius;
			const innerR = viaRadius * viaRingInnerRatio;

			const geom = new THREE.RingGeometry(innerR, outerR, viaRingSegments);
			const mat = new THREE.MeshBasicMaterial({
				color : new THREE.Color(colorStr),
				transparent : true,
				opacity : 0.95,
				side : THREE.DoubleSide,
				depthWrite : false,
				polygonOffset : true,
				polygonOffsetFactor : -1,
				polygonOffsetUnits : -1,
			});

			const inst = new THREE.InstancedMesh(geom, mat, pts.length);

			const M = new THREE.Matrix4();
			const Q = new THREE.Quaternion();
			const S = new THREE.Vector3(1, 1, 1);

			for (let i = 0; i < pts.length; i++) {
				const nodeLike = { x : pts[i].x, y : pts[i].y, layer : L };
				const p = nodeToWorld(nodeLike, viaRingZ);
				M.compose(p, Q, S);
				inst.setMatrixAt(i, M);
			}

			inst.instanceMatrix.needsUpdate = true;
			inst.name = `viaRings:L${L}:${colorStr}`;
			inst.renderOrder = 28;
			
			viaRings.push(inst);

			// 레이어 격리 시 해당 레이어에서만 보이게
			layerGroups[L].add(inst);
		}
	}
	
	// =========================
	// 5) net 노드 구체 (각 net의 색으로 grid 노드를 덧칠)
	// =========================
	const colorToNodes = new Map(); // colorStr -> { set : Set<string>, arr : Node[] }

	for (const g of design.groups) {
		const groupColor = g.color ?? "#FFFFFF";

		for (const n of g.nets) {
			if (!n.enabled) continue;

			const netColor = (n.meta && n.meta.color) ? String(n.meta.color) : String(groupColor);

			if (!colorToNodes.has(netColor)) {
				colorToNodes.set(netColor, { set : new Set(), arr : [] });
			}
			const pack = colorToNodes.get(netColor);

			for (const node of n.points()) {
				if (node.type !== "grid") continue;

				const key = `${node.layer}:${node.x}:${node.y}`;
				if (pack.set.has(key)) continue;

				pack.set.add(key);
				pack.arr.push(node);
			}
		}
	}

	for (const [colorStr, pack] of colorToNodes.entries()) {
		const all = pack.arr;
		if (all.length === 0) continue;

		// 레이어별로 분리해서 각각 layerGroups[L]에 추가
		const byLayer = new Map();
		for (const node of all) {
			const L = node.layer | 0;
			if (L < 0 || L >= layerGroups.length) continue;
			if (!byLayer.has(L)) byLayer.set(L, []);
			byLayer.get(L).push(node);
		}

		for (const [L, nodes] of byLayer.entries()) {
			if (nodes.length === 0) continue;

			const geom = new THREE.SphereGeometry(netNodeRadius, netNodeSegments, netNodeSegments);
			const mat = new THREE.MeshBasicMaterial({
				color : new THREE.Color(colorStr),
				transparent : true,
				opacity : netNodeOpacity,
				depthWrite : false,
			});

			const inst = new THREE.InstancedMesh(geom, mat, nodes.length);

			const m = new THREE.Matrix4();
			const q = new THREE.Quaternion();
			const s = new THREE.Vector3(1, 1, 1);
			const p = new THREE.Vector3();

			for (let i = 0; i < nodes.length; i++) {
				p.copy(nodeToWorld(nodes[i], netNodeZ));
				m.compose(p, q, s);
				inst.setMatrixAt(i, m);
			}

			inst.instanceMatrix.needsUpdate = true;
			inst.name = `netNodes:L${L}:${colorStr}`;
			inst.renderOrder = 10;
			layerGroups[L].add(inst);
		}
	}
}