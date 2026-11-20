import svgPanZoom from "svg-pan-zoom";

/** @type {typeof import('mermaid').default | null} */
let mermaidApi = null;
let mermaidBooted = false;

const panZoomByWrap = new WeakMap();
/** @type {WeakMap<HTMLElement, () => void>} */
const umlFitByWrap = new WeakMap();
/** @type {WeakMap<HTMLElement, number>} */
const umlZoomByWrap = new WeakMap();

/** Match Overview · virtual micro-PRs (cytoscape toolbar + wheel). */
const DIAGRAM_ZOOM_STEP = 1.1;
const DIAGRAM_ZOOM_MIN = 0.2;
const DIAGRAM_ZOOM_MAX = 2.25;

/**
 * @param {number} z
 */
function clampDiagramZoom(z) {
  return Math.min(DIAGRAM_ZOOM_MAX, Math.max(DIAGRAM_ZOOM_MIN, z));
}

/**
 * @param {HTMLElement} wrap
 * @param {"in" | "out"} dir
 */
function nudgeDiagramZoom(wrap, dir) {
  const current = umlZoomByWrap.get(wrap) ?? 1;
  const next =
    dir === "in" ? current * DIAGRAM_ZOOM_STEP : current / DIAGRAM_ZOOM_STEP;
  umlZoomByWrap.set(wrap, clampDiagramZoom(next));
  umlFitByWrap.get(wrap)?.();
}

/**
 * @param {HTMLElement} wrap
 */
function fitDiagramZoomToStage(wrap) {
  const stage = wrap.querySelector(".diagram-complete-layout");
  const svg = wrap.querySelector("svg");
  if (!(stage instanceof HTMLElement) || !(svg instanceof SVGSVGElement)) {
    umlZoomByWrap.set(wrap, 1);
    umlFitByWrap.get(wrap)?.();
    return;
  }
  const vb = svg.viewBox?.baseVal;
  const naturalW = vb?.width > 0 ? vb.width : svg.width?.baseVal?.value || 0;
  const naturalH = vb?.height > 0 ? vb.height : svg.height?.baseVal?.value || 0;
  if (naturalW < 8 || naturalH < 8) {
    umlZoomByWrap.set(wrap, 1);
  } else {
    const pad = 32;
    const zoomW = (Math.max(stage.clientWidth - pad, 200)) / naturalW;
    const zoomH = (Math.max(stage.clientHeight - pad, 120)) / naturalH;
    umlZoomByWrap.set(wrap, clampDiagramZoom(Math.min(zoomW, zoomH, DIAGRAM_ZOOM_MAX)));
  }
  umlFitByWrap.get(wrap)?.();
}

/** @type {WeakSet<HTMLElement>} */
const wheelZoomByWrap = new WeakSet();

/**
 * @param {HTMLElement} wrap
 * @param {HTMLElement} stage
 */
function wireDiagramWheelZoom(wrap, stage) {
  if (wheelZoomByWrap.has(wrap)) return;
  wheelZoomByWrap.add(wrap);
  stage.addEventListener(
    "wheel",
    (e) => {
      if (!umlFitByWrap.has(wrap)) return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1 / DIAGRAM_ZOOM_STEP : DIAGRAM_ZOOM_STEP;
      const next = clampDiagramZoom((umlZoomByWrap.get(wrap) ?? 1) * factor);
      umlZoomByWrap.set(wrap, next);
      umlFitByWrap.get(wrap)?.();
    },
    { passive: false }
  );
}

/** @type {WeakSet<HTMLElement>} */
const dragPanByStage = new WeakSet();

/**
 * Pointer-drag pan on scrollable diagram stages (like Cytoscape overview pan).
 * @param {HTMLElement} stage
 */
