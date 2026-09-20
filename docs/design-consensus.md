# dsh-usage-state — 设计共识（Grilling 结论）

> 状态：**已实现、已在本机验收、已发布**（见 [`implementation.md`](implementation.md)）。
> 日期：2026-09-20（正文已按实施结果校正；与初版共识的差异集中在 §13 修订记录）
> 事实依据：[`research/`](research/README.md) 下的只读侦察文档（是材料，不是共识）。

## 0. 一句话

一个只做「余额 / 额度显示」的 DSH 插件，替代 `dsh-cost-meter` 的展示需求，砍掉它全部的计费逻辑；设置页中英双语，**供应商清单自动发现、零配置可生效**、顺序可调。

## 1. 目标与非目标

**做**：读 DSH 已配置的供应商（provider）→ 按序展示 → 为每个供应商选「自动 / API / Coding Plan / 隐藏」→ 按模式显示余额或 5h/7d 已用百分比（含重置倒计时、阈值变色、迷你进度条）。读数是**账户级**的，因此配置单元是供应商而不是模型（见 §13 修订 1）。

**不做**（成本插件的复杂度来源，全部砍掉）：会话成本统计、模型价格目录与自动匹配、历史账单、预算图框、峰谷计价与通知、native-search 计费、CLIProxyAPI/网关额度、SCNet/Qwen 本地估算、自定义余额端点、会话日志回填与修复 CLI。

## 2. 数据源（v1 实现 4 家）

| 数据源 | 模式 | 接口 | 说明 |
|---|---|---|---|
| DeepSeek 官方 | API | `GET https://api.deepseek.com/user/balance`，Bearer | 只有余额（`balance_infos[].total_balance`，CNY/USD 字符串），**没有 5h/7d 窗口，官网也没有 coding plan** → 设置页对 DeepSeek 只提供「API / 隐藏」 |
| z.ai / 智谱 GLM Coding Plan | Coding Plan | 默认 `GET https://open.bigmodel.cn/api/monitor/usage/quota/limit`（**国内站**，镜像 `https://api.z.ai`），Bearer | `data.limits[]`：`unit=3 && number=5` → 5h；`unit=6 && number=1` → 7d；`percentage` = 已用；`nextResetTime` = epoch ms。**鉴权失败是 HTTP 200 + `{success:false,code:1000,msg}`**，必须识别成"密钥无效"而不是"解析失败"；区域站点互不认对方 key，故按镜像重试。旧路径 `coding_plan/usage` 作为可选兜底 |
| Kimi（国内版） | API | `GET https://api.moonshot.cn/v1/users/me/balance` | 按量余额（PAYG） |
| Kimi（国内版） | Coding Plan | `GET https://api.kimi.com/coding/v1/usages` | 需 `sk-kimi-*` key + UA `KimiCLI/1.6`；周窗口 + `limits[]` 中的 5h 窗口 |
| sub2api（自建） | API / Coding Plan | `GET {baseURL}/v1/usage`，`Authorization: Bearer sk-…` | 一个接口覆盖两种模式：`quota{limit,used,remaining,unit}` / 钱包模式 `balance`；`rate_limits[]` 直接给 `window: "5h" | "1d" | "7d"`（**美元计价，百分比自算 `used/limit`**）。**未文档化的内部接口，字段已发生过漂移 → 按易碎适配器实现** |

**其余厂商只留契约与文档**（Claude Pro/Max OAuth、MiniMax、OpenRouter、SiliconFlow、CommandCode、Codex/ChatGPT、Antigravity、Gemini Code Assist、Volcengine Ark、OpenCode Zen、Moonshot 国际版等）：`docs/adapters.md` 写清接口形态、鉴权方式、返回字段与陷阱 + `src/host/sources/_template.ts` 注释模板，不写实现。

## 3. 供应商清单与配置

