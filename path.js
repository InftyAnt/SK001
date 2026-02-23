/**
 * Enum-like constants (string enums)
 */
export const NodeType = Object.freeze({
	BUMP : "bump",
	TSV : "tsv",
	VIA : "via",
	GRID : "grid",
});

export const Tristate = Object.freeze({
	ON : "on",
	OFF : "off",
	PARTIAL : "partial",
});

/**
 * @typedef {Object.<string, any>} Meta
 */

/**
 * Node : a point that a route can pass through.
 */
export class Node {
	/**
	 * @param {Object} args
	 * @param {string} args.type - one of NodeType.*
	 * @param {number} args.x
	 * @param {number} args.y
	 * @param {number} args.layer
	 * @param {Meta} [args.meta]
	 */
	constructor({ type, x, y, layer, meta = {} }) {
		this.type = type;
		this.x = x;
		this.y = y;
		this.layer = layer;
		this.meta = meta;
	}
}

/**
 * Seg : an (immutable) segment connecting two Nodes.
 */
export class Seg {
	/**
	 * @param {Node} a
	 * @param {Node} b
	 */
	constructor(a, b) {
		this.a = a;
		this.b = b;
		Object.freeze(this); // frozen like @dataclass(frozen=True)
	}

	/**
	 * Geometry length with scale factors dx, dy.
	 * @param {number} dx
	 * @param {number} dy
	 * @returns {number}
	 */
	len(dx, dy) {
		const di = this.a.x - this.b.x;
		const dj = this.a.y - this.b.y;
		return Math.hypot(dx * di, dy * dj);
	}
}

/**
 * Net : one net (start->end, optional routed path, via list, cached pathLen).
 */
export class Net {
	/**
	 * @param {Object} args
	 * @param {string} args.name
	 * @param {string} args.nid
	 * @param {string} args.gid
	 * @param {Node} args.start
	 * @param {Node} args.end
	 * @param {boolean} [args.enabled = true]
	 * @param {Node[] | null} [args.path = null]
	 * @param {Node[]} [args.vias = []]
	 * @param {number | null} [args.pathLen = null]
	 * @param {number} [args.bendCount = 0]
	 * @param {Meta} [args.meta = {}]
	 */
	constructor({
		name,
		nid,
		gid,
		start,
		end,
		enabled = true,
		path = null,
		vias = [],
		pathLen = null,
		bendCount = 0,
		meta = {},
	}) {
		this.name = name;
		this.nid = nid;
		this.gid = gid;

		this.start = start;
		this.end = end;

		this.enabled = enabled;

		/** @type {Node[] | null} */
		this.path = path;

		/** @type {Node[]} */
		this.vias = vias;

		/** @type {number | null} */
		this.pathLen = pathLen;
		
		/** @type {number} */
		this.bendCount = bendCount;

		this.meta = meta;
	}

	/** @returns {boolean} */
	isRouted() {
		return this.path !== null;
	}

	/**
	 * All points along the net.
	 * If not routed, returns [start, end].
	 * @returns {Node[]}
	 */
	points() {
		if (this.path === null) return [this.start, this.end];
		return [this.start, ...this.path, this.end];
	}

	/**
	 * Consecutive segments derived from points().
	 * @returns {Seg[]}
	 */
	segments() {
		const p = this.points();
		const segs = [];
		for (let i = 0; i + 1 < p.length; i++) {
			segs.push(new Seg(p[i], p[i + 1]));
		}
		return segs;
	}

	/**
	 * Cache the geometric path length.
	 * - If not routed : pathLen becomes null
	 * - If already computed : keeps existing cached value
	 * @param {number} dx
	 * @param {number} dy
	 */
	setPathLen(dx, dy) {
		if (!this.isRouted()) {
			this.pathLen = null;
			return;
		}
		if (this.pathLen !== null) return;

		let sum = 0.0;
		for (const seg of this.segments()) {
			sum += seg.len(dx, dy);
		}
		this.pathLen = sum;
	}
}

/**
 * Group : a bundle of nets.
 */
