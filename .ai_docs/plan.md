# Plan: LocalStack Web UI (pre-license style) with first-class CLI command surfacing

**Project root**: `R:\projects\alocalstack`

**Goal**  
A lightweight, self-hosted React SPA that visually and behaviorally resembles the old open https://app.localstack.cloud/ Resource Browser (dark AWS-console style) for interacting with services inside a running LocalStack Docker container.

**Target services (iterative delivery)**: S3, DynamoDB, SQS, SNS, Lambda, Cognito.

**Signature feature (your explicit requirement)**: After **every** action the UI performs — reads and writes alike — the user can click to reveal the exact equivalent CLI command (`aws --endpoint-url=... --region=...`) that would do the same thing. Commands are hidden by default (click-to-reveal) to keep the interface clean. For large or binary payloads the generated command **always** uses a placeholder file with clear instructions; the UI never attempts to embed huge data.

**Confirmed non-goals for MVP**: Full container start/stop/restart beyond a light health panel + optional restart action, advanced IAM, Cloud Pods, multi-account, streaming logs, heavy state export/import.

## All user decisions locked in
- Pure client-side React SPA (Vite + dev proxy). No backend in the first version.
- UI tech: Tailwind + shadcn/ui (dark theme first, console aesthetic). Not Cloudscape.
- Start minimal and grow iteratively.
- Include light instance controls + health (poll `/_localstack/health`, show services, optional destructive restart behind strong warnings).
- Ship **both** a static npm build **and** a Docker image (nginx) + example `docker-compose.yml`.
- The static `dist/` build is explicitly suitable for zero-server hosting on GitHub Pages (and similar static hosts). Users point the in-app configurable endpoint at their LocalStack (commonly via a free HTTPS tunnel such as ngrok or cloudflared to satisfy browser mixed-content rules from https pages). See the GitHub Pages hosting notes added to README and the separate session plan.
- Endpoint and region are user-configurable in the UI (localStorage + optional query param). Generated CLI commands must use the live values (default `http://localhost:4566` + `us-east-1`).
- “awslocal” in your terminology = the explicit flag form: `aws --endpoint-url=... --region=...`.
- CLI commands must be available for **all actions** (list, get, scan, receive, etc. **and** create/update/delete/publish/invoke).
- Disclosure model: **click-to-reveal** per action result (collapsible panel). The panel is **not** auto-expanded on normal success. Global “export last N actions as script” is deferred (Phase 7+).
- Large/binary payloads: **always** placeholder file + instructions (e.g. `--body fileb://myfile.bin` + “Save the exact bytes you used in the UI to this file first”).
- S3 CLI commands must use the lower-level `s3api` (put-object, get-object, list-objects-v2, etc.) to stay close to what the UI actually calls.
- Printed commands are clean single lines only — no automatic `export AWS_*` blocks.
- MIT license. Dark theme to match the old cloud app.

## Architecture & tech stack
- **Frontend**: Vite 5 + React 18 + TypeScript (strict). React Router (or TanStack Router) + TanStack Query.
- **Styling**: Tailwind + shadcn/ui (tables, sheets, dialogs, toasts via sonner, etc.) + lucide-react.
- **In-browser AWS calls**: Modular `@aws-sdk/client-s3`, `client-dynamodb`, `client-sqs`, `client-sns`, `client-lambda`, `client-cognito-identity-provider`. A thin factory/hook reads the current endpoint + region from a settings store.
- **CLI command generation** (the core requirement): Pure client-side function in `src/lib/cli.ts` (or similar). It receives the same parameters the UI just used plus the live settings and returns a correctly quoted `aws ...` string. It must:
  - Prefix with the current `--endpoint-url` and `--region`.
  - For any large or binary payload use a placeholder file (`fileb://...` or `file://...`) + short instruction text shown in the UI panel.
  - For complex structured data (DynamoDB items, message attributes, Lambda payloads, etc.) prefer pretty JSON when small; fall back to file placeholders for big/complex cases.
  - Use `s3api` subcommands for S3.
- **Health / instance controls**: Hook + small UI section that calls `GET /_localstack/health` (and `POST` with `{"action":"restart"}` only behind explicit confirmation + warning).
- **Persistence**: localStorage for endpoint, region, and basic UI prefs. React Query for list data.
- **Dev proxy**: Vite dev server proxies to the configured LocalStack endpoint (avoids CORS during `npm run dev`).
- **Packaging**:
  - `npm run build` produces static `dist/`.
  - Multi-stage `Dockerfile` (node → nginx:alpine) + minimal `nginx.conf`.
  - `docker-compose.example.yml` with a `localstack` service + this UI service (e.g. UI on 8080, LocalStack on 4566). Document how to point the UI at the container.
  - Static hosting (GitHub Pages, Netlify, any dumb static host) is a supported consumption path for the `dist/` output. The Vite build must support a configurable `base` path and include SPA fallback (404.html copy technique) for client-side routing on sub-path deployments. See separate approved plan "Support hosting the alocalstack UI on GitHub Pages". The Docker/nginx path remains the integrated self-contained option.

### High-level layout (proposed)
```
.ai_docs/plan.md
README.md
package.json
vite.config.ts
Dockerfile
docker-compose.example.yml
nginx.conf
src/
  lib/
    aws.ts
    cli.ts                # ← the command generator
  hooks/
    useHealth.ts
    useSettings.ts
  components/
    ui/                   # shadcn primitives
    CliCommand.tsx        # reusable click-to-reveal panel
  pages/
    Overview.tsx
    S3/...
    DynamoDB/...
    ...
```

