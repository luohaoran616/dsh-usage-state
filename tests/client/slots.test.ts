import test from 'node:test'
import assert from 'node:assert/strict'

import { STATUS_LINE_SLOTS } from '../../src/client/slots.ts'

test('the status line mounts in exactly one place: the composer dock', () => {
  assert.equal(STATUS_LINE_SLOTS.length, 1)
  assert.deepEqual(
    STATUS_LINE_SLOTS.map(slot => slot.name),
    ['conversation.composer.dock'],
  )
})

test('no turn-scoped slot is used', () => {
  // The reading is account-level: rendering it under every completed turn repeats
  // one number as if it described that turn, which is the per-turn spend story this
  // plugin deliberately does not tell. Both turn-scoped slots are also hostile to a
  // line we want constantly visible:
  // - `conversation.chat.turnTail` is a chain slot (one winner) claimed by the
  //   platform's deliverables plugin and better-sidebar, so the line vanished on any
  //   turn that produced files;
  // - `conversation.chat.assistant-actions` is rendered inside the platform's turn
  //   action strip, which is hover-only on every turn but the latest.
  const turnScoped = STATUS_LINE_SLOTS.filter(
    slot =>
      slot.name === 'conversation.chat.turnTail' || slot.name === 'conversation.chat.assistant-actions',
  )
  assert.deepEqual(turnScoped, [])
})

test('the mount point carries a stable id, order and locale namespace', () => {
  for (const slot of STATUS_LINE_SLOTS) {
    assert.equal(slot.id, 'usage-state')
    assert.equal(slot.locale, 'usage-state')
    assert.equal(typeof slot.order, 'number')
  }
})
