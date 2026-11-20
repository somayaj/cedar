import path from "node:path";
import { loadComponentsConfig } from "./load-config.js";
import { partitionPrByComponents, partitionPrByAssignments } from "./partition.js";
import { discoverArchitecturalBreakouts } from "./ai-breakouts.js";
import { aiReviewMicroSlice } from "./ai-micro-review.js";
import { aiMacroPrReview } from "./ai-macro-review.js";
import {
  createClient,
  fetchPullRequest,
  fetchPullRequestFiles,
  submitPullRequestReview,
} from "./github.js";
import {
  reviewMicroPr,
  mergeMicroReviewFindings,
  buildCompositeReview,
  buildWholePicture,
  buildPendingCompositeNotice,
} from "./review-engine.js";
import { formatComponentBoard, formatJsonReport } from "./format.js";
import { buildArchitectureDiagramMermaid } from "./architecture-diagram.js";
import {
  buildCompleteLayoutViews,
  buildCompleteLayoutMarkdown,
} from "./architecture-layout-views.js";
import { normalizeSliceId } from "./architecture-model.js";
import { sliceReviewAiAvailable, resolveAiProviderName } from "./ai-credentials.js";
import { renderReviewDiagrams } from "./diagram-graphviz.js";
import { orderMicroPrsForLayout } from "./diagram-layout.js";
import { buildDiagramGraph } from "./diagram-graph.js";
import { resolveArchitectureVisual } from "./ai-architecture-visual.js";
import { breakoutCacheKey, readBreakoutCache, writeBreakoutCache } from "./breakout-cache.js";
import { resolveAiModel } from "./default-model.js";
import { emitPhase } from "./review-progress.js";
import {
  alignMicroPrsToPrArchitecture,
  componentsForPrPartition,
  resolvePartitionCatalog,
  summarizePrArchitecture,
} from "./pr-architecture.js";

/**
 * @param {{
 *   owner: string,
 *   repo: string,
 *   pr: number,
 *   token: string,
 *   configPath?: string,
 *   post?: boolean,
 *   postMicro?: boolean,
 *   partitionMode?: 'auto' | 'ai' | 'yaml',
 *   useAiReview?: boolean,
 * }} opts
 */
