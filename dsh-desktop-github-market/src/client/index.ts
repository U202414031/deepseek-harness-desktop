/**
 * Client half of the GitHub community-market bundle: registers the marketplace
 * surface into the desktop shell's `sidebar.marketplace` seat (declared by
 * dsh-plugin-desktop). Purely a renderer plugin — no host services.
 */
import type {} from './contracts.ts'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { MarketplacePanel } from './features/marketplace/MarketplacePanel.tsx'

export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  // `slots.inject` defers until the shell declares `sidebar.marketplace`, so the
  // registration cannot race the shell's root-children declaration.
  ctx.effect(() => ctx.slots.inject('sidebar.marketplace', () => ctx.slots.register({ name: 'sidebar.marketplace' }, MarketplacePanel)), 'dsh-desktop-github-market: marketplace surface')
}