- **自动发现**：客户端 `ctx.remote.session.modelCatalog()`（`buildModelCatalog` 不需要 Session，设置页可用）→ `groups[].{id,name,models[]}`；宿主侧用 `ctx.llm.listProviders()` 枚举供应商（这是"零配置也能读到数据"的关键）。
- **每个供应商四态**：`auto`（默认）/ `api` / `coding-plan` / `hidden`。选项按该供应商解析出的数据源能力过滤（例如 DeepSeek 不出现 `coding-plan`）。
- **顺序用上/下按钮调整**（平台没有拖拽/排序原语，见 §13 修订 3）；`hidden` 的供应商不进任何状态行。
- **配置只存"偏差"**：`auto` = 按 provider id 与端点推断数据源 + 取该源的主模式；自建源（需要端点）在没填端点前保持休眠并明确提示。
- **端点优先级**：插件设置里显式填的端点（钉死，不试镜像）→ 供应商声明的 `baseURL`（取其 origin，仍试镜像）→ 适配器默认。
- **配置存储**：DSH 设置命名空间 `usage-state`（平台原生 `ctx.settings.register` / 客户端 `ctx.settingsScope.bind`）。不使用插件自有配置文件，不重蹈 cost-meter 把配置塞进自有 ledger 的做法。旧的按模型条目会在归一化时自动迁移成供应商条目。

## 4. 密钥

- **探测顺序**：设置页覆盖 → 该 provider 配置里的 `apiKeyEnv`（`llm-deepseek` / `llm-pi-ai` 的 provider profile）→ 数据源内置 ref → DSH 凭据库（`ctx.get('credentials').resolve/describe`）。v1 四家全部使用 API key，不需要任何 CLI 登录文件。
- **最后兜底**（见 §13 修订 6）：平台凭据服务报"未配置"时，按平台自身的优先级直读 进程环境 → `$DSH_HOME/.credentials.yaml`，并把来源标注为 `env (direct)` / `file (direct)`，避免静默掩盖平台路径的问题。
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
- **降级**：未配置 → 灰色「未配置」；自建源缺端点 → 「需要先填写接口地址」；请求失败 → **保留上次成功值 + 陈旧标记（多久之前 + ⚠）**；**绝不显示 0 或伪造数据**。
- 阈值默认 ≥80% 黄、≥95% 红；进度条默认开、可在设置关闭（作为可配置项实现）。
- **悬浮提示**（见 §13 修订 5）：每个部分悬停显示"一行放不下的信息"——数据源 + 模式、窗口的绝对重置时刻（本地时间）、余额的赠送/充值构成、失败原因 + provider 原始消息、陈旧读数的更新时间。"可点进设置"未实现（客户端没有公开的"打开设置面板"服务）。

## 6. 刷新

宿主单例服务 + 按数据源缓存：

- 回合结束（宿主 `ctx.on('session/event')` 的 `turn/end`）→ **延迟 2s** 刷新全部已配置目标（等 provider 结算；实现为 `refreshAll`，比"只刷该会话的数据源"更简单且不会漏掉并行使用）。
- 空闲 **5 分钟**定时兜底（`ctx.interval`，随插件 fiber 自动清理；客户端没有 timer 插件，前端不做定时拉取）。
- 每个数据源 **最小 60s** 内不重复发真实请求；进行中请求去重；将来接 OAuth 类接口时按 `Retry-After` 退避。

## 7. 数据通道

- **配置**：设置命名空间 `usage-state`，客户端 `settingsScope` 原生读写，宿主 `ctx.settings.register` 读。
- **易变快照**：只读 RPC（`ctx.remote.$mount` + Typert 清单），方法面保持最小：**`getState(force)`** 与 **`describeCredentials()`**（force 用于设置页的「立即刷新」）。客户端必须用 `ctx.get('remote.usageState')` 读取（属性访问需要 inject，而该命名空间是本插件自己贡献的，见 §13 修订 7）。
- 宿主只发**原始数据**（数字、id、时间戳），**文案全部由客户端词典本地化**（平台原生做法，避免 cost-meter 那种宿主/客户端两套字典）。

