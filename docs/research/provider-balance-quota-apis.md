# Provider balance / quota APIs for a DSH usage-state plugin

Researched 2026-09-20. Sources linked inline; "unverified" marks what I could not confirm from an
official doc or live/verbatim-backed source. Read-only inspection of this machine's config is at the end.

## TL;DR matrix

| Provider | Endpoint | Returns | Auth | 5h / 7d rolling %? | `resets_at`? |
|---|---|---|---|---|---|
| DeepSeek official | `GET https://api.deepseek.com/user/balance` | remaining balance (multi-currency) | API key (Bearer) | no | no |
| DeepSeek Platform (private) | `platform.deepseek.com/api/v0/usage/...` | token/cost usage by day | browser `userToken` | no | no |
| Anthropic Claude (Pro/Max) | `GET https://api.anthropic.com/api/oauth/usage` | used % | OAuth access token (`user:profile`) | **yes** | **yes** (RFC3339) |
| Claude web (cookies) | `GET https://claude.ai/api/organizations/{org}/usage` | used % | `sessionKey` cookie | yes | yes |
| Z.ai / Zhipu GLM Coding Plan | `GET https://api.z.ai/api/monitor/usage/quota/limit` (CN: `open.bigmodel.cn`) | used % per window | API key (Bearer) | **yes** | **yes** (epoch ms) |
| OpenRouter credits | `GET https://openrouter.ai/api/v1/credits` | USD balance | **management** key | no | no |
| OpenRouter key | `GET https://openrouter.ai/api/v1/key` | key cap + daily/weekly/monthly spend | normal API key | no | `limit_reset` string only |
| OpenAI Admin API | `GET /v1/organization/costs`, `/v1/organization/usage/completions` | USD spend | **admin** key | no | no |
| OpenAI normal API key | — none public — | — | — | no | no |
| Codex (ChatGPT sub) | `GET https://chatgpt.com/backend-api/wham/usage` | used % + credits | ChatGPT OAuth | **yes** | yes (unix s) |
| Gemini Code Assist | `POST cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota` | remaining fraction per model | OAuth (Gemini CLI) | no explicit window label | yes |
| Antigravity | local LS JSON-RPC `RetrieveUserQuotaSummary` | remaining fraction | local server + CSRF | **yes** (5h + weekly) | yes |
| MiniMax Token Plan | `GET https://www.minimaxi.com/v1/token_plan/remains` | remaining % | API key | **yes** | yes |
| Kimi Code | `GET https://api.kimi.com/coding/v1/usages` | used % | `sk-kimi-*` + UA `KimiCLI/1.6` | **yes** | yes |
| CommandCode | `GET https://api.commandcode.ai/alpha/billing/credits` | used % + credits | API key | **yes** | yes (epoch ms) |
| SiliconFlow | `GET https://api.siliconflow.cn/v1/user/info` | CNY balance | API key | no | no |
| Volcengine Ark Coding Plan | `open.volcengineapi.com` control-plane (AK/SK HMAC) | used % 5h/week/month | AK/SK IAM | **yes** | unverified |
| SCNet Token Plan | none (console only) | — | — | no | no |

---

## 1. DeepSeek official API

**Balance (official, documented).**
- `GET https://api.deepseek.com/user/balance`
- Headers: `Authorization: Bearer $DEEPSEEK_API_KEY`, `Accept: application/json`
- Response:
  ```json
  {
    "is_available": true,
    "balance_infos": [
      { "currency": "CNY", "total_balance": "66.28",
        "granted_balance": "0.00", "topped_up_balance": "66.28" }
    ]
  }
  ```
- Units: currency units as **decimal strings** (`CNY` or `USD` rows, possibly both). `total_balance`
  = granted + topped-up. No percentage, no window, no reset timestamp.
- Docs: <https://api-docs.deepseek.com/api/get-user-balance/>

**Usage / quota endpoint on the public API: none.** The published API reference contains only Chat
Completions, Responses, FIM, List Models, Get User Balance and Files. There is no usage or quota
endpoint on `api.deepseek.com`.

