# 发布与安装手册（GitHub / npm）

> 目标：把 CursorLike 发布到 GitHub，并让其他 DSH 用户能装上。
> 本文分两条路线：**最小可用（GitHub Release tarball，无需 npm）** 与 **更顺滑（额外发布 npm 小写包名）**。

## 0. 结论

- DSH 插件管理器支持这些安装 spec（源码核对 `dsh-plugin-manager/lib/types/install-spec.js`）：
  **registry 包名**、**本地绝对路径**（目录或 `.tgz`）、**git 仓库 URL**（`https://github.com/u/r`、`github:u/r`、`git+…`）、**tarball URL**（`.tgz`/`.tar.gz`）。
- 因此**不需要先发 npm**：GitHub Release 附上 `npm pack` 产物，用户用**插件页从 URL 安装**即可。
- npm 路线的唯一障碍是包名：`CursorLike` 含大写，registry spec 解析会直接拒绝；npm 发布需改成小写或 scope（如 `dsh-cursorlike`，2026-10-28 查询 npm 上可用）。

## 1. 发布前（仓内）检查

- [ ] 版本号：`package.json` 的 `version`。tag 必须与之一致（Release 工作流第一步校验 `v<version>`）。
- [ ] 首个公开发行版已是 `0.1.0`；后续发版先改版本再打 tag。
- [ ] README 安装段把 `leifangwen88/dsh-cursorlike` 换成真实地址。
- [ ] 三门本地全绿：
  ```bash
  pnpm typecheck
  pnpm exec vitest run --testTimeout=15000
  pnpm build
  ```
- [ ] `npm pack` 产物必须包含：`package/lib/index.js`、`package/lib/client.js`、`package/cordis.patch.yml`（`pnpm pack` 会先 prebuild + build）。
- [ ] `package.json` 的 `files`、`cordis.patch.yml` 的 `id/name`、`tsdown.config.ts` 的 `ID`、`package.json` 的 `name` **四者一致**；否则客户端会报 `loaded without registering`。
- [ ] `engines.dsh` 区间保持 `>=0.1.0-rc.1 <0.3.0-0`：声明后 peer 兼容检查被忽略，且不满足会**阻断安装**，不要收窄。
- [ ] `.gitignore` 已排除 `node_modules/`、`lib/`、`*.tgz`；LICENSE 保留上游 MIT 声明，`NOTICE` 注明 fork 来源。

## 2. 建 GitHub 仓库并首推（需要你操作）

```bash
git init -b main
git add -A
git commit -m "release: v0.1.0 CursorLike"
git remote add origin https://github.com/leifangwen88/dsh-cursorlike.git
git push -u origin main
```

或使用 GitHub CLI：

```bash
gh repo create dsh-cursorlike --public --source=. --remote=origin --push
```

仓库设置：

- Settings → Actions → General → Workflow permissions：**Read and write**（Release 需要 `contents: write`）。
- 建议 About 填一句话描述 + topics：`dsh`、`dsh-plugin`、`deepseek-harness`、`cursor`、`monaco`、`editor`。
- 首次 push 会触发 CI。**先等 CI 绿再打 tag**。

> CI 跑在 ubuntu：本机 Windows 全绿 ≠ CI 绿。若 CI 失败，优先怀疑测试里的盘符 / 反斜杠路径断言，而不是源码回归。

## 3. 打 tag 触发发布

```bash
git tag v0.1.0
git push origin v0.1.0
```

[.github/workflows/release.yml](../.github/workflows/release.yml) 会依次执行：
tag/版本一致校验 → install → typecheck → test → build → `npm pack` → 校验 tarball 入口 → 创建 GitHub Release 并附上 `dsh-cursorlike-<version>.tgz`。

发布资产 URL 形如：

```text
https://github.com/leifangwen88/dsh-cursorlike/releases/download/v<version>/dsh-cursorlike-<version>.tgz
```

记录：tag 指向的 commit、workflow run id、Release 资产名。

## 4. 其他人如何安装

### A. 插件页从 URL 安装（推荐，无需 npm）

1. DSH → 设置 → **插件** → **安装**；
2. 粘贴上面的 Release tarball URL；
3. 安装完成后**重启 DSH**（Host 半不热载）。

> tarball 已含构建后的 `lib/`，不需要构建；若某依赖带安装脚本被 pnpm 拦截，插件页会提示「允许这些脚本并重试」。

### B. 从 GitHub 仓库安装（开发者 / 尝鲜）

spec 填 `https://github.com/leifangwen88/dsh-cursorlike`（或 `github:leifangwen88/dsh-cursorlike`）：

- 会 clone 源码并运行 `prepare`（prebuild + build），首次安装较慢；
- 可能触发依赖构建批准；
- 适合想直接跟 main 的开发者。