## 8. 语言

中英双语，跟随 DSH 设置 `locale.preference` 的解析结果（这一版 **没有 `'auto'` 值**，缺失 `preference` 才回退到浏览器语言）。客户端 `ctx.locale.register('usage-state', {zh, en})` + 插槽声明 `locale: 'usage-state'` 拿到注入的 `t`。**不留任何硬编码字面量**（cost-meter 的漏网字符串是它"看着不像中文"的一部分原因）。

## 9. 工程形态

- **TypeScript + `tsdown` 构建**，产出宿主 `lib/index.js`、`lib/typert.js` 与客户端 `lib/client.js`（不产出 `.d.ts`：运行时消费不需要）；解析器用 `node:test` 写单测（sub2api 字段漂移、z.ai 窗口语义推断最需要测）。
- 包名 `dsh-usage-state`；插件/profile 条目 id 与设置命名空间 `usage-state`；`package.json` 的 `dsh` 字段声明 `bundle.patch` + `client.platform: "web"`；`cordis.patch.yml` 里 `insert` 一行。
- **实测环境**：DSH `0.1.5-rc.2` + Node ≥20（`engines`）。平台的 manifest schema **没有** `compatibility` 字段（它只认 `bundle` / `profile` / `client` / `configTrees` / `sessionFormatMigration` / `moduleFallback`），因此没有声明这一项；cost-meter 的 `dsh.compatibility` 与 `dshhub` 是市场元数据，未被平台读取。
- 文档：`README.md`（中英）、`docs/implementation.md`（实现与验证总览）、`docs/adapters.md`（adapter 契约 + 已实现厂商字段路径与陷阱 + 未实现候选清单）、`src/host/sources/_template.ts`（新数据源骨架）。

## 10. 交付与验收

1. 本仓库开发 → 本地装入 web profile（`~/.dsh/profiles/web`）。
2. 设置页能看到供应商清单、密钥检测结果、逐供应商四态（自动/API/Coding Plan/隐藏）、上/下移排序。
3. DeepSeek 余额出现在 composer 行与 turnTail。
4. 刷新插件/重启 DSH 后配置保留。
5. 验收通过后**卸载 `dsh-cost-meter`** ✅ 已完成，确认状态行无重复。
6. `gh` 建仓推送 `takboo/dsh-usage-state`，验证 `dsh plugin add github:takboo/dsh-usage-state` 可装。

## 11. 已知风险与未验证项

- **sub2api `/v1/usage`**：无官方文档、内部接口、观测到前后端字段名漂移 → 容错解析 + 单测 + 在 UI/文档中标注为不稳定。
- **z.ai monitor 路径**：社区逆向所得。**已用真实 key 验证通过**（并因此发现两个我方缺陷：把 200 错误信封误报成解析失败、默认端点用错区域），同时保留旧 `coding_plan/usage` 兜底。
- **凭据写入被环境变量遮蔽会被拒**：需要 UI 提示路径。
- **composer 行的对齐依赖平台内部 CSS 变量**（`--dsh-chat-content-width` 等），非公开契约 → 变量缺失时必须优雅退化，不能错版。
- **仍未经真机验证**：Kimi（Moonshot 余额 + Kimi Code 窗口）、Sub2API（需要自建实例地址）、阈值变色的视觉、手写密钥写入→生效。详见 [`implementation.md`](implementation.md) §5。
- **凭据服务的可见性**：profile 根级插入的行未必能拿到 `credentials` 服务（作用域），因此加了直读兜底；来源标注可用来判断平台路径是否真的在工作，若确认可用应删掉兜底。
- **回合行的固定值**：目前 turnTail 与 dock 显示同一份"最新读数"，老回合下方显示的是当前值。方案（C2+D：固定值 + 较上一回合 Δ）已定，持久化方式待定，见 §13 修订 8。

