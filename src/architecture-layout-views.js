/**
 * Complete layout: UML components, request flow, and event sequence (PR architecture + class names).
 * @typedef {import('./partition.js').MicroPr} MicroPr
 * @typedef {import('./ai-breakouts.js').AiComponentDef} AiComponentDef
 * @typedef {import('./pr-architecture-layers.js').PrArchitectureLayer} PrArchitectureLayer
 */

import { normalizeSliceId } from "./architecture-model.js";
import { formatPrHubLabel, mermaidFlowNodeLabel } from "./diagram-labels.js";
import { buildPrArchitectureLayers } from "./pr-architecture-layers.js";
import { mermaidClassId, mermaidParticipantAlias, mermaidSafeText } from "./mermaid-sanitize.js";

const MAX_LAYERS = 16;

/** Runtime request path (subset used when layers are present). */
const REQUEST_CHAIN = ["web", "api", "application", "domain", "repository", "infrastructure"];

/** Sidecar ops slices linked into flow. */
const OPS_LINKS = [
  { from: "config", to: "api", label: "configures" },
  { from: "config", to: "application", label: "configures" },
  { from: "build_deploy", to: "api", label: "release" },
  { from: "integration", to: "api", label: "contract" },
  { from: "infrastructure", to: "application", label: "adapters" },
  { from: "persistence", to: "repository", label: "storage" },
  { from: "migrations", to: "repository", label: "schema" },
];

/**
 * @param {{ from: string, to: string }} edge
 */
function requestChainMessage(edge) {
  const key = `${edge.from}->${edge.to}`;
  /** @type {Record<string, string>} */
  const messages = {
    "client->api": "submit request",
    "client->web": "submit request",
    "web->api": "route",
    "api->application": "invoke",
    "application->domain": "command",
    "domain->application": "domain result",
    "application->repository": "persist",
    "repository->application": "stored",
    "domain->repository": "persist",
    "repository->domain": "stored",
    "infrastructure->application": "adapter callback",
  };
  return messages[key] ?? "call";
}

/**
 * @param {PrArchitectureLayer[]} layers
 */
function buildClassRegistry(layers) {
  /** @type {Map<string, string>} */
  const typeToMermaidId = new Map();
  /** @type {Map<string, string[]>} */
  const layerToClassIds = new Map();
  /** @type {Map<string, string>} */
  const layerToAnchor = new Map();
  /** @type {Map<string, string>} */
  const mermaidIdToType = new Map();
  /** @type {Array<{ typeName: string, mermaidId: string, layerId: string, layer: PrArchitectureLayer }>} */
  const classes = [];

  for (const layer of layers) {
    const layerTypes = layer.types ?? [];
    const ids = [];

    if (!layerTypes.length) {
      const className = `${safeIdent(layer.id)}_layer`;
      typeToMermaidId.set(className, className);
      mermaidIdToType.set(className, layer.name);
      ids.push(className);
      classes.push({ typeName: layer.name, mermaidId: className, layerId: layer.id, layer });
    } else {
      for (const typeName of layerTypes) {
        const className = mermaidClassId(typeName, typeToMermaidId);
        if (!typeToMermaidId.has(typeName)) {
          typeToMermaidId.set(typeName, className);
          mermaidIdToType.set(className, typeName);
          classes.push({ typeName, mermaidId: className, layerId: layer.id, layer });
        }
        ids.push(typeToMermaidId.get(typeName) ?? className);
      }
    }

    layerToClassIds.set(layer.id, ids);
    if (ids[0]) layerToAnchor.set(layer.id, ids[0]);
  }

  return { typeToMermaidId, layerToClassIds, layerToAnchor, mermaidIdToType, classes };
}

/**
 * @param {MicroPr[]} microPrs
 * @param {{ components?: AiComponentDef[] }} [breakouts]
 * @param {{ title?: string, number?: number }} [pull]
 * @param {{ owner?: string, repo?: string }} [target]
 * @param {Record<string, number> | Map<string, number>} [sliceNumberById]
 */
export function buildCompleteLayoutViews(microPrs, breakouts, pull, target, sliceNumberById) {
  const layers = buildPrArchitectureLayers(microPrs, breakouts).slice(0, MAX_LAYERS);
  const active = new Set(layers.map((l) => normalizeSliceId(l.id)));
  const registry = buildClassRegistry(layers);
  const sliceNums = sliceNumberById instanceof Map ? sliceNumberById : new Map(Object.entries(sliceNumberById ?? {}));

  return {
    components: buildComponentsClassDiagram(layers, registry, sliceNums),
    flow: buildRequestFlowDiagram(layers, active, pull, target),
    events: buildEventsSequenceDiagram(layers, active, registry),
  };
}

