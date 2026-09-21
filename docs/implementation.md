# 实现与验证总览

> 目标读者：接手这个仓库的人（包括几个月后的作者）。
> 本文件回答三件事：**做了什么**（代码地图）、**每条设计决策落在哪里、测到什么程度**（追溯表）、**哪些还没验证**（诚实清单）。
> 相关文档：[`design-consensus.md`](design-consensus.md)（原始共识 + 修订记录）、[`adapters.md`](adapters.md)（扩展数据源）、[`research/`](research/README.md)（只读侦察）。

## 1. 状态

| 项目 | 状态 |
|---|---|
| 实现 | ✅ 完成（宿主 + 客户端 + 构建产物） |
| 本机装入与人工验收 | ✅ 通过（DeepSeek 余额、z.ai 5h/7d、OpenCode Zen Go 5h/7d/30d、双位置状态行、设置页、悬浮提示） |
| 自动化测试 | ✅ 263 个用例（`npm test`），`tsc --noEmit` 干净 |
| 发布 | ✅ <https://github.com/takboo/dsh-usage-state>（公开，MIT） |
| `dsh plugin add github:takboo/dsh-usage-state` | ✅ 实测可装（在临时目录安装发布包并加载验证） |
| 替代 `dsh-cost-meter` | ✅ 已从 web profile 卸载（历史数据保留在 `~/.dsh/storages/cost-meter/`） |

## 2. 代码地图

宿主半边（Node，`inject: ['timer']`，**不 import 任何平台包**，只用结构化类型）：

| 文件 | 职责 |
|---|---|
| `src/index.ts` | 插件入口：装配全部依赖；`ctx.on('session/event')` 的 `turn/end` → 延迟刷新；`provideUsageState` 打上 `typertRemote` 绑定并 `ctx.provide` |
| `src/host/sources/types.ts` | 数据源契约：`request` / `parse`（纯函数）/ `credentialRefs(mode)` / `defaultBaseUrl(mode)` / `fallbackRequests` / `SourceError(kind)` |
| `src/host/sources/normalize.ts` | 归一化工具：`toFiniteNumber` / `clampPercent` / `normalizePercent` / `normalizeResetAt` / `normalizeBaseUrl` |
| `src/host/sources/deepseek.ts` | DeepSeek 余额（多币种乱序挑选、保留赠送/充值构成） |
| `src/host/sources/zai.ts` | z.ai / GLM：三种返回形态、`unit` 语义、200 错误信封识别、国内/国际镜像 |
| `src/host/sources/kimi.ts` | Kimi：API 模式查 Moonshot 余额、Coding Plan 模式查 Kimi Code 订阅窗口（需 CLI UA） |
| `src/host/sources/opencode.ts` | OpenCode Zen Go：`GET /zen/go/v1/usage`（**必须带浏览器 UA**，否则 Cloudflare 1010）；`rolling/weekly/monthly` → `5h/7d/30d`；根级 `usage` 与 `data.usage` 两种信封；401/403 = 无订阅/密钥无效 |
| `src/host/sources/sub2api.ts` | Sub2API `GET /v1/usage`，全程容错（字段曾漂移） |
| `src/host/sources/_template.ts` | 新数据源骨架（进 `tsc` 检查，不会腐化） |
| `src/host/sources/index.ts` | `ALL_SOURCES` 注册表 + `findSource` |
| `src/host/catalog.ts` | `toSourceCatalog`：把适配器元数据压成纯 JSON 过 RPC（浏览器不能 import 宿主代码） |
| `src/host/credentials.ts` | 凭据候选顺序与解析：`orderedCredentialRefs` / `resolveApiKey` / `describeCredentials`（永不返回密钥值） |
| `src/host/credential-fallback.ts` | 最后兜底：平台服务报"未配置"时直读 env → `$DSH_HOME/.credentials.yaml`，来源标注 `(direct)` |
| `src/host/provider-refs.ts` | 从 DSH provider 配置推导 `apiKeyEnv` 与端点（`llm-deepseek` / `llm-pi-ai`） |
| `src/host/settings.ts` | 设置命名空间 `usage-state`：永不抛出的 schema + `installUsageStateSettings` |
| `src/host/targets.ts` | 把 provider 列表解析成轮询目标（`source+mode` 去重、携带端点） |
| `src/host/read.ts` | HTTP 读取层：多端点（镜像）按序尝试、失败归类、超时 |
| `src/host/refresh.ts` | `UsageStateStore`：最小间隔、失败不节流、在途去重、回合结束后延迟刷新、空闲定时 |
| `src/host/service.ts` | RPC 服务面：`getState(force)` / `describeCredentials()` |
| `src/host/typert.ts` | Typert 宿主清单（zod v4 严格 codec） |

