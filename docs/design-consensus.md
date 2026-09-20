# dsh-usage-state — 设计共识（Grilling 结论）

> 状态：设计共识已定稿（grilling 全部问题闭环），实现尚未开始。
> 日期：2026-09-20
> 事实依据：[`research/`](research/README.md) 下的只读侦察文档（是材料，不是共识）。

## 0. 一句话

一个只做「余额 / 额度显示」的 DSH 插件，替代 `dsh-cost-meter` 的展示需求，砍掉它全部的计费逻辑，设置页中英双语、模型清单自动发现、可排序。

## 1. 目标与非目标

**做**：读 DSH 已配置的模型 → 按序展示 → 为每个模型选「API 模式 / Coding Plan 模式 / 隐藏」→ 按模式显示余额或 5h/7d 已用百分比（含重置倒计时、阈值变色、迷你进度条）。

**不做**（成本插件的复杂度来源，全部砍掉）：会话成本统计、模型价格目录与自动匹配、历史账单、预算图框、峰谷计价与通知、native-search 计费、CLIProxyAPI/网关额度、SCNet/Qwen 本地估算、自定义余额端点、会话日志回填与修复 CLI。

## 2. 数据源（v1 实现 4 家）

| 数据源 | 模式 | 接口 | 说明 |
|---|---|---|---|
| DeepSeek 官方 | API | `GET https://api.deepseek.com/user/balance`，Bearer | 只有余额（`balance_infos[].total_balance`，CNY/USD 字符串），**没有 5h/7d 窗口，官网也没有 coding plan** → 设置页对 DeepSeek 只提供「API / 隐藏」 |
| z.ai / 智谱 GLM Coding Plan | Coding Plan | `GET https://api.z.ai/api/monitor/usage/quota/limit`（备用 `https://open.bigmodel.cn/...`），Bearer | `data.limits[]`：`unit=3 && number=5` → 5h；`unit=6 && number=1` → 7d；`percentage` = 已用；`nextResetTime` = epoch ms。旧路径 `coding_plan/usage` 作为可选兜底 |
| Kimi（国内版） | API | `GET https://api.moonshot.cn/v1/users/me/balance` | 按量余额（PAYG） |
| Kimi（国内版） | Coding Plan | `GET https://api.kimi.com/coding/v1/usages` | 需 `sk-kimi-*` key + UA `KimiCLI/1.6`；周窗口 + `limits[]` 中的 5h 窗口 |
| sub2api（自建） | API / Coding Plan | `GET {baseURL}/v1/usage`，`Authorization: Bearer sk-…` | 一个接口覆盖两种模式：`quota{limit,used,remaining,unit}` / 钱包模式 `balance`；`rate_limits[]` 直接给 `window: "5h" | "1d" | "7d"`（**美元计价，百分比自算 `used/limit`**）。**未文档化的内部接口，字段已发生过漂移 → 按易碎适配器实现** |

**其余厂商只留契约与文档**（Claude Pro/Max OAuth、MiniMax、OpenRouter、SiliconFlow、CommandCode、Codex/ChatGPT、Antigravity、Gemini Code Assist、Volcengine Ark、OpenCode Zen、Moonshot 国际版等）：`docs/adapters.md` 写清接口形态、鉴权方式、返回字段与陷阱 + `src/host/adapters/_template.ts` 注释模板，不写实现。

## 3. 模型清单与配置

- **自动发现**：客户端 `ctx.remote.session.modelCatalog()`（`buildModelCatalog` 不需要 Session，设置页可用）→ `groups[].{id,name,models[]}`；需要 settings 地址或休眠路由时补 `ctx.remote.llm.listConfigurableProviders()`。
- **每个模型三态**：`api` / `coding-plan` / `hidden`。选项按适配器能力过滤（例如 DeepSeek 不出现 `coding-plan`）。
- **可手动拖动排序**；`hidden` 的模型不进任何状态行。
- **配置粒度是 model，拉取与展示按「数据源」去重**：同一 `provider + 模式` 只拉一次、只显示一条。
- **配置存储**：DSH 设置命名空间 `usage-state`（平台原生 `ctx.settings.register` / 客户端 `ctx.settingsScope.bind`）。不使用插件自有配置文件，不重蹈 cost-meter 把配置塞进自有 ledger 的做法。

## 4. 密钥

- **探测顺序**：DSH 凭据库（`ctx.get('credentials').resolve/describe`，`credentialRef(name)`）→ 该 provider 配置里的 `apiKeyEnv`（`llm-deepseek` / `llm-pi-ai` 的 provider profile）→ 已知 CLI 登录文件（按适配器需要）→ 无。
- **设置页每一行显示**：密钥来源 + 「可用 / 未配置」，并提供粘贴框写入 DSH 凭据库（`credentials.set`，落盘 `~/.dsh/.credentials.yaml`）。**插件自己不存明文**。
- 客户端不接触密钥值：只用 `ctx.remote.credentials.describe/set/unset`，传字符串 ref（客户端 bundle 禁止跨插件值导入，不能传 `credentialRef()` 的返回值）。
- 环境变量源是只读且优先级最高的：被它遮蔽时写入会被平台拒绝，UI 必须如实提示而不是假装成功。

## 5. 展示

两个位置，**共用同一套数据解析规则**：

1. `conversation.chat.turnTail`（链式插槽）：每个**已完成回合**动作行下方一行；不需要时 `select` 返回 `null` 不渲染。
2. `conversation.composer.dock`：**自己的 id、`order: 1`，紧贴原生统计行正下方另起一行**。原 `StatsPills`（`id: "stats"`）与其悬浮详情弹窗**原样保留**，不做影子替换、不复刻。

