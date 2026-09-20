# dsh-cost-meter v1.7.28 — technical analysis for a simplified rewrite

Read-only analysis. Nothing was modified. All paths below are under:

```
/Volumes/M2ExHome/rockman/.dsh/profiles/web/node_modules/dsh-cost-meter
```

Path note: `~` (bash `HOME`) is `/Volumes/M2ExHome/rockman`; the requested path
`/Users/rockman/.dsh/profiles/web/node_modules/dsh-cost-meter` **does not exist**
(`/Users/rockman` is not the DSH home). `ls /Volumes/M2ExHome/rockman/.dsh/profiles/web/node_modules/dsh-cost-meter`
succeeds and is the analyzed install.

---

## 1. Package layout

### 1.1 Manifest (`package.json`)

| Field | Value |
|---|---|
| `name` / `version` | `dsh-cost-meter` / `1.7.28` |
| `type` / `main` | `module` / `lib/index.js` |
| `bin` | `{ "dsh-cost-meter-repair-sessions": "./lib/repair-sessions-cli.js" }` |
| `exports` | `"."` → `./lib/index.js`; `"./client"` → `./lib/client.js`; `"./typert"` → `./lib/typert.host.js`; `"./package.json"` → `./package.json` |
| `dependencies` | `zod` `4.5.1` (only runtime dep) |
| `peerDependencies` | `@deepseek-ai/dsh-credentials`, `@deepseek-ai/dsh-home-paths` (both `^0.1.0-rc.6 \|\| ^0.1.1-0 \|\| ^0.1.2-0 \|\| ^0.1.3-0 \|\| ^0.1.5-0`) |
| `devDependencies` | same two packages at `0.1.0-rc.8`, plus `esbuild` `^0.28.2` |
| `files` | `lib`, `cordis.patch.yml`, `docs/provider-pricing.json` |
| `engines` / `os` | `node >=20` / darwin, linux, win32 |
| `scripts` | `build`: `node scripts/build.mjs` (script **not shipped**); `test`: `node test/verify.mjs` (not shipped) |

### 1.2 `dsh` field (plugin manifest)

```json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": { "platform": "web" },
  "compatibility": {
    "dsh": ">=0.1.0-rc.5",
    "dshReleases": { "0.1.2-alpha.3": "compatible", ... "0.1.5-alpha.1": "compatible" }
  }
}
```

There is a second, market-facing manifest `dshhub` (schemaVersion 1, surfaces
`["host","web"]`, `capabilities.provides: ["service:cost-meter"]`,
`permissions.network` = 22 allow-listed hosts incl. `https://api.deepseek.com`,
`https://api-docs.deepseek.com`, `https://opencode.ai`, `https://api.anthropic.com`,
`https://api.z.ai`, `https://open.bigmodel.cn`, `https://api.kimi.com`,
`https://api.moonshot.cn`, `https://openrouter.ai`, `https://api.siliconflow.cn`,
`https://api.commandcode.ai`, `https://open.volcengineapi.com`,
`https://business.aliyuncs.com`, `https://ax.ac.sugon.com`, minimax domains).

`cordis.patch.yml` is a one-row loader insert:

```yaml
- insert:
    - id: cost-meter
      name: dsh-cost-meter
```

The profile that loads it (`/Volumes/M2ExHome/rockman/.dsh/profiles/web/package.json`)
lists `dsh-cost-meter` in `dsh.profile.bundles` with `"patchReload": "live"`; the
profile's own `cordis.patch.yml` is an empty array.

### 1.3 Host (Node) side vs browser/client bundle

- **Host side — every `lib/*.js` except `client.js`; all readable hand-written ESM**
  (comment headers in Chinese, no bundling/minification). Measured: `index.js` 2,928
  lines / max line 363 chars; `store.js` 2,354; `pricing.js` 1,321; `coding-plans.js`
  1,249; `backfill.js` 1,131; `gateway-quota-adapters.js` 960; `typert.host.js` 803;
  `gateway-quotas.js` 630; `plan-billing.js` 562; plus `net.js`, `custom-balance.js`,
  `aliyun-balance.js`, `native-search-*.js`, `session-*.js`, `usage-dedup.js`,
  `billing-stream.js`, `qwen-cli.js`, `scnet-snapshot.js`, `repair-sessions-cli.js`.
- **Client side — `lib/client.js` only: a single minified esbuild bundle**
  (261,898 bytes / 6 lines / max line 154,947 chars). Its first line states:
  `// This file is generated from the src/client/*.js fragments via `node scripts/build.mjs` (esbuild). Do not edit directly.`
  It is a client-plugin bundle, not an ES module:
  `window.__ModuleLoader__.load({id:"dsh-cost-meter",factory:It=>{...}})`.
- **No `src/`, no `scripts/`, no `test/` in the installed package** (they are excluded
  by `files`), so the readable client source fragments are **not available** here;
  only the minified artifact is.
- Build tooling evidence: `scripts.build` + `devDependencies.esbuild` + the generated
  header. Host code is *not* bundled (it uses plain relative ESM imports).
- `docs/provider-pricing.json` is a shipped, generated price catalog
  (`generatedAt: 2026-09-11`, `providers`: openai, anthropic, google, moonshot, z-ai,
  xai, alibaba, minimax, tencent, xiaomi, upstage, meta, meituan, nvidia, mistral,
  opencode-go) — informational only, not read at runtime (runtime prices live in
  `pricing.js`).

---

## 2. Settings

### 2.1 How settings are declared / registered in the DSH plugin API

**There is no DSH settings-schema registration.** The plugin never calls a
`settings`-register/schema API. It declares three things to DSH:

1. The loader row (`dsh.bundle.patch` → `cordis.patch.yml`, above).
2. The host plugin entry: `export const name = 'cost-meter'` (`index.js:38`) and
   `export function apply(ctx)` (`index.js:2852`) — the Cordis plugin contract.
   No module-level `inject` export; services are fetched defensively.
3. A Typert RPC manifest: `export const TYPERT` (`typert.host.js:511`) exposing the
   `costMeter` service over the `./typert` export, registered by DSH's typert-loader.

DSH's own `settings` service is only **read**:

- `ctx.get('settings')` → `.get('llm-deepseek')` for `baseURL` / `apiKeyEnv`
  (`index.js:930-935`);
- `ctx?.get?.('settings')?.get?.('llm-pi-ai')?.providers` to discover an OpenCode Go
  route's `apiKeyEnv` (`index.js:695-704`).

The plugin's own config is validated by **its own zod schema**, `configSchema`
(`typert.host.js:124-309`), used as the strict wire codec for
`stateSchema.config` (`typert.host.js:470`) and as the shape of the
`ConfigPatch` codec (`patchSchema = z.record(z.string(), z.unknown())`,
`typert.host.js:484`). Patch validation is hand-written in `applyConfigPatch`
(`store.js:1001+`): unknown top-level keys are rejected against
`CONFIG_KEYS = Object.keys(defaultConfig())` (`store.js:270`, check at
`store.js:1010-1013`); per-field clamping/coercion follows (`store.js:1046-1140`);
secrets are stripped at the patch entry (`stripSecretPatch`, `store.js:1008`).

