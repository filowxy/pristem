# pristem hand-off — 下一个会话从这里开始

生成：2026-11-16 · 工作目录 `d:\projects\pristem` · 当前分支状态：**不是 git 仓库**

---

## 0. 开工步骤（按顺序，带完成标准）

### 0.1 读上下文

依次读：

1. `AGENTS.md` — 架构边界与不可破坏的 invariant。
2. `task_plan.md` — Phase 1–7 的计划与状态。
3. `findings.md` — 原始 IDE 缺口审计（G1–G15）。
4. `progress.md` — 上一会话的验证记录。
5. `pristem-desktop/bug_log_optimize.md` — 已修 bug 与已知限制。
6. 本文件的 §1–§4。

**完成标准**：能复述“shell 拥有 files/terminal/git IO、kernel 拥有 mode 语义、IDE 模式零 AI 元素、
删除进 `.pristem/trash`、不新增 npm 依赖、i18n 双字典”这六条。

### 0.2 建立构建基线

```powershell
cd d:\projects\pristem\pristem-desktop\ui
pnpm build

cd d:\projects\pristem\pristem-desktop\shell
cargo test
cargo build
```

**完成标准**：`pnpm build` 成功；`cargo test` **16 passed**；`cargo build` 产出
`pristem-desktop/shell/target/debug/pristem-desktop.exe`。

### 0.3 全量 E2E 回归（必须每套一个全新服务）

先确认端口干净：

```powershell
Get-Process -Name pristem-desktop -ErrorAction SilentlyContinue | Stop-Process -Force
```

每套用同一模式（PowerShell 5）：

```powershell
$svc = Start-Process -FilePath 'D:\projects\pristem\pristem-desktop\shell\target\debug\pristem-desktop.exe' -ArgumentList '--no-window' -PassThru
Start-Sleep -Seconds 4
try { node 'D:\projects\pristem\pristem-desktop\.visual-check\check.cjs' }
finally { Stop-Process -Id $svc.Id -Force -ErrorAction SilentlyContinue }
```

把 `check.cjs` 依次换成：

| 顺序 | 套件 |
|---|---|
| 1 | `.visual-check/check.cjs` |
| 2 | `.visual-check/_explorer-selfcheck.cjs` |
| 3 | `.visual-check/_search-selfcheck.cjs` |
| 4 | `.visual-check/_phase4-selfcheck.cjs` |
| 5 | `.visual-check/_effects-selfcheck.cjs` |
| 6 | `.visual-check/_terminal-selfcheck.cjs` |
| 7 | `pristem-desktop/scripts/smoke.mjs` |

**完成标准**：所有套件 `0 FAIL`。把每套的实际计数写进 `progress.md`。
kernel 只有 4 个 worker slot，**不要复用服务跑第二套**；旧服务占着 8787 会让新服务随机端口，
套件却仍打 8787，结果不可信。

### 0.4 如果 explorer 套件报 `element is inert`

先停，按 §4.1 诊断；不要用 `force: true` 绕过。完成标准：找到是哪个 modal 把
`.workbench` 设为 inert，或证明干净环境下不再复现并记录证据。

### 0.5 收尾

更新 `progress.md`（2026-11-16 一条），把 `findings.md` 已完成的项标 fixed，
清理 §4.4 的调试产物。完成标准：文档状态与代码/测试一致。

---

## 1. 已完成（代码已落地，等待 §0.3 全量确认）

### 1.1 设置页 / 模型管理（用户重点）

- 新增 `shell/src/models.rs`：
  - 端点目录 `%APPDATA%\pristem\models.json`；API key 用 **Windows DPAPI (CurrentUser)** 加密存
    `%APPDATA%\pristem\model-keys.bin`。
  - `models::apply(&mut KernelConfig)` 在 kernel registry 创建前合并自定义端点并注入 key。
  - IO op：`models.get` / `models.save`（含 delete）。
  - 单测：`id_and_url_validation`、`dpapi_round_trip`。
- 新增 `ui/src/components/ModelSettings.tsx`：
  - 当前模型 / demo 横幅 / 端点行 / 设置密钥 / 编辑 / 删除 / 切换。
  - “添加模型” = Trae 风格服务商网格（15 个预置）→ 表单（API 格式、请求地址、模型 ID、
    展示名称 0/64、API key 显示/隐藏）。
  - 保存后提示“重启 pristem 后生效”。
