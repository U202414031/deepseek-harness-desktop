/**
 * Client half of the external-robots bundle: sidebar surface managing external
 * robot channels (QQ / 飞书 / 微信 / LLM helpers). Registered into the desktop
 * shell's `sidebar.robots` seat (declared by dsh-plugin-desktop).
 */
import type {} from './contracts.ts'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { ToolsPanel } from './features/robots/ToolsPanel.tsx'

export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  // `slots.inject` defers until the shell declares `sidebar.robots`, so the
  // registration cannot race the shell's root-children declaration.
  ctx.effect(() => ctx.slots.inject('sidebar.robots', () => ctx.slots.register({ name: 'sidebar.robots' }, ToolsPanel)), 'dsh-desktop-external-robots: external robots surface')
}
