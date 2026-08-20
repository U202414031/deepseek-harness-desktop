/**
 * Fetch and unpack the openvscode-server release used by the embedded IDE.
 *
 * The embedded IDE (see `src/ide-server.ts`) resolves its runtime from
 * `tools/code-server/openvscode-server` (dev) or
 * `resources/code-server/openvscode-server` (packaged via `extraResources`).
 * This script downloads the matching GitHub release, verifies its SHA-256 when
 * the release ships a checksum sidecar, unpacks it into that folder, and
 * records the resolved version.
 *
 * Usage:
 *   node scripts/fetch-openvscode-server.mjs                       # latest release
 *   node scripts/fetch-openvscode-server.mjs --version v5.7.0      # pinned tag
 *   node scripts/fetch-openvscode-server.mjs --if-missing          # skip when present
 *   node scripts/fetch-openvscode-server.mjs --skip-on-error       # warn, exit 0
 *   node scripts/fetch-openvscode-server.mjs --archive C:\path\openvscode-server-v5.7.0-windows-x64.zip
 *                                                                  # unpack a local archive (offline)
 *   node scripts/fetch-openvscode-server.mjs --from-dir D:\openvscode-src
 *                                                                  # stage a local source build (offline)
 *
 * Environment:
 *   OPENVSCODE_SERVER_VERSION   version tag override (same as --version)
 *   DSH_OPENVSCODE_REPO         release source repo (default gitpod-io/openvscode-server;
 *                               point at your own repo when it publishes Windows builds)
 *   DSH_OPENVSCODE_PLATFORM     platform suffix override (e.g. windows-x64)
 *   DSH_GITHUB_TOKEN            GitHub token for higher API rate limits
 *   DSH_OPENVSCODE_MIRROR       mirror prefix for API/release URLs (e.g. a
 *                               gh-proxy style prefix for restricted networks)
 *   NODE_USE_ENV_PROXY=1        make Node fetch honor HTTPS_PROXY/HTTP_PROXY
 */

import { createHash } from 'node:crypto'
import { cpSync, createReadStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const targetDir = join(packageRoot, 'tools', 'code-server', 'openvscode-server')

/**
 * Release source. Defaults to gitpod's official repo; override with
 * `DSH_OPENVSCODE_REPO` (e.g. `your-name/openvscode-server`) when you publish
 * your own Windows build (see tools/code-server/openvscode.windows-build.yml).
 */
const repo = process.env.DSH_OPENVSCODE_REPO ?? 'gitpod-io/openvscode-server'

const argv = process.argv.slice(2)
const ifMissing = argv.includes('--if-missing')
const skipOnError = argv.includes('--skip-on-error')

/** Read the value of a `--name <value>` flag, or undefined when absent. */
function flagValue(name) {
  const index = argv.indexOf(name)
  return index !== -1 && index + 1 < argv.length ? argv[index + 1] : undefined
}

const versionFlag = flagValue('--version')
const archiveFlag = flagValue('--archive')
const fromDirFlag = flagValue('--from-dir')
const mirror = process.env.DSH_OPENVSCODE_MIRROR ?? ''

const apiBase = mirror !== ''
  ? `${mirror}https://api.github.com/repos/${repo}`
  : `https://api.github.com/repos/${repo}`
const downloadBase = mirror !== ''
  ? `${mirror}https://github.com/${repo}/releases/download`
  : `https://github.com/${repo}/releases/download`

const platformSuffixes = process.env.DSH_OPENVSCODE_PLATFORM !== undefined
  ? [process.env.DSH_OPENVSCODE_PLATFORM]
  : process.platform === 'win32'
    ? ['windows-x64']
    : process.platform === 'darwin'
      ? ['darwin-universal', 'darwin-arm64', 'darwin-x64']
      : ['linux-x64', 'linux-arm64']
const archiveExt = process.platform === 'win32' ? 'zip' : 'tar.gz'

/** Print a failure and, for network errors, actionable hints. */
function printFailure(message) {
  process.stderr.write(`fetch-openvscode-server: ${message}\n`)
  if (String(message).includes('fetch failed')) {
    process.stderr.write([
      '提示：无法连接 GitHub。可任选一种方式：',
      '  1) 镜像：$env:DSH_OPENVSCODE_MIRROR="https://gh-proxy.com/"; yarn ide:fetch',
      '  2) 本地代理：$env:NODE_USE_ENV_PROXY="1"; $env:HTTPS_PROXY="http://127.0.0.1:<端口>"; yarn ide:fetch',
      '  3) 浏览器手动下载对应平台的压缩包，然后：yarn ide:fetch --archive <文件路径>',
    ].join('\n') + '\n')
  }
}

/** Abort the run with a message; the top-level catch prints and exits. */
function fail(message) {
  throw new Error(message)
}

if (ifMissing && existsSync(join(targetDir, 'package.json'))) {
  process.stdout.write('fetch-openvscode-server: runtime already present, skipping (--if-missing)\n')
  process.exit(0)
}

/** Resolve the release descriptor (tag + asset list) for the requested version. */
async function resolveRelease() {
  const requested = versionFlag ?? process.env.OPENVSCODE_SERVER_VERSION ?? 'latest'
  const endpoint = requested === 'latest'
    ? `${apiBase}/releases/latest`
    : `${apiBase}/releases/tags/${requested.startsWith('v') ? requested : `v${requested}`}`
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'dsh-plugin-desktop' }
  if (process.env.DSH_GITHUB_TOKEN !== undefined) {
    headers.authorization = `Bearer ${process.env.DSH_GITHUB_TOKEN}`
  }
  const response = await fetch(endpoint, { headers })
  if (!response.ok) {
    fail(`GitHub API ${response.status} for ${endpoint}（检查网络/代理，或设置 DSH_OPENVSCODE_MIRROR）`)
  }
  const release = await response.json()
  const assets = Array.isArray(release.assets) ? release.assets : []
  for (const suffix of platformSuffixes) {
    const wanted = `-${suffix}.${archiveExt}`
    const asset = assets.find(item => item.name.endsWith(wanted))
    if (asset !== undefined) return { tag: release.tag_name, suffix, asset }
  }
  fail(`release ${release.tag_name} 没有当前平台的产物（查找 ${platformSuffixes.map(s => `-${s}.${archiveExt}`).join(' / ')}），可设置 DSH_OPENVSCODE_PLATFORM 覆盖`)
  return undefined
}

