(() => {
  "use strict";

  const PARENT_LIVE_COLOR = "#111111";
  const PARENT_DONE_COLOR = "#9e9e9e";
  const CHILD_TEMPLATE_COLOR = "#000000";
  const PARENT_LINE_WIDTH = 16;
  const CHILD_LINE_WIDTH = 10;
  const ERASE_HIT_DISTANCE = 18;

  const DEFAULT_BASE_WIDTH = 600;
  const DEFAULT_BASE_HEIGHT = 600;
  const MIN_CANVAS_SIZE = 200;
  const MAX_CANVAS_WIDTH = 1400;
  const MAX_CANVAS_HEIGHT = 1000;

  const DEFAULT_PRACTICE_COUNT = 3;
  const MIN_PRACTICE_COUNT = 1;
  const MAX_PRACTICE_COUNT = 10;

  // Pastel palette used only for the base canvas's stroke-order rendering.
  const BASE_ORDER_COLORS = [
    "#ffadad", "#ffd6a5", "#fdffb6", "#caffbf", "#9bf6ff",
    "#a0c4ff", "#bdb2ff", "#ffc6ff", "#e3c9a8", "#b5ead7",
  ];

  // Darker palette used for order-number labels, and for the practice
  // canvases' template strokes in stroke-order mode (needs to stay bold
  // since it doubles as the child's tracing guide).
  const ORDER_LABEL_COLORS = [
    "#e03131", "#e8590c", "#b8860b", "#2f9e44", "#0c8599",
    "#1971c2", "#7048e8", "#d6336c", "#8b5e34", "#12b886",
  ];

  const CHILD_COLORS = [
    "#e74c3c", "#e67e22", "#f1c40f", "#2ecc71", "#1abc9c",
    "#3498db", "#9b59b6", "#e84393", "#795548", "#111111",
  ];

  const GUIDE_COLOR = "#a5d8ff";
  const SHARE_FORMAT_VERSION = 1;

  const canvasListEl = document.getElementById("canvas-list");

  let copyCounter = 0;

  function makeCanvasData(id, width, height, strokes) {
    return { id, width, height, strokes: strokes || [], el: null, ctx: null, card: null, isBlank: false };
  }

  // Application state
  const state = {
    mode: "parent", // 'parent' | 'child'
    parentTool: "pen", // 'pen' | 'eraser'
    childTool: "pen",
    orderMode: false,
    childColor: CHILD_COLORS[0],
    practiceCount: DEFAULT_PRACTICE_COUNT,
    showBlankCanvas: false,
    base: makeCanvasData("base", DEFAULT_BASE_WIDTH, DEFAULT_BASE_HEIGHT),
    practiceCanvases: [],
    activeCopyId: null,
    liveStroke: null, // { canvasId, owner, color, points }
    isErasing: false,
    sharedView: false,
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function visibleCanvases() {
    return state.mode === "parent" ? [state.base] : [state.base, ...state.practiceCanvases];
  }

  function isEditable(canvasData) {
    if (canvasData.id === "base") return state.mode === "parent";
    return state.mode === "child";
  }

  // --- Canvas coordinate helpers ---
  function getCanvasPoint(evt, canvasData) {
    const rect = canvasData.el.getBoundingClientRect();
    const scaleX = canvasData.width / rect.width;
    const scaleY = canvasData.height / rect.height;
    return {
      x: (evt.clientX - rect.left) * scaleX,
      y: (evt.clientY - rect.top) * scaleY,
    };
  }

  function distToSegment(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const projX = a.x + t * dx;
    const projY = a.y + t * dy;
    return Math.hypot(p.x - projX, p.y - projY);
  }

  function distToStroke(p, stroke) {
    let min = Infinity;
    const pts = stroke.points;
    if (pts.length === 1) {
      return Math.hypot(p.x - pts[0].x, p.y - pts[0].y);
    }
    for (let i = 0; i < pts.length - 1; i++) {
      min = Math.min(min, distToSegment(p, pts[i], pts[i + 1]));
    }
    return min;
  }

  function findStrokeAt(canvasData, point, owner) {
    const strokes = canvasData.strokes;
    for (let i = strokes.length - 1; i >= 0; i--) {
      const stroke = strokes[i];
      if (stroke.owner !== owner) continue;
      if (distToStroke(point, stroke) <= ERASE_HIT_DISTANCE) {
        return i;
      }
    }
    return -1;
  }

  // --- Rendering ---
  function drawGuideLines(ctx, width, height) {
    ctx.save();
    ctx.strokeStyle = GUIDE_COLOR;
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(width / 2, 0);
    ctx.lineTo(width / 2, height);
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawStrokePath(ctx, points, color, width) {
    if (points.length === 0) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    if (points.length === 1) {
      ctx.arc(points[0].x, points[0].y, width / 2, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      return;
    }
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
  }

  function drawOrderLabel(ctx, point, number, color) {
    const radius = 13;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = color;
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.font = "bold 15px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(number), point.x, point.y + 1);
  }

  function redrawCanvas(canvasData) {
    if (!canvasData.ctx) return;
    const ctx = canvasData.ctx;
    const isBase = canvasData.id === "base";
    // The base canvas is the bold, high-contrast reference while it's shown
    // alongside practice sheets in child mode; practice sheets themselves
    // use the soft gray/pastel guide so the child's own strokes stand out.
    const useBoldStyle = isBase && state.mode === "child";
    ctx.clearRect(0, 0, canvasData.width, canvasData.height);
    drawGuideLines(ctx, canvasData.width, canvasData.height);

    let parentIndex = 0;
    const parentLabels = [];

    for (const stroke of canvasData.strokes) {
      if (stroke.owner === "parent") {
        parentIndex += 1;
        let color;
        if (useBoldStyle) {
          color = state.orderMode
            ? ORDER_LABEL_COLORS[(parentIndex - 1) % ORDER_LABEL_COLORS.length]
            : CHILD_TEMPLATE_COLOR;
        } else {
          color = state.orderMode
            ? BASE_ORDER_COLORS[(parentIndex - 1) % BASE_ORDER_COLORS.length]
            : PARENT_DONE_COLOR;
        }
        drawStrokePath(ctx, stroke.points, color, PARENT_LINE_WIDTH);
        if (state.orderMode) {
          const labelColor = ORDER_LABEL_COLORS[(parentIndex - 1) % ORDER_LABEL_COLORS.length];
          parentLabels.push({ point: stroke.points[0], number: parentIndex, color: labelColor });
        }
      } else {
        drawStrokePath(ctx, stroke.points, stroke.color, CHILD_LINE_WIDTH);
      }
    }

    if (state.liveStroke && state.liveStroke.canvasId === canvasData.id) {
      const isParent = state.liveStroke.owner === "parent";
      const color = isParent ? PARENT_LIVE_COLOR : state.liveStroke.color;
      const width = isParent ? PARENT_LINE_WIDTH : CHILD_LINE_WIDTH;
      drawStrokePath(ctx, state.liveStroke.points, color, width);
    }

    for (const label of parentLabels) {
      drawOrderLabel(ctx, label.point, label.number, label.color);
    }
  }

  function redrawAll() {
    visibleCanvases().forEach(redrawCanvas);
  }

  // --- Pointer interaction ---
  let activePointerId = null;

  function currentTool() {
    return state.mode === "parent" ? state.parentTool : state.childTool;
  }

  function onPointerDown(evt, canvasData) {
    if (!isEditable(canvasData)) return;
    if (activePointerId !== null) return;
    activePointerId = evt.pointerId;
    canvasData.el.setPointerCapture(evt.pointerId);

    if (state.mode === "child") {
      state.activeCopyId = canvasData.id;
      updateActiveHighlight();
    }

    const point = getCanvasPoint(evt, canvasData);
    const tool = currentTool();

    if (tool === "pen") {
      const owner = state.mode;
      state.liveStroke = {
        canvasId: canvasData.id,
        owner,
        color: owner === "child" ? state.childColor : null,
        points: [point],
      };
      redrawCanvas(canvasData);
    } else if (tool === "eraser") {
      state.isErasing = true;
      eraseAt(canvasData, point);
    }
  }

  function onPointerMove(evt, canvasData) {
    if (evt.pointerId !== activePointerId) return;
    const point = getCanvasPoint(evt, canvasData);
    const tool = currentTool();

    if (tool === "pen" && state.liveStroke && state.liveStroke.canvasId === canvasData.id) {
      state.liveStroke.points.push(point);
      redrawCanvas(canvasData);
    } else if (tool === "eraser" && state.isErasing) {
      eraseAt(canvasData, point);
    }
  }

  function onPointerUp(evt, canvasData) {
    if (evt.pointerId !== activePointerId) return;
    activePointerId = null;
    canvasData.el.releasePointerCapture(evt.pointerId);

    if (state.liveStroke && state.liveStroke.canvasId === canvasData.id) {
      if (state.liveStroke.points.length > 0) {
        canvasData.strokes.push({
          owner: state.liveStroke.owner,
          color: state.liveStroke.color,
          points: state.liveStroke.points,
        });
      }
      state.liveStroke = null;
    }
    state.isErasing = false;
    redrawCanvas(canvasData);
  }

  function eraseAt(canvasData, point) {
    const owner = state.mode;
    const idx = findStrokeAt(canvasData, point, owner);
    if (idx !== -1) {
      canvasData.strokes.splice(idx, 1);
      redrawCanvas(canvasData);
    }
  }

  function attachPointerHandlers(canvasData) {
    const el = canvasData.el;
    el.addEventListener("pointerdown", (evt) => onPointerDown(evt, canvasData));
    el.addEventListener("pointermove", (evt) => onPointerMove(evt, canvasData));
    el.addEventListener("pointerup", (evt) => onPointerUp(evt, canvasData));
    el.addEventListener("pointercancel", (evt) => onPointerUp(evt, canvasData));
    el.addEventListener("pointerleave", (evt) => {
      if (evt.pointerId === activePointerId) onPointerUp(evt, canvasData);
    });
  }

  // --- Canvas list building ---
  function buildCanvasList() {
    canvasListEl.innerHTML = "";
    const list = visibleCanvases();
    let practiceIndex = 0;

    list.forEach((canvasData) => {
      const card = document.createElement("div");
      card.className = "canvas-card";

      const label = document.createElement("div");
      label.className = "canvas-label";
      if (canvasData.id === "base") {
        label.textContent = "📝 おてほん(ベース)";
      } else if (canvasData.isBlank) {
        label.textContent = "🎨 じゆうれんしゅう";
      } else {
        practiceIndex += 1;
        label.textContent = `✍️ れんしゅう ${practiceIndex}`;
      }

      const canvasEl = document.createElement("canvas");
      canvasEl.width = canvasData.width;
      canvasEl.height = canvasData.height;
      canvasEl.style.aspectRatio = `${canvasData.width} / ${canvasData.height}`;
      canvasEl.style.maxWidth = `${canvasData.width}px`;

      card.appendChild(label);
      card.appendChild(canvasEl);
      canvasListEl.appendChild(card);

      canvasData.el = canvasEl;
      canvasData.ctx = canvasEl.getContext("2d");
      canvasData.card = card;

      attachPointerHandlers(canvasData);
    });

    updateActiveHighlight();
    redrawAll();
  }

  function resizeCanvasElement(canvasData) {
    canvasData.el.width = canvasData.width;
    canvasData.el.height = canvasData.height;
    canvasData.el.style.aspectRatio = `${canvasData.width} / ${canvasData.height}`;
    canvasData.el.style.maxWidth = `${canvasData.width}px`;
  }

  function updateActiveHighlight() {
    visibleCanvases().forEach((c) => {
      if (!c.card) return;
      c.card.classList.toggle("active", state.mode === "child" && c.id === state.activeCopyId);
      c.card.classList.toggle("readonly", !isEditable(c));
    });
  }

  // --- Practice canvas generation ---
  function regeneratePracticeCanvases() {
    const templateStrokes = state.base.strokes.filter((s) => s.owner === "parent");

    const list = [];
    for (let i = 0; i < state.practiceCount; i++) {
      copyCounter += 1;
      const clonedStrokes = templateStrokes.map((s) => ({
        owner: "parent",
        points: s.points.map((p) => ({ x: p.x, y: p.y })),
      }));
      list.push(makeCanvasData(`practice-${copyCounter}`, state.base.width, state.base.height, clonedStrokes));
    }

    if (state.showBlankCanvas) {
      copyCounter += 1;
      const blank = makeCanvasData(`practice-${copyCounter}`, state.base.width, state.base.height, []);
      blank.isBlank = true;
      list.push(blank);
    }

    state.practiceCanvases = list;
    state.activeCopyId = list.length > 0 ? list[0].id : null;
  }

  // --- Mode switching ---
  const modeButtons = document.querySelectorAll(".mode-btn");
  const toolbarParent = document.getElementById("toolbar-parent");
  const toolbarChild = document.getElementById("toolbar-child");

  modeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const previousMode = state.mode;
      state.mode = btn.dataset.mode;
      modeButtons.forEach((b) => {
        b.classList.toggle("active", b === btn);
        b.setAttribute("aria-selected", b === btn ? "true" : "false");
      });
      toolbarParent.classList.toggle("hidden", state.mode !== "parent");
      toolbarChild.classList.toggle("hidden", state.mode !== "child");

      if (previousMode !== state.mode && state.mode === "child") {
        regeneratePracticeCanvases();
      }

      buildCanvasList();
    });
  });

  // --- Parent toolbar ---
  const parentToolButtons = document.querySelectorAll("#toolbar-parent .tool-btn[data-tool]");
  parentToolButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      state.parentTool = btn.dataset.tool;
      parentToolButtons.forEach((b) => b.classList.toggle("active", b === btn));
    });
  });

  document.getElementById("order-mode-toggle").addEventListener("change", (evt) => {
    state.orderMode = evt.target.checked;
    redrawAll();
  });

  document.getElementById("parent-clear-all").addEventListener("click", () => {
    state.base.strokes = state.base.strokes.filter((s) => s.owner !== "parent");
    redrawCanvas(state.base);
  });

  // --- Resize (base canvas only) ---
  const widthInput = document.getElementById("canvas-width-input");
  const heightInput = document.getElementById("canvas-height-input");

  document.getElementById("canvas-resize-apply").addEventListener("click", () => {
    const base = state.base;
    const newWidth = clamp(parseInt(widthInput.value, 10) || base.width, MIN_CANVAS_SIZE, MAX_CANVAS_WIDTH);
    const newHeight = clamp(parseInt(heightInput.value, 10) || base.height, MIN_CANVAS_SIZE, MAX_CANVAS_HEIGHT);

    const scaleX = newWidth / base.width;
    const scaleY = newHeight / base.height;
    base.strokes.forEach((stroke) => {
      stroke.points = stroke.points.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY }));
    });

    base.width = newWidth;
    base.height = newHeight;
    widthInput.value = newWidth;
    heightInput.value = newHeight;

    resizeCanvasElement(base);
    redrawCanvas(base);
  });

  // --- Practice canvas settings ---
  document.getElementById("practice-count-select").addEventListener("change", (evt) => {
    state.practiceCount = clamp(parseInt(evt.target.value, 10) || DEFAULT_PRACTICE_COUNT, MIN_PRACTICE_COUNT, MAX_PRACTICE_COUNT);
  });

  document.getElementById("blank-canvas-toggle").addEventListener("change", (evt) => {
    state.showBlankCanvas = evt.target.checked;
  });

  // --- Child toolbar ---
  const childToolButtons = document.querySelectorAll("#toolbar-child .tool-btn[data-tool]");
  childToolButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      state.childTool = btn.dataset.tool;
      childToolButtons.forEach((b) => b.classList.toggle("active", b === btn));
    });
  });

  document.getElementById("child-clear-all").addEventListener("click", () => {
    const canvasData = state.practiceCanvases.find((c) => c.id === state.activeCopyId);
    if (!canvasData) return;
    canvasData.strokes = canvasData.strokes.filter((s) => s.owner !== "child");
    redrawCanvas(canvasData);
  });

  const palette = document.getElementById("child-color-palette");
  CHILD_COLORS.forEach((color, i) => {
    const swatch = document.createElement("button");
    swatch.className = "color-swatch" + (i === 0 ? " selected" : "");
    swatch.style.background = color;
    swatch.setAttribute("aria-label", color);
    swatch.addEventListener("click", () => {
      state.childColor = color;
      palette.querySelectorAll(".color-swatch").forEach((s) => s.classList.remove("selected"));
      swatch.classList.add("selected");
    });
    palette.appendChild(swatch);
  });

  // --- Share encoding (URL-embedded, no server) ---
  function bufferToBase64Url(buffer) {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function base64UrlToBuffer(str) {
    let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4) base64 += "=";
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  async function encodeShareData(payload) {
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    if (typeof CompressionStream === "function") {
      try {
        const cs = new CompressionStream("gzip");
        const writer = cs.writable.getWriter();
        writer.write(bytes);
        writer.close();
        const compressed = await new Response(cs.readable).arrayBuffer();
        return "g" + bufferToBase64Url(compressed);
      } catch (e) {
        // fall through to uncompressed encoding below
      }
    }
    return "r" + bufferToBase64Url(bytes.buffer);
  }

  async function decodeShareData(str) {
    const tag = str.charAt(0);
    const buffer = base64UrlToBuffer(str.slice(1));
    if (tag === "g") {
      const ds = new DecompressionStream("gzip");
      const writer = ds.writable.getWriter();
      writer.write(new Uint8Array(buffer));
      writer.close();
      const decompressed = await new Response(ds.readable).arrayBuffer();
      return JSON.parse(new TextDecoder().decode(decompressed));
    }
    return JSON.parse(new TextDecoder().decode(buffer));
  }

  function buildSharePayload() {
    const strokes = state.base.strokes
      .filter((s) => s.owner === "parent")
      .map((s) => s.points.map((p) => [Math.round(p.x), Math.round(p.y)]));
    return {
      v: SHARE_FORMAT_VERSION,
      w: state.base.width,
      h: state.base.height,
      s: strokes,
      pc: state.practiceCount,
      bl: state.showBlankCanvas ? 1 : 0,
      om: state.orderMode ? 1 : 0,
    };
  }

  // --- Publish modal ---
  const publishModal = document.getElementById("publish-modal");
  const publishLinkInput = document.getElementById("publish-link-input");
  const publishCopyBtn = document.getElementById("publish-copy-btn");

  document.getElementById("publish-btn").addEventListener("click", async () => {
    const payload = buildSharePayload();
    const encoded = await encodeShareData(payload);
    const url = `${location.origin}${location.pathname}#share=${encoded}`;
    publishLinkInput.value = url;
    publishModal.classList.remove("hidden");
    publishLinkInput.focus();
    publishLinkInput.select();
  });

  document.getElementById("publish-close-btn").addEventListener("click", () => {
    publishModal.classList.add("hidden");
  });

  publishCopyBtn.addEventListener("click", async () => {
    const url = publishLinkInput.value;
    try {
      await navigator.clipboard.writeText(url);
    } catch (e) {
      publishLinkInput.select();
      document.execCommand("copy");
    }
    const originalLabel = publishCopyBtn.textContent;
    publishCopyBtn.textContent = "✅ コピーしました";
    setTimeout(() => {
      publishCopyBtn.textContent = originalLabel;
    }, 1500);
  });

  // --- Loading a shared link ---
  function applySharedPayload(payload) {
    state.sharedView = true;
    state.base.width = clamp(parseInt(payload.w, 10) || DEFAULT_BASE_WIDTH, MIN_CANVAS_SIZE, MAX_CANVAS_WIDTH);
    state.base.height = clamp(parseInt(payload.h, 10) || DEFAULT_BASE_HEIGHT, MIN_CANVAS_SIZE, MAX_CANVAS_HEIGHT);
    state.base.strokes = (payload.s || []).map((points) => ({
      owner: "parent",
      points: points.map(([x, y]) => ({ x, y })),
    }));
    state.practiceCount = clamp(parseInt(payload.pc, 10) || DEFAULT_PRACTICE_COUNT, MIN_PRACTICE_COUNT, MAX_PRACTICE_COUNT);
    state.showBlankCanvas = !!payload.bl;
    state.orderMode = !!payload.om;
    state.mode = "child";

    document.querySelector(".mode-switch").classList.add("hidden");
    document.getElementById("shared-banner").classList.remove("hidden");
    document.getElementById("toolbar-parent").classList.add("hidden");
    document.getElementById("toolbar-child").classList.remove("hidden");
    document.getElementById("mode-parent").classList.remove("active");
    document.getElementById("mode-parent").setAttribute("aria-selected", "false");
    document.getElementById("mode-child").classList.add("active");
    document.getElementById("mode-child").setAttribute("aria-selected", "true");

    regeneratePracticeCanvases();
  }

  function showShareError() {
    const banner = document.getElementById("shared-banner");
    document.getElementById("shared-banner-text").textContent =
      "⚠️ 共有リンクの読み込みに失敗しました。リンクが正しいかご確認ください。";
    banner.classList.add("error");
    banner.classList.remove("hidden");
  }

  async function tryLoadSharedView() {
    const match = location.hash.match(/^#share=(.+)$/);
    if (!match) return false;
    try {
      const payload = await decodeShareData(decodeURIComponent(match[1]));
      applySharedPayload(payload);
      return true;
    } catch (e) {
      showShareError();
      return false;
    }
  }

  document.getElementById("shared-new-link").href = location.pathname;

  tryLoadSharedView().finally(buildCanvasList);
})();