function wireDiagramDragPan(stage) {
  if (dragPanByStage.has(stage)) return;
  dragPanByStage.add(stage);

  let panning = false;
  let startX = 0;
  let startY = 0;
  let scrollLeft0 = 0;
  let scrollTop0 = 0;
  /** @type {number | null} */
  let pointerId = null;

  stage.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0) return;
      if (e.target instanceof Element && e.target.closest("a, button, input, textarea")) return;
      panning = true;
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      scrollLeft0 = stage.scrollLeft;
      scrollTop0 = stage.scrollTop;
      stage.classList.add("is-diagram-panning");
      stage.setPointerCapture(e.pointerId);
    },
    { passive: true }
  );

  stage.addEventListener(
    "pointermove",
    (e) => {
      if (!panning || pointerId !== e.pointerId) return;
      stage.scrollLeft = scrollLeft0 - (e.clientX - startX);
      stage.scrollTop = scrollTop0 - (e.clientY - startY);
    },
    { passive: true }
  );

  const endPan = (e) => {
    if (!panning || (pointerId !== null && e.pointerId !== pointerId)) return;
    panning = false;
    pointerId = null;
    stage.classList.remove("is-diagram-panning");
    try {
      stage.releasePointerCapture(e.pointerId);
    } catch {
      /* */
    }
  };

  stage.addEventListener("pointerup", endPan);
  stage.addEventListener("pointercancel", endPan);
  stage.addEventListener("lostpointercapture", () => {
    panning = false;
    pointerId = null;
    stage.classList.remove("is-diagram-panning");
  });
}

async function ensureMermaid() {
  if (mermaidBooted && mermaidApi) return mermaidApi;
  const mod = await import("mermaid");
  mermaidApi = mod.default;
  mermaidApi.initialize({
    startOnLoad: false,
    theme: "base",
    flowchart: { htmlLabels: false, useMaxWidth: true, padding: 20, curve: "basis", nodeSpacing: 42, rankSpacing: 56 },
    class: { useMaxWidth: true },
    sequence: { useMaxWidth: true, wrap: true },
    themeVariables: {
      darkMode: true,
      background: "transparent",
      primaryColor: "#141414",
      primaryTextColor: "#f5f5f5",
      primaryBorderColor: "#737373",
      secondaryColor: "#101010",
      secondaryTextColor: "#e5e5e5",
      secondaryBorderColor: "#525252",
      tertiaryColor: "#fafafa",
      tertiaryTextColor: "#0a0a0a",
      tertiaryBorderColor: "#0a0a0a",
      lineColor: "#525252",
      textColor: "#f5f5f5",
      mainBkg: "#141414",
      nodeBorder: "#737373",
      clusterBkg: "#0a0a0a",
      clusterBorder: "#404040",
      titleColor: "#fafafa",
      edgeLabelBackground: "#101010",
      actorBkg: "#141414",
      actorBorder: "#737373",
      actorTextColor: "#f5f5f5",
      actorLineColor: "#525252",
      signalColor: "#a3a3a3",
      signalTextColor: "#f5f5f5",
      labelBoxBkgColor: "#141414",
      labelBoxBorderColor: "#737373",
      labelTextColor: "#e5e5e5",
      fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      fontSize: "11px",
    },
    securityLevel: "loose",
  });
  mermaidBooted = true;
  window.__cedarMermaid = mermaidApi;
  return mermaidApi;
}

/**
 * @param {string} source
 */
export function normalizeMermaidSource(source) {
  let s = String(source ?? "").trim();
  if (!s) return "";
  const fence = /^```(?:mermaid)?\s*\n([\s\S]*?)```\s*$/im.exec(s);
  if (fence) s = fence[1].trim();
  const lines = s.split("\n");
  while (lines[0]?.startsWith("#")) lines.shift();
  return lines.join("\n").trim();
}

/**
 * @param {string} source
 * @param {HTMLElement} pre
 */
