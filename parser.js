import { Design, Group, Net, Node, NodeType, Tristate } from "./path.js";

function stripComment(line) {
	const t = line.trim();
	if (!t) return "";
	if (t.startsWith("#")) return "";
	if (t.startsWith("//")) return "";
	return line;
}

function parseValue(raw) {
	let s = raw.trim();
	if (!s) return "";

	// Note.
	if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
		return s.slice(1, -1);
	}

	// bool
	const sl = s.toLowerCase();
	if (sl === "true") return true;
	if (sl === "false") return false;
	if (sl === "null") return null;

	// Note.
	if (s === "0") return 0;
	if (s === "1") return 1;

	// number
	const n = Number(s);
	if (Number.isFinite(n)) return n;

	return s;
}

function parseKeyValue(line) {
	const idx = line.indexOf(":");
	if (idx < 0) return null;
	const key = line.slice(0, idx).trim();
	const value = line.slice(idx + 1).trim();
	if (!key) return null;
	return { key, value };
}

function normalizeNodeType(t) {
	const v = (t || "").toLowerCase();
	// Note.
	if (v === NodeType.BUMP) return NodeType.BUMP;
	if (v === NodeType.TSV) return NodeType.TSV;
	if (v === NodeType.VIA) return NodeType.VIA;
	if (v === NodeType.GRID) return NodeType.GRID;
	return v; // Note.
}

/**
 * node spec:
 *   type x y layer [k=v ...]
 */
function parseNodeSpec(spec) {
	const toks = spec.trim().split(/\s+/);
	if (toks.length < 4) {
		throw new Error(`Invalid node spec: "${spec}"`);
	}

	const type = normalizeNodeType(toks[0]);
	const x = Number(toks[1]);
	const y = Number(toks[2]);
	const layer = Number(toks[3]);

	if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(layer)) {
		throw new Error(`Invalid node numbers: "${spec}"`);
	}

	const meta = {};
	for (const tok of toks.slice(4)) {
		const eq = tok.indexOf("=");
		if (eq < 0) continue;
		const k = tok.slice(0, eq).trim();
		const v = tok.slice(eq + 1).trim();
		if (!k) continue;
		meta[k] = parseValue(v);
	}

	return new Node({ type, x, y, layer, meta });
}

function normalizeTristate(v) {
	const s = String(v).trim().toLowerCase();
	if (s === Tristate.ON) return Tristate.ON;
	if (s === Tristate.OFF) return Tristate.OFF;
	if (s === Tristate.PARTIAL) return Tristate.PARTIAL;
	throw new Error(`Invalid Tristate: "${v}" (expected on/off/partial)`);
}

function toBool01(v) {
	if (typeof v === "boolean") return v;
	if (typeof v === "number") return v !== 0;
	const s = String(v).trim().toLowerCase();
	if (s === "1" || s === "true" || s === "on") return true;
	if (s === "0" || s === "false" || s === "off") return false;
	return !!v;
}

/**
 * Parse raw text -> Design instance
 * @param {string} rawText
 * @returns {Design}
 */