The settings **UI** is registered client-side through the `settings.section` slot
(§4) and writes config through the `costMeter.updateConfig` RPC.

### 2.2 Full settings schema (every option, type, default)

Types from `configSchema` (`typert.host.js:124-309`); defaults from
`defaultConfig()` (`store.js:117-268`). All descendants are required unless marked
optional in the zod schema; note zod's default `strip` behaviour deletes undeclared keys.

| Key | Type (zod) | Default | Notes |
|---|---|---|---|
| `locale` | `enum('auto','zh','en')` | `'auto'` | UI language |
| `position` | `enum('dock','header','off')` | `'dock'` | where the per-session cost line renders |
| `sidebar` | boolean | `true` | |
| `currency` | string | `'CNY'` | `CNY\|USD\|EUR\|custom` by convention |
| `symbol` | string | `'¥'` | |
| `decimals` | number | `4` | |
| `exchangeRate` | number | `7.2` | USD→display currency |
| `pricingCurrency` | `enum('USD','CNY')` optional | `'USD'` | official price table currency |
| `peakEnabled` | boolean | `true` | peak/off-peak billing |
| `peakEffectiveAt` | string | `'2026-08-01T00:00:00Z'` (`pricing.js:47`) | |
| `peakWindows` | `array({start:number,end:number})` | `[{start:1,end:4},{start:6,end:10}]` (`pricing.js:103`) | UTC hours |
| `peakNotice` | boolean optional | `true` | |
| `peakAlertEnabled` | boolean optional | `true` | pre-switch popup |
| `peakAlertAhead` | number optional | `2` | minutes 1–30 |
| `peakAlertTarget` | `enum('peak','offpeak','both')` optional | `'both'` | |
| `peakAlertPosition` | `enum('corner','center')` optional | `'corner'` | |
| `peakAlertWebNotify` | boolean optional | `false` | |
| `peakStyle` | `enum('compact','classic')` optional | `'compact'` | |
| `showSessionId` | boolean optional | `false` | |
| `hideOfficialBalance` | boolean optional | `false` | |
| `hideTodayCost` | boolean optional | `false` | |
| `showTotalWithPlan` | boolean optional | `false` | |
| `includeSubagentCost` | boolean optional | `false` | |
| `codexQuotaEnabled` | boolean optional | `false` | |
| `sidebarSimple` / `sidebarSimplePromptSeen` | boolean optional | `false`/`false` | |
| `sidebarModels` | `.strict()` object optional: `enabled:bool, period:'today'\|'history', topN:int 1–10, summary:'total'\|'top', position:'first'\|'afterBalance'\|'last', defaultOpen:bool, remember:bool, tokens:bool, shares:bool, refreshSeconds:int 10–60, dock:bool` | `{enabled:false,period:'today',topN:5,summary:'total',position:'last',defaultOpen:false,remember:true,tokens:false,shares:true,refreshSeconds:60,dock:false}` | |
| `sidebarStyle` | `enum('standard','compact')` optional | `'standard'` | |
| `priceMatch` | `enum('auto','exact')` optional | `'auto'` | |
| `priceMatchDismissed` | `string[]` optional | `[]` | |
| `priceOverrides` | `record(string,string)` optional | `{}` | `'provider:model' → 'provider:model'` |
| `priceTableDisplay` | `record(string,boolean)` optional | `{}` | |
| `prices` | object: `currency?: enum('USD','CNY')`, `models: record(model→price)`, `default: price`, `providers?: record(provider→{models:record(model→price)})` | DeepSeek default table + provider table (`DEFAULT_PRICE_TABLE`, `DEFAULT_PROVIDER_PRICE_TABLE`) | price = `{cacheHit,cacheMiss,cacheWrite?,longContext?,output,reasoning?,billingMode?('flat'\|'deepseek-peak'\|'batch'),offPeak?,peak?,legacy?,legacyBase?,rateHistory?≤16,sourceUrl?,checkedAt?,notes?}` (`typert.host.js:106-122`) |
| `budget` | object `{enabled:bool, amount:num, period:enum('day','month','all','custom'), customStart:string\|null, customEnd:string\|null, detail:bool}` | `{false,100,'month',null,null,true}` | |
| `codingPlans` | `record(providerId, {enabled?,display?,refreshMinutes?,apiKey?,baseUrl?,planCredits?,planStart?,quotaSource?('local'\|'cli'),rates?,accessKeyId?,secretAccessKey?,keyConfigured?,keySource?})` | per §2.3 | |
| `balance` | object `{display:enum('sidebar','settings','both','off'), refreshMinutes:num, showProgressBar?:bool, budgetCap?:num\|null, reconcile?:bool, clickHintSeen?:bool}` | `{display:'both',refreshMinutes:5,showProgressBar:false,budgetCap:null,reconcile:true,clickHintSeen:false}` | |
| `goQuota` | object `{enabled:bool, display:enum(...), refreshMinutes:num, apiKey:str, main:enum('rolling','weekly','monthly'), detail:bool, keyConfigured?, keySource?}` | `{enabled:true,display:'both',refreshMinutes:15,apiKey:'',main:'rolling',detail:true}` | |
| `customBalance` (legacy single) | optional object `{adapter?('custom'\|'aliyun'), enabled, label, labelEn?, display, unit?('USD'\|'CNY'\|'EUR'\|'CREDITS'), refreshMinutes, request:{url,method?,headers?,body?}, extract:record(string,unknown), allowedHosts?}` | `{enabled:false,label:'',labelEn:'',display:'both',unit:'USD',refreshMinutes:15,request:{url:'',method:'GET',headers:{}},extract:{remaining:{op:'subtract',paths:['info.max_budget','info.spend']},maxBudget:'info.max_budget',spend:'info.spend',unit:'USD'}}` | mirror of `customBalances[0]` |
| `customBalances` | optional array of the same shape | `[]` | v1.7.0 canonical form |
| `gatewayQuotas` | optional `{sources: array({id:string, type:'cliproxyapi', label, baseURL, enabled, display, refreshMinutes, includeProviders:string[], allowedHosts:string[], allowInsecureHttp:bool, antigravityOnlyGemini?:bool, keyVar?:string})}` | `{sources: []}` | `keyVar` derived, never stored |
| `corner` | `{enabled, goRolling, goWeekly, goMonthly, budget}` all bool | `{false,true,true,true,true}` | |
| `quotaStrip` | `{enabled, budget, go, plans, promptSeen}` all bool | `{false,true,true,true,false}` | |
| `barDirections` | optional `{balance,budget,go,plan: enum('remaining','used')}` | `{balance:'remaining',budget:'used',go:'used',plan:'used'}` | |
| `usage` | optional `{position: enum('cost','general','section')}` | `{position:'cost'}` | client flag `ze=false` keeps it pinned to `cost` |
| `planBilling` | optional `{providers: record(provider→enum('auto','plan','api')), models: record('provider:model'→enum('plan','api'))}` | `providers: DEFAULT_PLAN_PROVIDER_CLASS` (`plan-billing.js:38-50`; openrouter/siliconflow `'api'`, rest `'auto'`), `models: {}` | |
| `historyDays` | number | `180` (`DEFAULT_HISTORY_DAYS`, `store.js:31`) | retention 7–3650 (`store.js:2121`) |
| `fetchedAt` | `string\|null` | `null` | last official price sync |
| `priceSource` | string | `'bundled'` | `bundled\|official` |