## 12. 实现顺序

1. 脚手架 + 设置命名空间 + 自定义设置页（模型清单 / 三态 / 排序 / 密钥状态与写入）。
2. 宿主 adapter 框架 + DeepSeek 余额 + RPC 快照通道。
3. 客户端状态行（composer 兄弟行 + turnTail）+ 中英词典。
4. z.ai / Kimi / sub2api 适配器 + 解析单测。
5. 本地装入与验收 → 卸载 cost-meter → GitHub 发布。

## 13. 修订记录（实施过程中的决策变更）

> 初版共识是 grilling 的产物；真机实施暴露了它不成立或不够好的地方。以下每条都记录了"原决策 → 现决策 → 原因"，避免后人误读正文。

1. **配置单元：模型 → 供应商**（`ccb9adc` / `8384738`）
   原文要求"为每个模型选模式"。但余额/额度是**账户级**的：同一 provider 下所有模型共享一份读数，逐模型配置既重复又冗长（用户实测反馈"太长、设置实际是重复的"）。改为每个 provider 一次，模型列表降级为只读映射视图。
2. **新增 `auto` 模式与零配置**（`ccb9adc`）
   原设计默认 `hidden`，用户必须先配置才显示。改为默认 `auto`：按 provider id 与端点推断数据源、取该源主模式；宿主用 `ctx.llm.listProviders()` 枚举 provider，因此**一行都不配也能读到正在使用的账户**。自建源（需要端点）保持休眠并明确提示。
3. **排序：拖动 → 上/下按钮**（`8384738`）
   平台 primitives 里没有任何拖拽/排序原语、连拖拽手柄图标都没有，实现拖拽要自己处理指针捕获、命中测试与键盘可达性。上下按钮是可访问的、十几行、且写入是原子的整个数组。
4. **状态行位置：影子替换 → 兄弟行**（grilling 中用户改主意）
   最初定的是"影子替换原生统计行"以便与统计同行；经讨论认为会过度拥挤且要复刻平台内部 UI，改为在统计行正下方另起一行（`order: 1`），原生 `StatsPills` 与其弹窗原样保留。
5. **点击弹窗 → 悬浮提示**（`002e571`）
   平台原生统计 pill 点击弹出明细，用户问"我们是否要做类似的"。结论：弹窗只显示现有信息会与设置页重复；要显示每个窗口的原始数字（used/limit/单位）必须先扩展数据模型。选择 (A)：不动数据模型，把细节放进每个部分的悬浮提示（数据源/模式/绝对重置时刻/余额构成/失败原因）。
6. **凭据探测增加直读兜底**（`6f45043`）
   真机上宿主行拿不到 `credentials` 服务（症状：一切都对但界面只说"未配置"）。兜底按平台自身优先级直读 env → `.credentials.yaml`，并标注来源 `(direct)`；若确认平台路径可用应删除。
7. **RPC 客户端读取方式**（`c93ed6d`）
   原文示意用 `ctx.remote.<ns>`。但属性访问要求该服务已在 `inject` 列表中，而 `remote.usageState` 是本插件 `$mount` 后才贡献的（写进 inject 会死等）。改用 `ctx.get('remote.usageState')`。
8. **回合行的"固定值 + Δ"**（讨论中，未实现）
   用户观察到 turnTail 与 dock 值同步，"不固定就没有意义"。方案定为 C2+D（宿主按 `(sessionId, turn)` 记录固定值 + 显示较上一回合的变化），但持久化方式待定：session log + 投影（可随会话迁移，但需先验证外部插件事件能否带 `ignorable` 标记）或插件自有文件（无平台风险、不随会话走）。
9. **`.d.ts` 与兼容性声明**（本文档校正）
   原文写"产出 `.d.ts`"与"声明 `dsh >= 0.1.5-rc.2`"，实现都不成立：`dts: false`，且平台 manifest schema 没有 `compatibility` 字段。已按事实改写。
