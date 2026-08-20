import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ImGateway } from '../src/gateway.ts'
import {
  parseOptionIndices,
  parseWorkdirTask,
  resolveWorkdir,
} from '../src/gateway.ts'
import type {
  HarnessBridge,
  ImChannelAdapter,
  ImChannelConfig,
  ImChannelStatus,
  ImGatewayContext,
  ImInboundMessage,
  ImOutboundStream,
  ImQuestionAnswerItem,
  ImQuestionRequest,
} from '../src/types.ts'

/** Test double for the harness bridge: records calls and can script questions. */
class FakeHarness implements HarnessBridge {
  createCalls: Array<{ cwd?: string; agentPreset?: string }> = []
  answerCalls: Array<{ request: ImQuestionRequest; answers: ImQuestionAnswerItem[] }> = []
  cancelCalls: ImQuestionRequest[] = []
  promptCalls: Array<{ sessionId: string; text: string }> = []
  /** Questions to emit when the next prompt runs (empty = never ask). */
  questions: ImQuestionRequest['questions'] = []
  answerResult: { accepted: boolean; reason?: string } = { accepted: true }

  async listSessions() {
    return []
  }
  async getStatus() {
    return {
      version: 'test',
      cwd: 'C:\\default',
      attachedSessions: 0,
      canOpenPath: false,
    }
  }
  async createSession(opts?: { cwd?: string; agentPreset?: string }) {
    const call = opts ?? {}
    this.createCalls.push(call)
    return `sess-${this.createCalls.length}`
  }
  async cancel() {}
  async prompt(sessionId: string, text: string, handlers: Parameters<HarnessBridge['prompt']>[2]) {
    this.promptCalls.push({ sessionId, text })
    if (this.questions.length > 0 && handlers.onQuestion) {
      await handlers.onQuestion({ rpcId: 'q-rpc-1', sessionId, questions: this.questions })
    }
    handlers.onEnd('completed')
  }
  async answerQuestion(request: ImQuestionRequest, answers: ImQuestionAnswerItem[]) {
    this.answerCalls.push({ request, answers })
    return this.answerResult
  }
  async cancelQuestion(request: ImQuestionRequest) {
    this.cancelCalls.push(request)
  }
}

/** Test double for a channel adapter: captures outbound text. */
class FakeAdapter implements ImChannelAdapter {
  readonly type = 'qq' as const
  sent: string[] = []
  failed: string[] = []
  connect(_config: ImChannelConfig, _gateway: ImGatewayContext) {
    return Promise.resolve()
  }
  disconnect() {}
  sendText(_conversationId: string, text: string) {
    this.sent.push(text)
    return Promise.resolve()
  }
  beginStream(): ImOutboundStream {
    return {
      streamText: () => {},
      end: () => {},
      fail: (error: string) => {
        this.failed.push(error)
      },
    }
  }
  getStatus(): ImChannelStatus {
    return { type: 'qq', id: 'qq1', name: 'QQ', enabled: true, connected: true }
  }
}

function inbound(text: string): ImInboundMessage {
  return {
    channel: 'qq',
    channelId: 'qq1',
    conversationId: 'user-1',
    senderId: 'user-1',
    senderName: 'user-1',
    text,
  }
}

async function makeGateway(harness: FakeHarness, adapter = new FakeAdapter()) {
  const gateway = new ImGateway(
    () => ({
      channels: [{ id: 'qq1', type: 'qq', name: 'QQ', enabled: true, config: {} }],
    }),
    harness,
  )
  gateway.register('qq', () => adapter)
  await gateway.start()
  return { gateway, adapter }
}

/** Wait until the adapter has sent a message containing `needle`. */
async function waitForSent(adapter: FakeAdapter, needle: string) {
  await vi.waitFor(
    () => {
      expect(adapter.sent.some((s) => s.includes(needle))).toBe(true)
    },
    { timeout: 2000 },
  )
}

afterEach(() => {
  vi.useRealTimers()
})

