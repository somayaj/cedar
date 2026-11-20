import { isCodeReviewFinding } from "./finding-meta.js";

/**
 * Browser-safe PR chat context (no Node / Cursor SDK imports).
 * @param {object} report
 */
export function prChatContextFromReport(report) {
  const { target, pull, gate, partition, breakouts, microPrs, microResults, composite, macroReview } = report;
  const slices = (microResults ?? [])
    .filter((r) => r.status !== "skipped")
    .map((r) => {
      const micro = microPrs?.find((m) => m.componentId === r.componentId);
      const codeFindings = (r.reviewComments ?? []).filter(isCodeReviewFinding).slice(0, 12);
      return {
        id: r.componentId,
        name: micro?.componentName ?? r.componentName,
        status: r.status,
        files: micro?.fileCount ?? micro?.files?.length ?? 0,
        codeReviewComments: codeFindings.map((f) => ({
          severity: f.severity,
          priority: f.priority,
          tag: f.tag,
          ruleId: f.ruleId,
          file: f.filename,
          line: f.line,
          message: String(f.message ?? "").slice(0, 400),
          source: f.source ?? "heuristic",
        })),
      };
    });

  return {
    repo: target ? `${target.owner}/${target.repo}` : undefined,
    pull: pull
      ? {
          number: pull.number,
          title: pull.title,
          state: pull.state,
          headSha: pull.head?.sha?.slice(0, 7),
          body: String(pull.body ?? "").slice(0, 1200),
        }
      : undefined,
    partition: partition ? { mode: partition.mode, sliceCount: microPrs?.length } : undefined,
    architectureSummary: breakouts?.architectureSummary?.slice(0, 2000),
    strategy: breakouts?.strategy,
    gate: gate
      ? { ready: gate.ready, blockedReason: gate.blockedReason, headSha: gate.headSha?.slice(0, 7) }
      : undefined,
    slices,
    compositeReady: Boolean(composite?.body),
    compositeExcerpt: composite?.body?.slice(0, 1500),
    macroReview: macroReview?.body?.slice(0, 2500) ?? null,
    macroFindings: (macroReview?.findings ?? []).map((f) => ({
      tag: f.tag,
      priority: f.priority,
      message: String(f.message ?? "").slice(0, 400),
    })),
    macroVerdict: macroReview?.event ?? null,
  };
}