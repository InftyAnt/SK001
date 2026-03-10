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

function parseNumberInput(el, { integer = false, min = null } = {}) {
	if (!el) return { ok : false, value : null };
	const raw = String(el.value ?? "").trim();
	if (!raw) return { ok : false, value : null };
	const n = Number(raw);
	if (!Number.isFinite(n)) return { ok : false, value : null };
	if (integer && !Number.isInteger(n)) return { ok : false, value : null };
	if (min !== null && n < min) return { ok : false, value : null };
	return { ok : true, value : n };
}

function parseOptionalPositiveNumberInput(el) {
	if (!el) return { ok : true, value : null };
	const raw = String(el.value ?? "").trim();
	if (!raw) return { ok : true, value : null };
	const n = Number(raw);
	if (!Number.isFinite(n) || n <= 0) return { ok : false, value : null };
	return { ok : true, value : n };
}

export function initDataFilesUI({
	inputId = "dataFileInput",
	dropId = "dataDrop",
	pickBtnId = "dataPickBtn",
	saveBtnId = "dataSaveBtn",
	listId = "sceneList",
	newSceneOpenBtnId = "newSceneOpenBtn",
	newSceneModalId = "newSceneModal",
	newSceneCloseBtnId = "newSceneCloseBtn",
	newSceneCancelBtnId = "newSceneCancelBtn",
	newSceneCreateBtnId = "newSceneCreateBtn",
	newSceneNameId = "newSceneName",
	newSceneNlayerId = "newSceneNlayer",
	newSceneNxId = "newSceneNx",
	newSceneNyId = "newSceneNy",
	newSceneDxId = "newSceneDx",
	newSceneDyId = "newSceneDy",
	newSceneLayerGapId = "newSceneLayerGap",
	newSceneBumpRadiusId = "newSceneBumpRadius",
	newSceneTsvRadiusId = "newSceneTsvRadius",
	newSceneViaRadiusId = "newSceneViaRadius",
	newSceneMsgId = "newSceneCreateMsg",
	onFiles = () => {},
	onSave = () => {},
	onCreateEmptyProject = () => {},
	onSelect = () => {},
	onRemove = () => {},
} = {}) {
	const input = document.getElementById(inputId);
	const drop = document.getElementById(dropId);
	const pickBtn = document.getElementById(pickBtnId);
	const saveBtn = document.getElementById(saveBtnId);
	const list = document.getElementById(listId);
	const newSceneOpenBtn = document.getElementById(newSceneOpenBtnId);
	const newSceneModal = document.getElementById(newSceneModalId);
	const newSceneCloseBtn = document.getElementById(newSceneCloseBtnId);
	const newSceneCancelBtn = document.getElementById(newSceneCancelBtnId);
	const newSceneCreateBtn = document.getElementById(newSceneCreateBtnId);
	const newSceneName = document.getElementById(newSceneNameId);
	const newSceneNlayer = document.getElementById(newSceneNlayerId);
	const newSceneNx = document.getElementById(newSceneNxId);
	const newSceneNy = document.getElementById(newSceneNyId);
	const newSceneDx = document.getElementById(newSceneDxId);
	const newSceneDy = document.getElementById(newSceneDyId);
	const newSceneLayerGap = document.getElementById(newSceneLayerGapId);
	const newSceneBumpRadius = document.getElementById(newSceneBumpRadiusId);
	const newSceneTsvRadius = document.getElementById(newSceneTsvRadiusId);
	const newSceneViaRadius = document.getElementById(newSceneViaRadiusId);
	const newSceneMsg = document.getElementById(newSceneMsgId);
	
	if (!input || !drop || !pickBtn || !list) {
		throw new Error("DataFiles UI elements not found. Check index.html IDs.");
	}

	function setCreateMsg(text, isError = false) {
		if (!newSceneMsg) return;
		newSceneMsg.textContent = text || "";
		newSceneMsg.dataset.error = (!!text && !!isError) ? "1" : "0";
	}

	function openNewSceneModal() {
		if (!newSceneModal) return;
		newSceneModal.hidden = false;
		newSceneModal.setAttribute("aria-hidden", "false");
		setCreateMsg("");
		newSceneName?.focus();
	}

	function closeNewSceneModal() {
		if (!newSceneModal) return;
		newSceneModal.hidden = true;
		newSceneModal.setAttribute("aria-hidden", "true");
		setCreateMsg("");
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

	if (saveBtn) {
		saveBtn.addEventListener("click", async (e) => {
			e.stopPropagation();
			await onSave();
		});
	}
	
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

	if (newSceneOpenBtn) {
		newSceneOpenBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			openNewSceneModal();
		});
	}

	if (newSceneCloseBtn) {
		newSceneCloseBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			closeNewSceneModal();
		});
	}

	if (newSceneCancelBtn) {
		newSceneCancelBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			closeNewSceneModal();
		});
	}

	if (newSceneModal) {
		newSceneModal.addEventListener("click", (e) => {
			const closeRole = e.target?.closest?.("[data-role=\"modal-close\"]");
			if (!closeRole) return;
			closeNewSceneModal();
		});
		window.addEventListener("keydown", (e) => {
			if (e.key !== "Escape") return;
			if (newSceneModal.hidden) return;
			e.preventDefault();
			closeNewSceneModal();
		});
	}

	if (
		newSceneCreateBtn &&
		newSceneName &&
		newSceneNlayer &&
		newSceneNx &&
		newSceneNy &&
		newSceneDx &&
		newSceneDy &&
		newSceneLayerGap
	) {
		const handleCreateEmptyProject = async (e) => {
			e.preventDefault();
			e.stopPropagation();
			setCreateMsg("");

			const name = String(newSceneName.value ?? "").trim() || "Untitled Project";
			const nlayer = parseNumberInput(newSceneNlayer, { integer : true, min : 1 });
			const nx = parseNumberInput(newSceneNx, { integer : true, min : 2 });
			const ny = parseNumberInput(newSceneNy, { integer : true, min : 2 });
			const dx = parseNumberInput(newSceneDx, { min : 1e-9 });
			const dy = parseNumberInput(newSceneDy, { min : 1e-9 });
			const layerGap = parseNumberInput(newSceneLayerGap, { min : 1e-9 });
			const bumpRadius = parseOptionalPositiveNumberInput(newSceneBumpRadius);
			const tsvRadius = parseOptionalPositiveNumberInput(newSceneTsvRadius);
			const viaRadius = parseOptionalPositiveNumberInput(newSceneViaRadius);

			if (!nlayer.ok) return setCreateMsg("Layers must be an integer >= 1.", true);
			if (!nx.ok) return setCreateMsg("Nx must be an integer >= 2.", true);
			if (!ny.ok) return setCreateMsg("Ny must be an integer >= 2.", true);
			if (!dx.ok) return setCreateMsg("Dx must be a positive number.", true);
			if (!dy.ok) return setCreateMsg("Dy must be a positive number.", true);
			if (!layerGap.ok) return setCreateMsg("Layer Gap must be a positive number.", true);
			if (!bumpRadius.ok) return setCreateMsg("Bump R must be empty or a positive number.", true);
			if (!tsvRadius.ok) return setCreateMsg("TSV R must be empty or a positive number.", true);
			if (!viaRadius.ok) return setCreateMsg("Via R must be empty or a positive number.", true);

			newSceneCreateBtn.disabled = true;
			try {
				await onCreateEmptyProject({
					name,
					nlayer : nlayer.value,
					nx : nx.value,
					ny : ny.value,
					dx : dx.value,
					dy : dy.value,
					layerGap : layerGap.value,
					bumpRadius : bumpRadius.value,
					tsvRadius : tsvRadius.value,
					viaRadius : viaRadius.value,
				});
				closeNewSceneModal();
			} catch (err) {
				console.error("[empty-scene-create failed]", err);
				const msg = err?.message ? String(err.message) : "Failed to create project.";
				setCreateMsg(msg, true);
			} finally {
				newSceneCreateBtn.disabled = false;
			}
		};

		newSceneCreateBtn.addEventListener("click", handleCreateEmptyProject);
		[
			newSceneName,
			newSceneNlayer,
			newSceneNx,
			newSceneNy,
			newSceneDx,
			newSceneDy,
			newSceneLayerGap,
			newSceneBumpRadius,
			newSceneTsvRadius,
			newSceneViaRadius,
		].forEach((el) => {
			if (!el) return;
			el.addEventListener("input", () => setCreateMsg(""));
			el.addEventListener("keydown", (ev) => {
				if (ev.key !== "Enter") return;
				ev.preventDefault();
				handleCreateEmptyProject(ev);
			});
		});
	}
	
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
				rm.title = "Remove";
				rm.title = "Remove";
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
