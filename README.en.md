# dsh-usage-state

See your **account balance** or **coding-plan quota** at a glance in [DSH (DeepSeek Harness)](https://github.com/deepseek-ai) — right under the composer and under every completed turn.

> 中文说明见 [README.md](README.md)。

```
below the composer stats:   z.ai / GLM · 5h 12% (4h0m) ▓▓▓░░░░░ · 7d 59% (3d17h) ▓▓▓▓▓░░░
                             DeepSeek · ¥58.13
hover any segment:           Source DeepSeek · Mode API balance · Granted 0 · Topped up 58.13
```

## Features

- **Works with zero configuration**: the plugin figures out which data source and mode a provider needs, and reuses the API key DSH already has.
- **Configured per provider, not per model** — readings are account-level, so each provider gets one setting: `Auto` / `API` / `Coding Plan` / `Hidden`. The model list is informational.
- **Two render sites**: directly below the composer's stats row, and under every completed turn.
- **Never invents data**: a failed refresh keeps the last good value and marks it stale (`12m ago ⚠`); rejected keys, endpoint errors and network problems each get a readable reason.
- **Hover details**: source and mode, the window's absolute reset time, the granted/topped-up split of a balance, the failure reason with the provider's own message.
- **Bilingual** (zh / en), following the DSH locale setting.
- **Display only**: no cost accounting, pricing catalog, history, budgets or peak/off-peak alerts.

## Install

```bash
dsh plugin --profile web add github:takboo/dsh-usage-state
```

Then **restart DSH** (the plugin's bundle patch is read at startup). To remove:

```bash
dsh plugin --profile web remove dsh-usage-state
```

For development, a local path works too: `dsh plugin --profile web add /path/to/dsh-usage-state`.

## Quick start

1. Open **Settings → Usage state**: one row per provider configured in DSH.
2. Leave it on **Auto** (it detects the data source and its primary mode), or pick `API` / `Coding Plan` / `Hidden`; use ↑↓ to reorder.
3. The reading appears below the composer and under each turn.

If a source needs an endpoint or a key (a self-hosted Sub2API, or a provider without a credential yet), expand that row's **Advanced** block to override the source, set the endpoint, name the credential, or paste a key (written to the DSH credential store).

## Supported sources

| Source | API mode | Coding-plan mode | Credential |
|---|---|---|---|
| DeepSeek official | balance (CNY / USD) | — (no coding plan) | `DEEPSEEK_API_KEY` |
| z.ai / Zhipu GLM | — | 5h / 7d used % | `ZAI_API_KEY` and friends |
| Kimi (China) | Moonshot pay-as-you-go balance | Kimi Code subscription windows | `MOONSHOT_API_KEY` / `KIMI_CODING_API_KEY` |
| OpenCode Zen Go | — | 5h / 7d / 30d used % | `OPENCODE_GO_API_KEY` / `OPENCODE_API_KEY` |
| Sub2API (self-hosted) | balance / key quota | 5h / 7d from `rate_limits[]` | `SUB2API_API_KEY` + instance URL |

- **z.ai is regional**: a coding-plan key only works on its own region (`open.bigmodel.cn` for China, `api.z.ai` globally). China is the default; the other host is tried as a mirror, and you can pin an endpoint in the settings.
- **OpenCode Zen Go** reads `rolling` / `weekly` / `monthly` from `opencode.ai/zen/go/v1/usage`. Both DSH routes into the same account (built-in `opencode-go` and the custom `opencode-go-deepseek`) produce one reading and one request. A missing subscription or a rejected key is reported as an auth failure, never as 0%.
- Other vendors (Claude Pro/Max, MiniMax, OpenRouter, Codex, Antigravity, Volcengine Ark, …) are not implemented, but the adapter contract and a candidate list are ready: see [`docs/adapters.md`](docs/adapters.md).

## Display, refresh, credentials

- **Placement**: `conversation.composer.dock` (aligned with the native stats row) and `conversation.chat.turnTail` (under each completed turn).
- **Elements**: provider label · balance + currency · each window (5h / 7d / 30d) used % · reset countdown · mini progress bar · threshold colours (defaults: amber ≥80%, red ≥95%).
- **Semantics**: percentages are always *used*; balances only appear in API mode, and coding-plan mode shows the windows the source actually has (5h / 7d for z.ai and Sub2API, plus 30d for OpenCode Zen Go); a stale reading shows its age instead of hiding.
- **Refresh**: 2s after a turn ends, plus a 5-minute idle fallback; at most one real request per source per 60s, in-flight calls are shared, failures are not throttled.
- **Credentials**: override → the provider's declared `apiKeyEnv` → the source's built-in ref → DSH credential store. Keys are written to `~/.dsh/.credentials.yaml`; **this plugin never stores a plaintext key** and the browser never receives a key value.

## Compatibility

- Verified against DSH `0.1.5-rc.2`, Node ≥ 20.
- Distributed via GitHub; **not published to npm** (`private: true`).
- Version `0.2.2`: DeepSeek, z.ai and OpenCode Zen Go are verified against live accounts; see the limitations below.

## Limitations

- **Kimi and Sub2API are not verified against live accounts yet** (no credentials on the author's machine); their `/v1/usage` style endpoints are undocumented and parsed defensively.
- **The line under a completed turn shows the current value, not the value at that moment** — both sites read the same latest snapshot. Pinning a per-turn value (plus a delta since the previous turn) needs extra persistence; the approach is decided but not implemented.
- **Clicking the line does not open settings** (the platform exposes no public "open settings panel" service); details are in the hover tooltip.
- Full list: [`docs/implementation.md`](docs/implementation.md) §6.

## Development

```bash
npm install          # add --cache /tmp/npm-cache if ~/.npm is not writable
npm test             # node:test runs .ts / .tsx directly (needs Node >= 22.6)
npm run typecheck    # tsc --noEmit
npm run build        # tsdown → lib/ (host index.js + typert.js, browser client.js)
npm run watch        # rebuilds client.js only; client changes hot-reload, no page refresh
```

Host-side changes need a DSH restart; client-side changes do not. The `lib/` output is **committed on purpose**: `dsh plugin add github:...` installs straight from the repository with no build step, and `npm test` guards the bundle envelope, the require allow-list and the `exports` targets.

## Docs

| Document | Contents |
|---|---|
| [`docs/implementation.md`](docs/implementation.md) | Implementation and verification overview: code map, decision → code → test → verification traceability, open items |
| [`docs/adapters.md`](docs/adapters.md) | Adding a data source: contract, workflow, pitfalls, candidate vendors, troubleshooting |
| [`docs/design-consensus.md`](docs/design-consensus.md) | Design consensus and its revision log (Chinese) |
| [`docs/research/README.md`](docs/research/README.md) | Read-only research index (vendor APIs, the replaced plugin, DSH RPC contract) |

## License

[MIT](LICENSE)
