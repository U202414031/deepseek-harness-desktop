import { useEffect, useRef, useState } from 'react'

/**
 * Desktop-owned "外部工具 / IM 网关" panel (left column).
 *
 * This is the configuration surface for the **in-app IM gateway** (host service
 * `src/im-gateway`). It talks to the gateway over the same-origin loopback
 * routes and lets the user:
 *   - add / edit / delete QQ · 飞书 · 微信 channels (with the right credentials)
 *   - see each channel's live connection status
 *   - push config to the host (which hot-reloads the gateway) and force a reload
 *
 * The gateway then bridges those platforms to the local DeepSeek agent, so the
 * user can query work status and dispatch tasks from their phone.
 */

type ChannelType = 'qq' | 'feishu' | 'weixin'

interface ChannelConfig {
  id: string
  type: ChannelType
  name: string
  enabled: boolean
  config: Record<string, string>
}

interface ChannelStatus {
  type: ChannelType
  id: string
  name: string
  enabled: boolean
  connected: boolean
  detail?: string
}

interface FieldDef {
  key: string
  label: string
  secret?: boolean
  placeholder?: string
}

interface ChannelMeta {
  label: string
  emoji: string
  fields: FieldDef[]
  docUrl: string
  note?: string
}

const CHANNEL_META: Record<ChannelType, ChannelMeta> = {
  qq: {
    label: 'QQ 机器人',
    emoji: '🐧',
    fields: [
      { key: 'appId', label: 'App ID', placeholder: 'q.qq.com 机器人 AppID' },
      { key: 'appSecret', label: 'App Secret', secret: true, placeholder: 'q.qq.com 机器人密钥' },
      { key: 'sandbox', label: '沙箱模式（测试填 true，正式留空）', placeholder: 'true / 留空' },
    ],
    docUrl: 'https://q.qq.com',
    note: '官方 QQ 开放平台机器人（API v2，支持 C2C 私聊）：在 q.qq.com 创建机器人 → 开通「C2C 私聊」能力 → 填 AppID/AppSecret。沙箱模式需先把测试 QQ 加为沙箱成员。手机 QQ 搜索并添加该机器人为好友即可对话。',
  },
  feishu: {
    label: '飞书',
    emoji: '🟢',
    fields: [
      { key: 'appId', label: 'App ID', placeholder: '飞书应用 App ID' },
      { key: 'appSecret', label: 'App Secret', secret: true, placeholder: '飞书应用 App Secret' },
    ],
    docUrl: 'https://open.feishu.cn',
    note: '飞书自建应用需开通 im:message 权限。当前版本出站可用，入站事件订阅为后续扩展点。',
  },
  weixin: {
    label: '微信',
    emoji: '💬',
    fields: [
      { key: 'corpId', label: 'Corp ID', placeholder: '企业微信 CorpID' },
      { key: 'corpSecret', label: 'Corp Secret', secret: true, placeholder: '企业微信 Secret' },
      { key: 'agentId', label: 'Agent ID', placeholder: '自建应用 AgentId' },
    ],
    docUrl: 'https://work.weixin.qq.com',
    note: '个人微信无官方机器人接口，此处接企业微信自建应用；在手机企业微信里对话。',
  },
}

const TYPE_ORDER: ChannelType[] = ['qq', 'feishu', 'weixin']

interface EditorState {
  mode: 'add' | 'edit'
  type: ChannelType
  id?: string
  name: string
  enabled: boolean
  config: Record<string, string>
}

async function apiFetch<T>(path: string, init?: RequestInit, timeoutMs = 20000): Promise<T> {
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(path, { ...init, signal: ctrl.signal })
    if (!res.ok) {
      let msg = `请求失败（${res.status}）`
      try {
        const body = (await res.json()) as { error?: string }
        if (body.error) msg = body.error
      } catch {
        /* ignore parse error */
      }
      throw new Error(msg)
    }
    return (await res.json()) as T
  } catch (cause) {
    if ((cause as Error)?.name === 'AbortError') {
      throw new Error(`请求超时（${timeoutMs / 1000} 秒无响应），请重试`)
    }
    throw cause
  } finally {
    window.clearTimeout(timer)
  }
}

