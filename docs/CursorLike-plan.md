# CursorLike — 面向 DeepSeek Harness 的 Cursor 式编码工作台

> 工作名：**CursorLike**  
> 一句话：**The Cursor-style coding surface for DeepSeek Harness.**  
> 定位：在 DSH 官方右侧栏里提供“文件树 + 编辑器 + 待处理文件卡 + 审查 diff”，把 Cursor 最核心的几条动线补齐，而不是复刻一个完整 IDE。
> 仓库位置：`E:\DshCursorLike`；包名 / 插件 id：`dsh-cursorlike`，显示名 `CursorLike`（内部缓存与历史归档目录仍沿用 `dsh-vscode-mode`，见 `src/paths.ts`）。

---

## 1. 为什么要做

当前 DSH 上已经有两套接近的方案，但都差最后一段：

- `dsh-vscode-mode`：右侧栏 Monaco 编辑器、文件树、Keep/Undo、差异审查都有，但它自己的输入框上方 dock 是“当前待处理差异”的操作条，不是 Cursor 那种**整场会话文件浏览卡**。
- 我们做的 `@local/dsh-session-files`：已经能在输入框上方列出整场会话文件，点击也能跳到 vscode-mode，但逐行 diff 还是外挂实现，和 DSH 原生轮级卡片的体感有差距。

结论：**不再维护外挂 strip，直接 fork vscode-mode，把 Cursor 的输入框上方文件浏览 + Undo/Keep/Review 做进插件本体；diff 仍留在聊天/审查内联展示。**

---

## 2. 目标与非目标

### 2.1 目标

1. **一个插件**：安装后同时获得侧边编辑器与会话文件浏览，不再需要 `@local/dsh-session-files`。
2. **Cursor 式输入框上方文件卡**：
   - 收起：`N Files`（单文件时显示路径）+ `Undo` / `Keep` / `Review`
   - 展开：文件列表，每行文件类型图标、文件名、`+N −M`，右侧 `×` / `✓`
   - 点击：打开该文件（或该文件的审查）
   - 批量：`Undo` / `Keep` 作用于全部待处理改动
3. **和 DSH 原生体验一致**：
   - 文件卡行为对齐 Cursor 截图
   - diff 不在输入框上方做悬浮；diff 仍在聊天内联卡片 / 审查页展示
   - 使用 DSH 的主题 token，不硬编码颜色
4. **Cursor 式 AI 补全 / 内联编辑**：
   - 保留并完善现有 AI ghost text 补全（Tab 采纳）；
   - 增加 Cmd+K 内联编辑：选中代码 → 输入指令 → 生成替换 → diff 预览 → 采纳/拒绝。
5. **做减法**：保留 Cursor 核心动线，去掉 vscode-mode 里我们不用的重功能。
6. **可开源、可传播**：独立名字、MIT、清晰文档、截图、安装方式、迁移说明。

### 2.2 非目标

- 不做完整 VS Code：不追求插件市场、调试器、远程开发、终端全家桶。
- 不追求 Cursor 的全量模型/补全策略；先做可用的 ghost text + Cmd+K，不做复杂 Tab jump 预测。
- 不兼容所有旧版 DSH；以当前 `0.2.1-rc.x` 为主，旧版只保留降级说明。
- 不把 vscode-mode 的全部功能都背过来；能删则删，能默认关闭则关闭。

---

## 3. Cursor 形态拆解（设计基线）

参考用户提供的 Cursor 截图与 DSH 原生 changed-files 卡片：

### 3.1 输入框上方文件卡（以 2026-10-27 截图为基线）

**多文件形态**

```text
┌──────────────────────────────────────────────┐
│ ⌄  3 Files              Undo  Keep  [Review] │
├──────────────────────────────────────────────┤
│ 🐍  _tmp_prod_api.py       +12 −3      ×  ✓  │
│ 🐍  _tmp_verify_api.py      +4 −0      ×  ✓  │
│ 📄  版本说明.md             +3 −3      ×  ✓  │
└──────────────────────────────────────────────┘
```

**单文件形态**

```text
┌──────────────────────────────────────────────┐
│ client/版本说明.md        Undo  Keep  [Review] │
├──────────────────────────────────────────────┤
│ 📄  版本说明.md            +3 −3      ×  ✓    │
└──────────────────────────────────────────────┘
```

