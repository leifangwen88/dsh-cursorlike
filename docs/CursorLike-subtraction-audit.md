# CursorLike 减法审计清单

> 状态：**部分已落地（2026-10-28 更新）**：SVN、MCP、Unity/系统集成、插件自更新已删除；LSP 按用户决定保留核心能力；其余项待办。  
> 目标：让 CursorLike 贴近 Cursor 主路径，删除与 DSH 原生能力或专用插件重复的功能，而不是无脑减体积。  
> 使用方式：每一项给出建议（删 / 留 / 迁移 / 降级），评审时在「结论」列填写最终决定。

---

## 0. 判断原则

1. **DSH 已经有的，不重复做**
   - 插件管理 / 更新 / 插件详情
   - 快捷键管理
   - 原生文件打开 / 预览
   - 会话管理 / 压缩 / 归档
   - 远程工作区
2. **专用插件已经有的，不重复做**
   - MCP 管理：`dsh-skill-mcp-panel`
3. **不是 Cursor 主路径的重功能，首版删除**
   - SVN、DAP、LSP/VSIX、Unity、代码片段、PDF/Office 自定义预览
4. **保留 Cursor 差异点**
   - 输入框 pending 文件卡
   - 右侧 Monaco 编辑器 / 文件树 / 页签 / QuickOpen
   - Review / Keep / Undo / 归档
   - Add to Chat / 拖入输入框
   - Tab ghost text / Quick Edit
   - Rules / Skills
5. **内部调优不做用户设置**
   - 性能、兼容性、诊断默认自动化或进日志。
   - 注：用户已确认保留「性能优化 / 兼容性」两个 Tab（2026-10-27），按只读报告保留，不再作为删除项。

---

## 1. 当前设置界面结构

当前设置页（已由 6+ Tab 收敛，2026-10-28 实际状态）：

```text
编辑器
AI 补全
语言服务器
性能优化
兼容性
```

已删除：MCP 管理、SVN 设置、系统集成 / Unity、检查更新 / 开发形态 / 快捷键入口。

目标设置页：

```text
编辑器
AI 补全
语言服务器
性能优化
兼容性
```

LSP / 性能 / 兼容性三个 Tab 按用户要求保留（内部实现可继续收敛）。

---

## 2. 设置项逐项清单

> 结论建议：**删** = 从设置页删除；**留** = 保留；**迁移** = 挪到 DSH/专用插件；**降级** = 仅代码支持，不暴露 UI。

