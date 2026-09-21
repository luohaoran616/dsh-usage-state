# 添加一个数据源（Adapter）

`dsh-usage-state` 只实现五家数据源（DeepSeek、z.ai / GLM、Kimi、OpenCode Zen Go、Sub2API）。其余厂商靠 adapter 扩展——加一个适配器只需要两个文件加一行注册，插件其余部分（设置页列出的数据源、轮询目标、状态行渲染、双语文案）会自动跟上。

## 契约

```ts
export interface UsageSource {
  id: string                        // 稳定 id，写进设置与快照，如 'deepseek'
  displayName: string               // 设置页显示名
  modes: readonly UsageMode[]       // 能服务哪些模式：'api' | 'coding-plan'
  credentialRefs(mode): string[]    // 按顺序探测的凭据名（POSIX 环境变量风格）
  defaultBaseUrl(mode): string | undefined  // 无覆盖时使用的端点
  requiresBaseUrl?: boolean         // true = 必须由用户填端点（自建服务）
  request(input: RequestInput): UsageRequest   // 纯构造：url + headers
  fallbackRequests?(input): UsageRequest[]     // 可选：区域镜像，按序重试
  parse(payload: unknown, mode): UsageReading  // 纯解析：payload → 归一化读数
}
```

`request` 与 `parse` **刻意分离**：`parse` 不碰网络、不读时钟，所以每个厂商的返回结构都能用 fixture 无网单测。

**端点优先级**（`resolveProvider` → `UsageTarget.baseUrl` → `read.ts`）：

1. 插件设置里显式填的端点（`pinnedBaseUrl: true`，**不**再试镜像）；
2. 供应商在 DSH 里声明的 `baseURL` 的 **origin**（例如 `https://api.z.ai/api/paas/v4` → `https://api.z.ai`；各适配器自己拼路径，所以只取 origin），仍会试镜像；
3. 适配器的 `defaultBaseUrl(mode)`；
4. 若前两者都没有且 `fallbackRequests` 存在，则按序尝试镜像；全部失败时抛出**最有信息量**的失败（"有响应"的优先于"连不上"的）。

区域类厂商（z.ai 国内/国际）就该用 `fallbackRequests`：key 只在自家站点有效，而错误站点返回的是**鉴权失败**而不是重定向。

## 加一个适配器的步骤

1. 复制 `src/host/sources/_template.ts` 为 `<id>.ts`，填四处：`id` / `displayName` / `modes` / `credentialRefs`，以及 `request` 与 `parse`（有区域镜像时再加 `fallbackRequests`）。
2. 先写测试：`tests/sources/<id>.test.ts`，用真实返回体做 fixture，覆盖
   - 正常形态（余额 / 窗口）
   - 字段缺失、`null`、字符串数字
   - 百分比口径（0..1 还是 0..100）
   - 重置时间的三种形态（unix 秒 / 毫秒 / ISO）
   - 不可解析时报 `SourceError('parse')`；**若厂商用 HTTP 200 返回错误信封，先识别它**（见下）
3. 在 `src/host/sources/index.ts` 的 `ALL_SOURCES` 里加一行。
4. `npm test` 与 `npx tsc --noEmit` 应该全绿；`docs/research/` 里已有的接口侦察可以补充你的注释。

## 约定与坑

- **归一化工具**（`src/host/sources/normalize.ts`）：
  - `toFiniteNumber` — 数字与数字串 → 有限数；其余 `undefined`（空串也算缺失）。
  - `clampPercent` — 已知 0..100 时用它（如 z.ai 的 `percentage`）。
  - `normalizePercent` — 口径不明时用它：`<= 1` 视为小数（`1` → 100%），否则视为百分数。**注意这个歧义**，口径明确时不要用它。
  - `normalizeResetAt` — unix 秒 / 毫秒 / 数字串 / ISO → epoch 毫秒；非法 → `undefined`（绝不给假日期）。
  - `normalizeBaseUrl` — 去尾斜杠与尾部 `/vN`（用户常把 `.../v1` 贴进端点配置）。
