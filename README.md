# dsh-usage-state

一个精简的 [DSH (DeepSeek Harness)](https://github.com/deepseek-ai) 插件：只做**余额 / 额度显示**。

A minimal DSH plugin that shows **account balance** (API mode) or **coding-plan quota usage** (5h / 7d windows) for the model you are currently using.

## 这个插件做什么

- 自动读取 DSH 里已配置的模型，在设置页按你的顺序列出。
- 为每个模型选择模式：`API` / `Coding Plan` / `隐藏`。
- `API` 模式显示账户余额；`Coding Plan` 模式显示 5h / 7d 已用百分比、重置倒计时。
- 展示在两个位置：每个已完成回合下方，以及输入框统计行正下方；回合结束与空闲 5 分钟各刷新一次。
- 设置页与状态行中英双语，跟随 DSH 语言设置。

## 不做什么

会话成本统计、模型价格目录、历史账单、预算图框、峰谷计价提醒、自定义余额端点、会话日志回填——也就是 `dsh-cost-meter` 里除展示之外的全部逻辑，这里都不做。

## 状态

**设计共识已达成，实现尚未开始。**

- ✅ 需求澄清（grilling）：全部决策已闭环 → [`docs/design-consensus.md`](docs/design-consensus.md)
- ✅ 事实侦察：平台 API、各家余额/额度接口、被替代插件的源码剖析 → [`docs/research/`](docs/research/README.md)
- ⬜ 实现（见共识第 12 节的顺序）
- ✅ 实现完成：宿主半边（4 家适配器 / 缓存调度 / 凭据 / 设置命名空间 / RPC）+ 客户端半边（双语状态行 / 设置页）+ 构建产物（`lib/`）
- ✅ 已装入本机 web profile（`dsh plugin add`，profile 树里能看到 `usage-state` 行；宿主入口、typert 清单、client bundle 均已从 profile 视角验证可解析加载）
- ⬜ UI 验收：需要**重启 DSH**（bundle patch 只在启动时读取），然后走下面的验收清单
- ⬜ 卸载 `dsh-cost-meter`
- ⬜ 发布，使 `dsh plugin add github:takboo/dsh-usage-state` 可用

## v1 支持的数据源

| 数据源 | API 模式 | Coding Plan 模式 |
|---|---|---|
| DeepSeek 官方 | 余额（CNY/USD） | —（官方无 coding plan） |
| z.ai / 智谱 GLM | — | 5h / 7d 已用 % |
| Kimi 国内版 | Moonshot 按量余额 | Kimi Code 订阅窗口 |
| sub2api（自建网关） | 余额 / key 配额 | `rate_limits[]` 的 5h / 7d |

其余厂商（Claude Pro/Max、MiniMax、OpenRouter、Codex、Antigravity、Volcengine Ark 等）只保留 adapter 契约与实现文档，不写实现。

## 文档

| 文档 | 内容 |
|---|---|
| [`docs/design-consensus.md`](docs/design-consensus.md) | **主文档**：范围、数据源、配置模型、密钥策略、展示与刷新、工程形态、验收步骤、风险 |
| [`docs/adapters.md`](docs/adapters.md) | **添加数据源**：契约、四步流程、约定与坑、候选厂商清单、排查表 |
| [`docs/research/README.md`](docs/research/README.md) | 侦察文档索引与可信度说明 |

## 本地验收清单

重启 DSH 后依次确认（当前机器上只有 `DEEPSEEK_API_KEY`，所以第 3–5 步先只有 DeepSeek 可验）：

| # | 操作 | 期望 |
|---|---|---|
| 1 | 打开设置 → 侧边栏出现「用量状态」 | 页面能打开，中英跟随 DSH 语言设置切换 |
| 2 | 模型列表 | 列出 DSH 里配置的模型；`deepseek-flash` 已自动建议数据源 `DeepSeek` 且模式为「隐藏」 |
| 3 | 把 `deepseek-flash` 设为「API 余额」 | 输入框下方的统计行正下方出现一行，显示 `DeepSeek · ¥余额`；每个已完成回合下方也有一行 |
| 4 | 点「立即刷新」 | 余额更新，时间戳随之变化 |
| 5 | 断开网络/改成错误密钥 | 显示上次成功值 + ⚠，悬停提示"显示的是上一次成功获取的值"；不显示 0 或空白 |
| 6 | 配置 z.ai / Kimi / Sub2API | 选对应数据源后出现「接口地址」「密钥」区块；填入后 coding-plan 模式显示 `5h x% (倒计时) · 7d y%` |
| 7 | 改显示设置 | 阈值变色、进度条开关、刷新间隔立即生效 |

## 开发

目标环境：DSH `>= 0.1.5-rc.2`，插件 profile `web`（`~/.dsh/profiles/web`）。

```bash
npm install          # 依赖（若 ~/.npm 不可写，加 --cache /tmp/npm-cache）
npm test             # node:test 直接跑 .ts（需要 Node >= 22.6；本机 26.x）
npm run typecheck    # tsc --noEmit
npm run build        # tsdown → lib/（宿主 index.js/typert.js + 浏览器 client.js）
npm run watch        # 只重建 lib/client.js，客户端会被 HMR 热替换，无需刷新页面
```

宿主半边改动需要重启 DSH；`lib/` 产物**必须提交进仓库**——`dsh plugin add github:...` 直接装仓库，没有构建步骤（`npm test` 里的构建守卫会检查信封、require 白名单与 exports 指向）。

```
docs/            设计共识、adapter 扩展文档、侦察报告
src/host/        宿主：适配器、缓存调度、凭据、设置、RPC
src/client/      浏览器：词典、状态行、设置页、状态镜像
src/shared/      两端共用：类型、配置、显示逻辑、RPC 线上类型
lib/             构建产物（提交，供 github 安装）
tests/           与 src 对应；tests/build 校验的是**产物**本身
```

---

## English (short)

A minimal DSH plugin that displays, for the model currently in use, either the account **balance** (API mode) or the **coding-plan quota usage** (5h / 7d percentage with reset countdown). Model list is auto-discovered from DSH, each model is assigned `API` / `Coding Plan` / `Hidden`, and the line is rendered under each completed turn and directly below the composer stats row. Bilingual (zh / en), following the DSH locale.

Scope is display-only: no cost accounting, pricing catalog, history, budgets, or peak/off-peak alerts.

Implementation is complete and already installed into the local `web` profile: a host half (four data-source adapters, refresh scheduler, credential probing, DSH settings namespace, minimal Typert RPC) plus a browser half (bilingual status lines under each completed turn and below the composer stats row, and a settings page with per-model tri-state, reordering and credential status). Verification is by `node:test` (unit tests per module, plus tests over the built artifacts). See [`docs/adapters.md`](docs/adapters.md) to add another provider.
