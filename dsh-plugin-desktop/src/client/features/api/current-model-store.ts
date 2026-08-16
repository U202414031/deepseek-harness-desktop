import { useSyncExternalStore } from 'react'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { detectCurrentModel } from './provider-config.ts'
import { sumUsage, type UsageSummary } from '../usage/usage.ts'

const EMPTY_USAGE: UsageSummary = { promptTokens: 0, completionTokens: 0, totalTokens: 0, count: 0 }

/** Snapshot of the model currently in use, shared from a session-scoped observer. */
export interface CurrentModelState {
  /** Raw provider route id reported by the host (e.g. "deepseek-official"). */
  provider: string | undefined
  /** Raw model id reported by the host (e.g. "deepseek-chat"). */
  model: string | undefined
  /** Resolved provider spec id, or null when unknown / not yet detected. */
  specId: string | null
  /** Cumulative token usage for the detected provider in the active session. */
  usage: UsageSummary
}

let state: CurrentModelState = { provider: undefined, model: undefined, specId: null, usage: EMPTY_USAGE }
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

/** Push the detected model + usage from a session snapshot into the store. */
export function setCurrentModelFromSnapshot(snapshot: ConversationSnapshot | undefined): void {
  const { provider, model, spec } = detectCurrentModel(snapshot)
  const specId = spec?.id ?? null
  const usage = sumUsage(snapshot, spec)
  if (
    provider === state.provider &&
    model === state.model &&
    specId === state.specId &&
    usage.count === state.usage.count &&
    usage.totalTokens === state.usage.totalTokens
  ) {
    return
  }
  state = { provider, model, specId, usage }
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function getSnapshot(): CurrentModelState {
  return state
}

/** Subscribe a React component to the currently-detected model. */
export function useCurrentModel(): CurrentModelState {
  return useSyncExternalStore(subscribe, getSnapshot)
}
