import { activeAiProvider } from "./ai-chat.js";
import { cursorApiKey, sliceReviewAiAvailable } from "./ai-credentials.js";
import { composerReviewChat } from "./cursor-llm.js";
import { resolveCursorModel } from "./default-model.js";
import { enrichFinding, normalizeFindingPriority, normalizeFindingTag } from "./finding-meta.js";
import { parseJsonFromModel } from "./openrouter.js";

/**
 * @param {{
 *   pull: { title?: string, number?: number, headSha?: string },
 *   breakouts?: { architectureSummary?: string, strategy?: string } | null,
 *   microPrs: Array<{ componentId: string, componentName: string, additions?: number, deletions?: number, files?: Array<{ path?: string, filename?: string }>, dependsOn?: string[] }>,
 *   microResults: Array<{ componentId: string, componentName: string, status: string, reviewComments?: Array<{ message?: string, filename?: string, line?: number, tag?: string, priority?: string }> }>,
 * }} ctx
 */
export async function aiMacroPrReview(ctx) {
  if (!sliceReviewAiAvailable() || activeAiProvider() !== "cursor") return null;

  const model = resolveCursorModel();

  const slices = ctx.microResults
    .filter((r) => r.status !== "skipped")
    .map((r) => {
      const micro = ctx.microPrs.find((m) => m.componentId === r.componentId);
      const paths = (micro?.files ?? []).slice(0, 12).map((f) => f.path ?? f.filename);
      const microComments = (r.reviewComments ?? []).slice(0, 8).map((c) => ({
        file: c.filename,
        line: c.line,
        tag: c.tag,
        priority: c.priority,
        excerpt: String(c.message ?? "").slice(0, 320),
      }));
      return {
        id: r.componentId,
        name: r.componentName ?? micro?.componentName,
        status: r.status,
        delta: micro ? `+${micro.additions ?? 0}/-${micro.deletions ?? 0}` : undefined,
        depends_on: micro?.dependsOn ?? [],
        sample_files: paths,
        micro_review_comments: microComments,
      };
    });

  const system = `You write the **macro** (whole pull request) code review — one GitHub review comment for the entire PR.
Micro review already has per-line comments per architectural slice; synthesize the big picture only.
Return JSON only:
{
  "verdict": "approve" | "comment" | "request_changes",
  "priority": "P0" | "P1" | "P2" | "P3",
  "findings": [
    { "ruleId": "macro/short-id", "tag": "security|architecture|quality|boundary|hygiene", "priority": "P0-P3", "message": "One PR-wide theme (2-3 sentences, no file paths required)" }
  ],
  "body": "Markdown for a single PR review comment: ## Summary, ## Architecture & scope, ## Risks & test gaps, ## Recommendation (3-8 short paragraphs, constructive teammate tone)"
}
Rules:
- findings: 3-8 PR-level themes (cross-slice risks, testing, rollout) — not duplicates of every micro line comment.
- Refer to slices by name; do not repeat every micro comment verbatim — integrate themes.
- Call out cross-boundary concerns, missing tests, rollout, and whether this is safe to merge.
- No audit tables, no "finding" jargon, no file-count filler.`;

  const user = JSON.stringify({
    model_hint: model,
    pull: {
      title: ctx.pull.title,
      number: ctx.pull.number,
      head: ctx.pull.headSha?.slice(0, 7),
    },
    architecture: ctx.breakouts?.architectureSummary?.slice(0, 3000) ?? "",
    strategy: ctx.breakouts?.strategy ?? "",
    slices,
  });

  const raw = await composerReviewChat({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    json: true,
    model,
  });

  const parsed = parseJsonFromModel(raw);

  const verdictRaw = String(parsed.verdict ?? "comment").toLowerCase();
  const event =
    verdictRaw === "approve" ? "APPROVE" : verdictRaw === "request_changes" ? "REQUEST_CHANGES" : "COMMENT";

  const themes = Array.isArray(parsed.findings) ? parsed.findings : [];
  const findings = themes
    .slice(0, 10)
    .map((f) => {
      const message = String(f.message ?? "").trim();
      if (!message) return null;
      return enrichFinding({
        ruleId: `macro/${String(f.ruleId ?? "theme").replace(/\s+/g, "-")}`,
        severity: "info",
        message,
        tag: normalizeFindingTag(f.tag),
        priority: normalizeFindingPriority(f.priority),
        source: "composer",
        scope: "pr",
      });
    })
    .filter(Boolean);

  let body = String(parsed.body ?? "").trim();
  if (!body && findings.length) {
    body = [
      "## Summary",
      "",
      ...findings.map((f) => `- **${f.priority ?? "P2"}** · ${f.message}`),
    ].join("\n");
  }
  if (!body && !findings.length) return null;

  return {
    body,
    event,
    priority: String(parsed.priority ?? "P2").toUpperCase(),
    model,
    source: "cursor",
    findings,
  };
}