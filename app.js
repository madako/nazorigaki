(() => {
  "use strict";

  const canvas = document.getElementById("draw-canvas");
  const ctx = canvas.getContext("2d");

  const PARENT_LIVE_COLOR = "#111111";
  const PARENT_DONE_COLOR = "#9e9e9e";
  const PARENT_LINE_WIDTH = 16;
  const CHILD_LINE_WIDTH = 10;
  const ERASE_HIT_DISTANCE = 18;

  const ORDER_COLORS = [
    "#ffadad", "#ffd6a5", "#fdffb6", "#caffbf", "#9bf6ff",
    "#a0c4ff", "#bdb2ff", "#ffc6ff", "#e3c9a8", "#b5ead7",
  ];

  const ORDER_LABEL_COLORS = [
    "#e03131", "#e8590c", "#b8860b", "#2f9e44", "#0c8599",
    "#1971c2", "#7048e8", "#d6336c", "#8b5e34", "#12b886",
  ];

  const CHILD_COLORS = [
    "#e74c3c", "#e67e22", "#f1c40f", "#2ecc71", "#1abc9c",
    "#3498db", "#9b59b6", "#e84393", "#795548", "#111111",
  ];

  // Application state
  const state = {
    mode: "parent", // 'parent' | 'child'
    parentTool: "pen", // 'pen' | 'eraser'
    childTool: "pen",
    orderMode: false,
    childColor: CHILD_COLORS[0],
    strokes: [], // { owner: 'parent'|'child', color, points: [{x,y}] }
    liveStroke: null,
    isErasing: false,
  };

  // --- Canvas coordinate helpers ---
  function getCanvasPoint(evt) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
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

  function findStrokeAt(point, owner) {
    for (let i = state.strokes.length - 1; i >= 0; i--) {
      const stroke = state.strokes[i];
      if (stroke.owner !== owner) continue;
      if (distToStroke(point, stroke) <= ERASE_HIT_DISTANCE) {
        return i;
      }
    }
    return -1;
  }

  // --- Rendering ---
  function drawStrokePath(points, color, width) {
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

  function drawOrderLabel(point, number, color) {
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

  function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let parentIndex = 0;
    const parentLabels = [];

    for (const stroke of state.strokes) {
      if (stroke.owner === "parent") {
        parentIndex += 1;
        const color = state.orderMode
          ? ORDER_COLORS[(parentIndex - 1) % ORDER_COLORS.length]
          : PARENT_DONE_COLOR;
        drawStrokePath(stroke.points, color, PARENT_LINE_WIDTH);
        if (state.orderMode) {
          const labelColor = ORDER_LABEL_COLORS[(parentIndex - 1) % ORDER_LABEL_COLORS.length];
          parentLabels.push({ point: stroke.points[0], number: parentIndex, color: labelColor });
        }
      } else {
        drawStrokePath(stroke.points, stroke.color, CHILD_LINE_WIDTH);
      }
    }

    if (state.liveStroke) {
      const isParent = state.liveStroke.owner === "parent";
      const color = isParent ? PARENT_LIVE_COLOR : state.liveStroke.color;
      const width = isParent ? PARENT_LINE_WIDTH : CHILD_LINE_WIDTH;
      drawStrokePath(state.liveStroke.points, color, width);
    }

    for (const label of parentLabels) {
      drawOrderLabel(label.point, label.number, label.color);
    }
  }

  // --- Pointer interaction ---
  let activePointerId = null;

  function currentTool() {
    return state.mode === "parent" ? state.parentTool : state.childTool;
  }

  function onPointerDown(evt) {
    if (activePointerId !== null) return;
    activePointerId = evt.pointerId;
    canvas.setPointerCapture(evt.pointerId);
    const point = getCanvasPoint(evt);
    const tool = currentTool();

    if (tool === "pen") {
      const owner = state.mode;
      state.liveStroke = {
        owner,
        color: owner === "child" ? state.childColor : null,
        points: [point],
      };
      redraw();
    } else if (tool === "eraser") {
      state.isErasing = true;
      eraseAt(point);
    }
  }

  function onPointerMove(evt) {
    if (evt.pointerId !== activePointerId) return;
    const point = getCanvasPoint(evt);
    const tool = currentTool();

    if (tool === "pen" && state.liveStroke) {
      state.liveStroke.points.push(point);
      redraw();
    } else if (tool === "eraser" && state.isErasing) {
      eraseAt(point);
    }
  }

  function onPointerUp(evt) {
    if (evt.pointerId !== activePointerId) return;
    activePointerId = null;
    canvas.releasePointerCapture(evt.pointerId);

    if (state.liveStroke) {
      if (state.liveStroke.points.length > 0) {
        state.strokes.push(state.liveStroke);
      }
      state.liveStroke = null;
    }
    state.isErasing = false;
    redraw();
  }

  function eraseAt(point) {
    const owner = state.mode;
    const idx = findStrokeAt(point, owner);
    if (idx !== -1) {
      state.strokes.splice(idx, 1);
      redraw();
    }
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("pointerleave", (evt) => {
    if (evt.pointerId === activePointerId) onPointerUp(evt);
  });

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

      if (previousMode === "child" && state.mode === "parent") {
        state.strokes = state.strokes.filter((s) => s.owner !== "child");
        redraw();
      }
    });
  });

  // --- Parent toolbar ---
  const parentToolButtons = document.querySelectorAll("#toolbar-parent .tool-btn");
  parentToolButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      state.parentTool = btn.dataset.tool;
      parentToolButtons.forEach((b) => b.classList.toggle("active", b === btn));
    });
  });

  document.getElementById("order-mode-toggle").addEventListener("change", (evt) => {
    state.orderMode = evt.target.checked;
    redraw();
  });

  document.getElementById("parent-clear-all").addEventListener("click", () => {
    state.strokes = state.strokes.filter((s) => s.owner !== "parent");
    redraw();
  });

  // --- Child toolbar ---
  const childToolButtons = document.querySelectorAll("#toolbar-child .tool-btn");
  childToolButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      state.childTool = btn.dataset.tool;
      childToolButtons.forEach((b) => b.classList.toggle("active", b === btn));
    });
  });

  document.getElementById("child-clear-all").addEventListener("click", () => {
    state.strokes = state.strokes.filter((s) => s.owner !== "child");
    redraw();
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

  redraw();
})();
