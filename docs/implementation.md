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
| `src/client/StatusLine.tsx` | 状态行组件（单一形态，挂在 composer 统计行正下方；账户级读数不放在回合上，见 `design-consensus.md` 修订 13），平台 `Tooltip` 承载细节 |
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
| 状态行挂一处（composer 统计行正下方的兄弟行） | `client/slots.ts`（挂载点即数据）+ `client/index.tsx` + `client/StatusLine.tsx` | `slots`(3) / `render`（SSR） | 真机确认可见；曾挂过回合动作条，已按修订 13 移除（平台事实见 §9 第 11 条） |
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
| 3 | 保持默认「自动」（或点「API balance」） | 输入框统计行正下方出现一行 `DeepSeek · ¥余额` |
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

1. **点击状态行进入设置页**——设计里写过"可点进设置"，但客户端没有公开的"打开设置面板"服务；(A) 方案改用悬浮提示承载细节，点击行为暂不做。
2. **`.d.ts` 产物**——`tsdown` 配置 `dts: false`，不产出类型声明（运行时消费不需要）。
3. **平台兼容性声明**——平台 manifest schema **没有** `compatibility` 字段（`dsh.bundle` / `dsh.client` / `profile` / `configTrees` / `sessionFormatMigration` / `moduleFallback` 才是它认识的）；实测环境是 DSH `0.1.5-rc.2` + Node ≥20（见 `engines`）。cost-meter 的 `dsh.compatibility` / `dshhub` 是市场元数据，未被平台读取。**DSH 版本要求本身**已按修订 14 用 `engines.dsh` 声明（市场读它做徽标与兼容判定）。
4. ~~**`peerDependencies.react` 是否移除**~~ → **已移除**（0.3.1，见 `design-consensus.md` 修订 15）：端到端安装（§10）时 pnpm 报 `✕ missing peer react`——任何 profile 的依赖图里都没有 react（浏览器半边的 react 由平台在运行时注入，不走 node_modules），而 `peerDependencies` 里却声明了它。移除后安装输出干净，且市场只对 `@deepseek-ai/dsh*` 的 peer 做兼容评估，不受影响；`react` 仍留在 `devDependencies` 供构建与类型使用。

> 原"回合行的固定值 + Δ"已**结案否决**（账户级读数不放在回合上），见 `design-consensus.md` §13 修订 13；不再是待办项。

**明确不做**（与共识一致）：会话成本统计、价格目录、历史账单、预算、峰谷计价、native-search 计费、网关额度、自定义余额端点；以及**按回合展示账户读数**（同上，见修订 13）。

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