export function ToolsPanel(): JSX.Element {
  const [channels, setChannels] = useState<ChannelConfig[]>([])
  const [statusMap, setStatusMap] = useState<Record<string, ChannelStatus>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const busyTimerRef = useRef<number | null>(null)

  // busy 兜底：无论什么原因（网络挂起、host 无响应等），60 秒后强制解除，
  // 绝不让界面按钮永久禁用（表现为"点不动/无法输入"）。
  const setBusySafe = (v: boolean): void => {
    if (busyTimerRef.current !== null) {
      window.clearTimeout(busyTimerRef.current)
      busyTimerRef.current = null
    }
    setBusy(v)
    if (v) {
      busyTimerRef.current = window.setTimeout(() => {
        busyTimerRef.current = null
        setBusy(false)
        setError((prev) => (prev ? prev : '操作超时（60 秒未完成），请重试'))
      }, 60_000)
    }
  }

  const refresh = (): void => {
    setLoading(true)
    setError(null)
    Promise.all([
      apiFetch<{ channels: ChannelConfig[] }>('/desktop/im-gateway/config'),
      apiFetch<ChannelStatus[]>('/desktop/im-gateway/status').catch(() => [] as ChannelStatus[]),
    ])
      .then(([cfg, status]) => {
        setChannels(cfg.channels ?? [])
        const map: Record<string, ChannelStatus> = {}
        for (const s of status) map[s.id] = s
        setStatusMap(map)
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : '读取网关配置失败')
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveConfig = (next: ChannelConfig[]): void => {
    setBusySafe(true)
    setError(null)
    apiFetch('/desktop/im-gateway/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channels: next }),
    })
      .then(() => {
        setChannels(next)
        setInfo('配置已保存，网关正在重连…')
        // Give the host a moment to reconnect the channels, then re-read status.
        window.setTimeout(() => {
          apiFetch<ChannelStatus[]>('/desktop/im-gateway/status')
            .then((status) => {
              const map: Record<string, ChannelStatus> = {}
              for (const s of status) map[s.id] = s
              setStatusMap(map)
            })
            .catch(() => {})
        }, 1200)
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : '保存配置失败')
      })
      .finally(() => setBusySafe(false))
  }

  const onToggleEnable = (id: string): void => {
    const next = channels.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c))
    saveConfig(next)
  }

  const onDelete = (id: string): void => {
    if (!window.confirm('确定删除该通道？')) return
    saveConfig(channels.filter((c) => c.id !== id))
  }

  const openAdd = (type: ChannelType): void => {
    // 新增通道默认不自动启用：由用户填好凭证后自行勾选「启用」再连接，
    // 避免一添加就尝试连接（凭证没填全时只会报错）。
    setEditor({ mode: 'add', type, name: CHANNEL_META[type].label, enabled: false, config: {} })
  }

  const openEdit = (ch: ChannelConfig): void => {
    setEditor({ mode: 'edit', type: ch.type, id: ch.id, name: ch.name, enabled: ch.enabled, config: { ...ch.config } })
  }

  const onEditorField = (key: string, value: string): void => {
    setEditor((prev) => (prev ? { ...prev, config: { ...prev.config, [key]: value } } : prev))
  }

  const onSaveEditor = (): void => {
    if (!editor) return
    const name = editor.name.trim().length > 0 ? editor.name.trim() : CHANNEL_META[editor.type].label
    let next: ChannelConfig[]
    if (editor.mode === 'add') {
      const id = (crypto.randomUUID?.() ?? `ch-${Date.now()}`)
      next = [...channels, { id, type: editor.type, name, enabled: editor.enabled, config: editor.config }]
    } else {
      next = channels.map((c) =>
        c.id === editor.id ? { ...c, name, enabled: editor.enabled, config: editor.config } : c,
      )
    }
    setEditor(null)
    saveConfig(next)
  }

  const onReload = (): void => {
    setBusySafe(true)
    setError(null)
    apiFetch('/desktop/im-gateway/reload', { method: 'POST' })
      .then(() => {
        setInfo('已通知网关重新连接所有通道。')
        window.setTimeout(refresh, 1000)
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : '重连失败'))
      .finally(() => setBusySafe(false))
  }

  const metaOf = (type: ChannelType): ChannelMeta =>
    CHANNEL_META[type] ?? { label: type, emoji: '🔌', fields: [], docUrl: '' }

  return (
    <div className="dshDesktopTools">
      <header className="dshDesktopFeatureHeader">
        <h2 className="dshDesktopFeatureTitle">外部工具 · IM 网关</h2>
        <p className="dshDesktopFeatureSubtitle">
          把 QQ / 飞书 / 微信接到本机 DeepSeek，手机上即可对话、查询工作状态、部署任务。凭证仅存本机。
        </p>
      </header>

      <div className="dshDesktopToolsCard">
        <h3 className="dshDesktopToolsSection">手机怎么用</h3>
        <p className="dshDesktopToolsNote">
          在手机上给对应机器人发消息，就相当于和 DeepSeek 对话。支持斜杠命令：
        </p>
        <ul className="dshDesktopToolsDeploy">
          <li><b>/status</b> — 查看工作状态与会话列表</li>
          <li><b>/deploy &lt;任务&gt;</b> — 让 DeepSeek 执行一个部署/任务</li>
          <li><b>/new</b> 新会话 · <b>/stop</b> 停止 · <b>/model</b> 当前模型 · <b>/help</b> 帮助</li>
        </ul>
        <p className="dshDesktopToolsNote">提示：请保持本应用处于打开状态（建议开机自启+最小化），手机才能随时连上。</p>
      </div>

      {error !== null && <p className="dshDesktopToolsError">{error}</p>}
      {info !== null && <p className="dshDesktopToolsInfo">{info}</p>}

      <div className="dshDesktopToolsApiActions">
        <div className="dshDesktopToolsTabs" style={{ flex: 1 }}>
          {TYPE_ORDER.map((t) => (
            <button
              key={t}
              type="button"
              className="dshDesktopToolsTab"
              onClick={() => { openAdd(t) }}
            >
              <span aria-hidden="true">{metaOf(t).emoji}</span> 添加{metaOf(t).label}
            </button>
          ))}
        </div>
        <button type="button" className="dshDesktopSecondaryButton" onClick={onReload} disabled={busy}>
          {busy ? '处理中…' : '重连全部'}
        </button>
      </div>

      {editor !== null && (
        <div className="dshDesktopToolsCard">
          <h3 className="dshDesktopToolsSection">
            {editor.mode === 'add' ? `添加${metaOf(editor.type).label}通道` : `编辑${metaOf(editor.type).label}通道`}
          </h3>
          <p className="dshDesktopToolsNote">{metaOf(editor.type).note}</p>
          <label className="dshDesktopSkinField">
            <span>名称</span>
            <input
              type="text"
              className="dshDesktopSearchInput"
              value={editor.name}
              placeholder={metaOf(editor.type).label}
              onChange={(event) => { setEditor((p) => (p ? { ...p, name: event.target.value } : p)) }}
            />
          </label>
          {metaOf(editor.type).fields.map((field) => (
            <label key={field.key} className="dshDesktopSkinField">
              <span>{field.label}</span>
              <input
                type={field.secret ? 'password' : 'text'}
                className="dshDesktopSearchInput"
                value={editor.config[field.key] ?? ''}
                placeholder={field.placeholder ?? ''}
                onChange={(event) => { onEditorField(field.key, event.target.value) }}
              />
            </label>
          ))}
          <label className="dshDesktopSkinField" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={editor.enabled}
              onChange={(event) => { setEditor((p) => (p ? { ...p, enabled: event.target.checked } : p)) }}
            />
            <span>启用（启动后自动连接）</span>
          </label>
          <a className="dshDesktopToolsDocLink" href={metaOf(editor.type).docUrl} target="_blank" rel="noreferrer">
            查看{metaOf(editor.type).label}开发文档 ↗
          </a>
          <div className="dshDesktopApiActions">
            <button type="button" className="dshDesktopPrimaryButton" onClick={onSaveEditor} disabled={busy}>保存</button>
            <button type="button" className="dshDesktopSecondaryButton" onClick={() => { setEditor(null) }}>取消</button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="dshDesktopToolsNote">读取网关配置中…</p>
      ) : channels.length === 0 ? (
        <div className="dshDesktopToolsCard">
          <p className="dshDesktopToolsNote">还没有任何通道。点击上方「添加 QQ / 飞书 / 微信」开始接入。</p>
        </div>
      ) : (
        channels.map((ch) => {
          const meta = metaOf(ch.type)
          const st = statusMap[ch.id]
          const connected = st?.connected ?? false
          const statusText = !ch.enabled ? '已停用' : connected ? '已连接' : '未连接'
          const statusKind = !ch.enabled ? 'unconfigured' : connected ? 'connected' : 'disconnected'
          return (
            <div key={ch.id} className="dshDesktopToolsCard">
              <div className="dshDesktopToolsStatus">
                <span><span aria-hidden="true">{meta.emoji}</span> {ch.name}</span>
                <b data-status={statusKind}>{statusText}</b>
              </div>
              {st?.detail !== undefined && st.detail.length > 0 && (
                <p className="dshDesktopToolsNote">{st.detail}</p>
              )}
              <div className="dshDesktopApiActions">
                <button
                  type="button"
                  className="dshDesktopSecondaryButton"
                  onClick={() => { onToggleEnable(ch.id) }}
                  disabled={busy}
                >
                  {ch.enabled ? '停用' : '启用'}
                </button>
                <button
                  type="button"
                  className="dshDesktopSecondaryButton"
                  onClick={() => { openEdit(ch) }}
                  disabled={busy}
                >
                  编辑
                </button>
                <button
                  type="button"
                  className="dshDesktopSecondaryButton"
                  onClick={() => { onDelete(ch.id) }}
                  disabled={busy}
                >
                  删除
                </button>
              </div>
            </div>
          )
        })
      )}

      {info !== null && <p className="dshDesktopToolsInfo">{info}</p>}
    </div>
  )
}
