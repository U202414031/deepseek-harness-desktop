/**
 * Client half of the IDE-bridge bundle: the embedded-IDE / VS Code panel, the
 * chat-input trigger for the current editor selection (`@` candidate) and the
 * "start a conversation in the opened file's directory" workspace binding.
 */
import type {} from './contracts.ts'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { IdePanel } from './features/ide/IdePanel.tsx'
import { registerEditorTriggerSource } from './features/ide/editor-trigger.ts'
import { bindWorkspacesService } from './features/ide/editor-workspace.ts'

export const inject = ['slots', 'workspaces', 'sessions']

export function apply(ctx: ClientContext): void {
  // `slots.inject` defers until the shell declares the `ide` seat, so the
  // registration cannot race the shell's root-children declaration.
  ctx.effect(() => ctx.slots.inject('ide', () => ctx.slots.register({ name: 'ide' }, IdePanel)), 'dsh-desktop-ide-bridge: ide surface')
  // Chat-input trigger: lets the user reference the current IDE selection
  // (`@` candidate) and ask about it in the conversation input.
  ctx.effect(
    () => registerEditorTriggerSource(ctx),
    'dsh-desktop-ide-bridge: editor selection input trigger',
  )
  // Client workspaces binding for "start a new conversation in the opened
  // file's directory".
  ctx.effect(
    () => bindWorkspacesService(ctx),
    'dsh-desktop-ide-bridge: editor workspace binding',
  )
}
