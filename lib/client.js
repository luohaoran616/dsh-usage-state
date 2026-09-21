window.__ModuleLoader__.load({
	id: "dsh-usage-state",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/shared/config.ts
		const DEFAULT_CONFIG = {
			models: [],
			order: [],
			providers: {},
			sources: {},
			refresh: {
				intervalMinutes: 5,
				turnEndDelayMs: 2e3,
				minIntervalSeconds: 60
			},
			display: {
				thresholdWarnPercent: 80,
				thresholdCriticalPercent: 95,
				progressBar: true
			}
		};
		const MODES = [
			"api",
			"coding-plan",
			"hidden"
		];
		const PROVIDER_MODES = [
			"api",
			"coding-plan",
			"hidden",
			"auto"
		];
		function asRecord(value) {
			return value !== null && typeof value === "object" && !Array.isArray(value) ? value : void 0;
		}
		function cleanString(value) {
			return typeof value === "string" ? value.trim() : "";
		}
		function clampInt(value, minimum, maximum, fallback) {
			if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
			return Math.min(maximum, Math.max(minimum, Math.round(value)));
		}
		function normalizeModels(value) {
			if (!Array.isArray(value)) return [];
			const models = [];
			const seen = /* @__PURE__ */ new Set();
			for (const raw of value) {
				const entry = asRecord(raw);
				if (entry === void 0) continue;
				const provider = cleanString(entry.provider);
				const model = cleanString(entry.model);
				if (provider === "" || model === "") continue;
				const identity = `${provider}\u0000${model}`;
				if (seen.has(identity)) continue;
				seen.add(identity);
				const rawMode = cleanString(entry.mode);
				const mode = MODES.includes(rawMode) ? rawMode : "hidden";
				const sourceId = cleanString(entry.sourceId);
				models.push({
					provider,
					model,
					sourceId: sourceId === "" ? null : sourceId,
					mode
				});
			}
			return models;
		}
		function normalizeSources(value) {
			const root = asRecord(value);
			if (root === void 0) return {};
			const sources = {};
			for (const [id, raw] of Object.entries(root)) {
				const entry = asRecord(raw);
				if (entry === void 0) continue;
				const config = {};
				const apiKeyRef = cleanString(entry.apiKeyRef);
				if (apiKeyRef !== "") config.apiKeyRef = apiKeyRef;
				const baseUrl = cleanString(entry.baseUrl);
				if (baseUrl !== "") config.baseUrl = baseUrl;
				if (config.apiKeyRef !== void 0 || config.baseUrl !== void 0) sources[id] = config;
			}
			return sources;
		}
		function normalizeRefresh(value) {
			const root = asRecord(value) ?? {};
			const defaults = DEFAULT_CONFIG.refresh;
			return {
				intervalMinutes: clampInt(root.intervalMinutes, 1, 1440, defaults.intervalMinutes),
				turnEndDelayMs: clampInt(root.turnEndDelayMs, 0, 6e4, defaults.turnEndDelayMs),
				minIntervalSeconds: clampInt(root.minIntervalSeconds, 0, 3600, defaults.minIntervalSeconds)
			};
		}
		function normalizeDisplay(value) {
			const root = asRecord(value) ?? {};
			const defaults = DEFAULT_CONFIG.display;
			const progressBar = typeof root.progressBar === "boolean" ? root.progressBar : defaults.progressBar;
			const thresholdWarnPercent = clampInt(root.thresholdWarnPercent, 1, 100, defaults.thresholdWarnPercent);
			const thresholdCriticalPercent = clampInt(root.thresholdCriticalPercent, 1, 100, defaults.thresholdCriticalPercent);
			if (thresholdWarnPercent >= thresholdCriticalPercent) return {
				...defaults,
				progressBar
			};
			return {
				thresholdWarnPercent,
				thresholdCriticalPercent,
				progressBar
			};
		}
		function normalizeProviders(value) {
			const root = asRecord(value);
			if (root === void 0) return {};
			const providers = {};
			for (const [id, raw] of Object.entries(root)) {
				const entry = asRecord(raw);
				if (entry === void 0) continue;
				const rawMode = cleanString(entry.mode);
				const normalized = { mode: PROVIDER_MODES.includes(rawMode) ? rawMode : "auto" };
				const sourceId = cleanString(entry.sourceId);
				if (sourceId !== "") normalized.sourceId = sourceId;
				const baseUrl = cleanString(entry.baseUrl);
				if (baseUrl !== "") normalized.baseUrl = baseUrl;
				const apiKeyRef = cleanString(entry.apiKeyRef);
				if (apiKeyRef !== "") normalized.apiKeyRef = apiKeyRef;
				providers[id] = normalized;
			}
			return providers;
		}
		/** Keep the stored order sane and append providers it does not mention. */
		function normalizeOrder(value, providers) {
			const order = [];
			if (Array.isArray(value)) for (const raw of value) {
				const id = cleanString(raw);
				if (id === "" || order.includes(id)) continue;
				order.push(id);
			}
			for (const id of Object.keys(providers)) if (!order.includes(id)) order.push(id);
			return order;
		}
		/**
		* Turn whatever the hand-editable settings document contains into a usable
		* config. Deliberately never throws: the settings provider calls the schema
		* synchronously at registration time, and a dirty section must not block the
		* plugin from loading. Malformed pieces fall back to defaults instead.
		*
		* Legacy per-model entries are migrated into provider entries so an existing
		* document keeps the choices its owner already made.
		*/
		function normalizeConfig(raw) {
			const root = asRecord(raw) ?? {};
			const models = normalizeModels(root.models);
			const providers = normalizeProviders(root.providers);
			for (const entry of models) {
				if (providers[entry.provider] !== void 0) continue;
				providers[entry.provider] = {
					mode: entry.mode,
					...entry.sourceId === null ? {} : { sourceId: entry.sourceId }
				};
			}
			return {
				models,
				order: normalizeOrder(root.order, providers),
				providers,
				sources: normalizeSources(root.sources),
				refresh: normalizeRefresh(root.refresh),
				display: normalizeDisplay(root.display)
			};
		}
		const PROVIDER_HINTS = [
			{
				sourceId: "zai",
				pattern: /(zai|zhipu|bigmodel|glm)/
			},
			{
				sourceId: "kimi",
				pattern: /(kimi|moonshot)/
			},
			{
				sourceId: "sub2api",
				pattern: /sub-?2-?api/
			},
			{
				sourceId: "opencode",
				pattern: /opencode/
			},
			{
				sourceId: "deepseek",
				pattern: /deepseek/
			}
		];
		const HOST_HINTS = [
			{
				sourceId: "deepseek",
				pattern: /(^|\.)api\.deepseek\.com$/
			},
			{
				sourceId: "zai",
				pattern: /(^|\.)(api\.z\.ai|open\.bigmodel\.cn|bigmodel\.cn)$/
			},
			{
				sourceId: "kimi",
				pattern: /(^|\.)(api\.kimi\.com|api\.moonshot\.cn|moonshot\.cn)$/
			},
			{
				sourceId: "opencode",
				pattern: /(^|\.)opencode\.ai$/
			}
		];
		/**
		* Best guess at which data source backs a DSH provider. Provider id first (cheap
		* and usually right), then the endpoint host. Because any unrecognised endpoint is
		* most likely a self-hosted gateway, that is the last resort rather than `undefined`.
		*/
		function suggestSourceId(providerId, baseUrl) {
			const normalized = providerId.trim().toLowerCase();
			for (const hint of PROVIDER_HINTS) if (hint.pattern.test(normalized)) return hint.sourceId;
			if (baseUrl === void 0) return void 0;
			let host;
			try {
				host = new URL(baseUrl.trim()).host.toLowerCase();
			} catch {
				return;
			}
			for (const hint of HOST_HINTS) if (hint.pattern.test(host)) return hint.sourceId;
			return "sub2api";
		}
		//#endregion
		//#region src/shared/providers.ts
		/**
		* The scheme+host of a declared endpoint. A DSH provider profile's `baseURL` is an
		* *API* base (`https://api.z.ai/api/paas/v4`), while every adapter here appends its
		* own path to a bare origin, so only the origin is usable as our endpoint.
		*/
		function originOf(url) {
			if (url === void 0) return void 0;
			try {
				const parsed = new URL(url.trim());
				return parsed.origin === "null" ? void 0 : parsed.origin;
			} catch {
				return;
			}
		}
		function withTarget(resolution) {
			if (resolution.sourceId === null || resolution.mode === null) return resolution;
			return {
				...resolution,
				key: `${resolution.sourceId}:${resolution.mode}`
			};
		}
		/**
		* Resolve one provider. `auto` picks the source the provider id (or its endpoint)
		* suggests and that source's primary mode, so a provider DSH already has a key
		* for starts working without touching the settings page.
		*/
		function resolveProvider(input) {
			const entry = input.config.providers[input.provider];
			const declared = originOf(input.endpointHint);
			const baseUrl = entry?.baseUrl ?? declared;
			const base = {
				provider: input.provider,
				...baseUrl === void 0 ? {} : { baseUrl },
				...entry?.baseUrl === void 0 ? {} : { baseUrlPinned: true },
				...entry?.apiKeyRef === void 0 ? {} : { apiKeyRef: entry.apiKeyRef }
			};
			if (entry?.mode === "hidden") return {
				...base,
				sourceId: null,
				mode: null,
				reason: "hidden"
			};
			const sourceId = entry?.sourceId ?? suggestSourceId(input.provider, input.endpointHint) ?? null;
			if (sourceId === null) return {
				...base,
				sourceId: null,
				mode: null,
				reason: "unknown-source"
			};
			const source = input.catalog.find((candidate) => candidate.id === sourceId);
			if (source === void 0) return {
				...base,
				sourceId,
				mode: null,
				reason: "unknown-source"
			};
			if (entry?.mode === "api" || entry?.mode === "coding-plan") {
				if (!source.modes.includes(entry.mode)) return {
					...base,
					sourceId,
					mode: null,
					reason: "unsupported"
				};
				return withTarget({
					...base,
					sourceId,
					mode: entry.mode,
					reason: "configured"
				});
			}
			if (source.requiresBaseUrl && baseUrl === void 0) return {
				...base,
				sourceId,
				mode: null,
				reason: "needs-endpoint"
			};
			const mode = source.modes[0];
			if (mode === void 0) return {
				...base,
				sourceId,
				mode: null,
				reason: "unsupported"
			};
			return withTarget({
				...base,
				sourceId,
				mode,
				reason: "auto"
			});
		}
		/**
		* Display order: the configured order first, then any provider the caller knows
		* about that the order does not mention yet (so a newly configured provider never
		* disappears from the page).
		*/
		function orderProviders(providers, config) {
			const ordered = config.order.filter((provider) => providers.includes(provider));
			const missing = providers.filter((provider) => !ordered.includes(provider));
			return [...ordered, ...missing];
		}
		//#endregion
		//#region src/client/provider-rows.ts
		/**
		* Whether a stored entry that the model catalog does not list still deserves a row.
		* A provider DSH has but whose model list failed is real, just unreadable, so its row
		* stays; one that is routable with zero models looks deleted in DSH's own model list,
		* so its row goes with it.
		*/
		function stillConfigured(registry, provider) {
			return registry.routable.includes(provider) && registry.failed.includes(provider);
		}
		function buildProviderRows(input) {
			const grouped = /* @__PURE__ */ new Map();
			for (const model of input.models) {
				const existing = grouped.get(model.provider);
				if (existing === void 0) grouped.set(model.provider, {
					providerName: model.providerName,
					models: [{
						id: model.model,
						name: model.name
					}]
				});
				else existing.models.push({
					id: model.model,
					name: model.name
				});
			}
			for (const provider of [...input.config.order, ...Object.keys(input.config.providers)]) {
				if (grouped.has(provider)) continue;
				if (input.registry !== void 0 && !stillConfigured(input.registry, provider)) continue;
				grouped.set(provider, {
					providerName: provider,
					models: []
				});
			}
			return orderProviders([...grouped.keys()], input.config).map((provider) => {
				const group = grouped.get(provider);
				const entry = input.config.providers[provider];
				const endpointHint = input.endpointHints?.[provider];
				const sourceId = entry?.sourceId ?? suggestSourceId(provider, endpointHint) ?? null;
				const modes = [
					"auto",
					...(sourceId === null ? void 0 : input.catalog.find((candidate) => candidate.id === sourceId))?.modes ?? ["api", "coding-plan"],
					"hidden"
				];
				return {
					provider,
					providerName: group?.providerName ?? provider,
					models: group?.models ?? [],
					resolution: resolveProvider({
						provider,
						config: input.config,
						catalog: input.catalog,
						...endpointHint === void 0 ? {} : { endpointHint }
					}),
					selected: entry?.mode ?? "auto",
					modes: [...new Set(modes)]
				};
			});
		}
		/** Set one provider's mode, preserving its other overrides and every other provider. */
		function setProviderMode(providers, provider, mode) {
			const existing = providers[provider];
			return {
				...providers,
				[provider]: {
					...existing ?? {},
					mode
				}
			};
		}
		/** Swap a provider with its neighbour; `undefined` when the move is impossible. */
		function reorderProviders(order, provider, delta) {
			const index = order.indexOf(provider);
			if (index < 0) return void 0;
			const target = index + delta;
			if (target < 0 || target >= order.length) return void 0;
			const next = [...order];
			const moved = next[index];
			const displaced = next[target];
			if (moved === void 0 || displaced === void 0) return void 0;
			next[index] = displaced;
			next[target] = moved;
			return next;
		}
		//#endregion
		//#region src/client/hooks.ts
		/** Re-render on every store publication. */
		function useStoreState(store) {
			const [state, setState] = (0, react.useState)(() => store.getSnapshot());
			(0, react.useEffect)(() => store.subscribe(() => setState(store.getSnapshot())), [store]);
			return state;
		}
		/** A settings snapshot, kept current with the host document. */
		function useSettingsValue(scope) {
			const [snapshot, setSnapshot] = (0, react.useState)(() => scope.getSnapshot());
			(0, react.useEffect)(() => scope.subscribe(() => setSnapshot(scope.getSnapshot())), [scope]);
			return snapshot;
		}
		/**
		* A ticking clock, so reset countdowns stay honest without re-rendering on
		* every frame. The client composition has no timer service, so this is a plain
		* interval cleaned up with the effect.
		*/
		function useNow(intervalMs = 3e4) {
			const [now, setNow] = (0, react.useState)(() => Date.now());
			(0, react.useEffect)(() => {
				const timer = setInterval(() => setNow(Date.now()), intervalMs);
				return () => clearInterval(timer);
			}, [intervalMs]);
			return now;
		}
		//#endregion
		//#region src/client/SettingsSection.tsx
		const CARD = {
			border: "1px solid var(--dsw-alias-border-l2, var(--dsw-alias-border-l3))",
			borderRadius: "12px",
			background: "var(--dsw-alias-bg-layer-3)",
			padding: "12px 14px",
			display: "flex",
			flexDirection: "column",
			gap: "10px"
		};
		const ROW = {
			display: "flex",
			alignItems: "center",
			gap: "8px",
			flexWrap: "wrap",
			minWidth: 0
		};
		const MUTED = {
			color: "var(--dsw-alias-label-tertiary)",
			fontSize: "12px"
		};
		/** Models are listed for orientation only, so the line stays short. */
		const MAX_MODELS_SHOWN = 6;
		function modeLabel(mode, t) {
			if (mode === "api") return t("modeApi");
			if (mode === "coding-plan") return t("modeCodingPlan");
			if (mode === "hidden") return t("modeHidden");
			return t("modeAuto");
		}
		function windowModeLabel(mode, t) {
			return modeLabel(mode, t);
		}
		/**
		* A text field that keeps a local draft and writes once, on blur or Enter.
		* Committing on every keystroke would mean one settings revision per character.
		*/
		function DraftInput(props) {
			const [draft, setDraft] = (0, react.useState)(props.value);
			const [editing, setEditing] = (0, react.useState)(false);
			const shown = editing ? draft : props.value;
			const commit = () => {
				setEditing(false);
				const next = draft.trim();
				if (next !== props.value.trim()) props.onCommit(next);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
				type: props.type ?? "text",
				value: shown,
				placeholder: props.placeholder,
				disabled: props.disabled,
				onChange: (event) => {
					setEditing(true);
					setDraft(event.target.value);
				},
				onBlur: commit,
				onKeyDown: (event) => {
					if (event.key === "Enter") event.target.blur();
				},
				style: { maxWidth: props.width ?? "280px" }
			});
		}
		/**
		* Credential status and writes for one account. The candidate names are shown on
		* purpose: the user has to know what to call the environment variable or stored
		* credential — and when DSH already provides one, there is nothing to do here.
		*/
		function CredentialPanel(props) {
			const { t } = props;
			const [draft, setDraft] = (0, react.useState)("");
			const [note, setNote] = (0, react.useState)(void 0);
			const candidates = props.description?.candidates ?? [];
			const configuredRef = props.description?.ref ?? candidates.find((candidate) => candidate.configured)?.ref ?? props.refs[0];
			const writable = props.description?.writable !== false;
			const save = async () => {
				if (props.credentials === void 0 || configuredRef === void 0 || draft.trim() === "") return;
				const result = await props.credentials.set(configuredRef, draft.trim());
				if (!result.ok) {
					setNote(t("credentialFailed", { message: result.error.message }));
					return;
				}
				setDraft("");
				setNote(t("credentialSaved"));
				props.onChanged();
			};
			const clear = async () => {
				if (props.credentials === void 0 || configuredRef === void 0) return;
				const result = await props.credentials.unset(configuredRef);
				if (!result.ok) {
					setNote(t("credentialFailed", { message: result.error.message }));
					return;
				}
				setNote(t("credentialSaved"));
				props.onChanged();
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					display: "flex",
					flexDirection: "column",
					gap: "6px"
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: ROW,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: MUTED,
								children: t("credential")
							}),
							(candidates.length === 0 ? props.refs.map((ref) => ({
								ref,
								configured: false
							})) : candidates).map((candidate) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								style: ROW,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
									style: { fontSize: "11px" },
									children: candidate.ref
								}), candidate.configured ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
									tone: "success",
									children: t("credentialConfigured", { source: candidate.source ?? "" })
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
									tone: "neutral",
									children: t("credentialMissing")
								})]
							}, candidate.ref)),
							writable ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: MUTED,
								children: t("credentialLocked")
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: ROW,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
								type: "password",
								autoComplete: "off",
								value: draft,
								disabled: !writable || props.credentials === void 0,
								placeholder: t("credentialPlaceholder"),
								onChange: (event) => setDraft(event.target.value),
								style: { maxWidth: "280px" }
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								size: "sm",
								variant: "primary",
								disabled: draft.trim() === "",
								onClick: () => void save(),
								children: t("credentialSave")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								size: "sm",
								variant: "outline",
								disabled: configuredRef === void 0 || props.description?.configured !== true,
								onClick: () => void clear(),
								children: t("credentialClear")
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: MUTED,
						children: note ?? t("credentialHint")
					})
				]
			});
		}
		/** What this row currently resolves to, in one short phrase. */
		function resolutionLabel(row, catalog, t) {
			const { resolution } = row;
			if (resolution.reason === "hidden") return t("modeHidden");
			if (resolution.reason === "needs-endpoint") return t("needsEndpoint");
			if (resolution.reason === "unknown-source") return t("unknownSource");
			if (resolution.reason === "unsupported" || resolution.mode === null || resolution.sourceId === null) return t("modeUnsupported");
			const target = `${catalog.find((entry) => entry.id === resolution.sourceId)?.displayName ?? resolution.sourceId} · ${windowModeLabel(resolution.mode, t)}`;
			return resolution.reason === "auto" ? t("detectedAs", { target }) : t("showsAs", { target });
		}
		function ProviderCard(props) {
			const { t, row } = props;
			const entry = props.config.providers[row.provider];
			const resolvedSource = row.resolution.sourceId === null ? void 0 : props.catalog.find((candidate) => candidate.id === row.resolution.sourceId);
			const refMode = row.resolution.mode ?? resolvedSource?.modes[0];
			const refs = refMode === void 0 ? [] : [...resolvedSource?.credentialRefs[refMode] ?? []];
			const modelNames = row.models.map((model) => model.name);
			const listed = modelNames.slice(0, MAX_MODELS_SHOWN).join(" · ");
			const suffix = modelNames.length > MAX_MODELS_SHOWN ? ", …" : "";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					display: "flex",
					flexDirection: "column",
					gap: "6px",
					paddingBottom: "6px"
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							...ROW,
							justifyContent: "space-between"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: {
								minWidth: 0,
								overflow: "hidden",
								textOverflow: "ellipsis"
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: row.providerName }), row.providerName === row.provider ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								style: MUTED,
								children: [" ", row.provider]
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: ROW,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									size: "sm",
									variant: "ghost",
									"aria-label": t("moveUp"),
									disabled: props.index === 0,
									onClick: () => props.onMove(-1),
									children: "↑"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									size: "sm",
									variant: "ghost",
									"aria-label": t("moveDown"),
									disabled: props.index === props.total - 1,
									onClick: () => props.onMove(1),
									children: "↓"
								}),
								row.modes.map((mode) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									size: "sm",
									variant: row.selected === mode ? "primary" : "outline",
									onClick: () => props.onMode(mode),
									children: modeLabel(mode, t)
								}, mode))
							]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: MUTED,
						children: resolutionLabel(row, props.catalog, t)
					}),
					props.failure === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						style: MUTED,
						children: [
							"⚠ ",
							t(`error.${props.failure.kind}`),
							props.failure.detail === void 0 ? "" : ` — ${props.failure.detail}`
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: MUTED,
						children: modelNames.length === 0 ? t("noModels") : t("modelsPrefix", { list: `${listed}${suffix}` })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", {
						style: {
							...MUTED,
							cursor: "pointer"
						},
						children: t("advanced")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							flexDirection: "column",
							gap: "8px",
							paddingTop: "8px"
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: ROW,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: MUTED,
									children: t("sourceLabel")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
									value: entry?.sourceId ?? "",
									onChange: (event) => {
										const value = event.target.value;
										if (value === "") props.onClearField([
											"providers",
											row.provider,
											"sourceId"
										]);
										else props.onField([
											"providers",
											row.provider,
											"sourceId"
										], value);
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "",
										children: t("sourceAuto")
									}), props.catalog.map((candidate) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: candidate.id,
										children: candidate.displayName
									}, candidate.id))]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: ROW,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: MUTED,
										children: t("baseUrl")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DraftInput, {
										value: entry?.baseUrl ?? "",
										placeholder: row.resolution.mode === null ? t("baseUrlPlaceholder") : resolvedSource?.defaultBaseUrl[row.resolution.mode] ?? t("baseUrlPlaceholder"),
										width: "320px",
										onCommit: (value) => {
											if (value === "") props.onClearField([
												"providers",
												row.provider,
												"baseUrl"
											]);
											else props.onField([
												"providers",
												row.provider,
												"baseUrl"
											], value);
										}
									}),
									resolvedSource?.requiresBaseUrl === true && entry?.baseUrl === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
										tone: "warning",
										children: t("baseUrlRequired")
									}) : null
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: ROW,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: MUTED,
										children: t("apiKeyRef")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DraftInput, {
										value: entry?.apiKeyRef ?? "",
										width: "220px",
										onCommit: (value) => {
											if (value === "") props.onClearField([
												"providers",
												row.provider,
												"apiKeyRef"
											]);
											else props.onField([
												"providers",
												row.provider,
												"apiKeyRef"
											], value);
										}
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: MUTED,
										children: t("apiKeyRefHint")
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CredentialPanel, {
								t,
								refs,
								description: props.description,
								credentials: props.credentials,
								onChanged: props.onCredentialChanged
							})
						]
					})] })
				]
			});
		}
		/**
		* The plugin's settings page: one row per provider. The reading is account-level,
		* so per-model configuration was both long and redundant. Everything the plugin
		* can work out on its own — which source, which mode, which key — is left to
		* "auto"; only deviations are written to the settings document.
		*/
		function SettingsSection(props) {
			const { t } = props;
			const snapshot = useSettingsValue(props.settings);
			const state = useStoreState(props.usageState);
			(0, react.useEffect)(() => {
				props.usageState.refreshModels();
				props.usageState.refreshCredentials();
			}, [props.usageState]);
			if (snapshot.status === "unavailable") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				style: MUTED,
				children: t("unavailable")
			});
			const config = normalizeConfig(snapshot.value ?? {});
			const rows = buildProviderRows({
				models: state.models,
				config,
				catalog: state.catalog,
				registry: state.modelRegistry
			});
			const write = (path, value) => {
				props.settings.mutate([{
					op: "set",
					path,
					value
				}]);
			};
			const clear = (path) => {
				props.settings.mutate([{
					op: "unset",
					path
				}]);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					display: "flex",
					flexDirection: "column",
					gap: "14px",
					maxWidth: "760px"
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						style: {
							display: "flex",
							flexDirection: "column",
							gap: "6px"
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								style: { margin: 0 },
								children: t("title")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: {
									...MUTED,
									margin: 0
								},
								children: t("intro")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: ROW,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										size: "sm",
										variant: "outline",
										onClick: () => void props.usageState.refresh(true),
										children: t("refreshNow")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: MUTED,
										children: state.checkedAt === void 0 ? t("neverChecked") : t("lastChecked", { time: new Date(state.checkedAt).toLocaleTimeString() })
									}),
									state.error === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: MUTED,
										children: t("refreshFailed", { message: state.error })
									}),
									state.modelsError === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: MUTED,
										children: state.modelsError
									})
								]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						style: CARD,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("sectionProviders") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: MUTED,
								children: t("sectionProvidersHint")
							}),
							rows.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: MUTED,
								children: t("empty")
							}) : null,
							rows.map((row, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProviderCard, {
								t,
								row,
								config,
								catalog: state.catalog,
								credentials: props.credentials,
								description: row.resolution.key === void 0 ? void 0 : state.credentials[row.resolution.key],
								failure: row.resolution.key === void 0 ? void 0 : state.snapshots[row.resolution.key]?.error,
								index,
								total: rows.length,
								onMode: (mode) => write(["providers"], setProviderMode(config.providers, row.provider, mode)),
								onMove: (delta) => {
									const next = reorderProviders(config.order, row.provider, delta);
									if (next !== void 0) write(["order"], next);
								},
								onField: (path, value) => write(path, value),
								onClearField: (path) => clear(path),
								onCredentialChanged: () => void props.usageState.refreshCredentials()
							}, row.provider))
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						style: CARD,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("sectionDisplay") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: ROW,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: MUTED,
										children: t("thresholdWarn")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DraftInput, {
										type: "number",
										value: String(config.display.thresholdWarnPercent),
										width: "90px",
										onCommit: (value) => write(["display", "thresholdWarnPercent"], Number(value))
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: MUTED,
										children: t("thresholdCritical")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DraftInput, {
										type: "number",
										value: String(config.display.thresholdCriticalPercent),
										width: "90px",
										onCommit: (value) => write(["display", "thresholdCriticalPercent"], Number(value))
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: ROW,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: MUTED,
									children: t("intervalMinutes")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DraftInput, {
									type: "number",
									value: String(config.refresh.intervalMinutes),
									width: "90px",
									onCommit: (value) => write(["refresh", "intervalMinutes"], Number(value))
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
								checked: config.display.progressBar,
								label: t("progressBar"),
								onChange: (next) => write(["display", "progressBar"], next)
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: ROW,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							size: "sm",
							variant: "ghost",
							onClick: props.close,
							children: t("close")
						})
					})
				]
			});
		}
		//#endregion
		//#region src/shared/display.ts
		const CURRENCY_SYMBOLS = {
			CNY: "¥",
			USD: "$"
		};
		const PROGRESS_WIDTH = 8;
		/** `¥66.28`, `$6.80`, `EUR 1.50`; an unknown code keeps its numeric form. */
		function formatBalance(balance) {
			const amount = balance.amount.toFixed(2);
			const currency = balance.currency.trim().toUpperCase();
			if (currency === "") return amount;
			const symbol = CURRENCY_SYMBOLS[currency];
			return symbol === void 0 ? `${currency} ${amount}` : `${symbol}${amount}`;
		}
		/** One decimal only when it carries information: `42%`, `42.5%`. */
		function formatPercent(percent) {
			const rounded = Math.round(percent * 10) / 10;
			return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
		}
		/** Compact, language-neutral age of a kept reading: `45s`, `12m`, `4h12m`, `3d`. */
		function formatAge(since, now) {
			return formatCountdown(now, since) ?? "0s";
		}
		/** Compact, language-neutral remaining time: `5d`, `3d4h`, `4h12m`, `12m`, `45s`. */
		function formatCountdown(resetsAt, now) {
			if (resetsAt === void 0) return void 0;
			const seconds = Math.floor(Math.max(0, resetsAt - now) / 1e3);
			const days = Math.floor(seconds / 86400);
			if (days >= 1) {
				const hours = Math.floor(seconds % 86400 / 3600);
				return hours === 0 ? `${days}d` : `${days}d${hours}h`;
			}
			const hours = Math.floor(seconds / 3600);
			if (hours >= 1) return `${hours}h${Math.floor(seconds % 3600 / 60)}m`;
			const minutes = Math.floor(seconds / 60);
			return minutes >= 1 ? `${minutes}m` : `${seconds}s`;
		}
		function progressBar(percent, width = PROGRESS_WIDTH) {
			const filled = Math.min(width, Math.max(0, Math.round(percent / 100 * width)));
			return "█".repeat(filled) + "░".repeat(width - filled);
		}
		function severityOf(usedPercent, display) {
			if (usedPercent >= display.thresholdCriticalPercent) return "critical";
			if (usedPercent >= display.thresholdWarnPercent) return "warn";
			return "normal";
		}
		/**
		* The status line's content, as data: numbers formatted, states named, nothing
		* localized. The browser turns `state` and window ids into copy.
		*
		* A stale reading stays visible (with the label flagged) because hiding it would
		* look like "no usage"; a failure with no previous reading shows the error state
		* instead of a misleading zero.
		*/
		function describeStatus(input) {
			const { status, snapshot, display, now } = input;
			if (status.kind === "hidden") return [];
			if (status.kind === "unconfigured") return [{
				kind: "state",
				state: "unconfigured"
			}];
			if (status.kind === "needs-endpoint") return [{
				kind: "state",
				state: "needs-endpoint"
			}];
			if (status.kind === "unsupported") return [{
				kind: "state",
				state: "unsupported"
			}];
			const label = snapshot?.stale === true ? {
				kind: "label",
				text: input.sourceLabel,
				stale: true,
				...snapshot.fetchedAt > 0 ? { staleSince: snapshot.fetchedAt } : {}
			} : {
				kind: "label",
				text: input.sourceLabel
			};
			if (snapshot === void 0) return [label, {
				kind: "state",
				state: "loading"
			}];
			if (snapshot.balances.length === 0 && snapshot.windows.length === 0) return [label, snapshot.error === void 0 ? {
				kind: "state",
				state: "loading"
			} : {
				kind: "state",
				state: "error",
				errorKind: snapshot.error.kind,
				...snapshot.error.detail === void 0 ? {} : { errorDetail: snapshot.error.detail }
			}];
			const segments = [label];
			for (const balance of snapshot.balances) segments.push({
				kind: "balance",
				amount: formatBalance(balance),
				currency: balance.currency,
				...balance.granted === void 0 ? {} : { granted: balance.granted },
				...balance.toppedUp === void 0 ? {} : { toppedUp: balance.toppedUp }
			});
			for (const window of snapshot.windows) {
				const segment = {
					kind: "window",
					windowId: window.id,
					percent: formatPercent(window.usedPercent),
					severity: severityOf(window.usedPercent, display)
				};
				if (window.resetsAt !== void 0 && window.resetsAt > now) segment.resetsAt = window.resetsAt;
				if (display.progressBar) segment.bar = progressBar(window.usedPercent);
				segments.push(segment);
			}
			return segments;
		}
		//#endregion
		//#region src/client/status-text.ts
		/**
		* Window ids are data, not copy: `5h` is the same in every language. When the
		* dictionary has no entry the raw id is shown rather than the lookup key.
		*/
		function windowLabel(id, t) {
			const key = `window.${id}`;
			const text = t(key);
			return text === key ? id : text;
		}
		/** Join the pieces of a tooltip, dropping the ones that do not apply. */
		function tooltipOf(pieces) {
			const present = pieces.filter((piece) => piece !== void 0 && piece !== "");
			return present.length === 0 ? void 0 : present.join(" · ");
		}
		function localTime(epochMs) {
			return new Date(epochMs).toLocaleTimeString();
		}
		/**
		* Turn the host's language-neutral segments into render-ready parts.
		*
		* Every part also carries a tooltip: the line has room for one number per window,
		* while the useful context (which source and mode this reading belongs to, when it
		* was last refreshed, when a window resets, how a balance splits) does not fit.
		*/
		function statusParts(input) {
			const { segments, t, now, sourceLabel, modeLabel } = input;
			const context = tooltipOf([sourceLabel === void 0 ? void 0 : t("tipSource", { source: sourceLabel }), modeLabel === void 0 ? void 0 : t("tipMode", { mode: modeLabel })]);
			const parts = [];
			for (const segment of segments) switch (segment.kind) {
				case "label": {
					const staleHint = segment.stale === true ? t("staleHint") : void 0;
					const refreshHint = segment.staleSince === void 0 ? void 0 : t("tipUpdated", { age: formatAge(segment.staleSince, now) });
					parts.push({
						kind: "label",
						text: segment.text,
						stale: segment.stale === true,
						...tooltipOf([
							staleHint,
							refreshHint,
							context
						]) === void 0 ? {} : { tooltip: tooltipOf([
							staleHint,
							refreshHint,
							context
						]) }
					});
					if (segment.staleSince !== void 0) parts.push({
						kind: "age",
						text: t("staleAgo", { age: formatAge(segment.staleSince, now) }),
						...staleHint === void 0 ? {} : { tooltip: staleHint }
					});
					break;
				}
				case "balance": {
					const split = segment.granted === void 0 && segment.toppedUp === void 0 ? void 0 : t("tipBalanceSplit", {
						granted: segment.granted === void 0 ? "—" : String(segment.granted),
						toppedUp: segment.toppedUp === void 0 ? "—" : String(segment.toppedUp)
					});
					parts.push({
						kind: "balance",
						text: segment.amount,
						currency: segment.currency,
						...tooltipOf([split, context]) === void 0 ? {} : { tooltip: tooltipOf([split, context]) }
					});
					break;
				}
				case "window": {
					const countdown = formatCountdown(segment.resetsAt, now);
					const resetHint = segment.resetsAt === void 0 ? void 0 : t("tipResets", { time: localTime(segment.resetsAt) });
					parts.push({
						kind: "window",
						id: segment.windowId,
						text: `${windowLabel(segment.windowId, t)} ${segment.percent}`,
						percent: segment.percent,
						severity: segment.severity,
						...countdown === void 0 ? {} : { countdown },
						...segment.bar === void 0 ? {} : { bar: segment.bar },
						...tooltipOf([resetHint, context]) === void 0 ? {} : { tooltip: tooltipOf([resetHint, context]) }
					});
					break;
				}
				case "state": {
					const reason = segment.errorKind === void 0 ? void 0 : segment.errorDetail === void 0 ? t(`error.${segment.errorKind}`) : `${t(`error.${segment.errorKind}`)}: ${segment.errorDetail}`;
					parts.push({
						kind: "state",
						state: segment.state,
						text: t(`state.${segment.state}`),
						...segment.errorKind === void 0 ? {} : { errorKind: segment.errorKind },
						...segment.errorDetail === void 0 ? {} : { errorDetail: segment.errorDetail },
						...tooltipOf([reason, context]) === void 0 ? {} : { tooltip: tooltipOf([reason, context]) }
					});
					break;
				}
			}
			return parts;
		}
		/**
		* The same parts, reduced to what fits the completed-turn action strip: one line
		* shared with the turn's icons and the platform's own usage/time pills.
		*
		* The provider label becomes the icon, the stale age is dropped (the icon keeps the
		* tooltip), and each window keeps only its percentage — the countdown, the progress
		* bar and every other detail stay available in the tooltip.
		*/
		function compactParts(parts) {
			const compact = [];
			for (const part of parts) {
				if (part.kind === "label" || part.kind === "age") continue;
				if (part.kind === "window") {
					compact.push({
						kind: "window",
						id: part.id,
						text: part.text,
						percent: part.percent,
						severity: part.severity,
						...part.tooltip === void 0 ? {} : { tooltip: part.tooltip }
					});
					continue;
				}
				compact.push(part);
			}
			return compact;
		}
		//#endregion
		//#region src/client/StatusLine.tsx
		const BASE_STYLE = {
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			gap: "8px",
			fontSize: "var(--dsh-content-font-size-secondary, 13px)",
			lineHeight: "calc(20px + var(--dsh-content-font-delta-secondary, 0px))",
			fontVariantNumeric: "tabular-nums",
			whiteSpace: "nowrap",
			overflow: "hidden",
			textOverflow: "ellipsis"
		};
		/** Matches the shipped stats row so this reads as its second line, not a stray block. */
		const DOCK_STYLE = {
			...BASE_STYLE,
			width: "100%",
			maxWidth: "var(--dsh-chat-content-width)",
			margin: "0 auto",
			padding: "4px calc(var(--dsh-composer-side-clearance) + 16px) 0"
		};
		/**
		* The completed-turn mount point is the platform's action strip: a 28px row that
		* holds the turn's icons, its own token/time pills, and the timestamp.
		*
		* Our entry is placed between the copy and branch controls by the platform
		* (`MessageIconActions.extraActions`), which is not where a reading belongs, so
		* `order: 1` moves it to the end of that flex row instead. The label becomes an
		* icon and the countdown/progress bar drop out (see `compactParts`); every detail
		* stays in the tooltip.
		*/
		const ACTIONS_STYLE = {
			...BASE_STYLE,
			order: 1,
			justifyContent: "flex-end",
			fontSize: "12px"
		};
		const ICON_STYLE = {
			display: "inline-flex",
			alignItems: "center",
			color: "var(--dsw-alias-label-tertiary)"
		};
		const LABEL_STYLE = { color: "var(--dsw-alias-label-tertiary)" };
		const SEPARATOR_STYLE = { color: "var(--dsw-alias-separator-primary, var(--dsw-alias-label-dimmed))" };
		function severityColor(severity) {
			if (severity === "critical") return "var(--dsw-alias-state-error-primary)";
			if (severity === "warn") return "var(--dsw-alias-state-warn-primary)";
			return "var(--dsw-alias-label-secondary)";
		}
		/** Wrap one part in the platform tooltip when it has something more to say. */
		function withTooltip(node, tooltip, key) {
			if (tooltip === void 0) return node;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
				label: tooltip,
				side: "top",
				children: node
			}, `tip-${key}`);
		}
		function renderPart(part, t, key) {
			switch (part.kind) {
				case "label": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					style: LABEL_STYLE,
					children: [part.stale ? "⚠ " : "", part.text]
				}, key);
				case "age": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: LABEL_STYLE,
					children: part.text
				}, key);
				case "balance": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: { color: "var(--dsw-alias-label-secondary)" },
					children: part.text
				}, key);
				case "window": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					style: { color: severityColor(part.severity) },
					children: [
						part.text,
						part.countdown === void 0 ? "" : ` (${part.countdown})`,
						part.bar === void 0 ? "" : ` ${part.bar}`
					]
				}, key);
				case "state": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: LABEL_STYLE,
					children: part.text
				}, key);
			}
		}
		/** Map a provider resolution onto what the line can say about it. */
		function statusOf(resolution) {
			switch (resolution.reason) {
				case "hidden": return { kind: "hidden" };
				case "needs-endpoint": return { kind: "needs-endpoint" };
				case "unknown-source":
				case "unsupported": return resolution.sourceId === null ? { kind: "unconfigured" } : { kind: "unsupported" };
				case "auto":
				case "configured":
					if (resolution.key === void 0 || resolution.sourceId === null || resolution.mode === null) return { kind: "unconfigured" };
					return {
						kind: "ready",
						key: resolution.key,
						sourceId: resolution.sourceId,
						mode: resolution.mode
					};
			}
		}
		/** One read-only usage line: balance in API mode, 5h/7d quota in coding-plan mode. */
		function StatusLine(props) {
			const t = props.t;
			const now = useNow(3e4);
			const state = useStoreState(props.usageState);
			const config = useSettingsValue(props.settings).value;
			const selection = props.useProjection?.("modelSelection");
			const current = selection?.next ?? selection?.lastUsed ?? null;
			if (config === void 0 || current === null) return null;
			const status = statusOf(resolveProvider({
				provider: current.provider,
				config,
				catalog: state.catalog
			}));
			const snapshot = status.kind === "ready" ? state.snapshots[status.key] : void 0;
			const sourceLabel = status.kind === "ready" ? state.catalog.find((entry) => entry.id === status.sourceId)?.displayName ?? status.sourceId : "";
			const fullParts = statusParts({
				segments: describeStatus({
					sourceLabel,
					status,
					snapshot,
					display: config.display,
					now
				}),
				t,
				now,
				...sourceLabel === "" ? {} : { sourceLabel },
				...status.kind === "ready" ? { modeLabel: status.mode === "api" ? t("modeApi") : t("modeCodingPlan") } : {}
			});
			if (fullParts.length === 0) return null;
			const compact = props.variant === "actions";
			const parts = compact ? compactParts(fullParts) : fullParts;
			const iconTooltip = fullParts.find((part) => part.kind === "label")?.tooltip;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				"data-usage-state": props.variant,
				style: compact ? ACTIONS_STYLE : DOCK_STYLE,
				children: [compact ? withTooltip(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: ICON_STYLE,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconDataOutline16, { size: 16 })
				}), iconTooltip, -1) : null, parts.map((part, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [index > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: SEPARATOR_STYLE,
					"aria-hidden": "true",
					children: "·"
				}) : null, withTooltip(renderPart(part, t, index), part.tooltip, index)] }, index))]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		const LOCALE_NS = "usage-state";
		const zh = {
			nav: "用量状态",
			title: "用量状态",
			intro: "为每个模型选择显示账户余额（API 模式）或套餐额度（Coding Plan 模式）。数据由宿主定时刷新，密钥存放在 DSH 凭据库中，本插件不保存明文。",
			refreshNow: "立即刷新",
			refreshing: "刷新中…",
			lastChecked: "更新于 {time}",
			neverChecked: "尚未获取",
			close: "关闭",
			unavailable: "当前连接不支持读写设置。",
			empty: "还没有发现任何供应商。请先在 DSH 里配置模型供应商。",
			sectionProviders: "供应商",
			sectionProvidersHint: "余额与额度是账户级的，所以每个供应商只需设置一次：默认「自动」会识别出该用哪个数据源并直接生效。",
			sectionDisplay: "显示",
			modeAuto: "自动",
			modeApi: "API 余额",
			modeCodingPlan: "Coding Plan",
			modeHidden: "隐藏",
			modeUnsupported: "该数据源不支持此模式",
			moveUp: "上移",
			moveDown: "下移",
			sourceLabel: "数据源",
			sourceAuto: "自动",
			detectedAs: "自动识别为 {target}",
			showsAs: "显示 {target}",
			needsEndpoint: "需要先填写接口地址",
			unknownSource: "没有可用的数据源",
			notConfigured: "未配置",
			advanced: "高级",
			modelsPrefix: "模型：{list}",
			noModels: "（目录里没有模型）",
			baseUrl: "接口地址",
			baseUrlPlaceholder: "https://…",
			baseUrlRequired: "此数据源必须填写你自己实例的接口地址",
			apiKeyRef: "凭据名（可选）",
			apiKeyRefHint: "留空则自动探测；填写后优先使用该凭据名。",
			credential: "密钥",
			credentialConfigured: "已配置（来源：{source}）",
			credentialMissing: "未配置",
			credentialLocked: "由环境变量提供，无法在此修改",
			credentialPlaceholder: "粘贴密钥…",
			credentialSave: "保存",
			credentialClear: "清除",
			credentialSaved: "已保存",
			credentialFailed: "保存失败：{message}",
			credentialHint: "密钥写入 DSH 凭据库（~/.dsh/.credentials.yaml），不会存进本插件。",
			intervalMinutes: "空闲刷新间隔（分钟）",
			thresholdWarn: "黄色阈值（已用 %）",
			thresholdCritical: "红色阈值（已用 %）",
			progressBar: "显示进度条",
			refreshFailed: "刷新失败：{message}",
			"state.loading": "读取中…",
			"state.unconfigured": "未配置",
			"state.unsupported": "模式不支持",
			"state.needs-endpoint": "需要先填写接口地址",
			"state.error": "获取失败",
			"error.config": "缺少密钥或接口地址",
			"error.auth": "密钥无效",
			"error.http": "接口返回错误",
			"error.network": "网络不可达",
			"error.parse": "返回内容无法解析",
			"error.unknown": "未知错误",
			staleHint: "当前显示的是上一次成功获取的值",
			staleAgo: "{age} 前",
			tipSource: "数据源 {source}",
			tipMode: "模式 {mode}",
			tipUpdated: "上次成功更新 {age} 前",
			tipResets: "重置于 {time}",
			tipBalanceSplit: "赠送 {granted} · 充值 {toppedUp}",
			tipMore: "悬停查看详情",
			"window.5h": "5h",
			"window.1d": "1d",
			"window.7d": "7d",
			"window.30d": "30d"
		};
		const en = {
			nav: "Usage state",
			title: "Usage state",
			intro: "Choose what to show for each model: account balance (API mode) or coding-plan quota (Coding Plan mode). The host refreshes on a timer, and keys live in the DSH credential store — this plugin never keeps a plaintext copy.",
			refreshNow: "Refresh now",
			refreshing: "Refreshing…",
			lastChecked: "Updated {time}",
			neverChecked: "Not fetched yet",
			close: "Close",
			unavailable: "This connection does not serve settings.",
			empty: "No providers found yet. Configure an LLM provider in DSH first.",
			sectionProviders: "Providers",
			sectionProvidersHint: "Balance and quota are account-level, so one setting per provider is enough. “Auto” detects which data source to use and works right away.",
			sectionDisplay: "Display",
			modeAuto: "Auto",
			modeApi: "API balance",
			modeCodingPlan: "Coding plan",
			modeHidden: "Hidden",
			modeUnsupported: "This data source does not serve that mode",
			moveUp: "Move up",
			moveDown: "Move down",
			sourceLabel: "Source",
			sourceAuto: "Auto",
			detectedAs: "Detected {target}",
			showsAs: "Shows {target}",
			needsEndpoint: "Needs an endpoint first",
			unknownSource: "No data source available",
			notConfigured: "Not configured",
			advanced: "Advanced",
			modelsPrefix: "Models: {list}",
			noModels: "(no models in the catalog)",
			baseUrl: "Endpoint",
			baseUrlPlaceholder: "https://…",
			baseUrlRequired: "This data source needs the endpoint of your own instance",
			apiKeyRef: "Credential name (optional)",
			apiKeyRefHint: "Leave blank to auto-detect; when set, this ref is tried first.",
			credential: "API key",
			credentialConfigured: "Configured ({source})",
			credentialMissing: "Not configured",
			credentialLocked: "Provided by an environment variable; not editable here",
			credentialPlaceholder: "Paste the key…",
			credentialSave: "Save",
			credentialClear: "Clear",
			credentialSaved: "Saved",
			credentialFailed: "Could not save: {message}",
			credentialHint: "The key is written to the DSH credential store (~/.dsh/.credentials.yaml), not to this plugin.",
			intervalMinutes: "Idle refresh interval (minutes)",
			thresholdWarn: "Amber threshold (used %)",
			thresholdCritical: "Red threshold (used %)",
			progressBar: "Show progress bar",
			refreshFailed: "Refresh failed: {message}",
			"state.loading": "Reading…",
			"state.unconfigured": "Not configured",
			"state.unsupported": "Mode not supported",
			"state.needs-endpoint": "Needs an endpoint first",
			"state.error": "Unavailable",
			"error.config": "Missing key or endpoint",
			"error.auth": "Key rejected",
			"error.http": "The endpoint returned an error",
			"error.network": "Network unreachable",
			"error.parse": "The response could not be parsed",
			"error.unknown": "Unknown error",
			staleHint: "Showing the last value that was fetched successfully",
			staleAgo: "{age} ago",
			tipSource: "Source {source}",
			tipMode: "Mode {mode}",
			tipUpdated: "Last successful update {age} ago",
			tipResets: "Resets at {time}",
			tipBalanceSplit: "Granted {granted} · Topped up {toppedUp}",
			tipMore: "Hover for details",
			"window.5h": "5h",
			"window.1d": "1d",
			"window.7d": "7d",
			"window.30d": "30d"
		};
		//#endregion
		//#region src/client/remote.ts
		/**
		* Reading a remote namespace off the client context.
		*
		* `ctx.remote.<namespace>` is a service proxy: plain property access throws
		* `cannot get property "remote.<ns>" without inject` unless the name is declared
		* in the plugin's `inject` list. That cannot work for the namespace this plugin
		* contributes itself (`remote.usageState`) — it only exists after `$mount`, so
		* declaring it would deadlock. `ctx.get()` is the inject-free accessor and returns
		* `undefined` while the namespace is absent.
		*/
		function remoteService(ctx, name) {
			try {
				const service = ctx.get(name);
				return service === void 0 ? void 0 : service;
			} catch {
				return;
			}
		}
		//#endregion
		//#region src/client/slots.ts
		const STATUS_LINE_SLOTS = [{
			name: "conversation.composer.dock",
			id: "usage-state",
			order: 1,
			locale: "usage-state",
			variant: "dock"
		}, {
			name: "conversation.chat.assistant-actions",
			id: "usage-state",
			order: 1,
			locale: "usage-state",
			variant: "actions"
		}];
		//#endregion
		//#region src/client/store.ts
		/** Flatten the DSH model catalog into the rows the settings page lists. */
		function flattenCatalog(catalog) {
			if (catalog === void 0) return [];
			const rows = [];
			for (const group of catalog.groups) for (const model of group.models) rows.push({
				provider: group.id,
				providerName: group.name,
				model: model.id,
				name: model.name
			});
			return rows;
		}
		function messageOf(error) {
			return error instanceof Error ? error.message : String(error);
		}
		/**
		* The registry view of a catalog result, or `undefined` when it does not carry one
		* (a host older than `routableProviders`). Unknown is not the same as empty: the
		* settings page keeps stored entries visible while the registry is unknown, so a
		* failed or unavailable catalog can never hide configuration that needs clearing.
		*/
		function registryOf(catalog) {
			if (catalog?.routableProviders === void 0) return void 0;
			return {
				routable: [...catalog.routableProviders],
				failed: (catalog.failures ?? []).map((failure) => failure.id)
			};
		}
		/**
		* The browser's mirror of the host's readings.
		*
		* Two rules keep the status line honest: a failed refresh never clears what is
		* already displayed (it only records why), and concurrent callers share one
		* in-flight call so a component re-render cannot multiply RPC traffic.
		*/
		var UsageStateClientStore = class {
			deps;
			listeners = /* @__PURE__ */ new Set();
			state = {
				status: "idle",
				catalog: [],
				snapshots: {},
				credentials: {},
				checkedAt: void 0,
				models: [],
				modelRegistry: void 0,
				error: void 0,
				credentialsError: void 0,
				modelsError: void 0
			};
			inflight;
			constructor(deps) {
				this.deps = deps;
			}
			getSnapshot() {
				return this.state;
			}
			subscribe(listener) {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			}
			publish(patch) {
				this.state = {
					...this.state,
					...patch
				};
				for (const listener of [...this.listeners]) listener();
			}
			refresh(force = false) {
				if (this.inflight !== void 0) return this.inflight;
				this.publish({ status: "loading" });
				const run = (async () => {
					try {
						const result = await this.deps.getState(force);
						if (!result.ok) {
							this.publish({
								status: "error",
								error: result.error.message
							});
							return;
						}
						this.publish({
							status: "ready",
							catalog: result.value.sources,
							snapshots: result.value.snapshots,
							checkedAt: result.value.checkedAt,
							error: void 0
						});
					} catch (error) {
						this.publish({
							status: "error",
							error: messageOf(error)
						});
					}
				})().finally(() => {
					this.inflight = void 0;
				});
				this.inflight = run;
				return run;
			}
			/** Load the model catalog once per settings-page visit. */
			async refreshModels() {
				if (this.deps.modelCatalog === void 0) return;
				try {
					const result = await this.deps.modelCatalog();
					if (!result.ok) {
						this.publish({
							modelsError: result.error.message,
							modelRegistry: void 0
						});
						return;
					}
					this.publish({
						models: flattenCatalog(result.value),
						modelRegistry: registryOf(result.value),
						modelsError: void 0
					});
				} catch (error) {
					this.publish({
						modelsError: messageOf(error),
						modelRegistry: void 0
					});
				}
			}
			async refreshCredentials() {
				try {
					const result = await this.deps.describeCredentials();
					if (!result.ok) {
						this.publish({ credentialsError: result.error.message });
						return;
					}
					this.publish({
						credentials: result.value.credentials,
						credentialsError: void 0
					});
				} catch (error) {
					this.publish({ credentialsError: messageOf(error) });
				}
			}
		};
		//#endregion
		//#region src/client/index.tsx
		const inject = [
			"slots",
			"locale",
			"settingsScope",
			"remote",
			"remote.session",
			"remote.credentials"
		];
		const USAGE_STATE_NS = "usage-state";
		const POLL_INTERVAL_MS = 3e4;
		/** Hand-rolled codecs: the browser bundle must not carry zod. */
		const booleanOrUndefined = {
			mode: "strict",
			typeSymbol: "dsh-usage-state#Force",
			schema: { parse: (value) => value === void 0 ? void 0 : value === true }
		};
		const srcJson = { mode: "src-json" };
		/** Must mirror `src/host/typert.ts`: the wire endpoint is `<namespace>/<method>`. */
		const CONTRIBUTION = {
			package: "dsh-usage-state",
			descriptors: [{
				id: "dsh-usage-state#usageState/getState",
				service: "usageState",
				namespace: "usageState",
				method: "getState",
				invocation: { kind: "direct" },
				parameters: [{
					name: "force",
					wire: "force",
					source: "json",
					acceptsUndefined: true,
					codec: booleanOrUndefined
				}],
				result: srcJson
			}, {
				id: "dsh-usage-state#usageState/describeCredentials",
				service: "usageState",
				namespace: "usageState",
				method: "describeCredentials",
				invocation: { kind: "direct" },
				parameters: [],
				result: srcJson
			}]
		};
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(LOCALE_NS, {
				zh,
				en
			}), "dsh-usage-state: dictionaries");
			const t = ctx.locale.bind(LOCALE_NS);
			const settings = ctx.settingsScope.bind({
				namespace: USAGE_STATE_NS,
				decode: (section) => normalizeConfig(section)
			});
			const usageStateRemote = () => remoteService(ctx, "remote.usageState");
			const store = new UsageStateClientStore({
				getState: async (force) => {
					const service = usageStateRemote();
					if (service === void 0) return {
						ok: false,
						error: { message: "remote not mounted" }
					};
					return service.getState(force);
				},
				describeCredentials: async () => {
					const service = usageStateRemote();
					if (service === void 0) return {
						ok: false,
						error: { message: "remote not mounted" }
					};
					return service.describeCredentials();
				},
				modelCatalog: async () => {
					const session = remoteService(ctx, "remote.session");
					if (session === void 0) return {
						ok: false,
						error: { message: "model catalog unavailable" }
					};
					return session.modelCatalog();
				}
			});
			ctx.effect(() => {
				let dispose;
				let cancelled = false;
				ctx.remote.$mount(CONTRIBUTION).then((off) => {
					if (cancelled) {
						off();
						return;
					}
					dispose = off;
					store.refresh(false);
					store.refreshModels();
					store.refreshCredentials();
				}, () => void 0);
				return () => {
					cancelled = true;
					dispose?.();
				};
			}, "dsh-usage-state: remote contribution");
			ctx.effect(() => {
				const timer = setInterval(() => {
					store.refresh(false);
					if (store.getSnapshot().models.length === 0) store.refreshModels();
				}, POLL_INTERVAL_MS);
				const disposers = [
					ctx.on("api-session/status", (...args) => {
						if (args[1] === false) store.refresh(false);
					}),
					ctx.on("connection/reset", () => {
						store.refresh(true);
					}),
					settings.subscribe(() => {
						store.refresh(false);
					})
				];
				return () => {
					clearInterval(timer);
					for (const dispose of disposers) dispose();
				};
			}, "dsh-usage-state: refresh loop");
			const seat = () => ({
				usageState: store,
				settings
			});
			for (const slot of STATUS_LINE_SLOTS) ctx.slots.inject(slot.name, () => ctx.slots.register({
				name: slot.name,
				id: slot.id,
				order: slot.order,
				locale: slot.locale,
				inject: seat
			}, (props) => (0, react.createElement)(StatusLine, {
				...props,
				variant: slot.variant
			})));
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "usage-state",
				order: 200,
				label: () => t("nav"),
				locale: LOCALE_NS,
				inject: () => ({
					...seat(),
					credentials: remoteService(ctx, "remote.credentials")
				})
			}, SettingsSection));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
