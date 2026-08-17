/**
 * Modal that turns a natural-language description into a ready-to-run workflow.
 *
 * Flow: the user describes a task → we call the generator model (using the key
 * they already saved in 「API 设置」) → the returned spec is built into a
 * workflow via `workflowStore.createFromSpec` and selected, so the canvas shows
 * it immediately for review. The user only needs to fill the run input + tweak
 * details before pressing Run.
 */

import { useCallback, useState } from 'react'
import { workflowStore } from './workflow-store.ts'
import { generateWorkflowSpec } from './workflow-generator.ts'
import { DEFAULT_PROVIDER_ID, PROVIDER_ENDPOINTS, defaultModelFor, findEndpoint, modelLabel } from './model-catalog.ts'

interface WorkflowGeneratorProps {
  open: boolean
  onClose: () => void
}

const EXAMPLES = [
  '把用户给的一句话先翻译成英文，再扩写成一篇小红书种草文案，最后用英文总结 3 个要点。',
  '输入一个产品名，先生成 5 条卖点，再写一版客服话术，最后总结成一句 slogan。',
  '给一段会议纪要，先提炼行动项清单，再起草一封跟进邮件，最后翻译成英文。',
]

export function WorkflowGenerator({ open, onClose }: WorkflowGeneratorProps): JSX.Element | null {
  const [description, setDescription] = useState('')
  const [providerId, setProviderId] = useState(DEFAULT_PROVIDER_ID)
  const [model, setModel] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [summary, setSummary] = useState('')

  const endpoint = findEndpoint(providerId) ?? PROVIDER_ENDPOINTS[0]!
  const presetModels = endpoint.models
  const effectiveModel = model.length > 0 && presetModels.some((item) => item.id === model) ? model : defaultModelFor(providerId)

  const onProviderChange = useCallback((nextId: string) => {
    setProviderId(nextId)
    setModel('')
  }, [])

  const onGenerate = useCallback(async () => {
    if (description.trim().length === 0) {
      setError('请先描述你想要的工作流（例如：把一句话翻译成英文再扩写成小红书文案）。')
      return
    }
    setLoading(true)
    setError('')
    setSummary('')
    try {
      const spec = await generateWorkflowSpec(description.trim(), { providerId, model: effectiveModel })
      workflowStore.createFromSpec(spec)
      const active = workflowStore.getActive()
      const nodeCount = active?.nodes.length ?? 0
      const agentCount = active?.nodes.filter((node) => node.kind === 'agent').length ?? 0
      const edgeCount = active?.edges.length ?? 0
      setSummary(
        `已生成「${spec.name}」：${String(nodeCount)} 个节点（含 ${String(agentCount)} 个 Agent、${String(edgeCount)} 条连线）。`
        + '已切到该工作流，去画布检查节点/提示词，填入运行输入即可运行。',
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [description, providerId, effectiveModel])

  if (!open) return null

  return (
    <div
      className="dshDesktopModalOverlay"
      onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <div className="dshDesktopGeneratorModal" role="dialog" aria-modal="true" aria-label="用描述生成工作流">
        <header className="dshDesktopGeneratorHead">
          <h3>✨ 用描述生成工作流</h3>
          <button type="button" className="dshDesktopIconButton" onClick={onClose} aria-label="关闭">×</button>
        </header>

        <p className="dshDesktopGeneratorIntro">
          用一句话描述你想要的任务，AI 会自动建好节点、写好提示词、选好模型与参数。生成后你只需检查并填入运行输入即可运行。
        </p>

        <textarea
          className="dshDesktopGeneratorInput"
          placeholder="例如：把用户给的一句话先翻译成英文，再扩写成一篇小红书种草文案，最后用英文总结 3 个要点。"
          value={description}
          rows={4}
          onChange={(event) => { setDescription(event.target.value) }}
        />

        <div className="dshDesktopGeneratorExamples">
          {EXAMPLES.map((example) => (
            <button
              type="button"
              key={example}
              className="dshDesktopWorkflowTemplateChip"
              onClick={() => { setDescription(example) }}
            >
              {example.length > 22 ? `${example.slice(0, 22)}…` : example}
            </button>
          ))}
        </div>

        <div className="dshDesktopGeneratorRow">
          <label className="dshDesktopSkinField">
            生成用的服务商
            <select
              className="dshDesktopSearchInput"
              value={providerId}
              onChange={(event) => { onProviderChange(event.target.value) }}
            >
              {PROVIDER_ENDPOINTS.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </label>
          <label className="dshDesktopSkinField">
            生成用的模型
            <select
              className="dshDesktopSearchInput"
              value={effectiveModel}
              onChange={(event) => { setModel(event.target.value) }}
            >
              {presetModels.map((item) => (
                <option key={item.id} value={item.id}>{modelLabel(providerId, item.id)}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="dshDesktopWorkflowInspectorHint">
          生成器复用左栏「API 设置」里已保存的密钥，无需额外配置。若提示缺少密钥，请先在「API 设置」填好对应服务商的 Key。
        </p>

        {error.length > 0 && <p className="dshDesktopToolsError">{error}</p>}
        {summary.length > 0 && <div className="dshDesktopGeneratorSummary">{summary}</div>}

        <footer className="dshDesktopGeneratorFoot">
          <button type="button" className="dshDesktopSecondaryButton" onClick={onClose}>关闭</button>
          <button
            type="button"
            className="dshDesktopPrimaryButton"
            onClick={onGenerate}
            disabled={loading}
          >
            {loading ? '生成中…' : '⚡ 生成工作流'}
          </button>
        </footer>
      </div>
    </div>
  )
}
