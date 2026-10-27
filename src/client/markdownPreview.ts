/**
 * dsh-vscode-mode client — Markdown 文件判定（编辑区预览用）。
 * 纯函数、无 DOM/React 依赖，便于单测。
 * @author ddj 2026年09月18号
 */

/** 可进入预览的 Markdown 扩展名（小写、无点）。 */
const MARKDOWN_EXT_SET: Set<string> = new Set(['md', 'markdown'])

/**
 * 判断路径是否为可预览的 Markdown 文件（取 basename 扩展名，大小写不敏感）。
 *
 * 为什么不含 `mdx`：官方 MarkdownText 只走 GFM+KaTeX 语法，不解析 JSX；
 * 对 .mdx 做「预览」会把 JSX 当字面文本渲染出来，比文本编辑更容易误导，故排除。
 * @author ddj 2026年09月18号
 * @param path 文件路径（`/` 或 `\` 分隔均可）
 * @returns 是否 Markdown 文件
 */
export function isMarkdownPath(path: string): boolean {
  const base = String(path || '').split(/[\\/]/).pop() || ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return false
  return MARKDOWN_EXT_SET.has(base.slice(dot + 1).toLowerCase())
}

/**
 * 编辑器自动换行策略：Markdown 默认开启（对齐 VS Code/Cursor 与 DSH 原生阅读的换行体感），
 * 其它语言保持关闭（代码列对齐，长行横向滚动）。用户可用「切换自动换行」命令临时覆盖当前视图。
 * @param path 活动文件路径（可空；空按关闭处理）
 * @returns Monaco editor 的 wordWrap 取值
 */
export function markdownWordWrap(path: string | null | undefined): 'on' | 'off' {
  return isMarkdownPath(String(path ?? '')) ? 'on' : 'off'
}

/**
 * 允许作为文档 URL 基底的协议：Web（http/https）或桌面内置 dsh-app。
 * 其它协议（file:/data:/javascript: 等）一律不生成媒体 URL。
 * @param base 候选基底
 * @returns 可用基底或 undefined
 */
function markdownBaseOf(base: string): string | undefined {
  if (/^https?:/i.test(base)) return base
  if (base.startsWith('dsh-app://app/')) return base
  return undefined
}

/** 是否为绝对工作区路径（盘符绝对 / POSIX 绝对；UNC 与协议形式不算）。 */
function isAbsolutePath(path: string): boolean {
  return /^(?:[a-z]:[\\/]|\/)/i.test(path) && !/^[/\\]{2}/u.test(path)
}

/**
 * 取文件路径的目录前缀（保留原分隔符并带尾部 `\` 或 `/`；无分隔符时为空串）。
 * @param path 文件路径
 * @returns 目录前缀
 */
function directoryPrefixOf(path: string): string {
  const trimmed = path.replace(/[/\\]+$/u, '')
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1
  return trimmed.slice(0, cut)
}

/**
 * Markdown 本地图片 URL 解析（对齐 DSH 官方文档预览的 markdownImageUrl）。
 *
 * 把作者写的图片地址解析成受控文件路由 `api/file?path=`：
 * - 相对路径按当前 Markdown 文件目录展开，绝对路径直接使用；
 * - 查询串/锚点不是文件名的一部分，先剥离再解码；
 * - 拒绝 UNC、协议形式、控制字符与无法解码的转义，避免拉到非文件资源；
 * - 基底只接受 http(s) 与 `dsh-app://app/`，桌面/Web 两种宿主都能命中同一条认证文件路由。
 *
 * 解析失败返回 undefined，原语会把图片降级为 alt 文本（与未接该能力时的表现一致）。
 * @param documentPath 当前 Markdown 文件的绝对路径（可空；空时仅绝对图片地址可解析）
 * @param destination 作者书写的图片地址（可含 `?`/`#` 后缀）
 * @param base 文档 URL 基底（缺省取 `document.baseURI`，单测显式传入）
 * @returns 可加载的图片 URL；不可解析时为 undefined
 */
export function markdownImageUrl(documentPath: string | undefined, destination: string, base?: string): string | undefined {
  const raw = String(destination ?? '')
  if (raw === '') return undefined
  const suffix = raw.search(/[?#]/u)
  let path: string
  try {
    path = decodeURIComponent(suffix === -1 ? raw : raw.slice(0, suffix))
  } catch {
    return undefined
  }
  if (path === '') return undefined
  if (/[\u0000-\u001f\u007f]/u.test(path)) return undefined
  // UNC（\\server\share、//host/share）不是工作区文件，官方预览同样拒绝。
  if (/^[/\\]{2}/u.test(path)) return undefined
  // 协议形式（http:/mailto:/javascript: …）不是本地文件；Windows 盘符 `C:` 例外。
  if (!isAbsolutePath(path) && /^[a-z][a-z\d+.-]*:/iu.test(path)) return undefined
  if (!isAbsolutePath(path)) {
    const directory = documentPath ? directoryPrefixOf(String(documentPath)) : ''
    if (!directory) return undefined
    path = directory + path
  }
  const resolvedBase = markdownBaseOf(String(base ?? (typeof document !== 'undefined' ? document.baseURI : '')))
  if (!resolvedBase) return undefined
  try {
    return new URL('api/file?path=' + encodeURIComponent(path), resolvedBase).href
  } catch {
    return undefined
  }
}