async function download(url, target) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) fail(`下载失败 HTTP ${response.status}：${url}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  writeFileSync(target, buffer)
}

async function sha256Of(file) {
  return await new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(file)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', () => resolvePromise(hash.digest('hex')))
    stream.on('error', reject)
  })
}

/** Unpack the archive into `targetDir` and return the extracted release root. */
function unpackArchive(archiveFile, work) {
  const extractDir = join(work, 'extract')
  mkdirSync(extractDir, { recursive: true })
  process.stdout.write(`fetch-openvscode-server: unpacking ${basename(archiveFile)}\n`)
  if (archiveFile.toLowerCase().endsWith('.zip')) {
    new AdmZip(archiveFile).extractAllTo(extractDir, true)
  } else {
    const result = spawnSync('tar', ['-xzf', archiveFile, '-C', extractDir], { stdio: 'inherit' })
    if (result.status !== 0) fail('tar 解压失败（需要系统 tar）')
  }
  const entries = readdirSync(extractDir).filter(name => !name.startsWith('.'))
  const root = entries.length === 1 ? join(extractDir, entries[0]) : extractDir
  if (!existsSync(join(root, 'package.json'))) {
    fail('解压结果缺少 package.json，目录结构不符合预期')
  }
  return root
}

async function main() {
  mkdirSync(targetDir, { recursive: true })
  // Work on the same drive as the target so the final rename is atomic and
  // never hits EXDEV. Pre-clean any leftover from an interrupted run.
  const work = join(packageRoot, 'tools', 'code-server', '.fetch-tmp')
  rmSync(work, { recursive: true, force: true })
  mkdirSync(work, { recursive: true })

  let tag
  let suffix
  let archiveFile
  let archiveUrl
  let stagedDir
  try {
    if (fromDirFlag !== undefined && fromDirFlag.length > 0) {
      // Local build: copy a built openvscode-server source tree into the
      // target, ensuring a node binary at the root so the app can spawn it
      // directly. The source directory is never modified.
      const source = isAbsolute(fromDirFlag) ? fromDirFlag : resolve(process.cwd(), fromDirFlag)
      if (!existsSync(join(source, 'package.json'))) {
        fail(`--from-dir 目录缺少 package.json：${source}`)
      }
      const nodeName = process.platform === 'win32' ? 'node.exe' : 'node'
      stagedDir = join(work, 'staged')
      mkdirSync(stagedDir, { recursive: true })
      // Skip VCS metadata so the packaged runtime stays lean; everything else
      // (out/, node_modules/, package.json, ...) is required at runtime.
      const segments = (path) => path.split(/[\\/]/)
      cpSync(source, stagedDir, {
        recursive: true,
        force: true,
        dereference: true,
        filter: src => {
          const parts = segments(src)
          return !parts.includes('.git') && !parts.includes('.github')
        },
      })
      if (!existsSync(join(stagedDir, nodeName))) {
        process.stdout.write(`fetch-openvscode-server: adding ${nodeName} from the current Node runtime\n`)
        cpSync(process.execPath, join(stagedDir, nodeName))
      }
      const requested = versionFlag ?? process.env.OPENVSCODE_SERVER_VERSION ?? 'local-build'
      tag = requested.startsWith('v') ? requested : `v${requested}`
      suffix = process.env.DSH_OPENVSCODE_PLATFORM ?? (process.platform === 'win32' ? 'windows-x64' : 'unknown')
      archiveUrl = `local:${source}`
      process.stdout.write(`fetch-openvscode-server: staging local build from ${source}\n`)
    } else if (archiveFlag !== undefined && archiveFlag.length > 0) {
      // Offline path: unpack a local archive. The version is taken from
      // --version/OPENVSCODE_SERVER_VERSION or inferred from the file name.
      archiveFile = isAbsolute(archiveFlag) ? archiveFlag : resolve(process.cwd(), archiveFlag)
      if (!existsSync(archiveFile)) fail(`--archive 文件不存在：${archiveFile}`)
      const inferred = /-v?(\d+\.\d+\.\d+)[-.]/.exec(basename(archiveFile))
      const requested = versionFlag ?? process.env.OPENVSCODE_SERVER_VERSION ?? inferred?.[1] ?? 'unknown'
      tag = requested.startsWith('v') ? requested : `v${requested}`
      suffix = process.env.DSH_OPENVSCODE_PLATFORM ?? (process.platform === 'win32' ? 'windows-x64' : 'unknown')
      archiveUrl = `local:${basename(archiveFile)}`
      process.stdout.write(`fetch-openvscode-server: using local archive ${archiveFile}\n`)
      stagedDir = unpackArchive(archiveFile, work)
    } else {
      const release = await resolveRelease()
      if (release === undefined) return
      tag = release.tag
      suffix = release.suffix
      const asset = release.asset
      const assetName = asset.name
      archiveUrl = asset.browser_download_url ?? `${downloadBase}/${tag}/${assetName}`
      archiveFile = join(work, assetName)
      process.stdout.write(`fetch-openvscode-server: downloading ${assetName} (${asset.size ?? '?'} bytes)\n`)
      await download(archiveUrl, archiveFile)
      stagedDir = unpackArchive(archiveFile, work)
    }

    const version = tag.startsWith('v') ? tag.slice(1) : tag
    let sha256 = null
    if (fromDirFlag === undefined || fromDirFlag.length === 0) {
      if (archiveFlag === undefined || archiveFlag.length === 0) {
        // Downloaded archive: verify the checksum when the release publishes
        // a sidecar.
        const sidecarUrl = `${downloadBase}/${tag}/${basename(archiveFile)}.sha256`
        try {
          const sidecar = await (await fetch(sidecarUrl, { redirect: 'follow' })).text()
          const match = /^([0-9a-f]{64})/i.exec(sidecar.trim())
          if (match !== null) {
            const actual = await sha256Of(archiveFile)
            if (actual.toLowerCase() !== match[1].toLowerCase()) {
              fail(`校验失败：${basename(archiveFile)} 的 SHA-256 与发布端不一致`)
            }
            sha256 = actual
            process.stdout.write('fetch-openvscode-server: SHA-256 verified\n')
          }
        } catch {
          process.stdout.write('fetch-openvscode-server: 无校验侧车文件，跳过校验\n')
        }
      } else {
        sha256 = await sha256Of(archiveFile)
      }
    }

    rmSync(targetDir, { recursive: true, force: true })
    renameSync(stagedDir, targetDir)

    const record = {
      version,
      tag,
      platform: process.platform,
      suffix,
      archive: fromDirFlag !== undefined && fromDirFlag.length > 0
        ? 'local-build'
        : basename(archiveFile),
      url: archiveUrl,
      sha256,
      fetchedAt: new Date().toISOString(),
    }
    writeFileSync(join(targetDir, '.version.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
    process.stdout.write(
      `fetch-openvscode-server: embedded IDE runtime ready at ${targetDir} (openvscode-server ${version})\n`,
    )
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

void main().catch(cause => {
  const message = cause instanceof Error ? cause.message : String(cause)
  printFailure(message)
  if (skipOnError) {
    process.stderr.write('fetch-openvscode-server: --skip-on-error given, continuing without the embedded IDE runtime\n')
    process.exit(0)
  }
  process.exit(1)
})