`configSchema` is **not** `.strict()`, so unknown keys are stripped rather than
rejected at the wire codec level; rejection happens earlier in `applyConfigPatch`
against `CONFIG_KEYS`.

### 2.3 Per-provider `codingPlans` defaults (`store.js:171-188`)

| id | default entry |
|---|---|
| `anthropic` | `{enabled:false, display:'settings', refreshMinutes:15, apiKey:''}` |
| `zai` | same |
| `minimax` | same but `display:'both'`, plus `baseUrl:''` |
| `kimi`, `openrouter`, `siliconflow`, `commandcode` | same as anthropic |
| `scnet` | plus `planCredits:240000, planStart:''` (no credentials) |
| `qwen` | plus `quotaSource:'local', planCredits:500000, planStart:'', rates:{}` |
| `volcengine` | plus `accessKeyId:'', secretAccessKey:''` |

### 2.4 Where settings are persisted

**Not in `~/.dsh/settings.yaml`.** Verified: `cat /Volumes/M2ExHome/rockman/.dsh/settings.yaml`
contains sections `ui-onboarding`, `agent-default-model`, `dsh-better-sidebar`,
`ui-tweaks`, `ui-font`, `locale`, `subagent-model-selection`, `llm-pi-ai` — **no
`dsh-cost-meter` key**.

Config is persisted **inside the plugin's own ledger**:

- Path: `join(resolveDshHome(), 'storages', 'cost-meter', 'ledger.json')`
  (`store.js:1940-1941`), i.e. `~/.dsh/storages/cost-meter/ledger.json`.
- Top-level YAML/JSON key: **`config`** — written by `flush()` at `store.js:2143-2153`
  as `{ version, config: stripSecrets(this.config), days, balanceRef, migrations, planSamples, planHourBuckets }`.
- Verified on disk: `ledger.json` top-level keys are
  `["version","config","days","balanceRef","migrations","planSamples","planHourBuckets"]`,
  with `config.locale = "auto"`, `config.goQuota.enabled = false`, etc.
- Writes are debounced 2,000 ms (`scheduleWrite`, `store.js:2126-2133`) and atomic
  (`writeFileSync(path.tmp)` + `renameSync`, `store.js:2142-2154`).
- Secrets are **never** written: `stripSecrets(this.config)` (`store.js:2147`);
  canonical credential names in `SECRET_REF_MAP` (`store.js:1723-1734`):
  `goQuota→OPENCODE_GO_API_KEY`, `codingPlans.anthropic→ANTHROPIC_OAUTH_TOKEN`,
  `zai→ZAI_API_KEY`, `minimax→MINIMAX_API_KEY`, `kimi→KIMI_CODING_API_KEY`,
  `openrouter→OPENROUTER_API_KEY`, `siliconflow→SILICONFLOW_API_KEY`,
  `commandcode→COMMANDCODE_API_KEY`, `volcengine.ak→VOLC_ACCESSKEY`,
  `volcengine.sk→VOLC_SECRETKEY`.
- DSH credential store file: `~/.dsh/.credentials.yaml` (structure `version:`,
  `records:` keyed by ref name, `refs:`; verified `DEEPSEEK_API_KEY` present as a ref).

### 2.5 Why the settings UI is not localized to Chinese — evidence

The plugin **does** ship a full zh/en i18n table; the gap is in language *selection*
and in a handful of never-keyed literals:

1. **i18n exists.** Host messages: `SERVER_MESSAGES = { zh: {...}, en: {...} }`
   (`index.js:40` onwards; e.g. `index.js:47` zh `balanceNoInfos`,
   `index.js:115` en). Client messages: `Te = { zh: {...}, en: {...} }` with
   `zh.sectionLabel: "费用"` and `en.sectionLabel: "Cost"` (client bundle, char
   offsets ~50,311 and ~79,949). The settings section label is explicitly localized:
   `label: C==="en" ? Te.en.sectionLabel : Te.zh.sectionLabel` (client bundle,
   offset ~249,689).
2. **`'auto'` resolves only from `navigator.language`, ignoring DSH's own locale.**
   The bundle contains exactly:
   `function Pa(){return(typeof navigator<"u"&&typeof navigator.language=="string"?navigator.language:"").toLowerCase().startsWith("zh")?"zh":"en"}`
   and `function _(t){return t==="zh"||t==="en"?t:Pa()}` (client bundle, offset ~79,949).
   There is **no read of DSH's `locale.preference`** (grep: zero occurrences of
   `preference` / `localePreference`).
3. **The persisted value is `'auto'`** — verified `ledger.json` → `config.locale = "auto"` —
   while `~/.dsh/settings.yaml` has `locale: { preference: en }`. So on a browser whose
   `navigator.language` is English, the entire plugin UI (including the settings
   section) renders in English even though a Chinese DSH locale is configured. This is
   the concrete reason, not missing translations.
4. **A few literals are hardcoded English, never routed through the i18n table**
   (all in `lib/client.js`): `M.label||"package"` and `(M.remaining??"—")+" remaining"`
   in the gateway credit rows (offset ~211,755); unit `<option>` texts `"USD ($)"`,
   `"CREDITS"`; method options `"GET"` / `"POST"`; placeholders
   `"https://example.com/key/info"`, `"api.example.com, relay.example.org"`, `"sk-…"`;
   and the literal `"OpenCode Go"` label returned by the window-label helper
   (offset ~193,651). Provider labels from `CODING_PLAN_PROVIDERS` are bilingual
   strings in the host table (e.g. `'Z.ai / 智谱 GLM Coding Plan'`, `coding-plans.js:43`).

So for the rewrite: i18n must be wired to something (DSH locale preference or config),
and any dynamic/derived labels need keys instead of literals.

---

## 3. Data acquisition

### 3.1 External HTTP endpoints (verbatim)

