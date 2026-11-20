/**
 * @param {string} componentId
 * @param {{ ruleId?: string, filename?: string }} f
 * @param {number} index
 */
export function findingKey(componentId, f, index) {
  if (f.githubCommentId != null) {
    return `${componentId}::github/review-comment::${f.filename ?? ""}::gh-${f.githubCommentId}`;
  }
  return `${componentId}::${f.ruleId ?? "finding"}::${f.filename ?? ""}::${index}`;
}

import { isCodeReviewFinding } from "../../src/finding-meta.js";

/**
 * @param {string} componentId
 * @param {{ findings?: Array<unknown>, reviewComments?: Array<unknown> }} microResult
 * @param {{ githubFindingsBySlice?: Record<string, Array<unknown>> } | undefined} session
 */
export function findingsForSlice(componentId, microResult, session) {
  const comments = Array.isArray(microResult.reviewComments) ? microResult.reviewComments : [];
  const extra = session?.githubFindingsBySlice?.[componentId] ?? [];
  return [...comments, ...extra].filter(isCodeReviewFinding);
}

/**
 * @param {{ ignoredFindings?: Set<string>, findingCommentsPosted?: Set<string> } | undefined} session
 */
export function ensureFindingSession(session) {
  if (!session) return;
  if (!session.ignoredFindings) session.ignoredFindings = new Set();
  if (!session.findingCommentsPosted) session.findingCommentsPosted = new Set();
}

/**
 * @param {string} key
 */
export function isFindingIgnored(key) {
  const session = window.__cedarSession;
  return Boolean(session?.ignoredFindings?.has(key));
}

/**
 * @param {string} patch
 */
export function firstAddedLineInPatch(patch) {
  if (!patch?.trim()) return 1;
  let line = 1;
  for (const raw of patch.split("\n")) {
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      line = Number.parseInt(hunk[1], 10);
      continue;
    }
    if (raw.startsWith("+++") || raw.startsWith("---") || raw.startsWith("diff ")) continue;
    if (raw.startsWith("+")) return line;
    if (raw.startsWith(" ")) line += 1;
  }
  return Math.max(1, line);
}

/**
 * @param {Array<{ componentId: string, findings: Array<{ severity: string, ruleId?: string, filename?: string }> }>} microResults
 * @param {string} severity
 */
export function countActiveFindings(microResults, severity, session) {
  let n = 0;
  for (const r of microResults) {
    const list = findingsForSlice(r.componentId, r, session);
    list.forEach((f, i) => {
      const key = findingKey(r.componentId, f, i);
      if (isFindingIgnored(key)) return;
      if (f.severity === severity) n += 1;
    });
  }
  return n;
}

/**
 * @param {() => void} refreshUi
 */
