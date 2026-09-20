# Typert RPC: the minimal contract a third-party plugin needs to expose host methods to its own browser half

Read-only research. Every claim below is traced to a file, line, and verbatim quote from the
installed platform. Verified against:

- DSH platform `@deepseek-ai/*` `0.1.5-rc.2` under
  `/Volumes/M2ExHome/rockman/.dsh/profiles/node_modules/@deepseek-ai/`
- reference third-party implementation `dsh-cost-meter@1.7.28` under
  `/Volumes/M2ExHome/rockman/.dsh/profiles/web/node_modules/dsh-cost-meter/`
- cordis `@deepseek-ai/cordis` (`ctx.provide`, `ctx.effect`)
- `zod` 4.6.5 (`profiles/node_modules/zod`), 4.5.1 (`profiles/web/node_modules/zod`)

Anything not read directly is marked **UNKNOWN**.

---

## 0. The whole contract, in 8 lines

| Piece | Requirement |
|---|---|
| Host `package.json` | `"exports": { "./typert": { "default": "./lib/typert.host.js" } }` (string form also accepted) |
| Host typert module | `export const TYPERT = { package: <exact pkg name>, face: 'host', schemas: [], invocations: [...], model: {...} }` |
| Host registration | `ctx.provide(serviceKey, serviceObject)` **and** a visible `serviceObject.typertRemote = { service: serviceObject, serviceKey, namespace }` binding |
| Invocation entry | `{ id, service, namespace, method, invocation: { kind: 'direct' }, parameters: [...], result: <strict codec> }` |
| Codecs | host codecs must be zod **v4** instances (`"_zod" in schema`); client parameter codecs only need `{ mode:'strict', typeSymbol, schema:{ parse } }` |
| Host service | public instance method named `descriptor.method`; args arrive positionally in `parameters[]` order |
| Client `package.json` | `"exports": { "./client": { "default": "./lib/client.js" } }` + `"dsh": { "client": { "platform": "web" } }` |
| Client module | `export const inject = ["remote"]`; `await ctx.remote.$mount(contribution)`; then `ctx.get("remote.<namespace>")` |

The returned callable resolves to a `RemoteResult<T>` envelope — `{ ok: true, value }` or
`{ ok: false, error }` — and only ever rejects for assembly faults (arity, unmounted method,
client-side codec rejection).

---

## 1. HOST SIDE — exactly what to export

### 1.1 Discovery: the `./typert` package export, and the named `TYPERT` const

`dsh-typert-loader` is the plugin that finds and registers the manifest. It reads
`@deepseek-ai/dsh-typert-loader/lib/index.js`:

```
40: const TYPERT_HOST_EXPORT = "./typert";
44: const inject = ["typert", "loader"];
```

and resolves the module from the package export, then takes the **named** export `TYPERT`:

```
255: 			loading = import(__rewriteRelativeImportExtension(pathToFileURL(path).href)).then((mod) => validateTypertManifest(pkgName, mod.TYPERT), (cause) => {
```

`dsh-cost-meter` declares exactly that (`package.json`):

```json
"exports": {
  ".":        { "default": "./lib/index.js" },
  "./client": { "default": "./lib/client.js" },
  "./typert": { "default": "./lib/typert.host.js" },
  "./package.json": "./package.json"
}
```

and `lib/typert.host.js:511` + `:803`:

```js
export const TYPERT = { ... }
...
export default TYPERT
```

The named export is required; the default export is **not** read by the loader (cost-meter
provides it as a convenience only). The loader accepts the string form and the
one-level conditional form (`{ default: "..." }`) of the export
(`dsh-typert-loader/lib/index.js:57-67`).

The package must be a **Loader entry** resolvable from `ctx.baseUrl`, or explicitly listed in
the typert-loader plugin config `packages` (`dsh-typert-loader/lib/index.js:44-46`).

### 1.2 Full TypeScript-shaped manifest type

Composed verbatim from `@deepseek-ai/dsh-typert-registry/lib/types/types.d.ts`,
`@deepseek-ai/dsh-typert-protocol/lib/types/types.d.ts`, and the loader's runtime checks.
`TypertContribution` is what the loader passes to `ctx.typert.register()`:

```ts
/** registry/lib/types/types.d.ts */
export type TypertFace = 'host' | 'client'

export interface TypertDocTag { name: string; argument?: string; comment?: string; text: string }
export interface TypertDocumentation {
  description?: string; summary?: string; tags: readonly TypertDocTag[]; jsDoc?: string
}
export interface TypertMemberModel {
  kind: 'property' | 'method' | 'getter' | 'setter' | 'call' | 'construct' | 'index'
  name: string; signature: string; summary?: string; jsDoc?: string
}
export interface TypertTypeModel { name: string; declaration: string }
export interface TypertServiceModel extends TypertDocumentation {
  key: string; exportName: string
  members: readonly TypertMemberModel[]; types: readonly TypertTypeModel[]
}
export interface TypertEventModel extends TypertDocumentation { name: string; mode?: string; signature: string }
export interface TypertObjectModel extends TypertDocumentation {
  name: string; exportName: string
  members: readonly TypertMemberModel[]; types: readonly TypertTypeModel[]
}
export interface TypertPackageModel {
  services: readonly TypertServiceModel[]
  events: readonly TypertEventModel[]
  objects: readonly TypertObjectModel[]
}
export interface TypertSchema { name: string; schema: import('zod').ZodType }
export interface TypertContribution {
  package: string
  face: TypertFace
  schemas: readonly TypertSchema[]
  model: TypertPackageModel
  /** Host invocation definitions, empty when the package exports no Remote methods. */
  invocations: readonly InvocationDescriptor[]
}

/** protocol/lib/types/types.d.ts */
export interface TypertSchema<Output = unknown> { parse(value: unknown): Output }
export type TypertCodec =
  | { readonly mode: 'strict'; readonly typeSymbol: string; readonly schema: TypertSchema }
  | { readonly mode: 'src-json' }
export interface InvocationParameterDescriptor {
  readonly name: string
  readonly wire: string
  readonly source: 'json' | 'lookup'
  readonly lookup?: string
  readonly codec: TypertCodec
  /** Missing wire fields decode to `undefined` only for an explicitly declared `T | undefined`. */
  readonly acceptsUndefined?: true
}
export interface InvocationSourceLocation { readonly file: string; readonly line: number; readonly column: number }
export interface InvocationDescriptor {
  readonly id: string
  readonly service: string
  readonly namespace: string
  readonly method: string
  readonly implementation?: string
  readonly mode?: 'stream'
  readonly invocation: { readonly kind: 'direct' } | {
    readonly kind: 'context'; readonly context: string; readonly wire: string; readonly codec: TypertCodec
  }
  readonly scope?: { readonly context: string; readonly wire: string }
  readonly parameters: readonly InvocationParameterDescriptor[]
  readonly cancellation?: { readonly parameter: 'signal' }
  readonly result: TypertCodec
  readonly sourceLocation?: InvocationSourceLocation
}
```

