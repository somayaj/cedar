import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPrReviewPipeline } from "./orchestrator.js";
import { resolvePrTarget } from "./parse-pr-url.js";
import { submitGithubApproval } from "./approve.js";
import { listInlineDiffComments, submitInlineDiffComment } from "./inline-comment.js";
import { explainGithubError } from "./github-token-help.js";
import {
  DEFAULT_CURSOR_MODEL,
  DEFAULT_OPENROUTER_MODEL,
  resolveAiModel,
  resolveCursorModel,
} from "./default-model.js";
import { activeAiProvider, hasAiProvider } from "./ai-chat.js";
import { cursorApiKey, openRouterApiKey } from "./ai-credentials.js";
import { answerPrChatQuestion, prChatProviderLabel } from "./pr-chat.js";
import { cedarAiDiagramMode } from "./diagram-visual-mode.js";
import { ensureCursorBridge, bridgeBaseUrl, isBridgeManaged } from "./cursor-bridge-spawn.js";
import { warmCursorBridgeSession } from "./cursor-bridge-client.js";
import { runWithReviewProgress } from "./review-progress.js";
import { resolveDiffFontConfig } from "./diff-font-config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const port = Number(process.env.PORT ?? 3847);

const app = express();
app.use(cors());
app.use(express.json({ limit: "8mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    hasToken: Boolean(process.env.GITHUB_TOKEN),
    hasCursor: Boolean(cursorApiKey()),
    hasOpenRouter: Boolean(openRouterApiKey()),
    aiProvider: activeAiProvider(),
    sliceReviewProvider: cursorApiKey() ? "cursor" : null,
    prChat: hasAiProvider(),
    cursorBridge:
      process.env.CEDAR_CURSOR_BRIDGE === "false"
        ? "off"
        : process.env.CEDAR_CURSOR_BRIDGE_URL ?? bridgeBaseUrl(),
    cursorBridgeManaged: isBridgeManaged(),
    cursorMode: process.env.CEDAR_CURSOR_MODE ?? "plan",
    partitionMode: process.env.CEDAR_PARTITION_MODE ?? "auto",
    aiDiagram: cedarAiDiagramMode(),
    breakoutCache: process.env.CEDAR_BREAKOUT_CACHE !== "false",
    aiModel: resolveAiModel(),
    cursorModel: resolveCursorModel(),
    defaultCursorModel: DEFAULT_CURSOR_MODEL,
    defaultOpenRouterModel: DEFAULT_OPENROUTER_MODEL,
    githubTokenHint:
      "Reviews/approvals need Pull requests: Read and write (fine-grained) or repo scope (classic).",
    diffFont: resolveDiffFontConfig(),
  });
});

/**
 * @param {Awaited<ReturnType<typeof runPrReviewPipeline>>} report
 */
function reviewPayload(report) {
  return {
    target: report.target,
    pull: report.pull,
    process: report.process,
    gate: report.gate,
    partition: report.partition,
    breakouts: report.breakouts,
    microPrs: report.microPrs,
    microResults: report.microResults,
    composite: report.composite,
    outputMarkdown: report.outputMarkdown,
  };
}

/**
 * @param {import("express").Request} req
 * @returns {{ target: { owner: string, repo: string, pr: number }, token: string, post: boolean, postMicro: boolean } | { error: string, status: number }}
 */
function parseReviewRequest(req) {
  const { post, postMicro } = req.body ?? {};
  const token = req.body?.token ?? process.env.GITHUB_TOKEN;
  try {
    const target = resolvePrTarget(req.body);
    if (!token) {
      return {
        error: "Set GITHUB_TOKEN on the server or pass token in the request",
        status: 400,
      };
    }
    return {
      target,
      token,
      post: Boolean(post),
      postMicro: Boolean(postMicro),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message, status: 400 };
  }
}

app.post("/api/review", async (req, res) => {
  const parsed = parseReviewRequest(req);
  if ("error" in parsed) {
    res.status(parsed.status).json({ error: parsed.error });
    return;
  }

  try {
    const report = await runPrReviewPipeline({
      owner: parsed.target.owner,
      repo: parsed.target.repo,
      pr: parsed.target.pr,
      token: parsed.token,
      configPath: path.join(root, "components.yaml"),
      post: parsed.post,
      postMicro: parsed.postMicro,
    });
    res.json(reviewPayload(report));
  } catch (err) {
    const explained = explainGithubError(err, { action: "read this pull request" });
    res.status(/** @type {{ status?: number }} */ (err)?.status ?? 500).json(explained);
  }
});

app.post("/api/review/stream", async (req, res) => {
  const parsed = parseReviewRequest(req);
  if ("error" in parsed) {
    res.status(parsed.status).json({ error: parsed.error });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  if (typeof res.flushHeaders === "function") res.flushHeaders();
  res.write(": cedar review stream\n\n");

  const send = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    if (typeof res.flush === "function") res.flush();
  };

  try {
    send({ type: "activity", text: "Starting review…", phase: "start" });
    const report = await runWithReviewProgress(send, () =>
      runPrReviewPipeline({
        owner: parsed.target.owner,
        repo: parsed.target.repo,
        pr: parsed.target.pr,
        token: parsed.token,
        configPath: path.join(root, "components.yaml"),
        post: parsed.post,
        postMicro: parsed.postMicro,
      })
    );
    send({ type: "done", report: reviewPayload(report) });
  } catch (err) {
    const explained = explainGithubError(err, { action: "read this pull request" });
    send({ type: "error", error: explained.error ?? String(err) });
  } finally {
    res.end();
  }
});

