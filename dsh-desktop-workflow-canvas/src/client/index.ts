/**
 * Client half of the workflow-canvas bundle: visual workflow editor.
 * Registers the sidebar surface (`sidebar.workflow`) and the canvas view
 * (`workflow.canvas`) — both seats are declared by dsh-plugin-desktop's
 * advanced root slot.
 */
import type {} from './contracts.ts'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { WorkflowPanel } from './features/workflow/WorkflowPanel.tsx'
import { WorkflowCanvas } from './features/workflow/WorkflowCanvas.tsx'

export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  // `slots.inject` defers until the shell declares the seats, so the
  // registrations cannot race the shell's root-children declaration.
  ctx.effect(() => ctx.slots.inject('sidebar.workflow', () => ctx.slots.register({ name: 'sidebar.workflow' }, WorkflowPanel)), 'dsh-desktop-workflow-canvas: workflow surface')
  ctx.effect(() => ctx.slots.inject('workflow.canvas', () => ctx.slots.register({ name: 'workflow.canvas' }, WorkflowCanvas)), 'dsh-desktop-workflow-canvas: workflow canvas')
}
