/**
 * C4 / arc42-style views derived from PR architecture layers.
 * @typedef {import('./pr-architecture-layers.js').PrArchitectureLayer} PrArchitectureLayer
 */

import { normalizeSliceId } from "./architecture-model.js";
import { formatPrHubLabel, mermaidFlowNodeLabel } from "./diagram-labels.js";
import { mermaidSafeText } from "./mermaid-sanitize.js";

const REQUEST_CHAIN = ["web", "api", "application", "domain", "repository", "infrastructure"];

const DB_LAYERS = new Set(["persistence", "migrations", "repository"]);
const OPS_LAYERS = new Set(["build_deploy", "infrastructure", "config", "integration", "migrations"]);

/**
 * @param {PrArchitectureLayer[]} layers
 * @param {{ title?: string, number?: number }} [pull]
 * @param {{ owner?: string, repo?: string }} [target]
 */
export function buildC4ContextView(layers, pull, target) {
  const prTitle = mermaidSafeText(formatPrHubLabel(pull, target));
  const repo = target?.owner && target?.repo ? `${target.owner}/${target.repo}` : "this repository";
  const lines = [
    "C4Context",
    `title System context · ${prTitle}`,
    'Person(reviewer, "Reviewer", "Reads architecture and review output")',
    'Person(dev, "Developer", "Author of the PR changes")',
  ];
  if (layers.some((l) => normalizeSliceId(l.id) === "web")) {
    lines.push('Person_Ext(user, "End user", "Uses the product when UI changes land")');
  }
  lines.push(
    `System(system, "${mermaidSafeText(repo)}", "System under review in this pull request")`,
    'System_Ext(github, "GitHub", "Pull request, checks, and merge workflow")',
    'System_Ext(ci, "CI / automation", "Build, test, and deploy pipelines")',
    'Rel(dev, github, "Opens and updates PR")',
    'Rel(reviewer, github, "Reviews and comments")',
    'Rel(github, system, "Scopes diff and status")',
    'Rel(ci, system, "Validates changes")',
  );
  if (layers.some((l) => normalizeSliceId(l.id) === "web")) {
    lines.push('Rel(user, system, "Uses", "HTTPS")');
  }
  for (const layer of layers.slice(0, 8)) {
    const id = c4Alias(layer.id);
    const name = mermaidSafeText(layer.name);
    if (OPS_LAYERS.has(normalizeSliceId(layer.id)) && !["build_deploy", "integration"].includes(normalizeSliceId(layer.id))) {
      continue;
    }
    if (normalizeSliceId(layer.id) === "integration") {
      lines.push(`System_Ext(${id}, "${name}", "${mermaidSafeText(layer.summary || "External integration")}")`);
      lines.push(`Rel(system, ${id}, "Integrates")`);
    }
  }
  lines.push('UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")');
  return lines.join("\n");
}

/**
 * @param {PrArchitectureLayer[]} layers
 * @param {{ title?: string, number?: number }} [pull]
 * @param {{ owner?: string, repo?: string }} [target]
 */
export function buildC4ContainerView(layers, pull, target) {
  if (!layers.length) {
    return 'C4Container\ntitle Containers\nContainer(empty, "Empty", "No layers in PR")';
  }
  const prTitle = mermaidSafeText(formatPrHubLabel(pull, target));
  const active = new Set(layers.map((l) => normalizeSliceId(l.id)));
  const lines = [
    "C4Container",
    `title Container · ${prTitle}`,
    'Person(reviewer, "Reviewer")',
    'System_Ext(github, "GitHub")',
    'Container_Boundary(boundary, "Changed system") {',
  ];

  for (const layer of layers) {
    const alias = c4Alias(layer.id);
    const label = mermaidSafeText(mermaidFlowNodeLabel(layer));
    const tech = mermaidSafeText((layer.types ?? []).slice(0, 3).join(", ") || "application code");
    const desc = mermaidSafeText(layer.summary || layer.name);
    if (DB_LAYERS.has(normalizeSliceId(layer.id))) {
      lines.push(`    ContainerDb(${alias}, "${label}", "${tech}", "${desc}")`);
    } else if (normalizeSliceId(layer.id) === "integration") {
      lines.push(`    Container_Ext(${alias}, "${label}", "${tech}", "${desc}")`);
    } else {
      lines.push(`    Container(${alias}, "${label}", "${tech}", "${desc}")`);
    }
  }
  lines.push("  }");

  const entry =
    (active.has("web") && c4Alias("web")) ||
    (active.has("api") && c4Alias("api")) ||
    c4Alias(layers[0].id);
  lines.push(`Rel(reviewer, ${entry}, "Reviews impact via PR")`);
  lines.push(`Rel(github, ${entry}, "Hosts diff")`);

  const chain = REQUEST_CHAIN.filter((id) => active.has(id)).map((id) => c4Alias(id));
  for (let i = 0; i < chain.length - 1; i++) {
    lines.push(`Rel(${chain[i]}, ${chain[i + 1]}, "request path")`);
  }

  for (const layer of layers) {
    const from = c4Alias(layer.id);
    for (const dep of layer.dependsOn) {
      const to = c4Alias(dep);
      if (from !== to && active.has(normalizeSliceId(dep))) {
        lines.push(`Rel(${from}, ${to}, "depends on")`);
      }
    }
  }

  lines.push('UpdateLayoutConfig($c4ShapeInRow="2", $c4BoundaryInRow="1")');
  return lines.join("\n");
}