export function parseDesignText(rawText) {
	const lines = rawText.split(/\r?\n/);

	// Note.
	const designProps = {
		nlayer : null,
		nx : null,
		ny : null,
		dx : null,
		dy : null,
		layerGap : null,
		bumpRadius : null,
		tsvRadius : null,
		viaRadius : null,
	};

	const designMeta = {};
	const groups = [];

	let mode = null;				// "design" | "group" | "net" | "path" | "vias" | "meta"
	let metaReturnMode = null;
	let metaTarget = null;

	let curGroup = null;			// { gid, name, color, state, meta, nets: [] }
	let curNet = null;				// { nid, name, gid, enabled, bendCount, pathLen, start, end, path, vias, meta }

	function startMetaBlock() {
		metaReturnMode = mode;
		mode = "meta";
		if (curNet) metaTarget = curNet.meta;
		else if (curGroup) metaTarget = curGroup.meta;
		else metaTarget = designMeta;
	}

	for (let lineNo = 0; lineNo < lines.length; lineNo++) {
		let line = stripComment(lines[lineNo]);
		if (!line) continue;

		line = line.trim();
		if (!line) continue;

		// Note.
		if (mode === "path") {
			if (line === "ENDPATH") {
				mode = "net";
				continue;
			}
			if (!curNet) throw new Error(`PATH without NET at line ${lineNo + 1}`);
			curNet.path.push(parseNodeSpec(line));
			continue;
		}

		if (mode === "vias") {
			if (line === "ENDVIAS") {
				mode = "net";
				continue;
			}
			if (!curNet) throw new Error(`VIAS without NET at line ${lineNo + 1}`);
			curNet.vias.push(parseNodeSpec(line));
			continue;
		}

		if (mode === "meta") {
			if (line === "ENDMETA") {
				mode = metaReturnMode;
				metaReturnMode = null;
				metaTarget = null;
				continue;
			}
			const kv = parseKeyValue(line);
			if (!kv) throw new Error(`META expects key:value at line ${lineNo + 1}`);
			metaTarget[kv.key] = parseValue(kv.value);
			continue;
		}

		// Note.
		if (line === "DESIGN") {
			mode = "design";
			continue;
		}
		if (line === "ENDDESIGN") {
			mode = null;
			continue;
		}

		if (line.startsWith("GROUP ")) {
			const gid = line.slice(6).trim();
			if (!gid) throw new Error(`GROUP requires gid at line ${lineNo + 1}`);
			curGroup = {
				gid,
				name : gid,
				color : "#FFFFFF",
				state : Tristate.ON,
				meta : {},
				nets : [],
			};
			mode = "group";
			continue;
		}
		if (line === "ENDGROUP") {
			if (!curGroup) throw new Error(`ENDGROUP without GROUP at line ${lineNo + 1}`);
			const g = new Group({
				name : curGroup.name,
				gid : curGroup.gid,
				nets : curGroup.nets,
				state : curGroup.state,
				color : curGroup.color,
				meta : curGroup.meta,
			});
			// Note.
			// g.initState();
			groups.push(g);
			curGroup = null;
			mode = null;
			continue;
		}

		if (line.startsWith("NET ")) {
			if (!curGroup) throw new Error(`NET must be inside GROUP at line ${lineNo + 1}`);
			const nid = line.slice(4).trim();
			if (!nid) throw new Error(`NET requires nid at line ${lineNo + 1}`);

			curNet = {
				nid,
				name : nid,
				gid : curGroup.gid,
				enabled : true,
				path : null,		// unrouted default
				vias : [],
				pathLen : null,
				bendCount : 0,
				start : null,
				end : null,
				meta : {},
			};
			mode = "net";
			continue;
		}
		if (line === "ENDNET") {
			if (!curNet) throw new Error(`ENDNET without NET at line ${lineNo + 1}`);
			if (!curGroup) throw new Error(`ENDNET without GROUP at line ${lineNo + 1}`);
			if (!curNet.start || !curNet.end) {
				throw new Error(`NET "${curNet.nid}" missing start/end`);
			}

			const n = new Net({
				name : curNet.name,
				nid : curNet.nid,
				gid : curNet.gid,
				start : curNet.start,
				end : curNet.end,
				enabled : curNet.enabled,
				path : curNet.path, // Note.
				vias : curNet.vias,
				pathLen : curNet.pathLen,
				bendCount : curNet.bendCount,
				meta : curNet.meta,
			});

			curGroup.nets.push(n);
			curNet = null;
			mode = "group";
			continue;
		}

		if (line === "PATH") {
			if (!curNet) throw new Error(`PATH without NET at line ${lineNo + 1}`);
			curNet.path = []; // Note.
			mode = "path";
			continue;
		}

		if (line === "VIAS") {
			if (!curNet) throw new Error(`VIAS without NET at line ${lineNo + 1}`);
			curNet.vias = [];
			mode = "vias";
			continue;
		}

		if (line === "META") {
			startMetaBlock();
			continue;
		}

		// Note.
		const kv = parseKeyValue(line);
		if (!kv) {
			throw new Error(`Expected key:value or block keyword at line ${lineNo + 1}: "${line}"`);
		}

		const key = kv.key;
		const val = kv.value;

		// DESIGN ??
		if (!curGroup && !curNet && (mode === "design" || mode === null)) {
			if (key in designProps) {
				designProps[key] = parseValue(val);
			} else {
				designMeta[key] = parseValue(val);
			}
			continue;
		}

		// GROUP ??
		if (curGroup && !curNet) {
			if (key === "name") curGroup.name = parseValue(val);
			else if (key === "color") curGroup.color = String(parseValue(val));
			else if (key === "state") curGroup.state = normalizeTristate(parseValue(val));
			else curGroup.meta[key] = parseValue(val);
			continue;
		}

		// NET ??
		if (curNet) {
			if (key === "name") curNet.name = parseValue(val);
			else if (key === "gid") curNet.gid = String(parseValue(val));
			else if (key === "enabled") curNet.enabled = toBool01(parseValue(val));
			else if (key === "bendCount") curNet.bendCount = Number(parseValue(val));
			else if (key === "pathLen") curNet.pathLen = Number(parseValue(val));
			else if (key === "start") curNet.start = parseNodeSpec(val);
			else if (key === "end") curNet.end = parseNodeSpec(val);
			else curNet.meta[key] = parseValue(val);
			continue;
		}
	}

	// Note.
	for (const k of ["nlayer", "nx", "ny", "dx", "dy", "layerGap"]) {
		if (!Number.isFinite(Number(designProps[k]))) {
			throw new Error(`DESIGN missing or invalid "${k}"`);
		}
	}

	return new Design({
		nlayer : Number(designProps.nlayer),
		nx : Number(designProps.nx),
		ny : Number(designProps.ny),
		dx : Number(designProps.dx),
		dy : Number(designProps.dy),
		layerGap : Number(designProps.layerGap),
		groups,
		bumpRadius : (designProps.bumpRadius === null) ? null : Number(designProps.bumpRadius),
		tsvRadius : (designProps.tsvRadius === null) ? null : Number(designProps.tsvRadius),
		viaRadius : (designProps.viaRadius === null) ? null : Number(designProps.viaRadius),
		meta : designMeta,
	});
}