npm pack --dry-run --cache /tmp/npm-cache       # 发布前核对 npm 内容
npm publish --cache /tmp/npm-cache              # ~/.npm 不可写时必须带 --cache；需要 2FA（见 §10）
```

宿主半边改动**需要重启 DSH**；客户端半边改动 `npm run watch` 即可热替换。

## 8. 提交清单（按阶段；完整历史以 `git log` 为准）

| 阶段 | 提交 |
|---|---|
| 文档与结构 | `4a72b42` 整理项目结构、提交设计共识与侦察文档 |
| 脚手架与契约 | `53263cc` 工程脚手架 · `711fb1e` 数据源契约+归一化+DeepSeek · `478cf8d` z.ai · `c33c182` 凭据按模式解析 · `f8b0e63` Kimi · `008706c` Sub2API |
| 配置与调度 | `0d4b1f3` 配置模型+注册表+目标解析 · `f31247c` 凭据解析 · `7f3e5b7` 刷新缓存与调度 · `da2b734` 状态行纯逻辑+数据源目录 |
| 宿主接入 | `e87814e` HTTP 读取层 · `37073ad` typert 侦察报告 · `d5786e0` 配置归一化+设置命名空间 · `bb09bad` RPC 服务面+清单 · `50e2c61` provider 凭据推导+入口装配 |
| 客户端 | `7af33d4` 词典+文案映射 · `348a3d3` 线上类型归位 · `c90813a` 模型行+状态镜像 · `0e4acfc` 状态行组件+设置页+装配 |
| 构建与发布 | `8d142a5` tsdown+manifest+lib · `8960efe` adapter 文档+模板 · `20eb8df` 产物级测试+验收清单 · `90ed851` 凭据可写性透传+失焦提交 · `63db025` LICENSE+安装说明 |
| 真机修复 | `f50f4e7` 平台校验器测试 · `ac9e7e3` SSR 渲染测试+候选凭据名 · `a98d610` 注入 `remote.session` · `47972d1` 空状态 · `3b87781` **`typertRemote` 自引用** · `ccb9adc` provider 级配置 · `8384738` provider 级设置页 |
| 真机加固 | `c93ed6d` `ctx.get` 免 inject · `74a189b` 界面显示失败原因 · `6f45043` 凭据兜底 · `b6449ff` 陈旧时间 · `445d5dc` z.ai 错误信封+镜像+声明端点 · `002e571` 悬浮提示 · `ab26479` 状态更新 |
| 数据源扩充 | `c01a64f` OpenCode Zen Go（5h/7d/30d，0.2.0） |
| 回合行（已按修订 13 移除） | `3566f2d` 记录"有产出回合不显示" · `16527d8` 改挂 `assistant-actions` · `5ec3c96` 动作条紧凑形态 · `34b44df` 图标分隔符 · `84d5772` 文档同步 |
| 发布后修复 | `e4d40d7` 幽灵 provider 行（0.2.1） · `7adb90e` 三处健壮性 + 不再轮询已删 provider（0.2.2） · `dd37b3d` 设置页卡头部不换行 + 溯源致谢（0.2.3） |
| 文档一致性 | `b9dc1ad` 文档与实现对齐 · `ccde864` README 按公开仓库规范重写 · `4786f70` 过渡计划（`plans/`） · `118bad4` 统一软引用 · `c48a577` 修订号顺序 · `738285d` 引用修正 · `81ec95e` 修订 12 补记哈希 |
| 结案：移除回合行（0.3.0） | `c644e4c` 否决修订 8/13 结案 + 移除回合行与动作条变体 + 实验结论入 §9 + README 按标准安装说明重排 |
| 发布与收录（0.3.0） | `098a31c` 去 `private` + `engines.dsh` + README 安装段改 npm 优先 · `cf1acdf` 修订 14 / §10 发布与收录 |
| 截图与 0.3.1 | `4ff2c0f` `screenshots.json` + `assets/screenshots/*` + README 内嵌 · `9f8b863` 移除 `peerDependencies.react`、发 0.3.1（修订 15） |
| 收录结果（本轮） | 条目 PR 已合并、条目已在 plugins.json；本条补记「站点 ≠ 市场」的目录双源事实与修正后的自检命令 |

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
10. **外部插件事件在 0.1.5-rc.2 是"设计上可读、实际上不可写"**：会话日志的读取侧**支持**未知类型——只要事件带 `SessionEvent.ignorable: true` 就安全跳过（`KNOWN_SESSION_EVENT_TYPES` 的注释明确说仓库外插件事件"by construction"不在名单里，该标记就是兼容机制）。但**写侧没有任何入口能设置它**：`Session.append(type, data, opts)` 只透传 `sourceEventSeqs` / `surfaceOp`，构造出的信封只有 `type/seq/time/data`；`materializeAppendBatch()` 只做 JSON 快照与冻结；`SessionHandle.append()` 是持久化层直写（要求 seq 连续），绕过活动会话日志会让内存日志与存储日志错位，且读取侧照样拒绝。
    **实测（离线，2026-09-21，`dsh-session` + `dsh-session-persistence` 均 `0.1.5-rc.2`）**：`Session.append('usage-state/turn-usage', …)` 写入成功但信封无 `ignorable` → `validateStoredEvents(meta, [event])` 抛 `SessionFormatUnsupportedError`（*"contains event type … unknown to this harness and not marked ignorable; refusing to interpret the log"*）；手工补 `ignorable: true` 后校验通过（证明标记有效、只缺写入口）；对照组 `command/run` 正常通过。
    **结论**：插件**不得**往会话日志追加自有类型事件——日志是 append-only，写进去无法撤销，且会让别人的读取器拒绝重建整个会话。任何"数据跟着会话生命周期走/随会话迁移"的需求，在当前平台版本都没有合法落点。平台也明确否决过"事件名注册"方案。**若将来版本给 `append` 加上该标记（或提供注册通道），这条才需要重写。**
    复现（用平台自己的包，无需启动 DSH；`@deepseek-ai/dsh-session` 与 `-persistence` 未列为本仓库依赖，需从 DSH 安装目录借 `node_modules`）：

    ```js
    const { Session, SessionId } = await import('@deepseek-ai/dsh-session')
    const { validateStoredEvents } = await import('@deepseek-ai/dsh-session-persistence')
    const session = Session.create(SessionId('probe'), [], undefined, 0)
    const event = session.append('usage-state/turn-usage', { probe: true })
    Object.keys(event)                    // ['type','seq','time','data'] —— 没有 ignorable
    validateStoredEvents(session.header, [event])  // throws SessionFormatUnsupportedError
    validateStoredEvents(session.header, [{ ...event, ignorable: true }])  // 通过
    ```
11. **回合级插槽都不适合承载常显的行**：`conversation.chat.turnTail` 是 chain（单赢家，`dsh-client-ui-deliverables` 与 `dsh-better-sidebar` 都注册在此），任何产出文件的回合都会把它们之一选为赢家，其他条目**不会被询问**，`select` 又被契约要求是纯函数、无法让路；`conversation.chat.assistant-actions` 是 list 槽（无抢占），但由平台渲染在**回合动作条**内，而该条在**非最新回合是 `opacity: 0` + `:hover` 才显示**（平台自己的每回合 token/耗时面板也在那里；`MessageIconActions.extraActions` 的位置由平台固定——类型注释原文 *"placed between the built-in copy and branch controls"*，且整条只有 28px 高）。
    这条事实与"要不要在回合上展示账户读数"是两件事：后者已按 `design-consensus.md` 修订 13 **否决**（账户级读数不属于回合），因此本插件现在只挂 `conversation.composer.dock`；上面这些平台行为记录下来，是为了下次有人想在回合动作条里放东西时不必重新踩一遍。

## 10. 发布与收录（npm / dsh-market）

**分发形态**：同一份 `lib/` 供三条安装路径——npm 包 `dsh-usage-state`、`dsh plugin add github:takboo/dsh-usage-state`、本地目录。仓库始终带预构建产物，所以三条路都没有构建步骤。

- 发布前核对内容：`npm pack --dry-run --cache /tmp/npm-cache`。`files` 白名单 = `lib` + `cordis.patch.yml` + 两个 README + LICENSE + `docs/adapters.md`（9 个文件、50.5 kB）。
- 本机 `~/.npm` 不可写时必须带 `--cache /tmp/npm-cache`：否则报 `EPERM`，而 npm 的提示会把它误导成 "cache folder contains root-owned files"（真实原因是写不进去）。
- `npm publish` 需要 2FA：非交互执行会以 `EOTP` 结束并给出 web-auth 链接，浏览器走完认证后再跑一次即可；有认证器可直接 `--otp=<6 位>`。
- 已发布包的 `repository` 必须指回本仓库——市场的 npm 映射靠它自动关联，条目 yml 里手写 `npm:` 会被校验拒绝。

**dsh-market 收录链路**（2026-09-22 对着 dshmarket 1.52.0 源码与 contributing.md 核对）：

1. 市场**不搜索** npm/GitHub，每次打开实时拉 `https://awesome-dsh-plugin.com/plugins.json`（拉取时 4062 条；可用 `DSHM_REGISTRY_URL` 指镜像），**只允许安装列表内的来源**，并刻意不做本地快照兜底。
2. 列表由 `awesome-dsh-plugin/awesome-dsh-plugin` 的 `data/plugins/*.yml` 生成（两个 README 是生成物，禁止手改）。收录 = 提一个 YAML 文件的 PR：`url` / `name` / `category` / `description.{en,zh}`，只有 `description.en` 必填；描述会被逐句对着源码核，必须属实、不带营销词；一个 PR 最多 3 条。
3. 硬性门槛：仓库声明 `dsh.bundle`（**只有** `dsh.client` 会被拒）、仓库创建满 1 天、仓库打 `dsh-plugin` topic。
4. 卡片上的 `DSH …` 徽标与兼容判定来自 **npm latest 清单**：`engines.dsh`（或 `dsh.engines.dsh`）优先，其次同版本线的 `@deepseek-ai/dsh-*` peerDependencies；两者都没声明（或没有 npm 包）→ 状态 unknown，条目仍可见，只是没有下载量与徽标。市场对 `engines` 是**硬判定**，对 peer 的 caret/tilde 上限反而宽容。
5. 截图可选，放在**本仓库**的 `screenshots.json`（1–8 张，路径相对该文件，或 GitHub 托管的 https）；不声明则市场从 README 自动抽取。

**本次上架记录**：条目 `data/plugins/takboo__dsh-usage-state.yml`，分类 `usage`，PR [awesome-dsh-plugin#5646](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/5646)（CI `check` + `Submission gate` 全绿），**已于 2026-09-22T07:20:07Z 被 `fkysly` 合并**（merge commit `f48265c`）；仓库已加 `dsh-plugin` topic；`engines.dsh` = `>=0.1.5-rc.1 <0.2.0-0`。

**收录结果（2026-09-22 核验，含一处重要更正）**：合并后**站点**（GitHub Pages）立刻重建，`https://awesome-dsh-plugin.com/plugins.json` 从 4125 涨到 **4145** 条，我们的条目在列——`category: usage`、中英描述、`added: 2026-09-22`，三张截图被正确采集，上游生成的 `README.zh.md` 第 976 行也出现了我们那一行。
**但「站点里有」≠「市场里能搜到」**：市场按 region 选目录源（`dshmarket` 的 `regions.ts`），**中国大陆区优先读 npm 包 `dsh-plugin-catalog`**（走腾讯云 npm 镜像 `mirrors.cloud.tencent.com/npm`，实时站点只作为失败回退），而那个包是**每日 ~03:30Z 构建**的：观测到的最近 6 次都是 `2026.9xx.NNNN`（版本号里就是条数），最新 `2026.922.4045` 发布于 **2026-09-22T03:35:06Z**，包内 `count=4125`、**不含我们**（我们的 PR 是 07:20Z 合并的）。所以当天在中国区市场搜不到，要等次日构建；`全球` 区直接读实时站点，立即可见。
**已安装卡片的元数据匹配**：市场客户端用 `plugin.npm === name || plugin.name === name` 把已安装包关联到目录条目（`MarketSection.tsx`）。我们的条目 `name` 就是 `dsh-usage-state`，所以条目一旦进入市场所读的那份目录，卡片就会带上描述/分类/star；`npm` / `version` / `downloads` / `install` 命令与 `DSH …` 徽标（读 npm latest 的 `engines.dsh`）同样在那次每日构建里补齐——我们的 `repository` 已指回本仓库，映射条件满足。
**教训（写进自检命令）**：只查实时站点会得出"已收录"的乐观结论。自检要同时查市场真正读的那份每日目录包。
截图按市场约定声明在**本仓库**：`screenshots.json` 列 3 张（状态行 / 设置页供应商列表 / 高级区），图片在 `assets/screenshots/*.webp`（39–98 kB）；两个 README 也内嵌了同一组（用 `raw.githubusercontent.com` 绝对链接，GitHub 与 npm 页都能显示）。截图声明不需要再提 PR——市场下一次 nightly 构建会自行采集。

**npm 发布记录**：`dsh-usage-state@0.3.0` 已发布（2026-09-22），`repository` 指回本仓库、`engines.dsh` 随包带出（`npm view` 已核对）。本机 web profile 已从 GitHub 源切到 npm 源（`pnpm-lock.yaml` 里 `specifier: ^0.3.0`、integrity 与发布输出逐字符一致），重启后运行中的客户端产物只剩 `conversation.composer.dock` 一个挂载点。**`0.3.1`**（同日发布）移除 `peerDependencies.react`（见修订 15）。验证：在**全新 pnpm store + 全新 XDG** 下跑 `dsh plugin --profile smoke add dsh-usage-state` → 装到 **0.3.1**、profile 里写 `^0.3.1`、**不再出现 `✕ missing peer react`**（只剩 pnpm 那句 `Added 1 entry to minimumReleaseAgeExclude` 提示，与我们的包无关）。
踩过的坑：第一次复用了同一个 pnpm store，metadata 缓存里还只有 0.3.0，于是装到 0.3.0 并照旧报 peer 警告——那是我自己的缓存假象，不是发布问题。另注意 pnpm 12 对**刚发布**的版本有内置静置期（`pnpm config get minimumReleaseAge` 为 `undefined`，说明是默认值而非显式配置），它会自动往 profile 的 `pnpm-workspace.yaml` 写 `minimumReleaseAgeExclude` 并在装好后打印提示；所以"刚发的版本要显式指定或等静置期过去"是**预期行为**，不是故障。发布后在 `/tmp` 做了一次产物级安装校验：安装树里 `package.json` 的 `dsh.bundle.patch`、`cordis.patch.yml`（`insert.name: dsh-usage-state`）、`lib/{index,client,typert}.js` 全部存在。

**端到端安装验证**（2026-09-22，把 `DSH_HOME` 指到 `/tmp/dsh-home-verify` 绕开宿主沙箱对 `~/.dsh` 的写限制，因此不需要动用户的真实 profile）：跑市场将来会执行的那条命令

```bash
DSH_HOME=/tmp/dsh-home-verify dsh plugin --profile smoke add dsh-usage-state
DSH_HOME=/tmp/dsh-home-verify dsh --profile smoke --dump-config
```

结果：pnpm 从 npm 装上 `dsh-usage-state@0.3.0`（1.2s），装配树里出现我们贡献的那一行

```yaml
# == dsh-usage-state
- id: usage-state
  name: dsh-usage-state
```

即「npm 源 → profile 依赖 → patch 行 → 装配树」整条链路可用。**唯一的噪声是 pnpm 的 `✕ missing peer react`**：fresh profile 的依赖图里没有 react（浏览器半边的 react 是平台在运行时交给插件的，不走 node_modules），而我们 `peerDependencies` 里声明了 `react: ^18.2.0`。它只是警告（安装照常成功），且市场只对 `@deepseek-ai/dsh*` 的 peer 做兼容评估，所以不影响条目的兼容判定与徽标；是否移除这个 peer 仍在待定（见 §6 备忘）。

**维护待办**：DSH 出现 0.2 发布线时复核 `engines.dsh` 区间（超出区间会被市场标 incompatible，可选筛选会因此隐藏条目）；改描述只改自己那条 yml，换截图只改本仓库的 `screenshots.json`，都不要动对方 README。

**收录自检**（合并后随时可跑）。**两个源都要查**：站点是合并后立刻重建的，而中国大陆区市场读的是每日构建的 npm 目录包——只查站点会把"站点已收录"误当成"市场能搜到"：

```bash
# 1) 实时站点（≈ 全球区市场看到的）
curl -s https://awesome-dsh-plugin.com/plugins.json | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('site:', d['count'], d['updated'], [p['name'] for p in d['plugins'] if p['owner']=='takboo'] or 'no')"

# 2) 每日目录包（≈ 中国大陆区市场看到的；确认包内条数是否已包含我们）
curl -s https://registry.npmjs.org/dsh-plugin-catalog | python3 -c "
import json,sys
d=json.load(sys.stdin); v=d['dist-tags']['latest']
print('catalog pkg:', v, 'published', d['time'][v])"
```

判据：站点条数与我们条目都在 → 全球区可见；目录包的版本号（`YYYY.MDD.NNNN`，NNNN 是条数）大于我们合并时的条数 → 中国区可见。

**上游节奏（2026-09-22 观测）**：维护者是**批量合并**（某次连续 6 个条目 PR 在同一分钟内合掉，最早的一个已等了约 6 小时），同时开放着 100+ 个待审 PR——从提交到收录按「天」预期，别按分钟等。