- **修复“没输入 key 却显示密钥已就绪”**：
  - 根因：demo 模式 `main.rs` 注入 `local-demo` 假 key，kernel `ProviderInfo.key_present` 变 true，
    旧设置页直接读它。
  - 现在设置页读 `models.get`（`demo` + 真实 `key_source`），demo 显示离线演示横幅。
  - kernel 的 `key_present` 在 demo 下仍可能为 true；**设置页不再用它判断密钥**。
- 删除死行：`传输状态`、不可用的 `重新连接`、静态 BYOK 说明。
- 左侧设置导航点击会滚动到对应 section。
- 字号 / Tab 宽度改数字输入（回车/失焦提交，越界 clamp）：
  baseFont 11–18，editorFontSize 8–32，tabSize 1–8，terminalFontSize 8–32。
- 删除 AI 空状态三个静态建议 chips；`ai.seed1..3` 已从双字典移除。
  goal 模式的 `GOAL_STARTERS` 保留（有意模板）。
- 菜单栏从“仅 IDE”改为**所有模式可见**；`check.cjs` 对应断言已改。
- 快捷键页：`KEYMAP` 改 i18n；命令表改为实时 `commands` 传入，不再手写副本。
- `livingIntensity` 滑块接到 `living.ts`（缩放 `--living-gain`），设置改变立即 `refresh()`。

### 1.2 编辑器 / 终端手感（G5/G6/G7/G14/G15）

- 格式化文档（Shift+Alt+F）/ 整理导入（Shift+Alt+O）：命令表 + Edit 菜单 + Monaco 内置 action。
- 标签溢出下拉：ResizeObserver 检测 `.editor-tabs`，右上角弹出全部标签。
- Ctrl+Tab / Ctrl+Shift+Tab 循环当前 group 标签，并派发 `pristem:editor-focus`。
- 终端“回到底部”：同时监听 `term.onScroll` 与 `.xterm-viewport` 原生 `scroll`，
  用 DOM viewport 判断（`scrollTop + clientHeight < scrollHeight - 4`）。

### 1.3 文件操作（G1/G2）

- shell 新增 `fs.copy`（递归、拒绝 exists / into itself / 越界 / 保护区），
  单测 `copy_roundtrip_and_guards`。
- `shell.capabilities` 增加 `fsCopy`；UI caps 同步。
- Explorer 拖拽移动（目录行 / 根节点 / 树空白区）；拒绝移入自身或子目录。
- 右键 + Ctrl+C/X/V：内部路径剪贴板；复制自动命名 `name copy.ext`，剪切同名中止；
  剪切项半透明；结果用 `.tree-notice` 提示。
- 右键菜单现在 10 项。

### 1.4 搜索增强（G3/G4）

- `fs.search` / `fs.replace` 支持 `paths: string[]` 精确过滤（shell `path_scope`）。
- 搜索范围三态：工作区 / 打开的编辑器 / 当前文件夹。
  “当前文件夹”用 `${folder}/**` 并**覆盖**手写 include（scope 优先，避免 union 放大范围）。
- 替换确认框显示按文件计数预览（最多 10 行）。
- 点击搜索结果用 `openFile(p, true)`，侧栏保持搜索视图。

### 1.5 外部变更监听（G9）

- `io.rs` 轮询 watcher：`tree_signature`（path/len/mtime，≤4000 文件）每 1.5s 比较，
  变化时 emit `fs.changed`；`main.rs` 启动 `io::spawn_watcher`。
- UI `fs.changed` 新增 `refreshCleanBuffers()`：只重读**非 dirty** 的打开文件；
  dirty buffer 不被磁盘覆盖。
- 单测 `tree_signature_tracks_external_writes`。

---

## 2. 测试真实状态（不要当成全绿）

| 检查 | 最近结果 | 是否在最新代码上跑过 |
|---|---|---|
| `cargo test` | **16/16 通过** | 是（watcher 后） |
| `pnpm build` | 通过 | 是（watcher / refreshCleanBuffers 后） |
| `check.cjs` | **135/136** | 否：唯一失败是 Edit 菜单 `>=9`，已改 `>=8`，改后未重跑 |
| `_explorer-selfcheck.cjs` | 21/21 | 否：watcher 后一次运行首次 `expand('__p2__')` 报 `element is inert`；调试环境未复现，watcher 新断言未通过过 |
| `_search-selfcheck.cjs` | **19/19 通过** | 是 |
| `_phase4-selfcheck.cjs` | 14/14（旧） | 否 |
| `_effects-selfcheck.cjs` | 35/35（旧） | 否 |
| `_terminal-selfcheck.cjs` | 6/6（旧） | 否（API 级，UI 滚动改动不影响它） |
| `scripts/smoke.mjs` | 15/15（旧） | 否 |

