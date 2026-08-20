/**
 * Client half of the whale-skin bundle: restores the saved skin, runs the
 * ambient particle layer, and registers the skins surface into the desktop
 * shell's `sidebar.skins` seat (declared by dsh-plugin-desktop).
 */
import type {} from './contracts.ts'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { SkinsPanel } from './features/skins/SkinsPanel.tsx'
import { applySkin, getSkin } from './features/skins/skin-service.ts'
import { startWhaleAmbient } from './features/skins/whale-ambient.ts'

export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  // Restore the user's previously selected skin.
  ctx.effect(() => {
    applySkin(getSkin())
    return () => {}
  }, 'dsh-desktop-whale-skins: skin restore')

  // Whale-girl ambient particle layer: active only for skins that declare an
  // `ambient` block; follows the cursor so particles converge where you point.
  ctx.effect(() => startWhaleAmbient(), 'dsh-desktop-whale-skins: whale ambient')

  // Skins surface contributed into the advanced root slot's sidebar seat.
  // `slots.inject` defers the registration until the shell declares the seat,
  // so this bundle's apply order relative to the shell cannot race the
  // declaration (a direct register would fail when it runs first).
  ctx.effect(() => ctx.slots.inject('sidebar.skins', () => ctx.slots.register({ name: 'sidebar.skins' }, SkinsPanel)), 'dsh-desktop-whale-skins: skins surface')
}
