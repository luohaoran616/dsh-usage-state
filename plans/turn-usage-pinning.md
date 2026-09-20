# 下一阶段计划：回合级固定值 + 较上一回合的变化量

> **这是一份过渡文档。**`plans/` 目录只放"还没做完的事"；本计划实施完成后，**连同本文件一起删除**，并把结果回写到 `docs/implementation.md` §6 与 `docs/design-consensus.md` §13 修订 8。
>
> 状态：**待实验**（第 0 步未跑之前不动实现代码）
> 日期：2026-09-20
> 交叉引用：本计划在 `docs/implementation.md` §6 与 `docs/design-consensus.md` §13 修订 8 中各有一次**软引用**（不写死链接，以免本文件删除后留下死链）。

## 1. 要解决的问题

现在两处状态行（输入框统计行下方 `conversation.composer.dock`、每个已完成回合下方 `conversation.chat.turnTail`）读的是**同一份"最新读数"**（`state.snapshots['<source>:<mode>']`，store 里只保留最新一次）。因此：

- 往下翻旧回合时，每一行显示的其实是**当前值**，不是那个回合结束时的值；
- 于是"回合下方这一行"除了重复，几乎没有信息量。

用户已确认的目标形态是 **C2 + D 合并**：

1. 回合行显示**该回合结束时的固定值**（采样一次，不再随后续刷新变动）；
2. 同时显示**较上一回合的变化量（Δ）**——这才是真正回答"这段对话吃掉了多少额度/余额"的形态；
3. 输入框那一行保持现在的**实时值**不变（两处语义互补：一个看"现在"，一个看"轨迹"）。

## 2. 为什么要持久化（不能只放内存）

宿主内存表（`(sessionId, turn) → 读数`）在**刷新页面**后还好（数据在宿主进程里），但 **DSH 重启后全丢**，老回合又会退化成"显示当前值"。所以要选一个持久化位置。

**首选：session log + 投影。**理由（用户倾向 + 我的认同）：

- **生命周期自动管理**：数据随会话被清理（删除/归档/保留策略），插件不需要自己写清理逻辑，也不会留下孤儿文件；
- **随会话迁移**：会话被 fork / 导出时，这些读数跟着走；
- **平台原生形状**：投影（`ctx.sessionProjections.register`）本来就是"从事件日志折叠出视图"的机制，客户端用 `useProjection` 读取，宿主不需要额外 RPC 面。

**备选：插件自有文件**（`$DSH_HOME/storages/usage-state/turns.json`）。零平台风险，但要自己处理键设计、体积上限、以及"会话删了文件里的记录怎么办"的清理问题；且不随会话迁移。**仅在首选路线被实验否决时才采用**（见 §5）。

## 3. 关键未知（决定了走哪条路线）

平台**读取侧**明确支持"仓库外插件事件"：

- `dsh-session` 类型注释原文：*"Downstream (out-of-repo) plugin events are outside this list **by construction**. The persisted `SessionEvent.ignorable` marker is the compatibility mechanism…"*；
- `KNOWN_SESSION_EVENT_TYPES` 里有 `session-log-deepseek/delivery-accepted` 这样的**命名空间式**先例；
- 持久化后端 `dsh-session-log-deepseek` 会把 `ignorable: true` 透传进记录，并按不透明事件保留。

**但写入侧目前找不到设置该标记的入口**：唯一的追加入口是 `Session.append(type, data, ...opts)`，其类型签名中 `opts` 只对 surface 事件存在，运行时的信封构造也只有 `sourceEventSeqs` / `surfaceOp`——**没有任何参数能设置 `ignorable`**。而文档对读取方的要求是"遇到不认识**且**不可忽略的事件必须拒绝重建会话"，若真如此，直接 append 会**污染用户的会话档案**（别的读取器读不了），这是绝对不可接受的后果。

因此第 0 步必须先回答一个问题：

> **真实的读取侧校验器，会不会拒绝一个"未知类型、不带 `ignorable`"的事件？**

- 若**接受** → 直接 `Session.append('usage-state/turn-usage', …)` 即可，路线 A 成立（不一定需要那个标记）；
- 若**拒绝**，且仍无 API 设置标记 → 路线 A 作废，转路线 B；
- 若**拒绝**但存在设置标记的路径 → 用带标记的路径，路线 A 仍成立。

