// design_scene.js
import * as THREE from "three";

/**
  * Note.
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
  * Note.
  * Note.
  * Note.
  * Note.
 *
 * @param {THREE.Scene} scene
 * @param {any} design // Note.
 * @param {Object} [opts]
 * @param {number} [opts.layerGap] // Note.
 * @param {number} [opts.pointSize] // Note.
 * @param {number} [opts.planeOpacity]
 * @param {number} [opts.gridLineOpacity]
 * @param {number} [opts.zLift] // Note.
 */
export function applyDesignToScene(scene, design, opts = {}) {
	removeOldDesignRoot(scene);

	// Note.
	const layerGap = opts.layerGap ?? design.layerGap;

	// Note.
	const gridRadius = opts.gridRadius ?? (Math.min(design.dx, design.dy) * 0.10);
	const gridOpacity = opts.gridOpacity ?? 0.45;
	const gridSegments = opts.gridSegments ?? 16;
	const showGridBalls = opts.showGridBalls ?? false;

	// Note.
	const planeOpacity = opts.planeOpacity ?? 1.0;
	const planeColor = opts.planeColor ?? 0x404040;
	const zLift = opts.zLift ?? (layerGap * 0.005);

	// Note.
	const bumpRadius = opts.bumpRadius ?? design.bumpRadius ?? (Math.min(design.dx, design.dy) * 0.18);
	const tsvRadius = opts.tsvRadius ?? design.tsvRadius ?? (Math.min(design.dx, design.dy) * 0.24);
	const viaRadius = opts.viaRadius ?? design.viaRadius ?? (Math.min(design.dx, design.dy) * 0.14);
	const viaOpacity = opts.viaOpacity ?? 1.0;

	// Note.
	const diskSegments = opts.diskSegments ?? 32;			// bump/tsv ??
	const viaSegments = opts.viaSegments ?? 20; // Note.

	// Note.
	const diskZ = opts.diskZ ?? Math.max(zLift * 4, layerGap * 0.002);

	const viaRingInnerRatio = opts.viaRingInnerRatio ?? 0.65;
	const viaRingSegments = opts.viaRingSegments ?? 48;
	const viaRingZ = opts.viaRingZ ?? (diskZ + zLift);

	// Note.
	const netNodeRadius = opts.netNodeRadius ?? (gridRadius * 1.55);
	const netNodeOpacity = opts.netNodeOpacity ?? 0.95;
	const netNodeSegments = opts.netNodeSegments ?? 20;

	// Note.
	const netNodeZ = opts.netNodeZ ?? Math.max(zLift * 3, gridRadius * 0.20);

	// Note.
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

	// Note.
	const root = new THREE.Group();
	root.name = "designRoot";
	scene.add(root);
	scene.userData.designRoot = root;

	// Note.
	const layerGroups = [];
	for (let L = 0; L < design.nlayer; L++) {
		const g = new THREE.Group();
		g.name = `layerGroup:L${L}`;
		root.add(g);
		layerGroups.push(g);
	}

	// Note.
	const viaGroup = new THREE.Group();
	viaGroup.name = "viaGroup";
	root.add(viaGroup);

	const viaRings = [];
	root.userData.viaRings = viaRings;
	const gridLineMeshes = [];
	const netLineMeshes = [];
	const planeMeshes = [];
	const componentNetIndex = new Map();
	root.userData.gridLineMeshes = gridLineMeshes;
	root.userData.netLineMeshes = netLineMeshes;
	root.userData.planeMeshes = planeMeshes;
	root.userData.componentNetIndex = componentNetIndex;
	root.userData.gridPitch = Math.min(design.dx, design.dy);

	// Note.
	root.userData.layerGroups = layerGroups;
	root.userData.viaGroup = viaGroup;
	root.userData.setIsolatedLayer = (layerOrNull) => {
		const iso = (layerOrNull === null || layerOrNull === undefined) ? null : (layerOrNull | 0);

		for (const r of viaRings) r.visible = (iso !== null);

		for (let L = 0; L < layerGroups.length; L++) {
			layerGroups[L].visible = (iso === null) ? true : (L === iso);
		}

		// Note.
		viaGroup.visible = (iso === null);
	};

	// Note.
	root.userData.setIsolatedLayer(null);

	// =========================
	// Note.
	// =========================
	const w = (design.nx - 1) * design.dx;
	const h = (design.ny - 1) * design.dy;

	for (let L = 0; L < design.nlayer; L++) {
		const planeGeo = new THREE.PlaneGeometry(w, h, 1, 1);
		const planeOpaque = planeOpacity >= 0.999;
		const planeMat = new THREE.MeshBasicMaterial({
			color : planeColor,
			transparent : !planeOpaque,
			opacity : planeOpacity,
			side : THREE.DoubleSide,
			depthTest : true,
			// Note.
			// Note.
			depthWrite : planeOpaque,
			polygonOffset : true,
			polygonOffsetFactor : 1,
			polygonOffsetUnits : 1,
		});

		const plane = new THREE.Mesh(planeGeo, planeMat);
		plane.position.set(0, 0, layerZ(L));
		plane.renderOrder = -20;
		layerGroups[L].add(plane);
		planeMeshes.push(plane);
	}

	// =========================
	// Note.
	// =========================
	const baseGridLineStep = Math.max(1, opts.gridLineStep ?? 1); // Note.
	const defaultGridLineLodSteps = [1, 2, 4, 8, 16, 32, 64, 128];
	const gridLineLodSteps = Array.isArray(opts.gridLineLodSteps) && opts.gridLineLodSteps.length > 0
		? opts.gridLineLodSteps
		: defaultGridLineLodSteps;
	const maxGridLineStep = Math.max(1, design.nx - 1, design.ny - 1);
	const normalizedGridSteps = [...new Set(
		gridLineLodSteps
			.map((v) => Math.max(baseGridLineStep, Math.floor(Number(v) || 1)))
			.filter((v) => Number.isFinite(v) && v >= baseGridLineStep && v <= maxGridLineStep)
	)].sort((a, b) => a - b);
	if (normalizedGridSteps.length === 0 || normalizedGridSteps[0] !== baseGridLineStep) {
		normalizedGridSteps.unshift(baseGridLineStep);
	}
	const pc = new THREE.Color(planeColor);
	const planeLuma = (0.2126 * pc.r) + (0.7152 * pc.g) + (0.0722 * pc.b);
	const autoGridLineColor = (planeLuma > 0.55) ? 0x1f1f1f : 0xd0d0d0;
	const gridLineColor = opts.gridLineColor ?? autoGridLineColor; // Note.
	const gridLineOpacity = opts.gridLineOpacity ?? 0.32;
	const gridLineZ = opts.gridLineZ ?? (zLift * 0.25); // Note.

	function buildGridLinesGeometry(step) {
	const pos = [];

	// Note.
	for (let xi = 0; xi < design.nx; xi += step) {
		const x = xi * design.dx - x0;
		const yA = 0 * design.dy - y0;
		const yB = (design.ny - 1) * design.dy - y0;
		pos.push(x, yA, 0,  x, yB, 0);
	}

	// Note.
	for (let yi = 0; yi < design.ny; yi += step) {
		const y = yi * design.dy - y0;
		const xA = 0 * design.dx - x0;
		const xB = (design.nx - 1) * design.dx - x0;
		pos.push(xA, y, 0,  xB, y, 0);
	}

	const g = new THREE.BufferGeometry();
	g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
	return g;
	}

	const gridLineMat = new THREE.LineBasicMaterial({
	color: gridLineColor,
	transparent: true,
	opacity: gridLineOpacity,
	depthTest: true, // Note.
	depthWrite: false,
	});
	root.userData.gridLineMaterial = gridLineMat;
	const gridLineLodLevels = [];
	root.userData.gridLineLodLevels = gridLineLodLevels;

	for (const step of normalizedGridSteps) {
		const gridLineGeom = buildGridLinesGeometry(step);
		const levelMeshes = [];
		for (let L = 0; L < design.nlayer; L++) {
			const lines = new THREE.LineSegments(gridLineGeom, gridLineMat);
			lines.position.set(0, 0, layerZ(L) + gridLineZ);
			lines.name = `gridLines:L${L}:S${step}`;
			lines.renderOrder = -15; // plane(-20) above
			lines.userData.gridLineStep = step;
			lines.visible = (step === baseGridLineStep);
			layerGroups[L].add(lines);
			levelMeshes.push(lines);
			if (step === baseGridLineStep) gridLineMeshes.push(lines);
		}
		gridLineLodLevels.push({ step, meshes : levelMeshes });
	}
	root.userData.gridLineCurrentStep = baseGridLineStep;

	// =========================
	// Note.
	// Note.
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
			const q = new THREE.Quaternion(); // Note.
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
	// Note.
	// =========================
	const mergedLinePacks = new Map();

	function toMergedLineKey(layerIndex, colorStr) {
		return `${layerIndex}|${colorStr}`;
	}

	function getMergedLinePack(layerIndex, colorStr, colorObj) {
		const key = toMergedLineKey(layerIndex, colorStr);
		let pack = mergedLinePacks.get(key);
		if (!pack) {
			pack = {
				layerIndex,
				colorStr,
				colorObj : colorObj.clone(),
				positions : [],
				segmentNetIds : [],
			};
			mergedLinePacks.set(key, pack);
		}
		return pack;
	}

	function isCollinearMiddlePoint(a, b, c) {
		const abx = b.x - a.x;
		const aby = b.y - a.y;
		const abz = b.z - a.z;
		const bcx = c.x - b.x;
		const bcy = c.y - b.y;
		const bcz = c.z - b.z;
		const cx = (aby * bcz) - (abz * bcy);
		const cy = (abz * bcx) - (abx * bcz);
		const cz = (abx * bcy) - (aby * bcx);
		const crossLenSq = (cx * cx) + (cy * cy) + (cz * cz);
		const dot = (abx * bcx) + (aby * bcy) + (abz * bcz);
		return crossLenSq <= 1e-12 && dot >= 0;
	}

	function simplifyPolylinePoints(points) {
		if (!Array.isArray(points) || points.length <= 2) return points ?? [];
		const out = [points[0]];
		for (let i = 1; i < points.length - 1; i++) {
			const a = out[out.length - 1];
			const b = points[i];
			const c = points[i + 1];
			if (isCollinearMiddlePoint(a, b, c)) continue;
			out.push(b);
		}
		out.push(points[points.length - 1]);
		return out;
	}

	function sameGridNodeCoord(a, b) {
		if (!a || !b) return false;
		return Number(a.layer) === Number(b.layer) &&
			Number(a.x) === Number(b.x) &&
			Number(a.y) === Number(b.y);
	}

	function shouldSkipManualBreakSegment(net, aNode, bNode) {
		const br = net?.__manualRouteBreak;
		if (!br) return false;
		const tip = br.tip;
		const reconnect = br.reconnect;
		if (!tip || !reconnect) return false;
		const direct = sameGridNodeCoord(aNode, tip) && sameGridNodeCoord(bNode, reconnect);
		const reverse = sameGridNodeCoord(aNode, reconnect) && sameGridNodeCoord(bNode, tip);
		return direct || reverse;
	}

	function flushMergedLineRun(layerIndex, points, colorStr, colorObj, nid) {
		if (!Array.isArray(points) || points.length < 2) return;
		if (layerIndex < 0 || layerIndex >= layerGroups.length) return;
		const simplified = simplifyPolylinePoints(points);
		if (simplified.length < 2) return;
		const pack = getMergedLinePack(layerIndex, colorStr, colorObj);
		const sid = String(nid);
		for (let i = 1; i < simplified.length; i++) {
			const a = simplified[i - 1];
			const b = simplified[i];
			pack.positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
			pack.segmentNetIds.push(sid);
		}
	}

	for (const g of design.groups) {
		const colorStr = String(g.color ?? "#FFFFFF");
		const color = new THREE.Color(colorStr);

		for (const n of g.nets) {
			if (!n.enabled) continue;
			// Draw net line only for explicit routed paths; never auto-connect start/end.
			if (!Array.isArray(n.path) || n.path.length === 0) continue;

			const p = n.points();
			if (p.length < 2) continue;

			let curL = p[0].layer;
			let seg = [nodeToWorld(p[0], zLift)];

			for (let i = 1; i < p.length; i++) {
				const prevNode = p[i - 1];
				const node = p[i];
				if (shouldSkipManualBreakSegment(n, prevNode, node)) {
					flushMergedLineRun(curL, seg, colorStr, color, n.nid);
					curL = node.layer;
					seg = [nodeToWorld(node, zLift)];
					continue;
				}

				if (node.layer !== curL) {
					flushMergedLineRun(curL, seg, colorStr, color, n.nid);
					curL = node.layer;
					seg = [nodeToWorld(node, zLift)];
				} else {
					seg.push(nodeToWorld(node, zLift));
				}
			}
			flushMergedLineRun(curL, seg, colorStr, color, n.nid);
		}
	}

	for (const pack of mergedLinePacks.values()) {
		if (!pack.positions || pack.positions.length === 0) continue;
		const geom = new THREE.BufferGeometry();
		geom.setAttribute("position", new THREE.Float32BufferAttribute(pack.positions, 3));
		const mat = new THREE.LineBasicMaterial({
			color : pack.colorObj,
			transparent : false,
			depthTest : true,
			depthWrite : true,
		});
		const line = new THREE.LineSegments(geom, mat);
		line.name = `netMergedLines:L${pack.layerIndex}:${pack.colorStr}`;
		line.userData.segmentNetIds = pack.segmentNetIds;
		line.renderOrder = 5;
		layerGroups[pack.layerIndex].add(line);
		netLineMeshes.push(line);
	}

	// =========================
	// Note.
	// =========================
	function getNetColor(g, n) {
		// Note.
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


	function addComponentNet(key, nid) {
		if (!key || nid === undefined || nid === null) return;
		const sid = String(nid);
		let set = componentNetIndex.get(key);
		if (!set) {
			set = new Set();
			componentNetIndex.set(key, set);
		}
		set.add(sid);
	}

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

	// Note.
	for (const g of design.groups) {
		const colorStr = String(g.color ?? "#FFFFFF");

		for (const n of g.nets) {
			if (!n.enabled) continue;

			const c = getNetColor(g, n);
			const pts = n.points();

			for (let i = 0; i < pts.length; i++) {
				const cur = pts[i];

				// Note.
				if (cur.type === "bump") {
					const k = nodeKey(cur);
					pushUnique(bumpByColor, c, k, cur);
					addComponentNet(`bump:${k}`, n.nid);
					continue;
				}
				if (cur.type === "tsv") {
					const k = nodeKey(cur);
					pushUnique(tsvByColor, c, k, cur);
					addComponentNet(`tsv:${k}`, n.nid);
					continue;
				}

				// Note.
				if (cur.type === "via") {
					const prev = (i > 0) ? pts[i - 1] : null;
					const next = (i + 1 < pts.length) ? pts[i + 1] : null;

					let a = null;
					let b = null;

					// Note.
					if (prev && prev.layer !== cur.layer) {
						a = prev.layer;
						b = cur.layer;
					} else if (next && next.layer !== cur.layer) {
						a = cur.layer;
						b = next.layer;
					} else {
						continue; // Note.
					}

					const rawViaRadius = Number(cur?.meta?.radius);
					const viaNodeRadius = (Number.isFinite(rawViaRadius) && rawViaRadius > 0) ? rawViaRadius : viaRadius;
					const vk = viaKey(cur.x, cur.y, a, b);
					pushUnique(viaByColor, c, vk, {
						x : cur.x,
						y : cur.y,
						a,
						b,
						radius : viaNodeRadius,
					});
					addComponentNet(vk, n.nid);
					addComponentNet(`viaRing:${a}:${cur.x}:${cur.y}`, n.nid);
					addComponentNet(`viaRing:${b}:${cur.x}:${cur.y}`, n.nid);
				}
			}
		}
	}

	// Note.
	for (const [colorStr, pack] of bumpByColor.entries()) {
		const all = pack.arr;
		if (all.length === 0) continue;

		// Note.
		const byLayer = new Map();
		for (const node of all) {
			const L = node.layer | 0;
			if (L < 0 || L >= layerGroups.length) continue;
			if (!byLayer.has(L)) byLayer.set(L, []);
			byLayer.get(L).push(node);
		}

		for (const [L, nodes] of byLayer.entries()) {
			if (nodes.length === 0) continue;

			const radiusBuckets = new Map();
			for (const node of nodes) {
				const rawRadius = Number(node?.meta?.radius);
				const radius = (Number.isFinite(rawRadius) && rawRadius > 0) ? rawRadius : bumpRadius;
				const radiusKey = radius.toFixed(6);
				let bucket = radiusBuckets.get(radiusKey);
				if (!bucket) {
					bucket = { radius, nodes : [] };
					radiusBuckets.set(radiusKey, bucket);
				}
				bucket.nodes.push(node);
			}

			for (const bucket of radiusBuckets.values()) {
				const bucketNodes = bucket.nodes;
				if (!Array.isArray(bucketNodes) || bucketNodes.length === 0) continue;

				const geom = new THREE.CircleGeometry(bucket.radius, diskSegments);
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

				const inst = new THREE.InstancedMesh(geom, mat, bucketNodes.length);

				const M = new THREE.Matrix4();
				const Q = new THREE.Quaternion();
				const S = new THREE.Vector3(1, 1, 1);

				for (let i = 0; i < bucketNodes.length; i++) {
					const p = nodeToWorld(bucketNodes[i], diskZ);
					M.compose(p, Q, S);
					inst.setMatrixAt(i, M);
				}

				inst.instanceMatrix.needsUpdate = true;
				inst.name = `bumpDisks:L${L}:${colorStr}`;
				inst.renderOrder = 30;
				inst.userData.pickKeys = bucketNodes.map((node) => `bump:${nodeKey(node)}`);
				layerGroups[L].add(inst);
			}
		}
	}

	// Note.
	for (const [colorStr, pack] of tsvByColor.entries()) {
		const all = pack.arr;
		if (all.length === 0) continue;

		// Note.
		const byLayer = new Map();
		for (const node of all) {
			const L = node.layer | 0;
			if (L < 0 || L >= layerGroups.length) continue;
			if (!byLayer.has(L)) byLayer.set(L, []);
			byLayer.get(L).push(node);
		}

		for (const [L, nodes] of byLayer.entries()) {
			if (nodes.length === 0) continue;

			const radiusBuckets = new Map();
			for (const node of nodes) {
				const rawRadius = Number(node?.meta?.radius);
				const radius = (Number.isFinite(rawRadius) && rawRadius > 0) ? rawRadius : tsvRadius;
				const radiusKey = radius.toFixed(6);
				let bucket = radiusBuckets.get(radiusKey);
				if (!bucket) {
					bucket = { radius, nodes : [] };
					radiusBuckets.set(radiusKey, bucket);
				}
				bucket.nodes.push(node);
			}

			for (const bucket of radiusBuckets.values()) {
				const bucketNodes = bucket.nodes;
				if (!Array.isArray(bucketNodes) || bucketNodes.length === 0) continue;

				const geom = new THREE.CircleGeometry(bucket.radius, diskSegments);
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

				const inst = new THREE.InstancedMesh(geom, mat, bucketNodes.length);

				const M = new THREE.Matrix4();
				const Q = new THREE.Quaternion();
				const S = new THREE.Vector3(1, 1, 1);

				for (let i = 0; i < bucketNodes.length; i++) {
					const p = nodeToWorld(bucketNodes[i], diskZ);
					M.compose(p, Q, S);
					inst.setMatrixAt(i, M);
				}

				inst.instanceMatrix.needsUpdate = true;
				inst.name = `tsvDisks:L${L}:${colorStr}`;
				inst.renderOrder = 30;
				inst.userData.pickKeys = bucketNodes.map((node) => `tsv:${nodeKey(node)}`);
				layerGroups[L].add(inst);
			}
		}
	}

	// Note.
	for (const [colorStr, pack] of viaByColor.entries()) {
		const all = pack.arr;
		if (all.length === 0) continue;

		// Note.
		const vias = [];
		for (const v of all) {
			const z0 = layerZ(v.a);
			const z1 = layerZ(v.b);
			const h = Math.abs(z1 - z0);
			if (h > 1e-9) vias.push(v);
		}
		if (vias.length === 0) continue;

		// Note.
		const geom = new THREE.CylinderGeometry(1, 1, 1, viaSegments, 1, false);
		geom.rotateX(Math.PI / 2); // Note.

		const viaOpaque = viaOpacity >= 0.999;
		const mat = new THREE.MeshBasicMaterial({
			color : new THREE.Color(colorStr),
			transparent : !viaOpaque,
			opacity : viaOpacity,
			depthTest : true,
			depthWrite : viaOpaque,
		});

		const inst = new THREE.InstancedMesh(geom, mat, vias.length);

		const M = new THREE.Matrix4();
		const Q = new THREE.Quaternion();

		for (let i = 0; i < vias.length; i++) {
			const v = vias[i];

			// Note.
			const z0 = layerZ(v.a);
			const z1 = layerZ(v.b);

			const midZ = (z0 + z1) * 0.5;
			const h = Math.abs(z1 - z0);

			// Note.
			const wx = v.x * design.dx - x0;
			const wy = v.y * design.dy - y0;

			const P = new THREE.Vector3(wx, wy, midZ);
			const height = Math.max(1e-6, h - zLift * 2); // Note.
			const radius = (Number.isFinite(Number(v?.radius)) && Number(v.radius) > 0) ? Number(v.radius) : viaRadius;
			const S = new THREE.Vector3(radius, radius, height);

			M.compose(P, Q, S);
			inst.setMatrixAt(i, M);
		}

		inst.instanceMatrix.needsUpdate = true;
		inst.name = `viaCylinders:${colorStr}`;
		inst.renderOrder = 25;
		inst.userData.pickKeys = vias.map((v) => viaKey(v.x, v.y, v.a, v.b));
		viaGroup.add(inst);
	}

	// Note.
	for (const [colorStr, pack] of viaByColor.entries()) {
		const all = pack.arr;
		if (all.length === 0) continue;

		// Note.
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

		// Note.
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
			inst.userData.pickKeys = pts.map((pt) => `viaRing:${L}:${pt.x}:${pt.y}`);

			viaRings.push(inst);

			// Note.
			layerGroups[L].add(inst);
		}
	}

	// =========================
	// Note.
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
				addComponentNet(`grid:${key}`, n.nid);
				if (pack.set.has(key)) continue;

				pack.set.add(key);
				pack.arr.push(node);
			}
		}
	}

	const totalNetNodeCount = Array.from(colorToNodes.values()).reduce((sum, item) => sum + (item.arr?.length ?? 0), 0);
	const maxNetNodeCount = Math.max(1, Number(opts.maxNetNodeCount ?? 12000) || 12000);
	// Grid node circles can clutter manual routing feedback; keep them off unless explicitly enabled.
	const renderNetNodes = (opts.showNetNodes ?? false) && totalNetNodeCount <= maxNetNodeCount;
	root.userData.netNodesRendered = renderNetNodes;
	root.userData.netNodesCount = totalNetNodeCount;

	if (!renderNetNodes) {
		return;
	}

	for (const [colorStr, pack] of colorToNodes.entries()) {

		const all = pack.arr;
		if (all.length === 0) continue;

		// Note.
		const byLayer = new Map();
		for (const node of all) {
			const L = node.layer | 0;
			if (L < 0 || L >= layerGroups.length) continue;
			if (!byLayer.has(L)) byLayer.set(L, []);
			byLayer.get(L).push(node);
		}

		for (const [L, nodes] of byLayer.entries()) {
			if (nodes.length === 0) continue;

			const effectiveSeg = (totalNetNodeCount > 6000) ? Math.min(netNodeSegments, 10) : netNodeSegments;
			const geom = new THREE.SphereGeometry(netNodeRadius, effectiveSeg, effectiveSeg);
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
			inst.userData.pickKeys = nodes.map((node) => `grid:${node.layer}:${node.x}:${node.y}`);
			layerGroups[L].add(inst);
		}
	}
}