export async function renderArchitectureMermaid(source, pre) {
  if (!pre) return false;
  const graph = normalizeMermaidSource(source);
  if (!graph) return false;

  let mermaid;
  try {
    mermaid = await ensureMermaid();
  } catch (err) {
    console.warn("[cedar] mermaid load failed", err);
    pre.textContent = graph;
    pre.classList.add("cedar-mermaid-fallback");
    return false;
  }

  pre.classList.remove("cedar-mermaid-fallback");
  pre.replaceChildren();

  const renderId = `cedar-mermaid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const { svg, bindFunctions } = await mermaid.render(renderId, graph);
    pre.innerHTML = svg;
    pre.classList.add("mermaid-rendered");
    bindFunctions?.(pre);
    const svgEl = pre.querySelector("svg");
    const isClassDiagram = graph.trimStart().startsWith("classDiagram");
    if (svgEl instanceof SVGSVGElement) {
      svgEl.style.display = "block";
      svgEl.style.height = "auto";
      svgEl.style.minHeight = "120px";
      svgEl.style.minWidth = "200px";
      svgEl.style.margin = "0";
      svgEl.style.maxWidth = "none";
      svgEl.setAttribute("preserveAspectRatio", "xMidYMid meet");
      if (!isClassDiagram) {
        svgEl.style.marginInline = "auto";
      }
    }
    pre.style.minHeight = "12rem";
    return Boolean(svgEl);
  } catch (err) {
    console.warn("[cedar] mermaid render failed", err);
    pre.textContent = graph;
    pre.classList.add("cedar-mermaid-fallback");
    return false;
  }
}

/**
 * @param {HTMLElement} wrap
 * @param {string} svgMarkup
 */
export function mountServerSvg(wrap, svgMarkup) {
  const host = wrap.querySelector("[data-diagram-host]");
  if (!host || !svgMarkup) return;
  host.innerHTML = svgMarkup;
  const svg = host.querySelector("svg");
  if (!svg) return;
  svg.style.display = "block";
  svg.style.marginInline = "auto";
  svg.style.maxWidth = "100%";
  svg.style.height = "auto";
  if (!wrap.hasAttribute("data-diagram-panzoom")) return;
  queuePanFit(wrap, svg);
}

/**
 * @param {ParentNode} root
 */
export function activateDiagramUx(root) {
  wireDiagramToolbars(root);
}

/**
 * @param {ParentNode} root
 * @param {string} source
 */
export async function mountLayoutMermaid(root, source) {
  if (!root || !source?.trim()) return false;
  const pre = root.querySelector("#cedar-mermaid-layout");
  if (!pre) return false;
  const ok = await renderArchitectureMermaid(source, pre);
  const wrap = pre.closest("[data-diagram-wrap]");
  const svg = pre.querySelector("svg");
  if (ok && wrap instanceof HTMLElement && svg instanceof SVGSVGElement) {
    queuePanFit(wrap, svg);
    activateDiagramUx(wrap);
  }
  return ok;
}

/**
 * @param {ParentNode} root
 * @param {{ components?: string, flow?: string, events?: string }} views
 */
export async function mountCompleteLayoutViews(root, views) {
  if (!root || !views) return 0;
  const panels = [
    { key: "components", sel: "#cedar-mermaid-components" },
    { key: "flow", sel: "#cedar-mermaid-flow" },
    { key: "events", sel: "#cedar-mermaid-events" },
  ];
  let drawn = 0;
  await Promise.all(
    panels.map(async ({ key, sel }) => {
      const source = views[key];
      const pre = root.querySelector(sel);
      if (!pre || !source?.trim()) return;
      const ok = await renderArchitectureMermaid(source, pre);
      const wrap = pre.closest("[data-diagram-wrap]");
      const svg = pre.querySelector("svg");
      if (ok && wrap instanceof HTMLElement && svg instanceof SVGSVGElement) {
        mountLayoutMermaidScrollable(wrap, pre);
        activateDiagramUx(wrap);
        drawn += 1;
      } else if (!ok && pre instanceof HTMLElement) {
        pre.classList.add("cedar-mermaid-fallback", "cedar-mermaid-fallback-visible");
      }
    })
  );
  requestAnimationFrame(() => refitPanZoomDiagrams(root));
  return drawn;
}

/**
 * @param {HTMLElement} wrap
 * @param {SVGSVGElement} svg
 */
/**
 * @param {HTMLElement} wrap
 * @param {SVGSVGElement} svg
 * @param {{ fillViewport?: boolean }} [opts]
 */
/**
 * @param {{ fillViewport?: boolean, fillWidth?: boolean }} [opts]
 */
function queuePanFit(wrap, svg, opts) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => bindPanZoom(wrap, svg, opts));
  });
}

/**
 * @param {HTMLElement} wrap
 * @param {SVGSVGElement} svg
 * @param {{ fillViewport?: boolean }} [opts]
 */
function bindPanZoom(wrap, svg, opts = {}) {
  const prev = panZoomByWrap.get(wrap);
  if (prev) {
    try {
      prev.destroy();
    } catch {
      /* */
    }
  }
  try {
    const pz = svgPanZoom(svg, {
      zoomScaleSensitivity: 0.3,
      minZoom: 0.35,
      maxZoom: 6,
      fit: true,
      center: true,
      controlIconsEnabled: false,
    });
    panZoomByWrap.set(wrap, pz);
    fitDiagramInStage(wrap, svg, pz, {
      fill: opts.fillViewport === true,
      fillWidth: opts.fillWidth === true,
    });
    return pz;
  } catch (err) {
    console.warn("[cedar] pan/zoom unavailable", err);
    return null;
  }
}

/**
 * @param {ParentNode} root
 */
/**
 * @param {HTMLElement} wrap
 * @param {SVGSVGElement} svg
 * @param {ReturnType<typeof svgPanZoom>} pz
 * @param {boolean} fillViewport
 */
const resizeObserverByWrap = new WeakMap();

/**
 * @param {HTMLElement} wrap
 * @param {SVGSVGElement} svg
 */
/**
 * @param {HTMLElement} wrap
 * @param {SVGSVGElement} svg
 * @param {{ fillWidth?: boolean }} [opts]
 */
function wireDiagramStageResize(wrap, svg, opts = {}) {
  if (resizeObserverByWrap.has(wrap)) return;
  const stage = wrap.querySelector(".diagram-complete-layout");
  if (!(stage instanceof HTMLElement)) return;
  const ro = new ResizeObserver(() => {
    const pz = panZoomByWrap.get(wrap);
    if (pz) fitDiagramInStage(wrap, svg, pz, { fill: true, fillWidth: opts.fillWidth === true });
  });
  ro.observe(stage);
  resizeObserverByWrap.set(wrap, ro);
}

/**
 * @param {HTMLElement} wrap
 * @param {SVGSVGElement} svg
 * @param {ReturnType<typeof svgPanZoom>} pz
 * @param {{ fill?: boolean, fillWidth?: boolean }} [opts]
 */
function fitDiagramInStage(wrap, svg, pz, opts = {}) {
  const stage = wrap.querySelector(".diagram-complete-layout");
  if (!(stage instanceof HTMLElement)) {
    pz.resize();
    pz.fit();
    pz.center();
    return;
  }

  pz.resize();
  pz.fit();
  pz.center();

  if (!opts.fill) return;

  const pad = 16;
  const stageW = Math.max(stage.clientWidth - pad, 200);
  const stageH = Math.max(stage.clientHeight - pad, 200);
  const rect = svg.getBoundingClientRect();
  const svgW = rect.width || svg.width?.baseVal?.value || 0;
  const svgH = rect.height || svg.height?.baseVal?.value || 0;
  if (svgW < 8 || svgH < 8 || stageW < 8) return;

  const growW = (stageW / svgW) * 0.98;
  const growH = (stageH / svgH) * 0.94;
  const grow = opts.fillWidth ? growW : Math.min(growW, growH, 4);
  if (grow > 1.04) {
    pz.zoom(pz.getZoom() * grow);
    pz.center();
  }
}

/**
 * Refit pan/zoom for every Complete layout panel after layout changes.
 * @param {ParentNode} root
 */
export function refitPanZoomDiagrams(root) {
  root.querySelectorAll("[data-diagram-wrap]").forEach((wrap) => {
    if (!(wrap instanceof HTMLElement)) return;
    const umlFit = umlFitByWrap.get(wrap);
    if (umlFit) {
      umlFit();
      return;
    }
    const pz = panZoomByWrap.get(wrap);
    const svg = wrap.querySelector("svg");
    if (pz && svg instanceof SVGSVGElement) {
      fitDiagramInStage(wrap, svg, pz, { fill: true, fillWidth: true });
    }
  });
}

/**
 * Complete layout Mermaid: natural size × zoom (scrollable stage; do not shrink to panel width).
 * @param {HTMLElement} wrap
 * @param {HTMLElement} pre
 */
function mountLayoutMermaidScrollable(wrap, pre) {
  const stage = wrap.querySelector(".diagram-complete-layout");
  const svg = pre.querySelector("svg");
  if (!(stage instanceof HTMLElement) || !(svg instanceof SVGSVGElement)) return;

  const prevPz = panZoomByWrap.get(wrap);
  if (prevPz) {
    try {
      prevPz.destroy();
    } catch {
      /* */
    }
    panZoomByWrap.delete(wrap);
  }

  if (!umlZoomByWrap.has(wrap)) umlZoomByWrap.set(wrap, 1);

  const fit = () => {
    const zoom = umlZoomByWrap.get(wrap) ?? 1;
    const vb = svg.viewBox?.baseVal;
    const naturalW = vb?.width > 0 ? vb.width : svg.width?.baseVal?.value || 0;
    const naturalH = vb?.height > 0 ? vb.height : svg.height?.baseVal?.value || 0;
    if (naturalW > 0 && naturalH > 0) {
      const w = Math.max(Math.round(naturalW * zoom), 280);
      const h = Math.max(Math.round(naturalH * zoom), 120);
      svg.setAttribute("width", String(w));
      svg.setAttribute("height", String(h));
      svg.style.width = `${w}px`;
      svg.style.height = `${h}px`;
    } else {
      svg.removeAttribute("width");
      svg.removeAttribute("height");
      svg.style.width = "";
      svg.style.height = "";
    }
    svg.style.maxWidth = "none";
    svg.style.minWidth = "min(100%, 280px)";
    svg.style.display = "block";
    svg.style.margin = "0";
    svg.style.visibility = "visible";
    pre.style.width = "max-content";
    pre.style.minWidth = "100%";
  };

  umlFitByWrap.set(wrap, fit);
  requestAnimationFrame(() => {
    requestAnimationFrame(fit);
  });

  if (!resizeObserverByWrap.has(wrap)) {
    const ro = new ResizeObserver(() => fit());
    ro.observe(stage);
    resizeObserverByWrap.set(wrap, ro);
  }

  wireDiagramWheelZoom(wrap, stage);
  wireDiagramDragPan(stage);
}

/**
 * Scale Mermaid SVG to the full diagram stage (matches Overview viewport sizing).
 * @param {HTMLElement} wrap
 * @param {HTMLElement} pre
 */
function mountDiagramStageFullWidth(wrap, pre) {
  const stage = wrap.querySelector(".diagram-complete-layout");
  const svg = pre.querySelector("svg");
  if (!(stage instanceof HTMLElement) || !(svg instanceof SVGSVGElement)) return;

  const prevPz = panZoomByWrap.get(wrap);
  if (prevPz) {
    try {
      prevPz.destroy();
    } catch {
      /* */
    }
    panZoomByWrap.delete(wrap);
  }

  if (!umlZoomByWrap.has(wrap)) umlZoomByWrap.set(wrap, 1);

  const fit = () => {
    const pad = 12;
    const zoom = umlZoomByWrap.get(wrap) ?? 1;
    const stageW = Math.max(stage.clientWidth - pad * 2, 280) * zoom;
    if (stageW < 50) return;

    const vb = svg.viewBox?.baseVal;
    const naturalW = vb?.width > 0 ? vb.width : svg.width?.baseVal?.value || 0;
    const naturalH = vb?.height > 0 ? vb.height : svg.height?.baseVal?.value || 0;
    if (naturalW > 0 && naturalH > 0) {
      const scale = stageW / naturalW;
      const h = Math.max(Math.round(naturalH * scale), 120);
      svg.setAttribute("width", String(Math.round(stageW)));
      svg.setAttribute("height", String(h));
    } else {
      svg.removeAttribute("width");
      svg.removeAttribute("height");
    }
    svg.style.width = "100%";
    svg.style.maxWidth = "none";
    svg.style.minHeight = "120px";
    svg.style.display = "block";
    svg.style.margin = "0";
    svg.style.visibility = "visible";
  };

  umlFitByWrap.set(wrap, fit);
  requestAnimationFrame(() => {
    requestAnimationFrame(fit);
  });

  if (!resizeObserverByWrap.has(wrap)) {
    const ro = new ResizeObserver(() => fit());
    ro.observe(stage);
    resizeObserverByWrap.set(wrap, ro);
  }
}

/**
 * Refit Mermaid diagrams when the review stage or window resizes (sidebar / slice rail drags).
 * @param {ParentNode} root
 */
export function wireDiagramResizeListeners(root) {
  if (!(root instanceof HTMLElement) || root.dataset.wiredDiagramResize) return;
  root.dataset.wiredDiagramResize = "1";

  let timer = 0;
  const refit = () => {
    clearTimeout(timer);
    timer = setTimeout(() => refitPanZoomDiagrams(root), 80);
  };

  window.addEventListener("resize", refit, { passive: true });

  const layout = root.querySelector(".cedar-review-layout");
  if (layout instanceof HTMLElement && typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(refit);
    ro.observe(layout);
    const main = root.querySelector(".cedar-review-main");
    if (main instanceof HTMLElement) ro.observe(main);
  }
}

function wireDiagramToolbars(root) {
  const refitRoot =
    root.querySelector("#architecture-read-mermaid") ??
    (root instanceof HTMLElement && root.id === "architecture-read-mermaid" ? root : root);

  root.querySelectorAll("[data-diagram-wrap]").forEach((wrap) => {
    const bar = wrap.querySelector("[data-diagram-toolbar]");
    if (!bar || bar.dataset.wired) return;
    bar.dataset.wired = "1";

    bar.querySelectorAll("[data-diagram-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const layoutHost = wrap.closest("#architecture-read-mermaid, .cedar-complete-layout-views");
        const umlFit = umlFitByWrap.get(wrap);
        const pz = panZoomByWrap.get(wrap);
        const action = btn.getAttribute("data-diagram-action");

        if (action === "collapse") {
          const collapsed = wrap.classList.toggle("is-diagram-collapsed");
          const canvas = wrap.querySelector(".diagram-stage-canvas");
          if (canvas instanceof HTMLElement) canvas.hidden = collapsed;
          btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
          btn.textContent = collapsed ? "▸" : "▾";
          refitPanZoomDiagrams(refitRoot);
          return;
        }

        if (action === "maximize") {
          const on = wrap.classList.toggle("is-diagram-maximized");
          btn.setAttribute("aria-pressed", on ? "true" : "false");
          if (layoutHost instanceof HTMLElement) {
            layoutHost.classList.toggle("has-maximized-panel", on);
            layoutHost.querySelectorAll("[data-diagram-wrap]").forEach((peer) => {
              if (!(peer instanceof HTMLElement) || peer === wrap) return;
              peer.classList.toggle("is-diagram-minimized", on);
            });
          }
          if (!on && layoutHost instanceof HTMLElement) {
            const anyMax = layoutHost.querySelector(".is-diagram-maximized");
            if (!anyMax) layoutHost.classList.remove("has-maximized-panel");
            layoutHost.querySelectorAll(".is-diagram-minimized").forEach((el) => {
              el.classList.remove("is-diagram-minimized");
            });
          }
          requestAnimationFrame(() => refitPanZoomDiagrams(refitRoot));
          return;
        }

        if (umlFit) {
          if (action === "in") nudgeDiagramZoom(wrap, "in");
          else if (action === "out") nudgeDiagramZoom(wrap, "out");
          else if (action === "reset") fitDiagramZoomToStage(wrap);
          return;
        }
        if (!pz) {
          if (action === "reset" && umlFitByWrap.get(wrap)) umlFitByWrap.get(wrap)?.();
          return;
        }
        if (action === "in") pz.zoomIn();
        else if (action === "out") pz.zoomOut();
        else if (action === "reset") {
          const fit = umlFitByWrap.get(wrap);
          if (fit) {
            fit();
            return;
          }
          pz.resetZoom();
          const sv = wrap.querySelector("svg");
          if (sv instanceof SVGSVGElement) {
            fitDiagramInStage(wrap, sv, pz, { fill: true, fillWidth: true });
          } else {
            pz.resize();
            pz.fit();
            pz.center();
          }
        }
      });
    });
  });
}