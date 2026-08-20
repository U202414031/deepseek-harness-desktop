/**
 * Client-side binding to `ctx.workspaces`, stashed for the IDE panel so the
 * "start a new conversation in the opened file's directory" action works
 * without threading the Cordis context through React props.
 *
 * The service is resolved through `ctx.inject(['workspaces'], …)`: the
 * callback runs once the client runtime's workspaces service is available;
 * a profile without it degrades to a no-op (the button reports failure).
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

/** Minimal structural face of the client workspaces service. */
export interface WorkspacesLike {
  create(input: { path: string }): Promise<{ workspaceId: string }>
  startSession(workspaceId?: string): void
}

let workspaces: WorkspacesLike | null = null

/**
 * Resolve and retain the client workspaces service.
 * @param ctx - client root context (advanced shell).
 * @returns a disposer (wrap in `ctx.effect`).
 */
export function bindWorkspacesService(ctx: ClientContext): () => void {
  const inject = (ctx as { inject?: (deps: string[], cb: (child: ClientContext) => void) => unknown }).inject
  if (typeof inject !== 'function') return () => {}

  let fiber: { dispose?(): void } | undefined
  try {
    const result = inject(['workspaces'], (childCtx) => {
      // Cast through unknown: the client runtime declares `ctx.workspaces`
      // with the full IWorkspaces face; only the two methods we use are kept.
      const service = (childCtx as unknown as { workspaces?: WorkspacesLike }).workspaces
      if (service === undefined || typeof service.create !== 'function' || typeof service.startSession !== 'function') return
      workspaces = service
    })
    if (typeof result === 'object' && result !== null) fiber = result as { dispose?(): void }
  } catch {
    // No workspaces service — the IDE "new conversation" action stays off.
  }

  return () => {
    if (workspaces !== null) {
      const service = workspaces
      // Only clear the binding if it is still the one this fiber resolved.
      if (service === workspaces) workspaces = null
    }
    fiber?.dispose?.()
  }
}

/**
 * Register the directory as a workspace (create-or-reuse) and start a new
 * conversation in it.
 * @param dir - absolute directory (already validated by the Host route).
 * @returns whether the conversation started.
 */
export async function startSessionInFileDir(dir: string): Promise<boolean> {
  if (workspaces === null) return false
  try {
    const view = await workspaces.create({ path: dir })
    workspaces.startSession(view.workspaceId)
    return true
  } catch {
    return false
  }
}