- 位置：紧贴输入框正上方，和输入框同宽，是 composer 的一部分，不是聊天流里的卡片。
- 头部左侧：`⌄` + `N Files`；单文件时显示相对路径（如 `client/版本说明.md`）。
- 头部右侧：`Undo`、`Keep`、`Review` 三个动作。
  - `Undo`：撤销全部待处理改动。
  - `Keep`：采纳全部待处理改动。
  - `Review`：打开审查页（视觉上是主按钮）。
- 行内容：文件类型图标 + 文件名 + `+N −M`；右侧 `×`（拒绝该文件）和 `✓`（采纳该文件）。
- 行高紧凑，文件多时列表内部滚动；超过 4 行折叠为 `全部 N 个文件`。
- 点击文件名：打开该文件（没有独立审查页时打开编辑器）。
- 无 pending 改动时整卡隐藏。
- 数据范围：**当前待处理改动**（Cursor 的 Undo/Keep 语义）。历史/整场会话列表作为后续 secondary view，不和主卡混在一起。

### 3.2 Diff 展示位置（不做输入框悬浮）

**明确不做：输入框上方不做 500ms hover 的 diff 浮层。**

Diff 仍在以下位置展示：

1. **聊天内联卡片**（DSH 原生 `ChangedFiles` / `FileDiff` 形态）：
   - 双行号、`+/-`、绿/红背景、hunk；
   - 这是用户看“逐行改了什么”的主要位置。
2. **Review 审查页**：
   - 点 `Review` 后打开完整 diff；
   - 保留 Keep / Undo / 归档 / 历史。

输入框上方只负责“有哪些文件、批量/单文件采纳拒绝、进入 Review”，不负责渲染 diff。这样更接近截图的体感，也避免 hover 层的指针/层叠问题。

### 3.3 点击与审查

- 点文件行 → 打开该文件的编辑器（或审查页，取决于是否有可审查 diff）；
- 点行尾 `×` / `✓` → 拒绝 / 采纳该文件；
- 点头部 `Undo` / `Keep` → 全部拒绝 / 采纳；
- 点头部 `Review` → 打开审查视图；
- 复用 vscode-mode 现有的 review records，不重复实现 Keep/Undo 状态机。

### 3.4 AI 补全 / 内联编辑

**3.4.1 Tab 补全（保留现有）**

- 复用 vscode-mode 现有 `ai/inlineProvider.ts`：
  - `edrv.ai.inline` RPC；
  - Monaco `registerInlineCompletionsProvider`；
  - ghost text 展示，Tab 采纳。
- 保留设置项：开关、模型选择、上下文窗口。
- 首版不重写补全 provider，只做稳定性和体验打磨。

**3.4.2 Cmd+K 内联编辑（新增）**

```text
选中代码 → Cmd/Ctrl+K → 输入自然语言指令
→ 模型返回替换文本
→ 编辑器内 inline diff 预览（旧/新）
→ Tab / ✓ 采纳，Esc / × 拒绝
```

- 触发：选中文本后 `Cmd+K` / `Ctrl+K`；
- 输入框：编辑器内浮层，不跳聊天；
- 上下文：选中文本 + 当前文件路径 + 邻近代码；
- 预览：先在编辑器内显示 diff，不直接改文件；
- 采纳：写回编辑器（进入 undo stack），记录为一次 AI edit；
- 拒绝：清理浮层，不产生改动；
- 失败：显示错误，可重试，不阻塞编辑器；
- 不发散：首版不做多轮对话、不做跨文件重构、不做自动跑测试。

> 注意：Cmd+K 会调用模型，产生 token 成本；设置中明确提示，并允许关闭。

---

## 4. 产品形态

### 4.1 整体布局

```text
┌──────────────┬──────────────────────────────┬─────────────────────┐
│ DSH 侧栏     │ 对话 / 输入框                 │ 文件编辑（官方右栏） │
│              │                              │                     │
│              │  ┌────────────────────────┐  │  文件树 + 编辑器     │
│              │  │ 3 Files  Undo Keep Rev │  │                     │
│              │  ├────────────────────────┤  │                     │
│              │  │ file1  +12 -3    × ✓  │  │                     │
│              │  │ file2  +4  -0    × ✓  │  │                     │
│              │  └────────────────────────┘  │                     │
│              │  ┌────────────────────────┐  │                     │
│              │  │ 输入框...              │  │                     │
│              │  └────────────────────────┘  │                     │
└──────────────┴──────────────────────────────┴─────────────────────┘
```

