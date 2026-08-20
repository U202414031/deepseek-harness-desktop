/**
 * Module-level editor-selection snapshot shared between the IDE panel and the
 * input-trigger source. The panel publishes the current selection (file +
 * text + language + timestamp); the `@` trigger source turns it into a
 * reference the user can ask about in the chat input.
 */

export interface EditorSelectionSnapshot {
  /** Absolute path of the file the selection lives in. */
  file: string
  /** The selected source text. */
  text: string
  /** Editor language id derived from the file extension. */
  language: string
  /** Monotonic timestamp used as the reference identity. */
  updatedAt: number
}

/** Cap on the selection text carried into a chat reference (60 KiB). */
export const SELECTION_TEXT_LIMIT = 60_000

let current: EditorSelectionSnapshot | null = null

/** Publish the current editor selection, or clear it with null. */
export function setEditorSelection(snapshot: EditorSelectionSnapshot | null): void {
  current = snapshot
}

/** Read the current editor selection, or null when none is active. */
export function getEditorSelection(): EditorSelectionSnapshot | null {
  return current
}

/** Trim an over-long selection so the reference never bloats the message. */
export function trimSelectionText(text: string): string {
  if (text.length <= SELECTION_TEXT_LIMIT) return text
  return `${text.slice(0, SELECTION_TEXT_LIMIT)}\n\n…（内容过长已截断）`
}