`check.cjs` 当前预期条数约 138（128 + 模型 5 + 数字 1 + 终端滚动 2 + Ctrl+Tab/溢出 5 + Edit 菜单 1，
以实际输出为准）。

---

## 3. 已知未决问题

### 3.1 Explorer `element is inert`（优先）

- 现象：watcher 后第一次跑，`expand('__p2__')` 时按钮 inert，30s 超时。
- 调试：同构建、干净服务下 `.workbench.hasAttribute('inert') === false`，无法复现。
- 可能来源：palette / settings / save-prompt / path-dialog / task-picker 任意 modal 未清理。
- 诊断步骤：杀干净进程 → 确认 8787 无旧服务 → 重跑；若复现，打印
  `.workbench.inert`、`[role="dialog"]`、`.palette/.settings-page/.save-prompt/.path-dialog/.task-picker` 数量。

### 3.2 桌面 ConPTY 仍回退到 pipe shell（用户现场）

- 现场：`[term] powershell unavailable under ConPTY (… no output within 1.2s); using the piped fallback`。
- 事实：`pwsh` 不存在；Windows PowerShell 5.1 报 `0xC0000142`；cmd ConPTY 重试也失败。
- 已做：`term.rs` 日志现在会打印 `cmd retry failed (...)` / `skipped`，下次桌面运行可拿到 cmd 失败原因。
- 下一步（记录在 `bug_log_optimize.md`）：试 ConPTY 分支去掉 `CREATE_NO_WINDOW`（保留
  `SetErrorMode`），用用户桌面验证；成功再按 shell 分情况 gate。

### 3.3 需要重启才生效

kernel provider registry 只在启动时构建。新增/修改模型、换 key、删除模型都要重启 pristem。
设置页已明确提示；不要临时加热重载。

### 3.4 模型语义

- 给内置 endpoint 设置 key 会在 `models.json` 生成同 id 的 custom override；列表 source 变 custom，
  删除 override 回到内置配置。预期行为。
- `models.save` 的 id 允许覆盖内置 id；UI 只对 custom 行显示编辑/删除。

### 3.5 仍 deferred（本次未做）

- G10 `.gitignore` 搜索支持（需要 ignore parser）。
- G11 终端 profiles、G13 git 写操作（owner deferred）。
- G12 多行粘贴警告（收益低）。

---

## 4. 参考

### 4.1 构建/命令陷阱

- Rust 改动后必须 `cargo build`；只跑 `cargo test` 不会更新 exe。
- `cargo build` 报 `failed to remove ... pristem-desktop.exe`（os error 5）：
  先 `Get-Process -Name pristem-desktop | Stop-Process -Force`。
- 从 `shell/` 目录跑 `pnpm --dir ui build` 会解析成 `shell/ui`；用绝对路径或先 cd 到 `ui/`。
- 端口 8787 被旧服务占用时，新服务随机端口，但套件仍打 8787 → 测到旧服务。跑前确认进程干净。

### 4.2 模型 / 密钥

- 存储：`%APPDATA%\pristem\models.json`（无密钥）+
  `%APPDATA%\pristem\model-keys.bin`（DPAPI blob）。
- 校验：id 小写字母/数字/`.`/`-`/`_`，首字符字母或数字，≤48；
  adapter ∈ `openai-chat` / `openai-responses` / `anthropic-messages`；
  base_url `http(s)://`，≤500，去尾 `/`；key ≤512，无控制字符。
- `models::apply`：providers 为空时先展开内置 trio，再合并 custom，最后注入 key 并应用 default。
- 模型改动重启后生效；`models.get` 的 `runtime` 来自启动时 `AppState.runtime_models`。

### 4.3 Watcher / 搜索 / 终端