- 编辑器仍然是官方右侧栏 tab，保持现在的侧边形态；
- 文件卡在输入框上方，不改变对话流；
- 文件树 + 编辑器同屏；
- 不引入新的左侧主栏，不替换 DSH 布局。

### 4.2 状态

| 状态 | 表现 |
|---|---|
| 无 pending 改动 | 整卡隐藏 |
| 有改动、收起 | 只显示头部 `N Files`（单文件显示路径）+ `Undo / Keep / Review` |
| 有改动、展开 | 列表，超过 4 行折叠 |
| 点击行 | 打开该文件 |
| 点击行尾 × / ✓ | 拒绝 / 采纳该文件 |
| 点击头部 Undo / Keep | 拒绝 / 采纳全部 |
| 点击 Review | 打开审查 |
| 历史回填 | 不进入主卡；后续以“历史”secondary view 提供 |
| 大文件/二进制 | 行内标记不可预览，Review 中显示提示 |

### 4.3 可访问性

- 文件行是 `<button>`，支持 Enter/Space；
- 头部 `aria-expanded`；
- `Undo / Keep / Review` 和行尾 `× / ✓` 都是独立按钮；
- 触摸设备不依赖 hover，点击即可操作。

---

## 5. 技术架构

### 5.1 基础

- Fork：`Lenonss/DSH_VsCodeMode` `0.20.2`
- 保留 MIT 与上游 NOTICE；
- 包名：`CursorLike`
- 插件形态：仍是 DSH bundle，Host + Client 两半；
- 客户端：React + Monaco，沿用 vscode-mode 的 editor/diff/review 基础设施。

### 5.2 数据来源

优先级：

1. **DSH 原生 `workspaceChanges.summary` / `diff`**  
   - 最接近 DSH 自带卡片；
   - 提供逐行 hunk、行号、`added/deleted`、`binary/oversized`；
   - 按 `sessionId + seq + index` 取 diff。
2. **vscode-mode 的 `recordsFeed` / `diffSummary`**  
   - 提供 legacy record 的 hunks；
   - 用于官方 summary 不可用时的回退。
3. **会话事件回填**  
   - Host 重启后 summary 丢失时，用 `write/edit` 的 tool result `meta.path/operation` 列出文件；
   - 无逐轮 diff，显示“历史回填文件”。

> 注意：`workspaceChanges` 的 summary 是 Host 进程内内存；Host 重启后历史 summary 不可恢复。回填只保证“文件列表”，不保证 diff。

### 5.3 组件划分

```text
src/client/
  ui/
    ConversationDiffDock.ts       ← 现有入口，改成/接入 SessionFilesCard
    SessionFilesCard.tsx          ← 新增：Cursor 式文件卡（含头部动作、行尾 ×/✓）
    SessionFileActions.tsx        ← 新增：Use/Undo/Review 动作封装
  state/
    sessionFiles.ts               ← 新增：pending 文件聚合/去重/排序
    recordsFeed.ts / diffSummary  ← 复用
  ai/
    inlineProvider.ts             ← 复用：Tab ghost text 补全
    inlineEdit.ts                 ← 新增：Cmd+K 内联编辑请求/状态
  ui/
    InlineEditOverlay.tsx         ← 新增：Cmd+K 输入与 diff 预览浮层
  styles/
    session-files.css             ← 新增，使用 --dsw-alias-* token
src/host/
  sessionFiles.ts                 ← 新增：summary/diff 路由（若 vscode-mode host 不暴露）
  ai/inlineEdit.ts                ← 新增：edrv.ai.edit RPC（复用 DSH LLM）
```

### 5.4 关键决策