| Owner | Method + URL | Auth | Notes |
|---|---|---|---|
| DeepSeek balance | `GET {base}/user/balance` (`index.js:919`) | `authorization: Bearer <key>` (`index.js:961`) | `base` = settings `llm-deepseek.baseURL` → env `DEEPSEEK_BASE_URL` → `https://api.deepseek.com`; trailing `/vN` stripped; **host must be `api.deepseek.com` else refused** (`index.js:911-920`). `timeoutMs: 15000` (`index.js:962`). |
| DeepSeek price sync | `GET https://api-docs.deepseek.com/quick_start/pricing` and `.../zh-cn/quick_start/pricing` (`pricing.js:41-44`) | none | HTML scrape: `fetchPricingHtml` → `parsePricingHtml` (`index.js:2125-2128`) |
| OpenCode Go quota | `GET https://opencode.ai/zen/go/v1/usage` (`index.js:660`) | `authorization: Bearer <key>`, plus a Chrome `user-agent` to bypass Cloudflare error 1010 (`index.js:771-777`) | `timeoutMs: 15000`; 401/403 → soft “no subscription” |
| anthropic plan | `GET https://api.anthropic.com/api/oauth/usage` (`coding-plans.js:965`) | `authorization: Bearer <token>`, UA `dsh-cost-meter/1.4 (DeepSeek Harness plugin)` (`coding-plans.js:1193-1196`) | |
| zai plan | in order (`coding-plans.js:966-976`): `https://open.bigmodel.cn/api/monitor/usage/quota/limit`, `https://api.z.ai/api/monitor/usage/quota/limit`, `https://api.z.ai/api/coding/paas/v3/dashboard/billing/coding_plan/usage`, `https://open.bigmodel.cn/api/coding/paas/v3/dashboard/billing/coding_plan/usage`, `https://api.z.ai/api/coding/paas/v4/dashboard/billing/coding_plan/usage`, `https://open.bigmodel.cn/api/coding/paas/v4/dashboard/billing/coding_plan/usage` | Bearer | 401 → try next domain (CN/Intl keys differ) |
| minimax plan | `https://www.minimax.cn/v1/token_plan/remains`, `https://www.minimax.io/v1/token_plan/remains`, `https://www.minimaxi.com/v1/token_plan/remains`, `https://www.minimax.cn/v1/api/openplatform/coding_plan/remains`, `https://www.minimaxi.com/v1/api/openplatform/coding_plan/remains` (`coding-plans.js:977-983`) | Bearer | `baseUrl` override → only `origin + /v1/token_plan/remains` and `origin + /v1/api/openplatform/coding_plan/remains` (`coding-plans.js:1028-1032`); only provider using `readJsonBounded` + `redirect:'error'` (`coding-plans.js:1203,1225`) |
| kimi plan | `https://api.kimi.com/coding/v1/usages`, `https://api.kimi.com/coding/v1/usage`, `https://api.moonshot.cn/v1/users/me/balance` (`coding-plans.js:984-991`) | Bearer; UA forced to `KimiCLI/1.6` for `api.kimi.com` (`coding-plans.js:1199`) | subscription endpoint then PAYG balance fallback |
| openrouter | `GET https://openrouter.ai/api/v1/credits` (`coding-plans.js:992`) | Bearer | |
| siliconflow | `GET https://api.siliconflow.cn/v1/user/info` (`coding-plans.js:993`) | Bearer | |
| commandcode | `GET https://api.commandcode.ai/alpha/billing/credits` (`coding-plans.js:994`) | Bearer | |
| volcengine plan | `GET https://open.volcengineapi.com/?Action=<A>&Version=2024-01-01`, `A ∈ {GetCodingPlanUsage, GetAFPUsage, GetUsageDetails, GetPersonalPlan}` (`coding-plans.js:517-527`, `1000`, `1126`) | AK/SK HMAC-SHA256 (`x-date`, `x-content-sha256`, `authorization`); service `ark`, region `cn-beijing` | signature recipe below |
| scnet plan | **none** (`coding-plans.js:996`) | — | local credits estimate; optional snapshot file `scnet_official.json` beside the ledger |
| qwen plan | **none** (`coding-plans.js:997-998`) | — | local estimate, or spawns the official `qianwen` CLI (`qwen-cli.js`) |
| CLIProxyAPI gateway | `GET {baseURL}/v0/management/auth-files`, `POST {baseURL}/v0/management/api-call`, `GET {baseURL}/v0/management/plugins/workbuddy/credits` (`gateway-quotas.js:20-25`, `182-184`) | header `X-Management-Key: <key>` (`gateway-quotas.js:256,276,442`) | api-call body `{auth_index, method, url, header, data?}`; adapter auth headers contain the literal `$TOKEN$` placeholder substituted by CPA; `redirect:'manual'`; version from `x-cpa-version` |
| gateway → upstream (via CPA api-call) | antigravity: `https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary`, `https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:retrieveUserQuotaSummary`, `https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary` (`gateway-quota-adapters.js:154-158`); claude: `https://api.anthropic.com/api/oauth/usage` (`:168`); codex: `https://chatgpt.com/backend-api/wham/usage` (`:176`); kimi: `https://api.kimi.com/coding/v1/usages` (`:192`); xai: `https://cli-chat-proxy.grok.com/v1/billing?format=credits` and `https://cli-chat-proxy.grok.com/v1/billing` (`:198-199`) | `Authorization: Bearer $TOKEN$` + per-provider extra headers (`anthropic-beta: oauth-2025-04-20`, `Chatgpt-Account-Id`, `x-xai-token-auth`, …) | |
| custom balance | any user URL (`customBalance(s)[i].request.url`) | arbitrary user headers with `{{VAR}}` credential placeholders | HTTPS required, or `http` only to loopback; allowlist enforced when credentials are present (`custom-balance.js:175-203`) |
| aliyun balance | `POST https://business.aliyuncs.com/` (`aliyun-balance.js:8`) | AK/SK ACS3-HMAC-SHA256, action `GetFundAccountAvailableAmount`, version `2023-09-30` | |

### 3.2 Request/response shapes (key ones)

- **DeepSeek balance** — request: `GET`, header `authorization: Bearer <key>`.
  Response read: `data.balance_infos[]` with `currency`, `total_balance`,
  `granted_balance`, `topped_up_balance` (`index.js:966-977`). Selection rule
  `pickBalanceInfo` (`store.js:2349-2354`): prefer entries with `total_balance > 0`,
  then CNY, then first. Normalized to
  `{currency, totalBalance, grantedBalance, toppedUpBalance}`.
- **OpenCode Go** — response `data.usage.{rolling,weekly,monthly}` each normalized by
  `normalizeGoWindow` to `{percent:number, resetsAt:string}` (`index.js:746-751, 789-793`).
- **Coding plans** — canonical `windows = { [name]: { percent: 0–100, resetsAt: ISO } }`
  (`coding-plans.js:7`) plus text-only windows `{resetsAt:'', text}`. Representative
  field paths: anthropic `five_hour.utilization` / `.resets_at` (`coding-plans.js:142-156`);
  zai `data.limits[].percentage|currentValue` + `unit` 3→5h / 6→week
  (`coding-plans.js:186-196`); minimax `model_remains[].current_interval_remaining_percent`
  / `current_weekly_remaining_percent` (`coding-plans.js:276-300`); kimi
  `usage.limit|used|remaining|resetTime` and `limits[].window.duration|timeUnit`
  (`coding-plans.js:417-452`); openrouter `total_credits` / `total_usage`
  (`coding-plans.js:462-469`); commandcode `windowLimits.<name>.used|cap|resetAt`
  (`coding-plans.js:493-503`); volcengine `Result.QuotaUsage[].Level|Percent|ResetTimestamp`
  (`coding-plans.js:675-690`).
