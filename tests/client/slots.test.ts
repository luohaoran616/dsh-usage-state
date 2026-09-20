import test from 'node:test'
import assert from 'node:assert/strict'

import { STATUS_LINE_SLOTS } from '../../src/client/slots.ts'

test('the status line mounts in exactly two places', () => {
  assert.equal(STATUS_LINE_SLOTS.length, 2)
  assert.deepEqual(
    STATUS_LINE_SLOTS.map(slot => slot.name).sort(),
    ['conversation.chat.assistant-actions', 'conversation.composer.dock'],
  )
})

test('each mount point uses its own component variant', () => {
  const byName = new Map(STATUS_LINE_SLOTS.map(slot => [slot.name, slot]))
  assert.equal(byName.get('conversation.composer.dock')?.variant, 'dock')
  assert.equal(byName.get('conversation.chat.assistant-actions')?.variant, 'actions')
})

test('the chain slot is not used at all', () => {
  // `conversation.chat.turnTail` is a chain slot: exactly one entry renders, and
  // the platform's own deliverables plugin plus better-sidebar register there, so
  // our line vanished on any turn that produced files. Mounting it again would
  // reintroduce that bug (and double-render on turns we win).
  assert.equal(
    STATUS_LINE_SLOTS.some(slot => slot.name === 'conversation.chat.turnTail'),
    false,
  )
})

test('every mount point carries a stable id and a locale namespace', () => {
  for (const slot of STATUS_LINE_SLOTS) {
    assert.equal(slot.id, 'usage-state')
    assert.equal(slot.locale, 'usage-state')
    assert.equal(typeof slot.order, 'number')
  }
})
