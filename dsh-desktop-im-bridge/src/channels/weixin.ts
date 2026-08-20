/**
 * 微信通道适配器（企业微信 / WeCom 自建应用）。
 *
 * 个人微信没有官方机器人 API；这里用企业微信（WeCom）自建应用实现「手机微信 ↔
 * DeepSeek」互通：
 *
 * 出站：corpid/corpsecret 换取 access_token，调用 cgi-bin/message/send 给成员下发文本。
 *
 * 入站：企业微信官方只有「接收消息」回调一种入站方式（无 WebSocket 长连接）。
 * 本适配器在本机起一个 HTTP 回调服务（默认 http://127.0.0.1:9909/wecom/callback），
 * 实现官方回调协议：
 *   - GET：URL 校验（msg_signature 签名校验 + echostr AES 解密回显）；
 *   - POST：消息推送（4 参数签名校验 + Encrypt AES 解密 + XML 解析），
 *     文本消息转发给 DeepSeek，回复走 sendText 原路返回（企业微信要求回调 5 秒内
 *     返回空串或 success，所以回调响应立即返回，处理异步进行）。
 * 需要用 cpolar / ngrok / frp 等内网穿透把该端口映射为公网 HTTPS 地址，再填入
 * 企业微信后台「接收消息」配置（同时填 Token 与 EncodingAESKey）。
 */