- **不再用独立 `conversation.input.dock` 条目**：由 `ConversationDiffDock` 内部渲染，避免两条 bar。
- **不再用 `edrv:open-editor` 外部事件**：直接调用 vscode-mode 内部的 `openDiffView` / `openFile`。
- **输入框卡片不渲染 diff**：diff 在聊天内联卡片和 Review 中展示；卡片只负责文件列表和动作。
- **不做第二套审查**：Keep / Undo / 归档 / 历史继续走 vscode-mode existing review。
- **主范围是 pending 改动**：与 Cursor 的 Undo/Keep 语义一致；历史/整场会话作为后续 secondary view。
- **AI 补全复用现有 provider**：不重写 `edrv.ai.inline`；只做稳定性与设置打磨。
- **Cmd+K 独立于聊天**：编辑器内浮层，生成 diff 后再采纳，不把代码改动的控制权交给聊天。

---

## 6. 功能取舍（做减法）

### 6.1 保留

| 功能 | 原因 |
|---|---|
| 官方右侧栏 Monaco 编辑器 | 核心侧边形态 |
| 文件树、文件标签、QuickOpen | Cursor 基础动线 |
| 文件链接 / 行号跳转 | 对话到编辑器的桥 |
| 差异审查 Keep/Undo/归档/回滚 | 核心审查 |
| 输入框上方文件卡 + 批量/单文件 Undo/Keep/Review | 本次新增核心 |
| AI ghost text 补全（Tab 采纳） | 复用 vscode-mode 现有 `edrv.ai.inline` |
| Cmd+K 内联编辑 | Cursor 核心体验，首版新增 |
| 命令面板 / 快捷键（精简） | 提效 |
| Markdown 预览 | 对话产出常用 |
| 中英文 UI | 开源传播 |

### 6.2 默认关闭 / 移除

| 功能 | 处理 | 原因 |
|---|---|---|
| SVN 集成 | 移除 | 用户面窄、体量大 |
| MCP 面板 | 移除 | 与编辑体验无关 |
| Unity 支持 | 移除 | 垂直场景 |
| DAP 调试器 | 移除 | 重型，非首版目标 |
| VSIX 扩展市场 | 移除 | 与“轻量 Cursor 体验”冲突 |
| PDF / Office 预览 | 移除或降级 | 非代码主场景 |
| 代码片段系统 | 移除 | 非核心 |
| 远程工作区 / SSH | 移除 | 体量大、依赖多 |
| better-sidebar 旧桥 | 移除 | 只支持官方右侧栏 |
| 中央文件编辑页兜底 | 移除 | 统一走官方侧栏 |
| 自动更新 | 移除或默认关 | 开源分发可控 |
| LSP 全量智能 | 第一版移除/可选 | 体量大；先保证编辑和 diff |

> 减法原则：**输入框上方文件浏览 + 右侧编辑器 + 聊天/Review 内联 diff + Undo/Keep/Review + Tab/Cmd+K AI 编辑** 是主路径；其他能力不进入主包，需要时再做可选插件。

---

## 7. 分阶段实施

### Phase 0 — 方案冻结（已完成）

- 名字：`CursorLike`；
- 范围、减法、形态、迁移策略见第 11 节；
- 目标 DSH 版本 `0.2.1-rc.x`。

### Phase 1 — Fork 基线

- 用 0.20.2 源码构建；
- 改包名/仓库名/README；
- 删掉明确不要的模块，确保 `pnpm build` 通过；
- 安装本地 fork，确认侧边编辑器不回归。

### Phase 2 — 文件卡 + 数据

- 新增 pending `sessionFiles` 聚合；
- 替换 `ConversationDiffDock` 的普通对话分支；
- 完成头部 `N Files`（单文件路径）、`Undo / Keep / Review`、行尾 `× / ✓`；
- 点击打开、空态、加载、错误。

### Phase 3 — 动作与审查联动

- 批量 Undo/Keep 接 vscode-mode review；
- 单文件 ×/✓ 接记录决策；
- Review 打开审查页；
- 处理后文件从 pending 卡消失；
- 大文件/二进制/无 diff 状态。

### Phase 4 — AI 补全 / 内联编辑

- 复用现有 ghost text 补全，确认 Tab 采纳稳定；
- 新增内联编辑：选中代码 → 指令 → 原/新 diff → 接受/拒绝；
- 首版不占用快捷键，由选区悬浮条 **Quick Edit** 按钮触发；
- 编辑器内 diff 预览、采纳/拒绝、undo stack；
- 模型选择、开关、token 成本提示。

