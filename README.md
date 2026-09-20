# dsh-usage-state

**中文** | [English](README.en.md)

在 [DSH（DeepSeek Harness）](https://github.com/deepseek-ai) 里一眼看到你的**账户余额**或**套餐额度**——就在输入框下方和每个已完成回合的下方。

> A minimal DSH plugin that shows your account **balance** (API mode) or **coding-plan quota** (5h / 7d) for the model you are using, right under the composer and every completed turn.

```
输入框统计行下方：      z.ai / GLM · 5h 12% (4h0m) ▓▓▓░░░░░ · 7d 59% (3d17h) ▓▓▓▓▓░░░
                        DeepSeek · ¥58.13
悬停任意一段：          Source DeepSeek · Mode API balance · Granted 0 · Topped up 58.13
```

## 特性

- **零配置可用**：按 provider 自动识别该用哪个数据源与模式，DSH 里配过的密钥会被自动复用，不填任何东西就能看到读数。
- **账户级配置**：余额与额度是账户级的，所以每个供应商只配一次（`自动` / `API` / `Coding Plan` / `隐藏`），模型清单只作展示。
- **两处展示**：输入框统计行的正下方一行，以及每个已完成回合的下方一行；两处共用同一套解析规则。
- **失败不撒谎**：请求失败时保留上次成功值并标明「多久之前 + ⚠」，**绝不显示 0 或伪造数据**；密钥无效、接口报错、网络不可达会分别给出可读原因。
- **悬浮提示**：每段文字悬停显示一行放不下的信息——数据源与模式、窗口的绝对重置时刻、余额的赠送/充值构成、失败原因与原始消息。
- **中英双语**：跟随 DSH 的语言设置（`locale.preference`），设置页与状态行都不含硬编码文案。
- **只做显示**：没有会话成本统计、价格目录、历史账单、预算、峰谷计价——`dsh-cost-meter` 里除展示之外的逻辑这里一律不做。

## 安装

```bash
dsh plugin --profile web add github:takboo/dsh-usage-state
```

装好后**重启 DSH**（插件的 bundle patch 只在启动时读取）。卸载：

```bash
dsh plugin --profile web remove dsh-usage-state
```

开发时可直接装本地目录：`dsh plugin --profile web add /path/to/dsh-usage-state`。

## 快速开始

1. 打开 **设置 → 用量状态**：DSH 里配置的每个供应商一行。
2. 保持默认的 **自动** 即可（它会识别数据源与主模式）；需要时改成 `API` / `Coding Plan` / `隐藏`，或用 ↑↓ 调整顺序。
3. 该供应商的账户读数会出现在输入框下方与每个回合下方。

若某个数据源需要端点或密钥（例如自建的 Sub2API、或尚未配置的 z.ai），展开该行的 **高级**：可覆盖数据源、填接口地址、指定凭据名、粘贴密钥（写入 DSH 凭据库）。

## 支持的数据源

| 数据源 | API 模式 | Coding Plan 模式 | 凭据 |
|---|---|---|---|
| DeepSeek 官方 | 余额（CNY / USD） | —（官方无 coding plan） | `DEEPSEEK_API_KEY` |
| z.ai / 智谱 GLM | — | 5h / 7d 已用 % | `ZAI_API_KEY` 等 |
| Kimi 国内版 | Moonshot 按量余额 | Kimi Code 订阅窗口 | `MOONSHOT_API_KEY` / `KIMI_CODING_API_KEY` |
| Sub2API（自建网关） | 余额 / key 配额 | `rate_limits[]` 的 5h / 7d | `SUB2API_API_KEY` + 实例地址 |

- **z.ai 分区域**：coding plan 的 key 只在自己区域的站点有效（国内 `open.bigmodel.cn` / 国际 `api.z.ai`）。默认国内站，失败时自动镜像重试；也可在设置里钉死端点。
- **其他厂商**（Claude Pro/Max、MiniMax、OpenRouter、Codex、Antigravity、Volcengine Ark…）未实现，但适配器契约与候选清单已备好，见 [`docs/adapters.md`](docs/adapters.md)。

## 显示与交互

**位置**：`conversation.composer.dock`（统计行正下方，几何与原生行对齐）与 `conversation.chat.assistant-actions`（回合动作条内，每个已完成回合一次）。
注意动作条由平台控制显隐：**最新回合常显，历史回合悬停才显示**（平台自己的每回合 token/耗时面板也在同一位置）。

**元素**：供应商标签 · 余额金额 + 币种 · 5h / 7d 已用百分比 · 重置倒计时 · 迷你进度条 · 阈值变色（默认 ≥80% 黄、≥95% 红，可在设置里改）。

**口径**：百分比一律是**已用**（与 z.ai / Claude 官方一致）；API 模式显示余额，Coding Plan 模式显示 5h / 7d。

**降级**：

| 情况 | 显示 |
|---|---|
| 未配置 | 灰色「未配置」 |
| 自建源缺端点 | 「需要先填写接口地址」 |
| 请求失败（有旧值） | 旧值 + `12m ago` + `⚠`，悬停给出原因 |
| 首次失败（无旧值） | 只显示本地化原因（不显示 0） |

## 刷新与网络

- 回合结束后 **2 秒**刷新（等 provider 结算），空闲时每 **5 分钟**兜底。
- 同一数据源 **60 秒**内不重复发真实请求；并发调用共享同一次在途请求；失败的请求不节流（可立即重试）。
- 刷新间隔可在设置里调整。

## 凭据与隐私

- 凭据探测顺序：设置页覆盖 → 供应商声明的 `apiKeyEnv`（`llm-deepseek` / `llm-pi-ai`）→ 数据源内置的 ref 名 → DSH 凭据库。
- 密钥在设置页写入 **DSH 凭据库**（`~/.dsh/.credentials.yaml`）；**插件自身不保存明文**。客户端只拿到「是否已配置 / 来源」，永远拿不到密钥值。
- 环境变量提供的密钥是只读的：界面会禁用输入框并说明原因。
- 插件读取的内容只有余额/额度数字与会话当前使用的模型，**不写会话日志**，也不上报任何数据。

## 兼容性

- 实测环境：DSH `0.1.5-rc.2`，Node ≥ 20（`engines`）。
- 通过 GitHub 安装，**不发布到 npm**（`private: true`）。
- 版本 `0.1.0`：DeepSeek 与 z.ai 已在真机验证，其余见下。

## 已知限制

- **Kimi、Sub2API 未经真机验证**（本机无凭据），代码与单测已就绪；Sub2API 的 `/v1/usage` 属未文档化接口，已按易错接口做容错。
- **回合下方显示的是"当前值"而非"该回合结束时的值"**——两处读数同源；且历史回合需要悬停查看（动作条的平台行为）。要固定成"当时的值 + 较上一回合的变化"并让历史回合常显，需要会话事件 + 自有节点（方案见 `plans/` 下的过渡文档）。
- **点击状态行不会打开设置**（客户端没有公开的"打开设置面板"服务）；细节通过悬浮提示呈现。
- 完整清单见 [`docs/implementation.md`](docs/implementation.md) §6。

## 开发

```bash
npm install          # 若 ~/.npm 不可写：npm install --cache /tmp/npm-cache
npm test             # node:test 直接跑 .ts / .tsx（需要 Node >= 22.6）
npm run typecheck    # tsc --noEmit
npm run build        # tsdown → lib/（宿主 index.js + typert.js，浏览器 client.js）
npm run watch        # 只重建 client.js；客户端会被 HMR 热替换，无需刷新页面
```

宿主机改动需要重启 DSH；客户端改动 `npm run watch` 即可。`lib/` 产物**必须提交进仓库**——`dsh plugin add github:...` 直接装仓库、没有构建步骤（`npm test` 里的构建守卫会检查信封、require 白名单与 `exports` 指向）。

```
src/host/        宿主：数据源适配器、缓存调度、凭据、设置、RPC
src/client/      浏览器：词典、状态行、设置页、状态镜像
src/shared/      两端共用：类型、配置、provider 解析、显示逻辑
lib/             构建产物（提交，供 github 安装）
tests/           与 src 对应；tests/build 校验的是产物本身
```

## 文档

| 文档 | 内容 |
|---|---|
| [`docs/implementation.md`](docs/implementation.md) | 实现与验证总览：代码地图、决策→实现→测试→验证追溯、未验证清单、平台注意事项 |
| [`docs/adapters.md`](docs/adapters.md) | 添加数据源：契约、四步流程、约定与坑、候选厂商、排查表 |
| [`docs/design-consensus.md`](docs/design-consensus.md) | 设计共识与修订记录（每条决策的来龙去脉） |
| [`docs/research/README.md`](docs/research/README.md) | 只读侦察报告索引（各厂商接口、被替代插件剖析、DSH RPC 契约） |

## 许可

[MIT](LICENSE)