**Coding-plan / subscription quota API: none that I could find.** DeepSeek's own product is
pay-as-you-go (the third-party plan catalog lists DeepSeek's only offer as 按量 API:
<https://github.com/wmpeng/codingplan>), and the official docs show no subscription/quota endpoints.
Treat "DeepSeek has no coding plan and no window quota API" as **unverified-but-consistent** (absence
of evidence, not a vendor statement). If a 5h/7d bar is shown for `deepseek-official`, it must come
from local accounting, not the API.

**Rate limits:** no documented request-rate limit. Instead, account-level concurrency caps —
`deepseek-flash` 2500, `deepseek-v4-pro` 500; exceeding them returns HTTP 429. The balance endpoint
has no documented limit. Docs: <https://api-docs.deepseek.com/quick_start/rate_limit>

**Undocumented Platform endpoints (browser session, not API key).** Two independently built DSH
plugins use these; an API key cannot authenticate them:
- `GET https://platform.deepseek.com/api/v0/users/get_user_summary` — Platform balance.
- `GET https://platform.deepseek.com/api/v0/usage/by_api_key/amount?start=<unix>&end=<unix>&tz=<off>`
  and `.../by_api_key/cost?...` (preferred), fallback `.../usage/amount?month=&year=` / `.../usage/cost`.
- `GET https://platform.deepseek.com/api/v0/usage/export` (today window).
- Headers: `Authorization: Bearer <platform userToken>`, `Accept: application/json`,
  `x-client-platform: web`.
- Sources: [CodexBar docs/deepseek.md](https://github.com/steipete/CodexBar/blob/main/docs/deepseek.md),
  [dsh-deepseek-usage](https://github.com/AzureHalcyon/dsh-deepseek-usage) (uses
  `platform.deepseek.com/api/v0/usage/amount|cost|export`).
- These are private dashboard endpoints and change without notice; they expose **cost/token usage**,
  never a 5h/7d percentage.

**DSH wiring (verified in the installed package):** provider id `deepseek-official`, default base URL
`https://api.deepseek.com`, credential ref env `DEEPSEEK_API_KEY`
(`@deepseek-ai/dsh-llm-deepseek`).

## 2. Anthropic Claude (Claude Code / Pro-Max)

**Endpoint.** `GET https://api.anthropic.com/api/oauth/usage`
- Headers:
  - `Authorization: Bearer <accessToken>` — from `claudeAiOauth.accessToken` in
    `~/.claude/.credentials.json`, or on macOS the Keychain item `Claude Code-credentials`.
  - `anthropic-beta: oauth-2025-04-20`
  - `anthropic-version: 2023-06-01` (observed in the frozen-schema write-up)
- Response (values illustrative):
  ```json
  {
    "five_hour": { "utilization": 83.0, "resets_at": "2026-06-02T08:30:00.701157+00:00" },
    "seven_day": { "utilization": 14.0, "resets_at": "2026-06-04T11:00:00.701180+00:00" },
    "seven_day_opus": null, "seven_day_sonnet": null, "seven_day_cowork": null,
    "extra_usage": { "is_enabled": false, "monthly_limit": null, "used_credits": null,
                     "utilization": null, "currency": null, "disabled_reason": null }
  }
  ```
- Units: `utilization` is **percent used 0–100** (float); `resets_at` RFC3339 with numeric offset.
  Top-level keys are optional and new ones appear over time — parse defensively. `extra_usage` is
  monthly pay-as-you-go credits, not a rolling window.
- 5h/7d: **yes** (`five_hour`, `seven_day`). Per-model weekly buckets also exist
  (`seven_day_sonnet`/`seven_day_opus`, and a `limits[].weekly_scoped` array per CodexBar).
- Source (verified against a live token): [usage-endpoint.md, frozen schema](https://raw.githubusercontent.com/orbenozio/claude-code-usage-indicator/9f1f5fb57f67eb40afeb2fe9f8838f9dedd3c93a/docs/usage-endpoint.md).
  Corroborated by [CodexBar docs/claude.md](https://github.com/steipete/CodexBar/blob/main/docs/claude.md).
- Anthropic has no official public documentation for this endpoint (**unverified as official API**);
  it is what Claude Code's `/usage` uses.

**Auth: OAuth only.** Requires a Claude Code sign-in token with the `user:profile` scope; a plain
Anthropic API key, and `claude setup-token` tokens (inference-only), cannot call it. See
[Claude Code authentication](https://code.claude.com/docs/en/authentication).

**Cookie alternative.** `GET https://claude.ai/api/organizations` → org UUID, then
`GET https://claude.ai/api/organizations/{orgId}/usage` with `Cookie: sessionKey=<sk-ant-...>`.
Also `.../overage_spend_limit` and `.../prepaid/credits` for extra-usage spend and credit balance.
Cloudflare may challenge cookie access; OAuth is unaffected.

**Rate limits:** the usage endpoint has its own cooldown. HTTP 429 with `Retry-After` (observed
~160 s); adapters should poll no faster than ~60 s and prefer ~5 min, backing off on 429. Multiple
host instances multiply the call rate. Not vendor-documented (**unverified**).

**Admin API (spend, not windows).** `sk-ant-admin...` key → `/v1/organizations/cost_report` and
`/v1/organizations/usage_report/messages`.

## 3. Z.ai / Zhipu GLM Coding Plan

**Primary quota endpoint.**
- `GET https://api.z.ai/api/monitor/usage/quota/limit` (global)
- `GET https://open.bigmodel.cn/api/monitor/usage/quota/limit` (China-mainland BigModel)
- Headers: `authorization: Bearer <coding-plan API key>`, `accept: application/json`.
  Team scope additionally sends `Bigmodel-Organization: <org id>` and `Bigmodel-Project: <project id>`
  and appends `?type=2` (`type=3` for hourly model usage).
- Response shape:
  ```json
  { "success": true,
    "data": { "level": "pro",
      "limits": [
        { "type": "TOKENS_LIMIT", "unit": 3, "number": 5, "percentage": 40.5,
          "usage": 1000, "currentValue": 405, "remaining": 595,
          "nextResetTime": 1789000000000 },
        { "type": "TOKENS_LIMIT", "unit": 6, "number": 1, "percentage": 52,
          "nextResetTime": 1789600000000 },
        { "type": "TIME_LIMIT", "unit": 5, "number": 1, "percentage": 0,
          "usage": 4000, "currentValue": 0, "remaining": 4000,
          "nextResetTime": 1788073095998,
          "usageDetails": [{ "modelCode": "search-prime", "usage": 0 }] } ] } }
  ```
- Units / mapping: `percentage` = **consumed 0–100**. `unit` 3 = hours, `number` 5 → **5-hour rolling
  window**; `unit` 6 = weeks, `number` 1 → **weekly window**. `TOKENS_LIMIT` (Pro/Max) and
  `CREDIT_LIMIT` (Lite) are the same shape — accept both. `TIME_LIMIT` is the monthly MCP tool budget
  (different unit, do not map to a coding window). If `percentage` is absent, derive from
  `currentValue / usage`; `nextResetTime` is **epoch milliseconds** (some rows omit it, e.g. a 0%-used
  rolling window). Newer protocol responses may contain only `CREDIT_LIMIT` rows.
- 5h/7d: **yes**. `resets_at`: **yes** (epoch ms).
- Official docs (plan/window semantics, not the endpoint): <https://docs.bigmodel.cn/cn/coding-plan/overview>
  — tiers have a 5-hour and a weekly credit cap (Lite 2,000 / 10,000; Pro 12,000 / 60,000;
  Max 28,000 / 140,000); the 5-hour pool refreshes dynamically 5 h after consumption and the weekly
  pool runs 7 days from order date. The `/api/monitor/usage/quota/limit` path itself is **not in the
  public docs** (community/CLI-reverse-engineered; verified alive returning 401 without a key).

**Legacy billing endpoint.**
`GET https://api.z.ai/api/coding/paas/v3|v4/dashboard/billing/coding_plan/usage` (and the
`open.bigmodel.cn` twins) → `{ "plans": [ { "status", "total_units", "used_units",
"available_units", "period_end", "capabilities" } ] }`. `period_end` is epoch **seconds**; infer
5 h vs weekly from the reset span (>1 day ⇒ weekly). Sources:
[opencodex PR #2028](https://github.com/lidge-jun/opencodex/pull/2028),
[CodexBar docs/zai.md](https://github.com/steipete/CodexBar/blob/main/docs/zai.md).

**Auth:** API key only, no OAuth. Region and key are not interchangeable between `api.z.ai` and
`open.bigmodel.cn`.

**Rate limits on the quota endpoint:** undocumented / unknown (**unverified**).

## 4. OpenRouter

**Credits.** `GET https://openrouter.ai/api/v1/credits`
- Header: `Authorization: Bearer <key>`
- Response: `{ "data": { "total_credits": 100.5, "total_usage": 25.75 } }` — USD doubles.
  Balance = `total_credits − total_usage`. No percentage and no reset timestamp.
- **Current official docs say a Management key is required** (403 `Only management keys can perform
  this operation` otherwise). CodexBar's docs claim the selected normal API key can also read
  credits; that contradicts the current OpenAPI page — treat "normal key works" as **unverified /
  possibly key-dependent**. Docs: <https://openrouter.ai/docs/api/api-reference/credits/get-remaining-credits>

**Current key.** `GET https://openrouter.ai/api/v1/key` (documented to work with a normal API key)
- Response `data`: `label`, `limit` (cap or null), `limit_reset` (string or null), `limit_remaining`,
  `include_byok_in_limit`, `usage`, `usage_daily`, `usage_weekly`, `usage_monthly`, `byok_usage*`,
  `is_free_tier`, `free_model_daily_requests { used, limit, remaining }`. The deprecated
  `rate_limit` object should be ignored.
- This is the best source for a "used %" bar when the key has a positive `limit`:
  `limit_remaining / limit` (or `usage / limit`). It exposes no 5h/7d windows — only a cap plus
  daily/weekly/monthly spend — and `limit_reset` is a *kind* string, not a timestamp.
- Docs: <https://openrouter.ai/docs/api_reference/limits>

**Rate-limit headers.** Successful inference responses carry **no** `X-RateLimit-*` headers. Only
OpenRouter-generated 429 error responses carry `X-RateLimit-Limit`, `X-RateLimit-Remaining`,
`X-RateLimit-Reset`; some 429/402 responses also carry `Retry-After`. So headers cannot be used to
poll usage. Docs: <https://openrouter.ai/docs/api_reference/limits>

**5h/7d rolling window:** not exposed (no such concept).

## 5. Google Gemini / Antigravity and other coding-plan-with-quota services

### Gemini CLI / Code Assist (OAuth, private API)
- `POST https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota` —
  `Authorization: Bearer <access_token from ~/.gemini/oauth_creds.json>`, body
  `{ "project": "<projectId>" }` (or `{}`).
- Response buckets carry `remainingFraction` (0–1), `resetTime` (RFC3339), `modelId`;
  percent left = `remainingFraction × 100`. Buckets are **per model**, with no explicit 5h/7d label —
  window semantics are undocumented (**unverified**).
- Tier: `POST .../v1internal:loadCodeAssist`. Token refresh: `POST https://oauth2.googleapis.com/token`
  with client id/secret extracted from the installed Gemini CLI.
- **Important:** Google [stopped serving consumer Gemini CLI OAuth](https://developers.google.com/gemini-code-assist/docs/deprecations/code-assist-individuals)
  (individual/AI Pro/Ultra) on 2026-06-18 — `retrieveUserQuota` then 403s with
  `SUBSCRIPTION_REQUIRED`. Consumer replacement is Antigravity; Standard/Enterprise still work.
- Sources: [CodexBar docs/gemini.md](https://github.com/steipete/CodexBar/blob/main/docs/gemini.md).

### Antigravity (5h + weekly, local only)
- Quota is served by the locally running Antigravity/`agy` language server on a **dynamic loopback
  port** (`--https_server_port 0`), so the port cannot be hardcoded.
- `POST http://127.0.0.1:<port>/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary`
  with body `{}`, plus `x-codeium-csrf-token` harvested from the token embedded in the server's `/`
  page when present (`agy` needs none). `GetUserStatus` gives the plan name.
- Response `groups[].buckets[]`: `bucketId` (`gemini-5h`, `gemini-weekly`, `3p-5h`, `3p-weekly`),
  `remainingFraction` (0–1, **remaining**, not used), `resetTime` (RFC3339). So 5h/7d percentages for
  both the Gemini pool and the Claude/GPT pool, with reset timestamps.
- Sources: [ai-usagebar antigravity fetch.rs](https://docs.rs/ai-usagebar/1.5.2/src/ai_usagebar/antigravity/fetch.rs.html);
  installed `dsh-cost-meter` also uses
  `daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary` with
  `User-Agent: antigravity/cli/1.0.13 ...`.

### Codex / ChatGPT subscription (5h + 7d)
- `GET https://chatgpt.com/backend-api/wham/usage` —
  `Authorization: Bearer <ChatGPT OAuth access token>`, `Accept: application/json`,
  optional `ChatGPT-Account-Id: <account_id>` (from `tokens.account_id` in `~/.codex/auth.json`).
- Response: `rate_limit.primary_window { used_percent, reset_at, limit_window_seconds: 18000 }` (5 h),
  `rate_limit.secondary_window { ..., 604800 }` (7 d), optional `credits { has_credits, unlimited,
  balance }`, `rate_limit_reset_credits { available_count }`, `plan_type`.
- `used_percent` is an integer 0–100; `reset_at` unix **seconds**. Undocumented/reverse-engineered:
  <https://github.com/PowerUserZ/OpenTokenUsage/blob/main/docs/providers/codex.md>.

### Other plans already implemented by the installed `dsh-cost-meter` plugin
(verbatim from `~/.dsh/profiles/web/node_modules/dsh-cost-meter/lib/coding-plans.js`, all verified
alive by that plugin's maintainers as of 2026-08):
- **Kimi Code:** `GET https://api.kimi.com/coding/v1/usages` (fallback `/v1/usage`),
  `authorization: Bearer sk-kimi-*`, **`user-agent: KimiCLI/1.6`** (the endpoint rejects other UAs).
  Response `usage { used, limit, remaining, resetTime }` (weekly) plus
  `limits[] { window { duration, timeUnit }, detail { used, limit, remaining, resetTime } }` → 5 h
  window. PAYG fallback balance: `GET https://api.moonshot.cn/v1/users/me/balance` (RMB **cents**).
- **MiniMax Token Plan:** `GET https://www.minimaxi.com/v1/token_plan/remains` (also `.cn`/`.io`),
  Bearer. `model_remains[] { current_interval_remaining_percent, current_weekly_remaining_percent,
  end_time, weekly_end_time }` — endpoint reports **remaining**, convert to used. Legacy:
  `/v1/api/openplatform/coding_plan/remains`.
- **CommandCode:** `GET https://api.commandcode.ai/alpha/billing/credits`, Bearer `user_*`.
  `credits { monthlyCredits }` + `windowLimits { fiveHour { used, cap, resetAt }, weekly { ... } }`,
  `resetAt` epoch ms.
- **SiliconFlow:** `GET https://api.siliconflow.cn/v1/user/info` → CNY balance (text, not %).
- **xAI Grok:** `GET https://api.x.ai/v1/me` (API key) and CLI billing
  `https://cli-chat-proxy.grok.com/v1/billing[?format=credits]` with `x-xai-token-auth: xai-grok-cli`.
- **OpenCode Zen Go:** `GET https://opencode.ai/zen/go/v1/usage` with a browser User-Agent
  (Cloudflare returns error 1010 otherwise).
- **Volcengine Ark Coding Plan:** control-plane only — `open.volcengineapi.com` with
  `Action=GetUsageDetails|GetAFPUsage|GetPersonalPlan`, `Version=2024-01-01`, `service=ark`,
  `region=cn-beijing`, **AK/SK + HMAC-SHA256 signing** (not a Bearer key); needs IAM permissions
  `ArkReadOnlyAccess` + `BillingCenterReadOnlyAccess`. 5 h / weekly / monthly windows.
  Docs: <https://www.volcengine.com/docs/82379/1298459>
- **SCNet Token Plan:** no API-key query endpoint; console-only → that plugin estimates locally.
- **Qwen / Bailian Coding Plan, OpenAI Codex personal, Gemini Code Assist personal, GitHub Copilot
  individual:** per that plugin's notes, no API-key-accessible public usage endpoint (console- or
  org-level APIs only).

## 6. OpenAI

- **Normal API key: no public credits/balance or quota endpoint.** `/v1/dashboard/billing/credit_grants`
  is a legacy endpoint that is *not* part of the current public API reference; it reportedly works
  only for some older user keys and 404s/403s for most modern keys (**unverified for current
  behavior**). No `resets_at`, no window data.
- **Organization Admin API key** (`sk-admin...`, `OPENAI_ADMIN_KEY`):
  - `GET https://api.openai.com/v1/organization/costs` (`bucket_width=1d`, `group_by=line_item`)
  - `GET https://api.openai.com/v1/organization/usage/completions` (`group_by=model`)
  - Optional `project_ids=<proj_...>`; USD spend and token/request usage. This is **spend, not a
    quota percentage**, and no `resets_at`. Project service-account keys cannot read it.
  - Source: [CodexBar docs/openai.md](https://github.com/steipete/CodexBar/blob/main/docs/openai.md).
- **ChatGPT/Codex subscription windows** are only available through the undocumented
  `chatgpt.com/backend-api/wham/usage` endpoint (section 5) using ChatGPT OAuth, not an API key.

---

## Balance vs used-%, OAuth vs API key, resets_at

- **Remaining balance only:** DeepSeek `/user/balance` (multi-currency), OpenRouter `/credits` (USD),
  SiliconFlow `/user/info` (CNY), Kimi PAYG `/users/me/balance` (CNY cents), OpenAI admin
  `/organization/costs` (spend, not balance).
- **Used-percentage:** Anthropic `/api/oauth/usage`, Z.ai `/api/monitor/usage/quota/limit`,
  Codex `wham/usage`, MiniMax (remaining → invert), Kimi Code, CommandCode, Antigravity
  (remainingFraction → invert), Volcengine Ark.
- **Both:** OpenRouter `/api/v1/key` (cap remaining + spend), Codex `wham/usage` (`credits.balance`).
- **Requires OAuth rather than an API key:** Anthropic `/api/oauth/usage` (also cookie path),
  Gemini Code Assist, Antigravity (local server session), Codex ChatGPT windows.
  Everything else above takes an API key; Volcengine Ark takes AK/SK HMAC; DeepSeek Platform usage
  takes a browser `userToken`.
- **`resets_at` exposed:** Anthropic (RFC3339), Z.ai (epoch ms), Codex (unix s), MiniMax, Kimi,
  CommandCode, Antigravity/Gemini (RFC3339), Volcengine (unverified). Not exposed by DeepSeek,
  OpenRouter (`limit_reset` is a period name, not a timestamp), or OpenAI cost endpoints.
- **Rate limits on the usage endpoints:** only Anthropic's is characterized (self-imposed cooldown,
  429 + `Retry-After` ≈160 s observed). Z.ai monitor, OpenRouter `/credits` and `/key`, DeepSeek
  balance: no documented limit; OpenRouter returns `X-RateLimit-*` only on 429 errors.

---

## This machine's configuration (read-only, secrets not printed)

`/Volumes/M2ExHome/rockman/.dsh/settings.yaml`
- `agent-default-model`: provider **`deepseek-official`**, model `deepseek-flash`, reasoningEffort `high`.
- `subagent-model-selection.allowedModels`: `deepseek-official / deepseek-flash`.
- `llm-pi-ai.providers`: currently `{}`. Note: an earlier read in this same session showed an
  `orcarouter` provider there (OrcaRouter, `apiKeyEnv: ORCAROUTER_API_KEY`,
  `baseURL: https://api.orcarouter.ai/v1`, model `orcarouter/auto`); it was gone on re-read and
  `settings.yaml` mtime moved to 21:12, so DSH/the GUI is rewriting this file live. Treat OrcaRouter
  as "recently present, currently absent".
- No other LLM provider blocks are configured (no anthropic, openai, openrouter, zai, gemini, etc.).

`/Volumes/M2ExHome/rockman/.dsh/.credentials.yaml`
- One credential ref only: **`DEEPSEEK_API_KEY`**. No other provider keys/tokens.
- (Handling note: while listing ref *names*, my shell command inadvertently echoed that key's value
  once in tool output. It is not reproduced here and only the name is reported; rotate it if that
  transcript is considered exposed.)

Other evidence of what is actually in use
- Installed web-profile plugins: `dsh-better-sidebar`, `dsh-cost-meter`, `dsh-session-recycle-bin`,
  `dsh-ui-font`, `dshmarket`. No usage/balance plugin of your own is installed yet.
- `dsh-cost-meter` ledger (`~/.dsh/storages/cost-meter/ledger.json`): the only provider/model with
  recorded usage is **`deepseek-official` / `deepseek-flash` (and `deepseek-v4-flash`)**.
  `balanceRef` holds a DeepSeek official balance of **CNY 66.28** fetched 2026-09-20 (CNY, granted 0),
  i.e. the DeepSeek `/user/balance` path is already working here.
- That plugin's coding-plan slots exist but are **all disabled**: `anthropic`, `zai`, `minimax`,
  `kimi`, `openrouter`, `siliconflow`, `commandcode`, `scnet`, `qwen`, `volcengine` — every
  `enabled: false`, empty keys. `codexQuotaEnabled: false`, `goQuota.enabled: false`,
  `gatewayQuotas.sources: []`.
- Local credentials for other ecosystems: `~/.codex/auth.json` exists but contains only an
  `OPENAI_API_KEY` field (no ChatGPT OAuth tokens) → the Codex `wham/usage` window endpoint is **not**
  usable here without a Codex login. `~/.gemini/oauth_creds.json` exists with
  `access_token`/`refresh_token`/`id_token`/`expiry_date` → the Gemini/Antigravity OAuth path is
  plausible. No `~/.claude/.credentials.json` and no macOS Keychain item `Claude Code-credentials`
  → Claude Pro/Max usage is **not** available on this machine.

**Bottom line:** only **DeepSeek official** matters for this user right now, and it can only show a
remaining balance — no 5h/7d window exists for it. Every quota-window provider is currently
unconfigured. If the plugin wants windows, Z.ai (`/api/monitor/usage/quota/limit`) and Anthropic
(`/api/oauth/usage`) are the two cleanest documented-ish shapes to implement first.

## Not verified / caveats
- Anthropic, Z.ai monitor, MiniMax, Kimi Code, CommandCode, Antigravity, Codex, Gemini Code Assist,
  DeepSeek Platform endpoints are all **private or reverse-engineered**; none is a stable public
  contract, and none may be cited as official documentation.
- OpenRouter `/credits` management-key requirement vs CodexBar's "normal key works" claim.
- Whether `X-RateLimit-*` values ever appear on non-error OpenRouter responses.
- Whether Z.ai documents `/api/monitor/usage/quota/limit` anywhere official (I found only the
  coding-plan overview page describing the windows).
- Exact current behavior of OpenAI's legacy `credit_grants` endpoint.
- Volcengine Ark response field names (the plugin signs and parses them, but I did not see a live body).
- DeepSeek's absence of any coding-plan/subscription quota API is an absence-of-evidence finding.