客户端半边（浏览器，只 require shell 模块表里的模块）：

| 文件 | 职责 |
|---|---|
| `src/client/index.tsx` | 客户端入口：注册词典、绑定设置作用域、`$mount` RPC 贡献、轮询与事件触发的刷新、三个插槽注册 |
| `src/client/context.ts` | 平台服务的结构化类型镜像（避免 host/client 类型合并冲突与运行时依赖） |
| `src/client/remote.ts` | `remoteService(ctx, name)`：用 `ctx.get` 读远程命名空间（`ctx.remote.X` 属性访问需要 inject，不能用于自己贡献的命名空间） |
| `src/client/store.ts` | 浏览器侧读数镜像：失败不覆盖旧数据、并发共享在途调用、模型目录通道 |
| `src/client/provider-rows.ts` | provider 行构建、模式设置、顺序调整（纯函数） |
| `src/client/status-text.ts` | `StatusSegment` → 可渲染 parts（含每个部分的 tooltip 文案，纯函数） |
| `src/client/StatusLine.tsx` | 状态行组件（`dock` / `actions` 两个变体共用；`actions` 即回合动作条，原 turnTail 见 `design-consensus.md` 修订 9），平台 `Tooltip` 承载细节 |
| `src/client/SettingsSection.tsx` | 设置页：provider 四态、上/下移、模型清单、高级区（数据源覆盖/端点/凭据名/密钥写入）；卡头部是两列网格，名字过长时只截断灰色的 provider id，控件不换行（见 §3 与 `design-consensus.md` §13 修订 12） |
| `src/client/locales.ts` | 中英词典（`en` 以 `zh` 的键联合类型约束）+ `LocaleNamespaceMap` 增强 |
| `src/client/hooks.ts` | `useStoreState` / `useSettingsValue` / `useNow` |

两端共用（`src/shared/`）：`types.ts`（读数/快照/schema 无关的类型）、`config.ts`（配置模型 + 归一化 + source 建议）、`providers.ts`（provider → 数据源+模式的解析）、`display.ts`（格式化、阈值、段构建、`originOf`）、`rpc.ts`（跨 RPC 的线上类型）。

构建与清单：`tsdown.config.ts`（宿主 ESM + 浏览器 CJS 闭包工厂）、`cordis.patch.yml`（bundle 插入行）、`package.json`（`exports` / `dsh.bundle.patch` / `dsh.client.platform` / `files`）、`lib/`（**提交入库**，因为 github 安装没有构建步骤）。

## 3. 设计决策 → 实现 → 测试 → 验证