/**
 * @param {PrArchitectureLayer[]} layers
 * @param {ReturnType<import('./architecture-layout-views.js').buildClassRegistry>} registry
 * @param {{ title?: string, number?: number }} [pull]
 * @param {{ owner?: string, repo?: string }} [target]
 */
export function buildC4ComponentView(layers, registry, pull, target) {
  const focal =
    layers.find((l) => normalizeSliceId(l.id) === "application") ??
    layers.find((l) => normalizeSliceId(l.id) === "api") ??
    layers[0];
  if (!focal || !registry.classes.length) {
    return 'C4Component\ntitle Components\nComponent(none, "None", "No types in PR")';
  }

  const prTitle = mermaidSafeText(formatPrHubLabel(pull, target));
  const boundaryAlias = c4Alias(focal.id);
  const boundaryLabel = mermaidSafeText(focal.name);
  const lines = [
    "C4Component",
    `title Component · ${boundaryLabel} · ${prTitle}`,
    `Container_Boundary(${boundaryAlias}, "${boundaryLabel}") {`,
  ];

  const inFocal = registry.classes.filter((c) => c.layerId === focal.id).slice(0, 18);
  const used = new Set();
  for (const c of inFocal) {
    if (used.has(c.mermaidId)) continue;
    used.add(c.mermaidId);
    const tech = mermaidSafeText(c.layer.summary?.split(" ")[0] ?? "Type");
    lines.push(
      `    Component(${c.mermaidId}, "${mermaidSafeText(c.typeName)}", "${tech}", "${mermaidSafeText(c.layer.summary || "Touched in PR")}")`
    );
  }

  if (!inFocal.length) {
    const anchor = registry.layerToAnchor.get(focal.id) ?? "comp_layer";
    lines.push(`    Component(${anchor}, "${boundaryLabel}", "layer", "Slice aggregate")`);
  }

  lines.push("  }");

  const peers = layers.filter((l) => l.id !== focal.id).slice(0, 6);
  for (const peer of peers) {
    const alias = c4Alias(peer.id);
  const label = mermaidSafeText(peer.name);
    if (DB_LAYERS.has(normalizeSliceId(peer.id))) {
      lines.push(`ContainerDb(${alias}, "${label}")`);
    } else {
      lines.push(`Container(${alias}, "${label}")`);
    }
  }

  for (const c of inFocal) {
    for (const dep of c.layer.dependsOn ?? []) {
      const to = registry.layerToAnchor.get(normalizeSliceId(dep)) ?? c4Alias(dep);
      if (to && to !== c.mermaidId) {
        lines.push(`Rel(${c.mermaidId}, ${to}, "uses")`);
      }
    }
  }

  for (let i = 0; i < inFocal.length - 1; i++) {
    lines.push(`Rel(${inFocal[i].mermaidId}, ${inFocal[i + 1].mermaidId}, "collaborates")`);
  }

  lines.push('UpdateLayoutConfig($c4ShapeInRow="2", $c4BoundaryInRow="1")');
  return lines.join("\n");
}