### C. 命令行（仅非 desktop profile）

```bash
dsh plugin --profile <profile-name> add <tarball-url>
dsh plugin --profile <profile-name> add github:leifangwen88/dsh-cursorlike
```

`dsh plugin` 只是把参数转发给 profile 目录里的 pnpm，**不会自动选中组合包**；是否启用请以插件页/`plugin_manager` 为准。desktop profile 被 CLI 拒绝（由 Electron 应用独占管理），桌面用户走 A。

### D. npm（可选，见下一节）

发布 npm 后可 `dsh plugin add dsh-cursorlike`，或插件页按包名安装/搜索。

## 5. npm 路线（可选，体验最顺滑）

### 5.1 全链路改小写包名

registry spec 只接受小写包名。以 `dsh-cursorlike` 为例，需要同步：

1. `package.json`：`name`、`description`、`files`（`skills` 已移除）；依赖它的 profile 名称也会变。
2. `tsdown.config.ts`：`const ID = 'dsh-cursorlike'`（**必须等于安装名**）。
3. `cordis.patch.yml`：`id` 与 `name` 都改为 `dsh-cursorlike`。
4. `src/index.ts`：`export const name = 'dsh-cursorlike'`。
5. `locale/zh.json`、`locale/en.json`：`meta.title`（可选 `description`）。
6. 测试里的包名断言（如 `tests/pluginMeta.test.ts`）与 README/docs 安装示例。
7. 本机 profile：依赖名、`dsh.profile.bundles` 同步改名，重启验证。
8. `src/paths.ts` 的 `PLUGIN_ID` 可继续保留 `dsh-vscode-mode`（历史归档 / 缓存路径兼容），用注释说明。

检查名字是否可用：`npm view dsh-cursorlike version`（返回 404 即未占用）。

### 5.2 在 CI 里发布 npm（禁止本地 publish）

1. 仓库 Settings → Secrets and variables → Actions 添加 `NPM_TOKEN`（npm automation token）。
2. 在 `release.yml` 的 Release 步骤之后追加 publish 步骤（沿用上游经验，tag 触发、上传后回读校验）：
   - `npm publish --access public`
   - 发布后读取 `https://registry.npmjs.org/<pkg>/<version>`：version、`dist-tags.latest`、`gitHead == tag commit`；
   - 下载 `dist.tarball` 校验 integrity 与 `package/lib/index.js`、`package/lib/client.js` 入口。
3. npm 首次发布可能需要等待数分钟公开；`Verify` 超时只代表窗口内未完成，先查 registry 元数据再决定动作。

### 5.3 市场收录（可选）

DSH 插件市场索引支持 npm（`name@version` + registry）与 git（`git+<url>#<commit>`）两种条目。发布 npm 后可以向社区索引（如 dshmarket / dshbase 等）提交收录；不收录也不影响按 URL/包名安装。

## 6. 常见坑

| 现象 | 原因 / 处理 |
|---|---|
| `gh` / `git push` 直连 GitHub 超时，但浏览器能打开 | gh 与 git 不读取 Windows 系统代理（WinINET）：先 `curl -x http://127.0.0.1:<端口> https://github.com` 验证本机代理，再用 `HTTPS_PROXY` 重试：`$env:HTTPS_PROXY='http://127.0.0.1:<端口>'`；git 可只对 GitHub 配代理：`git config --global http.https://github.com.proxy http://127.0.0.1:<端口>`（不要配全局代理，避免影响公司内部 git） |
| 插件页输入 `CursorLike` 报 invalid spec | registry spec 只接受小写；改用 tarball URL / git URL，或改小写后发 npm |
| Release 工作流第一步失败 | tag `vX.Y.Z` 与 `package.json.version` 不一致 |
| 安装后功能缺失 / 客户端不加载 | tarball 缺 `lib/`；确认 pack 前先 build（`pnpm pack` 已内置），且 `tsdown ID == 安装名 == cordis.patch name` |
| CI 绿但用户装后报 peer 错误 | 用户 DSH 版本不在 `engines.dsh` 区间会被**阻断**；确认目标 DSH 为 0.1.x/0.2.x |
| 桌面端 `dsh plugin` 报错 | desktop profile 由 Electron 应用独占，改用插件页 |
| 安装卡在构建脚本 | pnpm 11 默认拦截依赖脚本；插件页点「允许这些脚本并重试」 |

## 7. 版本与后续

- 每次发布：改版本 → commit → CI 绿 → 打 tag → Release。
- 不覆盖已发布 tag/版本；修复用新 patch 版本。
- 首次公开发布后，建议把 README 的安装示例固定到具体版本 tag，并在 Release notes 写清 DSH 兼容版本。