| 决策 | 实现 | 测试 | 验证程度 |
|---|---|---|---|
| 只做余额/额度显示，砍掉计费 | 代码库无价格目录/账本/历史模块 | — | 结构上可验证（模块不存在） |
| 五家数据源 | `host/sources/{deepseek,zai,kimi,opencode,sub2api}.ts` | `tests/sources/*`（63 例） | **DeepSeek / z.ai / OpenCode Zen Go 真机**；Kimi / Sub2API 仅单测（本机无凭据） |
| provider 级配置（**修订**：原为 model 级） | `shared/config.ts` + `shared/providers.ts` + `client/provider-rows.ts` | `config`(12) / `providers`(15) / `provider-rows`(13) | 真机（provider 行 + "自动识别为 …"） |
| 零配置 `auto` | `providers.resolveProvider` + `targets`（宿主用 `ctx.llm.listProviders()` 枚举 provider） | `providers` / `targets` / `entry` | 真机（未配置也读到了 DeepSeek 余额） |
| 模式选项按数据源能力过滤 | `provider-rows.modes` + `providers.resolveProvider`（`unsupported` 不静默替换） | `provider-rows` / `providers` | 真机（DeepSeek 不出现 Coding plan） |
| 凭据自动复用（不用手配） | `credentials` + `provider-refs` + `credential-fallback` | `credentials`(10) / `provider-refs`(8) / `credential-fallback`(5) | 真机（设置页显示 `DEEPSEEK_API_KEY 已配置`，来源标注） |
| 密钥写入走平台凭据库 | `client/SettingsSection`（`remote.credentials.set/unset`）+ `writable` 透传 | `render` + `credentials` | 结构 + 单测（本机未真正写过密钥） |
| 设置命名空间 `usage-state` + 自定义页 | `host/settings.ts` + `client/SettingsSection.tsx` | `settings`(4) / `render`(14) | 真机（页面可用、四态与排序即时生效） |
| 卡头部不换行：名字过长不挤走控件（**本轮**） | `client/SettingsSection.tsx` 的三组样式常量（`HEADER` / `NAME` / `CONTROLS`） | `render`（长名用例：网格 + ellipsis + `flex-shrink:0` + `title`） | 结构（SSR 断言）；真机目视待确认 |
| RPC 通道（Typert） | `host/typert.ts` + `host/service.ts` + `client/index.tsx`（`$mount`） | `typert`(8) / `service`(5) / `entry`(11) / `bundle`(6) | 真机 + **平台 `validateTypertManifest`** |
| 状态行挂两处（dock 兄弟行 + 回合动作条） | `client/slots.ts`（挂载点即数据）+ `client/index.tsx` + `client/StatusLine.tsx` | `slots`(4) / `render`（SSR） | 真机确认可见；回合行曾因 chain 冲突消失，已改挂 `assistant-actions` 修复（见 §9 第 11 条） |
| 刷新：回合结束 +2s、空闲 5min、最小 60s | `host/refresh.ts`（时钟注入）+ `src/index.ts` | `refresh`(12)（假时钟）/ `entry` | 单测精确覆盖；真机间接（数值随时间变化） |
| 失败保留旧值 + 陈旧时间 + ⚠ | `refresh.fail` + `display.describeStatus` + `status-text` | `refresh` / `display`(12) / `status-text`(8) / `render` | 真机（早期 `⚠ … Unavailable` 截图）+ 单测 |
| 悬浮提示 (A) | `status-text` 生成 tooltip + `StatusLine` 用平台 `Tooltip` | `status-text` / `render`（断言 `data-tooltip`） | 真机（用户确认） |
| 中英双语跟随 DSH 语言 | `client/locales.ts`（键集一致性有测试） | `locales`(5) / `render` | 真机（英文界面 + 中文词典） |
| 构建与发布 | `tsdown.config.ts` / `package.json` / `lib/` | `bundle`(6)（信封、require 白名单、产物端到端） | 真机安装 + 从 GitHub 安装实测 |

## 4. 已验证的证据

