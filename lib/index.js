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
function asRecord$4(value) {
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
		const entry = asRecord$4(raw);
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
	const root = asRecord$4(value);
	if (root === void 0) return {};
	const sources = {};
	for (const [id, raw] of Object.entries(root)) {
		const entry = asRecord$4(raw);
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
	const root = asRecord$4(value) ?? {};
	const defaults = DEFAULT_CONFIG.refresh;
	return {
		intervalMinutes: clampInt(root.intervalMinutes, 1, 1440, defaults.intervalMinutes),
		turnEndDelayMs: clampInt(root.turnEndDelayMs, 0, 6e4, defaults.turnEndDelayMs),
		minIntervalSeconds: clampInt(root.minIntervalSeconds, 0, 3600, defaults.minIntervalSeconds)
	};
}
function normalizeDisplay(value) {
	const root = asRecord$4(value) ?? {};
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
	const root = asRecord$4(raw) ?? {};
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
//#region src/host/sources/normalize.ts
/** Shared normalization helpers for provider payloads. */
/** Numbers and numeric strings to a finite number; anything else is absent. */
function toFiniteNumber(value) {
	if (typeof value === "number") return Number.isFinite(value) ? value : void 0;
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed === "") return void 0;
		const parsed = Number(trimmed);
		return Number.isFinite(parsed) ? parsed : void 0;
	}
}
/** Clamp to 0..100 and round to one decimal. */
function clampPercent(value) {
	if (!Number.isFinite(value)) return 0;
	return Math.min(100, Math.max(0, Math.round(value * 10) / 10));
}
/**
* Percentages arrive in two conventions: 0..1 fractions and 0..100 percentages.
* Values `<= 1` are read as fractions (so a literal "1" means 100%), anything
* larger is read as a percentage. Invalid or negative input yields `null`.
*/
function normalizePercent(value) {
	const parsed = toFiniteNumber(value);
	if (parsed === void 0 || parsed < 0) return null;
	return clampPercent(parsed <= 1 ? parsed * 100 : parsed);
}
function fromNumericInstant(value) {
	if (!Number.isFinite(value) || value <= 0) return void 0;
	return value > 0xe8d4a51000 ? Math.round(value) : Math.round(value * 1e3);
}
/**
* Reset instants arrive as unix seconds, unix milliseconds, numeric strings or
* ISO timestamps; all of them become epoch milliseconds. Missing or nonsense
* values become `undefined` rather than a bogus date.
*/
function normalizeResetAt(value) {
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed === "") return void 0;
		if (/^\d+(\.\d+)?$/.test(trimmed)) {
			const numeric = toFiniteNumber(trimmed);
			return numeric === void 0 ? void 0 : fromNumericInstant(numeric);
		}
		const parsed = Date.parse(trimmed);
		return Number.isFinite(parsed) ? parsed : void 0;
	}
	const numeric = toFiniteNumber(value);
	return numeric === void 0 ? void 0 : fromNumericInstant(numeric);
}
/** Trim whitespace, trailing slashes and a trailing `/vN` API version segment. */
function normalizeBaseUrl(value) {
	if (typeof value !== "string") return void 0;
	const trimmed = value.trim().replace(/\/+$/, "");
	if (trimmed === "") return void 0;
	const withoutVersion = trimmed.replace(/\/v\d+$/i, "");
	return withoutVersion === "" ? void 0 : withoutVersion;
}
//#endregion
//#region src/host/sources/types.ts
var SourceError = class extends Error {
	kind;
	constructor(kind, message) {
		super(message);
		this.name = "SourceError";
		this.kind = kind;
	}
};
//#endregion
//#region src/host/sources/deepseek.ts
const DEFAULT_BASE_URL$1 = "https://api.deepseek.com";
const BALANCE_PATH = "/user/balance";
/**
* DeepSeek returns one entry per currency and the order is not stable, so a
* fixed "first entry" read makes the displayed balance flip between the real
* value and zero. Rule: prefer an entry with a positive balance, prefer CNY
* among equals (the open platform's primary currency), and fall back to CNY or
* the first entry so the result never depends on response ordering.
*/
function pickBalanceInfo(infos) {
	if (!Array.isArray(infos)) return void 0;
	const entries = [];
	for (const raw of infos) {
		if (raw === null || typeof raw !== "object") continue;
		const entry = raw;
		entries.push({
			amount: toFiniteNumber(entry.total_balance) ?? 0,
			currency: typeof entry.currency === "string" ? entry.currency : ""
		});
	}
	if (entries.length === 0) return void 0;
	const cnyOf = (list) => list.find((entry) => entry.currency.toUpperCase() === "CNY");
	const funded = entries.filter((entry) => entry.amount > 0);
	return cnyOf(funded) ?? funded[0] ?? cnyOf(entries) ?? entries[0];
}
/** DeepSeek official API: balance only — the platform has no coding plan. */
const deepseek = {
	id: "deepseek",
	displayName: "DeepSeek",
	modes: ["api"],
	credentialRefs: () => ["DEEPSEEK_API_KEY"],
	defaultBaseUrl: () => DEFAULT_BASE_URL$1,
	request(input) {
		return {
			url: `${normalizeBaseUrl(input.baseUrl) ?? DEFAULT_BASE_URL$1}${BALANCE_PATH}`,
			headers: {
				authorization: `Bearer ${input.apiKey}`,
				accept: "application/json"
			}
		};
	},
	parse(payload, _mode) {
		const root = payload !== null && typeof payload === "object" ? payload : void 0;
		const picked = root === void 0 ? void 0 : pickBalanceInfo(root.balance_infos);
		if (picked === void 0) throw new SourceError("parse", "DeepSeek balance response contains no usable balance_infos");
		return {
			balances: [{
				amount: picked.amount,
				currency: picked.currency
			}],
			windows: []
		};
	}
};
//#endregion
//#region src/host/sources/kimi.ts
const MOONSHOT_BASE_URL = "https://api.moonshot.cn";
const KIMI_CODE_BASE_URL = "https://api.kimi.com";
/** The Kimi Code quota endpoint rejects requests without the CLI user agent. */
const KIMI_CLI_USER_AGENT = "KimiCLI/1.6";
const WINDOW_RANK$2 = {
	"5h": 0,
	"1d": 1,
	"7d": 2
};
function asRecord$3(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? value : void 0;
}
function firstFinite(candidates) {
	for (const candidate of candidates) {
		const parsed = toFiniteNumber(candidate);
		if (parsed !== void 0) return parsed;
	}
}
/**
* Moonshot's balance is documented in cents by some sources and in yuan by others,
* and there is no field that disambiguates the two. This mirrors the heuristic used
* by the plugin this project replaces: amounts of 100 or more are read as cents.
* Verified against a real key before trusting the absolute value.
*/
function moonshotBalanceToYuan(value) {
	const yuan = value >= 100 ? value / 100 : value;
	return Math.round(yuan * 100) / 100;
}
/** Used percentage from an explicit used/limit pair, or by inverting remaining. */
function percentFrom(record) {
	const limit = toFiniteNumber(record.limit);
	if (limit === void 0 || limit <= 0) return null;
	const used = toFiniteNumber(record.used);
	if (used !== void 0) return clampPercent(used / limit * 100);
	const remaining = toFiniteNumber(record.remaining);
	if (remaining !== void 0) return clampPercent((limit - remaining) / limit * 100);
	return null;
}
/** `{ duration: 5, timeUnit: 'hour' }` -> `5h`, and weekly variants -> `7d`. */
function windowIdFrom(window) {
	if (window === void 0) return void 0;
	const unit = typeof window.timeUnit === "string" ? window.timeUnit.trim().toLowerCase() : "";
	const duration = toFiniteNumber(window.duration);
	if (unit === "" || duration === void 0 || duration <= 0) return void 0;
	if (unit.startsWith("hour")) return `${duration}h`;
	if (unit.startsWith("day")) return duration === 7 ? "7d" : `${duration}d`;
	if (unit.startsWith("week")) return duration === 1 ? "7d" : `${duration * 7}d`;
	if (unit.startsWith("minute")) return `${duration}m`;
	if (unit.startsWith("month")) return "30d";
	return `${duration}${unit.slice(0, 4)}`;
}
function sortWindows$2(windows) {
	return [...windows].sort((a, b) => (WINDOW_RANK$2[a.id] ?? 99) - (WINDOW_RANK$2[b.id] ?? 99));
}
/** `GET /v1/users/me/balance` — pay-as-you-go wallet, CNY. */
function parseMoonshotBalance(payload) {
	const root = asRecord$3(payload);
	const nested = root === void 0 ? void 0 : asRecord$3(root.data);
	const value = firstFinite([
		root?.available_balance,
		root?.balance,
		root?.cash_balance,
		nested?.available_balance,
		nested?.balance
	]);
	if (value === void 0 || value < 0) throw new SourceError("parse", "Moonshot balance response contains no usable balance field");
	return {
		balances: [{
			amount: moonshotBalanceToYuan(value),
			currency: "CNY"
		}],
		windows: []
	};
}
/**
* `GET /coding/v1/usages` — Kimi Code subscription. The top-level `usage` is the
* weekly quota; `limits[]` carries the rolling windows (5h among them). Neither is
* officially documented, so every field is optional here.
*/
function parseKimiCodeUsage(payload) {
	const root = asRecord$3(payload);
	if (root === void 0) throw new SourceError("parse", "Kimi Code usage response is not a JSON object");
	const found = /* @__PURE__ */ new Map();
	const usage = asRecord$3(root.usage);
	if (usage !== void 0) {
		const usedPercent = percentFrom(usage);
		if (usedPercent !== null) {
			const resetsAt = normalizeResetAt(usage.resetTime ?? usage.reset_at ?? usage.resetsAt);
			found.set("7d", resetsAt === void 0 ? {
				id: "7d",
				usedPercent
			} : {
				id: "7d",
				usedPercent,
				resetsAt
			});
		}
	}
	const limits = Array.isArray(root.limits) ? root.limits : [];
	for (const raw of limits) {
		const row = asRecord$3(raw);
		const detail = row === void 0 ? void 0 : asRecord$3(row.detail);
		if (detail === void 0) continue;
		const usedPercent = percentFrom(detail);
		if (usedPercent === null) continue;
		const id = windowIdFrom(asRecord$3(row?.window));
		if (id === void 0 || found.has(id)) continue;
		const resetsAt = normalizeResetAt(detail.resetTime ?? detail.reset_at ?? detail.resetsAt);
		found.set(id, resetsAt === void 0 ? {
			id,
			usedPercent
		} : {
			id,
			usedPercent,
			resetsAt
		});
	}
	if (found.size === 0) throw new SourceError("parse", "Kimi Code usage response contains no usable quota window");
	return {
		balances: [],
		windows: sortWindows$2(found.values())
	};
}
/**
* Kimi / Moonshot. One vendor, two very different readings: the pay-as-you-go
* wallet in API mode (`api.moonshot.cn`) and the Kimi Code subscription windows in
* coding-plan mode (`api.kimi.com`).
*/
const kimi = {
	id: "kimi",
	displayName: "Kimi / Moonshot",
	modes: ["api", "coding-plan"],
	credentialRefs(mode) {
		return mode === "coding-plan" ? [
			"KIMI_CODING_API_KEY",
			"KIMI_API_KEY",
			"MOONSHOT_API_KEY"
		] : ["MOONSHOT_API_KEY", "KIMI_API_KEY"];
	},
	defaultBaseUrl(mode) {
		return mode === "coding-plan" ? KIMI_CODE_BASE_URL : MOONSHOT_BASE_URL;
	},
	request(input) {
		const codingPlan = input.mode === "coding-plan";
		const base = normalizeBaseUrl(input.baseUrl) ?? (codingPlan ? KIMI_CODE_BASE_URL : MOONSHOT_BASE_URL);
		return {
			url: codingPlan ? `${base}/coding/v1/usages` : `${base}/v1/users/me/balance`,
			headers: {
				authorization: `Bearer ${input.apiKey}`,
				accept: "application/json",
				...codingPlan ? { "user-agent": KIMI_CLI_USER_AGENT } : {}
			}
		};
	},
	parse(payload, mode) {
		return mode === "coding-plan" ? parseKimiCodeUsage(payload) : parseMoonshotBalance(payload);
	}
};
//#endregion
//#region src/host/sources/sub2api.ts
const USAGE_PATH = "/v1/usage";
const DEFAULT_CURRENCY = "USD";
const WINDOW_RANK$1 = {
	"5h": 0,
	"1d": 1,
	"7d": 2,
	"30d": 3
};
/** Subscription window name -> our canonical id. */
const SUBSCRIPTION_WINDOWS = [
	{
		prefix: "daily",
		id: "1d"
	},
	{
		prefix: "weekly",
		id: "7d"
	},
	{
		prefix: "monthly",
		id: "30d"
	}
];
function asRecord$2(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? value : void 0;
}
function currencyOf(value) {
	if (typeof value !== "string") return DEFAULT_CURRENCY;
	const trimmed = value.trim().toUpperCase();
	return trimmed === "" ? DEFAULT_CURRENCY : trimmed;
}
/** `window: "5h" | "1d" | "7d"` as sent by Sub2API; unknown names are kept as-is. */
function rateWindowId(raw) {
	if (typeof raw !== "string") return void 0;
	const key = raw.trim().toLowerCase();
	if (key === "") return void 0;
	if (key === "5h") return "5h";
	if (key === "1d" || key === "24h") return "1d";
	if (key === "7d" || key === "168h") return "7d";
	if (key === "30d" || key === "1mo") return "30d";
	return /^[a-z0-9.]+$/.test(key) ? key : void 0;
}
function sortWindows$1(windows) {
	return [...windows].sort((a, b) => (WINDOW_RANK$1[a.id] ?? 99) - (WINDOW_RANK$1[b.id] ?? 99));
}
function percentFromPair(used, limit) {
	const cap = toFiniteNumber(limit);
	const spent = toFiniteNumber(used);
	if (cap === void 0 || cap <= 0 || spent === void 0) return null;
	return clampPercent(spent / cap * 100);
}
/**
* Sub2API is a self-hosted gateway that redistributes subscription quota as its own
* `sk-` keys. `GET /v1/usage` is the only endpoint an API key can read, it is
* undocumented and its field names have drifted between frontend and backend, so
* every field here is optional and unknown shapes degrade instead of throwing.
*/
const sub2api = {
	id: "sub2api",
	displayName: "Sub2API",
	modes: ["api", "coding-plan"],
	requiresBaseUrl: true,
	credentialRefs: () => ["SUB2API_API_KEY"],
	/** Self-hosted: there is no sensible default endpoint. */
	defaultBaseUrl: () => void 0,
	request(input) {
		const base = normalizeBaseUrl(input.baseUrl);
		if (base === void 0) throw new SourceError("config", "Sub2API requires the base URL of your own instance");
		return {
			url: `${base}${USAGE_PATH}`,
			headers: {
				authorization: `Bearer ${input.apiKey}`,
				accept: "application/json"
			}
		};
	},
	parse(payload, _mode) {
		const root = asRecord$2(payload);
		if (root === void 0) throw new SourceError("parse", "Sub2API usage response is not a JSON object");
		const balances = [];
		const windows = /* @__PURE__ */ new Map();
		const quota = asRecord$2(root.quota);
		const quotaRemaining = quota === void 0 ? void 0 : toFiniteNumber(quota.remaining);
		const quotaLimit = quota === void 0 ? void 0 : toFiniteNumber(quota.limit);
		if (quotaRemaining !== void 0 && quotaRemaining >= 0 && quotaLimit !== void 0 && quotaLimit > 0) balances.push({
			amount: quotaRemaining,
			currency: currencyOf(quota?.unit ?? root.unit)
		});
		else {
			const wallet = toFiniteNumber(root.balance);
			if (wallet !== void 0 && wallet >= 0) balances.push({
				amount: wallet,
				currency: currencyOf(root.unit)
			});
		}
		const rateLimits = Array.isArray(root.rate_limits) ? root.rate_limits : [];
		for (const raw of rateLimits) {
			const entry = asRecord$2(raw);
			if (entry === void 0) continue;
			const id = rateWindowId(entry.window);
			if (id === void 0 || windows.has(id)) continue;
			const usedPercent = percentFromPair(entry.used, entry.limit);
			if (usedPercent === null) continue;
			const resetsAt = normalizeResetAt(entry.reset_at ?? entry.resetAt);
			windows.set(id, resetsAt === void 0 ? {
				id,
				usedPercent
			} : {
				id,
				usedPercent,
				resetsAt
			});
		}
		const subscription = asRecord$2(root.subscription);
		if (subscription !== void 0) for (const { prefix, id } of SUBSCRIPTION_WINDOWS) {
			if (windows.has(id)) continue;
			const usedPercent = percentFromPair(subscription[`${prefix}_usage_usd`], subscription[`${prefix}_limit_usd`]);
			if (usedPercent === null) continue;
			windows.set(id, {
				id,
				usedPercent
			});
		}
		const sorted = sortWindows$1(windows.values());
		if (balances.length === 0 && sorted.length === 0) throw new SourceError("parse", "Sub2API usage response carries neither balance nor quota window");
		return {
			balances,
			windows: sorted
		};
	}
};
//#endregion
//#region src/host/sources/zai.ts
const DEFAULT_BASE_URL = "https://api.z.ai";
const QUOTA_PATH = "/api/monitor/usage/quota/limit";
/** Display order for the windows we know; anything else keeps its insertion order after these. */
const WINDOW_RANK = {
	"5h": 0,
	"1d": 1,
	"7d": 2
};
/** Provider window names -> our canonical ids. Unknown names are kept verbatim. */
function canonicalWindowId(raw) {
	const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
	if (/^(five_?hour|fivehour|rolling|5h)$/.test(key)) return "5h";
	if (/^(weekly|week|seven_?day|sevenday|7d)$/.test(key)) return "7d";
	if (/^(daily|day|1d)$/.test(key)) return "1d";
	if (/^month(ly)?$/.test(key)) return "30d";
	return key;
}
function asRecord$1(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? value : void 0;
}
/** Percentage of one `limits[]` entry: explicit `percentage` first, else currentValue/usage. */
function percentOfLimit(limit) {
	const explicit = toFiniteNumber(limit.percentage);
	if (explicit !== void 0) return clampPercent(explicit);
	const usage = toFiniteNumber(limit.usage);
	const current = toFiniteNumber(limit.currentValue);
	if (usage !== void 0 && usage > 0 && current !== void 0) return clampPercent(current / usage * 100);
	return null;
}
/** The 2026-08 monitor endpoint: `data.limits[]`, mapped by unit (3 = hours, 6 = weeks). */
function parseLimits(data) {
	const body = asRecord$1(data.data);
	const limits = body === void 0 ? void 0 : body.limits;
	if (!Array.isArray(limits)) return void 0;
	const found = /* @__PURE__ */ new Map();
	const unassigned = [];
	for (const raw of limits) {
		const limit = asRecord$1(raw);
		if (limit === void 0) continue;
		if (limit.type !== "TOKENS_LIMIT" && limit.type !== "CREDIT_LIMIT") continue;
		const usedPercent = percentOfLimit(limit);
		if (usedPercent === null) continue;
		const resetsAt = normalizeResetAt(limit.nextResetTime);
		const window = resetsAt === void 0 ? {
			id: "",
			usedPercent
		} : {
			id: "",
			usedPercent,
			resetsAt
		};
		const unit = toFiniteNumber(limit.unit);
		if (unit === 3) {
			if (!found.has("5h")) found.set("5h", {
				...window,
				id: "5h"
			});
		} else if (unit === 6) {
			if (!found.has("7d")) found.set("7d", {
				...window,
				id: "7d"
			});
		} else if (unit === void 0) unassigned.push({
			usedPercent,
			...resetsAt === void 0 ? {} : { resetsAt },
			resetMs: resetsAt ?? 0
		});
	}
	unassigned.sort((a, b) => a.resetMs - b.resetMs);
	for (const item of unassigned) {
		const id = found.has("5h") ? found.has("7d") ? void 0 : "7d" : "5h";
		if (id === void 0) break;
		found.set(id, {
			id,
			usedPercent: item.usedPercent,
			...item.resetsAt === void 0 ? {} : { resetsAt: item.resetsAt }
		});
	}
	return found.size > 0 ? sortWindows(found.values()) : void 0;
}
/** The legacy billing endpoint: `plans[]`, where the reset span decides 5h vs weekly. */
function parsePlans(data) {
	if (!Array.isArray(data.plans)) return void 0;
	const found = /* @__PURE__ */ new Map();
	for (const raw of data.plans) {
		const plan = asRecord$1(raw);
		if (plan === void 0) continue;
		const total = toFiniteNumber(plan.total_units);
		const used = toFiniteNumber(plan.used_units);
		const usedPercent = total !== void 0 && total > 0 && used !== void 0 ? clampPercent(used / total * 100) : normalizePercent(plan.utilization ?? plan.percent ?? plan.used_percentage);
		if (usedPercent === null) continue;
		const resetsAt = normalizeResetAt(plan.period_end);
		const spanMs = resetsAt === void 0 ? NaN : resetsAt - Date.now();
		const id = Number.isFinite(spanMs) && spanMs > 864e5 ? "7d" : "5h";
		found.set(id, resetsAt === void 0 ? {
			id,
			usedPercent
		} : {
			id,
			usedPercent,
			resetsAt
		});
	}
	return found.size > 0 ? sortWindows(found.values()) : void 0;
}
/** A flat `{ five_hour: { utilization, resets_at }, ... }` object (Anthropic-like). */
function parseFlatWindows(data) {
	const found = /* @__PURE__ */ new Map();
	for (const [name, raw] of Object.entries(data)) {
		if (name === "plans" || name === "data") continue;
		const entry = asRecord$1(raw);
		if (entry === void 0) continue;
		const usedPercent = normalizePercent(entry.utilization ?? entry.percent ?? entry.used_percentage);
		if (usedPercent === null) continue;
		const id = canonicalWindowId(name);
		if (found.has(id)) continue;
		const resetsAt = normalizeResetAt(entry.resets_at ?? entry.reset_at ?? entry.resetsAt);
		found.set(id, resetsAt === void 0 ? {
			id,
			usedPercent
		} : {
			id,
			usedPercent,
			resetsAt
		});
	}
	return found.size > 0 ? sortWindows(found.values()) : void 0;
}
function sortWindows(windows) {
	return [...windows].sort((a, b) => (WINDOW_RANK[a.id] ?? 99) - (WINDOW_RANK[b.id] ?? 99));
}
//#endregion
//#region src/host/sources/index.ts
/** Every data source shipped in v1, in the order the settings page lists them. */
const ALL_SOURCES = [
	deepseek,
	{
		id: "zai",
		displayName: "z.ai / GLM",
		modes: ["coding-plan"],
		credentialRefs: () => [
			"ZAI_API_KEY",
			"GLM_API_KEY",
			"ZHIPU_API_KEY"
		],
		defaultBaseUrl: () => DEFAULT_BASE_URL,
		request(input) {
			return {
				url: `${normalizeBaseUrl(input.baseUrl) ?? DEFAULT_BASE_URL}${QUOTA_PATH}`,
				headers: {
					authorization: `Bearer ${input.apiKey}`,
					accept: "application/json"
				}
			};
		},
		parse(payload, _mode) {
			const root = asRecord$1(payload);
			if (root === void 0) throw new SourceError("parse", "z.ai quota response is not a JSON object");
			const windows = parseLimits(root) ?? parsePlans(root) ?? parseFlatWindows(root);
			if (windows === void 0 || windows.length === 0) throw new SourceError("parse", "z.ai quota response contains no usable 5h/7d window");
			return {
				balances: [],
				windows
			};
		}
	},
	kimi,
	sub2api
];
function findSource(id) {
	return ALL_SOURCES.find((source) => source.id === id);
}
//#endregion
//#region src/host/catalog.ts
/** Flatten the adapters into plain JSON, because this crosses the RPC boundary. */
function toSourceCatalog(sources = ALL_SOURCES) {
	return sources.map((source) => {
		const defaultBaseUrl = {};
		const credentialRefs = {};
		for (const mode of source.modes) {
			const base = source.defaultBaseUrl(mode);
			if (base !== void 0) defaultBaseUrl[mode] = base;
			credentialRefs[mode] = [...source.credentialRefs(mode)];
		}
		return {
			id: source.id,
			displayName: source.displayName,
			modes: [...source.modes],
			requiresBaseUrl: source.requiresBaseUrl === true,
			defaultBaseUrl,
			credentialRefs
		};
	});
}
//#endregion
//#region src/host/credentials.ts
function clean(ref) {
	if (ref === void 0) return void 0;
	const trimmed = ref.trim();
	return trimmed === "" ? void 0 : trimmed;
}
/**
* The refs to probe for one source+mode, most specific first: the user's explicit
* override, then refs derived from the provider's own configuration, then the
* source's built-in candidates.
*/
function orderedCredentialRefs(source, mode, options = {}) {
	const ordered = [];
	for (const candidate of [
		clean(options.overrideRef),
		...options.preferredRefs ?? [],
		...source.credentialRefs(mode)
	]) {
		const ref = clean(candidate);
		if (ref === void 0 || ordered.includes(ref)) continue;
		ordered.push(ref);
	}
	return ordered;
}
/** The first candidate that resolves to a non-blank secret wins. */
async function resolveApiKey(source, mode, options, lookup) {
	for (const ref of orderedCredentialRefs(source, mode, options)) {
		const resolved = await lookup.resolve(ref);
		if (resolved === void 0 || resolved.value.trim() === "") continue;
		return {
			apiKey: resolved.value,
			ref,
			origin: resolved.source
		};
	}
}
/**
* Status of every candidate, for the settings page. Never returns a secret: only
* whether a ref is configured and which layer provides it.
*/
async function describeCredentials(source, mode, options, lookup) {
	const candidates = [];
	let resolvedRef;
	let resolvedSource;
	let resolvedWritable;
	for (const ref of orderedCredentialRefs(source, mode, options)) {
		const described = await lookup.describe(ref);
		const candidate = {
			ref,
			configured: described.configured,
			writable: described.writable
		};
		if (described.source !== void 0) candidate.source = described.source;
		candidates.push(candidate);
		if (described.configured && resolvedRef === void 0) {
			resolvedRef = ref;
			resolvedSource = described.source;
			resolvedWritable = described.writable;
		}
	}
	return {
		candidates,
		configured: resolvedRef !== void 0,
		ref: resolvedRef,
		source: resolvedSource,
		writable: resolvedWritable
	};
}
//#endregion
//#region src/host/provider-refs.ts
function asRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? value : void 0;
}
/**
* The `apiKeyEnv` values the user already declared for the providers that feed a
* data source. These are probed before the source's built-in ref names, so a
* provider configured with a custom environment variable works without any
* extra configuration in this plugin.
*/
function providerCredentialRefs(input) {
	const suggest = input.suggest ?? suggestSourceId;
	const refs = [];
	const push = (value) => {
		if (typeof value !== "string") return;
		const ref = value.trim();
		if (ref === "" || refs.includes(ref)) return;
		refs.push(ref);
	};
	if (input.sourceId === "deepseek") push(asRecord(input.deepseekSettings)?.apiKeyEnv);
	const providers = asRecord(asRecord(input.piAiSettings)?.providers);
	if (providers === void 0) return refs;
	for (const [providerId, raw] of Object.entries(providers)) {
		const profile = asRecord(raw);
		if (profile === void 0) continue;
		if (suggest(providerId, typeof profile.baseURL === "string" ? profile.baseURL : void 0) !== input.sourceId) continue;
		push(profile.apiKeyEnv);
	}
	return refs;
}
/**
* A rejected key and a broken endpoint need different copy in the UI, so HTTP
* statuses are classified rather than collapsed into one "failed" bucket.
*/
function failureKindForStatus(status) {
	if (status === 401 || status === 403) return "auth";
	return "http";
}
function messageOf(error) {
	if (error instanceof Error) return error.message;
	return String(error);
}
/**
* The whole network path for one reading: ask the adapter for a request, send it,
* decode JSON, hand the payload back to the adapter's pure parser, and translate
* every failure into a `SourceError` the UI knows how to phrase.
*/
async function readUsage(input, deps) {
	const request = input.source.request({
		mode: input.mode,
		apiKey: input.apiKey,
		baseUrl: input.baseUrl
	});
	const timeoutMs = deps.timeoutMs ?? 15e3;
	const signal = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : void 0;
	let response;
	try {
		response = await deps.fetch(request.url, signal === void 0 ? { headers: request.headers } : {
			headers: request.headers,
			signal
		});
	} catch (error) {
		throw new SourceError("network", messageOf(error));
	}
	if (!response.ok) throw new SourceError(failureKindForStatus(response.status), `HTTP ${response.status}`);
	let payload;
	try {
		payload = await response.json();
	} catch (error) {
		throw new SourceError("parse", `invalid JSON: ${messageOf(error)}`);
	}
	return input.source.parse(payload, input.mode);
}
/** Adapt `readUsage` to the shape `UsageStateStore` expects. */
function createTargetReader(deps) {
	return (target, credentials, source) => readUsage({
		source,
		mode: target.mode,
		apiKey: credentials.apiKey,
		...credentials.baseUrl === void 0 ? {} : { baseUrl: credentials.baseUrl }
	}, deps);
}
//#endregion
//#region src/host/refresh.ts
function toSnapshotError(error) {
	if (error instanceof SourceError) return error.message === "" ? { kind: error.kind } : {
		kind: error.kind,
		detail: error.message
	};
	if (error instanceof Error) return error.message === "" ? { kind: "unknown" } : {
		kind: "unknown",
		detail: error.message
	};
	return { kind: "unknown" };
}
/**
* Holds the last known reading of every configured source and decides when to
* refresh it.
*
* The rules that matter for a plugin polling somebody else's billing endpoint:
* a reading that succeeded is reused until the minimum interval has passed; a
* failed attempt is never throttled (a retry may follow immediately); concurrent
* callers share one in-flight request; and a failure never replaces a good
* reading — it only marks it stale, so the status line can never show invented
* numbers.
*/
var UsageStateStore = class {
	deps;
	readings = /* @__PURE__ */ new Map();
	succeededAt = /* @__PURE__ */ new Map();
	inflight = /* @__PURE__ */ new Map();
	turnEndCancel;
	idleCancel;
	constructor(deps) {
		this.deps = deps;
	}
	/** Everything known so far, keyed by target key. */
	snapshots() {
		const result = {};
		for (const [key, snapshot] of this.readings) result[key] = snapshot;
		return result;
	}
	snapshot(key) {
		return this.readings.get(key);
	}
	/** Refresh every configured target; failures are captured, never thrown. */
	async refreshAll() {
		await Promise.all(this.deps.targets().map((target) => this.refresh(target.key)));
	}
	/**
	* Refresh one target. Returns the cached snapshot when the minimum interval has
	* not elapsed yet, unless `force` is set.
	*/
	async refresh(key, options = {}) {
		const target = this.deps.targets().find((candidate) => candidate.key === key);
		if (target === void 0) return this.fail({
			key,
			sourceId: key.split(":")[0] ?? "",
			mode: "api"
		}, {
			kind: "config",
			detail: `unknown target ${key}`
		}, this.readings.get(key));
		const cached = this.readings.get(key);
		const lastSuccess = this.succeededAt.get(key);
		if (options.force !== true && cached !== void 0 && cached.error === void 0 && lastSuccess !== void 0 && this.deps.clock.now() - lastSuccess < this.deps.policy().minIntervalSeconds * 1e3) return cached;
		const running = this.inflight.get(key);
		if (running !== void 0) return running;
		const promise = this.run(target).finally(() => {
			this.inflight.delete(key);
		});
		this.inflight.set(key, promise);
		return promise;
	}
	async run(target) {
		const previous = this.readings.get(target.key);
		const source = this.deps.findSource(target.sourceId);
		if (source === void 0) return this.fail(target, {
			kind: "config",
			detail: `unknown source ${target.sourceId}`
		}, previous);
		let credential;
		try {
			credential = await this.deps.credentials.resolve(target);
		} catch (error) {
			return this.fail(target, toSnapshotError(error), previous);
		}
		if (credential === void 0) return this.fail(target, {
			kind: "config",
			detail: "no credential configured"
		}, previous);
		try {
			const reading = await this.deps.read(target, credential, source);
			const fetchedAt = this.deps.clock.now();
			const snapshot = {
				sourceId: target.sourceId,
				mode: target.mode,
				balances: reading.balances,
				windows: reading.windows,
				fetchedAt
			};
			this.readings.set(target.key, snapshot);
			this.succeededAt.set(target.key, fetchedAt);
			return snapshot;
		} catch (error) {
			return this.fail(target, toSnapshotError(error), previous);
		}
	}
	fail(target, error, previous) {
		const snapshot = previous === void 0 ? {
			sourceId: target.sourceId,
			mode: target.mode,
			balances: [],
			windows: [],
			fetchedAt: this.deps.clock.now(),
			error
		} : {
			...previous,
			stale: true,
			error
		};
		this.readings.set(target.key, snapshot);
		return snapshot;
	}
	/**
	* A turn just finished: refresh shortly, so the provider has time to settle the
	* request we just paid for. Repeated calls within the window collapse into one.
	*/
	onTurnEnd() {
		if (this.turnEndCancel !== void 0) return;
		const cancel = this.deps.clock.after(this.deps.policy().turnEndDelayMs, () => {
			this.turnEndCancel = void 0;
			this.refreshAll();
		});
		this.turnEndCancel = cancel;
	}
	/** Start the idle fallback timer; returns a stop function. */
	start() {
		if (this.idleCancel === void 0) {
			const intervalMs = this.deps.policy().intervalMinutes * 6e4;
			this.idleCancel = this.deps.clock.every(intervalMs, () => {
				this.refreshAll();
			});
		}
		return () => this.stop();
	}
	stop() {
		this.turnEndCancel?.();
		this.turnEndCancel = void 0;
		this.idleCancel?.();
		this.idleCancel = void 0;
	}
};
//#endregion
//#region src/host/service.ts
/** Cordis service key the RPC gateway resolves. */
const USAGE_STATE_SERVICE = "usageState";
/** RPC namespace; the wire endpoint is `<namespace>/<method>`. */
const USAGE_STATE_RPC_NAMESPACE = "usageState";
/**
* The browser-facing face of the plugin. Tiny on purpose: one poll method and one
* credential-status method. Configuration is *not* here — the settings namespace
* already carries it to the browser over the platform's own transport.
*/
var UsageStateService = class {
	deps;
	constructor(deps) {
		this.deps = deps;
	}
	/**
	* Refresh what is due and report every reading. Forcing bypasses the minimum
	* interval, so it is reserved for the explicit "refresh now" affordance.
	*
	* Settled rather than all: one unreachable provider must not blank the whole
	* status line for the others.
	*/
	async getState(force) {
		const options = force === true ? { force: true } : {};
		await Promise.allSettled(this.deps.targets().map((target) => this.deps.store.refresh(target.key, options)));
		return {
			sources: this.deps.catalog(),
			snapshots: this.deps.store.snapshots(),
			checkedAt: this.deps.now()
		};
	}
	/** Credential status per target key, never a secret value. */
	async describeCredentials() {
		const credentials = {};
		for (const target of this.deps.targets()) credentials[target.key] = await this.deps.describe(target);
		return { credentials };
	}
};
//#endregion
//#region src/host/settings.ts
/** Settings namespace owned by this plugin; must match `/^[a-z][a-z0-9-]*$/`. */
const USAGE_STATE_NS = "usage-state";
const usageStateSchema = Object.assign((section) => normalizeConfig(section), { toJSON: () => ({
	uid: 1,
	refs: { 1: {
		type: "object",
		meta: {},
		dict: {}
	} }
}) });
/**
* Register the namespace and keep a live in-process snapshot of it.
*
* `ctx.inject` is the graceful-degradation boundary: on a host without a settings
* provider the callback never runs and the plugin's own defaults stand. `applies`
* is metadata in this DSH version — what actually makes a change live is the
* `watch` subscription below.
*/
function installUsageStateSettings(ctx, onConfig) {
	ctx.inject(["settings"], (settingsCtx) => {
		const scope = settingsCtx.settings.register(USAGE_STATE_NS, usageStateSchema, { applies: "live" });
		onConfig(normalizeConfig(scope.get()));
		scope.watch((next) => onConfig(normalizeConfig(next)));
	});
}
//#endregion
//#region src/host/targets.ts
function targetKey(sourceId, mode) {
	return `${sourceId}:${mode}`;
}
/**
* The set of readings the plugin should keep fresh, in display order.
*
* Balance and quota are account-level, so several models sharing one source and
* mode collapse into a single target — the status line never shows the same
* account twice. Models that are hidden, unconfigured, point at an unknown source,
* or ask for a mode the source cannot serve are skipped silently.
*/
function resolveTargets(config, sources = ALL_SOURCES) {
	const targets = [];
	const seen = /* @__PURE__ */ new Set();
	for (const entry of config.models) {
		if (entry.mode === "hidden" || entry.sourceId === null) continue;
		const source = sources.find((candidate) => candidate.id === entry.sourceId);
		if (source === void 0 || !source.modes.includes(entry.mode)) continue;
		const key = targetKey(source.id, entry.mode);
		if (seen.has(key)) continue;
		seen.add(key);
		targets.push({
			key,
			sourceId: source.id,
			mode: entry.mode
		});
	}
	return targets;
}
//#endregion
//#region src/index.ts
const name = "usage-state";
/** `timer` is what provides `ctx.timeout` / `ctx.interval`. */
const inject = ["timer"];
function readNamespace(ctx, namespace) {
	const settings = ctx.get("settings");
	if (settings?.get === void 0) return void 0;
	try {
		return settings.get(namespace);
	} catch {
		return;
	}
}
/**
* Credential access through the host's credential provider. A provider that is
* absent or throws must degrade to "not configured" — never to a crash inside a
* refresh loop.
*/
function createCredentialLookup(ctx) {
	const provider = ctx.get("credentials");
	return {
		resolve: async (ref) => {
			if (provider === void 0) return void 0;
			try {
				return await provider.resolve(ref);
			} catch {
				return;
			}
		},
		describe: async (ref) => {
			if (provider === void 0) return {
				configured: false,
				writable: false
			};
			try {
				return await provider.describe(ref);
			} catch {
				return {
					configured: false,
					writable: false
				};
			}
		}
	};
}
/**
* Publish the service under the name the RPC gateway resolves.
*
* The binding shape is exact and unforgiving (`dsh-api-gateway`'s `readBinding`):
*   - `service` must be the service OBJECT itself, not its name;
*   - `serviceKey` must be the registered name;
*   - `namespace` must equal the RPC namespace.
* A mismatch fails every dispatch with `gateway/binding-invalid` — which looks
* like "the plugin silently returns nothing" from the browser. Non-enumerable so
* it stays out of any serialization of the service.
*/
function provideUsageState(ctx, service) {
	Object.defineProperty(service, "typertRemote", {
		configurable: false,
		enumerable: false,
		writable: false,
		value: {
			service,
			serviceKey: USAGE_STATE_SERVICE,
			namespace: USAGE_STATE_RPC_NAMESPACE
		}
	});
	ctx.provide(USAGE_STATE_SERVICE, service);
	return service;
}
function isTurnEnd(event) {
	return event !== null && typeof event === "object" && event.type === "turn/end";
}
/** Wire the whole host half; exported so tests can drive it with a fake context. */
function createUsageState(ctx, deps = {}) {
	const now = deps.now ?? (() => Date.now());
	const fetchImpl = deps.fetch ?? globalThis.fetch;
	const catalog = toSourceCatalog(ALL_SOURCES);
	const lookup = createCredentialLookup(ctx);
	let config = DEFAULT_CONFIG;
	installUsageStateSettings(ctx, (next) => {
		config = next;
	});
	const targets = () => resolveTargets(config, ALL_SOURCES);
	const optionsFor = (target) => {
		const overrideRef = config.sources[target.sourceId]?.apiKeyRef;
		return {
			...overrideRef === void 0 ? {} : { overrideRef },
			preferredRefs: providerCredentialRefs({
				sourceId: target.sourceId,
				deepseekSettings: readNamespace(ctx, "llm-deepseek"),
				piAiSettings: readNamespace(ctx, "llm-pi-ai")
			})
		};
	};
	const store = new UsageStateStore({
		clock: {
			now,
			after: (ms, fn) => ctx.timeout(fn, ms),
			every: (ms, fn) => ctx.interval(fn, ms)
		},
		policy: () => config.refresh,
		targets,
		findSource,
		credentials: { resolve: async (target) => {
			const source = findSource(target.sourceId);
			if (source === void 0) return void 0;
			const resolved = await resolveApiKey(source, target.mode, optionsFor(target), lookup);
			if (resolved === void 0) return void 0;
			const baseUrl = config.sources[target.sourceId]?.baseUrl;
			return baseUrl === void 0 ? resolved : {
				...resolved,
				baseUrl
			};
		} },
		read: createTargetReader({ fetch: fetchImpl })
	});
	const service = new UsageStateService({
		store,
		targets,
		catalog: () => catalog,
		describe: async (target) => {
			const source = findSource(target.sourceId);
			if (source === void 0) return {
				candidates: [],
				configured: false
			};
			return describeCredentials(source, target.mode, optionsFor(target), lookup);
		},
		now
	});
	ctx.on("session/event", (...args) => {
		if (isTurnEnd(args[1])) store.onTurnEnd();
	});
	store.start();
	return provideUsageState(ctx, service);
}
function apply(ctx) {
	createUsageState(ctx);
}
//#endregion
export { apply, createCredentialLookup, createUsageState, inject, name, provideUsageState };