function toKvValue(v) {
	if (v === null) return "null";
	if (typeof v === "boolean") return v ? "true" : "false";
	if (typeof v === "number" && Number.isFinite(v)) return String(v);
	return JSON.stringify(String(v));
}

function toNodeMetaToken(v) {
	if (v === null) return "null";
	if (typeof v === "boolean") return v ? "true" : "false";
	if (typeof v === "number" && Number.isFinite(v)) return String(v);
	const s = String(v);
	if (/\s/.test(s)) return null; // parseNodeSpec is whitespace-token based
	return s;
}

function toNodeSpec(node) {
	if (!node) return null;
	const x = Number(node.x);
	const y = Number(node.y);
	const layer = Number(node.layer);
	if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(layer)) return null;

	const type = String(node.type ?? NodeType.GRID);
	const out = [type, String(x), String(y), String(layer)];
	const meta = node.meta && typeof node.meta === "object" ? node.meta : null;
	if (meta) {
		for (const [k, v] of Object.entries(meta)) {
			const tv = toNodeMetaToken(v);
			if (tv === null) continue;
			out.push(`${k}=${tv}`);
		}
	}
	return out.join(" ");
}

function pushMetaBlock(lines, meta) {
	if (!meta || typeof meta !== "object") return;
	const entries = Object.entries(meta);
	if (entries.length === 0) return;
	lines.push("META");
	for (const [k, v] of entries) {
		lines.push(`${k}: ${toKvValue(v)}`);
	}
	lines.push("ENDMETA");
}

function toGroupState(state) {
	const s = String(state ?? "").toLowerCase();
	if (s === Tristate.ON || s === Tristate.OFF || s === Tristate.PARTIAL) return s;
	return Tristate.ON;
}

export function serializeDesignText(design) {
	if (!design) throw new Error("Design is required.");

	const lines = [];
	lines.push("DESIGN");
	lines.push(`nlayer: ${Number(design.nlayer)}`);
	lines.push(`nx: ${Number(design.nx)}`);
	lines.push(`ny: ${Number(design.ny)}`);
	lines.push(`dx: ${Number(design.dx)}`);
	lines.push(`dy: ${Number(design.dy)}`);
	lines.push(`layerGap: ${Number(design.layerGap)}`);

	if (Number.isFinite(Number(design.bumpRadius))) lines.push(`bumpRadius: ${Number(design.bumpRadius)}`);
	if (Number.isFinite(Number(design.tsvRadius))) lines.push(`tsvRadius: ${Number(design.tsvRadius)}`);
	if (Number.isFinite(Number(design.viaRadius))) lines.push(`viaRadius: ${Number(design.viaRadius)}`);
	pushMetaBlock(lines, design.meta);
	lines.push("ENDDESIGN");

	const groups = Array.isArray(design.groups) ? design.groups : [];
	for (const g of groups) {
		const gid = String(g?.gid ?? g?.name ?? "group");
		lines.push(`GROUP ${gid}`);
		lines.push(`name: ${toKvValue(g?.name ?? gid)}`);
		lines.push(`color: ${toKvValue(g?.color ?? "#FFFFFF")}`);
		lines.push(`state: ${toKvValue(toGroupState(g?.state))}`);
		pushMetaBlock(lines, g?.meta);

		const nets = Array.isArray(g?.nets) ? g.nets : [];
		for (const n of nets) {
			const nid = String(n?.nid ?? n?.name ?? "net");
			lines.push(`NET ${nid}`);
			lines.push(`name: ${toKvValue(n?.name ?? nid)}`);
			lines.push(`gid: ${toKvValue(n?.gid ?? gid)}`);
			lines.push(`enabled: ${toKvValue(!!n?.enabled)}`);
			if (Number.isFinite(Number(n?.bendCount))) lines.push(`bendCount: ${Number(n.bendCount)}`);
			if (Number.isFinite(Number(n?.pathLen))) lines.push(`pathLen: ${Number(n.pathLen)}`);

			const startSpec = toNodeSpec(n?.start);
			const endSpec = toNodeSpec(n?.end);
			if (!startSpec || !endSpec) {
				throw new Error(`NET "${nid}" is missing valid start/end node.`);
			}
			lines.push(`start: ${startSpec}`);
			lines.push(`end: ${endSpec}`);
			pushMetaBlock(lines, n?.meta);

			if (Array.isArray(n?.path)) {
				lines.push("PATH");
				for (const p of n.path) {
					const spec = toNodeSpec(p);
					if (spec) lines.push(spec);
				}
				lines.push("ENDPATH");
			}

			const vias = Array.isArray(n?.vias) ? n.vias : [];
			if (vias.length > 0) {
				lines.push("VIAS");
				for (const v of vias) {
					const spec = toNodeSpec(v);
					if (spec) lines.push(spec);
				}
				lines.push("ENDVIAS");
			}

			lines.push("ENDNET");
		}

		lines.push("ENDGROUP");
	}

	return `${lines.join("\n")}\n`;
}