- **Gateway** — auth-files response accepts a top-level array or the first array-valued
  key of `['auth_files','authFiles','files','accounts','data']` (`gateway-quotas.js:315-320`);
  api-call wraps an inner envelope `{status_code:int, body:string}` (`gateway-quotas.js:405-412`);
  normalized source result: `{id,type,label,status,message,fetchedAt,attemptedAt,serverVersion,keyConfigured,keySource,accounts,unsupportedProviders}`
  with per-account `{id,provider,label,status,message,windows[],plan?,credits?}`
  (`gateway-quotas.js:391-403, 555-571, 608-616`).

### 3.3 Auth / credential lookup order

Order is uniform: **DSH credentials store → environment variable → CLI login file →
legacy plaintext in config (now emptied on disk)**.

1. DeepSeek key: `credentialRef(apiKeyEnv)` resolved via `ctx.get('credentials').resolve(...)`,
   else `process.env[apiKeyEnv]`, where `apiKeyEnv` = `settings.get('llm-deepseek').apiKeyEnv`
   or `DEEPSEEK_API_KEY` (`index.js:930-946`).
2. Coding plan key (`resolveCodingPlanKey`, `index.js:826-851`): for each env in
   `CODING_PLAN_PROVIDERS[id].credentialEnvs` (`coding-plans.js:36-98`): credentials
   store first, then env; then anthropic-only `~/.claude/.credentials.json`
   → `claudeAiOauth.accessToken` (`index.js:802-813`); then legacy
   `config.codingPlans[id].apiKey`.
3. Volcengine AK/SK (`resolveVolcengineKeys`, `index.js:858-908`): credentials store AKs
   then SKs, env AKs then SKs, config, and `"AK:SK"` colon split.
4. OpenCode Go (`goKeyRefs`/`resolveGoKey`, `index.js:692-743`): refs
   `{OPENCODE_GO_API_KEY, credentialRef(apiKeyEnv) for any `llm-pi-ai` route whose
   origin is `https://opencode.ai` and path `/zen/go/v1`, OPENCODE_API_KEY}`; per ref
   credentials then env; then `opencode auth.json` under
   `~/.local/share/opencode/auth.json`, `$XDG_CONFIG_HOME/opencode/auth.json`,
   `~/.config/opencode/auth.json` (key `data['opencode-go'].key`, `index.js:668-685`);
   then legacy config.
5. Gateway: `CLIPROXYAPI_MANAGEMENT_KEY_<ID>_<SHA8>` (`managementKeyVarOf`,
   `gateway-quotas.js:102-109`) → credentials store then env (`gateway-quotas.js:301-313`).
6. Custom balance: `{{VAR}}` placeholders → credentials store then env
   (`custom-balance.js:105-126`); Aliyun uses `ALIBABA_CLOUD_ACCESS_KEY_ID` /
   `_SECRET` / `_SECURITY_TOKEN` (`aliyun-balance.js:9-13`).

`credentialRef` is a branding/validation function from
`@deepseek-ai/dsh-credentials` requiring `/^[A-Za-z_][A-Za-z0-9_]*$/`; the plugin uses it
as the reference key for `credentials.resolve|describe|set|unset`.

### 3.4 Polling / refresh cadence, caching

Host (in-process caches; `createService`, `index.js:1284+`):

- Each `getState` RPC calls `ensure*()` for balance/Go/custom/coding-plan/gateway
  (`index.js:1858-1874`); the ensure functions re-fetch only when
  `Date.now() - cache.fetchedAt >= refreshMinutes*60_000`
  (`index.js:1371-1378` balance 5 min; `1442-1448` Go 15; `1527-1530` custom 15;
  `1658`/`1683` coding plans 15; `1738`/`1798` gateway 15). Explicit refresh RPCs
  call `ensure*(true)` to bypass the interval (`index.js:1928,1968,1988`).
- Soft errors (missing key, 401/403) cache `status:'off'`; hard errors keep the old
  `fetchedAt` so the next poll retries (`index.js:1760-1772`).
- Gateway caches are keyed per source with `lastGood` + `configFingerprint`
  (`index.js:1311-1338, 1859-1872`).

Client:

- A 1-second `setInterval`; each tick recomputes the target staleness as
  `config.sidebarModels?.enabled || config.sidebarModels?.dock ? refreshSeconds : 60`
  and calls `getState` when `Date.now() - lastLoad >= target*1000`
  (client bundle, offset ~245,221). So the poll is **60 s by default**, 10–60 s when
  sidebar models are on.
- Plus re-fetch on `connection/reset` (client bundle) and on
  `document.visibilitychange → visible`.
- Client-side `updateConfig` writes are debounced 600 ms (client bundle).

### 3.5 Caching and storage

- `~/.dsh/storages/cost-meter/ledger.json` — verified top-level keys and shapes:
  ```jsonc
  {
    "version": 1,
    "config": { /* full settings object, secrets stripped */ },
    "days": {
      "2026-09-20": {
        "date": "2026-09-20",
        "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "reasoning": 0,
        "calls": 0, "cost": 0, "apiCost": 0,
        "byProviderModel": { "deepseek:deepseek-chat": { "input":0,"output":0,"cacheRead":0,"cacheWrite":0,"reasoning":0,"calls":0,"cost":0,"apiCost":0 } },
        "sessions": [ /* {sessionId, provider, model, ...} capped at 200/day */ ]
      }
    },
    "balanceRef": { "date": "2026-09-20", "total": 66.28, "granted": 0, "topped": 66.28, "currency": "CNY", "at": 1789907648016 },
    "migrations": ["deepseek-september-2026-prices-v1", "secrets-to-credential-store-v1", "..."],
    "planSamples": { /* provider → window → [{t,p,lt,lc,r,s}] */ },
    "planHourBuckets": { /* provider → hour bucket token/cost sums */ }
  }
  ```
  Constants: `LEDGER_VERSION = 1` (`store.js:29`), `MAX_SESSIONS_PER_DAY = 200`
  (`store.js:30`), `DEFAULT_HISTORY_DAYS = 180` (`store.js:31`), atomic write +
  2 s debounce (`store.js:2126-2158`), `prune()` keeps `historyDays` (7–3650)
  day keys (`store.js:2120-2124`). Unsupported `version` or unparsable file is renamed
  `ledger.json.corrupt-<ts>` before starting empty (`store.js:1951-1954, 1991-1996`).
- `~/.dsh/storages/cost-meter/ledger.json.native-search/<sha256(sessionId)>.jsonl` —
  append-only native-search usage records (`native-search-history.js:9, 16-20`;
  directory exists on this machine with 2 files). Also an optional
  `scnet_official.json` snapshot next to the ledger (`index.js:1717`,
  `scnet-snapshot.js`, ≤16 KiB, ≤24 h old).
- Third data path (no HTTP): DSH native-search usage events observed on
  `node:diagnostics_channel` with event type `'cost-meter/native-search-usage'`
  (`native-search-events.js:2`, validated at `:4-11`), installed by
  `installNativeSearchBilling(ctx, ledger)` (`index.js:2919`).

