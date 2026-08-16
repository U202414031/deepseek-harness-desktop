import { useEffect, useState } from 'react'
import type {
  ConnStatus, PlatformId, PlatformMessage, PlatformTarget, ScheduleItem, ToolTask,
} from './platform-types.ts'
import {
  CONNECTORS, PLATFORMS, clearToolConfig, loadToolConfig, loadToolSchedules, saveToolConfig, saveToolSchedules,
} from './registry.ts'
import { loadTasks, newTaskId, saveTasks } from './tasks.ts'
import { extractTasks, summarize } from './llm.ts'

const STATUS_LABEL: Record<ConnStatus, string> = {
  unconfigured: '未配置',
  disconnected: '未连接',
  connected: '已连接',
  error: '连接错误',
}

const SCHED_STATUS_LABEL: Record<ScheduleItem['status'], string> = {
  pending: '待发送',
  sent: '已发送',
  failed: '失败',
  missed: '错过',
}

/** Module-scoped so timers survive re-renders; keyed by schedule id. */
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const firedIds = new Set<string>()

function formatTime(at: number): string {
  try {
    return new Date(at).toLocaleString()
  } catch {
    return String(at)
  }
}

/**
 * Desktop-owned "外部工具" panel rendered in the left column. Lets the user
 * connect QQ / 微信 / 飞书, then send messages (to groups or private chats),
 * pull recent messages, summarize them with the configured DeepSeek key,
 * schedule outgoing messages, and manage local tasks.
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
  const [targetType, setTargetType] = useState<string>(() => meta.targetTypes?.[0]?.id ?? '')
  const [messages, setMessages] = useState<PlatformMessage[]>([])
  const [summary, setSummary] = useState<string>('')
  const [manualText, setManualText] = useState<string>('')
  const [tasks, setTasks] = useState<ToolTask[]>(() => loadTasks(activeId))
  const [schedules, setSchedules] = useState<ScheduleItem[]>(() => loadToolSchedules(activeId))
  const [schedTime, setSchedTime] = useState<string>('')
  const [schedText, setSchedText] = useState<string>('')

  const [fieldError, setFieldError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendText, setSendText] = useState('')
  const [fetching, setFetching] = useState(false)
  const [summarizing, setSummarizing] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [taskTitle, setTaskTitle] = useState('')

  const currentType = meta.targetTypes?.find((t) => t.id === targetType)
  const inputMode: 'select' | 'text' = currentType ? currentType.input : meta.targetMode
  const effectiveTargetLabel = currentType ? currentType.label : meta.targetLabel
  const targetPlaceholder = currentType?.placeholder ?? meta.targetLabel

  const scheduleItem = (item: ScheduleItem): void => {
    if (firedIds.has(item.id)) return
    if (item.at <= Date.now()) {
      setSchedules((prev) => {
        const next = prev.map((s): ScheduleItem => (s.id === item.id ? { ...s, status: 'missed' } : s))
        saveToolSchedules(item.platform, next)
        return next
      })
      return
    }
    const handle = setTimeout(() => {
      void fireSchedule(item)
    }, item.at - Date.now())
    timers.set(item.id, handle)
  }

  const fireSchedule = async (item: ScheduleItem): Promise<void> => {
    if (firedIds.has(item.id)) return
    firedIds.add(item.id)
    const handle = timers.get(item.id)
    if (handle !== undefined) {
      clearTimeout(handle)
      timers.delete(item.id)
    }
    try {
      const cfg = loadToolConfig(item.platform)
      const conn = CONNECTORS[item.platform]
      const freshToken = await conn.connect(cfg)
      const res = await conn.sendMessage(freshToken, item.target, item.text, { targetType: item.targetType })
      setSchedules((prev) => {
        const next = prev.map((s): ScheduleItem =>
          s.id === item.id ? { ...s, status: res.ok ? 'sent' : 'failed', result: res.message } : s,
        )
        saveToolSchedules(item.platform, next)
        return next
      })
      setInfo(`定时消息${res.ok ? '已发送' : '发送失败'}（${conn.meta.short} → ${item.target}）`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : '定时发送失败'
      setSchedules((prev) => {
        const next = prev.map((s): ScheduleItem => (s.id === item.id ? { ...s, status: 'failed', result: msg } : s))
        saveToolSchedules(item.platform, next)
        return next
      })
      setInfo(`定时消息发送失败：${msg}`)
    }
  }

  // Reset everything when switching platforms, and re-arm pending schedules.
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
    setTargetType(CONNECTORS[activeId].meta.targetTypes?.[0]?.id ?? '')
    setSchedTime('')
    setSchedText('')
    const loaded = loadToolSchedules(activeId)
    setSchedules(loaded)
    loaded.forEach((item) => {
      if (item.status === 'pending') scheduleItem(item)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      if (inputMode === 'select') {
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
    if (targetId.trim().length === 0) { setFieldError(`请${inputMode === 'select' ? '选择' : '填写'}${effectiveTargetLabel}。`); return }
    if (sendText.trim().length === 0) { setFieldError('请输入要发送的内容。'); return }
    setSending(true)
    setFieldError(null)
    const result = await connector.sendMessage(token, targetId, sendText, { targetType })
    setSending(false)
    setInfo(result.message)
    if (result.ok) setSendText('')
  }

  const onFetch = async () => {
    if (token === null) { setFieldError('请先连接。'); return }
    if (targetId.trim().length === 0) { setFieldError(`请${inputMode === 'select' ? '选择' : '填写'}${effectiveTargetLabel}。`); return }
    setFetching(true)
    setFieldError(null)
    try {
      setMessages(await connector.fetchMessages(token, targetId, { targetType }))
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

  const onAddSchedule = () => {
    if (targetId.trim().length === 0) { setFieldError(`请先${inputMode === 'select' ? '选择' : '填写'}${effectiveTargetLabel}。`); return }
    if (schedText.trim().length === 0) { setFieldError('请输入定时发送的内容。'); return }
    if (schedTime.trim().length === 0) { setFieldError('请选择发送时间。'); return }
    const at = new Date(schedTime).getTime()
    if (!Number.isFinite(at) || at <= Date.now()) { setFieldError('发送时间需晚于当前时间。'); return }
    const item: ScheduleItem = {
      id: newTaskId(),
      platform: activeId,
      target: targetId,
      targetType,
      text: schedText,
      at,
      status: 'pending',
    }
    setSchedules((prev) => {
      const next = [...prev, item]
      saveToolSchedules(activeId, next)
      return next
    })
    scheduleItem(item)
    setSchedText('')
    setSchedTime('')
    setInfo(`已加入定时发送（${formatTime(at)}）`)
  }

  const onRemoveSchedule = (id: string) => {
    const handle = timers.get(id)
    if (handle !== undefined) {
      clearTimeout(handle)
      timers.delete(id)
    }
    firedIds.delete(id)
    setSchedules((prev) => {
      const next = prev.filter((s) => s.id !== id)
      saveToolSchedules(activeId, next)
      return next
    })
  }

  const onRetrySchedule = (item: ScheduleItem) => {
    if (item.at <= Date.now()) { setFieldError('该定时已过期，无法重试，请删除后重新添加。'); return }
    setSchedules((prev) => {
      const next = prev.map(
        (s): ScheduleItem =>
          s.id === item.id
            ? { id: s.id, platform: s.platform, target: s.target, targetType: s.targetType, text: s.text, at: s.at, status: 'pending' }
            : s,
      )
      saveToolSchedules(activeId, next)
      return next
    })
    scheduleItem({ ...item, status: 'pending' })
  }

  return (
    <div className="dshDesktopTools">
      <header className="dshDesktopFeatureHeader">
        <h2 className="dshDesktopFeatureTitle">外部工具</h2>
        <p className="dshDesktopFeatureSubtitle">接入 QQ / 微信 / 飞书，发送消息、获取与总结信息、定时发送、管理任务。凭证仅保存在本机。</p>
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
        {meta.targetTypes !== undefined && meta.targetTypes.length > 0 && (
          <div className="dshDesktopToolsTypeRow">
            {meta.targetTypes.map((t) => (
              <button
                key={t.id}
                type="button"
                className="dshDesktopToolsTypeBtn"
                data-active={targetType === t.id || undefined}
                onClick={() => { setTargetType(t.id) }}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        <label className="dshDesktopSkinField">
          <span>{effectiveTargetLabel}</span>
          {inputMode === 'select' ? (
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
              placeholder={targetPlaceholder}
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
            {fetching ? '获取中…' : `获取${effectiveTargetLabel}消息`}
          </button>
        )}
      </div>

      <div className="dshDesktopToolsCard">
        <h3 className="dshDesktopToolsSection">定时发送</h3>
        <label className="dshDesktopSkinField">
          <span>发送时间</span>
          <input
            type="datetime-local"
            className="dshDesktopSearchInput dshDesktopToolsTimeInput"
            value={schedTime}
            onChange={(event) => { setSchedTime(event.target.value) }}
          />
        </label>
        <div className="dshDesktopToolsSend">
          <textarea
            className="dshDesktopSearchInput dshDesktopToolsTextarea"
            value={schedText}
            placeholder={`到「${effectiveTargetLabel}」的定时内容…`}
            onChange={(event) => { setSchedText(event.target.value) }}
          />
          <button type="button" className="dshDesktopPrimaryButton" onClick={onAddSchedule} disabled={token === null}>
            加入定时
          </button>
        </div>
        {schedules.length === 0 ? (
          <p className="dshDesktopToolsNote">暂无定时任务。选择目标与时间后加入，到点会自动重连并发送（即使你已断开，也会用已保存配置自动连接）。</p>
        ) : (
          <ul className="dshDesktopToolsSched">
            {schedules.map((s) => (
              <li key={s.id} className="dshDesktopToolsSchedItem">
                <div className="dshDesktopToolsSchedMain">
                  <span className="dshDesktopToolsSchedTime">{formatTime(s.at)}</span>
                  <span className="dshDesktopToolsSchedTarget" title={s.target}>→ {s.target}</span>
                  <span className="dshDesktopToolsSchedText">{s.text}</span>
                </div>
                <div className="dshDesktopToolsSchedSide">
                  <b className="dshDesktopToolsBadge" data-status={s.status}>{SCHED_STATUS_LABEL[s.status]}</b>
                  {(s.status === 'failed' || s.status === 'missed') && (
                    <button type="button" className="dshDesktopToolsTaskDel" title="重试" onClick={() => { onRetrySchedule(s) }}>↻</button>
                  )}
                  <button type="button" className="dshDesktopToolsTaskDel" title="删除" onClick={() => { onRemoveSchedule(s.id) }}>×</button>
                </div>
                {s.result !== undefined && s.status !== 'sent' && (
                  <p className="dshDesktopToolsSchedResult">{s.result}</p>
                )}
              </li>
            ))}
          </ul>
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