| ID | 当前设置项 | 建议 | 原因 / 去向 | 依赖 / 风险 | 结论 |
|---|---|---|---|---|---|
| S1 | 通用 → 文件链接使用工具 | 删设置项，保留路由 | 固定 Cursor 策略：代码文件 → 插件右侧 Monaco；图片 / Markdown / PDF / Office → DSH 原生预览或系统打开；不再让用户选择 | 已完成（2026-10-27）：路由保留，`fileOpenTool` 设置入口已移除，硬编码为 `auto` + 路径级让位 | ✅ 已落地 |
| S2 | 通用 → 开发形态 | 删 | 开发调试入口，不属于用户功能 | 设置页「文件与安装」整段已移除；host devForm 代码待 Wave 4 清理 | ◐ UI 已落地 |
| S3 | 通用 → 检查更新 / 更新插件 | 删 | DSH 插件管理器负责安装、更新、版本展示 | 已完成（2026-10-27）：删除自更新 UI、启动更新提醒、`vscode.updateCheck` / `vscode.updateSelf` RPC 与 `selfUpdate.ts` / `updateNotice.ts` | ✅ 已落地 |
| S4 | 通用 → 快捷键配置入口 | 删 | DSH 官方快捷键机制已经统一管理 | 设置页已重写，仅保留编辑器/AI 两 Tab；旧通用页入口不再渲染 | ✅ UI 已落地 |
| S5 | 通用 → 原生打开范围 | 删 / 高级 | DSH 原生预览应自行决定；插件不再维护扩展名名单 | 影响 Office/PDF 让位逻辑，和 PDF 预览项一起处理 | 待定 |
| S6 | 通用 → 侧边栏最小宽度 | 降级 / 高级 | 属于布局微调，不是 Cursor 核心设置 | 侧边栏拖拽仍使用默认值；不暴露也可以 | 待定 |
| S7 | 通用 → 页签数量上限 | 降级 / 高级 | 属于编辑器行为，不是高频设置 | 默认上限可保留，UI 收进高级 | 待定 |
| S8 | 通用 → 自动保存 | **留** | Cursor/VS Code 核心体验：off / afterDelay / onFocusChange / onWindowChange | 已实现，保留 | 保留 |
| S9 | MCP 管理 Tab（我的 MCP / 项目 MCP / MCP 市场） | **删 / 迁移** | `dsh-skill-mcp-panel` 已有专有管理 | 已完成（2026-10-27）：MCP 设置 Tab、MCP runtime、RPC、会话状态 slot、共享类型与 13 个测试全部删除；由专用插件接管 | ✅ 已落地 |
| S10 | 语言服务器 Tab（服务器 / 已安装 / 市场 / 更新） | **保留并改造** | 用户确认有必要保留 | 已恢复 Tab；改为语言智能状态表（自动检测 + 高级命令），移除市场/已安装/更新 UI；补上 diagnostics | 保留 |
| S11 | 性能优化 Tab（会话盘点 / 归档 / 压缩调参） | **保留** | 用户确认有必要保留 | 已恢复 Tab 与 PerfSettings | 保留 |
| S12 | 兼容性 Tab | **保留** | 用户确认有必要保留 | 已恢复 Tab 与兼容性报告 | 保留 |
| S13 | SVN 设置段（svnPath / tortoisePath） | 删 | SVN 整体移除 | 已完成（2026-10-27）：SVN 设置、面板、菜单、命令、diff/日志/更新 RPC、状态层与测试全部删除 | ✅ 已落地 |
| S14 | 系统集成 / DSH 服务地址 / 右键菜单 / Unity 段 | **整块删** | 右键菜单与 Unity 都不是 Cursor 主路径；DSH 服务地址只服务于 launcher 的深链 | 已完成（2026-10-27）：删除 IntegrationSettings、launcher/Unity、外部深链、shell/Unity RPC 与配置；服务地址设置一并移除 | ✅ 已落地 |
| S15 | 设置页标题 `VSCodeMode` + MCP 描述 | **改** | 仍是旧名字，应改为 `CursorLike`，描述改为 Cursor 式编辑 | 已完成（2026-10-27）：设置页标题改为 `CursorLike`，仅保留编辑器/AI 两个 Tab | ✅ 已落地 |
| S16 | 插件详情自定义段 | 删 | DSH 插件详情页已经存在；当前 `SELF_ID` 还残留 `dsh-vscode-mode` | 删除 `PluginDetailSection` 注册与文件 | 待定 |
| S17 | 任务模型 / 任务思考档位（AI 子项） | 降级 | 对普通用户过于复杂；Quick Edit 可跟随补全模型 | 保留自动路由，UI 收到「高级」或隐藏 | 待定 |

### 设置页收敛目标

```text
[编辑器]
  自动保存
  自动保存延迟（仅 afterDelay 显示）
  页签数量上限（高级）
  侧边栏最小宽度（高级）

[AI 补全]
  启用
  模型
  思考档位
  Quick Edit 开关（新增）
```

---

## 3. 功能模块删除清单

> 规模为粗略统计，包含 Host/Client UI/共享类型，不含测试。实际会保留少量共享接缝。