function normalizeHexColor(input, fallback) {
	if (input === undefined || input === null) return fallback;
	if (typeof input === "number" && Number.isFinite(input)) return input;
	const str = String(input).trim();
	const parsed = Number.parseInt(str.replace(/^#/, ""), 16);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp01(v) {
	return Math.min(1, Math.max(0, Number(v) || 0));
}

export function updateDesignStyleInScene(scene, opts = {}) {
	const root = scene?.userData?.designRoot;
	if (!root) return false;

	const planeColor = normalizeHexColor(opts.planeColor, 0x404040);
	const planeOpacity = clamp01(opts.planeOpacity ?? 0.0);
	const gridLineColor = normalizeHexColor(opts.gridLineColor, 0x575757);
	const gridLineOpacity = clamp01(opts.gridLineOpacity ?? 0.32);

	const planeOpaque = planeOpacity >= 0.999;
	const planeMeshes = Array.isArray(root.userData?.planeMeshes) ? root.userData.planeMeshes : [];
	for (const plane of planeMeshes) {
		const mat = plane?.material;
		if (!mat) continue;
		mat.color.setHex(planeColor);
		mat.opacity = planeOpacity;
		mat.transparent = !planeOpaque;
		mat.depthWrite = planeOpaque;
		mat.needsUpdate = true;
	}

	const gridLineMat = root.userData?.gridLineMaterial;
	if (gridLineMat) {
		gridLineMat.color.setHex(gridLineColor);
		gridLineMat.opacity = gridLineOpacity;
		gridLineMat.needsUpdate = true;
	}

	return true;
}