## UX for CLI command surfacing (exact behavior)
- After **any** action the UI just executed (successful or failed), the result area includes a small, consistent control:
  - Text: “Equivalent AWS CLI command”
  - Collapsed by default (chevron / “Show”).
  - Click expands a code block with the full command + a “Copy” button.
  - For placeholder-file cases, 1–2 plain instruction lines appear below the command.
- Normal successes keep the panel collapsed (clean UI).
- On known trouble cases (S3 upload above a size threshold you choose, binary attributes, large invoke payload, any surfaced error) the panel can be auto-expanded or visually emphasized.
- The generator always reflects the **current** endpoint and region from settings. Changing them updates future commands immediately.
- Per-action reveal is the MVP scope. A global command history drawer + “Export last N actions as shell script” is explicitly planned for Phase 7+.

### Illustrative command examples (what the generator should produce)

**S3 PutObject (large file)**:
```bash
aws --endpoint-url=http://localhost:4566 --region=us-east-1 s3api put-object \
  --bucket my-bucket \
  --key path/to/file.bin \
  --body fileb://file.bin \
  --content-type application/octet-stream
```
Panel text: “Save the exact file you selected in the UI as `file.bin` in your current directory before running.”

**DynamoDB PutItem**:
```bash
aws --endpoint-url=http://localhost:4566 --region=us-east-1 dynamodb put-item \
  --table-name MyTable \
  --item file://item.json
```
Instructions: “Write the following JSON to `item.json` first: …”

SQS SendMessage, SNS Publish, Lambda Invoke (small), Cognito admin-create-user, list operations (list-objects-v2, scan, receive-message, etc.) all get equivalent single-line commands using the live endpoint/region.

## Phased roadmap (ship early, expand)
**Phase 0 – Scaffold**  
Vite + React + TS + Tailwind + shadcn + dark theme + layout + router + settings store. Vite proxy. `lib/cli.ts` skeleton. Basic Overview page. License + README.

**Phase 1 – Health + controls + CLI reveal foundation**  
`/_localstack/health` polling + UI. Service status grid. Endpoint/region editor. Reusable `CliCommand` component. Wire the first real actions (health refresh, restart) so the reveal panel works end-to-end.

**Phase 2 – S3 (first rich service)**  
Buckets + objects (prefix nav). Upload (with size threshold), delete, basic download. Every action produces a correct `s3api` CLI command (create-bucket, list-objects-v2, put-object, delete-object, get-object). Large uploads auto-emphasize the placeholder form.

**Phase 3 – DynamoDB**  
Tables + scan + item CRUD (simple editor + raw JSON). CLI commands for list-tables, describe-table, scan, put-item, delete-item, etc. Binary/large items trigger placeholder guidance.

**Phase 4 – SQS**  
Queues + send + poll/receive/delete/purge. Full set of CLI equivalents (create-queue, send-message, receive-message, delete-message, purge-queue, list-queues).

**Phase 5 – Packaging**  
Production build (Vite with GH-Pages support: base path + 404.html SPA fallback for clean URLs on static hosts). Dockerfile + nginx. `docker-compose.example.yml`. GitHub Action workflow for automatic deploy to GitHub Pages. Documentation (including "host the UI on GitHub Pages with no server for the frontend" instructions + tunnel/CORS requirements). Smoke test that the built container reaches a LocalStack container; also verify a static build can be consumed from GitHub Pages + https tunnel to LocalStack.

**Phase 6 – SNS + Lambda + Cognito**  
SNS topics + publish (with attributes).  
Lambda list + invoke (payload editor, response + LogResult).  
Cognito user pools + list/create users.  
Every action gets the click-to-reveal CLI panel.

**Phase 7+ – Polish & deferred features**  
Global command history + “Export as script” (the piece you explicitly said “later”). Better editors, filters, accessibility, keyboard shortcuts, S3 prefix improvements, DynamoDB query support, etc.

## Command generation rules (implementation notes)
- Central pure function: `generateAwsCli(service, op, params, settings) => { command: string, instructions?: string }`.
- Always use the live `endpoint` and `region` from settings.
- Large/binary threshold: pick a reasonable client-side size and any binary content → always placeholder file.
- Prefer `s3api` for S3.
- For structured data: emit pretty JSON + `file://...` when complex or large; inline small JSON where it stays readable and shell-safe.
- Output must be copy-paste ready (correct quoting, no extra env var lines).

## Risks & mitigations
- Command accuracy: derive the CLI string from the same parameter object the UI just sent to the SDK.
- Shell escaping / very large data: never embed; always placeholder + instruction.
- Endpoint/region changes after an action: only new commands reflect the new values (old revealed commands stay as historical truth).
- LocalStack version variance: surface the version from health; note that some flags may differ.

## Non-functional
- Dark theme first.
- Accessible (labels, focus management, ARIA).
- Works against plain community LocalStack.
- Easy to drop into an existing docker-compose setup.
- MIT license.

---

**Status**: This plan was approved by the user. Significant implementation progress has been made (see `.ai_docs/conversation-context.md` "Current Status" section for detailed snapshot dated 2026-06-15). 

Core pieces working: left sidebar navigation, live settings context, S3 page (create bucket + folders + upload + list/delete + CLI reveal), DynamoDB page (create table + put item form + scan + CLI reveal), reusable CliCommand component, real AWS SDK calls, GitHub Pages static hosting support.

The project is in an easily resumable state. Future sessions should read `.ai_docs/conversation-context.md` (especially sections 4 and 5) + this file + the latest `src/` code.

**Related planning artifacts**: See also `C:\Users\tiago\.grok\sessions\R%3A%5Cprojects%5Calocalstack\019eccc1-e88a-71f2-a2a9-9b49cbf3fdc5\plan.md` (approved plan specifically for GitHub Pages / static hosting support).
