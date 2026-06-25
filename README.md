# alocalstack

A lightweight, self-hosted React SPA that looks and feels like the old open LocalStack Cloud Resource Browser (pre-license dark AWS-console aesthetic). It lets you visually browse and interact with services running inside a LocalStack container — with one killer feature.

## The Signature Feature

After **every** action you perform in the UI (reads or writes), you can click to reveal the exact equivalent AWS CLI command that would do the same thing:

```bash
aws --endpoint-url=http://kubernetes.docker.internal:4566 --region=us-east-1 ...
```

- Commands are hidden by default (clean interface) and expand on demand with a "Copy" button.
- For large files or binary payloads the command always uses a placeholder (`fileb://...` / `file://...`) plus clear on-screen instructions — the UI never tries to stuff huge data into the command string.
- S3 operations use the precise low-level `s3api` subcommands.
- Endpoint and region are fully configurable in the UI (persisted in localStorage); generated commands always reflect your current settings.
- "awslocal" in this project's terminology simply means the explicit `--endpoint-url` + `--region` form.

This makes the UI both a great visual tool **and** an instant learning/reference aid for the real AWS CLI against LocalStack.

## Target Services (iterative MVP)

- S3
- DynamoDB
- SQS
- SNS
- AWS Lambda
- Cognito

## Non-Goals (MVP)

Full container start/stop/restart (beyond a light health panel + guarded restart), advanced IAM, Cloud Pods, multi-account, heavy streaming/export features.

## Tech Stack & Deliverables

- **Frontend**: Vite + React 18 + TypeScript (strict) + Tailwind + shadcn/ui (dark console theme)
- **AWS SDK**: Modular v3 clients running entirely in the browser
- **Data / state**: TanStack Query + localStorage for settings
- **Two shipping formats**:
  1. Static production build (`npm run build`) — can be hosted anywhere that serves static files (including GitHub Pages — see dedicated section below).
  2. Docker image (nginx) + example `docker-compose.yml`

No backend server in the initial version — pure client-side SPA with a Vite dev proxy for convenience.

## Hosting on GitHub Pages (no server to maintain for the UI)

Yes — because the UI is a pure client-side React SPA, you can host the built assets on GitHub Pages for free and never run the nginx container yourself.

**How it works**:
- `npm run build` produces a `dist/` folder of static HTML/JS/CSS.
- GitHub Pages (or any static host) serves it.
- The browser still talks directly to **your** LocalStack using the endpoint you configure inside the app.

**Important prerequisites & caveats** (read before trying):
- GitHub Pages always serves over **HTTPS**.
- Default LocalStack runs on **HTTP** (we use `http://kubernetes.docker.internal:4566` so it works from Docker/K8s contexts; fall back to `localhost:4566` if that hostname doesn't resolve on your machine). Modern browsers block "mixed content" (https page fetching http resources). Solution: use a free HTTPS tunnel.
- LocalStack must allow the browser origin via CORS (`EXTRA_CORS_ALLOWED_ORIGINS`).

**Quick start (recommended path)**:

1. In your repo settings → Pages → Source = GitHub Actions (or enable the workflow below).
2. Push the code (or use the Action on main).
   - If your repo is named `<user>.github.io` (user/organization site) → site will be at `https://<you>.github.io/`
   - Otherwise (project site) → site will be at `https://<you>.github.io/<repo>/`
3. On your machine, start LocalStack with CORS enabled for GitHub + your future tunnel:
   ```bash
   docker run --rm -p 4566:4566 \
     -e EXTRA_CORS_ALLOWED_ORIGINS="https://*.github.io,https://<your-gh-user>.github.io" \
     localstack/localstack
   ```
4. In another terminal, start a tunnel:
   ```bash
   # ngrok (free tier fine)
   ngrok http 4566

   # or cloudflared (also free)
   cloudflared tunnel --url http://kubernetes.docker.internal:4566
   ```
5. Copy the **https** forwarding URL it gives you (e.g. `https://abc123.ngrok-free.app`).
6. Open your GitHub Pages site.
7. Open Settings (or the endpoint editor), paste the https tunnel URL as the Endpoint (region `us-east-1`).
8. The app should connect. Perform actions — every one will still give you the exact `aws --endpoint-url=...` CLI command (using the tunnel URL you configured).

The in-app settings panel will show helpful warnings and copyable commands when it detects a mixed-content risk.

**Alternative (self-contained)**: Use the Docker + docker-compose.example.yml path when you want everything (UI + LocalStack) on your own machine with no tunnels.

See `.ai_docs/plan.md` and the approved GitHub Pages plan for technical details and verification steps.

## Current Status

**Good progress has been made.** Core navigation, settings, and the first two services (S3 + DynamoDB) have substantial working implementations with the signature CLI reveal feature.

Key things implemented:
- Left sidebar menu + React Router for dedicated service pages.
- Live connection settings (shared context, affects every SDK call and generated command).
- **S3**: List buckets, **Create Bucket**, select bucket, list objects (prefix filter), **Create Folder**, upload objects (real SDK), delete, full "Equivalent AWS CLI command" reveal after every action (s3api, with placeholder support).
- **DynamoDB**: List tables, **Create Table** (partition key + optional sort key with proper schema), select table, scan items, **Put Item** data-entry form (proper DynamoDB JSON), full CLI reveal after actions.
- Reusable `CliCommand` component + enhanced pure CLI generator.
- Real modular AWS SDK v3 calls wired to live settings.
- Dark console-style UI, GitHub Pages readiness preserved (static build + workflow + mixed-content warnings).
- All per the locked decisions in the original plan (pure client-side, live endpoint in every command, placeholder rules, s3api only, etc.).

See `.ai_docs/conversation-context.md` (especially the "Current Status" and "How to Resume" sections) for a detailed snapshot of exactly what is working, file locations, and guidance for picking this up in a future session.

See `.ai_docs/plan.md` for the full approved phased roadmap (we are between Phase 0/2–3 for the services that have been started).

Run `npm run dev` to explore the current UI.

## Getting Started (once implemented)

```bash
# Development (local, uses Vite proxy)
npm install
npm run dev

# Production static build (for GitHub Pages or any static host)
npm run build
npm run preview

# All-in-one Docker option
docker build -t alocalstack .
# See docker-compose.example.yml (UI + LocalStack together)
```

## Testing

```bash
# Run tests once (recommended after making changes)
npm run test:run

# Watch mode
npm test
```

**Workflow**: Always run `npm run test:run` after implementing or modifying features. If tests fail, fix the code to preserve behavior or update the test only if the original test no longer reflects the intended (documented) behavior.

Current tests focus heavily on the CLI command generator (`generateAwsCli`), the project's signature feature.

For GitHub Pages hosting instructions, tunnel setup, and CORS, see the "Hosting on GitHub Pages" section above.

Point the UI (via the in-app settings) at your LocalStack instance. Default expectation is `http://kubernetes.docker.internal:4566` + `us-east-1` (great for Docker Desktop / K8s scenarios); fall back to `localhost:4566` if needed. When using GitHub Pages you will normally use an https tunnel URL instead.

## License

MIT

---

Built as a faithful recreation of the classic LocalStack resource browser experience, with first-class CLI command surfacing so you always know exactly what the equivalent shell command is.
