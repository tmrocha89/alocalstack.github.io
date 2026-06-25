# AGENTS.md — alocalstack (LocalStack Web UI)

**Project root**: `R:\projects\alocalstack`
**Status**: Plan approved (2026-06-15). Phase 0 (scaffold) not yet started. Build mode.

---

## Project Goal
A lightweight, self-hosted React SPA that visually and behaviorally resembles the pre-license open https://app.localstack.cloud/ Resource Browser (dark AWS-console style). It lets users browse and interact with services inside a running LocalStack Docker container.

**Primary target services (MVP, iterative)**: S3, DynamoDB, SQS, SNS, Lambda, Cognito.

**Signature / differentiating feature** (user requirement — non-negotiable):
- After **every** action the UI performs (reads **and** writes), the user can click to reveal the exact equivalent CLI command using the live endpoint/region:
  `aws --endpoint-url=... --region=...`
- Commands are **hidden by default** (click-to-reveal / collapsible) to keep the UI clean.
- For any large or binary payload the generated command **must** use a placeholder file (`fileb://...` or `file://...`) + short, clear instruction text shown in the panel. The UI **never** attempts to embed huge data in the command string.
- S3 operations must use the lower-level `s3api` subcommands (put-object, get-object, list-objects-v2, etc.) to match what the SDK/UI actually calls.
- The generator always uses the **current** user-configurable endpoint + region (defaults: `http://localhost:4566`, `us-east-1`).
- Printed commands are clean single-line only — no automatic `export AWS_*` blocks.

**Confirmed non-goals for MVP**:
- Full container lifecycle (beyond light health panel + optional restart behind strong warnings).
- Advanced IAM, Cloud Pods, multi-account, streaming logs, heavy state export/import.

---

## Locked Architecture & Tech Stack
- **Pure client-side React SPA** — Vite 5 + React 18 + TypeScript (strict). No backend server in v1.
- **Routing / data**: React Router (or TanStack Router) + TanStack Query (React Query).
- **Styling**: Tailwind CSS + shadcn/ui (tables, sheets, dialogs, toasts via sonner, etc.) + lucide-react icons. **Dark theme first**, console/AWS aesthetic. **Do not use Cloudscape**.
- **AWS calls in browser**: Modular AWS SDK v3 clients only:
  - `@aws-sdk/client-s3`
  - `@aws-sdk/client-dynamodb`
  - `@aws-sdk/client-sqs`
  - `@aws-sdk/client-sns`
  - `@aws-sdk/client-lambda`
  - `@aws-sdk/client-cognito-identity-provider`
- Thin factory/hook reads current endpoint + region from a settings store (localStorage persisted + UI editor).
- **Dev proxy**: Vite dev server proxies API calls to the configured LocalStack endpoint (avoids CORS in `npm run dev`).
- **CLI command generation**: Central pure client-side function (e.g. `src/lib/cli.ts`). It must:
  - Accept the same parameters the UI just used for the SDK call + current settings.
  - Always prefix with live `--endpoint-url` and `--region`.
  - For large/binary/complex data → placeholder file + instruction (never inline).
  - For small structured data → pretty JSON + `file://...` fallback.
  - Use `s3api` for all S3.
  - Output must be copy-paste ready shell (correct quoting).
- **Health / instance controls**: Poll `GET /_localstack/health`. Optional `POST /_localstack/health` with `{"action":"restart"}` only behind explicit confirmation + warning.
- **Persistence**: localStorage for endpoint/region/UI prefs. React Query cache for list data.
- **Packaging (both deliverables required)**:
  - `npm run build` → static `dist/`
  - Multi-stage Dockerfile (node → nginx:alpine) + minimal `nginx.conf`
  - `docker-compose.example.yml` (LocalStack + this UI on e.g. 8080)
  - The static `dist/` is a supported target for GitHub Pages and other static hosts. The Vite build must handle configurable base paths and SPA fallback (404.html). Users are expected to supply a reachable LocalStack endpoint — typically an HTTPS tunnel (ngrok / cloudflared) when the UI is served over https. CORS must be configured on the LocalStack side (`EXTRA_CORS_ALLOWED_ORIGINS` including the github.io origin and the tunnel host). See README "Hosting on GitHub Pages" section. The Docker path is the integrated alternative.
- **License**: MIT

---

## Phased Roadmap (follow strictly, ship early)
**Phase 0 – Scaffold**  
Vite + React + TS (strict) + Tailwind + shadcn/ui + dark console theme + basic layout + router + settings store + `lib/cli.ts` skeleton + basic Overview page. Add license + README. Vite proxy.

**Phase 1 – Health + controls + CLI reveal foundation**  
`/_localstack/health` polling + service status grid. Endpoint/region editor. Reusable `CliCommand` / click-to-reveal component. Wire health refresh + restart actions so the reveal panel works end-to-end for the first real actions.

**Phase 2 – S3 (first rich service)**  
Buckets + objects (prefix navigation). Upload (respect size threshold for placeholder), delete, basic download. Every action produces correct `s3api` CLI command. Large uploads emphasize placeholder instructions.