### 3.6 Volcengine AK/SK signature (needed to reimplement)

`volcengineAuthorization` (`coding-plans.js:561-579`): HMAC-SHA256, service `ark`,
region `cn-beijing`, host `open.volcengineapi.com`, path `/`, `x-date` =
`YYYYMMDDTHHMMSSZ`, `x-content-sha256` = SHA-256 of the (empty) body,
`signedHeaders = 'host;x-content-sha256;x-date'`, canonical request =
`GET\n/\n<sorted query>\n<canonical headers>\n<signedHeaders>\n<bodySha>`,
credential scope `<date>/cn-beijing/ark/request`, `stringToSign` =
`HMAC-SHA256\n<x-date>\n<scope>\n<sha256(canonicalRequest)>`, field HMAC chain
`kDate→kRegion→kService→kSigning`, header
`Authorization: HMAC-SHA256 Credential=<AK>/<scope>, SignedHeaders=host;x-content-sha256;x-date, Signature=<hex>`.
Requests use `{timeoutMs: 15000, attempts: 2}` (`coding-plans.js:1126`).

### 3.7 Retry / timeout / bounding (`net.js`)

- `fetchWithRetry(url, init, {attempts=4, backoffMs=300, timeoutMs=0})`
  (`net.js:55-77`): retries only transient **network** errors (codes
  `ECONNRESET/ECONNREFUSED/ETIMEDOUT/ENOTFOUND/EHOSTUNREACH/ENETUNREACH/EPIPE/EAI_AGAIN/UND_ERR_*`,
  `TimeoutError`, `fetch failed` TypeError), backoff `min(1500, 300*2^(n-2))` →
  300/600/1200 ms, fresh `AbortSignal.timeout` per attempt; HTTP statuses are
  returned un-retried. Coding plans set `attempts: 2, timeoutMs: 15000`; DeepSeek
  balance and Go quota `timeoutMs: 15000`; gateway management `attempts: 2,
  timeoutMs: 15000` (30 s for api-call) with an outer retry over
  `{408,429,500,502,503,504}`.
- `readJsonBounded(response, maxBytes = 262144)` (`net.js:80-104`): rejects
  `content-length` over the cap, streams with a running byte count, throws
  `RESPONSE_TOO_LARGE`, invalid JSON → `response body is not valid JSON`. Used for
  minimax, custom balance, aliyun, gateway responses.

---

## 4. UI integration

### 4.1 Render stack

`lib/client.js` is a **client-plugin bundle** loaded as:

```js
window.__ModuleLoader__.load({ id: "dsh-cost-meter", factory: It => { ... } })
```

Inside the factory it requires exactly two modules:

- `const qe = It("react")`, then
  `const { createElement: e, Fragment: E, useState: R, useEffect: ee, useRef: we } = qe`
  — plain React, `React.createElement` (no JSX runtime in the bundle);
- `const { Tooltip: J } = It("@deepseek-ai/dsh-client-ui-primitives")`.

Styling is one large inlined CSS string (`Aa`, class prefix `.cm-`), using DSH CSS
variables such as `--dsh-chat-content-width`, `--dsh-composer-side-clearance`,
`--dsw-alias-*`. The plugin also has a 40-line local reactive store helper
`function on(t){...getSnapshot/subscribe/set...}` (bundle offset ~114,177) and a
hardcoded flag `ze = false` that disables the `usage.position` chooser (usage stays in
the Cost tab).

Static plugin exports at the end of the factory: `it.apply = Ss`, `it.inject = ["remote"]`.

### 4.2 Remote/RPC binding

```js
const s = t.remote;                       // plugin context's remote service
const o = await s.$mount(Ga);             // register the contribution; o() disposes
t.effect(() => () => { o() }, "cost-meter: remote contribution");
const api = t.get("remote.costMeter");    // typed proxy
```

`Ga` is the client-side descriptor table:
`{package:"dsh-cost-meter", descriptors:[{method:"getState",result:Codec}, …]}` with
methods (verbatim): `getState`, `updateConfig` (param `patch`), `fetchPrices`,
`refreshBalance`, `refreshGoQuota`, `refreshCustomBalance` (param `index`),
`refreshCodingPlan` (param `provider`), `refreshGatewayQuota` (param `sourceId`),
`resetHistory`, `importLegacyHistory`, `getDaySessions` (param `date`),
`getSessionCost` (param `sessionId`), `getTopSessions` (params `limit`,`sort`,`dir`),
`setCredential` (params `target`,`value`), `clearCredential` (param `target`).
Each is rewritten to `id: "dsh-cost-meter#costMeter/" + method`, `service:"costMeter"`,
`namespace:"costMeter"`, `invocation:{kind:"direct"}` — mirroring the host manifest
`TYPERT` (`typert.host.js:511+`).

### 4.3 Slot registration (verbatim slot names + API calls)

The client gets `const slots = t.get("slots")` and registers with a descriptor
`{ name, id, order, inject }` plus a component; `inject` is a function returning the
component props: `() => ({ hooks: { cost: store }, api })`. Registrations are
deferred through `slots.inject(slotName, cb)` and materialized by
`slots.register(descriptor, Component)` (whose return value is the disposer);
a helper re-registers with a bumped generation counter when config changes, and
disposes when the mount condition goes false.

Slots actually used:

| Slot (verbatim) | id | order | Rendered when |
|---|---|---|---|
| `"conversation.composer.dock"` | `"cost-meter"` | `5` | `position === 'dock'` — the per-session cost line **below the composer** |
| `"conversation.session.header.actions"` | `"cost-meter"` | `-5` | `position === 'header'` |
| `"conversation.composer.dock"` | `"cost-meter-corner"` | `9` | `corner.enabled` or `sidebarModels.dock` — corner chips |
| `"conversation.input.dock"` | `"cost-meter-qstrip"` | `5` | always injected; quota strip above the input |
| `"sidebar.footer.action"` | `"cost-meter"` | `0` | sidebar cost/balance shown |
| `"sidebar.footer.action"` | `"cost-meter-peak-alert"` | `0` | `peakEnabled` |
| `"sidebar.footer.action"` | `"cost-meter-simple-guide"` | `1` | always injected (onboarding) |
| `"sidebar.footer.action"` | `"cost-meter-qstrip-guide"` | `1` | always injected |
| `"sidebar.footer.action"` | `"cost-meter-balance-click-guide"` | `2` | always injected |
| `"settings.section"` | `"cost-meter"` | `30` | always; `label` localized (`Te.zh.sectionLabel` / `Te.en.sectionLabel`) |
| `"settings.section"` | `"cost-meter-usage"` | `31` | `usage.position === 'section'` |
| `"settings.general.item"` | `"cost-meter-usage"` | `30` | `usage.position === 'general'` |

Representative verbatim calls (de-minified):

