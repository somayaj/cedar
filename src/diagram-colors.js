/** Review status → diagram fills (Cytoscape / badges). */
export const REVIEW_STATUS_COLORS = {
  passed: { fill: "#14532d", border: "#34d399", text: "#d1fae5" },
  failed: { fill: "#450a0a", border: "#f87171", text: "#fecaca" },
  warning: { fill: "#422006", border: "#fbbf24", text: "#fef3c7" },
  pending: { fill: "#1c1917", border: "#f59e0b", text: "#fde68a" },
  skipped: { fill: "#18181b", border: "#71717a", text: "#d4d4d4" },
};

/** Canonical layer accents for flow / layer chips. */
export const LAYER_ACCENT_COLORS = {
  web: { fill: "#172554", stroke: "#60a5fa", text: "#dbeafe" },
  api: { fill: "#3b0764", stroke: "#c084fc", text: "#f3e8ff" },
  application: { fill: "#134e4a", stroke: "#2dd4bf", text: "#ccfbf1" },
  domain: { fill: "#422006", stroke: "#fb923c", text: "#ffedd5" },
  repository: { fill: "#1e3a5f", stroke: "#38bdf8", text: "#e0f2fe" },
  infrastructure: { fill: "#27272a", stroke: "#a1a1aa", text: "#f4f4f5" },
  persistence: { fill: "#312e81", stroke: "#818cf8", text: "#e0e7ff" },
  config: { fill: "#1f2937", stroke: "#9ca3af", text: "#f3f4f6" },
  build_deploy: { fill: "#4a044e", stroke: "#e879f9", text: "#fae8ff" },
  integration: { fill: "#164e63", stroke: "#22d3ee", text: "#cffafe" },
  migrations: { fill: "#365314", stroke: "#a3e635", text: "#ecfccb" },
  misc: { fill: "#171717", stroke: "#737373", text: "#f5f5f5" },
};

/** @param {string} layerId */
export function layerAccent(layerId) {
  const key = String(layerId ?? "").toLowerCase();
  return LAYER_ACCENT_COLORS[key] ?? LAYER_ACCENT_COLORS.misc;
}

/** Slice index palette for badge #n (1-based). */
export const SLICE_INDEX_COLORS = [
  "#60a5fa",
  "#c084fc",
  "#34d399",
  "#fb923c",
  "#f472b6",
  "#2dd4bf",
  "#facc15",
  "#818cf8",
];

/**
 * @param {number} index1
 */
export function sliceIndexColor(index1) {
  const i = Math.max(1, index1) - 1;
  return SLICE_INDEX_COLORS[i % SLICE_INDEX_COLORS.length];
}