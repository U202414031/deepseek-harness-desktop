import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vscode from 'vscode'

/**
 * DSH IDE Bridge — a VS Code extension (works in the native editor and in
 * code-server) that forwards the current editor selection into the local DSH
 * agent so it can explain or modify the selected code. The agent runs in the
 * same desktop process and edits the shared disk, so a "modify" result shows up
 * in the editor automatically; this extension additionally opens an inline diff
 * (original vs current) once the file changes.
 *
 * The desktop host writes the bridge endpoint (baseUrl + askPath) to two
 * places: `<profileDir>/.dsh-ide-bridge.json` (code-server-style deployment,
 * two levels above this extension's install folder) and the user-level fixed
 * path `~/.dsh-desktop/ide-bridge.json` (native VS Code deployment). An env
 * override `DSH_IDE_BRIDGE_PATH` wins first.
 */

interface BridgeConfig {
  baseUrl: string
  askPath: string
}

function readBridgeConfig(context: vscode.ExtensionContext): BridgeConfig | undefined {
  const candidates = [
    process.env.DSH_IDE_BRIDGE_PATH ?? '',
    path.join(context.extensionPath, '..', '..', '.dsh-ide-bridge.json'),
    path.join(os.homedir(), '.dsh-desktop', 'ide-bridge.json'),
  ]
  for (const candidate of candidates) {
    if (candidate.length === 0) continue
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8')) as BridgeConfig
      if (typeof parsed.baseUrl === 'string' && typeof parsed.askPath === 'string') return parsed
    } catch {
      /* try the next candidate */
    }
  }
  return undefined
}

async function postToAgent(
  config: BridgeConfig,
  payload: { file: string; selection: string; language: string; mode: 'explain' | 'modify'; instruction?: string | null },
): Promise<number> {
  const res = await fetch(`${config.baseUrl}${config.askPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return res.status
}

function watchForEditAndShowDiff(file: string, originalText: string, context: vscode.ExtensionContext): void {
  const originalPath = path.join(os.tmpdir(), `dsh-ide-orig-${Date.now()}.txt`)
  fs.writeFileSync(originalPath, originalText, 'utf8')
  const originalUri = vscode.Uri.file(originalPath)
  const modifiedUri = vscode.Uri.file(file)

  let timer: ReturnType<typeof setTimeout> | undefined
  const watcher = vscode.workspace.createFileSystemWatcher('**/*')
  const disposable = watcher.onDidChange((uri) => {
    if (uri.fsPath !== file) return
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      void vscode.commands.executeCommand('vscode.diff', originalUri, modifiedUri, 'AI 修改对比 — 原始 vs 当前')
      disposable.dispose()
      watcher.dispose()
      try { fs.unlinkSync(originalPath) } catch { /* ignore */ }
    }, 400)
  })
  context.subscriptions.push(watcher)
}

async function ask(mode: 'explain' | 'modify'): Promise<void> {
  const editor = vscode.window.activeTextEditor
  if (editor === undefined) {
    void vscode.window.showErrorMessage('请先打开一个文件并选中一段代码。')
    return
  }
  const selection = editor.selection
  if (selection.isEmpty) {
    void vscode.window.showErrorMessage('请先选中一段代码再发起请求。')
    return
  }
  const selectedText = editor.document.getText(selection)
  if (selectedText.trim().length === 0) {
    void vscode.window.showErrorMessage('选中内容为空。')
    return
  }
  const file = editor.document.uri.fsPath
  const language = editor.document.languageId

  const config = readBridgeConfig(globalContext)
  if (config === undefined) {
    void vscode.window.showErrorMessage('未找到桌面端桥接配置，请确认桌面端已启动并打开过 IDE 面板。')
    return
  }

  try {
    const status = await postToAgent(config, { file, selection: selectedText, language, mode })
    if (status === 200) {
      if (mode === 'modify') {
        watchForEditAndShowDiff(file, editor.document.getText(), globalContext)
        void vscode.window.showInformationMessage('已发送给 AI，文件改动后将在内联 diff 中展示。')
      } else {
        void vscode.window.showInformationMessage('已发送给 AI，解释将出现在左侧对话中。')
      }
    } else if (status === 409) {
      void vscode.window.showErrorMessage('请先在左侧发起一轮 AI 对话以创建会话。')
    } else {
      void vscode.window.showErrorMessage(`发送给 AI 失败（HTTP ${status}）。`)
    }
  } catch (err) {
    void vscode.window.showErrorMessage(`发送给 AI 失败：${err instanceof Error ? err.message : String(err)}`)
  }
}

let globalContext: vscode.ExtensionContext

export function activate(context: vscode.ExtensionContext): void {
  globalContext = context
  context.subscriptions.push(
    vscode.commands.registerCommand('dshIdeBridge.askExplain', () => void ask('explain')),
    vscode.commands.registerCommand('dshIdeBridge.askModify', () => void ask('modify')),
  )
}

export function deactivate(): void {
  /* nothing to clean up; watchers are untracked but short-lived */
}