- **只抛 `SourceError`**：`kind` 决定界面文案（`config` / `auth` / `http` / `network` / `parse`）。HTTP 状态与网络异常由 `src/host/read.ts` 统一归类，适配器只需负责 `parse`。
- **HTTP 200 里的错误信封**：不少国内厂商这么做（z.ai 是 `{success:false,code:1000,msg:'身份验证失败。'}`，另有 `{error:{code,message}}` 变体）。**不识别它就会把"密钥无效"报成"返回内容无法解析"**——真机上正是这么踩过一次。`code` 1000 视为鉴权失败 → `auth`，其他 → `http`，并把厂商原文放进 `message`（界面会连同本地化文案一起显示）。
- **窗口 id 用规范键**：`5h` / `1d` / `7d` / `30d`。状态行按 5h → 1d → 7d 排序显示，未知 id 原样显示（文案在客户端词典，`window.<id>`，缺键时回退显示 id）。
- **百分比一律是"已用"**（0..100，保留一位小数），与 z.ai / Claude 官方口径一致。
- **不去重、不缓存**：`resolveTargets` 已按 `source + mode` 去重，`UsageStateStore` 已做最小间隔与在途去重。
- **不要 import 平台包**：宿主半边在 `link:` 装载时解析不到 `@deepseek-ai/*`，请用 `ctx` 的结构化类型（见 `src/index.ts` 的 `PluginContextLike`）。

## 已实现的数据源与坑

| 数据源 | 模式 | 端点 | 关键坑 |
|---|---|---|---|
| DeepSeek 官方 | API | `GET {base}/user/balance` | 多币种返回顺序**不稳定**，固定取首条会让余额在真值与 0 之间跳；按"优先有余额 → 优先 CNY"挑选。官方无 coding plan、无窗口 |
| z.ai / 智谱 GLM | Coding Plan | `GET {base}/api/monitor/usage/quota/limit`，默认 `https://open.bigmodel.cn`，镜像 `https://api.z.ai` | 主形态按 `unit` 映射：`3` → 5h、`6` → 7d；`TIME_LIMIT` 是月度 MCP 额度**不能**当编码窗口；`percentage` 已是 0..100；`unit` 缺失时按 `nextResetTime` 升序补位（0% 滚动窗口不带重置时间）。**鉴权失败是 HTTP 200 + `{success:false,code:1000}`**，且国内/国际的 key 互不通用（实测确认）→ 用 `fallbackRequests` 试镜像。端点非官方文档，社区逆向所得，已保留旧 `plans[]` 与扁平窗口两种兜底形态 |
| Kimi / Moonshot | API + Coding Plan | `GET {base}/v1/users/me/balance`（余额）/ `GET {base}/coding/v1/usages`（订阅） | 一家两种读法：按模式分派端点与密钥。编程套餐端点**必须**带 `user-agent: KimiCLI/1.6`，否则拒绝。Moonshot 余额的"分/元"单位无字段可辨，当前沿用 `>= 100 视为分` 的启发式——**用真实 key 复核过再信任绝对值** |
| OpenCode Zen Go | Coding Plan | `GET https://opencode.ai/zen/go/v1/usage` | **必须带浏览器 UA**（否则 Cloudflare error 1010 → 403，实测）。根对象是 `usage.{rolling,weekly,monthly}`（文档写作 `data.usage`，两种都接受），字段 `percent` 已是 0..100 已用百分比（用 `clampPercent`，**不要**用 `normalizePercent`，否则 `1` 会变成 100%），`resetsAt` 是 ISO 串。窗口名 `rolling/weekly/monthly` → 规范键 `5h/7d/30d`。401/403 = 无订阅或密钥无效（**不是** 0%）。`resolveProvider` 会把 provider 声明的 `baseURL` 归一成 origin、`normalizeBaseUrl` 会剥掉尾部 `/vN`，所以请求前还要再剥掉 `/zen/go` 尾段，否则出现 `/zen/go/zen/go/v1/usage` |
| Sub2API（自建） | API + Coding Plan | `GET {base}/v1/usage` | 未文档化的内部接口，字段曾出现前后端漂移；所有字段可选、未知结构降级。一个接口覆盖两种模式：`quota.remaining` 或钱包 `balance` 视为 USD 余额，`rate_limits[]` 的 `window` 直接是 `5h`/`1d`/`7d`（美元计价，百分比自算 `used/limit`）。`requiresBaseUrl: true` |

