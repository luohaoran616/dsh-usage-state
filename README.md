# dsh-usage-state

一个精简的 [DSH (DeepSeek Harness)](https://github.com/deepseek-ai) 插件：只做**余额 / 额度显示**。

A minimal DSH plugin that shows **account balance** (API mode) or **coding-plan quota usage** (5h / 7d windows) for the model you are currently using.

## 安装

```bash
dsh plugin --profile web add github:takboo/dsh-usage-state
# 然后重启 DSH（bundle patch 只在启动时读取）
```

开发时可以直接装本地目录：`dsh plugin --profile web add /path/to/dsh-usage-state`。

## 这个插件做什么

- 自动读取 DSH 里配置的供应商，在设置页按你的顺序每个供应商一行。
- 每个供应商选一次模式：`自动`（默认）/ `API` / `Coding Plan` / `隐藏`。余额与额度是**账户级**的，所以不需要按模型重复配置；`自动` 会自己识别该用哪个数据源。
- `API` 模式显示账户余额；`Coding Plan` 模式显示 5h / 7d 已用百分比、重置倒计时。
- 展示在两个位置：每个已完成回合下方，以及输入框统计行正下方；回合结束与空闲 5 分钟各刷新一次。
- 设置页与状态行中英双语，跟随 DSH 语言设置。

## 不做什么

会话成本统计、模型价格目录、历史账单、预算图框、峰谷计价提醒、自定义余额端点、会话日志回填——也就是 `dsh-cost-meter` 里除展示之外的全部逻辑，这里都不做。

## 状态

**实现完成、已发布、已在本机验收通过。**

- ✅ 实现：宿主半边（四家数据源 / 缓存与调度 / 凭据 / 设置命名空间 / Typert RPC）+ 客户端半边（双语状态行 / provider 级设置页）+ 构建产物（`lib/`）
- ✅ 已发布：<https://github.com/takboo/dsh-usage-state>
- ✅ 真机验收：DeepSeek 余额（`DeepSeek · ¥58.13`，随消耗实时变化）、z.ai / GLM 额度（`z.ai / GLM · 5h 12% (4h0m) ▓▯▯▯ · 7d 59% (3d17h)`）、悬浮提示、失败如实显示、设置页 provider 三态与排序
- ✅ 已卸载 `dsh-cost-meter`（重启后生效；历史数据 `~/.dsh/storages/cost-meter/` 保留未动）
- ✅ `dsh plugin add github:takboo/dsh-usage-state` 已实测可装（在临时目录安装发布包，宿主入口 / typert 清单 / client bundle / cordis.patch.yml 均校验通过）

**尚未用真实 key 覆盖的部分**（代码与单测已就绪）：Kimi（Moonshot 余额 + Kimi Code 窗口）、Sub2API（`/v1/usage`）、阈值变色的视觉效果（12%/59% 未触发阈值；把黄色阈值临时改成 10 即可看到）。

出问题时的一键恢复：`dsh plugin --profile web remove dsh-usage-state`。

## v1 支持的数据源

| 数据源 | API 模式 | Coding Plan 模式 |
|---|---|---|
| DeepSeek 官方 | 余额（CNY/USD） | —（官方无 coding plan） |
| z.ai / 智谱 GLM | — | 5h / 7d 已用 % |
| Kimi 国内版 | Moonshot 按量余额 | Kimi Code 订阅窗口 |
| sub2api（自建网关） | 余额 / key 配额 | `rate_limits[]` 的 5h / 7d |

z.ai 的 coding plan 分国内/国际两个站点，**key 只在自己区域有效**；默认国内站，失败时自动镜像重试（也可在设置里钉死端点）。

其余厂商（Claude Pro/Max、MiniMax、OpenRouter、Codex、Antigravity、Volcengine Ark 等）只保留 adapter 契约与实现文档，不写实现。

## 文档

| 文档 | 内容 |
|---|---|
| [`docs/design-consensus.md`](docs/design-consensus.md) | **主文档**：范围、数据源、配置模型、密钥策略、展示与刷新、工程形态、验收步骤、风险 |
| [`docs/implementation.md`](docs/implementation.md) | **实现与验证总览**：代码地图、决策→实现→测试→验证追溯表、未验证清单、平台硬知识 |
| [`docs/adapters.md`](docs/adapters.md) | **添加数据源**：契约、四步流程、约定与坑、候选厂商清单、排查表 |
| [`docs/research/README.md`](docs/research/README.md) | 侦察文档索引与可信度说明 |

## 本地验收清单

重启 DSH 后依次确认（当前机器上只有 `DEEPSEEK_API_KEY`，所以第 3–5 步先只有 DeepSeek 可验）：

| # | 操作 | 期望 |
|---|---|---|
| 1 | 打开设置 → 侧边栏出现「用量状态」 | 页面能打开，中英跟随 DSH 语言设置切换 |
| 2 | 供应商列表 | 列出 DSH 里配置的供应商（每个一行，含其模型清单）；DeepSeek 显示「自动识别为 DeepSeek · API balance」 |
| 3 | 用默认的「自动」（或点「API balance」） | 输入框下方的统计行正下方出现一行，显示 `DeepSeek · ¥余额`；每个已完成回合下方也有一行 |
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
