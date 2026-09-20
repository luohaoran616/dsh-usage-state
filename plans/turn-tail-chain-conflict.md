# BUG 计划：回合行在有产出/交付物的回合被 chain 插槽挤掉

> **过渡文档**：修复完成、结论回写到 `docs/implementation.md` §6 之后，删除本文件。
> 状态：**待决策**（已定位根因，方案三选一）
> 日期：2026-09-20
> 现象记录者：用户（截图：某回合下方是 `Produced implementation.md`，但没有 `DeepSeek · ¥56.45`）

## 1. 现象

`conversation.chat.turnTail` 那一行**只在部分回合出现**：凡是该回合产出了文件/交付物（界面上出现 `Produced …` 或交付物卡片），我们的余额/额度行就消失。

## 2. 根因（已核实，带证据）

`conversation.chat.turnTail` 是 **chain** 插槽，契约原文（`dsh-client-ui-chat/lib/types/client/contract/slots.d.ts`）：

> Selector-routed extension before a completed Turn's action row. … **The first selector that accepts the owner renders; an all-declined chain is empty.**

即**每条回合只允许一个条目渲染**。该插槽当前的注册者：

| 注册者 | 角色 | 行为 |
|---|---|---|
| `@deepseek-ai/dsh-client-ui-deliverables` | 平台自带 | `select: selectDeliverables`，无交付物时返回 `null` |
| `dsh-better-sidebar` | 已安装第三方 | `priority: -1`，`select: selectProducedFiles`，无产出文件时返回 `null`（其注释写明"模仿 deliverables 的注册"） |
| **`dsh-usage-state`（我们）** | 本插件 | `priority: 1`，`select: () => ({})`（总是认领） |

selector 按 **priority 升序**依次询问，第一个返回非 `null` 的条目胜出。于是：

- 该回合没有产出/交付物 → 前两者返回 `null` → 轮到我们 → 我们的行出现（**这是大多数回合的情况，所以此前没被发现**）；
- 该回合有产出/交付物 → 前两者之一先认领 → **我们的 selector 根本不会被询问** → 那一行消失。

**插槽内无法修复**：

1. chain 只有一个赢家，没有"并列渲染"的机制；
2. `select` 被契约要求是**纯函数**（"a function of the owner props only, no external mutable reads"），所以我们不能通过读取"别人是否要认领"来主动让路，也不能据此做条件渲染；
3. `ChainRenderOpts.overlay`（让 fallback 与赢家并存）平台**只在 `conversation.composer` 链上使用**，turnTail 的 owner 没有开这个口子；
4. 把优先级提到 `-2` 能让我们永远赢，但会**抢掉别人的产出文件行**（deliverables 与 better-sidebar 的功能被我们弄没）——不可接受。

## 3. 三个选项

### (A) 改挂 `conversation.chat.assistant-actions`（list，无竞争）— **推荐**

- 该槽是 **list**：所有条目都会渲染，不存在抢占（平台自己的 `dsh-client-ui-message-feedback` 也在用）；
- 代价 1：它是**按"已定稿的助手消息"**触发（owner `{messageId}`），而一个回合可能有多个 step、每个 step 都有助手消息 → 直接挂会**一个回合重复多行**；
- 代价 2：它渲染在**动作行**里（与复制/分叉等按钮同一行），视觉位置与现在略有不同（更紧凑）；
- 需要配套的**"只在回合末尾渲染"过滤**：组件里可用会话标准套件里的 `useChat` 读快照节点，判断"这条助手消息之后、同一回合内是否还有助手消息"，有则返回 `null`。平台自己的 ui-chat 就是用快照里的 `closing.finalNode.seq` 定位回合末尾的，说明该结构是可用信息（但仍属平台内部形状，需用可选链容错）。

### (B) 接受现状并写进文档

- 零改动；但表现为"有时有、有时没有"，用户无法预期，我认为不该作为最终形态。

### (C) 去掉回合行，只保留输入框那一行

- 最省、最一致；但放弃了"轨迹"这个诉求（也正是 `plans/turn-usage-pinning.md` 想要的东西）。

## 4. 若选 (A)：实施切分（TDD）

1. `fix(client): 回合行改挂 assistant-actions，并只在回合末尾渲染`
   - 注册 `{ name: 'conversation.chat.assistant-actions', id: 'usage-state', order: 1, locale, inject }`；
   - 组件新增"回合末尾"判定（纯函数 + 快照容错）：给定节点列表与当前 messageId → 是否为本回合最后一条助手消息；
   - 测试：`tests/client/` 新增判定函数的单测（多 step / 单 step / 找不到节点 / 快照为空都返回安全值），并更新 SSR 渲染用例；
   - 卸载旧的 turnTail 注册（否则在没产出的回合会**双行**）。
2. `docs: 更新 implementation.md §6（该 BUG 标注已修复并说明实现方式），删除本文件`。

## 5. 验收

1. 连续跑几个回合，其中**至少一个产出文件**；
2. 每个回合下方都应有一行用量，**包括有 `Produced …` 的那些**；
3. 多 step 的回合**只出现一行**（不重复）；
4. `Produced …` 行本身仍然正常（我们不再占用 turnTail，别人照常渲染）；
5. `npm test` 全绿（新增判定函数用例）。

## 6. 备注

- 这个 BUG 与 `plans/turn-usage-pinning.md`（回合固定值 + Δ）**目标相同但解耦**：本文件解决"回合行是否出现"，那份解决"回合行显示什么值"。建议先修本文件（用户可见的一致性问题），再决定是否做固定值。
- 若最终选 (A)，`turn-usage-pinning` 的客户端落点也随之改为 `assistant-actions`，需同步那份计划（或合并进同一批实施）。
