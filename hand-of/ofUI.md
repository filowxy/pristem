# pristem 桌面客户端 UI 改进 — 会话交接（下次打开先读这份）

> 整理日期：2026-11-16
> 目的：下一场会话不必依赖聊天记录即可接着干。
> 当前工作稿：`C:\Users\ASUS\.qoder-cn\plans\grassy-vale-lark.md`（plan-mode 计划文件，含完整 findings log；本交接只是入口）
> 自动交接：关闭

## 0. 概览

正在 plan mode 下做 pristem 桌面 UI 改进，三阶段：Inspect → Plan（待用户确认）→ Implement。（来源：对话）
Phase 1 检查已完成（spec-lens 代码审查 +  live 浏览器实测）；完整发现记录在工作稿 plan 文件里（CT/K/O/S/L 编号）。（来源：grassy-vale-lark.md）
当前焦点：Phase 2 triage —— 把发现归类成 P0/P1/P2/out-of-scope，**尚未写入** plan 文件的 Triage 节，也**尚未** AskUserQuestion / ExitPlanMode。（来源：grassy-vale-lark.md，Triage 节为空）
下一步：完成 triage → 就 owner 决策项 AskUserQuestion → ExitPlanMode 等确认 → 才进 Phase 3 实现。（来源：对话）
最大阻塞：另一个 Qoder 会话正在并发改 `ui/src` 并反复重启 8787 服务；源码行号会漂移，live 实测受端口竞争干扰。（来源：对话「another section is also changing」）
两个已 live 坐实的 P0：deepsleep 模式行泄露原始 i18n key（S-1）、切换失败后用户被困死（S-17）。（来源：grassy-vale-lark.md S-1/S-17）

| 编号 | 一句话标题 | 状态 | 依赖 |
|------|------------|------|------|
| T1 | pristem 桌面 UI 改进（inspect→plan→confirm→implement） | 进行中（Phase 1 完成，Phase 2 triage 待写） | — |

当前焦点：T1

## 1. 任务是什么

改进 pristem 桌面客户端 UI，严格三阶段（来源：对话）：
- **Phase 1 Inspect**：先读设计契约，再用两个视角审查 —— (a) Spec lens：把现有前端对照契约找偏差/毛刺/缺失态；(b) Fresh-eyes lens：像首次用户一样实际运行客户端，记录每一处犹豫/迷路/等待。**边查边记 running log，不过滤**，triage 留到最后。能运行就运行，别只凭代码判断。
- **Phase 2 Plan**：优先级清单，每项 = 问题(带证据)/拟改/风险。P0=可用性 bug & 契约违规；P1=布局/视觉层级/模式切换清晰度；P2=打磨(间距/字体/微反馈)。**Out-of-scope**（内核/API 缺口、契约缺陷或矛盾、感知性能、无障碍）只报告不修、不静默绕过。**等用户确认后才改代码**。
- **Phase 3 Implement**：只输出改动部分，不整文件重写；变更清单 file→what→why；验证 build/smoke 仍通过并报告。

角色：UI 层改进者；内核与 Mode Router 不在编辑范围。（来源：对话）
交付物：plan 文件（工作稿）→ 确认后的小步代码改动 + 验证结果。（来源：对话）

## 2. 必须遵守的约束

1. 六模式语义与 spatial-honesty 规则在实现层是**最终**的；若认为契约本身有错/不全，作为 finding 写进 out-of-scope 附证据，由用户定夺。（来源：对话）
2. 低密度 UI，不堆按钮（优先直接操作）；AI 休眠时存在感**完全收起** —— 不留灰掉的面板或空聊天占位。（来源：对话）
3. 内核 / Mode Router 不可编辑；UI 问题若溯源到它们，只报告，**绝不在 UI 层 hack 绕过**。（来源：对话）
4. OPEN QUESTION 项：最小实现 + 一个 flag，不自作主张给 elaborate 答案。（来源：对话）
5. plan 文件要**增量写**（running log 边查边长，最后才 triage），不要一次性 dump 整份计划。（来源：对话「you shouldn't write the plan in once」）
6. Plan mode：除 plan 文件外只读；本交接文件是用户显式要求写的例外。（来源：对话 + 系统 plan-mode 约束）
7. AGENTS.md 不变量：不新增 npm 依赖；Rust 依赖只用 Cargo.lock 已有；删除=移到 `.pristem/trash`；i18n key 必须**两个词典都加**；注释英文、`ponytail:` 标短路；L2 静态检查保持绿。（来源：agents.md）
8. 并发尊重：另一个会话在改同一仓库并重启 8787 服务；**不要杀不是自己启动的进程**，只清理自己创建的 scratch。（来源：对话 + 本会话操作）