/**
 * @param {PrArchitectureLayer[]} layers
 * @param {Set<string>} active
 * @param {ReturnType<import('./architecture-layout-views.js').buildClassRegistry>} registry
 * @param {{ title?: string, number?: number }} [pull]
 * @param {{ owner?: string, repo?: string }} [target]
 */
export function buildC4DynamicView(layers, active, registry, pull, target) {
  const prTitle = mermaidSafeText(formatPrHubLabel(pull, target));
  const lines = ["C4Dynamic", `title Runtime · ${prTitle}`];

  const anchor = (layerId) => registry.layerToAnchor.get(normalizeSliceId(layerId)) ?? c4Alias(layerId);
  const declare = new Set();

  const declareContainer = (layerId, label, summary) => {
    const a = c4Alias(layerId);
    if (declare.has(a)) return a;
    declare.add(a);
    if (DB_LAYERS.has(normalizeSliceId(layerId))) {
      lines.push(`ContainerDb(${a}, "${mermaidSafeText(label)}", "", "${mermaidSafeText(summary)}")`);
    } else {
      lines.push(`Container(${a}, "${mermaidSafeText(label)}", "", "${mermaidSafeText(summary)}")`);
    }
    return a;
  };

  const useReviewer = !active.has("web");
  if (useReviewer) {
    lines.push('Person(reviewer, "Caller")');
  }

  for (const layer of layers.slice(0, 12)) {
    declareContainer(layer.id, mermaidFlowNodeLabel(layer), layer.summary);
  }

  const chainPresent = REQUEST_CHAIN.filter((id) => active.has(id));
  let prev = active.has("web") ? anchor("web") : "reviewer";

  for (const lid of chainPresent) {
    const to = anchor(lid);
    if (!to || prev === to) continue;
    lines.push(`Rel(${prev}, ${to}, "${mermaidSafeText(stepLabel(prev, to))}")`);
    prev = to;
  }

  if (lines.length <= 2) {
    const first = registry.classes[0];
    if (first) {
      const from = useReviewer ? "reviewer" : prev;
      lines.push(`Rel(${from}, ${first.mermaidId}, "touches ${mermaidSafeText(first.typeName)}")`);
    }
  }

  return lines.join("\n");
}

/**
 * @param {PrArchitectureLayer[]} layers
 * @param {{ title?: string, number?: number }} [pull]
 * @param {{ owner?: string, repo?: string }} [target]
 */
export function buildC4DeploymentView(layers, pull, target) {
  const prTitle = mermaidSafeText(formatPrHubLabel(pull, target));
  const deployable = layers.filter((l) =>
    ["web", "api", "application", "build_deploy", "infrastructure", "persistence"].includes(normalizeSliceId(l.id))
  );
  const lines = [
    "C4Deployment",
    `title Deployment · ${prTitle}`,
    'Deployment_Node(env, "Runtime", "Environment affected by this PR") {',
  ];

  const grouped = deployable.length ? deployable : layers.slice(0, 8);
  for (const layer of grouped) {
    const alias = c4Alias(layer.id);
    const label = mermaidSafeText(layer.name);
    lines.push(`    Deployment_Node(node_${alias}, "${label}", "deploy unit") {`);
    if (DB_LAYERS.has(normalizeSliceId(layer.id))) {
      lines.push(`        ContainerDb(${alias}, "${label}")`);
    } else {
      lines.push(`        Container(${alias}, "${label}")`);
    }
    lines.push("    }");
  }
  lines.push("  }");

  const active = new Set(grouped.map((l) => c4Alias(l.id)));
  const ids = grouped.map((l) => c4Alias(l.id));
  for (let i = 0; i < ids.length - 1; i++) {
    if (active.has(ids[i]) && active.has(ids[i + 1])) {
      lines.push(`Rel(${ids[i]}, ${ids[i + 1]}, "traffic / deps")`);
    }
  }

  lines.push('UpdateLayoutConfig($c4ShapeInRow="2", $c4BoundaryInRow="1")');
  return lines.join("\n");
}

/**
 * @param {string} from
 * @param {string} to
 */
function stepLabel(from, to) {
  if (from === "reviewer") return "triggers change";
  return "call";
}

/**
 * @param {string} id
 */
function c4Alias(id) {
  const norm = normalizeSliceId(id);
  const base = String(norm).replace(/[^a-zA-Z0-9_]/g, "_") || "layer";
  return /^[a-zA-Z_]/.test(base) ? base : `L_${base}`;
}