export class Group {
	/**
	 * @param {Object} args
	 * @param {string} args.name
	 * @param {string} args.gid
	 * @param {Net[]} args.nets
	 * @param {string} args.state - one of Tristate.*
	 * @param {number | null} [args.minLen = null]
	 * @param {number | null} [args.maxLen = null]
	 * @param {number | null} [args.lenDev = null]
	 * @param {string} [args.color = "#FFFFFF"]
	 * @param {Meta} [args.meta = {}]
	 */
	constructor({
		name,
		gid,
		nets,
		state,
		minLen = null,
		maxLen = null,
		lenDev = null,
		color = "#FFFFFF",
		meta = {},
	}) {
		this.name = name;
		this.gid = gid;

		/** @type {Net[]} */
		this.nets = nets;

		/** @type {string} */
		this.state = state;

		/** @type {number | null} */
		this.minLen = minLen;

		/** @type {number | null} */
		this.maxLen = maxLen;

		/** @type {number | null} */
		this.lenDev = lenDev;

		this.color = color;
		this.meta = meta;
	}

	/**
	 * Toggle group state:
	 * - OFF -> turn all nets on, state becomes ON
	 * - otherwise -> turn all nets off, state becomes OFF
	 */
	toggleState() {
		if (this.state === Tristate.OFF) {
			for (const n of this.nets) n.enabled = true;
			this.state = Tristate.ON;
		} else {
			for (const n of this.nets) n.enabled = false;
			this.state = Tristate.OFF;
		}
	}

	/**
	 * Initialize tristate from nets[].enabled.
	 */
	initState() {
		const flags = this.nets.map((n) => !!n.enabled);
		if (flags.every(Boolean)) this.state = Tristate.ON;
		else if (flags.some(Boolean)) this.state = Tristate.PARTIAL;
		else this.state = Tristate.OFF;
	}

	/**
	 * Calculate min/max/lenDev of routed nets.
	 * If any net is not routed => all become null.
	 * @param {number} dx
	 * @param {number} dy
	 */
	calcLen(dx, dy) {
		// 하나라도 unrouted면 그룹 길이 지표는 무효
		for (const n of this.nets) {
			if (!n.isRouted()) {
				this.minLen = null;
				this.maxLen = null;
				this.lenDev = null;
				return;
			}
		}

		let min = Number.POSITIVE_INFINITY;
		let max = Number.NEGATIVE_INFINITY;

		for (const n of this.nets) {
			n.setPathLen(dx, dy);
			const l = n.pathLen; // cache된 값
			if (l === null) {
				this.minLen = null;
				this.maxLen = null;
				this.lenDev = null;
				return;
			}
			if (l < min) min = l;
			if (l > max) max = l;
		}

		this.minLen = min;
		this.maxLen = max;
		this.lenDev = (min > 0) ? (max / min) : null;
	}
}

/**
 * Design : one complete routing result (a container of groups + grid/geometry settings).
 */
export class Design {
	/**
	 * @param {Object} args
	 * @param {number} args.nlayer
	 * @param {number} args.nx
	 * @param {number} args.ny
	 * @param {number} args.dx
	 * @param {number} args.dy
	 * @param {number} args.layerGap
	 * @param {Group[]} [args.groups = []]
	 * @param {number | null} [args.bumpRadius = null]
	 * @param {number | null} [args.tsvRadius = null]
	 * @param {number | null} [args.viaRadius = null]
	 * @param {Meta} [args.meta = {}]
	 */
	constructor({
		nlayer,
		nx,
		ny,
		dx,
		dy,
		layerGap,
		groups = [],
		bumpRadius = null,
		tsvRadius = null,
		viaRadius = null,
		meta = {},
	}) {
		/** @type {number} */
		this.nlayer = nlayer;

		/** @type {number} */
		this.nx = nx;

		/** @type {number} */
		this.ny = ny;

		/** @type {number} */
		this.dx = dx;

		/** @type {number} */
		this.dy = dy;
		
		/** @type {number} */
		this.layerGap = layerGap;
		
		/** @type {Group[]} */
		this.groups = groups;

		/** @type {number | null} */
		this.bumpRadius = bumpRadius;

		/** @type {number | null} */
		this.tsvRadius = tsvRadius;

		/** @type {number | null} */
		this.viaRadius = viaRadius;

		this.meta = meta;
	}

}