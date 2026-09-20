# Sub2API — what it is and how a plugin can query balance / quota

Researched 2026-09-20. Method: read-only. Web search + `web_fetch`, plus a shallow clone of the
canonical repo into `/tmp/sub2api-src` for verbatim source inspection, plus read-only inspection of
this machine's `~/.dsh` config. Every endpoint claim below is cited to a file in the pinned commit
(as a permanent GitHub permalink) or to a public page. Anything I could not confirm is marked
**unverified**.

Pinned revision used for all source citations:
`Wei-Shaw/sub2api@7c700729c23187d31ed320f6b19c790e2f194826` (2026-09-20), latest release **v0.2.7**
published 2026-09-19.

---

## 1. What "sub2api" is

**Sub2API is a self-hosted, open-source AI API gateway that redistributes subscription quota as
API keys.** Upstream subscription accounts (Claude, OpenAI/Codex, Gemini, Antigravity, Grok) are
attached to the platform; the platform mints its own `sk-…` API keys and forwards requests, doing
auth, billing, load balancing and rate limiting in between.

> "Sub2API is an AI API gateway platform designed to distribute and manage API quotas from AI
> product subscriptions. Users can access upstream AI services through platform-generated API Keys,
> while the platform handles authentication, billing, load balancing, and request forwarding."
> — [README](https://github.com/Wei-Shaw/sub2api/blob/7c700729c23187d31ed320f6b19c790e2f194826/README.md)

Stack: Go 1.25 + Gin + Ent backend, Vue 3 frontend, PostgreSQL 15+, Redis 7+. License: the GitHub
API reports **LGPL-3.0** and the `LICENSE` file is the LGPLv3 text, although the README's footer
still says "MIT License" — the README line looks stale; treat LGPL-3.0 as the operative license.
It is not a SaaS you sign up for; you deploy it (script, Docker Compose, or from source).

### Disambiguation

| Name | What it actually is | Status |
|---|---|---|
| **`Wei-Shaw/sub2api`** | **Canonical upstream.** ~42.1k stars, ~9.0k forks, default branch `main`, latest release v0.2.7. | The project to target |
| `NanmiCoder/sub2api`, `ncwn/sub2api`, `UnlastingR/sub2api`, `CriticalPulsar/sub2api`, `SAPToddZhang/sub2api`, `icebreaker-forked/sub2api` | Unmodified/inactive **forks** with the same README and the same code. Not separate projects. | Ignore |
| **`Wei-Shaw/claude-relay-service` (CRS)** | The **predecessor/sibling** project by the same author — "CRS-自建 Claude Code 镜像…". Sub2API is described in the README as "Sub2API-CRS2", i.e. CRS's successor generation. Different codebase, different API surface. | Different project |
| **`sub2api.com`** | **Not the official domain.** TLS handshake fails with `no alternative certificate subject name matches target host name 'sub2api.com'`, i.e. the host serves a certificate for some other name. One fork's README states outright: *"Sub2API officially uses only the domains `sub2api.org` and `pincc.ai`. Other websites using the Sub2API name may be third-party deployments or services and are not affiliated with this project."* That exact sentence is **not present in the canonical `main` README** I cloned, so the "official domains" claim is **unverified** for pincc.ai (see below). | Treat as unrelated / unverified |
| `sub-2-api`, `subscription2api` | No project of these exact names surfaced. Substring noise. | Nothing found |
| **one-api / new-api** | Different, unrelated relay projects. Sub2API is **not** a fork of either — its own README/docs never mention them, and the codebase is Go+Ent+Vue rather than one-api's Go+GORM React. | Different projects |

**Official-facing domains (partially verified):**
- `sub2api.org` — `https://sub2api.org/` returns HTTP 404 with body `{"error":"not_found"}` (live host, no root route). The canonical README's sponsor contact is `support@sub2api.org`, which is decent evidence it is the project's domain. **Verified as a live host; "official domain" itself is inferred.**
- `demo.sub2api.org` — the README advertises an online demo with credentials `admin@sub2api.org` / `admin123`. **At research time it returned HTTP 502** (demo down).
- `pincc.ai` / `shop.pincc.ai` — advertised by a fork's README as "**PinCC**, the official relay service built on Sub2API". `shop.pincc.ai:443` failed to connect (`SSL_ERROR_SYSCALL`). **Unverified.**
- There is **no separate docs site**. Documentation lives in the repo: `README.md`, `README_CN.md`, `README_JA.md`, and `docs/*.md`. There is **no OpenAPI/Swagger spec** anywhere in the repo (searched for `swagger` / `openapi` — zero hits).

**There is also an unrelated DSH-side plugin family worth knowing about:**
- `@godd6366/dsh-sub2api` (npm, v0.2.1, repo `github.com/GodD6366/dsh-sub2api`) — a **DeepSeek Harness plugin that connects a DSH install to a Sub2API gateway**. It is *not* the gateway. Its README states: *"**Usage lookup**: 'view usage' calls `GET {baseURL}/v1/usage` and summarizes quota, balance, rate limits, and subscription windows."* This is independent, working corroboration of the endpoint I identify in §2.A. Note its GitHub `main` README 404s; the authoritative copy is the npm tarball
  ([npm](https://www.npmjs.com/package/@godd6366/dsh-sub2api), verified by downloading
  `dsh-sub2api-0.2.1.tgz` and reading `README.md` + `src/routes.ts`).

---

## 2. The exact HTTP endpoints

Three distinct auth tiers. **Only tier A works with an API key alone; tier B needs a JWT from a
password/OAuth login.**

Base URL conventions: panel API is `{host}/api/v1`, gateway API is `{host}/v1`. The frontend
default is `const DEFAULT_API_BASE_URL = '/api/v1'`
([`frontend/src/api/url.ts`](https://github.com/Wei-Shaw/sub2api/blob/7c700729c23187d31ed320f6b19c790e2f194826/frontend/src/api/url.ts)).

**Response envelope for all `/api/v1/*` panel endpoints** (not for `/v1/*` gateway endpoints):
```json
{ "code": 0, "message": "success", "data": { ... } }
```
([`backend/internal/pkg/response/response.go`](https://github.com/Wei-Shaw/sub2api/blob/7c700729c23187d31ed320f6b19c790e2f194826/backend/internal/pkg/response/response.go))

### A. Per-key, API-key authenticated — **this is the one a usage plugin wants**

#### `GET /v1/usage`

The only quota endpoint that authenticates with an API key. Registered in the gateway group after
`apiKeyAuth` ([`routes/gateway.go`](https://github.com/Wei-Shaw/sub2api/blob/7c700729c23187d31ed320f6b19c790e2f194826/backend/internal/server/routes/gateway.go#L186-L214)).

**Auth** — any one of (checked in this order,
[`middleware/api_key_auth.go`](https://github.com/Wei-Shaw/sub2api/blob/7c700729c23187d31ed320f6b19c790e2f194826/backend/internal/server/middleware/api_key_auth.go#L59-L94)):
- `Authorization: Bearer sk-…`
- `x-api-key: sk-…`
- `x-goog-api-key: sk-…` (Gemini CLI compatibility)

**Crucially, this endpoint skips all billing enforcement** — an expired, quota-exhausted, or
subscription-less key can still query its own usage:
> `/v1/usage`、`/v1/sub2api/billing` 端点与异步生图任务查询只需鉴权，不需要计费执行。
> — `api_key_auth.go` L31, enforced at L172 (`skipBilling := c.Request.URL.Path == "/v1/usage" || …`)

**Request body:** none. **Optional query:** `days` (1–90, for the `daily_usage` array), `start_date`/`end_date`, `timezone`.

**Response — mode A1, key has a USD quota and/or rate limits** (`apiKey.Quota > 0 || HasRateLimits()`),
built by `usageQuotaLimited`
([`handler/gateway_handler.go` L1648-1739](https://github.com/Wei-Shaw/sub2api/blob/7c700729c23187d31ed320f6b19c790e2f194826/backend/internal/handler/gateway_handler.go#L1648)):

```json
{
  "mode": "quota_limited",
  "isValid": true,
  "status": "active",
  "quota": { "limit": 10.0, "used": 3.2, "remaining": 6.8, "unit": "USD" },
  "remaining": 6.8,
  "unit": "USD",
  "rate_limits": [
    { "window": "5h", "limit": 5.0, "used": 1.2, "remaining": 3.8,
      "window_start": "2026-09-20T11:00:00Z", "reset_at": "2026-09-20T16:00:00Z" },
    { "window": "1d", "limit": 20.0, "used": 4.0, "remaining": 16.0,
      "window_start": "…", "reset_at": "…" },
    { "window": "7d", "limit": 80.0, "used": 22.5, "remaining": 57.5,
      "window_start": "…", "reset_at": "…" }
  ],
  "expires_at": "2026-10-01T00:00:00Z",
  "days_until_expiry": 12,
  "usage": {
    "today": { "requests": 0, "input_tokens": 0, "output_tokens": 0,
               "cache_creation_tokens": 0, "cache_read_tokens": 0,
               "total_tokens": 0, "cost": 0.0, "actual_cost": 0.0 },
    "total": { "requests": 0, "…": 0 },
    "average_duration_ms": 0, "rpm": 0, "tpm": 0
  },
  "daily_usage": [ { "date": "2026-09-20", "requests": 0, "input_tokens": 0,
                     "output_tokens": 0, "cache_read_tokens": 0, "cache_write_tokens": 0,
                     "total_tokens": 0, "cost": 0.0, "actual_cost": 0.0 } ],
  "model_stats": [ ]
}
```

Field semantics, verified in source:
- `quota` is emitted **only if `apiKey.Quota > 0`**, and `remaining`/`unit` at top level only alongside it.
- `rate_limits[]` entries are emitted **only for windows whose limit is > 0** — a key with only a 5h limit gets a one-element array. `reset_at` is present **only while the window is not expired**; an expired window yields `used: 0` (via `EffectiveUsage5h/1d/7d`) with no `reset_at`.
- Window sizes are fixed constants: `RateLimitWindow5h = 5h`, `RateLimitWindow1d = 24h`, `RateLimitWindow7d = 7*24h`.
- **Units are USD, not request counts**: `RateLimit5h float64 // Rate limit in USD per 5h (0 = unlimited)` ([`service/api_key.go` L19-21, L56-61](https://github.com/Wei-Shaw/sub2api/blob/7c700729c23187d31ed320f6b19c790e2f194826/backend/internal/service/api_key.go#L56)).
- **No used-percentage field.** Only `used`/`limit`/`remaining`. Compute `used/limit*100` client-side.
- `usage` / `daily_usage` / `model_stats` are best-effort and are **omitted entirely** when the underlying query returns nothing.

**Response — mode A2, key is unlimited but its group is a subscription package**, built by
`usageUnrestricted` ([L1741-1782](https://github.com/Wei-Shaw/sub2api/blob/7c700729c23187d31ed320f6b19c790e2f194826/backend/internal/handler/gateway_handler.go#L1741)):

```json
{
  "mode": "unrestricted",
  "isValid": true,
  "planName": "<group display name>",
  "unit": "USD",
  "remaining": 12.5,
  "subscription": {
    "daily_usage_usd": 1.0, "weekly_usage_usd": 5.0, "monthly_usage_usd": 12.5,
    "daily_limit_usd": 5.0, "weekly_limit_usd": 25.0, "monthly_limit_usd": 100.0,
    "weekly_window_start": "2026-09-15T00:00:00Z",
    "expires_at": "2026-10-20T00:00:00Z"
  },
  "usage": { "…": "as above" }
}
```
- `remaining` is computed by `calculateSubscriptionRemaining`: **0** if *any* configured daily/weekly/monthly window is at ≥100%, otherwise the **minimum** remaining across configured windows, and **`-1` when the group has no limits at all** (unlimited). See L1817-1850 of the same file.
- Note there is **no `daily_limit_usd`-style `percentage`**; compute from the pairs.
- **Caveat:** the `subscription` object is present only when the key's group is subscription-type **and** an active subscription row is found. If the key is subscription-type with no active subscription, the middleware deliberately lets the call through (`skipBilling`) and the handler silently omits `subscription` — you then get `remaining` absent too. Handle that case.
- Also note `daily_limit_usd` etc. are emitted as pointers, so they can be JSON `null` when unset.

**Response — mode A3, plain wallet balance key** (same `unrestricted` builder, group is not a subscription):
```json
{ "mode": "unrestricted", "isValid": true, "planName": "钱包余额",
  "remaining": 66.28, "unit": "USD", "balance": 66.28, "usage": { "…": 0 } }
```
`planName` is literally the Chinese string `钱包余额` ("wallet balance") — **not localized**; don't match on it. Use `balance`/`remaining` presence instead. `balance` comes from a fresh `userService.GetByID`, i.e. it is the **account-level balance**, surfaced through a key-auth endpoint.

#### `GET /v1/sub2api/billing` — per-key, but **not** balance/quota

Returns the **billing rate multipliers** for the authenticated key, not balance. Registered before
the group middlewares so it only needs authentication
([`routes/gateway.go` L192](https://github.com/Wei-Shaw/sub2api/blob/7c700729c23187d31ed320f6b19c790e2f194826/backend/internal/server/routes/gateway.go#L192)).

Same three auth headers. Response (`gateway_key_billing.go` L18-31):
```json
{ "object": "sub2api.key_billing", "schema_version": 1, "billing_scope": "token",
  "group_rate_multiplier": 1.0, "user_rate_multiplier": null,
  "resolved_rate_multiplier": 1.0, "peak_rate_enabled": false,
  "effective_rate_multiplier": 1.0, "timezone": "Asia/Shanghai",
  "observed_at": "2026-09-20T13:00:00Z" }
```
Errors: `403 permission_error` if the key has no group; `404 not_found_error` in `RUN_MODE=simple`.
**Do not use this for balance.** (Interesting: Sub2API itself probes *other* Sub2API relays' `/v1/sub2api/billing` when configured with a Sub2API upstream — see `backend/internal/service/upstream_billing_probe.go`.)

### B. Per-account, JWT authenticated — the web dashboard's own API

All of these require `Authorization: Bearer <JWT access_token>`; the JWT comes from
`POST /api/v1/auth/login` (email+password, optional 2FA step `POST /api/v1/auth/login/2fa`) or from
one of the OAuth flows. Login response is `{access_token, refresh_token, expires_in, token_type, user}`
([`handler/auth_handler.go` L93-100](https://github.com/Wei-Shaw/sub2api/blob/7c700729c23187d31ed320f6b19c790e2f194826/backend/internal/handler/auth_handler.go#L93));
refresh with `POST /api/v1/auth/refresh` `{refresh_token}`. The SPA stores it in `localStorage`
under `auth_token` and attaches it as a Bearer header
([`frontend/src/api/client.ts`](https://github.com/Wei-Shaw/sub2api/blob/7c700729c23187d31ed320f6b19c790e2f194826/frontend/src/api/client.ts)).

The whole group is mounted with `jwtAuth` in
[`routes/user.go` L20-23](https://github.com/Wei-Shaw/sub2api/blob/7c700729c23187d31ed320f6b19c790e2f194826/backend/internal/server/routes/user.go#L20).
**It does not accept API keys, and there is no cookie fallback** (I grepped `jwt_auth.go` for
`Cookie` — zero hits; the axios `withCredentials: true` is vestigial for this purpose).

| Endpoint | Returns | Notes |
|---|---|---|
| `GET /api/v1/user/profile` | account **balance** | `data.balance`, `data.frozen_balance` (floats, USD), plus `rpm_limit`, `concurrency`, `total_recharged`, `status`. DTO at [`handler/dto/types.go` L12-38](https://github.com/Wei-Shaw/sub2api/blob/7c700729c23187d31ed320f6b19c790e2f194826/backend/internal/handler/dto/types.go#L12) |
| `GET /api/v1/keys` | list of the user's own keys | each item carries `quota` (USD limit, `0` = unlimited) and `quota_used` (USD used) → **per-key balance/usage without a JWT-free path** |
| `GET /api/v1/user/api-keys/:id/usage/daily?days=30` | daily usage rows for one key | `{items:[{date, requests, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens, cost, actual_cost}], days, start_date, end_date}`; `days` 1–90 |
| **`GET /api/v1/subscriptions/progress`** | **the best quota endpoint** | see below |
| `GET /api/v1/subscriptions/summary` | compact per-subscription usage vs limits | see below |
| `GET /api/v1/subscriptions` / `/active` | raw subscription rows | |
| `GET /api/v1/user/platform-quotas` | admin-configured per-platform daily/weekly/monthly USD limits + usage | see below |
| `GET /api/v1/usage/dashboard/stats` | aggregate token/cost stats | `total_cost`, `actual_cost`, `today_*`, `rpm`, `tpm`, `by_platform[]` |
| `GET /api/v1/usage/dashboard/trend`, `/models`, `/snapshot-v2`, `POST /usage/dashboard/api-keys-usage` | time series / per-model / batch per-key | |

**`GET /api/v1/subscriptions/progress`** — per-subscription used **and remaining** and **percentage**,
with window start and reset time. Handler `GetProgress` returns an array of
`{subscription, progress}` ([`handler/subscription_handler.go` L28-31, L91-120](https://github.com/Wei-Shaw/sub2api/blob/7c700729c23187d31ed320f6b19c790e2f194826/backend/internal/handler/subscription_handler.go#L28)).
The `progress` object is
([`service/subscription_service.go` L1098-1117](https://github.com/Wei-Shaw/sub2api/blob/7c700729c23187d31ed320f6b19c790e2f194826/backend/internal/service/subscription_service.go#L1098)):

```json
{
  "id": 7, "group_name": "Claude Pro 拼车", "expires_at": "2026-10-20T00:00:00Z",
  "expires_in_days": 30,
  "daily":   { "limit_usd": 5,  "used_usd": 1.0,  "remaining_usd": 4.0,
               "percentage": 20.0, "window_start": "…", "resets_at": "…", "resets_in_seconds": 43200 },
  "weekly":  { "…": "same shape" },
  "monthly": { "…": "same shape" }
}
```
Windows with no configured limit are **omitted** (`omitempty` on `daily`/`weekly`/`monthly`).
This endpoint does expose **both** used-percentage (`percentage`) **and** remaining (`remaining_usd`),
plus an absolute `resets_at` — the richest per-subscription quota readout in the product.

> **Documentation bug worth knowing:** the frontend's TypeScript type for this response
> ([`frontend/src/types/index.ts` L2075-2097](https://github.com/Wei-Shaw/sub2api/blob/7c700729c23187d31ed320f6b19c790e2f194826/frontend/src/types/index.ts#L2075))
> declares `{used, limit, percentage, reset_in_seconds}`, which **does not match the Go struct**
> (`used_usd`, `limit_usd`, `remaining_usd`, `window_start`, `resets_at`, `resets_in_seconds`).
> The Go struct is authoritative — the TS type appears stale. Trust the Go field names.

**`GET /api/v1/subscriptions/summary`** — `{active_count, total_used_usd, subscriptions:[{id, group_id, group_name, status, daily_used_usd, daily_limit_usd, weekly_used_usd, weekly_limit_usd, monthly_used_usd, monthly_limit_usd, expires_at}]}`
(struct `SubscriptionSummaryItem`, same handler file L13-25). Limits default to `0` when unset, and
`used`/`limit` fields are `omitempty` — so a `0` limit is indistinguishable from an absent one here.
No percentage field.

**`GET /api/v1/user/platform-quotas`** — the platform-level (Anthropic/OpenAI/Gemini/Antigravity/Grok)
USD windows, which is the closest thing to a provider-shaped quota:
```json
{ "platform_quotas": [ {
    "platform": "anthropic",
    "daily_limit_usd": 5.0, "weekly_limit_usd": 25.0, "monthly_limit_usd": 100.0,
    "daily_usage_usd": 1.0, "weekly_usage_usd": 4.0, "monthly_usage_usd": 12.0,
    "daily_window_start": "…", "weekly_window_start": "…", "monthly_window_start": "…",
    "daily_window_resets_at": "…", "weekly_window_resets_at": "…", "monthly_window_resets_at": "…"
} ] }
```
Type: [`frontend/src/api/admin/users.ts` L333-350](https://github.com/Wei-Shaw/sub2api/blob/7c700729c23187d31ed320f6b19c790e2f194826/frontend/src/api/admin/users.ts#L333)
(`PlatformQuotaPlatform = 'anthropic'|'openai'|'gemini'|'antigravity'|'grok'`,
`PlatformQuotaWindow = 'daily'|'weekly'|'monthly'`). Returns `{"platform_quotas": []}` when the
feature is not wired. Limits are `number | null`. Again no percentage field.

### C. Admin

`/api/v1/admin/*` is mounted with `adminAuth`
([`routes/admin.go` L26-32](https://github.com/Wei-Shaw/sub2api/blob/7c700729c23187d31ed320f6b19c790e2f194826/backend/internal/server/routes/admin.go#L26)).
`adminAuth` accepts **either** the admin **API key** in the `x-api-key` header **or** an admin JWT
([`middleware/admin_auth.go` L49-57](https://github.com/Wei-Shaw/sub2api/blob/7c700729c23187d31ed320f6b19c790e2f194826/backend/internal/server/middleware/admin_auth.go#L49)).
The admin API key is generated in the admin UI; format is `admin-<hex>` (`AdminAPIKeyPrefix = "admin-"`,
`service/domain_constants.go` L751; generation in `service/setting_features.go` L569-585).
Relevant admin reads: `GET /api/v1/admin/users/:id/platform-quotas`,
`GET /api/v1/admin/users/:id/balance-history`, plus `POST /api/v1/admin/users/:id/balance` to
credit/debit — the latter is **documented** in
[`docs/ADMIN_PAYMENT_INTEGRATION_API.md`](https://github.com/Wei-Shaw/sub2api/blob/7c700729c23187d31ed320f6b19c790e2f194826/docs/ADMIN_PAYMENT_INTEGRATION_API.md)
(the only externally documented HTTP API in the repo).

---

## 3. Is there a documented public usage/quota API?

**Plainly: no.** There is **no public API reference, no OpenAPI/Swagger file, and no usage/quota
endpoint in any doc.** I grepped the entire repo for `v1/usage` in `*.md` — **zero hits**. The only
documented HTTP API is the admin payment-integration API above (`docs/ADMIN_PAYMENT_INTEGRATION_API.md`),
which is about crediting balances from an external payment system, not about reading usage.
`docs/PLUGIN_DEVELOPMENT.md` documents the `.s2plugin` gRPC plugin ABI — a host-side extension
mechanism, unrelated to HTTP usage queries.

Everything in §2 is an **internal API reverse-engineered from the source that the web dashboard
itself calls**. Concretely, the dashboard's own call sites are:

| Dashboard action | HTTP call |
|---|---|
| Profile / balance card | `GET /api/v1/user/profile` ([`frontend/src/api/user.ts`](https://github.com/Wei-Shaw/sub2api/blob/7c700729c23187d31ed320f6b19c790e2f194826/frontend/src/api/user.ts)) |
| Subscription progress bars | `GET /api/v1/subscriptions/progress` / `/summary` ([`frontend/src/api/subscriptions.ts`](https://github.com/Wei-Shaw/sub2api/blob/7c700729c23187d31ed320f6b19c790e2f194826/frontend/src/api/subscriptions.ts)) |
| Per-platform quota table | `GET /api/v1/user/platform-quotas` (`user.ts`) |
| Usage dashboard | `GET /api/v1/usage/dashboard/{stats,trend,models,snapshot-v2}` ([`frontend/src/api/usage.ts`](https://github.com/Wei-Shaw/sub2api/blob/7c700729c23187d31ed320f6b19c790e2f194826/frontend/src/api/usage.ts)) |
| Per-key usage | `GET /api/v1/user/api-keys/:id/usage/daily` (`usage.ts`) |
| API key list incl. `quota`/`quota_used` | `GET /api/v1/keys` ([`frontend/src/api/keys.ts`](https://github.com/Wei-Shaw/sub2api/blob/7c700729c23187d31ed320f6b19c790e2f194826/frontend/src/api/keys.ts)) |

The progress **percentage is computed client-side** in the dashboard from `used/limit` in
`frontend/src/components/common/SubscriptionProgressMini.vue` (e.g. `((sub.daily_usage_usd || 0) / sub.group.daily_limit_usd) * 100`) — even though the backend `progress.percentage` already exists for the subscription endpoint.

So: **only a web dashboard is "documented"; `GET /v1/usage` is an undocumented but stable-looking,
key-authenticated public surface** that at least one shipped third-party client already depends on
(`@godd6366/dsh-sub2api`, §1).

---

## 4. Auth token types and rate limits

**Three credential types:**

1. **Gateway API key** — `sk-…` (prefix configurable via `default.api_key_prefix`), sent as
   `Authorization: Bearer`, `x-api-key`, or `x-goog-api-key`. Unlocks `/v1/*`, including `/v1/usage`
   and `/v1/sub2api/billing`. Per-key, bound to a group; the group decides platform and models.
2. **User JWT** — `access_token` from `/api/v1/auth/login` (+ `/login/2fa`), typed as
   `Authorization: Bearer`. Short-lived with a refresh token (`expires_in` in the login response;
   `jwt.expire_hour` defaults to 24 in `config.yaml`). Unlocks `/api/v1/*` panel endpoints.
   **API keys cannot call these.**
3. **Admin**: admin **API key** `admin-<hex>` via `x-api-key`, **or** an admin-role JWT. Unlocks
   `/api/v1/admin/*`.

**Rate limits:**

- **Per-key windows** are USD-denominated and are the source of the 5h/1d/7d data:
  `RateLimit5h`/`1d`/`7d` (USD, 0 = unlimited) with `Effective*()` zeroing expired windows.
- **Panel (JWT) endpoints** have a per-user, per-minute global cap plus a stricter *heavy* cap that
  stacks on top (a heavy call consumes both buckets), defaulting to **`user_rpm: 240`** and
  **`heavy_rpm: 60`**, both admin-configurable, `0` = unlimited
  ([`service/setting_panel_rate_limit.go` L49-50](https://github.com/Wei-Shaw/sub2api/blob/7c700729c23187d31ed320f6b19c790e2f194826/backend/internal/service/setting_panel_rate_limit.go#L49);
  middleware at `middleware/panel_rate_limit.go`). **`GET /api/v1/user/platform-quotas` is not in the heavy set; `GET /api/v1/user/api-keys/:id/usage/daily` is** (`Heavy()` in `routes/user.go` L40).
- **Auth endpoints** are separately limited per endpoint label, e.g. `auth-login` 20/min,
  `auth-register` 5/min, `auth-refresh` 30/min, `forgot-password` 5/min (`routes/auth.go` L35-75).
- **Repeated invalid API keys** on the gateway trip `INVALID_AUTH_RATE_LIMITED` (HTTP 429) before
  auth is even evaluated (`api_key_auth.go` L44-48).
- `/v1/usage` and `/v1/sub2api/billing` **bypass billing enforcement** but **not** authentication,
  not the group-assignment check, and not the group model allowlist. For a GET with no body and no
  `?model=`, the allowlist middleware finds no model candidates and passes — verified in
  `middleware/group_model_allowlist.go` L44-90.

**Gotchas for a plugin:**
- `GET /v1/usage` returns **403** for a key with **no group** unless the admin enabled
  "ungrouped key scheduling" (`middleware.RequireGroupAssignment`, `middleware.go` L143-159).
- `/v1/sub2api/billing` returns **404** in `RUN_MODE=simple` (simple mode skips billing).
- `/v1/usage` sits behind `requireGroupAnthropic` (= `RequireGroupAssignment`), so the 403 above
  applies to it too.
- The gateway group also applies `groupModelAllowlist`, `compositeTarget` and `requireGroupAnthropic`
  to `/v1/usage`; only the model allowlist is provably a no-op for a bodyless GET.

---

## 5. Local evidence on this machine

Everything below is read-only; **no secret values are reproduced** (in fact none exist).

| Location | Result |
|---|---|
| `env \| grep -i sub2` | **no matches** |
| `~/.dsh/settings.yaml` | **no `sub2` match.** Providers in use: `agent-default-model.provider = deepseek-official`; `subagent-model-selection.allowedModels = [{model: deepseek-flash}]`; **`llm-pi-ai.providers: {}` (empty)** — so no Sub2API-derived provider profile is configured |
| `~/.dsh/.credentials.yaml` | **no `sub2` match** |
| `~/.dsh/storages/` | only hit is a **transcript of this very task** in `session_projcache/sessions/394fb0be-….json` (my own prompt text). `storages/cost-meter/`, `usage-stats-cache.json`, `workspace.json`: no matches |
| `~/.dsh/profiles/web/package.json` | **no `sub2` match.** Bundles: `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, `dshmarket`, `dsh-better-sidebar`, `dsh-cost-meter`, `dsh-ui-font`, `dsh-session-recycle-bin` |
| `~/.dsh/profiles/web/cordis.patch.yml` | **no `sub2` match** — the patch layer is literally `[]` |
| `~/.config/` | matches only in unrelated Raycast extension sourcemaps (`convert-color.js.map` etc.) — substring noise, no Sub2API config |
| `~/.zshrc`, `~/.bashrc` | **files do not exist** |
| `~/.zprofile` | **no `sub2` match** |

**The one genuine local finding** — `~/.dsh/profiles/web/.dsh-market/discovery-compatibility-v1.json`
(the DSH market catalog cache) contains a registry entry for the unrelated DSH plugin:

- **package id:** `@godd6366/dsh-sub2api`
- **version:** `0.2.1`
- **peerDependencies:** `@deepseek-ai/cordis ^4.0.2`, plus `dsh-fs`, `dsh-llm`, `dsh-tools`,
  `dsh-settings`, `dsh-llm-pi-ai`, `dsh-attachment`, `dsh-credentials`, `dsh-system-prompt`,
  `dsh-host-webserver`, `schemastery`

It is **not installed** — `~/.dsh/profiles/web/node_modules/@godd6366/` exists but is **empty**, and
it is absent from `package.json` bundles and from `.dsh-market/log.ndjson`. So the machine has a
market *catalog* entry only.

Also relevant: the currently installed usage plugin on this machine is
`@ychris12138/dsh-usage-stats` (activated via `.dsh-market/hot-1.yml`, pointing at
`node_modules/@ychris12138/dsh-usage-stats/lib/index.js`) — but that directory is **also empty**
(node_modules was pruned), so its compiled code could not be inspected. Its public README advertises
"真实 Sub2API 面板余额（`sub2api-auth`）" (real Sub2API panel balance via `sub2api-auth`)
([dsh-usage-stats](https://github.com/Ychris12138/dsh-usage-stats)) — i.e. it takes the **JWT panel**
route (§2.B), consistent with that repo's own remark that Sub2API upstreams generally have no
public balance API, which matches my finding that only `/v1/usage` is key-authenticated.

**Nothing in this workspace** (`dsh-usage-state`, including `research/provider-usage-apis.md` and
`dsh-cost-meter-analysis.md`) mentions sub2api — grep found zero hits. `git log` fails (no commits yet).

---

## 6. Bottom line for the plugin

- **If you can ask the user for an API key only:** use `GET {base}/v1/usage` with
  `Authorization: Bearer sk-…`. You get, in one call: account balance (`balance`/`remaining`),
  per-key USD `quota{limit,used,remaining}`, and **5h / 1d / 7d USD windows with `used`, `limit`,
  `remaining`, `window_start`, `reset_at`** — plus today/total token and cost stats. Percentage must
  be computed as `used/limit`. This is undocumented but is exactly what the shipped
  `@godd6366/dsh-sub2api` plugin does.
- **If you can store a username/password or an OAuth/JWT session:** `GET /api/v1/subscriptions/progress`
  is strictly better — it gives `percentage` and `remaining_usd` and `resets_at` per window directly,
  plus `GET /api/v1/user/profile` for the account balance and `GET /api/v1/keys` for per-key
  `quota`/`quota_used`.
- **5-hour / 7-day windows exist only in the key-scoped `/v1/usage` response and only when the key
  has those USD limits configured.** The end-user subscription model itself is **daily / weekly /
  monthly** — there is no 5-hour user-facing subscription window. 5-hour data appears in the
  **admin** account views (upstream account quota probing, e.g. `codex_5h_used_percent`,
  `AccountUsageCell.vue` five_hour), not in the user panel. So do not expect a `five_hour` key from
  any `/api/v1/*` endpoint.
- **There is no documented public usage API, no OpenAPI spec, and no stable-versioning guarantee.**
  Treat all of the above as internal API surface that has changed before (the frontend/backend type
  drift documented in §2.B is direct evidence of that).

### Explicitly unverified

- Whether `pincc.ai` is genuinely an official Sub2API-operated service (fork README claim; the site
  did not connect at research time). The canonical `main` README does not contain the "official
  domains" sentence.
- Whether `sub2api.org` is *the* official site vs. a project-controlled landing/API host. It is
  live (404 `{"error":"not_found"}` at `/`), and `support@sub2api.org` appears in the canonical
  README as the sponsor contact — strong but not conclusive.
- `https://demo.sub2api.org/` returned **502** at research time, so I could not observe any live
  response shape. Every JSON shape above is read from Go source at the pinned commit, not observed.
- Whether `/v1/usage` exists unchanged in releases older than v0.2.7. I verified only the pinned
  `main` commit; the `skipBilling` exemption for `/v1/usage` is present there and its comment
  describes it as pre-existing behaviour ("保留原有订阅读取行为"), which suggests it is not new.
- The `sub2api.com` owner and intent — TLS cert mismatch only; the site's actual content was not
  retrievable.