- **真机读数**：DeepSeek 余额随消耗变化（`¥58.23 → 58.18 → 58.13 → 57.19`）；z.ai `5h 12% (4h0m) · 7d 59% (3d17h)` 含进度条。
- **本机离线复现**：用真实密钥直连 `GET /user/balance` 跑通整条宿主链路（含解析、目标解析、凭据解析）。
- **平台校验器**：`@deepseek-ai/dsh-typert-loader` 的 `validateTypertManifest` 接受我们的清单（已固化为测试）。
- **产物级**：`lib/index.js` 用假宿主端到端跑通；`lib/client.js` 信封与 require 白名单受测试保护。
- **发布路径**：`npm install github:takboo/dsh-usage-state` → 宿主入口可加载、typert 清单可用、client bundle 随包发布、`cordis.patch.yml` 到位。
- **卸载**：web profile 的 `dependencies` / `dsh.profile.bundles` / `node_modules` 均无 `dsh-cost-meter`。

## 5. 人工验收清单（重启 DSH 后逐项确认）

安装或改动宿主半边后，重启 DSH（bundle patch 只在启动时读取），然后按此表确认。只有 DeepSeek 凭据时，第 3–5 步先只能验它。

| # | 操作 | 期望 |
|---|---|---|
| 1 | 打开设置 → 侧边栏出现「用量状态」 | 页面可打开；中英跟随 DSH 语言设置切换 |
| 2 | 供应商列表 | 列出 DSH 里配置的供应商（每行含其模型清单）；DeepSeek 显示「自动识别为 DeepSeek · API balance」 |
| 3 | 保持默认「自动」（或点「API balance」） | 输入框统计行正下方出现一行 `DeepSeek · ¥余额`；每个已完成回合下方也有一行 |
| 4 | 点「立即刷新」 | 数值与时间戳更新 |
| 5 | 故意用错误密钥（或在设置里清掉） | 保留上次成功值 + `⚠`（多久之前），悬浮显示原因；**不显示 0 或空白** |
| 6 | 配置 z.ai / Kimi / Sub2API | 出现「数据源 / 接口地址 / 凭据名 / 密钥」区块；填入后 coding-plan 模式显示 `5h x% (倒计时) ▓▓░░░░░░ · 7d y%` |
| 7 | 改显示设置（阈值、进度条、刷新间隔） | 立即生效；把黄色阈值临时改成 10 可确认阈值变色 |
| 8 | 悬停任意一段文字 | 出现悬浮提示：数据源 + 模式（+ 窗口绝对重置时刻 / 余额赠送与充值构成 / 失败原因） |
| 9 | 供应商名字很长时（如 `opencode-go-ds41` / `opencode-go-deepseek`） | 卡头部**不换行**：`↑ ↓ 自动 Coding Plan 隐藏` 始终与上一行同一右边界；被截断的灰色 id 悬停可看全文（`title`） |

出问题时的恢复命令：`dsh plugin --profile web remove dsh-usage-state`。

## 6. 未验证 / 未实现 / 明确不做

**未用真实数据验证**（代码与单测就绪）：

1. **Kimi**（Moonshot 余额 + Kimi Code 窗口）——本机无 key；`sk-kimi-*` + `KimiCLI/1.6` UA 的要求来自侦察，未经真机确认。
2. **Sub2API**——本机没有自建实例；`/v1/usage` 是未文档化接口且字段漂移过，实现按容错处理。
3. **阈值变色的视觉**——真机读数 12%/59% 未触及阈值；把设置里黄色阈值临时改成 10 即可看到。
4. **手写密钥写入**——设置页可写，但本机凭据来自环境变量/凭据文件，未实际走一遍写入→生效。
5. **OpenCode Zen Go 的非零路径**——真机 HTTP 200、三窗口（5h/7d/30d）都返回 `0%`（账户未用），所以 `percent > 0` 的显示、阈值变色与窗口排序没有真机样本；`status` 字段也只见过 `"ok"`，若将来出现非 `ok` 且 `percent: 0`，当前会显示 0% 而不是报错（无取值证据前不臆造，故未做映射）。

**已识别但尚未实现**（讨论见 `design-consensus.md` §13）：

