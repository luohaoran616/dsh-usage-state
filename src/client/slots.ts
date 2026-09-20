/** Which visual variant of the status line a mount point renders. */
export type StatusLineVariant = 'dock' | 'actions'

/**
 * Where the status line is mounted.
 *
 * This lives as data so the choice is testable: `conversation.chat.turnTail` is a
 * **chain** slot (exactly one entry renders), and both the platform's deliverables
 * plugin and `dsh-better-sidebar` register there — our line silently disappeared on
 * any turn that produced files. `conversation.chat.assistant-actions` is a `list`
 * slot scoped to the closing assistant message of a completed turn, so nothing can
 * take the spot away from us.
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
  /** Component variant for this mount point. */
  variant: StatusLineVariant
}

export const STATUS_LINE_SLOTS: readonly StatusLineSlot[] = [
  { name: 'conversation.composer.dock', id: 'usage-state', order: 1, locale: 'usage-state', variant: 'dock' },
  {
    name: 'conversation.chat.assistant-actions',
    id: 'usage-state',
    order: 1,
    locale: 'usage-state',
    variant: 'actions',
  },
]
