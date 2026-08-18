/**
 * Compile-time shim for the `vscode` module and the few Node builtins this
 * extension touches. At runtime code-server injects the real `vscode`
 * implementation and Node provides the builtins; this only lets `tsc` type-check
 * the extension offline (no @types/vscode / @types/node install required). It
 * declares only the surface this extension uses.
 */

// Minimal fetch declaration (code-server's extension host runs on a modern Node
// that provides a global fetch; we only need the bits this extension uses).
declare function fetch(
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number }>

declare function setTimeout(callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]): unknown
declare function clearTimeout(timeoutId: unknown): void

declare const process: { env: Record<string, string | undefined> }

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: string): string
  export function writeFileSync(path: string, data: string, encoding?: string): void
  export function unlinkSync(path: string): void
}

declare module 'node:os' {
  export function tmpdir(): string
  export function homedir(): string
}

declare module 'node:path' {
  export function join(...parts: string[]): string
}

declare module 'vscode' {
  export interface Disposable {
    dispose(): void
  }
  export interface Uri {
    readonly fsPath: string
    readonly scheme: string
    readonly path: string
  }
  export namespace Uri {
    export function file(path: string): Uri
  }
  export interface Range {
    readonly start: { line: number; character: number }
    readonly end: { line: number; character: number }
  }
  export interface Selection extends Range {
    readonly isEmpty: boolean
  }
  export interface TextDocument {
    readonly uri: Uri
    readonly fileName: string
    readonly languageId: string
    getText(range?: Range): string
  }
  export interface TextEditor {
    readonly document: TextDocument
    readonly selection: Selection
  }
  export interface FileSystemWatcher extends Disposable {
    onDidChange: Event<Uri>
    onDidCreate: Event<Uri>
    onDidDelete: Event<Uri>
  }
  export interface Event<T> {
    (listener: (e: T) => void): Disposable
  }
  export namespace workspace {
    export function createFileSystemWatcher(globPattern: string): FileSystemWatcher
  }
  export namespace commands {
    export function registerCommand(command: string, callback: (...args: unknown[]) => unknown): Disposable
    export function executeCommand<T = unknown>(command: string, ...rest: unknown[]): Thenable<T>
  }
  export namespace window {
    export const activeTextEditor: TextEditor | undefined
    export function showErrorMessage(message: string): Thenable<undefined>
    export function showInformationMessage(message: string): Thenable<undefined>
  }
  export interface ExtensionContext {
    readonly extensionPath: string
    subscriptions: Disposable[]
  }
  export function activate(context: ExtensionContext): void
  export function deactivate(): void
}