`TYPERT` is structurally exactly a `TypertContribution` — the loader returns `manifest`
unchanged (`dsh-typert-loader/lib/index.js:117`).

**Required fields for a minimal but valid manifest (all enforced):** `package` (=== the owning
package name), `face` (`'host'`), `schemas` (array), `model` (object with three arrays
`services`/`events`/`objects`), `invocations` (array), and per invocation `id`, `service`,
`namespace`, `method`, `invocation.kind`, `parameters`, `result`. The `model` arrays may be
empty: `model: { services: [], events: [], objects: [] }` passes every loader check
(`dsh-typert-loader/lib/index.js:89-92`). The model is reflection metadata for config UIs; it is
not consulted by the gateway dispatch path.

### 1.3 Manifest head, verbatim — `typert.host.js:511-524`

```js
export const TYPERT = {
  package: 'dsh-cost-meter',
  face: 'host',
  schemas: [],
  invocations: [
    {
      id: 'dsh-cost-meter#costMeter/getState',
      service: 'costMeter',
      namespace: 'costMeter',
      method: 'getState',
      invocation: { kind: 'direct' },
      parameters: [],
      result: _state$codec,
    },
```

### 1.4 One complete invocation entry, verbatim — `typert.host.js:525-535`

```js
    {
      id: 'dsh-cost-meter#costMeter/updateConfig',
      service: 'costMeter',
      namespace: 'costMeter',
      method: 'updateConfig',
      invocation: { kind: 'direct' },
      parameters: [
        { name: 'patch', wire: 'patch', source: 'json', codec: _patch$codec },
      ],
      result: _state$codec,
    },
```

Field semantics:

- `id` — generated identity; the registry only enforces **uniqueness** (per invocation id and per
  endpoint, `typert-registry/lib/index.js:66-70`) and **nonempty** (`:558-560`). The
  `<package>#<namespace>/<method>` form is convention, not a checked grammar; `id` never crosses
  the wire.
- `service` — the **cordis service key** the gateway reads with `ctx.get(descriptor.service)`; the
  registry requires it nonempty and free of `#` (`typert-registry/lib/index.js:555-557`).
- `namespace` — the wire namespace; the client installs `remote.<namespace>`.
- `method` — the public instance method invoked on the service
  (`implementation` overrides it when the export name differs).
- `invocation.kind` — `'direct'` (receiver = host root ctx) or `'context'` (receiver resolved
  through a registered Context adapter). Only `'direct'` is needed by a plain plugin.
- `parameters[].wire` — **required key in the wire `args` object**; `name` is the source-level
  name. They are usually identical.
- `parameters[].acceptsUndefined: true` — allows the client to omit the field, decoding to
  `undefined` (needed for optional parameters; see §2.4 / §3.5).
- `result` — required, strict codec (see §2).

### 1.5 Host registration — the `typertRemote` binding is MANDATORY

Strict descriptors alone are **not** enough. `TypertGatewayService.prepareInvocation` always
validates a visible binding before invoking
(`dsh-api-gateway/lib/index.js:738-757`):

```js
	async prepareInvocation(request) {
		const endpoint = endpointOf(request.namespace, request.method);
		const descriptor = this.resolveDescriptor(request.namespace, request.method, endpoint);
		assertExactArguments(request.args, descriptor, endpoint);
		const receiver = (await this.resolveReceiverContext(descriptor, request.args, endpoint)).get(descriptor.service);
		if (!isObject(receiver)) throw new TypertGatewayError("gateway/service-unavailable", endpoint, `active Service ${JSON.stringify(descriptor.service)} is unavailable`);
		validateBinding(receiver, descriptor.service, descriptor.namespace, endpoint);
		const args = await Promise.all(descriptor.parameters.map((parameter) => this.resolveParameter(parameter, request.args, endpoint)));
		if (descriptor.cancellation !== void 0) args.push(request.signal ?? NEVER_ABORTED_SIGNAL);
		const implementation = descriptor.implementation ?? descriptor.method;
		const method = Reflect.get(receiver, implementation);
		if (typeof method !== "function") throw new TypertGatewayError("gateway/method-unavailable", endpoint, `active Service ${JSON.stringify(descriptor.service)} has no callable method ${JSON.stringify(implementation)}`);
```

`validateBinding`/`readBinding` (`dsh-api-gateway/lib/index.js:993-1005`) require
`receiver.typertRemote.service === receiver`, `typertRemote.serviceKey === descriptor.service`,
and `typertRemote.namespace === descriptor.namespace`, else `gateway/binding-invalid`.

`dsh-cost-meter` does exactly this (`lib/index.js:2298-2303`, `lib/index.js:2927`):

```js
  Object.defineProperty(service, 'typertRemote', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: { service, serviceKey: 'costMeter', namespace: 'costMeter' },
  })
  return service
...
  // RPC 服务:客户端经 remote.costMeter.* 调用(./typert 清单由 typert-loader 注册)。
  ctx.provide('costMeter', createService(ctx, ledger))
```

`ctx.provide(name, value)` is cordis's per-fiber service registration; it makes `ctx.get(name)`
return the value while the fiber is active and unregisters it when the returned disposer runs or
the fiber unloads (`@deepseek-ai/cordis/lib/types/reflect.d.ts:33-44`). The gateway reads the
service with `ctx.get(descriptor.service)` (line 742), so `ctx.provide` is the whole
registration requirement.

The platform also offers `TypertRemoteService` / `@Remote` / `bindTypertRemote`
(`@deepseek-ai/dsh-typert-protocol/lib/types/index.d.ts`) for class-based services. That base
class registers the same `typertRemote` binding. A plain object + `ctx.provide` (cost-meter's
approach) avoids extending a platform class.

---

## 2. CODECS

### 2.1 What a "strict codec" is

Two independent validators run, with different strictness.

**Loader (host manifest), `dsh-typert-loader/lib/index.js:206-211`:**

```js
function requireStrictCodec(pkgName, value, subject) {
	const codec = requireObject(pkgName, value, subject);
	if (codec.mode !== "strict") throw new Error(`typert-loader: ${pkgName} ${subject} must use a strict codec`);
	requireString(pkgName, codec, "typeSymbol", subject);
	if (typeof codec.schema !== "object" || codec.schema === null || !("_zod" in codec.schema) || typeof codec.schema.parse !== "function") throw new Error(`typert-loader: ${pkgName} ${subject} is not backed by a zod v4 schema`);
}
```