export async function runPrReviewPipeline(opts) {
  const phase = (id, label, status, detail) => emitPhase(id, label, status, detail);

  const configPath = opts.configPath ?? path.join(process.cwd(), "components.yaml");
  const yamlConfig = loadComponentsConfig(configPath);

  phase("fetch", "Fetch PR from GitHub", "running");
  const octokit = createClient(opts.token);
  const pull = await fetchPullRequest(octokit, {
    owner: opts.owner,
    repo: opts.repo,
    pull_number: opts.pr,
  });
  const files = await fetchPullRequestFiles(octokit, {
    owner: opts.owner,
    repo: opts.repo,
    pull_number: opts.pr,
  });
  phase("fetch", "Fetch PR from GitHub", "done", `${files.length} files`);

  const useAiBreakouts = resolvePartitionMode(opts.partitionMode) === "ai";
  const aiReviewEnv = String(process.env.CEDAR_AI_SLICE_REVIEW ?? "").trim().toLowerCase();
  const useAiReview =
    opts.useAiReview ??
    (aiReviewEnv === "true" ||
      (sliceReviewAiAvailable() && aiReviewEnv !== "false" && aiReviewEnv !== "0"));

  /** @type {import('./ai-breakouts.js').AiBreakoutPlan | null} */
  let breakoutPlan = null;
  let components = yamlConfig.components;
  let defaultComponent = yamlConfig.defaultComponent;

  if (useAiBreakouts) {
    const cacheId = breakoutCacheKey({
      owner: opts.owner,
      repo: opts.repo,
      pr: opts.pr,
      headSha: pull.head.sha,
    });
    const cached = readBreakoutCache(cacheId);
    if (cached?.components?.length && cached?.fileAssignments && cached.strategy !== "heuristic") {
      phase("breakouts", "Architectural breakouts", "running", "cache hit — skipping Cursor");
      phase("breakouts", "Architectural breakouts", "done", "cache · headSha");
      breakoutPlan = {
        ...cached,
        strategy: "cache",
        model: cached.model ?? resolveAiModel(),
      };
    } else {
      phase("breakouts", "Architectural breakouts", "running", "Cursor · plan mode");
      breakoutPlan = await discoverArchitecturalBreakouts(files, {
        title: pull.title,
        body: pull.body ?? "",
        baseRef: pull.base.ref,
        headRef: pull.head.ref,
      });
      if (breakoutPlan.strategy !== "heuristic") {
        writeBreakoutCache(cacheId, {
          architectureSummary: breakoutPlan.architectureSummary,
          components: breakoutPlan.components,
          fileAssignments: breakoutPlan.fileAssignments,
          diagramVisual: breakoutPlan.diagramVisual ?? null,
          model: breakoutPlan.model,
          strategy: breakoutPlan.strategy,
        });
      }
      phase(
        "breakouts",
        "Architectural breakouts",
        "done",
        `${breakoutPlan.components.length} slices · ${breakoutPlan.strategy}`
      );
    }
    components = resolvePartitionCatalog(
      yamlConfig.components,
      breakoutPlan.fileAssignments,
      breakoutPlan.components
    );
    defaultComponent = yamlConfig.defaultComponent;
  } else {
    phase("breakouts", "Map components", "done", "components.yaml");
    components = yamlConfig.components;
    defaultComponent = yamlConfig.defaultComponent;
  }

  phase("partition", "Partition micro slices", "running");
  const { microPrs, multiTagged } = useAiBreakouts
    ? partitionPrByAssignments(files, components, breakoutPlan.fileAssignments, defaultComponent)
    : partitionPrByComponents(files, components, defaultComponent);

  const multiBoundaryFiles = multiTagged.map((f) => f.filename);
  const activeIds = new Set(microPrs.filter((m) => m.files.length > 0).map((m) => m.componentId));
  alignMicroPrsToPrArchitecture(microPrs, activeIds);
  const ordered = orderMicroPrsForLayout(microPrs);

  const prComponents = componentsForPrPartition(
    ordered,
    yamlConfig.components,
    breakoutPlan?.components ?? []
  );
  const prArchitectureSummary = summarizePrArchitecture(files, ordered);
  if (breakoutPlan) {
    breakoutPlan = {
      ...breakoutPlan,
      components: prComponents,
      architectureSummary: prArchitectureSummary,
    };
  } else {
    breakoutPlan = {
      architectureSummary: prArchitectureSummary,
      components: prComponents,
      fileAssignments: Object.fromEntries(
        ordered.flatMap((m) => m.files.map((f) => [f.filename, m.componentId]))
      ),
      model: resolveAiModel(),
      strategy: "yaml",
      diagramVisual: null,
    };
  }
  const sliceCount = ordered.filter((m) => m.files.length > 0).length;
  phase("partition", "Partition micro slices", "done", `${sliceCount} slices`);

  const pullMeta = { number: pull.number, title: pull.title };
  const target = { owner: opts.owner, repo: opts.repo };

  const baseDiagramGraph = buildDiagramGraph(
    ordered,
    breakoutPlan ?? undefined,
    pullMeta,
    target
  );

  const sliceNumberById = Object.fromEntries(
    ordered
      .filter((m) => (m.files?.length ?? 0) > 0)
      .map((m, i) => [normalizeSliceId(m.componentId), i + 1])
  );

  const diagramLayoutViews = buildCompleteLayoutViews(
    ordered,
    breakoutPlan ?? undefined,
    pullMeta,
    target,
    sliceNumberById
  );
  const diagramMermaid = buildArchitectureDiagramMermaid(
    ordered,
    breakoutPlan ?? undefined,
    pullMeta,
    target
  );
  const diagramMarkdown = buildCompleteLayoutMarkdown(diagramLayoutViews);

  phase("review", "Micro reviews & diagrams", "running");
  const [microResults, pipelineRendered, visualResolved] = await Promise.all([
    runMicroReviewPass(ordered, {
      multiBoundaryFiles,
      useAiReview,
      breakoutPlan,
      postMicro: Boolean(opts.postMicro),
      octokit,
      pull,
      owner: opts.owner,
      repo: opts.repo,
      pr: opts.pr,
    }),
    renderReviewDiagrams({
      microPrs: ordered,
      breakouts: breakoutPlan ?? undefined,
      pull: pullMeta,
      target,
    }),
    resolveArchitectureVisual(baseDiagramGraph, ordered, breakoutPlan ?? undefined, pullMeta),
  ]);

  const { graph: diagramGraph, visual: architectureVisual, source: diagramVisualSource } =
    visualResolved;
  const { pipelineDot, pipelineSvg } = pipelineRendered;
  phase("review", "Micro reviews & diagrams", "done", diagramVisualSource ?? "heuristic");

  /** @type {import('./ai-macro-review.js').ReturnType<typeof aiMacroPrReview> extends Promise<infer T> ? T : never} */
  let macroReview = null;
  if (useAiReview && sliceReviewAiAvailable()) {
    phase("macro", "Macro PR review", "running");
    try {
      macroReview = await aiMacroPrReview({
        pull: {
          title: pull.title,
          number: pull.number,
          headSha: pull.head.sha,
        },
        breakouts: breakoutPlan ?? undefined,
        microPrs: ordered,
        microResults,
      });
      phase("macro", "Macro PR review", "done", macroReview ? "Composer" : "empty");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      phase("macro", "Macro PR review", "blocked", message.slice(0, 80));
      console.warn("[cedar] Macro PR review failed:", err);
    }
  }

  const touched = microResults.filter((r) => r.status !== "skipped");
  const allSlicesReviewed = touched.every((r) => r.status === "passed" || r.status === "failed");
  const allPassed = touched.every((r) => r.status === "passed");
  const compositeReady = allSlicesReviewed && allPassed;

  const gate = {
    headSha: pull.head.sha,
    ready: compositeReady,
    blockedReason: compositeReady
      ? undefined
      : describeBlockers(microResults),
  };

  const boardMarkdown = formatComponentBoard(microResults, gate);

  /** @type {object | null} */
  let composite = null;
  /** @type {string} */
  let outputMarkdown;

  if (compositeReady) {
    const base = buildCompositeReview(microResults, microPrs, pull);
    const wholePicture = buildWholePicture(ordered, microResults, pull);
    const body = [
      diagramMarkdown,
      "",
      "---",
      "",
      base.body,
      "",
      "---",
      "",
      wholePicture,
    ].join("\n");

    composite = {
      event: base.event,
      body,
      allPassed: base.allPassed,
    };
    outputMarkdown = [boardMarkdown, "", "---", "", body].join("\n");

    if (opts.post) {
      await submitPullRequestReview(octokit, {
        owner: opts.owner,
        repo: opts.repo,
        pull_number: opts.pr,
        commit_id: pull.head.sha,
        event: base.event,
        body,
      });
    }
  } else {
    const pending = buildPendingCompositeNotice(microResults, gate);
    outputMarkdown = [boardMarkdown, "", diagramMarkdown, "", pending].join("\n");

    if (opts.post) {
      await submitPullRequestReview(octokit, {
        owner: opts.owner,
        repo: opts.repo,
        pull_number: opts.pr,
        commit_id: pull.head.sha,
        event: "COMMENT",
        body: pending,
      });
    }
  }

  const processSteps = buildProcessSteps({
    useAiBreakouts,
    breakoutStrategy: breakoutPlan?.strategy,
    fileCount: files.length,
    sliceCount: microPrs.filter((m) => m.files.length > 0).length,
    microResults,
    compositeReady,
  });

  return {
    target: {
      owner: opts.owner,
      repo: opts.repo,
      pr: opts.pr,
    },
    pull: {
      title: pull.title,
      number: pull.number,
      headSha: pull.head.sha,
      baseSha: pull.base.sha,
      url: pull.html_url,
    },
    process: processSteps,
    partition: {
      mode: useAiBreakouts ? "ai" : "yaml",
      model: breakoutPlan?.model,
    },
    breakouts: {
      architectureSummary:
        breakoutPlan?.architectureSummary ??
        `YAML/heuristic partition · ${microPrs.filter((m) => m.files.length).length} slices`,
      model: breakoutPlan?.model,
      strategy: breakoutPlan?.strategy ?? (useAiBreakouts ? "ai" : "yaml"),
      components: breakoutPlan?.components ?? components.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        rationale: c.rationale,
        depends_on: c.depends_on,
      })),
      diagramMermaid,
      diagramLayoutViews,
      diagramMarkdown,
      diagramPipelineDot: pipelineDot,
      diagramPipelineSvg: pipelineSvg,
      diagramGraph,
      architectureVisual,
      diagramVisualSource,
    },
    microPrs: ordered.map((m) => ({
      componentId: m.componentId,
      componentName: m.componentName,
      virtualPrId: `vpr-${pull.number}-${m.componentId}`,
      fileCount: m.files.length,
      additions: m.additions,
      deletions: m.deletions,
      description: m.description,
      rationale: m.rationale,
      dependsOn: m.dependsOn,
      files: m.files.map((f) => ({
        path: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch ?? null,
      })),
    })),
    microResults,
    macroReview,
    gate,
    composite,
    outputMarkdown,
    toJson() {
      return formatJsonReport({
        pull: this.pull,
        gate: this.gate,
        partition: this.partition,
        breakouts: this.breakouts,
        microResults: this.microResults.map(stripFindingsForJson),
        composite: this.composite
          ? { event: this.composite.event, allPassed: this.composite.allPassed }
          : null,
      });
    },
  };
}