describe('parseWorkdirTask', () => {
  it('pins a cwd when the message starts with 在 <目录> 执行 <任务>', () => {
    const dir = mkdtempSync(join(tmpdir(), 'im-gw-'))
    try {
      const { cwd, task } = parseWorkdirTask(`在 ${dir} 执行 修复 README 里的错别字`)
      expect(cwd).toBe(dir)
      expect(task).toBe('修复 README 里的错别字')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('supports synonym verbs (运行 / 帮我做)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'im-gw-'))
    try {
      expect(parseWorkdirTask(`在 ${dir} 运行 测试`).cwd).toBe(dir)
      expect(parseWorkdirTask(`在 ${dir} 帮我做 清理缓存`).cwd).toBe(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('treats an invalid directory as a plain message', () => {
    const { cwd, task } = parseWorkdirTask('在 C:\\definitely\\not\\here 执行 修复')
    expect(cwd).toBeUndefined()
    expect(task).toBe('在 C:\\definitely\\not\\here 执行 修复')
  })

  it('treats a message without the prefix as a plain task', () => {
    const { cwd, task } = parseWorkdirTask('帮我看看这个项目的结构')
    expect(cwd).toBeUndefined()
    expect(task).toBe('帮我看看这个项目的结构')
  })

  it('strips surrounding quotes from the path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'im-gw-'))
    try {
      const { cwd } = parseWorkdirTask(`在 "${dir}" 执行 构建`)
      expect(cwd).toBe(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('resolveWorkdir', () => {
  it('returns undefined for empty input', () => {
    expect(resolveWorkdir('')).toBeUndefined()
    expect(resolveWorkdir('   ')).toBeUndefined()
  })
  it('returns undefined for a non-directory path', () => {
    expect(resolveWorkdir('C:\\no\\such\\dir\\anywhere')).toBeUndefined()
  })
  it('resolves an existing directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'im-gw-'))
    try {
      expect(resolveWorkdir(dir)).toBe(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('parseOptionIndices', () => {
  it('parses a single selection', () => {
    expect(parseOptionIndices('2', 3, false)).toEqual([1])
    expect(parseOptionIndices('3', 3, false)).toEqual([2])
  })
  it('parses multi-select with comma / ideographic separators', () => {
    expect(parseOptionIndices('1,3', 3, true)).toEqual([0, 2])
    expect(parseOptionIndices('1，3', 3, true)).toEqual([0, 2])
    expect(parseOptionIndices('2 3', 3, true)).toEqual([1, 2])
  })
  it('rejects out-of-range, duplicate, and non-numeric input', () => {
    expect(parseOptionIndices('0', 3, false)).toBeUndefined()
    expect(parseOptionIndices('4', 3, false)).toBeUndefined()
    expect(parseOptionIndices('1,1', 3, true)).toBeUndefined()
    expect(parseOptionIndices('abc', 3, false)).toBeUndefined()
    expect(parseOptionIndices('', 3, false)).toBeUndefined()
  })
  it('rejects multi picks for single-select questions', () => {
    expect(parseOptionIndices('1,2', 3, false)).toBeUndefined()
  })
})

describe('ImGateway interactive questions', () => {
  it('forwards a question with numbered options and submits the label answer', async () => {
    const harness = new FakeHarness()
    harness.questions = [
      {
        id: 'q1',
        question: '要继续吗？',
        options: [{ label: '继续' }, { label: '停止' }],
      },
    ]
    const { gateway, adapter } = await makeGateway(harness)

    const first = gateway.handleInbound(inbound('请处理这个任务'))
    await waitForSent(adapter, '1. 继续')

    await gateway.handleInbound(inbound('2'))
    await first

    expect(harness.answerCalls).toHaveLength(1)
    expect(harness.answerCalls[0]!.answers).toEqual([{ id: 'q1', selected: ['停止'] }])
    expect(harness.answerCalls[0]!.request.rpcId).toBe('q-rpc-1')
  })

  it('asks multiple questions one at a time and submits all answers in order', async () => {
    const harness = new FakeHarness()
    harness.questions = [
      { id: 'a', question: '选择 A？', options: [{ label: 'A1' }, { label: 'A2' }] },
      { id: 'b', question: '选择 B？', options: [{ label: 'B1' }, { label: 'B2' }] },
    ]
    const { gateway, adapter } = await makeGateway(harness)

    const first = gateway.handleInbound(inbound('任务'))
    await waitForSent(adapter, '选择 A？')
    await gateway.handleInbound(inbound('1'))
    await waitForSent(adapter, '选择 B？')
    await gateway.handleInbound(inbound('2'))
    await first

    expect(harness.answerCalls).toHaveLength(1)
    expect(harness.answerCalls[0]!.answers).toEqual([
      { id: 'a', selected: ['A1'] },
      { id: 'b', selected: ['B2'] },
    ])
  })

  it('collects free text for a question without options', async () => {
    const harness = new FakeHarness()
    harness.questions = [{ id: 'q1', question: '请描述你的需求' }]
    const { gateway, adapter } = await makeGateway(harness)

    const first = gateway.handleInbound(inbound('任务'))
    await waitForSent(adapter, '请直接回复你的答案')
    await gateway.handleInbound(inbound('我想要详细日志'))
    await first

    expect(harness.answerCalls[0]!.answers).toEqual([
      { id: 'q1', selected: [], custom: '我想要详细日志' },
    ])
  })

  it('re-prompts on an invalid option number', async () => {
    const harness = new FakeHarness()
    harness.questions = [
      { id: 'q1', question: '选哪个？', options: [{ label: '甲' }, { label: '乙' }] },
    ]
    const { gateway, adapter } = await makeGateway(harness)

    const first = gateway.handleInbound(inbound('任务'))
    await waitForSent(adapter, '选哪个？')
    await gateway.handleInbound(inbound('9'))
    await waitForSent(adapter, '请回复选项编号')
    await gateway.handleInbound(inbound('2'))
    await first

    expect(harness.answerCalls).toHaveLength(1)
    expect(harness.answerCalls[0]!.answers).toEqual([{ id: 'q1', selected: ['乙'] }])
  })

  it('cancels the question when the user replies 取消', async () => {
    const harness = new FakeHarness()
    harness.questions = [{ id: 'q1', question: '要批准吗？', options: [{ label: '是' }] }]
    const { gateway, adapter } = await makeGateway(harness)

    const first = gateway.handleInbound(inbound('任务'))
    await waitForSent(adapter, '要批准吗？')
    await gateway.handleInbound(inbound('取消'))
    await first

    expect(harness.cancelCalls).toHaveLength(1)
    expect(harness.cancelCalls[0]!.rpcId).toBe('q-rpc-1')
    expect(harness.answerCalls).toHaveLength(0)
  })

  it('falls back to the first option on timeout instead of stalling', async () => {
    vi.useFakeTimers()
    const harness = new FakeHarness()
    harness.questions = [
      { id: 'q1', question: '继续？', options: [{ label: '继续' }, { label: '停止' }] },
    ]
    const { gateway, adapter } = await makeGateway(harness)

    const first = gateway.handleInbound(inbound('任务'))
    // Flush microtasks so the question is sent, then advance past the timeout.
    await vi.advanceTimersByTimeAsync(0)
    expect(adapter.sent.some((s) => s.includes('继续？'))).toBe(true)
    await vi.advanceTimersByTimeAsync(180_000)
    await first

    expect(harness.answerCalls).toHaveLength(1)
    expect(harness.answerCalls[0]!.answers).toEqual([{ id: 'q1', selected: ['继续'] }])
    expect(adapter.sent.some((s) => s.includes('等待超时'))).toBe(true)
  })

  it('treats the next inbound message as a new task once the ask settled', async () => {
    const harness = new FakeHarness()
    harness.questions = [{ id: 'q1', question: 'OK？', options: [{ label: '是' }, { label: '否' }] }]
    const { gateway, adapter } = await makeGateway(harness)

    const first = gateway.handleInbound(inbound('任务'))
    await waitForSent(adapter, 'OK？')
    await gateway.handleInbound(inbound('1'))
    await first

    expect(harness.answerCalls).toHaveLength(1)

    // 提问结束后，后续消息作为普通任务走正常 prompt。
    harness.questions = []
    await gateway.handleInbound(inbound('再来一个'))
    expect(harness.promptCalls).toHaveLength(2)
    expect(harness.promptCalls[1]!.text).toBe('再来一个')
  })
})

describe('ImGateway workdir dispatch', () => {
  it('creates a session bound to the pinned directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'im-gw-'))
    try {
      const harness = new FakeHarness()
      const { gateway } = await makeGateway(harness)

      await gateway.handleInbound(inbound(`在 ${dir} 执行 跑一下测试`))

      expect(harness.promptCalls).toHaveLength(1)
      expect(harness.promptCalls[0]!.text).toBe('跑一下测试')
      expect(harness.createCalls.at(-1)!.cwd).toBe(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('creates a session without cwd for plain messages', async () => {
    const harness = new FakeHarness()
    const { gateway } = await makeGateway(harness)

    await gateway.handleInbound(inbound('介绍一下你自己'))

    expect(harness.promptCalls).toHaveLength(1)
    expect(harness.createCalls.at(-1)!).toEqual({})
  })
})
