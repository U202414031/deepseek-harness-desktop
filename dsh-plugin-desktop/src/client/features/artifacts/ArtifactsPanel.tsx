import { useMemo, useState } from 'react'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

interface CodeItem {
  language: string
  code: string
  source: string
}

interface ArtifactItem {
  tool: string
  isError: boolean
  text: string
  seq: number
}

interface Extracted {
  code: CodeItem[]
  artifacts: ArtifactItem[]
}

/**
 * Desktop-owned artifacts/code content. The surrounding panel chrome (title and
 * enlarge / collapse controls) is rendered by the advanced root frame so the
 * right column stays present and operable even when no session is active; this
 * component only renders the tab strip and the extracted code / product lists.
 */
export function ArtifactsPanel({ useSession }: PropsRuntime<'artifacts'>): JSX.Element {
  const snapshot = useSession((s) => s)
  const extracted = useMemo(() => extractArtifacts(snapshot), [snapshot])
  const [tab, setTab] = useState<'code' | 'artifacts'>('code')

  return (
    <div className="dshDesktopArtifacts">
      <div className="dshDesktopArtifactsTabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'code'}
          className="dshDesktopArtifactsTab"
          onClick={() => { setTab('code') }}
        >
          代码 ({extracted.code.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'artifacts'}
          className="dshDesktopArtifactsTab"
          onClick={() => { setTab('artifacts') }}
        >
          产物 ({extracted.artifacts.length})
        </button>
      </div>
      <div className="dshDesktopArtifactsBody">
        {tab === 'code'
          ? renderCode(extracted.code)
          : renderArtifacts(extracted.artifacts)}
      </div>
    </div>
  )
}

function renderCode(items: readonly CodeItem[]): JSX.Element {
  if (items.length === 0) return <EmptyState text="当前会话还没有提取到代码块。" />
  return (
    <ul className="dshDesktopCodeList">
      {items.map((item, index) => (
        <li key={index} className="dshDesktopCodeCard">
          <div className="dshDesktopCodeHead">
            <span className="dshDesktopCodeLang">{item.language || 'text'}</span>
            <span className="dshDesktopCodeSource">{item.source}</span>
            <button
              type="button"
              className="dshDesktopSecondaryButton dshDesktopCodeCopy"
              onClick={() => { void navigator.clipboard?.writeText(item.code) }}
            >
              复制
            </button>
          </div>
          <pre className="dshDesktopCodeBlock"><code>{item.code}</code></pre>
        </li>
      ))}
    </ul>
  )
}

function renderArtifacts(items: readonly ArtifactItem[]): JSX.Element {
  if (items.length === 0) return <EmptyState text="当前会话还没有工具产物。" />
  return (
    <ul className="dshDesktopArtifactList">
      {items.map(item => (
        <li key={item.seq} className="dshDesktopArtifactCard" data-error={item.isError || undefined}>
          <div className="dshDesktopArtifactHead">
            <span className="dshDesktopArtifactTool">{item.tool}</span>
            {item.isError && <span className="dshDesktopArtifactError">错误</span>}
          </div>
          <pre className="dshDesktopArtifactText">{item.text}</pre>
        </li>
      ))}
    </ul>
  )
}

function EmptyState({ text }: { text: string }): JSX.Element {
  return <p className="dshDesktopEmptyState">{text}</p>
}

function extractArtifacts(snapshot: ConversationSnapshot | undefined): Extracted {
  const code: CodeItem[] = []
  const artifacts: ArtifactItem[] = []
  const fenced = /```(\w+)?\n([\s\S]*?)```/g
  for (const node of snapshot?.nodes ?? []) {
    if (node.kind === 'assistant') {
      for (const block of node.blocks) {
        if ((block.kind === 'text' || block.kind === 'reasoning') && typeof block.text === 'string') {
          pushFenced(code, block.text, 'assistant', fenced)
        }
      }
    } else if (node.kind === 'tool-result') {
      const text = contentToText(node.content as unknown as readonly unknown[])
      pushFenced(code, text, node.call?.name ?? 'tool', fenced)
      artifacts.push({ tool: node.call?.name ?? 'tool', isError: node.isError, text, seq: node.seq })
    }
  }
  return { code, artifacts }
}

function pushFenced(target: CodeItem[], text: string, source: string, pattern: RegExp): void {
  pattern.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    target.push({ language: match[1] ?? 'text', code: match[2] ?? '', source })
  }
}

interface AnyBlock {
  text?: unknown
  content?: unknown
  [key: string]: unknown
}

function blockText(block: AnyBlock): string {
  if (typeof block.text === 'string') return block.text
  if (typeof block.content === 'string') return block.content
  try {
    return JSON.stringify(block)
  } catch {
    return ''
  }
}

function contentToText(content: readonly unknown[]): string {
  return content
    .map(block => blockText(block as AnyBlock))
    .filter(part => part.length > 0)
    .join('\n')
}