| ID | 功能 | 建议 | 主要文件 / 目录 | 规模约 | 测试约 | 原因 / 风险 |
|---|---|---|---|---|---|---|
| F1 | MCP 管理 + MCP 会话状态 + MCP runtime | ✅ 已删 / 迁移 | `src/mcp*.ts`、`src/client/mcp*.ts`、`client/ui/Mcp*`、`client/mcpSessionState.ts` | 3.0k 行 | 13 | 已整块删除，MCP 交由 `dsh-skill-mcp-panel`（D1 已定 A） |
| F2 | SVN 全套 | ✅ 已删 | `src/svn*.ts`、`client/svn*`、`client/ui/Svn*`、`sidebar/panels/SvnPanel.ts` | 9.9k 行 | 31 | 已删（设置、面板、菜单、RPC、测试） |
| F3 | DAP 调试器 | 删（待办） | `src/dap/`、`client/dap/`、调试面板 / 变量 / 断点 UI | 4.8k 行 | 28 | 重型 IDE 功能；当前仍随包可用 |
| F4 | LSP + 语言服务器市场 + VSIX/Open VSX | **保留核心 LSP；删 VSIX 市场（待办）** | `src/lsp/`、`client/monaco/lsp/`、`LspSettings.ts`、outline/lspSource | 6.0k 行 | 13 | 用户决定保留 LSP + diagnostics + 状态页；仅市场/安装管理（`extmgr`、VSIX/Open VSX）待删 |
| F5 | 代码片段系统 | 删（待办） | `src/snippets.ts`、`client/snippets/`、`SnippetsPicker.ts` | 1.4k 行 | 5 | 非核心 |
| F6 | PDF / Office 自定义预览 | 删（待办） | `client/pdf/`、`pdfPreview.ts`、`LargeTextView` 中相关分支 | 0.36k 行 | 2 | DSH 原生预览 / 系统打开负责 |
| F7 | 远程工作区 / SSH 镜像 | 删（待办） | `remoteWorkspace.ts`、`remoteOpenRouter.ts` | 0.24k 行 | 2 | 专用 `dsh-remote-ssh` 负责；`remoteOpenRouter` 是会话文件链主路径，**不能删** |
| F8 | 插件自更新 / dev form / 版本检查 | ◐ 部分已删 | `selfUpdate.ts`、`devForm.ts`、`dshVersion.ts`、`updateNotice.ts` | 1.7k 行 | 6 | 自更新 / 更新提醒 / RPC 已删（S3）；`devForm` / `dshVersion` 残留待清 |
| F9 | 性能优化 / 兼容性 | **保留**（用户确认） | `perf.ts`、`perfPatch.ts`、`client/perf*`、`compat*.ts`、`PerfSizeBadge` | 1.4k 行 | 4 | 用户要求保留「性能优化 / 兼容性」两个 Tab；改为只读报告，不删 |
| F10 | Unity 支持 | ✅ 已删 | `unityBridge.ts`、`unity/` 资源、IntegrationSettings 中 Unity 段 | 0.24k 行 | 1 | 已删（含 launcher/深链） |
| F11 | 浮动编辑器 / 中央编辑页兜底 / better-sidebar 旧桥 | 删 / 评估（待办） | `FloatingEditor.ts`、`FloatingWindow.ts`、`sidebarBridge.ts`、central layout 分支 | 0.3k–1k 行 | 1 | 现在统一官方右侧栏；`sidebarBridge` facade 需保留最小接缝 |
| F12 | 资源管理器右键菜单 / shell launcher 集成 | ✅ 已删 | `integrate.ts`、`assets/shell/` | 含在 F14 迁移面 | 1 | 已随系统集成删除 |
| F13 | 旧键位迁移 / 本地键位存储 | 删 / 迁移（待办） | `keybindings.ts` 中旧迁移、`shortcutsOfficial.ts` | 少量 | 3 | DSH 官方快捷键 |
| F14 | 旧概览 / 归档入口残留 | 删（待办） | `DiffBadge.ts`、`DiffLauncher.ts`、`DiffBarEmpty.ts` | 少量 | 2 | 已卸载的死代码 |
| F15 | 插件详情自定义段 | 删（待办） | `PluginDetailSection.ts`、index 注册 | 少量 | 1 | DSH 插件详情已有 |

### 明确保留

| 保留项 | 原因 |
|---|---|
| 官方右侧栏 Monaco 编辑器 | Cursor 侧边形态核心 |
| 文件树 / 页签 / QuickOpen | 基础动线 |
| 搜索 / Outline | 编辑器导航 |
| Review / Keep / Undo / 归档 / Diff | 核心审查 |
| 输入框 pending 文件卡 | 本次产品核心 |
| Add to Chat / 拖入输入框 | Cursor 对话动线 |
| Tab ghost text / Quick Edit | AI 编辑核心 |
| Markdown / 图片预览 | 常用输出 |
| Rules / Skills | Cursor 差异点 |
| Review DB / 文件监听 / 外部修改保护 | 正确性基础 |
| 原生 openPath 交接 | 与 DSH 文件系统衔接 |

---

## 4. 关键决策点

### D1. MCP 到底删哪一层？

**已定（2026-10-27）：A —— 专用插件全包。**

- `dsh-skill-mcp-panel` 负责 MCP 管理 UI + profile / 项目配置；
- 本插件删除 MCP UI、`mcpRuntime` / `mcpPool` / `mcpBridge`、会话 MCP 状态 slot 与共享 RPC 类型；
- 已落地：MCP 设置 Tab、runtime、RPC、会话状态 slot 与 13 个测试全部删除。

### D2. LSP 是否完全删？

- 选项 A：全部删，只保留 Monaco 语法高亮/基础提示；
- 选项 B：保留只读的“语言服务器状态”，不做市场/安装；
- 选项 C：保留完整 LSP。

**已定（2026-10-27 → 2026-10-28 落地）：保留核心 LSP（客户端 + diagnostics + 状态页），删除 VSIX/Open VSX 市场与服务器安装管理。**

理由：用户明确要求保留「语言服务器」Tab，并补齐了 diagnostics；后续只做「自动发现 + 状态 + 降级」，不再维护语言服务器市场。VSIX/`extmgr` 等市场能力仍待删除。

