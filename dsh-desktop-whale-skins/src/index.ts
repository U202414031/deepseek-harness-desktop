/**
 * Host side of the whale-skin bundle: serves `/desktop/skins/*` asset routes
 * and the media import lifecycle. The client UI lives in `./client`.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { installSkinsRoutes } from './skins-host.ts'

export const name = 'desktop-skins'
export const inject = ['webServer']

export function apply(ctx: Context): void {
  ctx.effect(() => installSkinsRoutes(ctx), 'dsh-desktop-whale-skins: whale-skin asset routes')
}
