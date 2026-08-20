/**
 * Chat-input trigger source for the IDE selection. Registers an `@` source
 * named "编辑器选区": while the IDE panel has an active text selection, the
 * user can type `@` in the chat input, pick the candidate, and the selected
 * code becomes a reference in the message. On submit the reference serializes
 * to a fenced code block with the file path, so the agent explains or edits
 * exactly the chosen code.
 *
 * Registration rides `ctx.inject(['inputTriggers'], …)`: the callback runs
 * once the upstream slash pipeline's service is available and is skipped
 * entirely when the profile does not compose it — the panel itself never
 * depends on this feature, so a missing pipeline degrades to a no-op instead
 * of failing the desktop shell boot.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  InputTriggerSource,
  ReferenceInsert,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import {
  getEditorSelection,
  trimSelectionText,
} from './editor-selection.ts'

const SOURCE_NAME = '编辑器选区'

function buildSource(): InputTriggerSource {
  return {
    trigger: '@',
    name: SOURCE_NAME,
    order: 1,
    async candidates() {
      const selection = getEditorSelection()
      if (selection === null) return []
      const lines = selection.text.split('\n').length
      return [{
        name: SOURCE_NAME,
        description: `${selection.file}（${lines} 行）`,
        hint: '在对话中引用当前框选的代码',
      }]
    },
    onPick() {
      const selection = getEditorSelection()
      if (selection === null) return undefined
      const insert: ReferenceInsert = {
        // Must equal the registered source name: the submit path resolves the
        // serializer by `source.name === insert.source`.
        source: SOURCE_NAME,
        ref: `editor:${selection.file}:${selection.updatedAt}`,
        label: `选区·${selection.file.split(/[\\/]/).pop() ?? selection.file}`,
        clipboardText: '@编辑器选区',
      }
      return { insert }
    },
    codec: {
      clipboardText(ref: string): string {
        return `@编辑器选区（${ref}）`
      },
      async serialize(ref: string): Promise<string> {
        const selection = getEditorSelection()
        const text = selection === null
          ? '(选区已失效，请重新框选)'
          : trimSelectionText(selection.text)
        const lang = selection?.language ?? 'text'
        return [
          `【编辑器选区 · ${selection?.file ?? ref}】`,
          '',
          '```' + lang,
          text,
          '```',
          '',
        ].join('\n')
      },
    },
  }
}

/**
 * Register the editor-selection trigger source.
 * @param ctx - client root context (advanced shell).
 * @returns a disposer (wrap in `ctx.effect`).
 */
export function registerEditorTriggerSource(ctx: ClientContext): () => void {
  const inject = (ctx as { inject?: (deps: string[], cb: (child: ClientContext) => void) => unknown }).inject
  if (typeof inject !== 'function') return () => {}

  let disposer: (() => void) | undefined
  let fiber: { dispose?(): void } | undefined
  try {
    const result = inject(['inputTriggers'], (childCtx) => {
      const service = (childCtx as { inputTriggers?: { registerSource?(source: InputTriggerSource): () => void } }).inputTriggers
      if (service === undefined || typeof service.registerSource !== 'function') return
      disposer = service.registerSource(buildSource())
    })
    // `ctx.inject` returns the child fiber; capture it for teardown.
    if (typeof result === 'object' && result !== null) fiber = result as { dispose?(): void }
  } catch {
    // The slash pipeline is unavailable or the runtime rejected the inject
    // call — the IDE selection reference simply stays off.
  }

  return () => {
    disposer?.()
    fiber?.dispose?.()
  }
}
