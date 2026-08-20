/**
 * Contract for the built-in lightweight IDE (file tree + CodeMirror editor).
 *
 * The panel talks to the Host over three loopback routes:
 *  - `DESKTOP_IDE_TREE_PATH` — list workspace roots (no query) or the entries
 *    of one directory (`?path=<abs>`);
 *  - `DESKTOP_IDE_FILE_PATH` — GET reads a file's content, POST writes it back;
 *  - the existing `DESKTOP_IDE_ASK_PATH` bridge forwards an editor selection
 *    ("explain"/"modify") into the live agent.
 *
 * Every path is validated by the Host against the allowed roots (the active
 * profile directory plus the user-approved `allowedDirs`); anything outside
 * them is rejected with 403, so the panel can never browse the whole disk.
 */

/** Same-origin endpoint for reading workspace roots / one directory listing. */
export const DESKTOP_IDE_TREE_PATH = '/_dsh/desktop/ide/tree'

/** Same-origin endpoint for reading (GET) and writing (POST) a file. */
export const DESKTOP_IDE_FILE_PATH = '/_dsh/desktop/ide/file'

/**
 * Same-origin endpoint that registers the directory of the currently opened
 * file as a Host workspace, so a new conversation starts in that directory
 * instead of the DSH home. Body: `{ dir: string }`.
 */
export const DESKTOP_IDE_WORKSPACE_PATH = '/_dsh/desktop/ide/workspace'

/** Body of a {@link DESKTOP_IDE_WORKSPACE_PATH} POST request. */
export interface DesktopIdeWorkspaceRequest {
  /** Absolute directory to register as the workspace for new conversations. */
  dir: string
}

/** One entry of a directory listing. */
export interface DesktopIdeTreeEntry {
  /** Entry base name (no path separators). */
  name: string
  /** Absolute path of the entry. */
  path: string
  /** Whether the entry is a directory or a regular file. */
  type: 'file' | 'dir'
}

/** Response of {@link DESKTOP_IDE_TREE_PATH}. */
export interface DesktopIdeTreeResponse {
  /** Workspace roots, present when the request had no `path` query. */
  roots?: Array<{ name: string; path: string }>
  /** Directory entries, present when the request had a `path` query. */
  entries?: DesktopIdeTreeEntry[]
}

/** Body of a {@link DESKTOP_IDE_FILE_PATH} POST request. */
export interface DesktopIdeFileWrite {
  /** Absolute path of the file to write (must stay inside the allowed roots). */
  path: string
  /** Full new content, UTF-8. */
  content: string
}

/** Response of a {@link DESKTOP_IDE_FILE_PATH} GET request. */
export interface DesktopIdeFileResponse {
  /** Absolute path of the file that was read. */
  path: string
  /** File content, UTF-8 (binary files are rejected). */
  content: string
  /** Editor language id derived from the file extension. */
  language: string
  /** File size in bytes. */
  size: number
}

const EXTENSION_LANGUAGES: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python', pyw: 'python',
  json: 'json', jsonc: 'json',
  html: 'html', htm: 'html', vue: 'html',
  css: 'css', scss: 'scss', less: 'less',
  md: 'markdown', markdown: 'markdown',
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp',
  java: 'java',
  sh: 'shell', bash: 'shell', zsh: 'shell',
  ps1: 'powershell', psd1: 'powershell', psm1: 'powershell',
  yml: 'yaml', yaml: 'yaml',
  xml: 'xml', svg: 'xml', xhtml: 'xml',
  toml: 'ini', ini: 'ini', conf: 'ini',
  txt: 'plaintext', log: 'plaintext',
}

/**
 * Derive an editor language id from a file path (by extension). Unknown
 * extensions map to `plaintext`.
 */
export function languageFromPath(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? ''
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return 'plaintext'
  const ext = name.slice(dot + 1).toLowerCase()
  return EXTENSION_LANGUAGES[ext] ?? 'plaintext'
}
