function stopUiEvents(root) {
	const events = [
		"pointerdown", "pointermove", "pointerup",
		"mousedown", "mousemove", "mouseup",
		"touchstart", "touchmove", "touchend",
		"wheel", "dblclick", "contextmenu"
	];
	
	for (const ev of events) {
		root.addEventListener(ev, (e) => {
			e.stopPropagation();
		}, { passive : true });
	}
}

function initOneSide(root, { defaultCollapsed = false, defaultTab = null } = {}) {
	if (!root) return null;
	
	stopUiEvents(root);
	
	const toggleBtn = root.querySelector('.dock-btn[data-action = "toggle"]');
	const tabBtns = Array.from(root.querySelectorAll('.dock-btn[data-tab]'));
	const tabViews = Array.from(root.querySelectorAll('.tab-content[data-tab]'));
	
	function setCollapsed(v) {
		root.classList.toggle("collapsed", !!v);
	}
	
	function setActiveTab(tabId, { expand = true } = {}) {
		if (!tabId) return;
		
		for (const b of tabBtns) {
			b.classList.toggle("active", b.dataset.tab === tabId);
		}
		
		for (const v of tabViews) {
			v.hidden = (v.dataset.tab !== tabId);
		}
		
		root.dataset.activeTab = tabId;
		
		if (expand && root.classList.contains("collapsed")) {
			setCollapsed(false);
		}
	}
	
	toggleBtn?.addEventListener("click", (e) => {
		e.stopPropagation();
		setCollapsed(!root.classList.contains("collapsed"));
	});
	
	for (const b of tabBtns) {
		b.addEventListener("click", (e) => {
			e.stopPropagation();
			setActiveTab(b.dataset.tab, { expand : true });
		});
	}
	
	setCollapsed(defaultCollapsed);
	
	const initialTab = 
		defaultTab ??
		root.dataset.activeTab ??
		tabBtns[0]?.dataset.tab ??
		tabViews[0]?.dataset.tab ??
		null;
	
	if (initialTab) setActiveTab(initialTab, { expand : !defaultCollapsed });
	
	return { setCollapsed, setActiveTab };
}

export function initSidePanels({
	leftId = "ui-left",
	rightId = "ui-right",
	left = { defaultCollapsed : true, defaultTab : null },
	right = { defaultCollapsed : false, defaultTab : null },
} = {}) {
	const leftRoot = document.getElementById(leftId);
	const rightRoot = document.getElementById(rightId);
	
	return {
		left : initOneSide(leftRoot, left),
		right : initOneSide(rightRoot, right),
	};
}