/**
 * @param {import('./partition.js').MicroPr[]} ordered
 * @param {{
 *   multiBoundaryFiles: string[],
 *   useAiReview: boolean,
 *   breakoutPlan: import('./ai-breakouts.js').AiBreakoutPlan | null,
 *   postMicro: boolean,
 *   octokit: import('@octokit/rest').Octokit,
 *   pull: import('@octokit/openapi-types').components['schemas']['pull-request'],
 *   owner: string,
 *   repo: string,
 *   pr: number,
 * }} ctx
 */
/**
 * @param {unknown} err
 */
function isAiAuthError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  return /401|403|User not found|invalid.*api.*key|unauthorized|authentication/i.test(msg);
}

async function runMicroReviewPass(ordered, ctx) {
  /** @type {import('./review-engine.js').MicroReviewResult[]} */
  const microResults = [];
  let aiSliceReviewStopped = false;

  for (const micro of ordered) {
    let result = reviewMicroPr(micro, { multiBoundaryFiles: ctx.multiBoundaryFiles });

    if (ctx.useAiReview && sliceReviewAiAvailable() && !aiSliceReviewStopped && micro.files.length) {
      try {
        const aiFindings = await aiReviewMicroSlice(micro, {
          architectureSummary: ctx.breakoutPlan?.architectureSummary,
        });
        result = { ...result, reviewComments: aiFindings };
      } catch (err) {
        if (isAiAuthError(err)) {
          aiSliceReviewStopped = true;
          console.warn("[cedar] AI slice review disabled after auth error:", err);
        } else {
          console.warn("[cedar] AI slice review skipped for slice", micro.componentId, err);
        }
      }
    }

    microResults.push(result);

    if (ctx.postMicro && result.status !== "skipped") {
      await submitPullRequestReview(ctx.octokit, {
        owner: ctx.owner,
        repo: ctx.repo,
        pull_number: ctx.pr,
        commit_id: ctx.pull.head.sha,
        event: "COMMENT",
        body: [
          `### Micro-review · ${result.componentName}`,
          "",
          result.summaryMarkdown,
        ].join("\n"),
      });
    }
  }

  return microResults;
}