## 4. 第 0 步：可行性实验（先做，只读性质，产物不进仓库）

**可离线完成**（不需要启动 DSH）：`Session.create(id, seed?, header?, inheritedEventCount?)` 是公开静态工厂；`@deepseek-ai/dsh-session-persistence` 导出了真正的读取侧校验器 `validateStoredEvents`（以及 `assertVersion` / `sessionFormatVersionRefusal`）。

实验脚本（放在 `/tmp`，一次跑完）：

```js
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { validateStoredEvents } from '@deepseek-ai/dsh-session-persistence'

const session = Session.create(SessionId('probe'), [], undefined, 0)
const event = session.append('usage-state/turn-usage', {
  turn: 1, sourceId: 'deepseek', mode: 'api',
  balances: [{ amount: 1, currency: 'CNY' }], windows: [], fetchedAt: Date.now(),
})

console.log('envelope keys:', Object.keys(event))          // 是否出现 ignorable
try { validateStoredEvents([event]); console.log('reader: ACCEPTS') }
catch (error) { console.log('reader: REFUSES →', error.message) }
```

同时并行确认三件事：

1. `Session.append` 是否接受**未知类型**（预期：接受，`validateSessionEventData` 只校验 `request/header` 与 `tool/result`）；
2. 有没有别处能设置 `ignorable`（全平台 grep `ignorable` 的写侧；再确认 `adoptSessionEvent` / `materializeAppendBatch` 是否可用但不属于我们该用的路径）；
3. **重入限制**：`Session.append` 有"不能在另一个 append 的发布边界内重入"的保护，而 `session/event` 是 **post-commit 广播**。所以写入**绝不能**放在 `session/event` 同步处理里——计划的写入点是"`turn/end` 之后延迟刷新成功时"（现有实现本来就在 2 秒后刷新），天然在边界之外。

**实验结论记录**：把结果（含原始输出片段）回写进本文件 §3 的"结论"处，再决定路线。**实验未通过前不写任何实现代码。**

## 5. 路线 A：session log + 投影（首选）

### 5.1 事件契约

- 类型：`usage-state/turn-usage`（命名空间式，与 `session-log-deepseek/...` 同一惯例）；
- 载荷（JSON-safe、体积极小、**绝不含密钥**）：
  ```json
  { "turn": 3, "sourceId": "deepseek", "mode": "api",
    "balances": [{"amount": 58.13, "currency": "CNY", "granted": 0, "toppedUp": 58.13}],
    "windows": [{"id": "5h", "usedPercent": 12, "resetsAt": 1758384000000}],
    "fetchedAt": 1758380000000 }
  ```
- **只在刷新成功后写**：失败不写（不把错误固化进档案）；加载中/未配置不写。
- 写入时机：现有 `turn/end → 延迟 2s 刷新` 的成功回调里（见 §4 第 3 点的重入约束）。

### 5.2 投影（宿主侧）

`ctx.inject(['sessionProjections'], …)` 注册：

- `key: 'usageTurn'`，`stateVersion: 1`；
- `stateSchema`：`{ byTurn: Record<string, Reading>, order: number[] }`（纯 JSON）；
- `apply(state, event)`：只处理 `usage-state/turn-usage`，其余事件**返回同一引用**（平台的约定，用于抑制发布）；
- `wire: { viewSchema, view }`：视图里**同时给出 Δ**——`{ turn, reading, delta?: { usedPercent?, amount? } }`，Δ 由"与上一回合的读数"相减得出（百分点按窗口 id 配对；金额按币种配对）。
- 好处：Δ 是**派生量**，不额外存；刷新页面/重启后从持久化日志重建，结果一致。

### 5.3 客户端

- `turnTail` 用 `useProjection('usageTurn')` 取本回合的固定值与 Δ；**没有记录就不显示**（老回合、刷新失败的回合、未采样回合）——不显示比显示"当前值"诚实。
- `dock` 行不改（仍是实时值）。
- Δ 文案必须写"较上一回合"（见 §5.4），中英词典各一条。

### 5.4 诚实性约束（不可省）

Δ 是 **账户级、按回合边界采样** 的变化量，不是"本回合的 token 花费"：