几何对齐（照抄原生行，缺变量时优雅退化）：

```css
max-width: var(--dsh-chat-content-width);
width: 100%;
margin: 0 auto;
justify-content: center;
display: flex; gap: 12px;
padding: 4px calc(var(--dsh-composer-side-clearance) + 16px) 0;
font-size: var(--dsh-content-font-size-secondary, 13px);
```

- **数据归属**：跟随**会话当前选择的模型** → 解析出它的数据源（provider + 模式）→ 显示该源的数据。会话中途切换模型，整行跟着换。
- **显示元素**：标签（provider / 模型名）· 5h % · 7d % · 重置倒计时 · 余额金额 + 币种 · 阈值变色 · 迷你进度条。
- **口径**：**已用百分比**（与 z.ai / Claude 官方一致）。API 模式显示余额，Coding Plan 模式显示 5h/7d。
- **降级**：未配置 → 灰色「未配置」并可点进设置；请求失败 → **保留上次成功值 + 陈旧标记（时间 + ⚠）**；**绝不显示 0 或伪造数据**。
- 阈值默认 ≥80% 黄、≥95% 红；进度条默认开、可在设置关闭（作为可配置项实现）。

## 6. 刷新

宿主单例服务 + 按数据源缓存：

- 回合结束（宿主 `ctx.on('session/event')` 的 `turn/end`）→ **延迟 2s** 触发该会话模型对应数据源的刷新（等 provider 结算）。
- 空闲 **5 分钟**定时兜底（`ctx.interval`，随插件 fiber 自动清理；客户端没有 timer 插件，前端不做定时拉取）。
- 每个数据源 **最小 60s** 内不重复发真实请求；进行中请求去重；将来接 OAuth 类接口时按 `Retry-After` 退避。

## 7. 数据通道

- **配置**：设置命名空间 `usage-state`，客户端 `settingsScope` 原生读写，宿主 `ctx.settings.register` 读。
- **易变快照**：只读 RPC（`ctx.remote.$mount` + 必要 manifest），方法面保持最小：`getSnapshot(force?)`（+ 设置页「立即刷新」用的一次性 refresh）。
- 宿主只发**原始数据**（数字、id、时间戳），**文案全部由客户端词典本地化**（平台原生做法，避免 cost-meter 那种宿主/客户端两套字典）。

## 8. 语言

中英双语，跟随 DSH 设置 `locale.preference` 的解析结果（这一版 **没有 `'auto'` 值**，缺失 `preference` 才回退到浏览器语言）。客户端 `ctx.locale.register('usage-state', {zh, en})` + 插槽声明 `locale: 'usage-state'` 拿到注入的 `t`。**不留任何硬编码字面量**（cost-meter 的漏网字符串是它"看着不像中文"的一部分原因）。

## 9. 工程形态

- **TypeScript + `tsdown` 构建**，产出宿主 `lib/index.js`、客户端 `lib/client.js`、`.d.ts`；解析器用 `node:test` 写单测（sub2api 字段漂移、z.ai 窗口语义推断最需要测）。
- 包名 `dsh-usage-state`；插件/profile 条目 id 与设置命名空间 `usage-state`；`package.json` 的 `dsh` 字段声明 `bundle.patch` + `client.platform: "web"`；`cordis.patch.yml` 里 `insert` 一行。
- 兼容性声明 `dsh >= 0.1.5-rc.2`（当前版本）。
- 文档：`README.md`（中英）、`docs/adapters.md`（adapter 契约 + 已实现厂商字段路径与陷阱 + 未实现候选清单）、`src/host/adapters/_template.ts`。

## 10. 交付与验收

1. 本仓库开发 → 本地装入 web profile（`~/.dsh/profiles/web`）。
2. 设置页能看到模型清单、密钥检测结果、逐模型模式、拖动排序。
3. DeepSeek 余额出现在 composer 行与 turnTail。
4. 刷新插件/重启 DSH 后配置保留。
5. 验收通过后**卸载 `dsh-cost-meter`**，确认状态行无重复。
6. `gh` 建仓推送 `takboo/dsh-usage-state`，验证 `dsh plugin add github:takboo/dsh-usage-state` 可装。

## 11. 已知风险与未验证项

- **sub2api `/v1/usage`**：无官方文档、内部接口、观测到前后端字段名漂移 → 容错解析 + 单测 + 在 UI/文档中标注为不稳定。
- **z.ai monitor 路径**：社区逆向所得，官方文档只描述窗口规则 → 需真实 key 验证；同时保留旧 `coding_plan/usage` 兜底。
- **凭据写入被环境变量遮蔽会被拒**：需要 UI 提示路径。
- **composer 行的对齐依赖平台内部 CSS 变量**（`--dsh-chat-content-width` 等），非公开契约 → 变量缺失时必须优雅退化，不能错版。
- **本机现状**：只有 `DEEPSEEK_API_KEY`；没有 z.ai / Kimi / sub2api 凭据，也不确定是否持有 GLM coding plan。因此先用 DeepSeek 走通全链路，其余适配器以单测 + mock 覆盖，真实联通需你提供 key 与（sub2api 的）`baseURL`。

## 12. 实现顺序

1. 脚手架 + 设置命名空间 + 自定义设置页（模型清单 / 三态 / 排序 / 密钥状态与写入）。
2. 宿主 adapter 框架 + DeepSeek 余额 + RPC 快照通道。
3. 客户端状态行（composer 兄弟行 + turnTail）+ 中英词典。
4. z.ai / Kimi / sub2api 适配器 + 解析单测。
5. 本地装入与验收 → 卸载 cost-meter → GitHub 发布。
