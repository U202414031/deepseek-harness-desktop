import { useEffect, useState } from 'react'
import type {
  ConnStatus, PlatformId, PlatformMessage, PlatformTarget, ToolTask,
} from './platform-types.ts'
import {
  CONNECTORS, PLATFORMS, clearToolConfig, loadToolConfig, saveToolConfig,
} from './registry.ts'
import { loadTasks, newTaskId, saveTasks } from './tasks.ts'
import { extractTasks, summarize } from './llm.ts'

const STATUS_LABEL: Record<ConnStatus, string> = {
  unconfigured: '未配置',
  disconnected: '未连接',
  connected: '已连接',
  error: '连接错误',
}

/**
 * Desktop-owned "外部工具" panel rendered in the left column. Lets the user
 * connect QQ / 微信 / 飞书, then send messages, pull recent messages, summarize
 * them with the configured DeepSeek key, and manage local tasks.
 */
export function ToolsPanel(): JSX.Element {
  const [activeId, setActiveId] = useState<PlatformId>('feishu')
  const connector = CONNECTORS[activeId]
  const meta = connector.meta

  const [values, setValues] = useState<Record<string, string>>(() => loadToolConfig(activeId))
  const [status, setStatus] = useState<ConnStatus>(() => (Object.keys(loadToolConfig(activeId)).length > 0 ? 'disconnected' : 'unconfigured'))
  const [token, setToken] = useState<string | null>(null)
  const [targets, setTargets] = useState<PlatformTarget[]>([])
  const [targetId, setTargetId] = useState<string>('')
  const [messages, setMessages] = useState<PlatformMessage[]>([])
  const [summary, setSummary] = useState<string>('')
  const [manualText, setManualText] = useState<string>('')
  const [tasks, setTasks] = useState<ToolTask[]>(() => loadTasks(activeId))

  const [fieldError, setFieldError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendText, setSendText] = useState('')
  const [fetching, setFetching] = useState(false)
  const [summarizing, setSummarizing] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [taskTitle, setTaskTitle] = useState('')

  // Reset everything when switching platforms.
  useEffect(() => {
    const cfg = loadToolConfig(activeId)
    setValues(cfg)
    setStatus(Object.keys(cfg).length > 0 ? 'disconnected' : 'unconfigured')
    setToken(null)
    setTargets([])
    setTargetId('')
    setMessages([])
    setSummary('')
    setTasks(loadTasks(activeId))
    setFieldError(null)
    setInfo(null)
  }, [activeId])

  // Persist tasks whenever they change for the active platform.
  useEffect(() => {
    saveTasks(activeId, tasks)
  }, [activeId, tasks])

  const onField = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }))
    if (status === 'connected') setStatus('disconnected')
  }

  const onConnect = async () => {
    setConnecting(true)
    setFieldError(null)
    setInfo(null)
    try {
      const t = await connector.connect(values)
      setToken(t)
      setStatus('connected')
      saveToolConfig(activeId, values)
      if (meta.targetMode === 'select') {
        try {
          setTargets(await connector.listTargets(t))
        } catch (e) {
          setFieldError(e instanceof Error ? `列出目标失败：${e.message}` : '列出目标失败')
        }
      }
      setInfo(`已连接 ${meta.label}`)
    } catch (e) {
      setStatus('error')
      setFieldError(e instanceof Error ? e.message : '连接失败')
    } finally {
      setConnecting(false)
    }
  }

  const onDisconnect = () => {
    setToken(null)
    setStatus('disconnected')
    setTargets([])
    setTargetId('')
    setMessages([])
    setInfo('已断开连接')
  }

  const onSaveConfig = () => {
    saveToolConfig(activeId, values)
    setInfo('已保存当前配置')
  }

  const onClearConfig = () => {
    clearToolConfig(activeId)
    setValues({})
    setToken(null)
    setStatus('unconfigured')
    setTargets([])
    setInfo('已清除配置')
  }

  const onSend = async () => {
    if (token === null) { setFieldError('请先连接。'); return }
    if (targetId.trim().length === 0) { setFieldError(`请${meta.targetMode === 'select' ? '选择' : '填写'}${meta.targetLabel}。`); return }
    if (sendText.trim().length === 0) { setFieldError('请输入要发送的内容。'); return }
    setSending(true)
    setFieldError(null)
    const result = await connector.sendMessage(token, targetId, sendText)
    setSending(false)
    setInfo(result.message)
    if (result.ok) setSendText('')
  }

  const onFetch = async () => {
    if (token === null) { setFieldError('请先连接。'); return }
    if (targetId.trim().length === 0) { setFieldError(`请${meta.targetMode === 'select' ? '选择' : '填写'}${meta.targetLabel}。`); return }
    setFetching(true)
    setFieldError(null)
    try {
      setMessages(await connector.fetchMessages(token, targetId))
      setSummary('')
      setInfo('已获取最近消息')
    } catch (e) {
      setFieldError(e instanceof Error ? e.message : '获取消息失败')
    } finally {
      setFetching(false)
    }
  }

  const messagesAsText = (): string =>
    messages.length > 0 ? messages.map((m) => `${m.sender}：${m.text}`).join('\n') : manualText

  const onSummarize = async () => {
    const src = messagesAsText()
    if (src.trim().length === 0) { setFieldError('请先获取消息，或在下方粘贴文本后再总结。'); return }
    setSummarizing(true)
    setFieldError(null)
    try {
      setSummary(await summarize(src))
    } finally {
      setSummarizing(false)
    }
  }

  const onExtract = async () => {
    const src = summary || messagesAsText()
    if (src.trim().length === 0) { setFieldError('请先总结或获取消息，再提取任务。'); return }
    setExtracting(true)
    setFieldError(null)
    try {
      const titles = await extractTasks(src)
      if (titles.length === 0) { setInfo('未从内容中提取到明确任务。'); return }
      const now = Date.now()
      setTasks((prev) => [
        ...prev,
        ...titles.map((title) => ({ id: newTaskId(), title, done: false, createdAt: now, source: activeId })),
      ])
      setInfo(`已从内容中提取 ${titles.length} 个任务`)
    } finally {
      setExtracting(false)
    }
  }

  const onAddTask = () => {
    const title = taskTitle.trim()
    if (title.length === 0) return
    setTasks((prev) => [...prev, { id: newTaskId(), title, done: false, createdAt: Date.now(), source: activeId }])
    setTaskTitle('')
  }

  const onToggle = (id: string) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)))
  }

  const onDelete = (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id))
  }

  return (
    <div className="dshDesktopTools">
      <header className="dshDesktopFeatureHeader">
        <h2 className="dshDesktopFeatureTitle">外部工具</h2>
        <p className="dshDesktopFeatureSubtitle">接入 QQ / 微信 / 飞书，发送消息、获取与总结信息、管理任务。凭证仅保存在本机。</p>
      </header>

      <div className="dshDesktopToolsTabs">
        {PLATFORMS.map((p) => (
          <button
            key={p.id}
            type="button"
            className="dshDesktopToolsTab"
            data-active={activeId === p.id || undefined}
            style={activeId === p.id ? { borderColor: p.accent, color: p.accent } : undefined}
            onClick={() => { setActiveId(p.id) }}
          >
            <span aria-hidden="true">{p.emoji}</span> {p.short}
          </button>
        ))}
      </div>

      <div className="dshDesktopToolsCard">
        <div className="dshDesktopToolsStatus">
          <span>连接状态</span>
          <b data-status={status}>{STATUS_LABEL[status]}</b>
        </div>

        {meta.fields.map((field) => (
          <label key={field.key} className="dshDesktopSkinField">
            <span>{field.label}</span>
            <input
              type={field.secret ? 'password' : 'text'}
              className="dshDesktopSearchInput"
              value={values[field.key] ?? ''}
              placeholder={field.placeholder ?? ''}
              onChange={(event) => { onField(field.key, event.target.value) }}
            />
          </label>
        ))}

        {meta.note !== undefined && <p className="dshDesktopToolsNote">{meta.note}</p>}

        <div className="dshDesktopApiActions">
          <button type="button" className="dshDesktopPrimaryButton" onClick={onConnect} disabled={connecting}>
            {connecting ? '连接中…' : '连接'}
          </button>
          <button type="button" className="dshDesktopSecondaryButton" onClick={onSaveConfig}>保存配置</button>
          <button type="button" className="dshDesktopSecondaryButton" onClick={onDisconnect} disabled={token === null}>断开</button>
          <button type="button" className="dshDesktopSecondaryButton" onClick={onClearConfig}>清除</button>
        </div>

        <a className="dshDesktopToolsDocLink" href={meta.docUrl} target="_blank" rel="noreferrer">查看 {meta.label} 开发文档 ↗</a>
      </div>

      <div className="dshDesktopToolsCard">
        <label className="dshDesktopSkinField">
          <span>{meta.targetLabel}</span>
          {meta.targetMode === 'select' ? (
            <select
              className="dshDesktopSearchInput"
              value={targetId}
              onChange={(event) => { setTargetId(event.target.value) }}
            >
              <option value="">{token === null ? '请先连接' : targets.length === 0 ? '无可用目标' : '选择目标…'}</option>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              className="dshDesktopSearchInput"
              value={targetId}
              placeholder={meta.targetLabel}
              onChange={(event) => { setTargetId(event.target.value) }}
            />
          )}
        </label>

        <div className="dshDesktopToolsSend">
          <textarea
            className="dshDesktopSearchInput dshDesktopToolsTextarea"
            value={sendText}
            placeholder="输入要发送的内容…"
            onChange={(event) => { setSendText(event.target.value) }}
          />
          <button type="button" className="dshDesktopPrimaryButton" onClick={onSend} disabled={sending || token === null}>
            {sending ? '发送中…' : '发送消息'}
          </button>
        </div>

        {meta.supportsFetch && (
          <button type="button" className="dshDesktopSecondaryButton dshDesktopToolsWideBtn" onClick={onFetch} disabled={fetching || token === null}>
            {fetching ? '获取中…' : '获取最近消息'}
          </button>
        )}
      </div>

      <div className="dshDesktopToolsCard">
        <h3 className="dshDesktopToolsSection">信息总结</h3>
        <button type="button" className="dshDesktopSecondaryButton dshDesktopToolsWideBtn" onClick={onSummarize} disabled={summarizing}>
          {summarizing ? '总结中…' : '总结消息 / 文本'}
        </button>
        <textarea
          className="dshDesktopSearchInput dshDesktopToolsTextarea"
          value={manualText}
          placeholder="若无可获取的消息，可在此粘贴文本用于总结"
          onChange={(event) => { setManualText(event.target.value) }}
        />
        {summary.length > 0 && <div className="dshDesktopToolsSummary">{summary}</div>}
        <button type="button" className="dshDesktopPrimaryButton dshDesktopToolsWideBtn" onClick={onExtract} disabled={extracting}>
          {extracting ? '提取中…' : '从总结/消息中提取任务'}
        </button>
      </div>

      <div className="dshDesktopToolsCard">
        <h3 className="dshDesktopToolsSection">任务</h3>
        <div className="dshDesktopToolsSend">
          <input
            type="text"
            className="dshDesktopSearchInput"
            value={taskTitle}
            placeholder="新建任务标题…"
            onChange={(event) => { setTaskTitle(event.target.value) }}
            onKeyDown={(event) => { if (event.key === 'Enter') onAddTask() }}
          />
          <button type="button" className="dshDesktopPrimaryButton" onClick={onAddTask}>添加</button>
        </div>
        {tasks.length === 0 ? (
          <p className="dshDesktopToolsNote">暂无任务。发送消息或从总结中提取均可生成任务。</p>
        ) : (
          <ul className="dshDesktopToolsTasks">
            {tasks.map((t) => (
              <li key={t.id} className="dshDesktopToolsTask">
                <label className="dshDesktopToolsTaskMain">
                  <input type="checkbox" checked={t.done} onChange={() => { onToggle(t.id) }} />
                  <span className={t.done ? 'dshDesktopToolsTaskDone' : undefined}>{t.title}</span>
                </label>
                <button type="button" className="dshDesktopToolsTaskDel" title="删除" onClick={() => { onDelete(t.id) }}>×</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {meta.supportsFetch && messages.length > 0 && (
        <div className="dshDesktopToolsCard">
          <h3 className="dshDesktopToolsSection">最近消息（{messages.length}）</h3>
          <ul className="dshDesktopToolsMessages">
            {messages.map((m) => (
              <li key={m.id} className="dshDesktopToolsMsg">
                <span className="dshDesktopToolsMsgSender">{m.sender}</span>
                <span className="dshDesktopToolsMsgText">{m.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {fieldError !== null && <p className="dshDesktopMarketplaceNote">{fieldError}</p>}
      {info !== null && <p className="dshDesktopToolsInfo">{info}</p>}
    </div>
  )
}