5. **回合行的"固定值 + 较上一回合 Δ"**——目前回合动作条（`assistant-actions`）与 dock 显示同一份"最新读数"，因此老回合下方显示的是当前值而不是当时的值。目标形态已定（固定值 + Δ），**首选** session log + 投影（数据随会话生命周期自动清理、可随会话迁移），但**必须先做可行性实验**（读取侧是否会拒绝"未知类型且不带 `ignorable`"的事件），不行则退回插件自有文件 + LRU/TTL 清理。执行计划见 `plans/` 下的过渡文档（实施完成后删除）。
6. **点击状态行进入设置页**——设计里写过"可点进设置"，但客户端没有公开的"打开设置面板"服务；(A) 方案改用悬浮提示承载细节，点击行为暂不做。
7. **`.d.ts` 产物**——`tsdown` 配置 `dts: false`，不产出类型声明（运行时消费不需要）。
8. **平台兼容性声明**——平台 manifest schema **没有** `compatibility` 字段（`dsh.bundle` / `dsh.client` / `profile` / `configTrees` / `sessionFormatMigration` / `moduleFallback` 才是它认识的）；实测环境是 DSH `0.1.5-rc.2` + Node ≥20（见 `engines`）。cost-meter 的 `dsh.compatibility` / `dshhub` 是市场元数据，未被平台读取。

**明确不做**（与共识一致）：会话成本统计、价格目录、历史账单、预算、峰谷计价、native-search 计费、网关额度、自定义余额端点。

## 7. 命令

```bash
npm install                                     # 依赖（~/.npm 不可写时加 --cache /tmp/npm-cache）
npm test                                        # node:test 直接跑 .ts / .tsx（Node >= 22.6，本机 26.x）
npm run typecheck                               # tsc --noEmit
npm run build                                   # tsdown → lib/（宿主 index.js/typert.js + 浏览器 client.js）
npm run watch                                   # 只重建 client.js → 客户端被 HMR 热替换，无需刷新页面

dsh plugin --profile web add "$PWD"             # 本地装入（会自动加入 profile bundles）
dsh --profile web --dump-config                 # 不启动服务，仅组装 profile 树（校验行是否合法）
dsh plugin --profile web remove dsh-usage-state # 出问题时的恢复命令
```

宿主半边改动**需要重启 DSH**；客户端半边改动 `npm run watch` 即可热替换。

## 8. 提交清单（39 次，按阶段）

| 阶段 | 提交 |
|---|---|
| 文档与结构 | `4a72b42` 整理项目结构、提交设计共识与侦察文档 |
| 脚手架与契约 | `53263cc` 工程脚手架 · `711fb1e` 数据源契约+归一化+DeepSeek · `478cf8d` z.ai · `c33c182` 凭据按模式解析 · `f8b0e63` Kimi · `008706c` Sub2API |
| 配置与调度 | `0d4b1f3` 配置模型+注册表+目标解析 · `f31247c` 凭据解析 · `7f3e5b7` 刷新缓存与调度 · `da2b734` 状态行纯逻辑+数据源目录 |
| 宿主接入 | `e87814e` HTTP 读取层 · `37073ad` typert 侦察报告 · `d5786e0` 配置归一化+设置命名空间 · `bb09bad` RPC 服务面+清单 · `50e2c61` provider 凭据推导+入口装配 |
| 客户端 | `7af33d4` 词典+文案映射 · `348a3d3` 线上类型归位 · `c90813a` 模型行+状态镜像 · `0e4acfc` 状态行组件+设置页+装配 |
| 构建与发布 | `8d142a5` tsdown+manifest+lib · `8960efe` adapter 文档+模板 · `20eb8df` 产物级测试+验收清单 · `63db025` LICENSE+安装说明 |
| 真机修复 | `f50f4e7` 平台校验器测试 · `ac9e7e3` SSR 渲染测试+候选凭据名 · `a98d610` 注入 `remote.session` · `47972d1` 空状态 · `3b87781` **`typertRemote` 自引用** · `ccb9adc` provider 级配置 · `8384738` provider 级设置页 |
| 真机加固 | `c93ed6d` `ctx.get` 免 inject · `74a189b` 界面显示失败原因 · `6f45043` 凭据兜底 · `b6449ff` 陈旧时间 · `445d5dc` z.ai 错误信封+镜像+声明端点 · `002e571` 悬浮提示 · `ab26479` 状态更新 |

