import test from 'node:test'
import assert from 'node:assert/strict'

import {
  clampPercent,
  normalizeBaseUrl,
  normalizePercent,
  normalizeResetAt,
  toFiniteNumber,
} from '../../src/host/sources/normalize.ts'

test('toFiniteNumber accepts numbers and numeric strings, rejects the rest', () => {
  assert.equal(toFiniteNumber(3.5), 3.5)
  assert.equal(toFiniteNumber('3.5'), 3.5)
  assert.equal(toFiniteNumber('-2'), -2)
  assert.equal(toFiniteNumber(''), undefined)
  assert.equal(toFiniteNumber('abc'), undefined)
  assert.equal(toFiniteNumber(null), undefined)
  assert.equal(toFiniteNumber(undefined), undefined)
  assert.equal(toFiniteNumber({}), undefined)
  assert.equal(toFiniteNumber(Number.NaN), undefined)
  assert.equal(toFiniteNumber(Number.POSITIVE_INFINITY), undefined)
})

test('clampPercent rounds to one decimal and clamps to 0..100', () => {
  assert.equal(clampPercent(42.04), 42)
  assert.equal(clampPercent(42.06), 42.1)
  assert.equal(clampPercent(-3), 0)
  assert.equal(clampPercent(123.45), 100)
})

test('normalizePercent treats 0..1 as a fraction and >=1 as a percentage', () => {
  assert.equal(normalizePercent(0.425), 42.5)
  assert.equal(normalizePercent(1), 100)
  assert.equal(normalizePercent(42.5), 42.5)
  assert.equal(normalizePercent('42.5'), 42.5)
  assert.equal(normalizePercent(-1), null)
  assert.equal(normalizePercent('nope'), null)
  assert.equal(normalizePercent(undefined), null)
})

test('normalizeResetAt understands unix seconds, unix milliseconds and ISO strings', () => {
  const iso = '2026-09-20T16:00:00.000Z'
  const ms = Date.parse(iso)

  assert.equal(normalizeResetAt(iso), ms)
  assert.equal(normalizeResetAt(ms), ms)
  assert.equal(normalizeResetAt(Math.floor(ms / 1000)), ms)
  assert.equal(normalizeResetAt(String(Math.floor(ms / 1000))), ms)
})

test('normalizeResetAt reports absence for missing or nonsense values', () => {
  assert.equal(normalizeResetAt(undefined), undefined)
  assert.equal(normalizeResetAt(null), undefined)
  assert.equal(normalizeResetAt(''), undefined)
  assert.equal(normalizeResetAt(0), undefined)
  assert.equal(normalizeResetAt(-5), undefined)
  assert.equal(normalizeResetAt('not a date'), undefined)
  assert.equal(normalizeResetAt(Number.NaN), undefined)
})

test('normalizeBaseUrl trims trailing slashes and an API version suffix', () => {
  assert.equal(normalizeBaseUrl('https://api.deepseek.com'), 'https://api.deepseek.com')
  assert.equal(normalizeBaseUrl('https://api.deepseek.com/'), 'https://api.deepseek.com')
  assert.equal(normalizeBaseUrl('https://api.deepseek.com/v1'), 'https://api.deepseek.com')
  assert.equal(normalizeBaseUrl('https://api.deepseek.com/v1/'), 'https://api.deepseek.com')
  assert.equal(normalizeBaseUrl('https://gw.example.com/sub/v1'), 'https://gw.example.com/sub')
  assert.equal(normalizeBaseUrl('  https://gw.example.com  '), 'https://gw.example.com')
  assert.equal(normalizeBaseUrl(''), undefined)
  assert.equal(normalizeBaseUrl(undefined), undefined)
})