## 候选数据源（未实现）

以下接口已侦察确认存在（详见 `docs/research/provider-balance-quota-apis.md`），但都**不适合 v1 的凭据模型**（本插件只支持环境变量风格字符串密钥，经 DSH 凭据库存取）：

| 厂商 | 端点 | 为什么还没做 |
|---|---|---|
| Anthropic Claude Pro/Max | `GET https://api.anthropic.com/api/oauth/usage` | 必须 OAuth 访问令牌（`user:profile`），普通 API key 无法调用；需要新增 OAuth 凭据的存取通道。返回 `five_hour` / `seven_day` 的 `utilization` + `resets_at`，是最标准的 5h/7d 形态 |
| Codex / ChatGPT 订阅 | `GET https://chatgpt.com/backend-api/wham/usage` | 需要 ChatGPT OAuth；`rate_limit.primary_window`（18000s）与 `secondary_window`（604800s） |
| MiniMax Token Plan | `GET https://www.minimaxi.com/v1/token_plan/remains` | 纯 API key，**可以**按本模板实现：`current_interval_remaining_percent` / `current_weekly_remaining_percent`（注意是"剩余"，要反转） |
| Kimi Code 国际版 | `GET https://api.kimi.com/coding/v1/usages` | 与已实现的国内版同端点，无需新增 |
| OpenRouter | `GET {base}/api/v1/credits`、`/api/v1/key` | 余额接口按官方 OpenAPI 需要 management key；`/key` 的 `limit_remaining/limit` 可换算已用 %，但无 5h/7d 概念 |
| SiliconFlow | `GET https://api.siliconflow.cn/v1/user/info` | 纯 CNY 余额，可照模板实现 |
| CommandCode | `GET https://api.commandcode.ai/alpha/billing/credits` | 返回 `windowLimits.{fiveHour,weekly}.{used,cap,resetAt}`，形态与我们的窗口模型几乎一致 |
| Volcengine Ark Coding Plan | `open.volcengineapi.com` 控制面 | 需要 AK/SK HMAC 签名，凭据形态超出 v1 |
| Gemini Code Assist / Antigravity | 私有端点 / 本地语言服务 | OAuth 或本地进程通信，且 Google 已关闭个人版 CLI OAuth |

> OpenCode Zen 已实现（见上表），不再是候选；它只差一个 `user-agent` 就能直连，不需要 OAuth。

**优先级建议**：MiniMax → CommandCode → SiliconFlow（都是纯 API key、返回结构简单），再考虑为 Anthropic / Codex 增加 OAuth 凭据通道。

## 排查

| 现象 | 原因 |
|---|---|
| 状态行显示"缺少密钥或接口地址" | 该 source 的所有候选凭据都未配置，或 `requiresBaseUrl` 的源没填端点。设置页每行会显示候选凭据名与配置状态 |
| 显示"密钥无效" | 请求返回 401/403，或厂商在 HTTP 200 里返回鉴权失败信封（z.ai 的 `code:1000`）。**先确认 key 与站点区域匹配**（国内 key 打国际站必然失败） |
| 显示旧值 + ⚠ | 最近一次刷新失败，展示的是上次成功值（鼠标悬停可看原因） |
| 记录里有数据但界面为空 | 该模型在设置页是 `隐藏`，或模型不在 `models` 配置里（未配置 → 状态行不显示） |
| `dsh plugin add github:...` 装完没有界面 | `lib/` 未提交或 `package.json` 的 `dsh` 字段缺失；`npm test` 里的构建守卫会检查这些 |
| 界面显示"未配置"但环境里明明有 key | 宿主行可能拿不到平台的 `credentials` 服务（作用域问题）。插件会退化为直读 env → `~/.dsh/.credentials.yaml`，并把来源标注为 `env (direct)` / `file (direct)`；看到该标注即说明走的兜底 |