### D3. Rules / Skills 是否留？

**建议：留。**  
这是 Cursor 的规则/技能差异点，不是 DSH 或 MCP 插件的重复能力。

### D4. 搜索 / Outline 是否留？

**建议：留。**  
它们是编辑导航，不是重功能；只有确认 DSH 原生搜索已覆盖时才考虑删。

---

## 5. 预计影响

| 指标 | 当前（2026-10-28 实测） | 减法后（预估） |
|---|---|---|
| 设置 Tab | 5（编辑器 / AI 补全 / 语言服务器 / 性能优化 / 兼容性） | 5（保持） |
| 设置 Config 字段 | 约 10 个 | 约 8 个 |
| 源码规模 | 约 54.9k 行 / 281 文件 | 约 40k–44k 行 |
| 测试数量 | 2539 用例 / 201 文件 | 约 1900 用例 |
| 候选删除 | — | 约 13k 行（DAP / VSIX 市场 / snippets / PDF / remote / 旧桥） |

注：规模为“文件级粗算”，包含共享类型/接缝；实际净删除会低于此值。

---

## 6. 建议执行波次

### D5. 更新策略

**已定（2026-10-27）：**

- 当前删除插件内自更新 / 检查更新 / 更新提醒；
- 更新交给 DSH 插件管理器；
- 开源后发布 GitHub Releases + npm 包（npm 包名需小写或 scope，发布前确定）；
- 可选：GitHub Releases 新版本通知（只提示，不自动安装）；
- 首版不做插件自己下载并覆盖文件的自动更新。

### Wave 1：只减设置界面（低风险）

- [x] S1：删除「文件链接使用工具」设置，保留并硬编码 Cursor 路由策略
- [x] S14：删除系统集成 / DSH 服务地址 / 右键菜单 / Unity 与外部深链
- [x] 设置页收敛为 5 Tab（编辑器 / AI 补全 / 语言服务器 / 性能优化 / 兼容性）
- [x] 删除 MCP 设置入口（LSP / Perf / Compat 按用户要求保留）
- [x] 删除 SVN / Integration 设置段
- [x] 删除通用里的 dev / update / shortcuts / native range 等入口（host `devForm` 代码待 Wave 4 清理）
- [x] 设置标题改为 `CursorLike`
- [x] 先不删 Host 代码，保证行为不变

### Wave 2：删纯冗余

- [x] 删除自更新 / 启动更新提醒 / `vscode.updateCheck` 与 `vscode.updateSelf`
- [ ] dev form / 插件详情段
- [x] 性能优化 / 兼容性页面 → **改为保留**（用户确认，只读报告）
- [ ] PDF / Office 自定义预览
- [ ] 代码片段
- [ ] 远程工作区
- [x] Unity
- [ ] 浮动编辑器 / 中央兜底
- [x] MCP UI + runtime（D1 已定 A：交由 `dsh-skill-mcp-panel`）

### Wave 3：删大模块

- [x] SVN（设置、面板、菜单、命令、diff/log/update、RPC、状态层、测试）
- [ ] DAP
- [ ] LSP 市场（VSIX / Open VSX + `extmgr`）；核心 LSP / 诊断保留

### Wave 4：收尾

- [ ] 清理 `rpc.ts` / `shared/rpc.ts` / `fileOpenSettings.ts` 对应协议与配置
- [x] 删除 MCP / SVN / Unity / 系统集成相关测试
- [ ] 删除剩余减法特性对应测试（DAP / snippets / PDF / remote / 浮动等，约 60+ 文件）
- [x] 移除 `unity/`、`assets/shell`、旧依赖、旧 locale 文案
- [x] 更新 README / 减法说明 / 兼容性说明（2026-10-28）
- [ ] 跑全量绿色测试（当前基线 2539 passed / 14 skipped / 0 failed）

---

## 7. 验收标准

- [x] 设置页收敛为「编辑器」「AI 补全」「语言服务器」「性能优化」「兼容性」
- [x] 设置页不再出现 MCP / SVN / Integration
- [x] 不再有“检查更新”“开发形态”等重复入口
- [x] 文件树、编辑、Review、pending 卡、Add to Chat、Tab、Quick Edit 不回归（已真机验收）
- [x] Agent 修改、Keep/Undo、保存策略不受影响
- [x] MCP 管理只保留专用插件一套
- [x] `pnpm build` / `pnpm typecheck` 通过
- [ ] 全量测试回到绿色基线（排除已知环境依赖）——减法完成后复跑