## 3. 依据材料

| 材料 | 路径/说明 | 本任务里怎么用 | 来源 |
|------|-----------|----------------|------|
| 工作稿 plan 文件 | `C:\Users\ASUS\.qoder-cn\plans\grassy-vale-lark.md` | 完整 findings log（CT-1..5 / K-1..10 / O-1..7 / S-1..36 / L-1..8）；Triage 节待填 | grassy-vale-lark.md |
| 交互契约 | `pristem-desktop/UX_SPEC.md`（2234 行） | 模式切换状态机 §1、键盘 §7.1、helping 布局 §7.6/§9.3、overlay | 对话指认 + 已读 |
| 视觉契约 | `pristem-desktop/DESIGN_SYSTEM.md`（2517 行） | §8.11 新形态+Δ1–32 表、§8.12 W1–11 权威文案+禁词、§8.13 IDE、§9 验收(B/C/D/E/F/G/H/N/M)、附录 A/B | 已读 |
| 开放问题 | `pristem-desktop/BUILD_NOTES.md` | OPEN QUESTION、协议缺口、内核行为 | 已读 |
| 已知 bug log | `pristem-desktop/bug_log_optimize.md` | O-5 模式切换 click race（failed latch，"proper fix not done"）、终端 pipe fallback | 已读 |
| 发现 log | `findings.md`（仓库根） | T1–T16 终端、G1–G15 IDE 缺口 | 已读 |
| 项目约定 | `agents.md`（仓库根） | 构建/测试命令、不变量、终端事实、文件位置表 | 已读 |
| UI 源码 | `pristem-desktop/ui/src/{i18n.ts,views.tsx,App.tsx,styles.css,polish.css,commands.ts,workspace.tsx}` | spec-lens 证据 | 已读/grep |
| UI 组件 | `pristem-desktop/ui/src/components/{LeftRail,ChromeExtras,MenuBar,SettingsPage}.tsx` | 左栏/标题栏/菜单/设置证据 | 已读 |
| Shell | `pristem-desktop/shell/src/{main.rs,server.rs}` | 端口绑定 main.rs:182–184（8787→随机回落）、静态服务 server.rs:150（从磁盘读 dist） | 已读 |
| E2E | `pristem-desktop/.visual-check/check.cjs` 等 6 套 + `scripts/smoke.mjs` | F9 状态栏断言在 coding 模式测（漏 IDE）、dead-class 查 `.activity-bar`（漏改名后的 `.activity-rail`） | 已读 |

注：用户最初指名的 `workbuddy-ui-design.md` **不存在**，已用 UX_SPEC + DESIGN_SYSTEM 替代并声明（CT-1）。（来源：grassy-vale-lark.md CT-1）

## 4. 当前进度

**已完成（Phase 1）**（来源：grassy-vale-lark.md + 本会话操作）：
- 契约 + 已知问题 log 全读。
- Spec-lens 代码审查（subagent 被禁用→改为主代理顺序 grep/read）；发现 S-1..S-36 已写入 plan。
- Live fresh-eyes 实测：用改名副本 `pristem-inspect.exe` 起隔离 headless 服务，browser-use MCP 驱动（viewport 隐藏 0x0→无法截图/量布局，改用 evaluate_script DOM/computed-style 探针）。发现 L-1..L-8 已写入 plan。
- 实测后已停掉自己的服务、删除 scratch exe；8787 留给另一会话。

**当前工作稿以 plan 文件为准**；不要回退到聊天记录里的旧行号（并发会话在改源码，行号已漂移，例如 i18n.ts 的 `t()` 现在在 1040–1049，views.tsx StatusBar 现在在 872–940）。（来源：本会话 grep/read）

**未完成**：Phase 2 triage（P0/P1/P2/out-of-scope 归类 + 每项 evidence/change/risk）**尚未写**；owner 决策项尚未问；ExitPlanMode 尚未调用；**零代码改动**。（来源：grassy-vale-lark.md Triage 节为空 + 对话）

### 关键发现摘要（详情见 plan 文件对应编号）

