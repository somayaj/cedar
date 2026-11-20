import { splitPatchIntoHunks } from "./partition.js";
import { ARCHITECTURE_MODEL_LABEL, SOLID_REVIEW_CHECKLIST } from "./architecture-model.js";
import { enrichFinding } from "./finding-meta.js";
import {
  firstAddedLineMatching,
  reviewAddedLinesInPatch,
  withCodeAnchor,
} from "./patch-review.js";

const SECRET_PATTERNS = [
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /ghp_[a-zA-Z0-9]{20,}/,
  /xox[baprs]-[a-zA-Z0-9-]+/,
];

const SECURITY_PATCH_PATTERNS = [
  { ruleId: "unsafe-eval", re: /\beval\s*\(/, message: "Patch introduces eval() — avoid dynamic code execution." },
  { ruleId: "unsafe-dom", re: /dangerouslySetInnerHTML|\.innerHTML\s*=/, message: "Patch may assign raw HTML — XSS risk; sanitize or use safe APIs." },
  { ruleId: "unsafe-shell", re: /child_process|execSync\s*\(|spawn\s*\(/, message: "Patch touches process execution — verify inputs and sandboxing." },
  {
    ruleId: "suspicious-auth",
    re: /(password|api[_-]?key|secret)\s*=\s*['"][^'"]+['"]/i,
    message: "Patch may embed credentials in source — use env/secrets manager.",
  },
];

const SKIP_PATH_FRAGMENTS = [
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "go.sum",
  ".min.js",
  ".map",
];

/**
 * @typedef {'info'|'warning'|'blocker'} Severity
 */

/**
 * @typedef {object} Finding
 * @property {string} ruleId
 * @property {Severity} severity
 * @property {string} message
 * @property {string} [filename]
 * @property {number} [line]
 * @property {import('./finding-meta.js').FindingTag} [tag]
 * @property {import('./finding-meta.js').FindingPriority} [priority]
 * @property {string} [source]
 * @property {number} [githubCommentId]
 */

/**
 * @typedef {object} MicroReviewResult
 * @property {string} componentId
 * @property {string} componentName
 * @property {'passed'|'failed'|'skipped'} status
 * @property {Finding[]} findings
 * @property {string} summaryMarkdown
 * @property {number} filesReviewed
 * @property {number} hunksReviewed
 * @property {Finding[]} [reviewComments] Composer line-anchored comments (UI only; heuristics stay in findings)
 * @property {{ source: string, count: number, status?: 'ok'|'empty'|'error'|'stopped'|'skipped'|'pending', error?: string }} [cursorReview]
 */

/**
 * @param {import('./partition.js').MicroPr} micro
 * @param {{ multiBoundaryFiles?: string[] }} ctx
 * @returns {MicroReviewResult}
 */
export function reviewMicroPr(micro, ctx = {}) {
  if (micro.files.length === 0) {
    return {
      componentId: micro.componentId,
      componentName: micro.componentName,
      status: "skipped",
      findings: [],
      summaryMarkdown: "_No files in this architectural slice._",
      filesReviewed: 0,
      hunksReviewed: 0,
    };
  }

  /** @type {Finding[]} */
  const findings = [];
  let hunksReviewed = 0;

  /** @param {Finding} raw */
  const note = (raw) => {
    findings.push(enrichFinding(raw));
  };

  for (const file of micro.files) {
    const name = file.filename;

    if (SKIP_PATH_FRAGMENTS.some((s) => name.includes(s))) {
      note({
        ruleId: "skip-generated",
        severity: "info",
        message: `Skipped heavy/generated path: \`${name}\``,
        filename: name,
      });
      continue;
    }

    if (file.additions + file.deletions > 500) {
      note({
        ruleId: "large-file-delta",
        severity: "warning",
        message: `Large change (+${file.additions}/-${file.deletions}); consider splitting this slice.`,
        filename: name,
      });
    }

    if (ctx.multiBoundaryFiles?.includes(name)) {
      note({
        ruleId: "multi-component-file",
        severity: "warning",
        message: "File matches multiple components; review cross-boundary impact in composite review.",
        filename: name,
      });
    }

    const patch = file.patch ?? "";
    for (const re of SECRET_PATTERNS) {
      const hit = firstAddedLineMatching(patch, re);
      if (!hit) continue;
      note({
        ruleId: "possible-secret",
        severity: "blocker",
        message: withCodeAnchor("Remove secrets from source; rotate credentials and load via env/secret store.", hit),
        filename: name,
        line: hit.line,
        tag: "security",
        priority: "P0",
      });
      break;
    }

    for (const { ruleId, re, message } of SECURITY_PATCH_PATTERNS) {
      const hit = firstAddedLineMatching(patch, re);
      if (!hit) continue;
      note({
        ruleId,
        severity: "warning",
        message: withCodeAnchor(message, hit),
        filename: name,
        line: hit.line,
        tag: "security",
        priority: ruleId === "suspicious-auth" ? "P1" : "P1",
      });
    }

    reviewAddedLinesInPatch(name, patch, note);

    if (/\.env(\.|$)/.test(name) && file.status !== "removed") {
      note({
        ruleId: "env-file",
        severity: "blocker",
        message: "Changes to env files are high risk.",
        filename: name,
      });
    }

    if (/migrations?\//.test(name) && micro.componentId !== "persistence") {
      note({
        ruleId: "migration-outside-persistence",
        severity: "warning",
        message: "Schema/migration change outside persistence component.",
        filename: name,
      });
    }

    if (micro.componentId === "domain" && /\.java$/i.test(name)) {
      if (/^\+.*\bimport\s+org\.springframework\./m.test(patch) || /^\+.*@(Service|Component|Repository)\b/m.test(patch)) {
        note({
          ruleId: "solid/dip-domain-framework",
          severity: "warning",
          message: "DIP/SRP: domain adds framework annotations or Spring imports — prefer pure domain + infrastructure wiring.",
          filename: name,
        });
      }
    }

    if (micro.componentId === "api" && /Controller\.java$/i.test(name)) {
      const added = patch.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
      if (added > 35) {
        note({
          ruleId: "solid/srp-fat-controller",
          severity: "info",
          message: "SRP: large controller diff — delegate business rules to the application layer.",
          filename: name,
        });
      }
    }

    const hunks = splitPatchIntoHunks(patch);
    hunksReviewed += hunks.length;

    const todoHit = firstAddedLineMatching(patch, /\b(TODO|FIXME|HACK)\b/);
    if (todoHit) {
      note({
        ruleId: "todo-in-hunk",
        severity: "info",
        message: withCodeAnchor("Follow-up marker left in production path — track ticket or resolve before merge.", todoHit),
        filename: name,
        line: todoHit.line,
        tag: "hygiene",
        priority: "P3",
      });
    }
    const logHit = firstAddedLineMatching(patch, /console\.(log|debug|info)\(/);
    if (logHit) {
      note({
        ruleId: "debug-log",
        severity: "info",
        message: withCodeAnchor("Debug logging in changed code — remove or gate behind logger level.", logHit),
        filename: name,
        line: logHit.line,
        tag: "hygiene",
        priority: "P3",
      });
    }
  }

  return finalizeMicroReview(micro, findings, hunksReviewed);
}

/**
 * @param {import('./partition.js').MicroPr} micro
 * @param {Finding[]} findings
 * @param {number} hunksReviewed
 * @returns {MicroReviewResult}
 */
export function finalizeMicroReview(micro, findings, hunksReviewed) {
  const hasBlocker = findings.some((f) => f.severity === "blocker");
  const status = hasBlocker ? "failed" : "passed";

  const counts = summarizeFindings(findings);
  const rationaleBlock = micro.rationale
    ? `\n\n_${micro.rationale}_`
    : micro.description
      ? `\n\n_${micro.description}_`
      : "";

  const summaryMarkdown = [
    `**${micro.componentName}** (\`${micro.componentId}\`)`,
    "",
    `- Files: ${micro.files.length} (+${micro.additions}/-${micro.deletions})`,
    `- Hunks analyzed: ${hunksReviewed}`,
    `- Findings: ${counts.blocker} blocker, ${counts.warning} warning, ${counts.info} info`,
    rationaleBlock,
    "",
    findings.length
      ? findings
          .filter((f) => f.severity !== "info")
          .slice(0, 12)
          .map((f) => `- **${f.severity}** \`${f.ruleId}\`${f.filename ? ` (${f.filename})` : ""}: ${f.message}`)
          .join("\n")
      : "_No warnings or blockers in this slice._",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    componentId: micro.componentId,
    componentName: micro.componentName,
    status,
    findings,
    summaryMarkdown,
    filesReviewed: micro.files.length,
    hunksReviewed,
  };
}

/**
 * @param {MicroReviewResult} result
 * @param {import('./partition.js').MicroPr} micro
 * @param {Finding[]} extraFindings
 */
export function mergeMicroReviewFindings(result, micro, extraFindings) {
  if (!extraFindings.length) return result;
  return finalizeMicroReview(micro, [...result.findings, ...extraFindings], result.hunksReviewed);
}

/**
 * @param {Finding[]} findings
 */
function summarizeFindings(findings) {
  return findings.reduce(
    (acc, f) => {
      acc[f.severity] += 1;
      return acc;
    },
    { blocker: 0, warning: 0, info: 0 }
  );
}

/**
 * @param {MicroReviewResult[]} microResults
 * @param {import('./partition.js').MicroPr[]} microPrs
 * @param {*} pull
 */
export function buildCompositeReview(microResults, microPrs, pull) {
  const touched = microResults.filter((r) => r.status !== "skipped");
  const allPassed = touched.every((r) => r.status === "passed");
  const blockers = microResults.flatMap((r) =>
    r.findings.filter((f) => f.severity === "blocker").map((f) => ({ ...f, componentId: r.componentId }))
  );
  const crossCutting = buildCrossCuttingNotes(microPrs, microResults);

  const table = [
    "| Component | Bot | Files | Blockers | Warnings |",
    "|-----------|-----|-------|----------|----------|",
    ...microResults.map((r) => {
      const w = r.findings.filter((f) => f.severity === "warning").length;
      const b = r.findings.filter((f) => f.severity === "blocker").length;
      const bot = r.status === "skipped" ? "—" : r.status === "passed" ? "✅" : "❌";
      return `| ${r.componentName} | ${bot} | ${r.filesReviewed} | ${b} | ${w} |`;
    }),
  ].join("\n");

  const verdict = allPassed && blockers.length === 0 ? "COMMENT" : "REQUEST_CHANGES";
  const verdictLabel =
    verdict === "COMMENT"
      ? "No blocking issues in component slices; human composite approval still recommended."
      : "Blocking issues in one or more component slices.";

  const body = [
    `## Complete architectural PR review`,
    "",
    `**${pull.title}** · head \`${pull.head.sha.slice(0, 7)}\` → base \`${pull.base.sha.slice(0, 7)}\``,
    "",
    "### Component board",
    table,
    "",
    "### Cross-cutting",
    crossCutting.length ? crossCutting.map((n) => `- ${n}`).join("\n") : "_No cross-cutting notes._",
    "",
    blockers.length
      ? "### Blockers\n" + blockers.map((b) => `- **${b.componentId}** ${b.filename ?? ""}: ${b.message}`).join("\n")
      : "",
    "",
    `### Verdict`,
    `**${verdictLabel}**`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    event: verdict,
    body,
    allPassed,
    microResults,
  };
}

/**
 * @param {import('./partition.js').MicroPr[]} microPrs
 * @param {MicroReviewResult[]} results
 * @returns {string[]}
 */
function buildCrossCuttingNotes(microPrs, results) {
  const notes = [];
  const ids = new Set(microPrs.map((m) => m.componentId));

  if (ids.has("api") && ids.has("domain") && !ids.has("integration")) {
    notes.push("Both API and domain changed without contract/integration slice — verify public API ↔ domain alignment.");
  }
  if (ids.has("persistence") && ids.has("domain")) {
    notes.push("Persistence and domain changed — confirm migrations match domain model updates.");
  }
  if (ids.has("web") && ids.has("api")) {
    notes.push("Web and API changed — confirm client calls match server routes.");
  }
  if (ids.size >= 4) {
    notes.push("Many architectural slices touched; consider smaller follow-up PRs if review latency is high.");
  }

  const failed = results.filter((r) => r.status === "failed");
  if (failed.length) {
    notes.push(`Slices with blockers: ${failed.map((f) => f.componentId).join(", ")}.`);
  }

  return notes;
}

/**
 * Narrative synthesis once every touched slice is reviewed — the "whole picture".
 * @param {import('./partition.js').MicroPr[]} microPrs
 * @param {MicroReviewResult[]} microResults
 * @param {*} pull
 */
export function buildWholePicture(microPrs, microResults, pull) {
  const touched = microPrs.filter((m) => m.files.length > 0);
  const layers = touched
    .map((m) => {
      const r = microResults.find((x) => x.componentId === m.componentId);
      return {
        id: m.componentId,
        name: m.componentName,
        files: m.files.length,
        delta: `+${m.additions}/-${m.deletions}`,
        dependsOn: m.dependsOn ?? [],
        status: r?.status ?? "unknown",
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  const flow = describeArchitectureFlow(layers);
  const risk = aggregateRiskProfile(microResults);

  return [
    "## Architecture read",
    "",
    `This PR changes **${touched.length}** architectural layer(s) on branch \`${pull.head.ref}\` (${pull.changed_files ?? touched.length} files in partition).`,
    "",
    "### Layer stack (reviewed bottom → top)",
    ...layers.map(
      (l) =>
        `- **${l.name}** (\`${l.id}\`): ${l.files} files, ${l.delta}${l.dependsOn.length ? ` · depends on ${l.dependsOn.join(", ")}` : ""}`
    ),
    "",
    "### How the change reads architecturally",
    flow,
    "",
    `### ${ARCHITECTURE_MODEL_LABEL} · SOLID reminders`,
    ...SOLID_REVIEW_CHECKLIST.map((line) => `- ${line}`),
    "",
    "### Risk profile (from micro-reviews)",
    `- Blockers: ${risk.blockers}`,
    `- Warnings: ${risk.warnings}`,
    `- Cross-boundary files: ${risk.crossBoundary}`,
    "",
    "_Composite review emitted after all component micro-reviews completed successfully._",
  ].join("\n");
}

/**
 * @param {{ id: string, name: string, dependsOn: string[] }[]} layers
 */
function describeArchitectureFlow(layers) {
  const ids = new Set(layers.map((l) => l.id));
  const paragraphs = [];

  if (ids.has("persistence") && ids.has("domain")) {
    paragraphs.push(
      "Data model and storage moved together — treat as a vertical persistence story: schema first, domain rules second."
    );
  }
  if (ids.has("domain") && ids.has("application")) {
    paragraphs.push(
      "Domain + application moved together — review use cases (SRP) and ensure infrastructure only implements ports (DIP)."
    );
  }
  if (ids.has("domain") && !ids.has("api") && !ids.has("web")) {
    paragraphs.push("Internal domain-only change with no public surface diff — lower integration risk if contracts unchanged.");
  }
  if (ids.has("application") && ids.has("infrastructure")) {
    paragraphs.push("Application and infrastructure slices paired — verify adapters implement application ports without leaking into domain.");
  }
  if (ids.has("config") || ids.has("build_deploy")) {
    paragraphs.push("12-factor config or build surface changed — confirm secrets stay in environment, not source.");
  }
  if (ids.has("api") && ids.has("web")) {
    paragraphs.push("Full stack slice: confirm request/response contracts before UI behavior.");
  }
  if (ids.has("infra") && ids.size === 1) {
    paragraphs.push("Operational change isolated to infra; application layers untouched in this PR.");
  }
  if (ids.has("integration")) {
    paragraphs.push("Explicit contract layer changed — consumers should be checked even if api/domain micro-reviews are clean.");
  }
  if (!paragraphs.length) {
    paragraphs.push(
      layers.length === 1
        ? `Single-layer change (${layers[0].name}) — scope is confined but verify callers outside this slice.`
        : "Multi-layer change — validate dependencies: domain → application → infrastructure/api (DIP)."
    );
  }

  return paragraphs.map((p) => `- ${p}`).join("\n");
}

/**
 * @param {MicroReviewResult[]} microResults
 */
function aggregateRiskProfile(microResults) {
  let blockers = 0;
  let warnings = 0;
  let crossBoundary = 0;
  for (const r of microResults) {
    blockers += r.findings.filter((f) => f.severity === "blocker").length;
    warnings += r.findings.filter((f) => f.severity === "warning").length;
    crossBoundary += r.findings.filter((f) => f.ruleId === "multi-component-file").length;
  }
  return { blockers, warnings, crossBoundary };
}

/**
 * @param {MicroReviewResult[]} microResults
 * @param {{ headSha: string, blockedReason?: string }} gate
 */
export function buildPendingCompositeNotice(microResults, gate) {
  const failed = microResults.filter((r) => r.status === "failed");
  const open = microResults.filter((r) => r.status !== "skipped" && r.status !== "passed");

  return [
    "## Complete architectural review — pending",
    "",
    `Architecture read composite is **not** posted yet for \`${gate.headSha.slice(0, 7)}\`.`,
    "",
    gate.blockedReason ? `**Reason:** ${gate.blockedReason}` : "",
    "",
    failed.length
      ? "### Slices with blockers\n" +
        failed
          .map((f) => {
            const blockers = f.findings.filter((x) => x.severity === "blocker");
            return `- **${f.componentName}**: ${blockers.map((b) => b.message).join("; ")}`;
          })
          .join("\n")
      : "",
    open.length && !failed.length
      ? `_Still reviewing: ${open.map((o) => o.componentId).join(", ")}_`
      : "",
    "",
    "Resolve blockers and re-run; the **Architecture read** composite appears when every touched component micro-review passes.",
  ]
    .filter(Boolean)
    .join("\n");
}