## 9. 从真机调试里学到的平台事实（下次直接复用）

1. **`typertRemote.service` 必须是服务对象本身**（`Reflect.get(value,'service') !== original` 会导致每次派发 `gateway/binding-invalid`）；`serviceKey` 才是名字。症状是"插件静默返回空"。
2. **宿主 codec 必须是 zod v4**（loader 检查 `'_zod' in schema`），因此 `zod` 是运行时依赖。
3. **RPC 参数个数是精确匹配**：可选参数也必须显式传（配合 `acceptsUndefined: true`）。
4. **`ctx.remote.<ns>` 属性访问需要 inject**；读自己贡献的命名空间必须用 `ctx.get('remote.<ns>')`（否则 `cannot get property … without inject`）。
5. **link 装载的插件解析不到 `@deepseek-ai/*`**（只解析自己的 `node_modules`），宿主半边一律用结构化类型。
6. **bundle patch（含插件自己的 `cordis.patch.yml`）只在启动时读取**；客户端 bundle 会被 `dsh-client-hmr` 热替换（`tsdown --watch` 足够，无需 `pnpm run dev:web`）。
7. **Node 的类型剥离不支持 `.tsx`/构造器参数属性/枚举**：`src` 避开这些写法，`.tsx` 由测试钩子用项目自带 TypeScript 转译。
8. **浏览器包不能在 Node 里 import**（CSS 模块 + 未声明的传递依赖）→ 渲染测试用模块钩子替换 primitives 桩件。
9. **z.ai 用 HTTP 200 + `{success:false,code:1000,msg}` 表达鉴权失败**；区域站点互不认对方的 key。
10. **外部插件事件在会话日志里是有设计支持的**（`ignorable: true` 是兼容机制），但 0.1.5-rc.2 的 `Session.append()` 没有参数能设置该标记——用前必须实验验证。
11. **chain 插槽只有一个赢家，且回合动作条在历史回合是悬停显示**：`conversation.chat.turnTail` 是 chain（`dsh-client-ui-deliverables` 与 `dsh-better-sidebar` 都注册在此，`priority: -1`），任何产出文件的回合都会把它们之一选为赢家，其他条目**不会被询问**；`select` 又被契约要求是纯函数，无法感知"别人要认领"而让路。改用 list 槽 `conversation.chat.assistant-actions` 可避免抢占，但它由平台渲染在**回合动作条**内（ui-chat 只在 `closing.finalNode.messageId` 上渲染一次/回合），而该条在**非最新回合是 `opacity: 0` + `:hover` 才显示**（平台自己的每回合 token/耗时面板也在那里）。要"每个历史回合都常显"，只能用会话事件定义 + 自有 transcript 节点（见 `plans/` 的 pinning 计划）。
    **补充（同一处集成实测）**：`MessageIconActions.extraActions` 的位置由平台固定——类型注释原文 *"placed between the built-in copy and branch controls"*，即我们默认会落在复制按钮与分支按钮之间。因为该行是 flex 容器、我们的条目是直接子项，所以用 CSS `order: 1` 把它移到**行尾**（`Ran for …` 与时间之后）才是合理位置；并且动作条一行只有 28px，所以 `actions` 变体做了减法（`compactParts`：标签换成模型图标 `IconDataOutline16`（与模型选择器同一图标）、只留百分比、倒计时与进度条留在悬停提示里）。