**Phase 3 – DynamoDB**  
Tables + scan + item CRUD (simple editor + raw JSON view). CLI commands for list-tables, describe-table, scan, put-item, delete-item, etc. Binary/large items trigger placeholder guidance.

**Phase 4 – SQS**  
Queues + send + poll/receive/delete/purge. Full set of CLI equivalents.

**Phase 5 – Packaging**  
Production build, Dockerfile + nginx, docker-compose.example.yml, docs. Verify the built container reaches a LocalStack container.

**Phase 6 – SNS + Lambda + Cognito**  
SNS topics + publish (with attributes). Lambda list + invoke (payload editor, response + LogResult). Cognito user pools + list/create users. Every action gets the click-to-reveal CLI panel.

**Phase 7+ – Polish & deferred**  
Global command history + “Export last N actions as script” (explicitly later), better editors, filters, accessibility, keyboard shortcuts, S3 prefix improvements, DynamoDB query support, etc.

---

## Critical Implementation Rules (never violate)
- The CLI command generator (`src/lib/cli.ts` or equivalent) is the **highest priority differentiator**. Implement and prove the `CliCommand` component + generator early (before heavy per-service work).
- **Every** UI-driven action (success or failure) that touches a service **must** surface a correct equivalent command via the click-to-reveal pattern.
- Normal success results keep the CLI panel **collapsed** by default.
- Large/binary threshold: pick a reasonable client-side size; any binary content → **always** placeholder + instructions.
- Endpoint/region changes after an action affect only **future** generated commands. Previously revealed commands stay as historical truth.
- Derive the CLI string from the **same parameter object** the UI sent to the SDK (ensures accuracy).
- Shell safety: never embed huge data; always placeholder + instruction text.
- Keep generated commands using the **live** settings from the store.
- S3 stays strictly on `s3api` subcommands.
- Global history/export feature is explicitly deferred — do not implement in MVP phases 0-6.
- Dark theme / console aesthetic from the start.
- Accessible (labels, focus, ARIA).
- Works against plain community LocalStack (no enterprise-only assumptions).
- Easy to drop the built UI into an existing docker-compose with a LocalStack service.
- The UI must also function correctly when hosted on GitHub Pages (or any static https host). In that case the user configures the endpoint to a publicly reachable https LocalStack (or https tunnel to a local one) and LocalStack is started with appropriate `EXTRA_CORS_ALLOWED_ORIGINS`. Mixed-content and CORS guidance must be provided in the app (settings/health) and docs. CLI commands generated must correctly reflect whatever endpoint the user has configured (tunnel URLs are fine and expected).

---

## Coding Conventions
- TypeScript strict mode. No `any` except in well-justified SDK interop.
- Prefer functional components + hooks.
- Use `const` by default.
- Co-locate related files; keep `src/lib/cli.ts` pure (no side effects, easily testable).
- shadcn/ui components go under `src/components/ui/`.
- Reusable CLI reveal panel as `CliCommand.tsx` (or similar) — make it the canonical way to show post-action commands.
- Keep files focused; follow the high-level layout in `.ai_docs/plan.md`.
- Before any commit or handoff, the revealed commands for the actions just implemented must be manually verified against real LocalStack where possible.

---

## Build, Run & Test Commands
- `npm run dev` — Vite dev server (with proxy)
- `npm run build`
- `npm run preview`
- `npm run typecheck` — TypeScript strict check
- `npm run test:run` — Run all tests once (recommended after changes)
- `npm test` — Run tests in watch mode
- `npm run test:coverage` — Run tests + coverage report
- Docker build + compose smoke test against a LocalStack container.

## Testing Workflow (MANDATORY)
**After ANY implementation or change:**
1. Run `npm run test:run` (or `npm run test:run -- src/lib/cli.test.ts` for targeted)
2. If tests fail:
   - First try to **fix the implementation** so existing behavior is preserved.
   - Only update the test if the test itself was wrong/outdated (rare).
3. Always keep tests green before considering a task complete.
4. Focus test coverage on:
   - `src/lib/cli.ts` (signature feature — highest priority)
   - `src/lib/settings.tsx` (core utilities)
   - Key pure logic and user-facing CLI generation
   - Important React components (CliCommand, etc.)

Tests are written with **Vitest + React Testing Library + jsdom**. New features should come with corresponding tests.

---

## References & Context
- Full approved plan + exact UX examples: `.ai_docs/plan.md`
- Saved conversation decisions & how to resume: `.ai_docs/conversation-context.md`
- Do **not** duplicate the plan in this file; this AGENTS.md is the concise, always-loaded rule set.
- The `.ai_docs/` folder is for long-form planning artifacts and may be gitignored or kept.

---

## Other
- MIT license on all code.
- Version control the rules: commit this `AGENTS.md`.
- When in doubt, re-read the signature feature description and the "Critical Implementation Rules" section above.

**End of AGENTS.md** — Grok must follow these rules in every turn while working in this directory tree.