It is called for **every** parameter codec (`:185`), the invocation result codec (`:199`), the
Context receiver codec (`:166`), and for every `TYPERT.schemas[]` entry (`:87`).

**Registry (client contribution), `dsh-typert-registry/lib/index.js:547-551`:**

```js
function validateCodec(codec, subject) {
	if (codec.mode === "src-json") return;
	validateNonempty(`${subject} type symbol`, codec.typeSymbol);
	if (typeof codec.schema.parse !== "function") throw new Error(`typert: ${subject} strict codec has no parse() method`);
}
```

Called for `descriptor.result` and every parameter codec inside `validateInvocation`
(`:510-545`), which runs on the **client** when `$mount` registers the contribution.
Note the asymmetry: the registry accepts `{ mode: 'src-json' }` and does **not** require `_zod`.

So a strict codec is:

```ts
{ mode: 'strict', typeSymbol: string /* nonempty */, schema: { parse(value: unknown): unknown } }
```

- **host** additionally requires `"_zod" in schema` (a real zod **v4** schema instance);
- **client** only requires `schema.parse` to be a function.

### 2.2 The exact helper cost-meter defines — `typert.host.js:492`

```js
const strictCodec = (name, schema) => ({ mode: 'strict', typeSymbol: 'dsh-cost-meter#' + name, schema, create: () => schema })
```