### Phase 5 — 打磨

- 行数统计、排序、去重；
- 键盘与可访问性；
- 性能（大列表、40+ 文件、长 diff）；
- 与 vscode-mode 原有 Review/Keep/Undo 联动。

### Phase 6 — 开源发布

- 独立 repo、npm 包、MIT/NOTICE；
- README、截图、安装、兼容性、迁移；
- 从 `@local/dsh-session-files` / `dsh-vscode-mode` 迁移说明；
- CI（build/test）与 issue 模板。

---

## 8. 验收标准

在 DSH `0.2.1-rc.3` 上：

- [ ] 只有一个插件，安装后右侧栏出现“文件编辑”；
- [ ] 输入框上方出现 `N Files` 卡片（单文件显示路径），不再有第二条文件条；
- [ ] 点击文件，右侧编辑器准确切到该文件（不是旧 tab）；
- [ ] 头部 `Undo / Keep / Review` 可用；
- [ ] 行尾 `× / ✓` 可拒绝/采纳单个文件；
- [ ] 点 Review，打开审查，Keep/Undo 正常；
- [ ] 无 pending 改动时卡片隐藏；
- [ ] 20+ 文件时列表滚动、性能可接受；
- [ ] Tab ghost text 补全可用，Tab 采纳；
- [ ] 选中代码 Cmd/Ctrl+K 可输入指令并生成内联 diff；
- [ ] Cmd+K 采纳后进入 undo stack，拒绝不改文件；
- [ ] `pnpm build` 成功，无 console error；
- [ ] 卸载 `@local/dsh-session-files` 后功能仍完整。

---

## 9. 风险

| 风险 | 影响 | 对策 |
|---|---|---|
| Fork 与上游漂移 | 维护成本 | 只改 `ConversationDiffDock` 和新组件，尽量少碰核心 |
| vscode-mode 体量大、构建慢 | 安装/迭代慢 | 先做减法，移除不用的模块 |
| DSH summary 进程内丢失 | 历史 diff 缺失 | 回填文件列表；文档说明限制 |
| 原生 diff 数据接口变更 | Review 展示失效 | 通过 Host 适配层隔离；保留 records 回退 |
| Keep/Undo 的批量/单文件语义 | 误操作/状态不一致 | 复用 vscode-mode 决策状态；先做单文件，再做批量 |
| AI 补全/内联编辑的延迟与 token 成本 | 体感差/费用 | 设置开关、模型选择、超时与取消；明确成本提示 |
| Cmd+K 写回破坏编辑器状态 | 丢改动 | 先生成 diff，不直接写；采纳才写，进 undo stack |
| 名字冲突/商标 | 开源传播 | 发布前查 npm/GitHub/域名；避免 Cursor 商标 |
| 上游 MIT  attribution | 合规 | 保留 LICENSE + NOTICE，README 注明 fork |

---

## 10. 开源与命名

### 名字

**CursorLike**  
- 包名 / npm 名：`dsh-cursorlike`（小写；同时作为 GitHub 仓库名，符合 DSH 插件生态 `dsh-*` 命名习惯）
- 显示名：`CursorLike`
- 仓库：`leifangwen88/dsh-cursorlike`（GitHub 公开仓库，发布时创建；`package.json` 的 `repository` / `homepage` / `bugs` 已指向本仓库）
- Tagline：**The Cursor-style coding surface for DeepSeek Harness.**
- 中文：**给 DeepSeek Harness 的 Cursor 式编码工作台。**

说明：

