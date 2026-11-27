# Cedar — architectural PR review

Partition a GitHub PR into **architectural slices** (virtual micro-PRs), run **macro** then **per-slice** AI review, and paint the **whole picture** when every touched slice is ready.

## Flow

1. Fetch the PR and partition files into components (`components.yaml` or AI breakouts when `CURSOR_API_KEY` is set).
2. **Macro review** — PR-wide themes (top panel; not inline on the diff).
3. **Slice review** — Composer/Agent review per component; code findings can appear as **Cursor · Draft** threads on the diff; architecture findings stay at the top of each slice.
4. If any slice **fails**, composite synthesis is blocked until blockers are addressed.
5. When **all touched slices pass**, emit the component board, complete review, diagrams, and whole-picture narrative.

## Setup

```bash
npm install
cp .env.example .env
```

| Variable | Purpose |
|----------|---------|
| `GITHUB_TOKEN` | Read PRs; post reviews and inline comments |
| `CURSOR_API_KEY` | AI breakouts, macro/slice review ([Cursor Integrations](https://cursor.com/dashboard/integrations)) |
| `CEDAR_AI_PROVIDER=cursor` | Use Cursor for all AI (recommended) |
| `CEDAR_PARTITION_MODE` | `auto` (default), `ai`, or `yaml` |
| `CEDAR_COMPOSER_REVIEW_MODE` | `agent` (default, technical slice review) or `plan` |

Optional: `CEDAR_CURSOR_BRIDGE` (default on), `CEDAR_AI_SLICE_REVIEW`, `CEDAR_AI_DIAGRAM`, `PORT` — see [`.env.example`](.env.example).

### GitHub token

**Approve** and inline comment APIs need write access. If you see `Resource not accessible by personal access token`:

| Token type | Required access |
|------------|-----------------|
| **Fine-grained** | Repository access · **Pull requests: Read and write** · **Contents: Read** |
| **Classic** | **`repo`** (private) or **`public_repo`** (public) |
| **Org repo** | Authorize **SSO** on the PAT |

Restart `npm run dev:api` after updating `.env`.

## Web UI

```bash
# terminal 1
npm run dev:api

# terminal 2
npm run dev:web
```

Open [http://localhost:5173](http://localhost:5173) — Vite proxies `/api` to port `3847`.

Production:

```bash
npm run build:web
npm start
```

Serves `dist/web` and the review API. Configure tokens in the UI **Room** panel or `.env`.

## CLI

```bash
npm run review -- --url https://github.com/myorg/myapp/pull/42

node src/cli.js review --owner myorg --repo myapp --pr 42 --out report.md --json report.json

node src/cli.js review --owner myorg --repo myapp --pr 42 --post-micro --post
```

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | All slices passed; whole picture generated |
| 1 | Error (auth, config, API) |
| 2 | Review done but composite blocked |

## Customization

- `components.yaml` — path globs and `depends_on` when partition mode is `yaml`
- `src/review-engine.js` — heuristics and composite narrative
- `src/ai-macro-review.js` / `src/ai-micro-review.js` — Cursor prompts for macro and slice passes

## Commit messages

Use conventional prefixes: `feat:`, `fix:`, etc. (no ticket prefix required).