- 同账户的**并发会话 / 子代理 / 别的客户端**的消耗会混进来；
- 采样点是回合边界，不是"该回合发起的那次请求"；
- 首个回合没有基准 → 不显示 Δ；
- 中间有刷新失败 → 跳过该段（或标注"间隔较长"）。

因此**绝不能**把 Δ 命名为"本回合花费/成本"——那会越过本插件"只做显示"的边界（当初砍掉成本统计正是为此）。提示里应给出"较上一回合（账户级，含其它消耗）"的说明。

### 5.5 TDD 切分（原子提交）

1. `feat(host): usage-state/turn-usage 事件与写入时机` —— 事件载荷构造（纯函数）+ 类型增强 + 写入挂在"延迟刷新成功后"；测试：载荷 JSON-safe、失败不写、不重入。
2. `feat(host): usageTurn 投影（固定值 + Δ）` —— `init/apply/view`；测试：只处理本类型事件、无关键事件返回同引用、Δ 计算（含首回合无基准、窗口缺失、币种不同、跨回合跳变）。
3. `feat(client): 回合行显示固定值与 Δ` —— `useProjection('usageTurn')` + 文案；测试：SSR 渲染（有记录 / 无记录 / 有 Δ / 无基准）+ 词典。
4. `docs: 更新 implementation.md §6 与 consensus §13-8，并删除本过渡文档`。

### 5.6 真机验收

1. 对话跑 2–3 个回合；
2. 往上翻：**每个回合下方的值应当各不相同、且越往下越大/越小**（不再全都等于当前值）；
3. 刷新页面（甚至重启 DSH）后仍然如此；
4. 悬停看 Δ 文案是否标明"较上一回合 / 账户级"；
5. 会话归档/删除后，插件不再持有相关数据（`~/.dsh/storages/` 下不应出现本插件的新文件）。

## 6. 路线 B：插件自有文件（实验否决时）

- 路径：`$DSH_HOME/storages/usage-state/turns.json`；键 `"<sessionId>:<turn>"`；
- 结构：`{ version: 1, sessions: { [sessionId]: { turns: { [turn]: reading }, updatedAt } } }`；
- 写入：与路线 A 同一时机（延迟刷新成功后），原子写（tmp + rename，沿用平台做法）；
- **清理方案**（这是选它的主要成本，必须写死）：
  - 上限：最多保留 N 个会话（按 `updatedAt` LRU）与每会话最多 M 个回合，超出即淘汰；
  - TTL：超过 T 天未更新的会话记录删除；
  - 可选：监听会话删除事件（若有）即时清理，作为额外手段而非依赖；
- 诚实标注：**不随会话迁移**，且它是插件自己的长期存储（与"尽量不引入自有状态"的既有取舍相冲突，因此才作为备选）。

## 7. 风险与回滚

| 风险 | 处置 |
|---|---|
| 事件未被读取方接受 → 会话档案被污染 | **第 0 步先验证**；未验证通过前不写。已写入的事件无法删除（append-only），所以这一步不能跳 |
| 写入触发重入（append 边界） | 写入只发生在延迟刷新成功后（边界之外）；实验里不依赖同步写入 |
| 会话日志体积 | 每回合一条、载荷百字节量级；必要时只在读数**发生变化**时写（可作为实现时的优化，先不做） |
| 投影键冲突 / 版本 | `key: 'usageTurn'` 加命名空间前缀避免撞名；`stateVersion` 变更时同步升 |
| 与 dock 行语义混淆 | 两处文案区分：dock 是"现在"，turnTail 是"该回合 + Δ" |
| 回滚 | 删除写入与投影注册即可；历史事件因（可忽略）标记被安全跳过，不影响会话可读性 |

## 8. 明确不做

- 不引入"本回合花费/成本"的口径（会变成成本统计）；
- 不做按 token 精确归因；
- 不做历史趋势图/面板（那是另一件事）；
- 不改 dock 行的实时语义。

## 9. 完成判据

- 第 0 步结论已记录（含原始输出）；
- 路线 A（或 B）实现完成，`npm test` 全绿（新增用例覆盖载荷/投影/Δ/渲染）；
- 真机验收 §5.6 五条通过；
- `docs/implementation.md` §6 里"回合行的固定值"一条移出未实现清单；
- `docs/design-consensus.md` §13 修订 8 更新为"已实现（含实现方式与理由）"；
- **本文件已删除**（`plans/` 目录清空后一并删除）。
