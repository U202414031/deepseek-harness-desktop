/**
 * 全局防崩网：接管 Node 进程里「未捕获的 rejection / 异常」的处理器。
 *
 * 背景：本仓库 `@deepseek-ai/dsh-app-boot` 的 `installFailLoud` 在整个进程生命周期
 * 注册了 `process.on('unhandledRejection', handler)`，任何未被 catch 的 rejection 都会
 * 直接 `exit(1)`（连诊断日志都不落盘）。第三方库（如 ws / 官方 SDK / 旧 icqq）内部
 * 可能有若干 fire-and-forget 的异步调用，一旦出错极易冒出未捕获 rejection 把桌面端
 * 整个拖死。
 *
 * 做法：把已注册（含 boot 的）与之后新增的 `unhandledRejection` 处理器全部收进 `captured`，
 * 改由本过滤器接管——凡是 IM 网关相关的（QQ / 飞书 / 企业微信），直接吞掉并记日志，
 * 绝不退出；其它则与原来一样交给原始处理器（保留 boot 对真实致命错误的退出行为）。
 * 同时兜底 `uncaughtException`。
 *
 * 该模块被各通道适配器（QQ / 飞书 / 微信）共享，任意一个通道 connect 时都会安装，
 * 幂等（进程内只安装一次）。
 */

let crashGuardInstalled = false

/** 判断某个错误是否来自 IM 网关相关调用栈（含第三方 IM 库与官方域名）。 */
function isImRelated(err: unknown): boolean {
  const s = err instanceof Error ? err.stack ?? err.message : String(err ?? '')
  return /bot-node-sdk|resty-client|tencent-connect|im-gateway|icqq|oicq|sgroup\.qq\.com|bots\.qq\.com|open\.feishu\.cn|qyapi\.weixin\.qq\.com|work\.weixin\.qq\.com/i.test(
    s,
  )
}

/** 安装防崩网（幂等）。尽力而为：任何失败都不影响主流程。 */
export function installImGatewayCrashGuard(): void {
  if (crashGuardInstalled) return
  crashGuardInstalled = true
  try {
    const proc = process as any
    const captured: Array<(e: unknown) => void> = []
    const forward = (err: unknown) => {
      for (const h of captured) {
        try {
          h(err)
        } catch {
          /* 忽略处理器自身的异常 */
        }
      }
    }
    const filter = (err: unknown) => {
      if (isImRelated(err)) {
        console.error(
          '[im-gateway] 已吞掉未捕获的 rejection（不影响桌面端）:',
          err instanceof Error ? err.message : String(err),
        )
        return
      }
      forward(err)
    }
    const existing = (typeof proc.listeners === 'function' ? proc.listeners('unhandledRejection') : []) as Array<(e: unknown) => void>
    for (const h of existing) captured.push(h)
    if (typeof proc.removeAllListeners === 'function') proc.removeAllListeners('unhandledRejection')
    if (typeof proc.on === 'function') proc.on('unhandledRejection', filter)
    const realOn = typeof proc.on === 'function' ? proc.on.bind(proc) : undefined
    if (realOn) {
      proc.on = function (this: unknown, event: string, handler: any, ...rest: any[]) {
        if (event === 'unhandledRejection' && typeof handler === 'function') {
          captured.push(handler)
          return realOn.call(proc, event, filter, ...rest)
        }
        return realOn.call(proc, event, handler, ...rest)
      }
    }
    const realAdd = typeof proc.addListener === 'function' ? proc.addListener.bind(proc) : undefined
    if (realAdd) {
      proc.addListener = function (this: unknown, event: string, handler: any, ...rest: any[]) {
        if (event === 'unhandledRejection' && typeof handler === 'function') {
          captured.push(handler)
          return realAdd.call(proc, event, filter, ...rest)
        }
        return realAdd.call(proc, event, handler, ...rest)
      }
    }
    const existingUc = (typeof proc.listeners === 'function' ? proc.listeners('uncaughtException') : []) as Array<(e: unknown) => void>
    const capturedUc = [...existingUc]
    if (typeof proc.removeAllListeners === 'function') proc.removeAllListeners('uncaughtException')
    if (typeof proc.on === 'function') {
      proc.on('uncaughtException', (err: unknown) => {
        if (isImRelated(err)) {
          console.error(
            '[im-gateway] 已吞掉未捕获异常（不影响桌面端）:',
            err instanceof Error ? err.message : String(err),
          )
          return
        }
        for (const h of capturedUc) {
          try {
            h(err)
          } catch {
            /* ignore */
          }
        }
        if (capturedUc.length === 0) {
          console.error(err)
          if (typeof proc.exit === 'function') proc.exit(1)
        }
      })
    }
  } catch {
    /* 尽力而为 */
  }
}