app.post("/api/pr-chat", async (req, res) => {
  const { messages, context } = req.body ?? {};
  if (!hasAiProvider()) {
    res.status(503).json({
      error: "Set CURSOR_API_KEY or OPENROUTER_API_KEY on the server",
      provider: null,
    });
    return;
  }
  if (!context || typeof context !== "object") {
    res.status(400).json({ error: "context required (review snapshot from Cedar UI)" });
    return;
  }
  if (!Array.isArray(messages)) {
    res.status(400).json({ error: "messages array required" });
    return;
  }

  try {
    const reply = await answerPrChatQuestion(messages, context);
    res.json({
      reply: String(reply ?? "").trim(),
      provider: prChatProviderLabel(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message, provider: prChatProviderLabel() });
  }
});

app.post("/api/comments/list", async (req, res) => {
  const token = req.body?.token ?? process.env.GITHUB_TOKEN;
  const { owner, repo, pr, prUrl } = req.body ?? {};

  if (!token) {
    res.status(400).json({ error: "GitHub token required" });
    return;
  }

  try {
    const result = await listInlineDiffComments({ prUrl, owner, repo, pr, token });
    res.json(result);
  } catch (err) {
    const explained = explainGithubError(err, { action: "list pull request review comments" });
    const errStatus = /** @type {{ status?: number }} */ (err)?.status;
    const status = errStatus === 403 ? 403 : 500;
    res.status(status).json(explained);
  }
});

app.post("/api/comment", async (req, res) => {
  const token = req.body?.token ?? process.env.GITHUB_TOKEN;
  const { path, line, side, body, headSha, owner, repo, pr, prUrl, componentId, componentName } = req.body ?? {};

  if (!token) {
    res.status(400).json({ error: "GitHub token required" });
    return;
  }
  if (!path || typeof path !== "string") {
    res.status(400).json({ error: "path required" });
    return;
  }
  const lineNum = Number(line);
  if (!Number.isFinite(lineNum) || lineNum < 1) {
    res.status(400).json({ error: "valid line required" });
    return;
  }
  if (!body || typeof body !== "string" || !body.trim()) {
    res.status(400).json({ error: "comment body required" });
    return;
  }

  try {
    const result = await submitInlineDiffComment({
      prUrl,
      owner,
      repo,
      pr,
      token,
      path,
      line: lineNum,
      side: side === "LEFT" ? "LEFT" : "RIGHT",
      body,
      headSha,
      componentId,
      componentName,
    });
    res.json(result);
  } catch (err) {
    const explained = explainGithubError(err, { action: "post a pull request review comment" });
    const errStatus = /** @type {{ status?: number }} */ (err)?.status;
    const status = errStatus === 403 ? 403 : errStatus === 422 ? 422 : 500;
    res.status(status).json(explained);
  }
});

app.post("/api/approve", async (req, res) => {
  const token = req.body?.token ?? process.env.GITHUB_TOKEN;
  const { scope, componentId, componentName, headSha, event, body, prUrl } = req.body ?? {};

  if (!token) {
    res.status(400).json({ error: "GitHub token required" });
    return;
  }
  if (!scope || !["slice", "pr"].includes(scope)) {
    res.status(400).json({ error: "scope must be slice or pr" });
    return;
  }
  if (scope === "slice" && !componentId) {
    res.status(400).json({ error: "componentId required for slice approval" });
    return;
  }

  try {
    const result = await submitGithubApproval({
      prUrl,
      owner: req.body?.owner,
      repo: req.body?.repo,
      pr: req.body?.pr,
      token,
      scope,
      componentId,
      componentName,
      headSha,
      event,
      body,
    });
    res.json(result);
  } catch (err) {
    const explained = explainGithubError(err, { action: "create a pull request review" });
    const errStatus = /** @type {{ status?: number }} */ (err)?.status;
    const status = errStatus === 403 ? 403 : errStatus === 422 ? 422 : 500;
    res.status(status).json(explained);
  }
});

const webDist = path.join(root, "dist/web");
app.use(express.static(webDist));
app.use((req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  res.sendFile(path.join(webDist, "index.html"), (err) => {
    if (err) next();
  });
});

app.listen(port, () => {
  console.log(`cedar API http://127.0.0.1:${port}`);
  if (process.env.CURSOR_API_KEY && process.env.CEDAR_CURSOR_BRIDGE !== "false") {
    void (async () => {
      try {
        await ensureCursorBridge();
        const warmed = await warmCursorBridgeSession();
        if (warmed) {
          console.log("cedar Cursor bridge warmed (Reaper-style session)");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`cedar Cursor bridge warmup skipped: ${message}`);
      }
    })();
  }
});