import { createElement as h } from 'react'

/**
 * Minimal stand-in for `@deepseek-ai/dsh-client-ui-primitives`.
 *
 * The published package cannot be imported in Node (it pulls CSS modules and
 * undeclared transitive dependencies), so render tests swap it for this stub via
 * `client-render-hook.mjs`. The prop names mirror the documented surface; the
 * point is to exercise THIS plugin's component logic, not the platform's atoms.
 */
export function Button({ variant = 'outline', size = 'md', icon, children, ...rest }) {
  return h('button', { 'data-variant': variant, 'data-size': size, ...rest }, icon ?? null, children)
}

export function Input({ icon, ...rest }) {
  return h('input', rest)
}

export function Switch({ checked = false, onChange, label, disabled, title }) {
  return h(
    'label',
    { title },
    h('input', {
      type: 'checkbox',
      checked,
      disabled,
      readOnly: true,
      onChange: event => onChange?.(event.target.checked),
    }),
    label,
  )
}

export function Tag({ tone = 'neutral', children }) {
  return h('span', { 'data-tone': tone }, children)
}

export function StateDot({ state }) {
  return h('span', { 'data-state': state })
}

export function Tooltip({ label, side, delayMs, disabled, maxWidth, children }) {
  return h('span', { 'data-tooltip': typeof label === 'function' ? label() : label, 'data-side': side ?? 'top' }, children)
}

export function IconDataOutline16(props) {
  return h('span', { 'data-icon': 'data', ...props })
}
