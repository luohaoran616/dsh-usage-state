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
		/**
		* Turn whatever the hand-editable settings document contains into a usable
		* config. Deliberately never throws: the settings provider calls the schema
		* synchronously at registration time, and a dirty section must not block the
		* plugin from loading. Malformed pieces fall back to defaults instead.
		*/
		function normalizeConfig(raw) {
			const root = asRecord(raw) ?? {};
			return {
				models: normalizeModels(root.models),
				sources: normalizeSources(root.sources),
				refresh: normalizeRefresh(root.refresh),
				display: normalizeDisplay(root.display)
			};
		}
		const PROVIDER_HINTS = [
			{
				sourceId: "deepseek",
				pattern: /deepseek/
			},
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
		//#region src/client/model-rows.ts
		/** Stable identity of one model, safe against id strings containing separators. */
		function rowKey(provider, model) {
			return `${provider}\u0000${model}`;
		}
		const ALL_MODES = [
			"api",
			"coding-plan",
			"hidden"
		];
		function modesOf(catalog, sourceId) {
			if (sourceId === null) return [...ALL_MODES];
			const source = catalog.find((entry) => entry.id === sourceId);
			if (source === void 0) return [...ALL_MODES];
			return [...source.modes, "hidden"];
		}
		/**
		* Merge the DSH catalog with the user's configuration.
		*
		* Configured models come first in their configured order — that order *is* the
		* display order — followed by everything the catalog knows but that has not been
		* configured yet. A configured model that disappeared from the catalog still
		* appears, otherwise the user could never fix or remove it.
		*/
		function buildModelRows(input) {
			const { models, config, catalog } = input;
			const catalogByKey = new Map(models.map((model) => [rowKey(model.provider, model.model), model]));
			const rows = [];
			const seen = /* @__PURE__ */ new Set();
			for (const entry of config.models) {
				const key = rowKey(entry.provider, entry.model);
				if (seen.has(key)) continue;
				seen.add(key);
				const known = catalogByKey.get(key);
				rows.push({
					key,
					provider: entry.provider,
					providerName: known?.providerName ?? entry.provider,
					model: entry.model,
					name: known?.name ?? entry.model,
					sourceId: entry.sourceId,
					mode: entry.mode,
					unconfigured: false,
					modes: modesOf(catalog, entry.sourceId)
				});
			}
			for (const model of models) {
				const key = rowKey(model.provider, model.model);
				if (seen.has(key)) continue;
				seen.add(key);
				const sourceId = suggestSourceId(model.provider) ?? null;
				rows.push({
					...model,
					key,
					sourceId,
					mode: "hidden",
					unconfigured: true,
					modes: modesOf(catalog, sourceId)
				});
			}
			return rows;
		}
		/** Set (or add) one model's configuration, preserving the existing order. */
		function configureModel(models, input) {
			const entry = {
				provider: input.provider,
				model: input.model,
				sourceId: input.sourceId,
				mode: input.mode
			};
			const index = models.findIndex((candidate) => candidate.provider === input.provider && candidate.model === input.model);
			if (index < 0) return [...models, entry];
			const next = [...models];
			next[index] = entry;
			return next;
		}
		/**
		* Move one configured model by `delta` positions. Returns `undefined` when the
		* move is impossible (unknown model, or already at the end), so callers can skip
		* a pointless write.
		*/
		function reorderModels(models, key, delta) {
			const index = models.findIndex((entry) => rowKey(entry.provider, entry.model) === key);
			if (index < 0) return void 0;
			const target = index + delta;
			if (target < 0 || target >= models.length) return void 0;
			const next = [...models];
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
		const MODE_ORDER = [
			"api",
			"coding-plan",
			"hidden"
		];
		function modeLabel(mode, t) {
			if (mode === "api") return t("modeApi");
			if (mode === "coding-plan") return t("modeCodingPlan");
			return t("modeHidden");
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
		/** One credential panel: status, write and clear, all through the platform's credential RPC. */
		function CredentialPanel(props) {
			const { t } = props;
			const [draft, setDraft] = (0, react.useState)("");
			const [note, setNote] = (0, react.useState)(void 0);
			const configuredRef = props.status?.ref ?? props.refs[0];
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
							props.status?.configured === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
								tone: "success",
								children: t("credentialConfigured", { source: props.status.source ?? configuredRef ?? "" })
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
								tone: "neutral",
								children: t("credentialMissing")
							}),
							props.writable ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
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
								disabled: !props.writable || props.credentials === void 0,
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
								disabled: props.status?.configured !== true,
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
		/**
		* The plugin's settings page: models (tri-state + order), the data sources they
		* use, and display preferences. Writes go through the platform settings scope as
		* path ops, so a concurrent edit elsewhere cannot silently clobber other fields.
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
			const rows = buildModelRows({
				models: state.models,
				config,
				catalog: state.catalog
			});
			const configured = rows.filter((row) => !row.unconfigured);
			const available = rows.filter((row) => row.unconfigured);
			const writeModels = (models) => {
				props.settings.mutate([{
					op: "set",
					path: ["models"],
					value: models
				}]);
			};
			const writeField = (path, value) => {
				props.settings.mutate([{
					op: "set",
					path,
					value
				}]);
			};
			const clearField = (path) => {
				props.settings.mutate([{
					op: "unset",
					path
				}]);
			};
			const setMode = (row, mode) => {
				writeModels(configureModel(config.models, {
					provider: row.provider,
					model: row.model,
					sourceId: row.sourceId,
					mode
				}));
			};
			const move = (row, delta) => {
				const next = reorderModels(config.models, row.key, delta);
				if (next !== void 0) writeModels(next);
			};
			const renderRow = (row, index, list) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
					children: [
						row.name,
						" ",
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: MUTED,
							children: row.providerName
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					style: ROW,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							size: "sm",
							variant: "ghost",
							"aria-label": t("moveUp"),
							disabled: index === 0,
							onClick: () => move(row, -1),
							children: "↑"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							size: "sm",
							variant: "ghost",
							"aria-label": t("moveDown"),
							disabled: index === list.length - 1,
							onClick: () => move(row, 1),
							children: "↓"
						}),
						MODE_ORDER.filter((mode) => row.modes.includes(mode)).map((mode) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							size: "sm",
							variant: row.mode === mode ? "primary" : "outline",
							disabled: !row.modes.includes(mode),
							title: row.modes.includes(mode) ? void 0 : t("modeUnsupported"),
							onClick: () => setMode(row, mode),
							children: modeLabel(mode, t)
						}, mode))
					]
				})]
			}, row.key);
			const usedSources = [...new Set(configured.filter((row) => row.mode !== "hidden" && row.sourceId !== null).map((row) => row.sourceId))];
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
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("sectionModels") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: MUTED,
								children: t("sectionModelsHint")
							}),
							configured.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: MUTED,
								children: t("empty")
							}) : configured.map((row, index) => renderRow(row, index, configured)),
							available.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: MUTED,
								children: t("unconfiguredModel")
							}), available.map((row, index) => renderRow(row, index, available))] })
						]
					}),
					usedSources.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						style: CARD,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("sectionSources") }), usedSources.map((sourceId) => {
							const entry = state.catalog.find((candidate) => candidate.id === sourceId);
							const override = config.sources[sourceId] ?? {};
							const mode = configured.find((row) => row.sourceId === sourceId && row.mode !== "hidden")?.mode;
							const status = mode === void 0 || mode === "hidden" ? void 0 : state.credentials[`${sourceId}:${mode}`];
							const refs = mode === void 0 || mode === "hidden" ? [] : entry?.credentialRefs[mode] ?? [];
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									flexDirection: "column",
									gap: "8px"
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: ROW,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
											style: { fontSize: "13px" },
											children: entry?.displayName ?? sourceId
										}), entry?.requiresBaseUrl === true && override.baseUrl === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
											tone: "warning",
											children: t("baseUrlRequired")
										}) : null]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: ROW,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: MUTED,
											children: t("baseUrl")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
											value: override.baseUrl ?? "",
											placeholder: entry?.defaultBaseUrl[mode] ?? t("baseUrlPlaceholder"),
											onChange: (event) => {
												const value = event.target.value.trim();
												if (value === "") clearField([
													"sources",
													sourceId,
													"baseUrl"
												]);
												else writeField([
													"sources",
													sourceId,
													"baseUrl"
												], value);
											},
											style: { maxWidth: "320px" }
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: ROW,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: MUTED,
												children: t("apiKeyRef")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DraftInput, {
												value: override.apiKeyRef ?? "",
												width: "220px",
												onCommit: (value) => {
													if (value === "") clearField([
														"sources",
														sourceId,
														"apiKeyRef"
													]);
													else writeField([
														"sources",
														sourceId,
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
										status,
										writable: status?.writable !== false,
										credentials: props.credentials,
										onChanged: () => void props.usageState.refreshCredentials()
									})
								]
							}, sourceId);
						})]
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
										onCommit: (value) => writeField(["display", "thresholdWarnPercent"], Number(value))
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: MUTED,
										children: t("thresholdCritical")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DraftInput, {
										type: "number",
										value: String(config.display.thresholdCriticalPercent),
										width: "90px",
										onCommit: (value) => writeField(["display", "thresholdCriticalPercent"], Number(value))
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
									onCommit: (value) => writeField(["refresh", "intervalMinutes"], Number(value))
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
								checked: config.display.progressBar,
								label: t("progressBar"),
								onChange: (next) => writeField(["display", "progressBar"], next)
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
		* Which reading belongs to the model a session is using. The user configures
		* models by hand, so an unknown model is "unconfigured" rather than a guess.
		*/
		function resolveModelStatus(config, provider, model, catalog) {
			const entry = config.models.find((candidate) => candidate.provider === provider && candidate.model === model);
			if (entry === void 0) return { kind: "unconfigured" };
			if (entry.mode === "hidden") return { kind: "hidden" };
			if (entry.sourceId === null) return { kind: "unconfigured" };
			const source = catalog.find((candidate) => candidate.id === entry.sourceId);
			if (source === void 0) return { kind: "unconfigured" };
			if (!source.modes.includes(entry.mode)) return {
				kind: "unsupported",
				sourceId: entry.sourceId,
				mode: entry.mode
			};
			return {
				kind: "ready",
				key: `${entry.sourceId}:${entry.mode}`,
				sourceId: entry.sourceId,
				mode: entry.mode
			};
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
			if (status.kind === "unsupported") return [{
				kind: "state",
				state: "unsupported"
			}];
			const label = snapshot?.stale === true ? {
				kind: "label",
				text: input.sourceLabel,
				stale: true
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
				errorKind: snapshot.error.kind
			}];
			const segments = [label];
			for (const balance of snapshot.balances) segments.push({
				kind: "balance",
				amount: formatBalance(balance),
				currency: balance.currency
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
		/**
		* Turn the host's language-neutral segments into render-ready parts. Everything
		* that reads as prose comes from the dictionary; numbers and window ids pass
		* through untouched.
		*/
		function statusParts(input) {
			const { segments, t, now } = input;
			const parts = [];
			for (const segment of segments) switch (segment.kind) {
				case "label":
					parts.push({
						kind: "label",
						text: segment.text,
						stale: segment.stale === true
					});
					break;
				case "balance":
					parts.push({
						kind: "balance",
						text: segment.amount,
						currency: segment.currency
					});
					break;
				case "window": {
					const countdown = formatCountdown(segment.resetsAt, now);
					parts.push({
						kind: "window",
						id: segment.windowId,
						text: `${windowLabel(segment.windowId, t)} ${segment.percent}`,
						percent: segment.percent,
						severity: segment.severity,
						...countdown === void 0 ? {} : { countdown },
						...segment.bar === void 0 ? {} : { bar: segment.bar }
					});
					break;
				}
				case "state": parts.push({
					kind: "state",
					state: segment.state,
					text: t(`state.${segment.state}`),
					...segment.errorKind === void 0 ? {} : { errorKind: segment.errorKind }
				});
			}
			return parts;
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
		const TURN_TAIL_STYLE = {
			...BASE_STYLE,
			justifyContent: "flex-start",
			padding: "2px 0 0",
			fontSize: "12px"
		};
		const LABEL_STYLE = { color: "var(--dsw-alias-label-tertiary)" };
		const SEPARATOR_STYLE = { color: "var(--dsw-alias-separator-primary, var(--dsw-alias-label-dimmed))" };
		function severityColor(severity) {
			if (severity === "critical") return "var(--dsw-alias-state-error-primary)";
			if (severity === "warn") return "var(--dsw-alias-state-warn-primary)";
			return "var(--dsw-alias-label-secondary)";
		}
		function renderPart(part, t, key) {
			switch (part.kind) {
				case "label": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					style: LABEL_STYLE,
					title: part.stale ? t("staleHint") : void 0,
					children: [part.stale ? "⚠ " : "", part.text]
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
					title: part.errorKind === void 0 ? void 0 : t(`error.${part.errorKind}`),
					children: part.text
				}, key);
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
			const status = resolveModelStatus(config, current.provider, current.model, state.catalog);
			const snapshot = status.kind === "ready" ? state.snapshots[status.key] : void 0;
			const parts = statusParts({
				segments: describeStatus({
					sourceLabel: status.kind === "ready" ? state.catalog.find((entry) => entry.id === status.sourceId)?.displayName ?? status.sourceId : "",
					status,
					snapshot,
					display: config.display,
					now
				}),
				t,
				now
			});
			if (parts.length === 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				"data-usage-state": props.variant,
				style: props.variant === "dock" ? DOCK_STYLE : TURN_TAIL_STYLE,
				children: parts.map((part, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [index > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: SEPARATOR_STYLE,
					"aria-hidden": "true",
					children: "·"
				}) : null, renderPart(part, t, index)] }, index))
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
			empty: "还没有发现任何模型。请先在 DSH 里配置模型供应商。",
			sectionModels: "模型",
			sectionModelsHint: "拖动排序不可用，请用上下按钮调整顺序；只展示已启用（API / Coding Plan）的模型。",
			sectionSources: "数据源",
			sectionDisplay: "显示",
			modeApi: "API 余额",
			modeCodingPlan: "Coding Plan",
			modeHidden: "隐藏",
			modeUnsupported: "该数据源不支持此模式",
			moveUp: "上移",
			moveDown: "下移",
			sourceLabel: "数据源",
			unconfiguredModel: "未配置",
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
			"state.error": "获取失败",
			"error.config": "缺少密钥或接口地址",
			"error.auth": "密钥无效",
			"error.http": "接口返回错误",
			"error.network": "网络不可达",
			"error.parse": "返回内容无法解析",
			"error.unknown": "未知错误",
			staleHint: "当前显示的是上一次成功获取的值",
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
			empty: "No models found yet. Configure an LLM provider in DSH first.",
			sectionModels: "Models",
			sectionModelsHint: "Drag-to-reorder is not available, so use the up/down buttons. Only enabled models (API / Coding Plan) reach the status line.",
			sectionSources: "Data sources",
			sectionDisplay: "Display",
			modeApi: "API balance",
			modeCodingPlan: "Coding plan",
			modeHidden: "Hidden",
			modeUnsupported: "This data source does not serve that mode",
			moveUp: "Move up",
			moveDown: "Move down",
			sourceLabel: "Source",
			unconfiguredModel: "Not configured",
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
			"state.error": "Unavailable",
			"error.config": "Missing key or endpoint",
			"error.auth": "Key rejected",
			"error.http": "The endpoint returned an error",
			"error.network": "Network unreachable",
			"error.parse": "The response could not be parsed",
			"error.unknown": "Unknown error",
			staleHint: "Showing the last value that was fetched successfully",
			"window.5h": "5h",
			"window.1d": "1d",
			"window.7d": "7d",
			"window.30d": "30d"
		};
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
						this.publish({ modelsError: result.error.message });
						return;
					}
					this.publish({
						models: flattenCatalog(result.value),
						modelsError: void 0
					});
				} catch (error) {
					this.publish({ modelsError: messageOf(error) });
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
			const store = new UsageStateClientStore({
				getState: async (force) => {
					const service = ctx.remote.usageState;
					if (service === void 0) return {
						ok: false,
						error: { message: "remote not mounted" }
					};
					return service.getState(force);
				},
				describeCredentials: async () => {
					const service = ctx.remote.usageState;
					if (service === void 0) return {
						ok: false,
						error: { message: "remote not mounted" }
					};
					return service.describeCredentials();
				},
				modelCatalog: async () => {
					const session = ctx.remote.session;
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
				}, () => void 0);
				return () => {
					cancelled = true;
					dispose?.();
				};
			}, "dsh-usage-state: remote contribution");
			ctx.effect(() => {
				const timer = setInterval(() => {
					store.refresh(false);
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
			ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
				name: "conversation.composer.dock",
				id: "usage-state",
				order: 1,
				locale: LOCALE_NS,
				inject: seat
			}, (props) => (0, react.createElement)(StatusLine, {
				...props,
				variant: "dock"
			})));
			ctx.slots.inject("conversation.chat.turnTail", () => ctx.slots.register({
				name: "conversation.chat.turnTail",
				priority: 1,
				locale: LOCALE_NS,
				select: () => ({}),
				inject: seat
			}, (props) => (0, react.createElement)(StatusLine, {
				...props,
				variant: "turnTail"
			})));
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "usage-state",
				order: 200,
				label: () => t("nav"),
				locale: LOCALE_NS,
				inject: () => ({
					...seat(),
					credentials: ctx.remote.credentials
				})
			}, SettingsSection));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