`create` is extra (cost-meter's comment at `typert.host.js:3-4` says it is for "old hosts");
neither the loader nor the registry reads it. The platform type `TypertCodec` has only
`mode`/`typeSymbol`/`schema` (`dsh-typert-protocol/lib/types/types.d.ts`).

Usage examples (`typert.host.js:493-509`):

```js
const _state$codec = strictCodec('CostState', stateSchema)
const _patch$codec = strictCodec('ConfigPatch', patchSchema)
const _provider$codec = strictCodec('CodingPlanProvider', z.string())
```

### 2.3 Is `zod` REQUIRED as a runtime dependency?

- **On the host: effectively yes (zod v4).** The loader's check is literally `"_zod" in
  schema.schema` plus `schema.parse` being a function, so a hand-rolled object
  `{ _zod: {}, parse: v => v }` would pass the *loader*. But it would not be a zod v4 schema;
  the platform type is `z.ZodType`, `ctx.typert.toJSONSchema()` calls
  `z.toJSONSchema(resolve(key).schema)` (`typert-registry/lib/index.js:473-475`), and config
  surfaces consume `TYPERT.schemas[]`. **Treat zod v4 as required; do not ship the shim.**
- `dsh-cost-meter` declares it as a real dependency: `"dependencies": { "zod": "4.5.1" }`.
- Installed copies: `profiles/node_modules/zod` = **4.6.5**, `profiles/web/node_modules/zod` =
  **4.5.1**. zod v3 does **not** carry the `_zod` marker and is rejected by the loader
  ("is not a zod v4 schema instance").
- **On the client: zod is not strictly required.** Client parameter codecs are checked by
  `validateCodec` (needs only `typeSymbol` + `parse`) and by
  `requireStrictCodec` in the gateway client (`dsh-api-gateway/lib/client.js:1828-1830`, only
  `mode === 'strict'`), then executed as `codec.schema.parse(value)`
  (`client.js:1831-1838`). A tiny hand-written `{ parse }` satisfies all of them. Whether this
  survives future platform versions is **UNKNOWN**.

### 2.4 Does the host need a schema for the result?

**Declaration: yes. Runtime validation: no (in `0.1.5-rc.2`).**

- The loader rejects a manifest whose invocation has no strict `result` codec
  (`dsh-typert-loader/lib/index.js:199`).
- But the installed gateway never runs it. `TypertGatewayService.invoke` returns the business
  value untouched (`dsh-api-gateway/lib/index.js:535, 538-547`):

```
535:	* @returns the business result without output decoding.
...
538:	async invoke(request) {
539:		const prepared = await this.prepareInvocation(request);
540:		if (prepared.descriptor.mode === "stream") throw new TypertGatewayError("gateway/signature-invalid", prepared.endpoint, "stream Remote methods must be opened through the stream carrier");
541:		try {
542:			return await Reflect.apply(prepared.method, prepared.receiver, prepared.args);
```

  A repo-wide grep for `codec` in `dsh-api-gateway/lib/index.js` finds it only in
  argument/Context decoding and SRC synthesis; there is no result-codec call.
- The client likewise never touches `descriptor.result` (zero matches for `.result` in
  `dsh-api-gateway/lib/client.js`); it returns `result.value` straight from the carrier
  (`client.js:1623-1626`).
- The README claims the opposite ("invokes the public business method, and validates its
  result", `dsh-api-gateway/README.md`). **The installed code is authoritative: the result codec
  is documentation/metadata today.** Do not rely on the host rejecting a malformed result.

The only real output constraint is JSON-safety: the value crosses the JSON carrier. Inputs are
additionally checked by `assertJsonValue` after parsing (`dsh-api-gateway/lib/index.js:1060,
1069-1079`), but that function is not applied to results.

### 2.5 Minimum viable codec for `getSnapshot()` → small JSON object

- Result codec **must exist**; it can be minimal on the host and even `{ mode: 'src-json' }` on
  the client. On the host it must be a zod v4 schema, so the honest minimum is
  `z.object({...})` or `z.unknown()`:
  ```js
  const snapshot$codec = { mode: 'strict', typeSymbol: 'dsh-usage-state#Snapshot', schema: z.object({ /* … */ }) }
  ```
- No parameter codecs at all for a zero-argument method: `parameters: []`.
- Client: `result: { mode: 'src-json' }` is legal (`validateCodec` early-returns) and keeps
  zod out of the browser bundle. Recommended if the value is only read, not validated.

### 2.6 What happens on a decode / validation failure

Order of checks on the host (`dsh-api-gateway/lib/index.js:738-757`, `1040-1068`):

1. **Argument shape** — `assertExactArguments` (`:1040-1052`) compares the wire `args` keys to
   `descriptor.parameters[].wire` exactly; missing keys are allowed only when
   `acceptsUndefined === true` (or the codec is `src-json`). Failure:
   `gateway/arguments-invalid`, message `args fields do not match the descriptor: missing "x"; unexpected "y"`.
2. **Parameter decode** — `decode(codec, ...)` (`:1053-1068`) runs `codec.schema.parse`,
   then `assertJsonValue`. Any throw becomes:
   ```js
   throw new TypertGatewayError("gateway/input-invalid", endpoint, `wire field ${JSON.stringify(field)} failed boundary validation`, { cause, field });
   ```
3. Service/binding/method failures: `gateway/service-unavailable`, `gateway/binding-invalid`,
   `gateway/method-unavailable`.
4. A business method that throws a `RemoteError` keeps its own code; any other throw is folded
   by `rpcFailure` (`:968-986`) into `gateway/internal` with the message and empty details.

The carrier turns every one of those into a resolved error branch for the client; the caller sees
`{ ok: false, error: { code, message, details } }` (see §3.4). `details` for gateway faults is
`TypertGatewayFaultDetails = { endpoint, field? }` (`dsh-api-gateway/lib/types/remote-error-codes.d.ts`);
the `cause` does not survive JSON.

**Client-side input failures reject instead of resolving.** `prepareInvocation` runs
`parseInput` (`client.js:1831-1838`) and throws
`` `client api: ${endpoint} rejected ${JSON.stringify(field)}` `` before any request leaves the
browser — that surfaces as a rejected promise, not a `RemoteResult`.

---

## 3. CLIENT SIDE

### 3.1 The exact mount call

Structural type (`dsh-typert-protocol/lib/types/types.d.ts`):

```ts
export type TypertDisposer = () => Promise<void>
export interface TypertRemoteContribution {
  readonly package: string                       // npm package that owns the Remote methods
  readonly descriptors: readonly InvocationDescriptor[]  // generated from that package
}
export interface TypertClientRemote {
  $mount(contribution: TypertRemoteContribution): Promise<TypertDisposer>
  $on<Event>(event: Event, listener: TypertClientEventListener<Event>): () => void
}
```

`ctx.remote` is declared on the client Context by the gateway client
(`dsh-api-gateway/lib/types/client/index.d.ts`: `interface Context { remote: ClientRemote }`).

`dsh-cost-meter`'s client half (minified `lib/client.js`, offset ≈245,013 — the same code
extracted textually):

```js
const Ns=["remote"];async function Ss(t){const s=t.remote;if(s===void 0||typeof s.$mount!="function")return;const o=await s.$mount(Ga);t.effect(()=>()=>{o()},"cost-meter: remote contribution");const a=t.get("remote.costMeter");if(a===void 0)return; ... }
```

de-minified:

```js
const inject = ["remote"]
async function apply(ctx) {
  const remote = ctx.remote
  if (remote === undefined || typeof remote.$mount !== "function") return
  const dispose = await remote.$mount(GA)
  ctx.effect(() => () => { dispose() }, "cost-meter: remote contribution")
  const api = ctx.get("remote.costMeter")   // the served namespace service
  if (api === undefined) return
  ...
}
```

and the module tail confirms the export surface: `it.apply=Ss,it.inject=Ns`.

The canonical platform-side pattern is identical — `@deepseek-ai/dsh-api-remotes/lib/client.js:9634-9667`:

```js
		const inject = ["remote"];
		async function apply(ctx) {
			const disposers = [];
			try {
				for (const contribution of [ TYPERT_REMOTE$14, /* … */ TYPERT_REMOTE ])
					disposers.push(await ctx.remote.$mount(contribution));
			} catch (error) {
				for (const dispose of disposers.reverse()) await dispose();
				throw error;
			}
			return async () => { for (const dispose of disposers.reverse()) await dispose(); };
		}
```

### 3.2 The descriptor-table shape — cost-meter's `Ga`, verbatim

Extracted from `dsh-cost-meter/lib/client.js` (bundle offset 99,839). It is the whole object;
the two helpers immediately before it are `Se` and `re`:

```js
Se=(t,s)=>({mode:"strict",typeSymbol:"dsh-cost-meter#"+t,schema:s,create:()=>s}),re=(t,s,o,a=!1)=>({name:t,wire:t,source:"json",codec:Se(s,o),...a?{acceptsUndefined:!0}:{}}),Ga={package:"dsh-cost-meter",descriptors:[{method:"getState",result:Se("CostState",mt)},{method:"updateConfig",parameters:[re("patch","ConfigPatch",Ha)],result:Se("CostState",mt)},{method:"fetchPrices"},{method:"refreshBalance"},{method:"refreshGoQuota"},{method:"refreshCustomBalance",parameters:[re("index","CustomBalanceIndex",Ua,!0)]},{method:"refreshCodingPlan",parameters:[re("provider","CodingPlanProvider",zt)]},{method:"refreshGatewayQuota",parameters:[re("sourceId","GatewayQuotaSourceId",le(t=>{if(t!=null)return(typeof t!="string"||t.length>48||!/^[a-z0-9][a-z0-9_-]*$/.test(t))&&oe("sourceId","gateway source id"),t}),!0)]},{method:"resetHistory",result:Se("CostState",mt)},{method:"importLegacyHistory"},{method:"getDaySessions",parameters:[re("date","DayKey",Qa)],result:Se("DayRecord",Fa)},{method:"getSessionCost",parameters:[re("sessionId","SessionId",zt)],result:Se("SessionCost",le(t=>({own:rt(t.own,"own"),subagents:rt(t.subagents,"subagents"),found:Ut(t.found,"found"),subagentCount:Y(t.subagentCount,"subagentCount")})))},{method:"getTopSessions",parameters:[re("limit","SessionLimit",_a),re("sort","SessionSort",Gt,!0),re("dir","SessionSortDir",Gt,!0)],result:Se("TopSessions",Wa)},{method:"setCredential",parameters:[re("target","CredentialTarget",Kt),re("value","CredentialValue",za)]},{method:"clearCredential",parameters:[re("target","CredentialTarget",Kt)]}].map(t=>({id:"dsh-cost-meter#costMeter/"+t.method,service:"costMeter",namespace:"costMeter",invocation:{kind:"direct"},parameters:[],result:Se("FetchPricesResult",ja),...t}))};
```

The generated platform artifact shows the same shape in readable form —
`@deepseek-ai/dsh-api-settings-controller/lib/typert.remote-client.js:106-133`:

```js
export const TYPERT_REMOTE = {
  package: '@deepseek-ai/dsh-api-settings-controller',
  descriptors: [
    {
      id: '@deepseek-ai/dsh-api-settings-controller#credentials/describe',
      service: 'credentialsController',
      namespace: 'credentials',
      method: 'describe',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'refs',
          wire: 'refs',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: '@deepseek-ai/dsh-api-settings-controller#credentials/describe:refs',
            schema: _deepseek_ai_dsh_api_settings_controller_credentials_describe_parameter_0$schema,
          },
        },
      ],
      result: {
        mode: 'strict',
        typeSymbol: '@deepseek-ai/dsh-api-settings-controller#credentials/describe:result',
        schema: _deepseek_ai_dsh_api_settings_controller_credentials_describe_result$schema,
      },
      sourceLocation: {"file":"packages/api/settings-controller/src/credentials.ts","line":83,"column":9},
    },
    /* … */
```

**Each client descriptor must carry** (validated by
`dsh-typert-registry/lib/index.js:141-155, 510-551`):

- `id` — nonempty, unique; convention `<package>#<namespace>/<method>` (matches the host
  manifest id, but they are never compared across sides).
- `service` — nonempty, no `#`. **Unused by the client** (0 occurrences of
  `descriptor.service` in `dsh-api-gateway/lib/client.js`), but required by the registry
  validator.
- `namespace` / `method` — wire segment grammar `^[A-Za-z0-9_$.-]+$`, not `.`/`..`
  (`dsh-typert-registry/lib/index.js:40, 552-554`; protocol pattern
  `@deepseek-ai/dsh-typert-protocol/lib/index.js:47`).
- `invocation` — object with `kind` (`'direct'`).
- `parameters` — array; each needs `name`, `wire`, `source: 'json'`, and a **strict** codec.
- `result` — **required**; `validateCodec(descriptor.result, …)` runs unconditionally, so an
  absent `result` throws `TypeError` while reading `codec.mode`. It may be
  `{ mode: 'src-json' }` on the client.

Additional client-side checks in `dsh-api-gateway/lib/client.js`:

- `validateContribution` (`:1509-1535`): duplicate method within a namespace, an endpoint already
  mounted, a namespace colliding with an existing `remote.<ns>` service or a context property —
  all throw.
- `requireStrictDescriptor` (`:1823-1827`) requires **strict** codecs for parameters and the
  Context receiver (not for `result`).

### 3.3 How method ids map onto the host manifest

- The wire endpoint is `${descriptor.namespace}/${descriptor.method}`
  (`endpointOf`, `client.js:1797-1799`; `typertEndpoint`,
  `dsh-typert-registry/lib/index.js:33-35`).
- Client sends `ctx.connection.rpc.call('/api', endpoint, { args: prepared.args }, signal)`
  (`client.js:1617`).
- Host resolves the endpoint against `ctx.typert.local` — the registry populated by
  typert-loader from the **host** manifest (`dsh-api-gateway/lib/index.js:758-762`).
- `id` never crosses the wire; `namespace` + `method` is the whole join key. `service` is used
  only on the host, to pick `ctx.get(descriptor.service)`.

A mismatch between the client's `namespace/method` and the host manifest endpoint yields
`gateway/invocation-unavailable` and, if the endpoint once existed, `gateway/definition-unavailable`
(`dsh-api-gateway/lib/index.js:758-762`).

### 3.4 How the client obtains the callable service

```js
const api = ctx.get("remote.costMeter")   // remote.<namespace>
```

The namespace service key is built by `remoteServiceKey(namespace)` →
`` `remote.${namespace}` `` (`dsh-api-gateway/lib/client.js:1794-1796`), installed as a cordis
`Service` in its own fiber (`createNamespace`, `client.js:1564-1591`), and each method is a
getter that forwards to `invokeRemote` (`install`, `client.js:1708-1727`). Methods disappear
when the contribution unmounts; a retained handle then resolves a
`gateway/internal` "no longer mounted" failure (`client.js:1612, 1840-1841`).

Two equivalent access forms work after the awaited `$mount`:

- `ctx.get("remote.<namespace>")` — what cost-meter's bundle uses;
- `ctx.remote.<namespace>.<method>(…)` — dotted service key, resolved by cordis as a nested
  service. This is the canonical form in platform client halves: `ctx.remote.settings.update(…)`,
  `this.ctx.remote.settings.describe(…)` (19 occurrences of `remote.settings`),
  `await remote.session.prompt(…)`, `for await (const frame of this.remote.session.follow(…))`
  (27 occurrences of `remote.session`) across `@deepseek-ai/*/lib/client.js`.

### 3.5 Exact async / error semantics

From `dsh-api-gateway/lib/client.js:1610-1631`:

```js
			async invoke(descriptor, projection, token, callerCtx, values, boundIdentity) {
				const endpoint = endpointOf(descriptor);
				if (!token.active) return withdrawn(endpoint);
				const prepared = this.prepareInvocation(descriptor, projection, token, callerCtx, values, boundIdentity);
				const connection = this.ownerCtx.get("connection");
				if (connection === void 0) throw new Error(`client api: ${endpoint} has no active Connection`);
				try {
					const result = await connection.rpc.call("/api", endpoint, { args: prepared.args }, prepared.signal);
					if (!mountActive(token)) return withdrawn(endpoint);
					if (!result.ok) return {
						ok: false,
						error: rebuiltFailure(result.error)
					};
					return {
						ok: true,
						value: result.value
					};
				} catch (error) {
					if (prepared.signal.aborted) return cancelledFailure(endpoint, error);
					return carrierFailure(endpoint, error);
				}
			}
```

- **Resolves** to `RemoteResult<T>` = `{ ok: true, value: T }` or
  `{ ok: false, error: RemoteError }`. There **is** a Result envelope; business and host-side
  errors never reject.
- **Rejects** only for assembly faults: wrong arity, a required Context missing, a client-side
  codec rejection, or no active Connection (`prepareInvocation` throws synchronously inside the
  async method). This is stated in `dsh-typert-protocol/lib/types/types.d.ts`
  (`RemoteResult` doc) and `dsh-api-gateway/README.md`.
- `error` is a live `RemoteError` with `code`, `message`, `details`; `isRemoteFailure(value)` is
  the one predicate exported by `@deepseek-ai/dsh-api-gateway/client`.
- Failure codes: `gateway/bad-request`, `gateway/cancelled`, `gateway/internal` (protocol) plus
  the 16 `gateway/*` codes in `dsh-api-gateway/lib/types/remote-error-codes.d.ts`.
- Aborting the caller's `AbortSignal` resolves `{ ok: false, error: { code: 'gateway/cancelled' } }`
  (`client.js:1628, 1846-1851`).

**Arity is exact.** `prepareInvocation` (`client.js:1642-1649`):

```js
			prepareInvocation(descriptor, projection, token, callerCtx, values, boundIdentity) {
				const endpoint = endpointOf(descriptor);
				const expected = descriptor.parameters.length - (projection?.parameterIndex === void 0 ? 0 : 1);
				const hasCallerSignal = descriptor.cancellation !== void 0 && values.length === expected + 1;
				if (values.length !== expected && !hasCallerSignal) {
					const contract = descriptor.cancellation === void 0 ? `${String(expected)} argument(s)` : `${String(expected)} business argument(s) plus an optional AbortSignal`;
					throw new Error(`client api: ${endpoint} expected ${contract}, got ${String(values.length)}`);
				}
```

Consequences:

- An optional parameter still counts toward arity. `getSnapshot(force?)` with one declared
  parameter **must be called as `getSnapshot(force)`** (pass `undefined` explicitly);
  `getSnapshot()` rejects locally with `client api: snapshot/getSnapshot expected 1 argument(s), got 0`.
  Confirmed in practice: cost-meter's client always calls `o.getTopSessions(A,P,T)` with all three
  arguments even though `sort`/`dir` are optional.
- Positional values map to `descriptor.parameters` in order; `undefined` results are omitted from
  the wire `args` object (`client.js:1658-1663`) — which is why the host parameter needs
  `acceptsUndefined: true`.
- If `cancellation: { parameter: 'signal' }` is declared, a trailing `AbortSignal` may be passed
  (host method's last parameter receives it; it is not a wire field).

---

## 4. LIFECYCLE

`$mount` performs its own `callerCtx.effect(...)` and returns a disposer
(`dsh-api-gateway/lib/client.js:1461-1471`):

```js
			async $mount(contribution) {
				const callerCtx = this.ctx;
				const owned = callerCtx.effect(async () => {
					const dispose = await this.enqueue(() => this.mountContribution(callerCtx, contribution));
					return () => this.enqueue(dispose);
				}, `api-gateway.client.$mount(${JSON.stringify(contribution.package)})`);
				await owned;
				return async () => { await owned(); };
			}
```

So the mount is already scoped to the calling fiber; the returned disposer is what a plugin
wraps when it wants explicit teardown. cost-meter's pattern
(`client.js` offset ≈245,013) is the canonical one:

```js
const dispose = await ctx.remote.$mount(GA)
ctx.effect(() => () => { dispose() }, "cost-meter: remote contribution")
```

Unmount semantics (`mountContribution` `:1487-1508`, `installNamespace` `:1546-1562`,
`disposeNamespace` `:1592-1596`):

- `typert.remotes.register(contribution)` is an effect on `callerCtx`; withdrawing removes the
  descriptors.
- Namespace services unload after their **last** method is withdrawn (a second contribution into
  the same namespace keeps it alive).
- A disposer aborts in-flight calls via the per-method `AbortController`.

**`inject` list:** `["remote"]` for `$mount` and for `ctx.get("remote.<namespace>")`. This is
what both the reference plugin (`it.inject=Ns`, `Ns=["remote"]`) and the platform assembly
(`dsh-api-remotes/lib/client.js:9634`) declare. The client gateway itself also needs
`connection` (its own `inject`, `dsh-api-gateway/lib/types/client/index.d.ts`), but a consumer
plugin does not.

Race note: the namespace service is installed during the awaited `$mount`, so
`ctx.get("remote.<namespace>")` is available immediately afterwards. cost-meter still guards
with `if (a === void 0) return;` — harmless defensiveness, not a required wait.
`ctx.inject(['remote.<namespace>'], cb)` is not needed (and is **UNKNOWN** as a supported
injection key; the platform uses `ctx.get`).

---

## 5. MINIMAL END-TO-END EXAMPLE — `getSnapshot(force?: boolean) => Snapshot`

Package name `dsh-usage-state`. Three files + `package.json`. This is the smallest shape that
passes every validator quoted above. `force` is declared and must be passed (see §3.5).

### 5.1 `package.json` (abridged to the load-bearing fields)

```json
{
  "name": "dsh-usage-state",
  "version": "0.0.0",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".":        { "default": "./lib/index.js" },
    "./client": { "default": "./lib/client.js" },
    "./typert": { "default": "./lib/typert.host.js" },
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web" }
  },
  "dependencies": { "zod": "4.5.1" }
}
```

`dsh.client` + the `./client` export are what `dsh-client-modules` scans for
(`@deepseek-ai/dsh-client-modules/lib/types/index.d.ts`: "scans the host Loader's entries for
packages declaring `dsh.client`"). Exact accepted fields of the `dsh.client` object beyond
`platform` are **UNKNOWN**; `dsh-cost-meter` uses `{ "platform": "web" }`.

### 5.2 Host typert manifest — `lib/typert.host.js`

```js
import { z } from 'zod'

const strictCodec = (name, schema) => ({ mode: 'strict', typeSymbol: 'dsh-usage-state#' + name, schema })

const snapshotSchema = z.object({
  sourceId: z.string(),
  fetchedAt: z.number(),
  balance: z.object({ currency: z.string(), amount: z.number() }).nullable(),
  windows: z.array(z.object({
    id: z.string(),
    usedPercent: z.number(),
    resetsAt: z.number().nullable(),
  })),
})

const _force$codec = strictCodec('Force', z.boolean().optional())
const _snapshot$codec = strictCodec('Snapshot', snapshotSchema)

export const TYPERT = {
  package: 'dsh-usage-state',
  face: 'host',
  schemas: [],
  invocations: [
    {
      id: 'dsh-usage-state#usageState/getSnapshot',
      service: 'usageState',
      namespace: 'usageState',
      method: 'getSnapshot',
      invocation: { kind: 'direct' },
      parameters: [
        { name: 'force', wire: 'force', source: 'json', acceptsUndefined: true, codec: _force$codec },
      ],
      result: _snapshot$codec,
    },
  ],
  // Required object with three arrays; reflection metadata only — empty arrays are valid.
  model: { services: [], events: [], objects: [] },
}

export default TYPERT
```

### 5.3 Host plugin — `lib/index.js`

```js
export const name = 'usage-state'

export function apply(ctx) {
  const snapshot = { sourceId: 'deepseek', fetchedAt: 0, balance: null, windows: [] }

  const service = {
    // Public instance method; arguments arrive positionally in descriptor.parameters order.
    getSnapshot(force) {
      if (force) refresh()
      // Must be JSON-safe: finite numbers, no undefined leaves, no cycles.
      return snapshot
    },
  }

  // MANDATORY: the gateway validates this binding on every dispatch.
  Object.defineProperty(service, 'typertRemote', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: { service, serviceKey: 'usageState', namespace: 'usageState' },
  })

  ctx.provide('usageState', service)

  function refresh() { /* host-side fetch + cache; sets snapshot fields */ }
}
```

### 5.4 Client module — `lib/client.js`

The client's parameter codec can be a hand-written `{ parse }` (no zod needed in the browser);
the result can be `{ mode: 'src-json' }` because the registry's `validateCodec` early-returns for
it and neither validator inspects the result schema further.

```js
export const inject = ['remote']

// Strict codec: mode + nonempty typeSymbol + schema.parse. Validated by
// dsh-typert-registry validateCodec and by dsh-api-gateway requireStrictCodec.
const booleanOrUndefined = {
  mode: 'strict',
  typeSymbol: 'dsh-usage-state#Force',
  schema: {
    parse(value) {
      if (value === undefined || typeof value === 'boolean') return value
      throw new TypeError('force must be a boolean or undefined')
    },
  },
}

const contribution = {
  package: 'dsh-usage-state',
  descriptors: [
    {
      id: 'dsh-usage-state#usageState/getSnapshot',
      service: 'usageState',      // required by the registry validator; unused client-side
      namespace: 'usageState',
      method: 'getSnapshot',
      invocation: { kind: 'direct' },
      parameters: [
        { name: 'force', wire: 'force', source: 'json', acceptsUndefined: true, codec: booleanOrUndefined },
      ],
      result: { mode: 'src-json' },   // legal on the client; no schema needed
    },
  ],
}

export async function apply(ctx) {
  const dispose = await ctx.remote.$mount(contribution)
  ctx.effect(() => () => { dispose() }, 'usage-state: remote contribution')

  const api = ctx.get('remote.usageState')
  if (api === undefined) return

  // Arity is exact: optional parameters still must be passed.
  const result = await api.getSnapshot(false)
  if (!result.ok) {
    // result.error is a RemoteError { code, message, details }
    console.error('usage-state:', result.error.code, result.error.message)
    return
  }
  console.log('usage-state snapshot:', result.value)
}
```

If you prefer zod on both halves, replace `booleanOrUndefined` with
`{ mode:'strict', typeSymbol:'dsh-usage-state#Force', schema: z.boolean().optional() }` and the
client `result` with the same strict codec object. That is what generated platform artifacts do
(`dsh-api-settings-controller/lib/typert.remote-client.js`), at the cost of bundling zod into the
browser half.

### 5.5 Build/packaging notes (verified only where cited)

- The client half is a browser bundle served by `dsh-client-modules`; the platform builds its own
  with esbuild (cost-meter's `devDependencies` include `esbuild`), from the `./client` export.
- The host manifest module is imported as ESM by typert-loader (`.js` with `"type": "module"`).
- `zod` must resolve on the host. Declare it as a dependency (cost-meter: `"zod": "4.5.1"`).
  **UNKNOWN**: whether the `web` profile will dedupe/hoist a nested zod, or whether shipping zod
  inside the host bundle is preferable.
- **TypeScript typing:** `@deepseek-ai/dsh-typert-protocol` / `-registry` are not in this repo's
  `node_modules`, and whether they are installable from the public registry is **UNKNOWN**.
  Practical options: (a) add the platform package as a `devDependency` if it resolves; (b) declare
  the structural types locally by copying the `TypertContribution` / `InvocationDescriptor` /
  `TypertCodec` shapes from §1.2; (c) let the manifest be inferred (`export const TYPERT = {...}`)
  and `satisfies` a local type. Do **not** import runtime values from the platform packages into
  the plugin bundles.

---

## 6. ALTERNATIVES — lighter ways to move a small JSON blob, without a typert manifest

For volatile account-level data (balance / quota), i.e. **not** derived from session events,
the options are:

### 6.1 Generic Connection RPC channel — the only real manifest-free bridge

Host (`@deepseek-ai/dsh-client-connection/lib/types/rpc.d.ts`):

```ts
export interface HostConnectionRpc {
  handle(channel: string, handler: ConnectionRpcHandler): () => Promise<void>;
  intercept(channel: '/api', matches: ConnectionRpcEndpointMatcher, handler: ConnectionRpcHandler): () => Promise<void>;
}
export type ConnectionRpcHandler = (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<ConnectionRpcResult<unknown>>;
export type ConnectionRpcResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ConnectionRpcFailure };
```

Client (`ClientConnectionRpc`, same file):

```ts
call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<ConnectionRpcResult<unknown>>
```

Host usage: `ctx.connection.rpc.handle('/usage-state', handler)`. Client usage:
`ctx.connection.rpc.call('/usage-state', 'getSnapshot', payload, signal)`; inject `["connection"]`
(the host service is registered under the key `connection`, `dsh-client-connection/lib/index.js:535`).
The browser implementation POSTs `` `${channel}/${endpoint}` `` with the standard
`ClientRequest` envelope and returns the parsed result
(`dsh-client-connection/lib/client.js:6196-6216`). Channel grammar on both halves is
`/^\/[A-Za-z0-9._~-]+$/` and endpoint segments are `/^[A-Za-z0-9_$.-]+$/`
(`dsh-client-connection/lib/index.js:520-521`, `lib/client.js:6186-6187`), so a channel such as
`/usage-state` and endpoint `getSnapshot` are legal.

- **Suitable for volatile account data? YES** — it is a plain request/response JSON channel, no
  session coupling, no schema registry, no manifest.
- **Caveats:** `handle` registers "one authenticated absolute channel prefix"; the handler must
  return the `ConnectionRpcResult` envelope itself and serialize its own errors. `ctx.connection`
  availability on the client half is a cordis `inject` dependency. Third-party usage of this
  channel API is not exercised by any installed plugin read during this research, so treat the
  channel-prefix conventions (leading slash, trust) as **partially documented**.

### 6.2 `ctx.sessionProjections.register` — NOT suitable

API (`@deepseek-ai/dsh-session-projection/lib/types/index.d.ts:134-166`):

```ts
export declare class SessionProjectionRegistry extends Service {
  register<K extends keyof SessionProjectionMap, S extends ...>(definition: Omit<ProjectionDefinition<K,S>,'wire'> & { wire: NonNullable<...> }): () => void;
  register<K extends Exclude<...>>(definition: Omit<ProjectionDefinition<K,S>,'wire'>): () => void;
  onChanged(listener: ProjectionChangeListener): () => void;
  snapshot(session: Session, keys?: readonly ...[]): ProjectionSnapshot;
}
```

`ProjectionDefinition` requires `key`, `stateSchema`, `init(header, inheritedEventCount)`,
`apply(state, event)` (a **pure fold over committed session events**), `view(state)`, and
`stateVersion`. The class doc is explicit: *"the `ctx.sessionProjections` registry that DRIVES
every registered unit forward eagerly over committed session events"* and *"All functions MUST be
synchronous … `state` MUST be plain JSON"*.

- **Suitable for volatile account-level data? NO.** The data must be derived from session events,
  is keyed per session, and client visibility requires the `wire: { viewSchema, view(state) }`
  half plus a carrier that consumes projection snapshots. Account balance/quota is global and
  fetched out-of-band; there is no session event to fold.

### 6.3 Settings namespace — usable, but it is persistent user config, not volatile state

Host (`@deepseek-ai/dsh-settings/lib/types/index.d.ts:210-216`):

```ts
register<const Namespace extends string, T>(ns: Namespace & SettingsNamespaceInput<Namespace>, schema: z<T>, options?: SettingsRegisterOptions<T>): SettingsScope<T>;
```

with `SettingsScope<T> = { get(): T; watch(cb): () => void; update(patch): Promise<void>; replace(section): Promise<void> }`.
Client side reaches namespaces through the settings controller's own typert namespace
(`ctx.remote.settings.describe/update/replace/mutate`, mounted by api-remotes):

```ts
describe: () => Promise<RemoteResult<SettingsDescribeValue>>
update: (ns: string, patch: Record<string, JsonValue>, expectedRevision: number | undefined) => Promise<RemoteResult<SettingsNamespaceView>>
```

- **Suitable for volatile account-level data? NO (misuse).** The value is persisted in the
  user-editable settings document, carries a revision, is surfaced to configuration UIs, and
  writes are schema-validated and durable. Use it for the plugin's *configuration* (that is the
  parent design's plan), not for a refreshable snapshot.
- Note it is not actually manifest-free for the plugin's benefit only if the plugin reuses the
  platform's `remote.settings` service; that service itself is a typert contribution owned by
  `dsh-api-settings-controller`.

### 6.4 Cordis events forwarded over the connection (`ctx.remote.$on`) — NOT available to a third party

`ctx.remote.$on` exists and is manifest-free for the *listener*, but the host side is a fixed
allowlist registered by the application assembly, and only one source can be registered:

- `registerRemoteEvents` doc: *"Register the **sole** application-selected forwarded-event
  source"* (`dsh-api-gateway/lib/types/index.d.ts:64-69`).
- `@deepseek-ai/dsh-api-remotes/lib/index.js:100-108` registers it once with
  `API_REMOTE_FORWARDED_EVENTS` (a fixed array, `lib/types/remote-events.d.ts`).
- The legal `$on` keys are exactly that selection
  (`TypertRemoteEventSelection extends Record<ApiRemoteForwardedEvent, true>`,
  `dsh-api-remotes/lib/types/types.d.ts:15`), and no `TypertRemoteEventSelection` declaration was
  found in any third-party-extensible location in the installed tree.

- **Suitable for volatile account-level data? NO.** A plugin cannot add its own event to the
  allowlist without modifying `dsh-api-remotes`, and cannot register a second source.

### 6.5 A client-side service (`ctx.provide` on the client) — not a host bridge

A client plugin can provide its own client-local cordis service and other client plugins can
`ctx.get` it, but nothing carries host state across. It is only a fan-out mechanism once the data
is already in the browser.

### 6.6 `ctx.remote.$host` — fixed host facts only

`@deepseek-ai/dsh-api-gateway/lib/types/client/index.d.ts`:

```ts
export interface RemoteHostFacts {
  readonly home: string | undefined
  readonly isLoopback: boolean
}
readonly $host: RemoteHostFacts
```

Plain reads of fixed facts from the connection ready frame; not a store, no subscription, and not
extensible.

### 6.7 Summary table

| Mechanism | Manifest needed? | Host→client JSON? | Suits volatile account data? |
|---|---|---|---|
| Typert RPC (`./typert` + `$mount`) | yes | pull (unary) / stream (`mode:'stream'`, needs stream carrier) | **yes** — the intended path |
| `ctx.connection.rpc.handle` / `call` | no | pull | **yes**, lighter, less-traveled |
| `ctx.sessionProjections.register` | no (own schema seam) | via projection carriers | no — event-fold, per-session |
| settings namespace | no (uses platform `remote.settings`) | pull | no — durable user config |
| `ctx.remote.$on` forwarded events | host assembly allowlist | push | no — third party cannot extend |
| client-local service | — | no | no |
| `ctx.remote.$host` | no | fixed facts | no |

For `dsh-usage-state`'s `getSnapshot(force?)`, the design decision in
`docs/design-consensus.md` §7 (typert RPC + `$mount`) is the matching, supported path. §6.1 is
the only viable fallback if the typert manifest proves troublesome.

---

## 7. High-risk gotchas (each verified)

1. **`typertRemote` is mandatory** even with a strict manifest — `validateBinding` runs on every
   dispatch (`dsh-api-gateway/lib/index.js:744`), and `binding.service` must be the service object
   itself (`readBinding`, `:1002-1005`). Omitting it is `gateway/binding-invalid`.
2. **`result` is required on client descriptors too** — `validateCodec(descriptor.result)`
   runs in `validateInvocation` during `$mount`. Omitting `result` throws inside the registry.
   Use `{ mode: 'src-json' }` if you do not want a result schema in the browser.
3. **Exact arity** — optional parameters still count; call `getSnapshot(force)` not
   `getSnapshot()`.
4. **`acceptsUndefined: true`** is required on the host descriptor for any parameter that may be
   omitted from `args`, otherwise `gateway/arguments-invalid` (`missing "force"`).
5. **zod v4 only** for the host manifest; `_zod` is checked. zod v3 fails activation with a loud
   `AggregateError` naming the package (`dsh-typert-loader/lib/index.js:326`).
6. **`TYPERT.package` must equal the npm package name** exactly
   (`dsh-typert-loader/lib/index.js:80`).
7. **Manifest `model` is mandatory** with `services`/`events`/`objects` arrays even if empty
   (`:89-92`).
8. **`ctx.typert.local` is only populated from the host `./typert` export**; a manifest with no
   `./typert` package export is never imported (`:247`).
9. **A method named like a service member is rejected** — `REMOTE_NAMESPACE_FIELDS` =
   `ctx, empty, invokeRemote, methods, name, namespace` (`dsh-api-gateway/lib/client.js:1786-1793`).
10. **Namespace collisions are fatal at mount** — an existing `remote.<ns>` service or a context
    property of the same name throws (`client.js:1526-1533`).
11. **Result codecs are not executed** in `0.1.5-rc.2` despite the README; ensure JSON-safety in
    your own code (finite numbers, no cycles, no `undefined` leaves).

## 8. Explicitly UNKNOWN / not verified

- Whether the platform intends to execute result codecs in a later release (README says yes,
  installed code says no).
- The complete accepted schema of the `dsh.client` package.json field beyond `platform`.
- Whether `ctx.inject(['remote.<namespace>'], cb)` is a supported wait mechanism (the platform
  uses `ctx.get` after an awaited `$mount`).
- Client-bundle build tooling requirements (`tsdown`/esbuild output format, source maps) — only
  the artifact location (`./client` export) and the `{ apply, inject }` export surface were
  verified.
- Runtime acceptance of the hand-written `{ parse }` codec by future validator versions.
- The exact trust/route conventions for a third-party `ctx.connection.rpc.handle` channel beyond
  the `.d.ts` contract.
