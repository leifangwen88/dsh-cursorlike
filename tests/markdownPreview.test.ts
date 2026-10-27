/**
 * Markdown 文件判定单测：扩展名识别与边界（.mdx 明确排除）、预览本地图片 URL 解析、
 * 编辑器软换行策略。
 * 断言使用字符串字面量，不依赖 path.join。
 * 作者 ddj 2026年09月18号
 */
import { describe, expect, it } from 'vitest'
import { isMarkdownPath, markdownImageUrl, markdownWordWrap } from '../src/client/markdownPreview.js'

describe('isMarkdownPath', () => {
  it('识别 .md 与 .markdown（大小写不敏感）', () => {
    expect(isMarkdownPath('README.md')).toBe(true)
    expect(isMarkdownPath('docs/guide.MARKDOWN')).toBe(true)
    expect(isMarkdownPath('a/b/c.Md')).toBe(true)
  })

  it('兼容反斜杠分隔的 Windows 路径', () => {
    expect(isMarkdownPath('C:\\proj\\docs\\README.MD')).toBe(true)
  })

  it('排除 .mdx（渲染器只走 GFM，JSX 会被当字面文本，预览反而误导）', () => {
    expect(isMarkdownPath('page.mdx')).toBe(false)
  })

  it('排除其它扩展名与无扩展名路径', () => {
    expect(isMarkdownPath('main.ts')).toBe(false)
    expect(isMarkdownPath('notes.mdown')).toBe(false)
    expect(isMarkdownPath('README.md.bak')).toBe(false)
    expect(isMarkdownPath('md')).toBe(false)
    expect(isMarkdownPath('.md')).toBe(false)
    expect(isMarkdownPath('')).toBe(false)
  })
})

describe('markdownImageUrl', () => {
  const BASE = 'dsh-app://app/'
  const DOC = 'C:\\proj\\docs\\README.md'

  it('相对路径按文档目录展开，走受控文件路由', () => {
    expect(markdownImageUrl(DOC, 'img/a.png', BASE))
      .toBe('dsh-app://app/api/file?path=C%3A%5Cproj%5Cdocs%5Cimg%2Fa.png')
    expect(markdownImageUrl('/docs/README.md', 'x.png', BASE))
      .toBe('dsh-app://app/api/file?path=%2Fdocs%2Fx.png')
  })

  it('绝对路径不再拼文档目录', () => {
    expect(markdownImageUrl(DOC, 'C:\\x\\y.png', BASE))
      .toBe('dsh-app://app/api/file?path=C%3A%5Cx%5Cy.png')
  })

  it('剥离查询串与锚点后再解码', () => {
    expect(markdownImageUrl(DOC, 'a.png?raw=1#frag', BASE))
      .toBe('dsh-app://app/api/file?path=C%3A%5Cproj%5Cdocs%5Ca.png')
    expect(markdownImageUrl(DOC, 'a%20b.png', BASE))
      .toBe('dsh-app://app/api/file?path=C%3A%5Cproj%5Cdocs%5Ca%20b.png')
  })

  it('Web 基底同样命中 api/file 路由', () => {
    expect(markdownImageUrl(undefined, '/a b.png', 'http://127.0.0.1:1234/app/'))
      .toBe('http://127.0.0.1:1234/app/api/file?path=%2Fa%20b.png')
  })

  it('拒绝非文件资源与不支持的基底', () => {
    expect(markdownImageUrl(DOC, 'https://x/y.png', BASE)).toBeUndefined()
    expect(markdownImageUrl(DOC, '//cdn/x.png', BASE)).toBeUndefined()
    expect(markdownImageUrl(DOC, 'javascript:alert(1)', BASE)).toBeUndefined()
    expect(markdownImageUrl(DOC, '\\\\server\\share\\x.png', BASE)).toBeUndefined()
    expect(markdownImageUrl(DOC, 'a%zz.png', BASE)).toBeUndefined()
    expect(markdownImageUrl(undefined, 'relative.png', BASE)).toBeUndefined()
    expect(markdownImageUrl(DOC, 'a.png', 'file:///tmp/')).toBeUndefined()
    expect(markdownImageUrl(DOC, '', BASE)).toBeUndefined()
  })
})

describe('markdownWordWrap', () => {
  it('Markdown 默认软换行（对齐原生阅读与 VS Code markdown 默认）', () => {
    expect(markdownWordWrap('docs/README.md')).toBe('on')
    expect(markdownWordWrap('a/b/notes.MARKDOWN')).toBe('on')
    expect(markdownWordWrap('C:\\proj\\README.Md')).toBe('on')
  })

  it('非 Markdown 与空路径保持不换行', () => {
    expect(markdownWordWrap('src/main.ts')).toBe('off')
    expect(markdownWordWrap('page.mdx')).toBe('off')
    expect(markdownWordWrap('')).toBe('off')
    expect(markdownWordWrap(null)).toBe('off')
    expect(markdownWordWrap(undefined)).toBe('off')
  })
})
