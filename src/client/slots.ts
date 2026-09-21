/**
 * Where the status line is mounted.
 *
 * There is exactly one mount point on purpose: the **composer dock**. A reading is
 * account-level, and a completed turn is the wrong axis for it — the same number
 * would be rendered under every past turn even though it describes the whole
 * account (including other sessions, subagents and clients) at the moment of the
 * refresh, not that turn. Repeating it under turns is at best redundant and at
 * worst read as per-turn spend, which this plugin deliberately does not report.
 *
 * This lives as data so the choice stays testable. `conversation.chat.turnTail`
 * is a **chain** slot (exactly one entry renders) and both the platform's
 * deliverables plugin and `dsh-better-sidebar` register there, so a line mounted
 * there silently disappeared on any turn that produced files;
 * `conversation.chat.assistant-actions` is a list slot, but it is rendered inside
 * the turn action strip, which the platform shows on the latest turn only and
 * behind `:hover` on older ones. Both are turn-scoped, so neither is used.
 */
export interface StatusLineSlot {
  /** Slot key to register into. */
  name: string
  /** Entry id inside that slot. */
  id: string
  /** Position among the slot's entries. */
  order: number
  /** Dictionary namespace, so the framework injects `t`. */
  locale: string
}

export const STATUS_LINE_SLOTS: readonly StatusLineSlot[] = [
  { name: 'conversation.composer.dock', id: 'usage-state', order: 1, locale: 'usage-state' },
]
