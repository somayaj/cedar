import cytoscape from "cytoscape";
import dagre from "cytoscape-dagre";

cytoscape.use(dagre);

/** @type {Map<string, cytoscape.Core>} */
const instances = new Map();

const BASE_NODE = {
  label: "data(label)",
  "text-wrap": "wrap",
  "text-max-width": "148px",
  "font-family": "Inter, ui-sans-serif, system-ui, sans-serif",
  "text-valign": "center",
  "text-halign": "center",
  "font-weight": 500,
  "line-height": 1.35,
  shape: "round-rectangle",
  width: "label",
  height: "label",
  "min-width": "96px",
  "min-height": "44px",
  padding: "16px",
};

const CEDAR_STYLE = [
  {
    selector: "node",
    style: {
      ...BASE_NODE,
      "font-size": 11,
      color: "#f5f5f5",
      "background-color": "#101010",
      "border-width": 1,
      "border-color": "#525252",
      "background-opacity": 1,
    },
  },
  {
    selector: 'node[type = "pr"]',
    style: {
      shape: "ellipse",
      "font-size": 12,
      "font-weight": 600,
      color: "#0a0a0a",
      "background-color": "#fafafa",
      "border-width": 2,
      "border-color": "#0a0a0a",
      padding: "20px",
      "min-width": "72px",
      "min-height": "72px",
      "text-max-width": "120px",
    },
  },
  {
    selector: 'node[type = "slice"]',
    style: {
      color: "#e5e5e5",
      "background-color": "#141414",
      "border-color": "#737373",
    },
  },
  {
    selector: "node[highlight]",
    style: {
      "border-width": 2,
      "border-color": "#fafafa",
      "background-color": "#1f1f1f",
      color: "#ffffff",
    },
  },
  {
    selector: "edge",
    style: {
      width: 1.25,
      "line-color": "#525252",
      "line-cap": "round",
      "curve-style": "unbundled-bezier",
      "control-point-step-size": 40,
      opacity: 0.85,
    },
  },
  {
    selector: 'edge[kind = "contains"]',
    style: {
      "target-arrow-shape": "triangle",
      "target-arrow-color": "#737373",
      "arrow-scale": 0.85,
      "line-color": "#404040",
    },
  },
  {
    selector: 'edge[kind = "depends"]',
    style: {
      "line-style": "dashed",
      "line-dash-pattern": [5, 5],
      "line-color": "#a3a3a3",
      "target-arrow-shape": "vee",
      "target-arrow-color": "#d4d4d4",
      opacity: 0.95,
    },
  },
];

/**
 * @param {object} graph
 */
function toElements(graph) {
  const part = graph.overview;
  if (!part?.nodes?.length) return [];

  const sliceNodeIds = new Set(
    part.nodes.filter((n) => n.type === "pr" || n.type === "slice").map((n) => n.id)
  );

  const nodes = part.nodes
    .filter((n) => n.type === "pr" || n.type === "slice")
    .map((n) => ({
      data: {
        id: n.id,
        label: n.label,
        type: n.type,
        ...(n.highlight ? { highlight: true } : {}),
      },
    }));

  const edges = (part.edges ?? [])
    .filter((e) => sliceNodeIds.has(e.source) && sliceNodeIds.has(e.target))
    .map((e) => ({
      data: {
        id: e.id,
        source: e.source,
        target: e.target,
        kind: e.kind,
      },
    }));

  return [...nodes, ...edges];
}

/**
 * @param {object} graph
 * @returns {"TB" | "LR"}
 */
function resolveRankDir(graph) {
  if (graph.meta?.layout === "LR") return "LR";
  if (graph.meta?.layout === "TB") return "TB";
  const slices = graph.overview?.nodes?.filter((n) => n.type === "slice").length ?? 0;
  return slices >= 2 ? "LR" : "TB";
}

/**
 * @param {cytoscape.Core} cy
 * @param {HTMLElement} container
 */
function wireCyResize(cy, container) {
  const resize = () => {
    if (!container.isConnected) return;
    cy.resize();
    cy.fit(cy.elements(), 56);
  };
  requestAnimationFrame(() => requestAnimationFrame(resize));
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => resize());
    ro.observe(container);
  }
}

/**
 * @param {HTMLElement} container
 * @param {object} graph
 */
function mountCy(container, graph) {
  if (!container.id) container.id = "cedar-cy-slices";
  const key = container.id;
  const prev = instances.get(key);
  if (prev) prev.destroy();

  const elements = toElements(graph);
  if (!elements.length) {
    container.innerHTML =
      '<p class="p-6 text-center text-sm text-zinc-500">No slices to show.</p>';
    return null;
  }

  const rankDir = resolveRankDir(graph);
  const isLr = rankDir === "LR";

  try {
    container.innerHTML = "";
    const cy = cytoscape({
      container,
      elements,
      style: CEDAR_STYLE,
      minZoom: 0.2,
      maxZoom: 2.25,
      wheelSensitivity: 0.2,
      userPanningEnabled: true,
      userZoomingEnabled: true,
      boxSelectionEnabled: false,
      pixelRatio: Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio : 1),
    });

    cy.layout({
      name: "dagre",
      rankDir,
      nodeSep: isLr ? 56 : 48,
      rankSep: isLr ? 100 : 88,
      edgeSep: 20,
      animate: false,
    }).run();

    cy.one("layoutstop", () => {
      cy.resize();
      cy.fit(cy.elements(), 56);
      cy.center(cy.elements());
    });

    wireCyResize(cy, container);
    instances.set(key, cy);
    return cy;
  } catch (err) {
    console.error("[cedar] cytoscape mount failed", err);
    container.innerHTML = `<p class="p-4 text-center text-sm text-rose-300">Diagram failed: ${escapeMsg(err)}</p>`;
    return null;
  }
}

/**
 * @param {HTMLElement} root
 * @param {object} diagramGraph
 */
export function mountArchitectureGraphs(root, diagramGraph) {
  if (!diagramGraph?.overview) return false;

  const host = root.querySelector("#cedar-cy-slices");
  const ok = host ? mountCy(host, diagramGraph) !== null : false;

  root.querySelectorAll("[data-cy-action]").forEach((btn) => {
    if (btn.dataset.wired) return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-cy-target");
      const action = btn.getAttribute("data-cy-action");
      const cy = instances.get(targetId);
      if (!cy) return;
      if (action === "fit") {
        cy.resize();
        cy.fit(cy.elements(), 56);
      } else if (action === "in") cy.zoom(cy.zoom() * 1.1);
      else if (action === "out") cy.zoom(cy.zoom() / 1.1);
    });
  });
  return ok;
}

/**
 * @param {unknown} err
 */
function escapeMsg(err) {
  const m = err instanceof Error ? err.message : String(err);
  return m.replace(/</g, "&lt;");
}

export function destroyArchitectureGraphs() {
  for (const cy of instances.values()) cy.destroy();
  instances.clear();
}