- 名字采用描述性的 “cursorlike”，不使用 Cursor 作为商标；
- README 中注明：本项目是社区开源项目，与 Cursor / Anysphere 无关联；
- README 中注明 fork 自 [Lenonss/DSH_VsCodeMode](https://github.com/Lenonss/DSH_VsCodeMode) 并保留 MIT 署名；
- 发布前仍检查 npm、GitHub、域名是否可用。

### 开源材料

- MIT LICENSE；
- NOTICE：基于 `dsh-vscode-mode`（MIT）fork；
- README：安装、截图、兼容性、功能、减法说明、迁移；
- CONTRIBUTING / ISSUE 模板；
- 版本策略：`0.x` 快速迭代，DSH 版本范围写清楚；
- 不默认上传遥测；自动更新默认关。

---

## 11. 已确认

1. **名字**：`CursorLike`。
2. **主卡范围**：当前 pending 改动（与 Undo/Keep 语义一致）；整场会话列表后续做 secondary view。
3. **减法清单**：SVN/MCP/Unity/DAP/VSIX/PDF/Office/代码片段/远程/LSP 首版移出。
4. **保留**：Markdown 预览、QuickOpen、命令面板、AI ghost text 补全、Cmd+K 内联编辑。
5. **形态**：只支持官方右侧栏，不再兼容 better-sidebar / 中央兜底。
6. **迁移**：保留 vscode-mode 旧配置的 best-effort 迁移。
7. **AI 范围**：Tab 补全复用现有 provider；Cmd+K 首版只做选中文本单轮替换，不做跨文件重构。

---

## 12. 变更记录

### 2026-10-28 — 迁移、改名与项目整理

- 项目目录迁移到 `E:\DshCursorLike`（旧 `C:\Users\PC\Documents\deepseek-harness\default-workspace\dsh-vscode-mode-fork` 已删除）；DSH profile 依赖改为 `"CursorLike": "link:E:/DshCursorLike"`，bundle 同步改名。
- 命名全链路统一为 `CursorLike`：`package.json` name、`tsdown.config.ts` ID、`cordis.patch.yml` id/name、`src/index.ts` name、locale 标题、设置页标题。
- `src/paths.ts` 的 `PLUGIN_ID` 仍刻意保留 `dsh-vscode-mode`：归档 DB、缓存、日志目录沿用旧路径，避免丢失用户历史数据；后续如需改名需一次性迁移。
- **Markdown 预览对齐 DSH 原生**：补齐代码块 `toolbarLabels`（自动换行开关）、本地相对图片解析（`api/file` 路由）、窄面板留白/工具条容器查询适配。
- **Markdown 源码默认软换行**（VS Code/Cursor 同款），新增「切换自动换行」命令（无默认键位，按文件在会话内记忆覆盖值）。
- README 重写为 CursorLike 主文档；`package.json` 移除上游 homepage/repository/bugs；上游发行说明与架构文档归档到 `docs/upstream/`；CI / Release 工作流改为 CursorLike（不发布上游包名）。

### 2026-10-27 — 按用户截图调整

- **移除**输入框上方 500ms 悬浮 diff 的需求；diff 只在聊天内联卡片 / Review 中展示。
- 文件卡加入头部 `Undo / Keep / Review`，行尾 `× / ✓`。
- 单文件时头部显示路径（如 `client/版本说明.md`），多文件显示 `N Files`。
- 主卡范围改为 **pending 改动**，与 Cursor 的 Undo/Keep 语义对齐；整场会话列表降为后续 secondary view。
- 保留此前“做减法 / 开源 / fork”方向。

### 2026-10-27 — 定名

- 产品名定为 **CursorLike**，包名、仓库名、计划文件名统一。
- 其余范围、减法、形态、迁移策略按本文件执行。

### 2026-10-27 — 保留 AI 能力

- 保留 Tab ghost text 补全（复用 vscode-mode `edrv.ai.inline`）。
- 新增 Cmd+K 内联编辑：选中代码 → 指令 → diff 预览 → 采纳/拒绝。
- 从“非目标”移入目标与 Phase 4；AI 补全/内联编辑不再做减法。

---

## 13. 当前进度（2026-10-27 更新）

| 阶段 | 状态 | 说明 |
|---|---|---|
| Phase 0 方案冻结 | ✅ | 名字、范围、减法、形态、迁移策略已定 |
| Phase 1 Fork 基线 | ✅ | 0.20.2 构建 / typecheck / 绿色测试基线；已改包名并安装本地 fork；旧 `dsh-vscode-mode` 依赖已清理 |
| Phase 2 文件卡 + 数据 | ✅ | pending 卡片、默认收起、按会话记忆展开、单/多文件头部、行尾 ×/✓、orphan 状态已落地 |
| Phase 3 动作与审查 | ✅ | 批量/单文件 Keep/Undo 走既有 RPC；Review 打开待审 diff；旧概览/DiffLauncher/详情/三点菜单已移除；真实 GUI 已验收 |
| Phase 4 AI 补全 / 内联编辑 | ✅ | Tab ghost text 沿用现有 provider；**Quick Edit 内联编辑已实现**（选中代码 → 指令 → 原/新 diff → 接受/拒绝），浮层可拖动并按视口夹取；按用户要求**不占用快捷键** |
| Phase 5 打磨 | ✅ | 可拖动 diff dock、宽度自适应、composer 防抢焦点、stale/缺失文件空态、文件树拖入输入框、选中代码 Add to Chat、按会话记忆展开；核心 GUI 已验收 |
| Phase 6 开源发布 | ◐ | 名字/图标/locale/README/CI/NOTICE/发布手册已就绪；独立 repo、首推 CI、tag 发布、可选 npm（需小写包名）待执行 |
| 做减法 | ◐ | 已删 SVN、MCP、Unity/系统集成、插件自更新；DAP、VSIX 市场、代码片段、PDF/Office 自定义预览、远程工作区、浮动编辑器/旧桥、死代码待删 |

### 保存策略（本期新增，Cursor/VS Code 对齐）

- 默认 `autoSave = off`：编辑器编辑保持未保存，`Ctrl+S` 才写盘；
- 设置项：`off` / `afterDelay` / `onFocusChange` / `onWindowChange`，延迟默认 1000ms；
- 切换页签不再强制保存；
- 关闭 dirty 页签弹确认；
- `Ctrl+Z` 回到磁盘内容时，dirty 自动清除，不会误报未保存；
- Agent 修改仍直接落盘，Review/Keep/Undo 只负责审查，不承担保存语义；
- 保存策略设置暂存客户端 `localStorage`，后续可迁移到插件 Config。

### 文件链接路由（S1 已落地，Cursor 策略）

- 删除设置项「文件链接使用工具」；
- 不再让用户选择 opener；
- 固定策略：
  - 代码文件 → 插件右侧 Monaco 编辑器；
  - 图片 / Markdown / PDF / Office → DSH 原生预览或系统打开；
- 文件链接路由逻辑保留，避免聊天文件链接与右侧编辑器断开；
- 文件树仍可直接打开插件自己的 Markdown / 图片预览，不受聊天链接策略影响。

### 更新策略（S3 已落地）

- 删除插件内自更新 / 检查更新 / 启动更新提醒；
- 删除 `vscode.updateCheck` / `vscode.updateSelf` RPC 与 `selfUpdate.ts` / `updateNotice.ts`；
- 更新交给 DSH 插件管理器；
- 开源后发布 GitHub Releases + npm 包；
- 可选仅做 GitHub Releases 新版本通知，不自动下载安装；
- 首版不做插件自更新，避免覆盖运行中插件与回滚风险。

### 系统集成移除（S14 已落地）

- 删除「系统集成」设置面板：DSH 服务地址、右键菜单、Unity 一键安装、添加 Unity 项目；
- 删除 launcher / shell 菜单 / Unity bridge / 外部深链（open inbox、open bridge、handoff）；
- 不再支持在 DSH 之外打开本编辑器；
- 删除对应 RPC、设置字段、资源目录与测试；
- 如果未来需要系统级入口，再单独设计稳定协议，不复用当前地址输入框方案。

### SVN 移除（S13 已落地）

- 删除 SVN 设置段（`svnPath` / `tortoisePath`）；
- 删除「SVN 变更」侧边栏、树菜单/页签菜单/命令面板中的 SVN 动作；
- 删除 SVN diff、日志、更新窗口、Tortoise、AI 方案等 RPC 与状态层；
- 删除 SVN 文件树徽标、刷新链路、配置字段与 31 个 SVN 测试；
- 保留通用 diff/review 能力，不受 SVN 移除影响。

### MCP 与设置页精简（S9 / S10–S12 已落地 UI）

- 删除 MCP 管理 Tab、MCP runtime、MCP RPC、会话 MCP 状态 slot 与共享类型；MCP 交由 `dsh-skill-mcp-panel` 管理；
- 设置页重写为五个 Tab：**编辑器**、**AI 补全**、**语言服务器**、**性能优化**、**兼容性**；
- 删除「文件与安装」整段、设置服务不可用红色横幅、文件链接工具、开发形态、更新、快捷键入口；
- 语言服务器 / 性能优化 / 兼容性 Tab 按用户要求保留；
- 设置页标题改为 `CursorLike`；
- 编辑器设置保留：自动保存、自动保存延迟、页签上限、侧边栏最小宽度。

### LSP 诊断落地（2026-10-28）

- 新增 `textDocument/publishDiagnostics` → host 诊断缓存 → `edrv.lsp.diagnostics` RPC；
- 客户端按活动文件轮询并用 Monaco markers 显示错误/警告/信息/提示；
- Monaco 内置 TS/JS/JSON/CSS/HTML 诊断保持独立 owner，不互相覆盖；
- 语言服务器设置页改为「状态表 + 自动检测 + 高级命令/路径」，移除市场/已安装/更新子页；
- 当前真正接入 LSP 的语言仍为 Lua / C#；TS/JS 等依赖 Monaco 内置语言服务；
- 未安装语言服务器时明确降级为「语法高亮 + AI 补全」，不再伪装已启动。

### 已知限制（DSH 原生，非插件导致）

- DSH 原生轮级「文件修改卡片」依赖 Host 提供的 summary；
- **DSH 重启后**，历史轮次 summary 丢失，原生 changed-files 卡片不会显示；
- 插件只替换 `conversation.input.dock`（输入框上方 pending 文件卡），不覆盖聊天流里的原生轮级卡片；
- 插件现有文件卡只表达 **当前 pending 改动**，不承担历史轮次回填；
- 若需要历史轮次也显示，需要 Host 持久化/回填 workspace-changes summary，或另做 turn 历史视图。

### 额外已完成（超出原计划）

- 文件树拖文件/文件夹到输入框 → 生成 `@file/@folder` 引用 chip；
- 选中代码悬浮 **Add to Chat**，带行区间引用；
- 选中代码 **Quick Edit** 内联编辑（无快捷键，浮层可拖动、自动夹取视口）；
- 输入框卡片默认收起，并按会话记忆展开/收起；
- 编辑器“文件不存在 / 会话不存在”友好化，并与旧差异条解耦；
- 输入框卡片 orphan 状态：文件不存在时行内标记，`×` 禁用、`✓` 可清除记录；
- 插件名称、图标、中英文 locale 已更新；
- SVN 设置与全部 SVN 功能已移除。

### 主要未完成

1. **做减法（剩余）**：DAP、LSP 市场（VSIX/Open VSX + `extmgr`）、代码片段、PDF/Office 自定义预览、远程工作区、浮动编辑器/旧侧栏桥、`PluginDetailSection`、`devForm` 等。当前规模：`src` 281 文件 / 约 54.9k 行，测试 201 文件 / 2539 用例（2026-10-28）；
2. **开源发布**：独立 repo、首推 CI、tag 发布（GitHub Release tarball）、README 截图；npm 可选（需先改小写包名/scope）。步骤见 [release.md](release.md)；
3. **AI 真实模型验证**：Tab 补全回归、Quick Edit 生成/接受/拒绝与失败重试；
4. **全量测试回归**：当前 vitest 基线 2539 passed / 14 skipped / 0 failed（2026-10-28），减法后需复跑；
5. **LSP 官方源下载器（A 方案）**：按语言维护官方发行源目录 + 版本/SHA256 校验，首版 LuaLS / Pyright（**暂缓，本轮不动**）。

### 结论

核心 Cursor 体验已基本闭环：

> **输入框待审卡 + 右侧编辑器 + Review/Keep/Undo + Tab 补全 + Add to Chat + Quick Edit + Cursor 式保存策略 + Markdown 原生体感（预览换行开关/图片/窄面板、源码软换行）已实现。**

项目当前状态：

> **已完成迁移改名与文档/CI 整理；剩余减法（DAP、VSIX 市场、snippets、PDF、remote、旧桥等）、开源发布（repo/npm/截图）、AI 真实调用验证与减法后的全量回归。**

---

## 14. 结论

**方向：fork vscode-mode，收敛成 CursorLike。**  
**核心：输入框上方 pending 文件卡 + Undo/Keep/Review + 右侧编辑器 + 聊天/Review 内联 diff + Tab/Quick Edit AI 编辑。**  
**策略：先做减法，再做加法；先保证一条主路径，再补生态。**
