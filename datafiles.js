function isTextFile(file) {
	const name = (file?.name || "").toLowerCase();
	const mime = (file?.type || "").toLowerCase();
	
	return (
		mime.startsWith("text/") ||
		name.endsWith(".txt") ||
		name.endsWith(".log") ||
		name.endsWith(".csv")
	);
}

function stopAndPrevent(e) {
	e.stopPropagation();
	e.preventDefault();
}

export function initDataFilesUI({
	inputId = "dataFileInput",
	dropId = "dataDrop",
	pickBtnId = "dataPickBtn",
	listId = "sceneList",
	onFiles = () => {},
	onSelect = () => {},
	onRemove = () => {},
} = {}) {
	const input = document.getElementById(inputId);
	const drop = document.getElementById(dropId);
	const pickBtn = document.getElementById(pickBtnId);
	const list = document.getElementById(listId);
	
	if (!input || !drop || !pickBtn || !list) {
		throw new Error("DataFiles UI elements not found. Check index.html IDs.");
	}
	
	function setDragOver(v) {
		drop.classList.toggle("dragover", !!v);
	}
	
	function pushFiles(fileList) {
		if (!fileList) return;
		const files = Array.from(fileList);
		const accepted = files.filter(isTextFile);
		if (accepted.length === 0) return;
		onFiles(accepted);
	}
	
	pickBtn.addEventListener("click", (e) => {
		e.stopPropagation();
		input.click();
	});
	
	drop.addEventListener("click", (e) => {
		e.stopPropagation();
		input.click();
	});
	
	input.addEventListener("change", () => {
		pushFiles(input.files);
		input.value = "";
	});
	
	["dragenter", "dragover"].forEach((ev) => {
		drop.addEventListener(ev, (e) => {
			stopAndPrevent(e);
			setDragOver(true);
		});
	});
	
	["dragleave", "dragend"].forEach((ev) => {
		drop.addEventListener(ev, e => {
		stopAndPrevent(e);
		setDragOver(false);
		});
	});
	
	drop.addEventListener("drop", (e) => {
		stopAndPrevent(e);
		setDragOver(false);
		pushFiles(e.dataTransfer?.files);
	});
	
	list.addEventListener("click", (e) => {
		const btn = e.target?.closest?.("button");
		const item = e.target?.closest?.("[data-scene-id]");
		if (!item) return;
		
		const id = item.dataset.sceneId;
		
		if (btn && btn.dataset.action === "remove") {
			e.stopPropagation();
			onRemove(id);
			return;
		}
		onSelect(id);
	});
	
	function render({ scenes = [], activeId = null } = {}) {
		list.innerHTML = "";
		
		for (const s of scenes) {
			const li = document.createElement("li");
			li.className = "scene-item" + (s.id === activeId ? " active" : "");
			li.dataset.sceneId = s.id;
			
			const left = document.createElement("div");
			left.className = "scene-meta";
			
			const title = document.createElement("div");
			title.className = "scene-title";
			title.textContent = s.title || s.id;
			
			const sub = document.createElement("div");
			sub.className = "scene-subtitle";
			sub.textContent = s.subtitle || "";
			
			left.appendChild(title);
			if (sub.textContent) left.appendChild(sub);
			
			const right = document.createElement("div");
			right.className = "scene-actions";
			
			if (!s.isDefault) {
				const rm = document.createElement("button");
				rm.className = "mini-btn";
				rm.dataset.action = "remove";
				rm.title = "삭제";
				rm.textContent = "x";
				right.appendChild(rm);
			}
			
			li.appendChild(left);
			li.appendChild(right);
			list.appendChild(li);
		}
	}
	
	return { render };
}