/**
 * @param {'auto' | 'ai' | 'yaml' | undefined} explicit
 */
function resolvePartitionMode(explicit) {
  const mode = explicit ?? process.env.CEDAR_PARTITION_MODE ?? "auto";
  if (mode === "yaml") return "yaml";
  if (mode === "ai") return "ai";
  return resolveAiProviderName() ? "ai" : "yaml";
}

/**
 * @param {import('./review-engine.js').MicroReviewResult} r
 */
function stripFindingsForJson(r) {
  return {
    componentId: r.componentId,
    status: r.status,
    filesReviewed: r.filesReviewed,
    blockerCount: r.findings.filter((f) => f.severity === "blocker").length,
    warningCount: r.findings.filter((f) => f.severity === "warning").length,
  };
}

/**
 * @param {import('./review-engine.js').MicroReviewResult[]} microResults
 */
/**
 * @param {{
 *   useAiBreakouts: boolean,
 *   breakoutStrategy?: string,
 *   fileCount: number,
 *   sliceCount: number,
 *   microResults: import('./review-engine.js').MicroReviewResult[],
 *   compositeReady: boolean,
 * }} ctx
 */
function buildProcessSteps(ctx) {
  const microDone = ctx.microResults.filter((r) => r.status !== "skipped");
  const microPass = microDone.every((r) => r.status === "passed");

  return [
    {
      id: "fetch",
      label: "Fetch PR diff",
      status: "done",
      detail: `${ctx.fileCount} files`,
    },
    {
      id: "breakouts",
      label: ctx.useAiBreakouts ? "AI architectural breakouts" : "Map components (yaml)",
      status: "done",
      detail:
        ctx.breakoutStrategy === "cache"
          ? `${ctx.sliceCount} slices · cache (headSha)`
          : `${ctx.sliceCount} slices`,
    },
    {
      id: "micro",
      label: "Micro review (per slice / file)",
      status: microPass ? "done" : microDone.some((r) => r.status === "failed") ? "blocked" : "done",
      detail: `${microDone.length} slice(s)`,
    },
    {
      id: "macro",
      label: "Macro review (entire PR)",
      status: "done",
      detail: "Composer after micro",
    },
    {
      id: "approve-slices",
      label: "Approve each micro-PR",
      status: "pending",
      detail: "Your sign-off per slice",
    },
    {
      id: "composite",
      label: "Architecture read (composite)",
      status: ctx.compositeReady ? "done" : "blocked",
      detail: ctx.compositeReady ? "Ready" : "Waiting on clean slices",
    },
    {
      id: "approve-pr",
      label: "Approve PR on GitHub",
      status: "pending",
      detail: "After all slices approved",
    },
  ];
}

function describeBlockers(microResults) {
  const failed = microResults.filter((r) => r.status === "failed");
  if (failed.length) {
    return `blocked — fix ${failed.map((f) => f.componentId).join(", ")} before whole-picture review`;
  }
  const pending = microResults.filter((r) => r.status !== "skipped" && r.status !== "passed");
  if (pending.length) {
    return "waiting for all component slices to finish";
  }
  return "composite not ready";
}