- Watcher 是轮询（`ponytail:` 1.5s / 4000 文件），不是 ReadDirectoryChangesW。
  `walk_files` 跳过 `target`、`node_modules`、`.git`、`dist`、`.pristem`。
- 外部写文件后树在 ≤1.5s + 渲染时间内出现；测试等 2.8s。
- 搜索 scope：“当前文件夹”覆盖手写 include；“打开的编辑器”用精确 `paths`；
  替换带同样 `paths`，不会改范围外文件。
- 终端滚动按钮条件：`tab==='terminal' && activityOpen && scrolledUp[activeId]`。
- 标签溢出按钮绝对定位在 `.editor-pane` 右上；`.editor-tabs.has-overflow` 右侧留 30px。

### 4.4 调试产物 / 清理

本次产生，可删：

- `artifacts/debug-scroll.cjs`
- `artifacts/debug-inert.cjs`
- `artifacts/debug-explorer.cjs`
- `artifacts/test-appdata/`
- `artifacts/test-svc.log`、`artifacts/test-svc.err`
- 工作区残留 `__p2__` / `__p2dir__`（被中断的 explorer 测试）跑测试前清理。

旧 i18n/CSS 可后续清理（不影响构建）：`provider.*`、`settings.transportHint`、
`settings.reconnectUnavailable`、`settings.editor.prompt`、`settings.sourceColumn`、
`.provider-*`。

### 4.5 文件地图（本次改动）

| 文件 | 改动 |
|---|---|
| `shell/src/models.rs` | 新增：目录 / DPAPI / apply / describe / save |
| `shell/src/main.rs` | AppState 新字段；`models::apply`；watcher 启动 |
| `shell/src/io.rs` | `models.*`、`fs.copy`、`path_scope`、watcher、单测 |
| `shell/src/term.rs` | ConPTY 回退日志补 cmd 错误 |
| `shell/Cargo.toml` | `Win32_Security_Cryptography` feature |
| `ui/src/components/ModelSettings.tsx` | 新增：模型管理 UI |
| `ui/src/components/SettingsPage.tsx` | 接 ModelSettings；数字输入；动态命令表；KEYMAP i18n；导航滚动 |
| `ui/src/App.tsx` | 菜单栏全模式；`openFile(path, keepView)`；`refreshCleanBuffers`；Ctrl+Tab；`fsCopy` |
| `ui/src/workspace.tsx` | 树拖拽/复制/粘贴；终端回底；标签溢出；Monaco format/organize |
| `ui/src/components/Panels.tsx` | 搜索 scope + 替换预览 + `paths` |
| `ui/src/commands.ts` | `edit.format` / `edit.organizeImports` |
| `ui/src/types.ts` | `ModelInfo` / `ModelsState`；`fs.copy` / `paths`；`fsCopy` |
| `ui/src/localSettings.ts` | 字号/Tab 改 number + clamp |
| `ui/src/living.ts` | `refresh()`；intensity 缩放 |
| `ui/src/views.tsx` | 删除静态 AI 建议 chips |
| `ui/src/i18n.ts` | 新增 `models.*`/`keymap.*`/`search.scope*`/`tree.*`/`terminal.scrollBottom` 等，双字典 |
| `ui/src/styles.css` | `.model-*`、`.number-field`、`.tabs-overflow-*`、`.term-jump-bottom`、`.tree-*`、`.search-scope` |
| `.visual-check/check.cjs` | 模型/数字/滚动/Ctrl+Tab/溢出/Edit 菜单断言 |
| `.visual-check/_explorer-selfcheck.cjs` | copy/cut/paste、drag-drop、watcher |
| `.visual-check/_search-selfcheck.cjs` | scope、preview、保持搜索视图 |
| `task_plan.md` | Phase 1–7 状态 |
| `bug_log_optimize.md` | 桌面 ConPTY 未决项 |

### 4.6 下一步优先级

1. §0.3 全量 E2E；先修 explorer inert（若复现）。
2. 桌面 ConPTY 验证（§3.2）。
3. 更新 `progress.md` / `findings.md` 状态。
4. 清理 §4.4。
5. 剩余 deferred：G10 / G11 / G12 / G13。

---

## 5. 一句话状态

功能代码已落地，`cargo test` 16/16、search 19/19、explorer 21/21（watcher 前）；
尚未在最新代码上完成一次全量 E2E，explorer inert 与桌面 ConPTY 回退需要下一会话确认。