/**
 * @param {PrArchitectureLayer[]} layers
 * @param {ReturnType<typeof buildClassRegistry>} registry
 * @param {Map<string, number>} sliceNums
 */
function buildComponentsClassDiagram(layers, registry, sliceNums) {
  if (!layers.length) {
    return 'classDiagram\n  class EmptyPR["No changed layers"]';
  }

  const lines = ["classDiagram", layers.length <= 4 ? "  direction LR" : "  direction TB"];

  const sliceNum = (layerId, fallback) =>
    sliceNums.get(normalizeSliceId(layerId)) ?? fallback;

  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li];
    const num = sliceNum(layer.id, li + 1);
    const layerTypes = layer.types ?? [];
    if (!layerTypes.length) {
      const className = registry.layerToAnchor.get(layer.id);
      if (!className) continue;
      lines.push(`  class ${className}["${mermaidSafeText(layer.name)}"]`);
      if (layer.summary) lines.push(`  ${className} : ${mermaidSafeText(layer.summary)}`);
      lines.push(`  ${className} : ${mermaidSafeText(`slice #${num}`)}`);
      continue;
    }

    for (let i = 0; i < layerTypes.length; i++) {
      const typeName = layerTypes[i];
      const className = registry.typeToMermaidId.get(typeName);
      if (!className) continue;
      lines.push(`  class ${className}["${mermaidSafeText(typeName)}"]`);
      if (layer.summary && i === 0) lines.push(`  ${className} : ${mermaidSafeText(layer.summary)}`);
      lines.push(`  ${className} : ${mermaidSafeText(`slice #${num}`)}`);
    }
  }

  const deps = new Set();
  for (const layer of layers) {
    const from = registry.layerToAnchor.get(layer.id);
    if (!from) continue;
    for (const depId of layer.dependsOn) {
      const dep = normalizeSliceId(depId);
      const to = registry.layerToAnchor.get(dep);
      if (to && from !== to) {
        const key = `${from}..>${to}`;
        if (!deps.has(key)) {
          deps.add(key);
          lines.push(`  ${from} ..> ${to} : uses`);
        }
      }
    }
  }

  return lines.join("\n");
}

/**
 * @param {PrArchitectureLayer[]} layers
 * @param {Set<string>} active
 * @param {{ title?: string, number?: number }} [pull]
 * @param {{ owner?: string, repo?: string }} [target]
 */
function buildRequestFlowDiagram(layers, active, pull, target) {
  if (!layers.length) {
    return "flowchart LR\n  empty[No layers in PR]";
  }

  const prLabel = mermaidSafeText(formatPrHubLabel(pull, target));
  const lines = [
    "flowchart LR",
    "  classDef pr fill:#fafafa,stroke:#171717,stroke-width:2px,color:#0a0a0a",
    "  classDef layer fill:#141414,stroke:#737373,stroke-width:1px,color:#f5f5f5",
    "  classDef ops fill:#0a0a0a,stroke:#525252,stroke-width:1px,color:#a3a3a3",
    `  pr(("${prLabel}")):::pr`,
  ];

  const nodeId = new Map();
  const register = (id, label, kind = "layer") => {
    const key = normalizeSliceId(id);
    if (!active.has(key) || nodeId.has(key)) return;
    const nid = `flow_${safeIdent(key)}`;
    nodeId.set(key, { nid, kind });
    const labelSafe = mermaidSafeText(label);
    const shape = kind === "ops" ? `[${labelSafe}]` : `["${labelSafe}"]`;
    lines.push(`  ${nid}${shape}:::${kind}`);
  };

  for (const layer of layers) {
    register(layer.id, mermaidFlowNodeLabel(layer));
  }

  const chainPresent = REQUEST_CHAIN.filter((id) => active.has(id));
  const entry =
    (chainPresent.includes("web") && nodeId.get("web")) ||
    (chainPresent.includes("api") && nodeId.get("api")) ||
    (chainPresent[0] && nodeId.get(chainPresent[0]));
  if (entry) lines.push(`  pr --> ${entry.nid}`);
  for (let i = 0; i < chainPresent.length - 1; i++) {
    const a = nodeId.get(chainPresent[i]);
    const b = nodeId.get(chainPresent[i + 1]);
    if (a && b) lines.push(`  ${a.nid} --> ${b.nid}`);
  }

  if (!chainPresent.includes("web") && chainPresent.includes("api")) {
    lines.push(`  client["Client / caller"]:::ops`);
    const api = nodeId.get("api");
    if (api) lines.push(`  client --> ${api.nid}`);
  }

  for (const link of OPS_LINKS) {
    if (!active.has(link.from) || !active.has(link.to)) continue;
    const from = nodeId.get(link.from);
    const to = nodeId.get(link.to);
    if (from && to) {
      lines.push(`  ${from.nid} -.->|${mermaidSafeText(link.label)}| ${to.nid}`);
    }
  }

  for (const layer of layers) {
    const from = nodeId.get(layer.id);
    if (!from) continue;
    for (const dep of layer.dependsOn) {
      const to = nodeId.get(normalizeSliceId(dep));
      if (to && to.nid !== from.nid) {
        lines.push(`  ${from.nid} -.-> ${to.nid}`);
      }
    }
  }

  return lines.join("\n");
}