```js
slots.register({ name: "conversation.input.dock", id: "cost-meter-qstrip", order: 5, inject: props }, Component)
slots.register({ name: "sidebar.footer.action", id: "cost-meter-simple-guide", order: 1, inject: props }, Component)
slots.register({ name: "settings.section", id: "cost-meter", order: 30, label: localizedLabel, inject: props }, Component)
slots.register({ name: "settings.general.item", id: "cost-meter-usage", order: 30, inject: props }, Component)
// dynamic ones (position/sidebar/corner/peak) are wrapped:
slots.inject(slotName, () => slots.register(descriptor, Component))
```

There is also a global preview hook:
`window.cmPeakAlertPreview = kind => { ... window.dispatchEvent(new CustomEvent(Nt, {detail:{kind}})) }`
and a flag `window.__cmPeakAlertLive`.

**No message-level ("below a message") slot is used** — the closest thing to
"below the conversation" is `conversation.composer.dock` / `conversation.input.dock`.

### 4.4 Subscription to end-of-turn / turn-finished events

**It does not subscribe to turn events.** Verified by exhaustive search of the bundle:

- Client events subscribed: exactly one — `t.on("connection/reset", () => reload())`.
- Plus `document.addEventListener("visibilitychange", …)` and the 1 s polling
  interval described in §3.4. Zero occurrences of `turn/`, `message/`, `session/`,
  `agent/`, `conversation/`, `/finished`, `turnFinished`, or `onTurnEnd` in the bundle.
- On the host, accounting is triggered by the **LLM stream waterfall**, not a turn
  boundary: `ctx.on('llm/stream', createLlmStreamBilling({ account(...) {...} }), { global: true })`
  (`index.js:2902-2921`). Each completed model call feeds
  `ledger.account(buckets, model, sessionId, atMs, provider)` with buckets
  `{input, output, cacheRead, cacheWrite, reasoning}`; `createUsageDeduper()`
  prevents double counting of wrapped routes.
- The client learns about new usage only by polling `getState` (default every 60 s)
  or when `connection/reset` / tab-visibility fires.

---

## 5. 5h / 7d quota and usage-percentage logic

### 5.1 Real server-side 5h/7d windows

| Source | API | 5h window field | 7d (weekly) field |
|---|---|---|---|
| Anthropic plan | `GET https://api.anthropic.com/api/oauth/usage` | key `five_hour` → `.utilization` (0–100), `.resets_at` | key `seven_day` → same fields; sub-scopes (`seven_day_sonnet`, …) dropped (`coding-plans.js:151`) |
| Z.ai / GLM | monitor/billing endpoints | `limits[]` with `unit === 3` | `unit === 6`; or `plans[].period_end` span > 24 h → `weekly` (`coding-plans.js:195-196, 231`) |
| MiniMax | `…/v1/token_plan/remains` | `current_interval_remaining_percent` (+ `current_interval_status`, `end_time`) → key `5h` (`coding-plans.js:268-285`) | `current_weekly_remaining_percent` (+ `current_weekly_status`, `weekly_end_time`) → key `7d` (`coding-plans.js:289-300`) |
| Kimi (subscription) | `https://api.kimi.com/coding/v1/usages` | `limits[]` with `window.duration` ≈ 5 h / `timeUnit` (→ label like `5h`) | top-level `usage.limit/used/remaining/resetTime` → `weekly` (`coding-plans.js:421-429`) |
| CommandCode | `https://api.commandcode.ai/alpha/billing/credits` | `windowLimits.fiveHour.{used,cap,resetAt}` | `windowLimits.weekly.{used,cap,resetAt}` (`coding-plans.js:497-503`) |
| Volcano Ark | `open.volcengineapi.com` actions | `Result.QuotaUsage[].Level === 'session'` + `Percent`/`ResetTimestamp` | `Level === 'weekly'`; also `monthly` (`coding-plans.js:675-690`) |
| OpenCode Go | `https://opencode.ai/zen/go/v1/usage` | `usage.rolling` (rolling **5 hours**) | `usage.weekly`; also `usage.monthly` (`index.js:754-793`) |
| Gateway antigravity | Cloud Code `retrieveUserQuotaSummary` | bucket window `5h`/`five-hour`/`five_hour` → `{id:'five-hour', periodHours:5}` | `weekly`/`week` → `{id:'weekly', periodHours:168}` (`gateway-quota-adapters.js:246-255`) |
| Gateway claude | `api.anthropic.com/api/oauth/usage` | `five_hour` (`claudePeriodHours` → 5) | `seven_day*` (→ 168) (`gateway-quota-adapters.js:325-338`) |
| Gateway codex | `chatgpt.com/backend-api/wham/usage` | window seconds exactly `18000` → `five-hour` | exactly `604800` → `weekly`; 28–31 d → `monthly` (`gateway-quota-adapters.js:415-426`) |
| Gateway kimi | `api.kimi.com/coding/v1/usages` | `window.duration/`timeUnit`` → 5 | `usage{}` extra row labeled `周限额 Weekly limit` (`gateway-quota-adapters.js:530-548, 611-614`) |
| Gateway xai | `cli-chat-proxy.grok.com/v1/billing` | — (billing period only) | `billing-weekly` / `billing-monthly` from `creditUsagePercent`, `currentPeriod` (`gateway-quota-adapters.js:720-736`) |

Percent semantics: coding plans normalize to **used 0–100** (`normalizePercent`
treats 0–1 as a fraction and ≥1 as a percentage, clamped, one decimal —
`coding-plans.js:103-108`); gateway adapters always emit **used** percent via
`clampPct` (`gateway-quota-adapters.js:85-89`).

### 5.2 Locally estimated (no 5h/7d from API)

- **SCNet Token Plan** — no endpoint (`coding-plans.js:996`); `scnetTokenPlanWindows`
  computes monthly credits from local token usage × `SCNET_CREDIT_RATES`
  (`coding-plans.js:737-877`), returning `{used,total,percent,resetsAt,byModel,windows}`
  with `windows.monthly` and a text `windows.credits`. Period from `scnetPlanPeriod`
  (natural month, or `planStart` day-of-month) (`coding-plans.js:777-828`).
- **Qwen Token Plan** — `qwenTokenPlanWindows` (same shape, monthly only,
  `coding-plans.js:920-961`), or `quotaSource:'cli'` which parses the `qianwen` CLI
  summary (`qwen-cli.js:33-61`).
- **OpenRouter / SiliconFlow / Kimi-PAYG** — text balance windows only, no period.

### 5.3 Window-name normalization and the “per 1% / full window” estimate

- `canonicalWindowKey(name)` (`plan-billing.js:155-176`): `5h|five|rolling` →
  `fiveHour`; `week|seven_?day|7d` → `weekly`; `month` → `monthly`; `daily|^day$` →
  `daily`; else duration tokens `(\d+)(h|d|w|mo|m)` bucketed by hour magnitude
  (≤6 → fiveHour, ≤36 → daily, ≤336 → weekly, else monthly).
- `periodStartOf(windowKey, nowMs, fixedStartMs)` (`plan-billing.js:185-204`):
  `fiveHour` = now − 5 h (rolling); `weekly` = **local Monday 00:00** (computed via
  date arithmetic to avoid DST drift); `monthly` = 1st 00:00 local; `daily` = today
  00:00; unknown = now − 48 h (`HOUR_BUCKET_RETENTION_MS`).