已 live 坐实的 P0：
- **S-1**：deepsleep 模式菜单行 hint 渲染**原始 key 字符串** `common.contentUnavailable`（不是译文）。双重 bug：(a) `modeHint.deepsleep` key 缺失（只有 Left/Right，i18n.ts:146/654）；(b) `t()` 回落写错 —— i18n.ts:1042 `if (s===undefined) s='common.contentUnavailable';` 赋的是**字面 key**而非查 `dict[current]['common.contentUnavailable']`（该值存在于 i18n.ts:37/543）。→ 任何缺 key 都泄露原始路径；扫"内容暂不可用"的 E2E 漏检。修：补 `modeHint.deepsleep`=W2 原文 + 修 t() 查值回落。（来源：live DOM + i18n.ts）
- **S-17**：切换失败后**用户被困死**。复现：deepsleep→IDE 内核无响应→超时进 `phase:'failed'`（`.mode-menu-error`「内核没有回应这次切换…重试」）；此后点 coding 行无反应、关菜单重开再点仍无反应、Retry 只重试同一死目标 IDE 又失败；**只有刷新页面(新会话)才能逃**。根因 UI：`switchMode` 仅 `phase==='idle'` 才执行（App.tsx:480–489），phase 只在 `mode_changed` 重置（206–224）。failed 时 `pending=false` 行看起来可点并调 onSwitch，但 switchMode 空转。修(UI-only)：点不同模式行/重开菜单时清 failed 起新 intent。（来源：live 复现 + App.tsx/views.tsx:910）

P1（live 或 static 坐实）：
- **S-2** wake briefing 空/null/>5 态错（views.tsx DeepsleepView；demo 种子 3 条规则→空/null 从未被测）；**S-4** `.sleep-log-sep` span 渲染但**空**且无 CSS→行读「已归档22:33」无分隔（M12 regex 失败）；**S-7** deepsleep **8 个 infinite 动画**（living-halo/ambient/breath/P/sleep-tick×4）vs D2 ≤1；**S-15** 切换 pending **三处**同时显示（views.tsx:877/915/919，live「正在切换到」×3）vs Δ6 只行尾；**S-28** 左栏是**竖直纯图标条** `.activity-rail`（LeftRail.tsx，flex column）vs 契约水平 icon+text `.view-seg`（`.view-seg`/`.left-rail-head` 全 src 不存在）—— 正是用户不喜欢的 VSCode 图标条；**S-32** IDE 状态栏渲染 Ln/Col+DocPickers（views.tsx:882–888）vs F9 应只在 doc-strip；**S-14** toast `bottom:38px` 右下 vs Δ25 `top:76px` 右上；**S-21** settings-row 2 列 vs Δ9 4 列；**S-27** 骨架 3 行(会话条并入标题栏) vs 契约 4 行。（来源：grassy-vale-lark.md + live + 源码）

P2：S-8 死 `help.*` 块含禁词、S-9 硬编码 10px、S-19 cost 文案逗号 vs W7 中点(live 坐实)、S-22/23/24/25/26 设置字体/圆角/beam、S-29 conn badge 不可点(SPAN/none，live)、S-31/S-36 MenuBar 第二个 window keydown 违反「exactly one」不变量。（来源：grassy-vale-lark.md）

Out-of-scope 候选（只报告）：K-1 内核 confirm 先于 6×6 表、K-2 Error 缺 session、K-3 无 Usage 事件(vitals 永不渲染)、K-5 worker_slots=4 易耗尽、K-8 桌面 ConPTY 失败回落 pipe(live 坐实)、S-17b deepsleep→IDE 内核无响应、CT-2/C1 helping 控制台位置契约自相矛盾、CT-3 树展开层数 2/4/1 三说、CT-4/CT-5 契约文档漂移。（来源：grassy-vale-lark.md）

## 5. 已拍板的事实