/**
 * @param {PrArchitectureLayer[]} layers
 * @param {Set<string>} active
 * @param {ReturnType<typeof buildClassRegistry>} registry
 */
function buildEventsSequenceDiagram(layers, active, registry) {
  if (!registry.classes.length) {
    return "sequenceDiagram\n  participant Empty as Empty\n  Empty->>Empty: No types in PR";
  }

  const lines = ["sequenceDiagram", "  autonumber"];
  const seen = new Set();
  const anchor = (layerId) => registry.layerToAnchor.get(layerId);

  const webAnchor = anchor("web");
  if (!webAnchor || !active.has("web")) {
    lines.push("  actor Client as Client");
  }

  for (const c of registry.classes) {
    if (seen.has(c.mermaidId)) continue;
    seen.add(c.mermaidId);
    lines.push(`  participant ${c.mermaidId} as ${mermaidParticipantAlias(c.typeName)}`);
  }

  const msgDone = new Set();
  const emit = (from, to, text, dashed = false) => {
    if (!from || !to || from === to) return;
    const key = `${from}${dashed ? "--" : "->>"}${to}:${text}`;
    if (msgDone.has(key)) return;
    msgDone.add(key);
    const arrow = dashed ? "-->>" : "->>";
    lines.push(`  ${from}${arrow}${to}: ${mermaidSafeText(text)}`);
  };

  /** @type {Set<string>} */
  const chainPairs = new Set();
  const chainPresent = REQUEST_CHAIN.filter((id) => active.has(id) && anchor(id));
  if (chainPresent.length) {
    let prevKey = active.has("web") && webAnchor ? "web" : "client";
    let prevId = prevKey === "client" ? "Client" : webAnchor;
    for (const lid of chainPresent) {
      const toId = anchor(lid);
      if (!toId || !prevId) continue;
      emit(prevId, toId, requestChainMessage({ from: prevKey, to: lid }));
      chainPairs.add(`${prevId}->${toId}`);
      prevKey = lid;
      prevId = toId;
    }
  }

  if (anchor("domain") && anchor("application")) {
    emit(anchor("domain"), anchor("application"), "domain result", true);
  }
  if (anchor("repository") && anchor("application")) {
    emit(anchor("repository"), anchor("application"), "stored", true);
  } else if (anchor("repository") && anchor("domain")) {
    emit(anchor("repository"), anchor("domain"), "stored", true);
  }
  if (anchor("infrastructure") && anchor("application")) {
    emit(anchor("infrastructure"), anchor("application"), "adapter callback", true);
  }

  for (const layer of layers) {
    const from = anchor(layer.id);
    if (!from) continue;
    for (const dep of layer.dependsOn) {
      const to = anchor(normalizeSliceId(dep));
      if (chainPairs.has(`${from}->${to}`)) continue;
      emit(from, to, "uses");
    }
  }

  for (const link of OPS_LINKS) {
    if (!active.has(link.from) || !active.has(link.to)) continue;
    emit(anchor(link.from), anchor(link.to), link.label, true);
  }

  for (const layer of layers) {
    const ids = registry.layerToClassIds.get(layer.id) ?? [];
    for (let i = 0; i < ids.length - 1; i++) {
      const a = ids[i];
      const b = ids[i + 1];
      const aName = registry.mermaidIdToType.get(a) ?? a;
      const bName = registry.mermaidIdToType.get(b) ?? b;
      emit(a, b, `collaborates`);
    }
  }

  if (lines.length <= 2) {
    const first = registry.classes[0];
    emit(active.has("web") && webAnchor ? webAnchor : "Client", first.mermaidId, `touch ${first.typeName}`);
  }

  return lines.join("\n");
}

/**
 * @param {{ components: string, flow: string, events: string }} views
 */
export function buildCompleteLayoutMarkdown(views) {
  return [
    "### Complete layout",
    "",
    "#### UML · components",
    "",
    "```mermaid",
    views.components,
    "```",
    "",
    "#### Flow",
    "",
    "```mermaid",
    views.flow,
    "```",
    "",
    "#### Events",
    "",
    "```mermaid",
    views.events,
    "```",
  ].join("\n");
}

function safeIdent(s) {
  return String(s).replace(/[^a-zA-Z0-9_]/g, "_") || "layer";
}