- On every successful quota refresh the host records samples
  `{t, p, lt, lc, r, s}` per provider×window (`recordSamples` via `index.js:1353-1368`)
  and derives per-1% and full-window token/cost estimates by differencing adjacent
  samples (`plan-billing.js` header lines 1-20; `PLAN_PER1_CONFIDENT_DELTA_P = 5`
  at `plan-billing.js:56`), shown in the “用量” tab (`planStats`).
- Local window aggregation `aggregateUsageSince` intersects `[start, now]` with day
  ledger entries plus provider×hour buckets (`plan-billing.js:222-234`).

---

## 6. Concrete DSH APIs / imports it depends on (verbatim specifiers)

### 6.1 External packages (only two)

```js
import { credentialRef } from '@deepseek-ai/dsh-credentials'
```
`index.js:20`, `custom-balance.js:5`, `gateway-quotas.js:11`, `aliyun-balance.js:3`;
also `peerDependencies` entry. Used with a `credentials` service:
`credentials.resolve(credentialRef(name))`, `credentials.describe(credentialRef(name))`,
`credentials.set(credentialRef(target), value)`, `credentials.unset(credentialRef(target))`
(e.g. `index.js:730, 1046, 2054, 2097`).

```js
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
```
`index.js:21`, `store.js:10`, `repair-sessions-cli.js:7`. Drives
`join(resolveDshHome(), 'storages', 'cost-meter', 'ledger.json')` and
`join(resolveDshHome(), 'sessions')`.

Everything else imported is either `node:*` builtins or the package's own relative
modules. Third-party modules bundled by the client bundle:
`"react"` and `"@deepseek-ai/dsh-client-ui-primitives"` (via the module loader).
Runtime dependency `zod` (`import { z } from 'zod'`, `index.js:16`, `typert.host.js:7`).

### 6.2 Host plugin context API (`ctx.*`)

| Call | Location |
|---|---|
| `export const name = 'cost-meter'` | `index.js:38` |
| `export function apply(ctx)` | `index.js:2852` |
| `ctx.effect(() => () => ledger.close(), 'cost-meter: ledger close')` | `index.js:2860` |
| `ctx.effect(() => () => clearTimeout(backfillTimer), …)` | `index.js:2885` |
| `ctx.effect(() => () => {…}, 'cost-meter: quota query cancellation')` | `index.js:1291` |
| `ctx.on('llm/stream', handler, { global: true })` | `index.js:2902-2921` |
| `ctx.inject(['sessionProjections'], projectionCtx => { projectionCtx.sessionProjections.register(makeCostUsageProjection(ledger)) })` | `index.js:2922-2924` |
| `ctx.provide('costMeter', createService(ctx, ledger))` | `index.js:2927` |
| `ctx.get('credentials')` | `index.js:726, 830, 862, 937, 1341`; `custom-balance.js:111`; `gateway-quotas.js:306`; `aliyun-balance.js:74` |
| `ctx.get('settings').get('llm-deepseek')` | `index.js:930-931` |
| `ctx.get('settings').get('llm-pi-ai').providers` | `index.js:695` |

Session-projection descriptor contract (`index.js:370-641`): keys
`key: 'costUsage'`, `schema`, `stateSchema`, `stateVersion: 10`,
`init(header, inheritedEventCount)`, `apply(state, event)`, `view: projectionView`,
`wire: { viewSchema, view }`. The source comments note `wire` and `stateSchema` are
required from DSH 0.1.1-rc.1 (a projection without `wire` is skipped by
snapshot/onChanged/refold; `restore()` calls `stateSchema.parse` without try/catch).

Typert RPC manifest (`typert.host.js:511-803`): `{ package: 'dsh-cost-meter',
face: 'host', schemas: [], invocations: [...] }`, consumed by DSH's typert-loader via
the package export `./typert`; each invocation uses
`invocation: { kind: 'direct' }` and a `strictCodec(name, schema)` =
`{ mode: 'strict', typeSymbol: 'dsh-cost-meter#'+name, schema, create: () => schema }`.

### 6.3 Client-plugin API (browser)

| API | Evidence |
|---|---|
| `window.__ModuleLoader__.load({ id: "dsh-cost-meter", factory })` | client bundle line 2 |
| `It("react")`, `It("@deepseek-ai/dsh-client-ui-primitives")` | client bundle (factory preamble) |
| `const slots = t.get("slots")` | client bundle offset ~247,831 |
| `slots.register({ name, id, order, inject }, Component)` | client bundle offsets ~248,000+ |
| `slots.inject(slotName, cb)` | client bundle |
| `await t.remote.$mount(contribution)` (returns disposer) | client bundle offset ~245,095 |
| `t.get("remote.costMeter")` | client bundle offset ~245,221 |
| `t.effect(fn, "cost-meter: …")` (×4) | client bundle |
| `t.on("connection/reset", cb)` | client bundle |
| `t.state.subscribe(fn)` / `getSnapshot()` / `set()` local store helper `on()` | client bundle offset ~114,177 |
| static `it.inject = ["remote"]`, `it.apply = Ss` | client bundle tail |

### 6.4 Node builtins used by the host

`node:fs`, `node:fs/promises`, `node:path`, `node:crypto`, `node:zlib`,
`node:async_hooks` (`AsyncLocalStorage`), `node:diagnostics_channel`,
`node:string_decoder`, `node:child_process` (`execFile`), `node:util` (`parseArgs`),
`node:module` (`createRequire`), `node:url` (`pathToFileURL`).

---

## 7. Notes for the simplified rewrite (facts, not recommendations)

- Absolute minimum DSH surface for a functional replacement: the Cordis plugin
  contract (`name` + `apply(ctx)`), `ctx.on('llm/stream', …, {global:true})` for
  per-call usage, `ctx.provide(service)` + a typert manifest for RPC, `ctx.get('credentials')`
  + `credentialRef` for secrets, `resolveDshHome` for storage, and on the client side
  `remote.$mount` + `slots.register` on `conversation.composer.dock` /
  `settings.section`.
- The accounting trigger is the LLM stream, **not** a turn boundary; the UI updates by
  polling (`getState`), not by an event stream.
- The settings surface is entirely plugin-owned (own zod schema, own React form, own
  RPC write into `ledger.json.config`); DSH's settings store is read-only for this
  plugin.
- Known unknowns / unverified items:
  - Which host component substitutes the gateway adapters' literal `$TOKEN$` is
    outside the analyzed files (per `gateway-quota-adapters.js:151` the CPA host does).
  - Exact Z.ai `plans` and Kimi coding response shapes are best-effort per the source
    comments (`coding-plans.js:15-17, 168-170, 414-415`) — treat as inferred.
  - No exported DSH API type definitions were inspected; API names above are quoted
    from this plugin's call sites, not from DSH source.
  - Behavioral verification was static (reading files); nothing was executed.