import { createDecipheriv, createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type {
  ImChannelAdapter,
  ImChannelConfig,
  ImChannelStatus,
  ImGatewayContext,
  ImOutboundStream,
} from '../types.ts'
import { installImGatewayCrashGuard } from '../crash-guard.ts'

const TOKEN_URL = 'https://qyapi.weixin.qq.com/cgi-bin/gettoken'
const SEND_URL = 'https://qyapi.weixin.qq.com/cgi-bin/message/send'
/** 回调服务默认端口与路径（配合内网穿透使用）。 */
const DEFAULT_CALLBACK_PORT = 9909
const CALLBACK_PATH = '/wecom/callback'

/**
 * 企业微信回调签名：对 `[token, timestamp, nonce(, encrypt)]` 排序后拼接做 SHA1。
 * GET（URL 校验）不含 encrypt；POST（消息推送）按官方要求包含 encrypt。
 */
export function wecomSignature(token: string, timestamp: string, nonce: string, encrypt?: string): string {
  const parts = [token, timestamp, nonce]
  if (encrypt) parts.push(encrypt)
  const joined = [...parts].sort().join('')
  return createHash('sha1').update(joined, 'utf8').digest('hex')
}

/**
 * 企业微信回调密文 AES-256-CBC 解密（PKCS7）。
 * 密钥 = Base64(EncodingAESKey + '=')（32 字节），IV = 密钥前 16 字节。
 * 明文结构：16 字节随机串 + 4 字节大端消息长度 + 消息体 + 接收方 id。
 */
export function wecomDecrypt(encrypted: string, encodingAESKey: string): string {
  const key = Buffer.from(`${encodingAESKey}=`, 'base64')
  if (key.length !== 32) throw new Error('EncodingAESKey 无效（应为 43 位）')
  const iv = key.subarray(0, 16)
  const decipher = createDecipheriv('aes-256-cbc', key, iv)
  const plain = Buffer.concat([decipher.update(encrypted, 'base64'), decipher.final()])
  if (plain.length < 20) throw new Error('解密后的消息长度不合法')
  const len = plain.readUInt32BE(16)
  if (len <= 0 || 20 + len > plain.length) throw new Error('解密后的消息长度越界')
  return plain.subarray(20, 20 + len).toString('utf8')
}

/** 从 XML 中取某个标签的文本（兼容 CDATA 与普通文本）。 */
function xmlText(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))</${tag}>`)
  const m = re.exec(xml)
  if (!m) return undefined
  return (m[1] ?? m[2] ?? '').trim()
}

/** 从解密后的回调 XML 中提取文本消息（非文本消息返回 undefined）。 */
export function parseWecomTextMessage(
  xml: string,
): { toUserName: string; from: string; text: string; msgId?: string } | undefined {
  const msgType = xmlText(xml, 'MsgType')
  if (msgType !== 'text') return undefined
  const toUserName = xmlText(xml, 'ToUserName') ?? ''
  const from = xmlText(xml, 'FromUserName') ?? ''
  const text = xmlText(xml, 'Content') ?? ''
  if (!toUserName || !from || !text) return undefined
  const msgId = xmlText(xml, 'MsgId')
  const out: { toUserName: string; from: string; text: string; msgId?: string } = {
    toUserName,
    from,
    text,
  }
  if (msgId !== undefined) out.msgId = msgId
  return out
}

/** 读取请求体（限制大小，防内存撑爆）。 */
function readBody(req: IncomingMessage, limit = 1_000_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    let data = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      size += chunk.length
      if (size > limit) {
        req.destroy()
        reject(new Error('request body exceeded size limit'))
        return
      }
      data += chunk
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

/**
 * 微信（企业微信）通道适配器：出站走 message/send，入站走本机回调服务。
 * 把「手机企业微信里与应用对话」变成与 DeepSeek 对话的窗口。
 */
export class WeixinChannel implements ImChannelAdapter {
  readonly type: 'weixin' = 'weixin'
  private connected = false
  private config: ImChannelConfig | undefined
  private gateway: ImGatewayContext | undefined
  private token: string | undefined
  private tokenExpireAt = 0
  /** 回调服务（入站）。 */
  private server: Server | undefined
  private serverPort = 0
  private serverError = ''
  /** 连接状态说明（展示在 UI）。 */
  private loginTip = ''

  async connect(config: ImChannelConfig, gateway: ImGatewayContext): Promise<void> {
    this.config = config
    this.gateway = gateway
    // 全局防崩网：确保网关相关未捕获 rejection 绝不杀掉桌面端。
    installImGatewayCrashGuard()

    const corpId = config.config.corpId?.trim()
    const corpSecret = config.config.corpSecret?.trim()
    const agentId = config.config.agentId?.trim()
    if (!corpId || !corpSecret || !agentId) {
      this.loginTip = '需要 corpId、corpSecret、agentId（企业微信自建应用）'
      throw new Error('微信(企业微信)通道需要 corpId、corpSecret、agentId')
    }
    await this.ensureToken()
    this.connected = true
    this.startCallbackServer()
    console.log('[im-gateway:weixin] connect() 完成（出站可用）')
  }

  disconnect(): void {
    this.connected = false
    this.token = undefined
    if (this.server) {
      try {
        this.server.close()
      } catch {
        /* ignore */
      }
      this.server = undefined
    }
    this.serverPort = 0
    this.serverError = ''
  }

  /** 获取 access_token（带过期缓存）。 */
  private async ensureToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpireAt - 60_000) return this.token
    if (!this.config) throw new Error('微信通道未初始化')
    const url = `${TOKEN_URL}?corpid=${encodeURIComponent(this.config.config.corpId ?? '')}&corpsecret=${encodeURIComponent(this.config.config.corpSecret ?? '')}`
    const res = await fetch(url)
    const data = (await res.json()) as { errcode?: number; errmsg?: string; access_token?: string; expires_in?: number }
    if (data.errcode !== 0 || !data.access_token) {
      throw new Error(`微信获取 token 失败: ${data.errmsg ?? data.errcode ?? 'unknown'}`)
    }
    this.token = data.access_token
    this.tokenExpireAt = Date.now() + (data.expires_in ?? 7200) * 1000
    return this.token
  }

  /** 若配置了回调 Token/EncodingAESKey，则启动本机回调服务（入站）。 */
  private startCallbackServer(): void {
    const cfg = this.config
    if (!cfg) return
    const token = cfg.config.token?.trim()
    const aesKey = cfg.config.encodingAESKey?.trim()
    if (!token || !aesKey) {
      this.loginTip = '已连接（仅出站；填回调 Token / EncodingAESKey 可开启入站）'
      return
    }
    const rawPort = cfg.config.callbackPort?.trim()
    const port = rawPort && rawPort.length > 0 ? Number(rawPort) : DEFAULT_CALLBACK_PORT
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      this.serverError = `回调端口无效：${rawPort}（应为 1-65535）`
      return
    }
    try {
      const server = createServer((req, res) => {
        void this.handleCallback(req, res, token, aesKey).catch((e: unknown) => {
          console.error('[im-gateway:weixin] 处理回调异常（已忽略）:', e)
          res.statusCode = 500
          res.end('error')
        })
      })
      server.on('error', (e: Error) => {
        this.serverError = `回调服务启动失败：${e.message}`
        console.error('[im-gateway:weixin] 回调服务错误（已忽略）:', e)
      })
      server.listen(port, '127.0.0.1', () => {
        this.serverPort = port
        this.serverError = ''
        console.log(`[im-gateway:weixin] 回调服务已监听 http://127.0.0.1:${port}${CALLBACK_PATH}`)
      })
      this.server = server
    } catch (e) {
      this.serverError = `回调服务启动失败：${e instanceof Error ? e.message : String(e)}`
    }
  }

  /** 处理企业微信回调：GET=URL 校验，POST=消息推送。 */
  private async handleCallback(
    req: IncomingMessage,
    res: ServerResponse,
    token: string,
    aesKey: string,
  ): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== CALLBACK_PATH) {
      res.statusCode = 404
      res.end('not found')
      return
    }
    const timestamp = url.searchParams.get('timestamp') ?? ''
    const nonce = url.searchParams.get('nonce') ?? ''
    const signature = url.searchParams.get('msg_signature') ?? ''

    if (req.method === 'GET') {
      // URL 校验：验签通过后把解密后的 echostr 原样返回。
      const echostr = url.searchParams.get('echostr') ?? ''
      if (!echostr || wecomSignature(token, timestamp, nonce) !== signature) {
        res.statusCode = 403
        res.end('signature mismatch')
        return
      }
      let plain = ''
      try {
        plain = wecomDecrypt(echostr, aesKey)
      } catch (e) {
        console.error('[im-gateway:weixin] echostr 解密失败（已忽略）:', e)
        res.statusCode = 400
        res.end('decrypt failed')
        return
      }
      res.setHeader('content-type', 'text/plain')
      res.end(plain)
      return
    }

    if (req.method === 'POST') {
      const body = await readBody(req)
      const encrypt = xmlText(body, 'Encrypt') ?? ''
      if (!encrypt || wecomSignature(token, timestamp, nonce, encrypt) !== signature) {
        res.statusCode = 403
        res.end('signature mismatch')
        return
      }
      let plain = ''
      try {
        plain = wecomDecrypt(encrypt, aesKey)
      } catch (e) {
        console.error('[im-gateway:weixin] 消息解密失败（已忽略）:', e)
        res.statusCode = 400
        res.end('decrypt failed')
        return
      }
      const msg = parseWecomTextMessage(plain)
      // 校验接收方确实是本应用所属企业，避免串号。
      const corpId = this.config?.config.corpId?.trim() ?? ''
      if (msg && corpId && msg.toUserName !== corpId) {
        console.warn(`[im-gateway:weixin] 回调接收方 ${msg.toUserName} 与本应用企业 ${corpId} 不一致，已忽略`)
        res.setHeader('content-type', 'text/plain')
        res.end('success')
        return
      }
      if (msg && this.gateway && this.config) {
        // 立即响应（企业微信要求 5 秒内返回），处理异步进行，回复走 sendText。
        void this.gateway
          .handleInbound({
            channel: 'weixin',
            channelId: this.config.id,
            conversationId: msg.from,
            senderId: msg.from,
            senderName: msg.from,
            text: msg.text,
            raw: plain,
          })
          .catch((e: unknown) =>
            console.error('[im-gateway:weixin] 转发入站消息失败（已忽略）:', e),
          )
      }
      res.setHeader('content-type', 'text/plain')
      res.end('success')
      return
    }

    res.statusCode = 405
    res.end('method not allowed')
  }

  async sendText(conversationId: string, text: string): Promise<void> {
    const token = await this.ensureToken()
    if (!this.config) throw new Error('微信通道未初始化')
    const res = await fetch(`${SEND_URL}?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        touser: conversationId,
        msgtype: 'text',
        agentid: Number(this.config.config.agentId),
        text: { content: text },
      }),
    })
    const data = (await res.json()) as { errcode?: number; errmsg?: string }
    if (data.errcode !== 0) {
      throw new Error(`微信发送失败: ${data.errmsg ?? data.errcode ?? 'unknown'}`)
    }
  }

  beginStream(conversationId: string): ImOutboundStream {
    let buffer = ''
    return {
      streamText: (chunk: string) => {
        buffer += chunk
      },
      end: () => {
        if (buffer.length > 0) {
          void this.sendText(conversationId, buffer).catch((e) =>
            console.error('[im-gateway:weixin] 发送失败（已忽略）:', e),
          )
        }
      },
      fail: (error: string) => {
        void this.sendText(conversationId, `⚠️ ${error}`).catch((e) =>
          console.error('[im-gateway:weixin] 发送失败（已忽略）:', e),
        )
      },
    }
  }

  getStatus(): ImChannelStatus {
    const detail = this.connected
      ? this.serverPort > 0
        ? `已连接（出站可用 + 回调服务 http://127.0.0.1:${this.serverPort}${CALLBACK_PATH}，请在企业微信后台配置回调 URL 后即可接收消息）`
        : this.serverError.length > 0
          ? `已连接（仅出站；${this.serverError}）`
          : '已连接（仅出站；填回调 Token / EncodingAESKey 可开启入站）'
      : this.loginTip || '未连接（请填 CorpID/Secret/AgentId 后启用）'
    return {
      type: 'weixin',
      id: this.config?.id ?? 'weixin',
      name: this.config?.name ?? '微信',
      enabled: this.config?.enabled ?? false,
      connected: this.connected,
      detail,
    }
  }
}