| 事实 | 来源 |
|------|------|
| 契约用 UX_SPEC + DESIGN_SYSTEM 替代缺失的 workbuddy-ui-design.md | grassy-vale-lark.md CT-1 |
| T11 Ctrl+` 折叠**已实现**(App.tsx:1382–1388)→O-2 CLOSED | App.tsx |
| T12 term.clear **已存在**(workspace.tsx:1712)→O-3 CLOSED | workspace.tsx |
| T13 term.new **已存在**(commands.ts:96)→O-4 CLOSED | commands.ts |
| S-5 空执行链在 deepsleep **不渲染**(live chainHeadExists=false)→降级，M2 运行时满足；旧 static 断言不复现 | live DOM |
| S-6 vitals 在 deepsleep 不渲染(live vitalsExists=false)，被 K-3 掩盖 | live DOM |
| intensity 公式只在 .app-shell 定义一次；spectrum 只 .app-shell::after；禁词在活字符串中 absent | grassy-vale-lark.md S-13 |
| `common.contentUnavailable` 值存在(zh:37/en:543)，但 t():1042 赋字面 key 而非查值 | i18n.ts |
| shell 从磁盘读 dist(server.rs:150)，故旧 exe 也服务新 dist；exe 无 --port，8787 占用则随机回落(main.rs:182–184) | server.rs/main.rs |
| 本会话 live 用的隔离服务已停、scratch exe 已删；未碰另一会话进程 | 本会话操作 |

## 6. 待确认 / 未完成

| 序号 | 事项 | 谁提供 | 用在哪 | 来源 |
|------|------|--------|--------|------|
| 1 | 完成 Phase 2 triage（P0/P1/P2/out-of-scope，每项 evidence/change/risk）写入 plan Triage 节 | 下一场会话 | ExitPlanMode 前 | grassy-vale-lark.md（Triage 空） |
| 2 | C1/CT-2 helping 控制台位置：DESIGN §7.3「stage 底部通栏」vs UX_SPEC §9.3/AGENTS/代码「文件树列下半」——契约矛盾，helping hint 文案已选边「执行流停靠在文件树下方」 | 用户定夺 | out-of-scope + 是否改文案/布局 | grassy-vale-lark.md CT-2/S-1b |
| 3 | S-27 骨架：保留合并 3 行(现状)还是恢复契约 4 行(独立会话条 28px) | 用户定夺 | P1 布局 | grassy-vale-lark.md S-27 |
| 4 | S-28 左栏：保留竖直图标条(现状)还是改契约水平 icon+text `.view-seg` | 用户定夺 | P1 布局 | grassy-vale-lark.md S-28 |
| 5 | S-10 `.goal-template` 命名漂移：契约说已删，代码复用为 3 starter chips，check.cjs 已改断言 | 用户定夺 | P2/契约 hygiene | grassy-vale-lark.md S-10 |
| 6 | W2 原文（`modeHint.deepsleep` 应填的权威文案）需从 DESIGN §8.12 取 | 下一场会话读契约 | S-1 修复 | grassy-vale-lark.md S-1 |
| 7 | OPEN QUESTION 项最小实现+flag 的具体清单 | 用户/契约 BUILD_NOTES | Phase 3 | 对话约束 4 |
| 8 | 部分发现仅 static 未 live（S-32 IDE 状态栏因连接降级未进 IDE；S-2 wake 空/null demo 不触发；S-14/21/22 toast/设置布局因 viewport 0x0 未量） | 下一场会话补测(可选) | triage 证据强度 | grassy-vale-lark.md L 节 |
| 9 | 并发会话改源码→行号/结论可能漂移；triage 前对要修的关键项重读当前源码核对 | 下一场会话 | 避免按旧行号改 | 对话「another section is also changing」 |

## 7. 下一场会话建议

1. **先读本交接**，再读工作稿 `C:\Users\ASUS\.qoder-cn\plans\grassy-vale-lark.md`（完整 findings log 在那里，本文件只是入口）。
2. 仍在 **plan mode**：除 plan 文件外只读，**不要改代码**，直到 ExitPlanMode 获用户确认。
3. 接着干的第一件事：把 plan 的 Triage 节填齐（P0/P1/P2/out-of-scope，每项 problem+evidence/change/risk）。P0 先放 S-1、S-17。
4. triage 前对要修的关键项**重读当前源码**核对行号（并发会话在改，行号已漂移）。
5. 就第 6 节 owner 决策项（C1 helping 位置、S-27 骨架、S-28 左栏、S-10 命名）用 AskUserQuestion 问用户，再 ExitPlanMode。
6. **不要做的第一步**：不要直接进 Phase 3 改代码；不要杀另一会话的 pristem-desktop.exe / 抢 8787；若要 live 复测，用改名副本 exe 起隔离服务（8787 被占会自动随机端口），测完只停自己的任务、删自己的 scratch。
7. 验证（Phase 3 才用）：`cd pristem-desktop/ui && pnpm build`；shell 若动则 `cd pristem-desktop/shell && cargo build && cargo test`（必须从 shell/ 跑）；每套 E2E 要**新鲜服务**（kernel 4 worker slots），同一次 shell 调用内起停。

## 8. 禁止事项

1. 未经用户确认（ExitPlanMode 批准）不改任何代码。（来源：对话 Phase 2/3）
2. 不编辑内核 / Mode Router；UI 问题溯源到内核只报告，不 hack 绕过。（来源：对话约束 3）
3. 不静默绕过 out-of-scope（内核/API 缺口、契约矛盾、感知性能、无障碍）。（来源：对话 Phase 2）
4. 不一次性 dump 整份 plan；增量写 running log。（来源：对话「you shouldn't write the plan in once」）
5. 不新增 npm 依赖；i18n key 不漏另一个词典；删除不 unlink（移 trash）。（来源：agents.md）
6. 不杀不是自己启动的进程 / 不抢另一会话的 8787；只清理自己创建的 scratch。（来源：对话 + 本会话）
7. OPEN QUESTION 不给 elaborate 自创答案，只最小实现+flag。（来源：对话约束 4）
8. 不整文件重写；Phase 3 只输出改动部分 + file→what→why 清单。（来源：对话 Phase 3）

## 9. 用户要记住的原话

> 2026-11-16：「Enter plan mode. Task: improve the pristem desktop client UI. Phase 1 — Inspect (before proposing anything): Read workbuddy-ui-design.md — the design contract. Then inspect through two lenses: (a) Spec lens … (b) Fresh-eyes lens: use the client like a first-time user … Run or render the client if you can; capture the current state, don't judge from code alone. Keep a running log of EVERYTHING odd you notice … Do not filter while exploring; triage happens later. Phase 2 — Plan (wait for my confirmation before editing): A prioritized list, each item = problem (with evidence) / proposed change / risk: P0 … P1 … P2 … Out-of-scope findings … Report only; do not fix, do not silently work around. Ground rules: Six-mode semantics and spatial-honesty rules are final at the implementation level — but if you believe the contract itself is wrong or incomplete somewhere, that belief is a finding: state it with evidence in out-of-scope, and I decide. Low-density UI, no button stacking (prefer direct manipulation); AI presence collapses fully when dormant — no grayed-out panels or empty-chat placeholders. Kernel and Mode Router are out of edit scope. If a UI problem traces back to them, report it — never hack around it in the UI layer. OPEN QUESTIONs: minimal implementation + a flag, never your own elaborate answer. Phase 3 — Implement (after confirmation): Only output changed parts, no full-file rewrites. Change list: file → what → why. Verify the build/smoke still passes and report results.」（来源：对话，原始任务）
> 2026-11-16：「you shouldn't write the plan in once」（来源：对话）
> 2026-11-16：「continue」（来源：对话）
> 2026-11-16：「another section is also changing, thats why」（来源：对话，解释 8787 服务反复重启/源码被并发修改）
> 2026-11-16：「I'll compress you and the another section together, prepare handof, write hand of to "pristem/hand-of/ofUI.md"」（来源：对话，本交接的由来）

## 10. 话题详情

单话题，未拆分。

## 11. 决策与弯路

| 决定 | 选定方案 | 理由 | 否决方案 | 否决理由 | 来源 |
|------|----------|------|----------|----------|------|
| 审查执行方式 | 主代理顺序 grep/read | Explore/general-purpose subagent 被 disallowedTools 禁用 | 三个并行 subagent | 会话禁用，调用即报错 | 对话/本会话 |
| plan 写法 | 增量 running log，最后 triage | 用户明确要求 | 一次性写整份计划 | 用户否决「write the plan in once」 | 对话 |
| live 服务隔离 | 改名副本 pristem-inspect.exe 起 headless | 另一会话按 image name 杀 pristem-desktop.exe；改名可避杀，8787 占用时自动随机端口 | 直接跑 pristem-desktop.exe / 反复杀进程 | 会被另一会话杀掉，且杀别人进程不尊重并发 | 本会话 |
| live 探针方式 | evaluate_script DOM/computed-style | in-app browser viewport 隐藏 0x0，截图/布局测量不可用 | take_screenshot 视觉判断 | NATIVE_BROWSER_VIEWPORT_UNAVAILABLE | 本会话 |
| S-5 空执行链 | 降级为「运行时合规」 | live chainHeadExists=false，与旧 static 断言矛盾（源码可能被并发改） | 坚持 static「head 总渲染」 | live 不复现 | live DOM |
| L-7 deepsleep 自动醒 | 不认定为 bug | 受控复测 6s 稳定、sleep-log 1→2→3；早期一次翻转不可复现 | 报「deepsleep 自发醒」P0 | 不可复现，疑瞬时外来动作 | live DOM |

失败尝试：
- 试过杀 8787 上的 leftover 服务（PID 14304/16252）起新鲜服务，因另一会话并发重启/占用而 PID 不断变（14304→16252→31856），且可能误杀对方进程；用户澄清「another section is also changing」后改为改名副本隔离。（来源：本会话 + 对话）
- 试过 10×1000ms 的 mode 轮询探针，因 browser-use evaluate_script 15s 操作超时失败；改 6×1000ms 成功。（来源：本会话）
- 试过切到 IDE 验证 S-32 状态栏光标，因多次刷新后 session 卡在「正在连接内核」、IDE 切换无响应（疑 K-5 worker slot 耗尽）未进 IDE；S-32 改以 static 源码坐实。（来源：本会话 live）