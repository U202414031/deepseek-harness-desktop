import { createCipheriv, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { extractFeishuTextEvent } from '../src/channels/feishu.ts'
import { parseWecomTextMessage, wecomDecrypt, wecomSignature } from '../src/channels/weixin.ts'

/** 企业微信官方示例 EncodingAESKey（43 位）。 */
const WECOM_KEY = 'jWmYm7qr5nMoAUwZRjGtBxmz3KA1tkAj3ykkR6q2B2C'
const WECOM_CORPID = 'wx5823bf96d3bd56c7'

/**
 * 按企业微信规范构造密文：16 字节随机 + 4 字节大端长度 + 消息 + 接收方 id，
 * AES-256-CBC（PKCS7）加密后 Base64。用于验证解密实现的回环正确性。
 */
function wecomEncrypt(msg: string, encodingAESKey: string, receiveId: string): string {
  const key = Buffer.from(`${encodingAESKey}=`, 'base64')
  const iv = key.subarray(0, 16)
  const random = randomBytes(16)
  const len = Buffer.alloc(4)
  len.writeUInt32BE(Buffer.byteLength(msg, 'utf8'))
  const plain = Buffer.concat([random, len, Buffer.from(msg, 'utf8'), Buffer.from(receiveId, 'utf8')])
  const cipher = createCipheriv('aes-256-cbc', key, iv)
  return Buffer.concat([cipher.update(plain), cipher.final()]).toString('base64')
}

describe('wecomSignature', () => {
  it('computes SHA1 over the sorted token/timestamp/nonce for URL verification', () => {
    expect(wecomSignature('QDG6eK', '1409659589', '1372623149')).toBe(
      '18226cd53555411b288635b09530458e71601197',
    )
  })

  it('includes the encrypt value in the signature for message push', () => {
    expect(wecomSignature('QDG6eK', '1409659589', '1372623149', 'abcdef1234567890')).toBe(
      '0352107bb08b9c8eb01e29d7746b3477ae74c01a',
    )
  })

  it('is order-independent across argument order (sorting is lexicographic)', () => {
    expect(wecomSignature('1409659589', 'QDG6eK', '1372623149')).toBe(
      '18226cd53555411b288635b09530458e71601197',
    )
  })
})

describe('wecomDecrypt', () => {
  it('round-trips a spec-built ciphertext back to the original message', () => {
    const xml = `<xml><ToUserName><![CDATA[${WECOM_CORPID}]]></ToUserName><FromUserName><![CDATA[zhangsan]]></FromUserName><CreateTime>1348831860</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[this is a test]]></Content><MsgId>1287364371278617959</MsgId></xml>`
    const encrypted = wecomEncrypt(xml, WECOM_KEY, WECOM_CORPID)
    expect(wecomDecrypt(encrypted, WECOM_KEY)).toBe(xml)
  })

  it('rejects an invalid EncodingAESKey', () => {
    expect(() => wecomDecrypt('aGVsbG8=', 'too-short')).toThrow(/EncodingAESKey/)
  })
})

describe('parseWecomTextMessage', () => {
  it('extracts a text message from the decrypted callback XML', () => {
    const xml = `<xml><ToUserName><![CDATA[${WECOM_CORPID}]]></ToUserName><FromUserName><![CDATA[zhangsan]]></FromUserName><CreateTime>1348831860</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[this is a test]]></Content><MsgId>1287364371278617959</MsgId><AgentID>1</AgentID></xml>`
    expect(parseWecomTextMessage(xml)).toEqual({
      toUserName: WECOM_CORPID,
      from: 'zhangsan',
      text: 'this is a test',
      msgId: '1287364371278617959',
    })
  })

  it('returns undefined for non-text messages', () => {
    const xml = `<xml><MsgType><![CDATA[image]]></MsgType><FromUserName><![CDATA[zhangsan]]></FromUserName><PicUrl><![CDATA[https://example.com/a.jpg]]></PicUrl></xml>`
    expect(parseWecomTextMessage(xml)).toBeUndefined()
  })

  it('returns undefined when the text content is empty', () => {
    const xml = `<xml><MsgType><![CDATA[text]]></MsgType><FromUserName><![CDATA[zhangsan]]></FromUserName><Content><![CDATA[]]></Content></xml>`
    expect(parseWecomTextMessage(xml)).toBeUndefined()
  })
})

describe('extractFeishuTextEvent', () => {
  it('extracts a p2p text message from an im.message.receive_v1 frame', () => {
    const frame = {
      schema: '2.0',
      header: {
        event_id: 'evt_1',
        event_type: 'im.message.receive_v1',
        app_id: 'cli_xxx',
        tenant_key: 't_xxx',
        create_time: '1700000000000',
      },
      event: {
        sender: {
          sender_id: { open_id: 'ou_abc', union_id: 'on_abc', user_id: 'u_abc' },
          sender_type: 'user',
          tenant_key: 't_xxx',
        },
        message: {
          message_id: 'om_123',
          chat_id: 'oc_456',
          chat_type: 'p2p',
          msg_type: 'text',
          content: '{"text":"你好，帮我看看这个项目"}',
          create_time: '1700000000000',
          mentions: [],
        },
      },
    }
    const result = extractFeishuTextEvent(frame)
    expect(result).toMatchObject({
      chatId: 'oc_456',
      senderId: 'ou_abc',
      text: '你好，帮我看看这个项目',
    })
    expect(result?.raw).toBe(frame.event)
  })

  it('extracts a group message when the bot is mentioned', () => {
    const frame = {
      schema: '2.0',
      header: { event_type: 'im.message.receive_v1', app_id: 'cli_xxx' },
      event: {
        sender: { sender_id: { open_id: 'ou_group' }, sender_type: 'user' },
        message: {
          message_id: 'om_g1',
          chat_id: 'oc_group',
          chat_type: 'group',
          msg_type: 'text',
          content: '{"text":"@机器人 总结一下"}',
          mentions: [{ key: '@_user_1', name: '机器人' }],
        },
      },
    }
    expect(extractFeishuTextEvent(frame)).toMatchObject({
      chatId: 'oc_group',
      senderId: 'ou_group',
      text: '@机器人 总结一下',
    })
  })

  it('skips group messages without a mention', () => {
    const frame = {
      schema: '2.0',
      header: { event_type: 'im.message.receive_v1' },
      event: {
        message: {
          chat_id: 'oc_group',
          chat_type: 'group',
          msg_type: 'text',
          content: '{"text":"普通群聊"}',
          mentions: [],
        },
      },
    }
    expect(extractFeishuTextEvent(frame)).toBeUndefined()
  })

  it('skips non-text messages', () => {
    const frame = {
      schema: '2.0',
      header: { event_type: 'im.message.receive_v1' },
      event: {
        message: {
          chat_id: 'oc_456',
          chat_type: 'p2p',
          msg_type: 'image',
          content: '{"image_key":"img_1"}',
          mentions: [],
        },
      },
    }
    expect(extractFeishuTextEvent(frame)).toBeUndefined()
  })

  it('skips keepalive and challenge frames', () => {
    expect(extractFeishuTextEvent({ type: 'challenge', challenge: 'abc', ws_id: 'ws_1' })).toBeUndefined()
    expect(extractFeishuTextEvent({ type: 'ping', ws_id: 'ws_1' })).toBeUndefined()
    expect(extractFeishuTextEvent({ type: 'pong', ws_id: 'ws_1' })).toBeUndefined()
  })

  it('returns undefined for malformed message content', () => {
    const frame = {
      schema: '2.0',
      header: { event_type: 'im.message.receive_v1' },
      event: {
        message: {
          chat_id: 'oc_456',
          chat_type: 'p2p',
          msg_type: 'text',
          content: 'not-json',
          mentions: [],
        },
      },
    }
    expect(extractFeishuTextEvent(frame)).toBeUndefined()
  })
})
