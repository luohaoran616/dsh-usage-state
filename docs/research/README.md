# 侦察文档（Research）

本目录存放为 `dsh-usage-state` 做决策而进行的**只读**调查结果。这些是**事实材料，不是共识**——共识见 [`../design-consensus.md`](../design-consensus.md)，实现与验证状态见 [`../implementation.md`](../implementation.md)。

侦察时间：**2026-09-20**。环境：DSH `0.1.5-rc.2`，插件 profile `web`（`~/.dsh/profiles/web`），home 为 `/Volumes/M2ExHome/rockman`（注意 `~` 不是 `/Users/rockman`）。

## 索引

| 文档 | 内容 | 方法 | 可信度 |
|---|---|---|---|
| [`provider-balance-quota-apis.md`](provider-balance-quota-apis.md) | 各厂商余额 / 额度接口矩阵：端点、鉴权、返回结构、是否提供 5h/7d 与 `resets_at`、限流；含本机配置现状 | web 检索 + 官方文档 + 第三方实现交叉印证 | 官方端点可信；标注 `unverified` 的为逆向/未验证接口 |
| [`sub2api-gateway.md`](sub2api-gateway.md) | `Wei-Shaw/sub2api` 自建网关的定位、同名 fork 辨析，以及可用于查询余额/额度的接口（key 侧 `/v1/usage` 与需 JWT 的面板侧） | 固定 commit 源码逐行阅读 + 同名 npm 插件交叉印证 | 接口存在性可信；**字段名观测到前后端漂移，且实测环境 502 无法活体验证** |
| [`dsh-cost-meter-analysis.md`](dsh-cost-meter-analysis.md) | 被替代插件 `dsh-cost-meter@1.7.28` 的完整剖析：包结构、设置体系、全部外部端点、UI 插槽用法、5h/7d 逻辑、依赖的 DSH API | 只读阅读已安装的 `lib/*.js` 与 `.d.ts` | 源码引用可信（含文件与行号）；客户端为压缩产物，只能从 bundle 反推 |
| [`typert-rpc-minimal-contract.md`](typert-rpc-minimal-contract.md) | 宿主 `./typert` 导出与清单形状、zod v4 硬要求、客户端 `$mount` 描述符、以及三个坑（`typertRemote` 必须自引用服务对象、描述符必须声明 `result`、参数个数精确匹配） | 逐行阅读平台源码 + 反查压缩客户端 bundle + 平台校验器实测 | 高（实现后已用平台 `validateTypertManifest` 验证清单通过；见 `../implementation.md` §8） |

## 使用注意

1. **不要把这些文档当成约定**。其中部分接口（Anthropic OAuth usage、z.ai monitor、MiniMax、Kimi Code、CodeX `wham/usage`、Antigravity、sub2api `/v1/usage`）属于未文档化的内部接口，随时可能变更；实现时必须容错解析并配单测。
2. 每份文档内部都标注了各自的 **unverified** 条目，引用前先看那一节。
3. 文档中的本机配置结论有时效性（例如 `settings.yaml` 曾被实时重写，`llm-pi-ai.providers` 从有到无）。
4. **凭据安全**：文档只记录键名与来源，不记录密钥值。但侦察过程中有一次命令输出曾**短暂回显过 `DEEPSEEK_API_KEY` 的值**——若在意，建议轮换该 key。
5. **已经过真机验证的结论**（z.ai 用 HTTP 200 表达鉴权失败、coding plan 的 key 分区域、`typertRemote` 必须自引用等）已沉淀到 [`../implementation.md`](../implementation.md) §8，可优先信那一节。
