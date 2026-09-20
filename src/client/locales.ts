/**
 * Browser-side copy. Both built-in locales are required by the platform's typed
 * registration, and a missing key is a compile error because `en` is typed
 * against the Chinese dictionary's key union.
 *
 * Window ids (`window.5h`) are deliberately language-neutral.
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

export const LOCALE_NS = 'usage-state'

export const zh = {
  nav: '用量状态',
  title: '用量状态',
  intro: '为每个模型选择显示账户余额（API 模式）或套餐额度（Coding Plan 模式）。数据由宿主定时刷新，密钥存放在 DSH 凭据库中，本插件不保存明文。',
  refreshNow: '立即刷新',
  refreshing: '刷新中…',
  lastChecked: '更新于 {time}',
  neverChecked: '尚未获取',
  close: '关闭',
  unavailable: '当前连接不支持读写设置。',
  empty: '还没有发现任何模型。请先在 DSH 里配置模型供应商。',

  sectionModels: '模型',
  sectionModelsHint: '拖动排序不可用，请用上下按钮调整顺序；只展示已启用（API / Coding Plan）的模型。',
  sectionSources: '数据源',
  sectionDisplay: '显示',

  modeApi: 'API 余额',
  modeCodingPlan: 'Coding Plan',
  modeHidden: '隐藏',
  modeUnsupported: '该数据源不支持此模式',
  moveUp: '上移',
  moveDown: '下移',
  sourceLabel: '数据源',
  unconfiguredModel: '未配置',

  baseUrl: '接口地址',
  baseUrlPlaceholder: 'https://…',
  baseUrlRequired: '此数据源必须填写你自己实例的接口地址',
  apiKeyRef: '凭据名（可选）',
  apiKeyRefHint: '留空则自动探测；填写后优先使用该凭据名。',

  credential: '密钥',
  credentialConfigured: '已配置（来源：{source}）',
  credentialMissing: '未配置',
  credentialLocked: '由环境变量提供，无法在此修改',
  credentialPlaceholder: '粘贴密钥…',
  credentialSave: '保存',
  credentialClear: '清除',
  credentialSaved: '已保存',
  credentialFailed: '保存失败：{message}',
  credentialHint: '密钥写入 DSH 凭据库（~/.dsh/.credentials.yaml），不会存进本插件。',

  intervalMinutes: '空闲刷新间隔（分钟）',
  thresholdWarn: '黄色阈值（已用 %）',
  thresholdCritical: '红色阈值（已用 %）',
  progressBar: '显示进度条',
  refreshFailed: '刷新失败：{message}',

  'state.loading': '读取中…',
  'state.unconfigured': '未配置',
  'state.unsupported': '模式不支持',
  'state.error': '获取失败',
  'error.config': '缺少密钥或接口地址',
  'error.auth': '密钥无效',
  'error.http': '接口返回错误',
  'error.network': '网络不可达',
  'error.parse': '返回内容无法解析',
  'error.unknown': '未知错误',
  staleHint: '当前显示的是上一次成功获取的值',
  'window.5h': '5h',
  'window.1d': '1d',
  'window.7d': '7d',
  'window.30d': '30d',
} as const

export type UsageStateKey = keyof typeof zh

export const en: Record<UsageStateKey, string> = {
  nav: 'Usage state',
  title: 'Usage state',
  intro:
    'Choose what to show for each model: account balance (API mode) or coding-plan quota (Coding Plan mode). The host refreshes on a timer, and keys live in the DSH credential store — this plugin never keeps a plaintext copy.',
  refreshNow: 'Refresh now',
  refreshing: 'Refreshing…',
  lastChecked: 'Updated {time}',
  neverChecked: 'Not fetched yet',
  close: 'Close',
  unavailable: 'This connection does not serve settings.',
  empty: 'No models found yet. Configure an LLM provider in DSH first.',

  sectionModels: 'Models',
  sectionModelsHint:
    'Drag-to-reorder is not available, so use the up/down buttons. Only enabled models (API / Coding Plan) reach the status line.',
  sectionSources: 'Data sources',
  sectionDisplay: 'Display',

  modeApi: 'API balance',
  modeCodingPlan: 'Coding plan',
  modeHidden: 'Hidden',
  modeUnsupported: 'This data source does not serve that mode',
  moveUp: 'Move up',
  moveDown: 'Move down',
  sourceLabel: 'Source',
  unconfiguredModel: 'Not configured',

  baseUrl: 'Endpoint',
  baseUrlPlaceholder: 'https://…',
  baseUrlRequired: 'This data source needs the endpoint of your own instance',
  apiKeyRef: 'Credential name (optional)',
  apiKeyRefHint: 'Leave blank to auto-detect; when set, this ref is tried first.',

  credential: 'API key',
  credentialConfigured: 'Configured ({source})',
  credentialMissing: 'Not configured',
  credentialLocked: 'Provided by an environment variable; not editable here',
  credentialPlaceholder: 'Paste the key…',
  credentialSave: 'Save',
  credentialClear: 'Clear',
  credentialSaved: 'Saved',
  credentialFailed: 'Could not save: {message}',
  credentialHint: 'The key is written to the DSH credential store (~/.dsh/.credentials.yaml), not to this plugin.',

  intervalMinutes: 'Idle refresh interval (minutes)',
  thresholdWarn: 'Amber threshold (used %)',
  thresholdCritical: 'Red threshold (used %)',
  progressBar: 'Show progress bar',
  refreshFailed: 'Refresh failed: {message}',

  'state.loading': 'Reading…',
  'state.unconfigured': 'Not configured',
  'state.unsupported': 'Mode not supported',
  'state.error': 'Unavailable',
  'error.config': 'Missing key or endpoint',
  'error.auth': 'Key rejected',
  'error.http': 'The endpoint returned an error',
  'error.network': 'Network unreachable',
  'error.parse': 'The response could not be parsed',
  'error.unknown': 'Unknown error',
  staleHint: 'Showing the last value that was fetched successfully',
  'window.5h': '5h',
  'window.1d': '1d',
  'window.7d': '7d',
  'window.30d': '30d',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** usage-state settings and status-line copy. */
    'usage-state': UsageStateKey
  }
}
