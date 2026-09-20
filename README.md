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
- ⬜ 本地装入 web profile 验收 → 卸载 `dsh-cost-meter`
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
| [`docs/research/README.md`](docs/research/README.md) | 侦察文档索引与可信度说明 |

## 开发

目标环境：DSH `>= 0.1.5-rc.2`，插件 profile `web`（`~/.dsh/profiles/web`）。

构建产物 `lib/` **需要提交进仓库**——`dsh plugin add github:...` 直接从仓库安装，没有构建步骤。

```
docs/            设计与侦察文档
src/             源码（待建）：host / client / adapters
lib/             构建产物（提交，供 github 安装）
```

---

## English (short)

A minimal DSH plugin that displays, for the model currently in use, either the account **balance** (API mode) or the **coding-plan quota usage** (5h / 7d percentage with reset countdown). Model list is auto-discovered from DSH, each model is assigned `API` / `Coding Plan` / `Hidden`, and the line is rendered under each completed turn and directly below the composer stats row. Bilingual (zh / en), following the DSH locale.

Scope is display-only: no cost accounting, pricing catalog, history, budgets, or peak/off-peak alerts. Design is frozen in [`docs/design-consensus.md`](docs/design-consensus.md); implementation has not started yet.
