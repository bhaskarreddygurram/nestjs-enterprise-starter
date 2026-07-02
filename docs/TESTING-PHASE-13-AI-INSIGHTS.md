# Testing Guide — Phase 13: AI Security Insights

> How to test the AI security-insights endpoint added in this phase — **`GET /api/v1/ai/security-insights`**, a Claude-powered risk assessment over the recent audit log — both while AI is **disabled** (the default, safe state) and **enabled** with a real API key.
>
> Prior guides: [`TESTING-PHASE-12-CICD.md`](TESTING-PHASE-12-CICD.md) · Run guide: [`RUNNING-THE-PROJECT.md`](RUNNING-THE-PROJECT.md)

---

## 0. Prerequisites

```powershell
npm run docker:up        # PostgreSQL + Redis
npm run prisma:deploy
npm run db:seed          # grants the admin the new ai:read permission
npm run start:dev
```

| Base URL | `http://localhost:8000` |
|---|---|

Seeded admin: `admin@example.com` / `Admin123!ChangeMe` (has `ai:read`).

---

## 1. Mental model

```
GET /ai/security-insights?hours=24&limit=100
        │
   AuthorizationGuard  ── requires ai:read (403 otherwise)
        │
   SecurityInsightsService
        │  reads a bounded, recent slice of the audit trail (createdAt >= now-hours)
        ▼
   AI_PROVIDER  ──►  AnthropicAiProvider (Claude, structured JSON output)   when AI_ENABLED + key
                └►  NoopAiProvider  (throws 503)                            otherwise
        │
   response: { analyzed, riskLevel, summary, findings[], usage, model, ... }
```

- **Off by default.** With no `AI_ENABLED` / `ANTHROPIC_API_KEY`, the provider is the noop and the endpoint returns **503** — nothing calls out to Anthropic.
- **Structured output.** When enabled, the model must return JSON matching a fixed schema, so the response always parses (no regex scraping).
- **Observable.** Every provider call records `ai_requests_total`, `ai_tokens_total`, and `ai_request_duration_seconds` into the same Prometheus registry as HTTP metrics — visible at `GET /metrics`.
- **No spend on empty windows.** If the window contains no audit events, the service returns `analyzed: false` without calling the model.

---

## 2. Get an admin token

```powershell
$login = irm http://localhost:8000/api/v1/auth/login -Method Post -ContentType application/json `
  -Body '{ "email": "admin@example.com", "password": "Admin123!ChangeMe" }'
$token = $login.data.accessToken
$H = @{ Authorization = "Bearer $token" }
```

Generate some audit activity first (logins, user creation, etc.) so there's something to analyse.

---

## 3. Disabled path (default) — expect 503

With `AI_ENABLED=false` (the default):

```powershell
# 401 — no token
irm http://localhost:8000/api/v1/ai/security-insights

# 403 — token without ai:read (register a plain user and use that token)

# 400 — bad query (hours out of the 1..168 range)
irm "http://localhost:8000/api/v1/ai/security-insights?hours=9999" -Headers $H

# 503 — admin, but AI is disabled
irm http://localhost:8000/api/v1/ai/security-insights -Headers $H
# → 503 { message: "AI features are disabled. Set AI_ENABLED=true and ANTHROPIC_API_KEY ..." }
```

> Boot-time guard: setting `AI_ENABLED=true` **without** `ANTHROPIC_API_KEY` fails validation at startup (fail-fast), so you can never half-enable it.

---

## 4. Enabled path — real Claude call

Set these in `.env` and restart (`npm run start:dev`):

```env
AI_ENABLED=true
ANTHROPIC_API_KEY=sk-ant-...      # your key — this call is billed
AI_MODEL=claude-opus-4-8
```

```powershell
irm "http://localhost:8000/api/v1/ai/security-insights?hours=24&limit=100" -Headers $H | ConvertTo-Json -Depth 6
```

Example response:

```jsonc
{
  "analyzed": true,
  "generatedAt": "2026-07-02T10:15:00.000Z",
  "windowHours": 24,
  "eventCount": 37,
  "model": "claude-opus-4-8",
  "riskLevel": "medium",
  "summary": "Activity is mostly routine authentication traffic. One account shows a burst of failed logins worth reviewing.",
  "findings": [
    {
      "title": "Repeated failed logins for one account",
      "severity": "high",
      "description": "5 failed logins for admin@example.com from 3 IPs within 2 minutes, followed by a lockout.",
      "recommendation": "Confirm with the account owner and consider forcing a password reset.",
      "relatedActions": ["auth.login.failed", "auth.account.locked"]
    }
  ],
  "usage": { "inputTokens": 1240, "outputTokens": 320 }
}
```

Empty window (no events in range) returns `analyzed: false`, `findings: []`, `usage: null` — and makes **no** model call.

---

## 5. Verify the AI metrics

After at least one enabled call:

```powershell
(irm http://localhost:8000/metrics) -split "`n" | Select-String "^ai_"
```

You should see `ai_requests_total`, `ai_tokens_total` (labelled `type="input"` / `"output"`), and `ai_request_duration_seconds_*`, all labelled by `provider` and `model`.

---

## 6. Automated suite

```powershell
npm test                 # unit — includes AI provider + service specs
npm run test:e2e         # e2e — includes ai.e2e-spec.ts (401/403/400/503 gating)
```

The e2e suite runs with AI **disabled** (no key in CI), so it asserts the auth/permission gating and the graceful 503 path — no live model call, no cost. The provider's structured-output parsing is covered by unit tests with the Anthropic SDK mocked.

| What | Where |
|---|---|
| Provider parse + failure + noop | `src/modules/ai/*.spec.ts` |
| Service (enabled / disabled / empty window) | `src/modules/ai/security-insights.service.spec.ts` |
| Endpoint gating (401/403/400/503) | `test/ai.e2e-spec.ts` |