export function wireFindingActions(root, refreshUi) {
  root.querySelectorAll("[data-finding-ignore]").forEach((btn) => {
    if (!(btn instanceof HTMLButtonElement)) return;
    if (btn.dataset.wiredFinding) return;
    btn.dataset.wiredFinding = "1";
    btn.addEventListener("click", () => {
      const session = window.__cedarSession;
      ensureFindingSession(session);
      const key = btn.getAttribute("data-finding-key");
      if (!key || !session) return;
      session.ignoredFindings.add(key);
      refreshUi();
    });
  });

  root.querySelectorAll("[data-finding-unignore]").forEach((btn) => {
    if (!(btn instanceof HTMLButtonElement)) return;
    if (btn.dataset.wiredFinding) return;
    btn.dataset.wiredFinding = "1";
    btn.addEventListener("click", () => {
      const session = window.__cedarSession;
      const key = btn.getAttribute("data-finding-key");
      if (!key || !session?.ignoredFindings) return;
      session.ignoredFindings.delete(key);
      refreshUi();
    });
  });

  root.querySelectorAll("[data-finding-jump]").forEach((btn) => {
    if (!(btn instanceof HTMLButtonElement)) return;
    if (btn.dataset.wiredFinding) return;
    btn.dataset.wiredFinding = "1";
    btn.addEventListener("click", () => {
      const path = btn.getAttribute("data-filename");
      const panel = btn.closest("[data-slice-panel]");
      if (!path || !(panel instanceof HTMLElement)) return;
      const article = panel.querySelector(`[data-file-review][data-file-path="${CSS.escape(path)}"]`);
      article?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  root.querySelectorAll("[data-finding-comment]").forEach((btn) => {
    if (!(btn instanceof HTMLButtonElement)) return;
    if (btn.dataset.wiredFinding) return;
    btn.dataset.wiredFinding = "1";
    btn.addEventListener("click", () => void postFindingAsComment(btn, refreshUi));
  });
}

/**
 * @param {HTMLButtonElement} btn
 * @param {() => void} refreshUi
 */
async function postFindingAsComment(btn, refreshUi) {
  const session = window.__cedarSession;
  ensureFindingSession(session);
  if (!session) return;

  const key = btn.getAttribute("data-finding-key");
  const path = btn.getAttribute("data-filename");
  const severity = btn.getAttribute("data-finding-severity") ?? "info";
  const ruleId = btn.getAttribute("data-finding-rule") ?? "finding";
  const message = btn.getAttribute("data-finding-message") ?? "";
  const componentId = btn.getAttribute("data-component-id") ?? "";
  const componentName = btn.getAttribute("data-component-name") ?? componentId;

  if (!path) {
    showFindingToast("This finding has no file path — open the diff and add a comment manually.", "error");
    return;
  }

  let patch = "";
  for (const m of session.data?.microPrs ?? []) {
    const file = (m.files ?? []).find((f) => f.path === path || f.filename === path);
    if (file?.patch) {
      patch = file.patch;
      break;
    }
  }
  if (!patch) {
    patch = session.filePatches?.get(`${componentId}::${path}`) ?? "";
  }

  const lineAttr = btn.getAttribute("data-finding-line");
  const parsedLine = lineAttr ? Number.parseInt(lineAttr, 10) : 0;
  const line = Number.isFinite(parsedLine) && parsedLine > 0 ? parsedLine : firstAddedLineInPatch(patch);
  const tag = btn.getAttribute("data-finding-tag") ?? "";
  const priority = btn.getAttribute("data-finding-priority") ?? "";
  const tagLabel = tag ? tag.charAt(0).toUpperCase() + tag.slice(1) : "";
  const header = [priority, tagLabel].filter(Boolean).join(" · ");
  const body = [
    header ? `**${header}**` : `**${severity}**`,
    `(\`${ruleId}\`)`,
  ]
    .filter(Boolean)
    .join(" ") + `\n\n${message}`;

  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = "Posting…";

  try {
    const res = await fetch("/api/comment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prUrl: session.prUrl,
        token: session.token,
        owner: session.data.target?.owner,
        repo: session.data.target?.repo,
        pr: session.data.target?.pr,
        headSha: session.data.pull?.headSha,
        path,
        line,
        side: "RIGHT",
        body,
        componentId,
        componentName,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      const msg = [json.error, json.hint, json.githubMessage].filter(Boolean).join("\n\n");
      throw new Error(msg || "Comment failed");
    }
    if (key) session.findingCommentsPosted.add(key);
    showFindingToast(`Posted on GitHub · ${path}:${line}`);
    refreshUi();
    const results = document.getElementById("results");
    if (results) {
      const { loadDiffReviewComments } = await import("./diff-comments.js");
      void loadDiffReviewComments(results);
    }
  } catch (err) {
    btn.disabled = false;
    btn.textContent = prev;
    showFindingToast(err instanceof Error ? err.message : String(err), "error");
  }
}

/** @type {(msg: string, tone?: string) => void} */
let showFindingToast = (msg) => {
  console.warn("[cedar]", msg);
};

/**
 * @param {(msg: string, tone?: string) => void} fn
 */
export function setFindingToast(fn) {
  showFindingToast = fn;
}