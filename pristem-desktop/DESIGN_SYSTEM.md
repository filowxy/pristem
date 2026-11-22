# pristem 桌面端 · 视觉设计系统规范 v1.0

> 状态：**Phase 1 交付物**。本文只定义「视觉方向与设计系统」，不包含任何 React/TSX/CSS 实现。
> 落地由 Phase 3（frontend-engineer）按本文逐条施工；本文每一条规范都标注了**代码落点**。
>
> 适用版本：`pristem.ipc/v0.4`（由 `pristem-ipc` 的 `PROTOCOL_VERSION` 决定；壳层经 `fs.list` 响应的 `protocol` 字段带给前端，前端不硬编码）。
> 相对 v0.3 的唯一新增：`ServerEvent::Usage`（见 §8.7）。
>
> 前置事实（已核对源码，非推测）：
> - 现有 token 全部在 `ui/src/styles.css` 的 `:root`（第 5–38 行）。
> - 现有 `--living-opacity` 公式在 **2 处定义**（`:root` 第 37 行、`.app-shell` 第 85 行）、**4 处消费**、
>   另有 **1 处独立公式**（`.living-bloom` 第 161 行 `min(.12, calc(var(--presence) * .25))`）——共 7 个触点、2 套互斥公式。
> - `--font-display: 'Instrument Serif',Georgia,'Songti SC',serif` 被 **4 处** 中文标题使用
>   （`.handoff-card h2` / `.sleep-center h1` / `.wake-card h2` / `.goal-wordmark`），中文必然回退到宋体。
> - `ui/public/pristem-icon.png` 为 1024×1024 RGBA，四角 alpha=0（真透明），图形是「白顶 + 红/黄/绿/蓝四色斜带」的棱镜。
>
> **与 `UX_SPEC.md` 的权威边界**（Phase 2 交付，同目录）：
> 色彩 / 字体 / 动效时长 / 尺寸 / 密度 → **本文唯一权威**；
> 信息架构 / 状态机 / 键盘 / 焦点 / 错误分支 / 降级 → **`UX_SPEC.md` 唯一权威**。
> 本文 §7.1 草图的「40px」左栏头标注已按 `UX_SPEC.md` §0.2 R1 更正为 **28px**；
> §8.8.2 分区 2 已按 R2 移除「连接状态」文案（连接状态全局只有状态栏一处）；
> §8.9.1 已按 R3 与 UX 对齐唤醒简报双按钮语义。冲突时按上述边界裁决，**不得两边不一致**。

---

## 目录

| 章 | 内容 | 对应用户问题 |
|---|---|---|
| §0 | 问题覆盖索引（13 条反馈 → 规范条目 → 代码落点） | 全部（评审入口） |
| §1 | 设计立场：为什么 pristem 不是 IDE | 总纲 |
| §2 | 品牌与标识：唯一图形、唯一字标、出现次数硬上限 | 1、11、12 |
| §3 | 字体系统：完整 type scale + 中文/英文落地 + 去掉衬线陷阱 | 11 |
| §4 | 色彩与材质：对比度、beam 配额、唯一强度公式 | 4、色彩 |
| §5 | 动效语言：时长/缓动/进入退出 + deepsleep 低频存在感 + 降级 | 3、5 |
| §6 | 存在感刻度 Presence Dial：最终视觉定义 | 8 |
| §7 | 布局骨架：信息架构图 + 模式差异表 + 为什么不长成 VSCode | 总纲、2、13 |
| §8 | 专项组件规范：目标 / 设置 / 休眠 / 终端 / 唤醒简报 / 文件树 | 2、4、6、7、9、10、13 |
| §9 | 视觉验收清单（可逐条勾选，判据可测量） | 全部 |
| 附录 A | Token 变更表（现值 → 新值） | 施工用 |
| 附录 B | 跨层依赖清单（内核/壳层必须先做的事） | 施工用 |

---

## §0 问题覆盖索引（13 条用户反馈 → 规范条目）

> 供评审逐条核对。每条给出：问题 → 解决它的规范条目 → 主要代码落点。

| # | 用户反馈 | 解决条目 | 主要代码落点 |
|---|---|---|---|
| 1 | **品牌图标分裂**（棱镜 PNG vs 粉红发光球） | §2.1（LivingCore 降级为棱镜光晕）、§2.2（棱镜 ≤ 2 处）、§8.1（面板头删除图标） | `components/LivingCore.tsx`、`components/BrandMark.tsx`、`styles.css` `.living-core` → `.living-halo` |
| 2 | **deepsleep 唤不醒 / 回不去**（无返回路径、简报不可关） | §8.4（deepsleep 不再是 fullView，工作台变暗保留 + 3 条返回路径）、§8.5（简报可关闭） | `App.tsx` `fullView` 计算、`views.tsx` `DeepsleepView` |
| 3 | **deepsleep 毫无动态** | §5.3（光晕载体）、§5.4（12s 慢呼吸 + 4s/行 时间流逝） | `living.ts` `MODE_POLICY`、`styles.css` `.app-shell.mode-deepsleep` |
| 4 | **看不到 token 消耗与执行流程** | §8.7（协议新增 `usage` 事件 + vitals 条 + 执行链三层信息） | `types.ts` `ServerEvent`、`styles.css` `.ai-vitals` |
| 5 | **「演示执行流」标签** | §8.3（连接状态全局唯一 + 禁用词清单） | `components/ChromeExtras.tsx` `AiDemoTag`（删）、`components/ToolCard.tsx`（删 demo tag） |
| 6 | **打不开文件夹** | §8.6（原生对话框为主 + 路径粘贴兜底 + 目录可展开） | `App.tsx` `openFolderPicker`、`shell/src/io.rs` `fs.pickFolder` |
| 7 | **设置太少且挤在 240px 左栏** | §8.8（独立设置页 + 7 分区 + 控件形态规范） | 新增 `components/SettingsPage.tsx`、`components/Panels.tsx` `SettingsPanel`（删） |
| 8 | **模式菜单图标不一致**（6 根柱子语义不明） | §6（统一 5 格刻度器、从左向右填充、菜单 = 状态栏的展开） | 新增 `components/PresenceDial.tsx`、`styles.css` `.dial` / `.menu-dial` |
| 9 | **goal 模板框太大**（3 张 220px 巨型卡片） | §8.2.2（改为一行 26px 起步句 chip） | `views.tsx` `GoalView`、`styles.css` `.goal-templates` |
| 10 | **「目标/约束/取舍」是假功能** | §8.2.1（**删除** `.intent-chips` 与 3 条 i18n） | `views.tsx` `INTENT_CHIPS`（删）、`i18n.ts` |
| 11 | **衬线字标**（中文回退到宋体） | §3.2（删 `--font-display`，新增 `--font-wordmark` 只给拉丁字标） | `styles.css` `:root`、`.sleep-center h1` / `.wake-card h2` / `.handoff-card h2` |
| 12 | **「pristem」出现太多次** | §2.3（字标同屏 = 1）、§2.4（17 处出现位置的逐条处理清单） | `views.tsx` / `App.tsx` / `i18n.ts` / `living.ts`（见 §2.4 表） |
| 13 | **终端提示符错乱 + 三个死 tab + 不能多终端** | §8.9（唯一 `›` 提示符、block 光标、真 tab、实例化终端） | `workspace.tsx` `TerminalPane`、`shell/src/io.rs` `run_term`、`components/Panels.tsx` git 捕获 |

---

## §1 设计立场

### 1.1 一句话立场

> **pristem 不是一套「你操作的工具」，而是「一个住在你机器上的智能体」；界面是它的身体表面，不是工具的陈列架。**

这句话直接决定后面所有形态选择。展开成四条可操作的立场：

**立场 1：界面回答「它在哪、它刚做了什么、它还要什么」，不回答「有哪些功能」。**
VSCode 的 chrome 是**功能索引**（图标栏 = 视图清单，菜单栏 = 命令清单，状态栏 = 上下文清单）。
pristem 的 chrome 是**生命体征**（存在感档位、刚刚发生的动作、刚刚花掉的代价、它现在需要你做什么）。
凡是只回答「有哪些功能」的 chrome，一律删除或降级。

**立场 2：存在感是刻度，不是布尔值，也不是档位菜单。**
六种模式是同一条轴上的 6 个刻度（0…5），不是 6 个并列的「模式」。
因此界面必须有一处**连续的、几何的、始终在场的刻度器**；模式菜单是它的展开视图，不是它的兄弟。

**立场 3：同一个东西只能有一个图形、一种说法、一处真相。**
棱镜是唯一标识；字标全屏最多 1 次；连接状态全屏只有 1 处；用量只有 1 个数字来源。
当前界面之所以「像拼凑」，根因是**同一个概念有多套图形**（棱镜 PNG vs 粉红发光球）、**同一个状态有多处标签**（字标 5 处 + 演示标签 3 处 + 模式 chip 4 处）。

**立场 4：缺席比在场更响。**
IDE（0 档）不是「AI 面板被清空」，是**整块智能体表面不存在**——刻度器不渲染、棱镜不呼吸、没有任何 AI 元素进入 DOM。
deepsleep（1 档）不是「把 IDE 放大」，是**工作台还在、但变暗、不可交互，智能体在画面上方安静地存在**。

### 1.2 与「instrument panel / darkroom」基线的关系

现有基线（深色仪表盘）**保留**，但它的气质要从「精密仪器的读数面板」调整为「夜间机房里一个正在工作的存在的表面」：

| 保留 | 调整 |
|---|---|
| 深色无彩底 + **彩虹强调色** | 保留底，**换色**。`--spectrum` 是唯一强色：单一定义 + 单一时钟（§4.3） |
| 极细分隔线（`--line-hair`） | 保留。分隔线永远不发光 |
| 等宽字承载技术信息 | 保留，但**收紧边界**：等宽字不再承载自然语言句子（见 §3.4） |
| LIVING 动态层（内核事件 → 视觉强度） | 保留**机制**，重做**载体**（见 §5.3）：从「一个独立的粉红球」改为「附着在唯一棱镜上的光晕」 |

### 1.3 明确「不要什么」

本规范**禁止**以下做法（Phase 3 不得实现）：

- 标题栏菜单栏（会话/视图/内核/帮助四个下拉）——改为命令面板 + 就地控件。
- 48px 图标活动栏（VSCode 侧边栏复制品）——改为左栏头部的 3 段视图切换器。
- 面板头部堆砌「图标 + 字标 + 模式 chip + 状态 chip + 演示标签」。
- 底部状态栏堆砌 git 分支 / 诊断数 / 光标行列 / 语言 / EOL / 缩进（VSCode 状态栏复制品）。
- 三个不能点的假 tab（「终端/输出/问题」当前是 `<span>`）。
- 彩虹渐变条（`--spectrum`）出现在 8 条规则 / 9 个选择器上。
- 任何中文承载在衬线字体下。
- 任何界面元素同时显示品牌字标和品牌图标以外的第二种品牌图形。
- 任何写着「演示 / demo / 假数据 / 未完成 / 占位 / TODO」的可见文字（见 §8.3 的连接状态命名）。

---

## §2 品牌与标识

### 2.1 唯一标识（唯一图形）

> **棱镜（`ui/public/pristem-icon.png` / `pristem-icon-sm.png`）是 pristem 唯一的图形标识。全应用不再存在第二种品牌图形。**

现状问题（截图 `clipboard-…-db8d9850.png`）：AI 面板头部的 `.living-core` 是一个 CSS 画的**粉红色发光球 + 两点眼睛**，与标题栏的棱镜 PNG 并排出现在同一个 "pristem" 文字两侧。这是「品牌分裂」的根因——不是尺寸问题，是**两个不同的图形都在主张自己是 logo**。

**决策：`.living-core` 图形降级为「棱镜的光晕」。**

- `src/components/LivingCore.tsx` **不再渲染球体**，改为渲染一个无内容的光晕元素：
  ```tsx
  // 改造后：LivingCore 不再是图形，只是「棱镜的光晕」
  export function LivingCore({ coreRef, mode }: {...}) {
    if (mode === 'IDE') return null;           // 0 档：完全不存在
    return <span className="living-halo" ref={coreRef} aria-hidden="true" />;
  }
  ```
- 光晕**必须**紧贴标题栏的棱镜（`<BrandMark>` 的兄弟节点，负 margin 覆盖），**不得**出现在任何其他面板头部。
- CSS 中 `.living-core` / `.living-eye` / `.living-bloom` / `.living-highlight` **全部删除**，
  由 `.living-halo` 取代（见 §5.3 具体数值）。
- 指针跟随高光（`--ptr-x/--ptr-y`）**保留**，但作用对象从 `.living-highlight` 改为 `.living-halo` 的高光层。

**结果**：标题栏品牌块是「棱镜 + 光晕 + 字标 pristem.」，一个图形、一处光。全应用再没有粉红球。

### 2.2 棱镜出现的位置与次数（硬上限）

| 位置 | 尺寸 | 允许条件 | 代码落点 |
|---|---|---|---|
| 标题栏品牌块 | 18×18 | **恒定存在**（除 IDE 模式整体不渲染品牌块） | `components/ChromeExtras.tsx` `TitleBar` → `.brand` |
| 欢迎页首屏空态 | 28×28 | 仅当**无工作区**时 | `components/Panels.tsx` `Welcome` |
| 设置 › 关于 | 64×64 | 仅该页 | 新增 `components/SettingsPage.tsx` |
| Summon 浮层 | 16×16 | 仅 IDE 模式召唤浮层 | `views.tsx` `Summon` |

**上限规则**：
- **棱镜图标同屏出现次数 ≤ 2**（通常只有标题栏 1 个）。
- 棱镜图标**禁止**出现在：AI/控制台面板头部、transcript 空态、状态栏、目标视图、模式菜单头部、
  文件树空态、搜索空态、Git 空态、大纲空态、任何 Toast / 确认卡片、任何 hover 提示。

> `components/EmptyState.tsx` 当前**每个**空态都渲染 `BrandMark`（28px 或 40px）。这是棱镜「到处都是」的直接原因。
> 改造：`EmptyState` 默认**不渲染棱镜**，改用 18px 的功能图标（lucide，`--text-3`，opacity .5）；
> 只有 `variant="first"` 且 `brandMark` 显式开启时才渲染 28px 棱镜，且全屏最多 1 处。

### 2.3 字标（"pristem" 文字）

**唯一字标形态**：`pristem.`（全小写 + 一个句点）。禁止 `PRISTEM`、禁止 `pristem`（无点）作为字标出现。

| 属性 | 值 | 理由 |
|---|---|---|
| 字体 | `--font-wordmark`（见 §3.2），仅拉丁字重 400 | 字标是拉丁词，衬线可保留；中文永远不进字标 |
| 字号 | 14px | 标题栏 36px 高度内的标准字标尺寸 |
| 字重 | 600 | 衬线字体的 400 在 14px 下过细，14px 衬线 + 400 会发虚 |
| 字距 | `-0.005em` | 衬线小字号不做负字距 |
| 颜色 | `--text-1` | |
| 句点 `.` | `--beam-dim` | 唯一的点睛色，且是中性冷灰不是强调白 |

**字标出现次数硬上限：同屏 1 次，且必须在标题栏品牌块。**

唯一豁免（不算品牌展示，是技术标识）：
- 协议标识（如 `pristem.ipc/v0.4`）—— 只允许出现在状态栏最右（mono 10px `--text-4`）与 设置›关于。
  **版本号必须来自 `fs.list` 响应的 `protocol` 字段，前端不得硬编码**（见附录 B′ D-5）。

### 2.4 全文「pristem」出现位置清单（Phase 3 必须改到只剩这些）

| # | 当前位置 | 文件 | 处理 |
|---|---|---|---|
| 1 | 标题栏 `pristem.` | `ChromeExtras.tsx` | **保留**（唯一字标） |
| 2 | AI 面板头 `pristem` | `views.tsx` `AiPanel` | **删除**，替换为存在感刻度 + 模式名 |
| 3 | transcript 空态 `pristem` | `views.tsx` `Transcript` | **删除**，标题改为「还没有对话」 |
| 4 | 目标视图 `pristem.`（52px 衬线） | `views.tsx` `GoalView` | **删除**整个 `.goal-brand` 块 |
| 5 | 状态栏（无字标，但有协议标识） | `views.tsx` `StatusBar` | 保留协议标识（读 `fs.list` 的 `protocol` 字段，不硬编码），去掉其它 |
| 6 | 模式菜单头棱镜 | `views.tsx` `StatusBar` | **删除**棱镜，保留 eyebrow |
| 7 | Summon 头 `召唤 pristem` | `views.tsx` `Summon` | 改为「召唤」+ 棱镜 16px |
| 8 | composer 脚 `pristem-core` | `views.tsx` `AiPanel` | **删除**，改为内核上报的真实 provider/模型名 |
| 9 | `goal.pristem` 说话人标签 | `i18n.ts` | 改为「智能体」 |
| 10 | 终端首行 `pristem terminal` | `workspace.tsx` `TerminalPane` | **删除**，终端实例名放在活动带头部 |
| 11 | 终端回显 `pristem@workspace %` | `shell/src/io.rs` | **删除**（见 §8.5） |
| 12 | 导出文件名 `pristem-session.md` | `App.tsx` | 保留（文件名，不是界面） |
| 13 | 目标空态棱镜 | `views.tsx` `GoalView` | **删除** |
| 14 | 空态组件里的棱镜（多处） | `components/EmptyState.tsx` | **删除**（默认改功能图标） |
| 15 | `summon.title: '召唤 pristem'` | `i18n.ts` | 改为「召唤」 |
| 16 | 折叠 AI 面板后的展开按钮 `<BrandMark/> pristem` | `App.tsx` L680 `.reopen-ai` | **删除**字标与棱镜，改为 32×32 的展开图标按钮（`aria-label` 提供无障碍名称） |
| 17 | 屏幕阅读器播报 `'pristem 正在执行'` | `living.ts` L145 `announce()` | **删除**品牌词，改为语义播报「正在执行」「内核拦截了一次动作」等（播报应说状态，不说品牌） |

> 第 17 项说明：`announce()` 的 `role="status"` 区域虽然视觉不可见，但**对辅助技术用户是可听的品牌播报**，
> 且是「谁在说话」而非「发生了什么」。规范统一：**播报只说状态与动作，不说品牌名**。

**不计入的内部标识**（保留原样，非界面展示）：
`pristem:term` / `pristem:jump-line` / `pristem:remove-at`（自定义事件名）、`pristem.recentWorkspaces`
（localStorage key）、`pristem-dark`（Monaco 主题名）、`pristem-project`（默认目录名）、
`pristem-session.md`（导出文件名）、`aria-label="pristem"` / `id="pristem-workbench"`（根节点标记）。

**验收**：任意模式下截图，字标 "pristem" 可数出的实例数 = 1（标题栏）。协议标识不计入。

### 2.5 存在感刻度器是「唯一的脸」

除了棱镜，唯一可以承载「智能体状态」的视觉对象是**存在感刻度器（Presence Dial，见 §6）**。
它的地位等同于「脸」：任何位置想表达「它现在的状态」，都用刻度器，不用图标、不用文字、不用色块。

- 刻度器在**状态栏**与**标题栏模式控件**使用 23×10 紧凑版；
- 在**模式菜单**使用 30×12 完整版；
- **模式菜单是刻度器的展开视图**，不是另一个控件。

---

## §3 字体系统

### 3.1 三套字体的职责边界（互不越界）

| token | 栈 | 允许承载 | 禁止承载 |
|---|---|---|---|
| `--font-ui` | `'IBM Plex Sans','PingFang SC','Microsoft YaHei UI','Microsoft YaHei','Noto Sans CJK SC',sans-serif` | 全部界面正文、标题、按钮、标签 | 代码、路径 |
| `--font-mono` | `'IBM Plex Mono','Cascadia Code',Consolas,'Microsoft YaHei UI',monospace` | 代码、路径、标识符、**需要等宽对齐的数字** | **自然语言句子**（当前 `.sleep-log` / `.line-system` / `.handoff-log` / `.sleep-meta` 违规） |
| `--font-wordmark` | `'Instrument Serif',Georgia,serif` | **仅**拉丁字标 `pristem.` | **任何中文** |

> `--font-wordmark` 的衬线**只用于字标**。`--font-display`（旧的 `'Instrument Serif',Georgia,'Songti SC',serif`）**从 `:root` 删除**。

### 3.2 去掉衬线回退陷阱（问题 11 的完整解法）

**问题**：`--font-display` 被 4 个中文标题使用。Instrument Serif 只含拉丁字形，中文必然回退到
`'Songti SC'`（macOS）/ `serif`（Windows → 宋体），产出截图里那种「唤醒简报 / 智能体正在休息」的字形灾难。

**决策（三条，全部执行）**：

1. **`:root` 删除 `--font-display`，新增 `--font-wordmark`**（仅 Instrument Serif + Georgia + serif，无中文回退项）。
   若字标栈最终落到 Georgia，说明 Instrument Serif 加载失败——这是**可测故障**，不是设计降级。
2. **所有中文标题改用 `--font-ui` + 字重 600**：
   - `.sleep-center h1` → 26px / 600 / line-height 1.35 / `--text-1`
   - `.wake-card h2` → 24px / 600 / line-height 1.35 / `--text-1`
   - `.handoff-card h2` → 20px / 600 / `--text-1`（内容是拉丁 `advisor → deepsleep`，可用 `--font-wordmark`，但为一致性统一用 `--font-ui` 600）
   - `.goal-wordmark` → **整个元素删除**（见 §2.4 #4）
3. **禁止对中文使用 `font-style: italic`**。当前 `.sleep-center h1 em` 用斜体渲染中文副标题——
   浏览器只能合成倾斜，是伪斜体，笔画会糊。改为：副标题用 `--text-2` + **不加斜体**，靠颜色和字号分层。
   唯一允许真斜体的位置：`.sleep-center h1 em` 改为纯拉丁副标时才可用 `--font-wordmark` 400 + `font-style: italic`；
   但中文场景下**该元素改名为 `.sleep-sub` 且不带 `em` 标签**。

**衬线在最终版中只出现 1 处**：标题栏 `pristem.` 字标（14px/600/Instrument Serif）。

### 3.3 完整 Type Scale

以 13px 为基准（`body { font-size: 13px }` 不变）。所有值写死 px，不使用 rem/vw。

| token | 字号 | 行高 | 字重 | 字距 | 用途 | 出现次数约束 |
|---|---|---|---|---|---|---|
| `--fs-hero` | 34px | 1.18 | 600 | `-0.015em` | 全屏视图主标题（仅 goal / advisor） | 每屏 ≤ 1 |
| `--fs-display` | 26px | 1.35 | 600 | `-0.01em` | 深睡标题 / 唤醒简报标题 | 每屏 ≤ 1 |
| `--fs-title` | 20px | 1.4 | 600 | `-0.01em` | 页面标题、设置页标题 | 每屏 ≤ 2 |
| `--fs-subtitle` | 15px | 1.45 | 600 | `0` | 小节标题、目标标题 | 每屏 ≤ 6 |
| `--fs-body` | 13px | 1.65 | 400 | `0` | **默认正文**（全应用） | — |
| `--fs-body-sm` | 12px | 1.6 | 400 | `0` | 次级正文、列表项、按钮 | — |
| `--fs-label` | 11px | 1.5 | 500 | `0` | 控件标签、状态文本 | — |
| `--fs-micro` | 10px | 1.5 | 500 | `0.01em` | 辅助说明、计数、占位 | — |
| `--fs-eyebrow` | 10px | 1.2 | 600 | `0.14em` | 眉标（**仅拉丁/数字**） | — |
| `--fs-mono` | 12px | 1.55 | 400 | `0` | 终端、代码、路径 | — |
| `--fs-mono-xs` | 10px | 1.5 | 400 | `0` | 协议标识、文件名、行号 | — |
| `--fs-num` | 20px | 1.1 | 500 | `-0.01em` | 用量数字（等宽，`font-variant-numeric: tabular-nums`） | 每屏 ≤ 1 |

**eyebrow 规则**：`.eyebrow` 的 `text-transform: uppercase` + `letter-spacing: .14em` 对中文是灾难（假大写 + 字距撕碎）。
→ **eyebrow 内容必须是拉丁字母或数字**。中文眉标改用 `--fs-label`（11px / 500 / 字距 0），禁止 uppercase。

### 3.4 中英文分别落地

| 场景 | 中文（zh-CN） | 英文（en-US） |
|---|---|---|
| 正文 | `--font-ui`，字距 0，行高 1.65 | 同，字距 0 |
| 大标题（≥20px） | 字距 `0`（**不做负字距**） | 字距 `-0.01em` ~ `-0.015em` |
| eyebrow | 禁用 uppercase，改 `--fs-label` | `--fs-eyebrow`，uppercase，`.14em` |
| 全角标点 | 由 `IBM Plex Sans` 回退到 PingFang/雅黑，标点占 1em | 不适用 |
| 行高 | 1.65（中文需要更多行间距） | 1.6 |
| 中英混排 | 英文段落在中文段落内不额外加空隙 | — |
| 等宽数字 | `tabular-nums` 已全局启用 | 同 |

**实现落点**：`ui/src/styles.css` 新增上述 `--fs-*` token；中文/英文差异通过
`:root[lang="zh-CN"]` / `:root[lang="en"]` 两条规则覆盖 `--fs-hero`/大标题字距与 eyebrow 字距。
`document.documentElement.lang` 已由 `i18n.ts` 的 `setLang()` 正确设置（zh-CN → `zh-CN`，en → `en`），可直接用。

### 3.5 等宽字体的使用边界

**允许**（全部是「机器生成或需要对齐」的文本）：
- 代码、Diff、命令、路径、文件名、目录树项名、git 分支名、协议标识、行号、列号
- **需要纵向对齐的数字**：用量（tokens）、字节数、行数、耗时、计数
- 终端缓冲区（`TERM_BUFFER`）

**禁止**：
- 任何自然语言句子：睡眠日志、错误信息、系统提示、日志行、handoff 日志、状态栏提示语、设置项说明
- 按钮文案、标题、菜单项、空态标题与描述

**代码落点**：`styles.css` 中 `.sleep-log p`、`.line-system`、`.handoff-log p`、`.sleep-meta`、
`.status-item`（状态栏的 sessionLabel/branch/diagnostics）、`.status-hint` **全部改回 `--font-ui`**。
保留 mono 的：`.statusbar` 里的 `pristem.ipc` 标识、`.git-*`、`.term-history`、`.tool-card-*`、
`.review-code`、`.outline-line`、`.settings-value`、`.breadcrumb-segment`、`.tree-root`、`.kbd`、`.help-pop code`。

---

## §4 色彩与材质

### 4.1 对比度层级（用现有 token 值实测得出，不是估计）

> **2026-11 第二轮（Night Foundry）**：色板改为温暖石墨 + 琥珀信号，实测值见 **附录 A″**；
> 本节的 HEX 与对比度仅保留为历史记录，冲突时以 A″ 为准。结构与尺寸规则不受影响。

> **中性化修订**：旧色板 `#0F0F0F → #282828` 的蓝通道比红通道高 10–23，与 §1.2「深色无彩底」自相矛盾。现全部中性色改为 **R=G=B**，主体表面落在 `#141414–#1D1D1D`（Cursor / Zed / VS Code Dark Modern 的区间）；深度只由明度产生，色相只留给语义色、语法色与棱镜。对比度随底色变暗整体上升，未牺牲任何一级。

在 `--surface-panel` (#1B1B1B) 上实测：

| token | HEX | 对比度 | 判据 | 结论 |
|---|---|---|---|---|
| `--text-1` | #E8E8E8 | **14.06** | ≥ 7（正文 AAA） | ✅ 唯一允许承载长段正文 |
| `--text-2` | #B8B8B8 | **8.68** | ≥ 7 | ✅ 次级正文 |
| `--text-3` | #949494 | **5.68** | ≥ 4.5 | ✅ 辅助文本（所有 surface 上 ≥4.5，最低 4.86） |
| `--text-4` | #7E7E7E | **4.24** | < 4.5 | ⚠️ **仅装饰/禁用**（分隔符、装饰性圆点、disabled），**不得承载任何语义** |
| `--beam` | #E8E8E8 | **14.06** | ≥ 7 | ✅ 强调色 |
| `--beam-dim` | #A2A2A2 | **6.75** | ≥ 4.5 | ✅ 弱强调 |
| `--accent-quiet` | #8E8E8E | **5.26** | ≥ 4.5 | ✅ 仅焦点环与 hover 边框 |
| `--success` | #7FB08A | 6.95 | ✅ | |
| `--warn` | #D4A45E | 7.60 | ✅ | |
| `--danger` | #D27573 | 5.36 | ✅ | |
| `--info` | #7A9FD4 | 6.35 | ✅ | |

**跨 surface 的降级规则**（实测）：

| surface | HEX | `--text-3` 对比度 | 规则 |
|---|---|---|---|
| `--surface-void` | #0F0F0F | 6.32 | ✅ text-3 可用 |
| `--surface-chrome` | #181818 | 5.85 | ✅ text-3 可用 |
| `--surface-panel` | #1B1B1B | 5.68 | ✅ text-3 可用 |
| `--surface-canvas` | #1D1D1D | 5.56 | ✅ text-3 可用 |
| `--surface-inset` | #161616 | 5.97 | ✅ |
| `--surface-raised` | #232323 | 5.18 | ✅ |
| `--surface-float` | #282828 | **4.86** | ✅ text-3 达标；浮层小字仍优先 text-2（7.43） |

> **规则**：任何放在 `--surface-float` 上的文本，最低用 `--text-2`。
> 这条会强制改造当前几处违规：`.chrome-menu-item`（text-2 在 float 上 = 5.76 ✅ 已合规）、
> `.foot-pop button`（text-2 ✅）、`.palette-list button`（text-2 ✅）、
> `.context-option`（text-2 ✅）、`.mode-menu button`（text-2 ✅）——现有多数已合规，
> 但新增的浮层与 chip 一律按此表选色。

**焦点环统一**：新增 `--focus-ring: 0 0 0 2px var(--surface-void), 0 0 0 4px var(--beam)`，
替换当前散落的 `0 0 0 3px rgba(217,228,239,.08)`（**6 处**：`.search-capsule:focus-within` L254、
`.path-input input:focus` L399、`.composer-box:focus-within` L550、`.annotation-pop textarea:focus` L693、
`.goal-input:focus-within` L794、`.summon input:focus` L820）。焦点环在任意 surface 上都可见。

### 4.1.1 形状：连续曲率（G2 / squircle）

`border-radius` 把直边与四分之一圆弧焊接在一起：位置与切线连续（G1），但曲率在接合点从 `0` 突跳到 `1/r`，肉眼读作一道轻微的「折痕」。Apple 的 squircle / Figma 的 corner smoothing ≈60% 用的是超椭圆，曲率沿整条边连续爬升（G2）。

**决策**：所有矩形圆角统一采用 G2 连续曲率，`corner-shape: superellipse(2)`（等价 `squircle`）。Chromium 139+ 原生支持，发布目标 WebView2 为 157，实际渲染的就是超椭圆，不是 `clip-path` / SVG mask 近似 —— 边框、阴影、背景裁切全部保留。不支持的浏览器自动回落到原有圆弧。

| 规则 | 说明 |
|---|---|
| 半径 token 不变 | `--r-1`(3px) / `--r-3`(6px) 等在 §8.11 的嵌套曲率契约中被固定，**不因换曲率而改数值** |
| 正圆与胶囊排除 | `border-radius: 50%` 与 `--r-full` 的元素显式设回 `corner-shape: round`，否则端头会被削方 |
| 不叠加放大 | 同半径下 squircle 看起来略方，这是连续爬升的必然结果，不是半径不足；为「视觉等价」而加倍半径会破坏既有尺寸规范 |
| 落地位置 | `ui/src/polish.css` §14，`@supports (corner-shape: squircle)` 单层，可整段回退 |

**浮起层例外（A′.5）**：浮动表面（菜单 / popover / palette / 对话框 / 输入托盘）的半径升一档，
并用 `superellipse(3)`。理由：6px 以下的圆角看不出连续曲率，浮层的 8–12px 才能在视觉上读出
「曲线在拐角处连续爬升」。控制件与内容容器仍保持 `superellipse(2)` 与原半径。

### 4.2 accent 强调色配额（解决「到处都是高亮」）

强调色不再是冷白 `--beam`，而是**彩虹 accent**（§4.3）。配额规则不变，只是主体换了：

| 规则 | 数值 |
|---|---|
| 同一视口内 **accent 实心填充块**（彩虹填充或 accent 单色块）数量 | **≤ 2**（1 个主行动 + 至多 1 个活动指示） |
| 同一视口内 accent 实心面积占视口面积 | **≤ 1.5%** |
| 同一视口内 accent 描边/下划线元素数量 | **≤ 6** |
| accent 用于表达语义 | 仅限三种含义：**当前选中**、**可点击的行动**、**有结果的产出** |
| accent 用于装饰 | **禁止**（分隔线、边框、背景一律用 `--line-*`） |

**执行点**：
- `.answer-rule`（答案左侧 2px 竖线）保留彩虹，opacity 从 .75 提到 .9 —— 它表达「这是产出」，符合配额。
- **彩虹永不承载文字**：文字色一律 `--text-1/2/3`；彩虹填充上的文字用 `--accent-ink`（#0A0A0A）。
- `--beam-wash` / `--beam-glow` / `--beam-dim` 是**灰阶工具**，不是品牌色，不参与彩虹。
- 语义色（`--success` / `--warn` / `--danger` / `--info`）与 `--mode-accent`（六模式身份）不受彩虹影响。

### 4.3 spectrum（彩虹）：唯一的强色

**决策**：

> **spectrum 是 Pristem 唯一的强色：单一定义、单个时钟、一种墨水。**
> 它取代冷白 `--beam` 成为交互强调（选中、焦点、主按钮、发送按钮、回答竖线、脏文件点、开关、目录点、激活 tab / 树项）。

**机制（不可改写）**：

| 件 | 值 | 说明 |
|---|---|---|
| 光谱 | `--spectrum:linear-gradient(…)` | **整个仓库只定义一次**；stop 亮度锁 58–62%，保证与墨水的对比度 ≥ 4.5:1 |
| 时钟 | `@property --phase` + `.app-shell { animation: prism-phase … }` | 时长取模式的 `--t-ambient`，**52° 摆动**（不是整圈旋转：整圈会像迪斯科） |
| 相位注入 | `filter: hue-rotate(calc(var(--phase) + var(--living-hue)))` / `hsl(calc(var(--phase) + var(--living-hue)) …)` | **只能经常规属性在使用处注入** |
| 墨水 | `--accent-ink:#0A0A0A` | 彩虹填充上的文字 / 图标 |

> **相位绝不能写进任何自定义属性的定义。** CSS 在**声明处**做 `var()` 替换：
> `--spectrum: … var(--phase) …` 会在 `:root` 一次性算成静态字符串，彩虹就此冻死。
> 相位必须写在 `filter` / `hsl()` 这类常规属性里，由每个使用处自己解析。
> `check.cjs` 的 L2 断言 `the phase is never frozen inside a custom property` 守这一条。

**边界**：

- **禁止**彩虹做文字色。
- **禁止**彩虹做背景墙（整版铺色）—— 那正是「拼凑感」的来源。
- 语义色（`--success` / `--warn` / `--danger` / `--info`）与 `--mode-accent`（六模式身份）**不受彩虹影响**。
- 彩虹**只替换已有的强调位**，不新增装饰位：换掉 60+ 处 `--beam` 的填充 / 描边 / 圆点；灰阶工具（`--beam-wash` / `--beam-glow` / `--beam-dim`）与文字色保持不变。
- **IDE 与 deepsleep 暂停时钟**：编辑器必须静止，深睡禁止彩虹流动（§5.4）。相位暂停 ≠ 彩虹消失 —— 强调位仍是静态彩虹。
- 顶部脉冲带常驻（opacity .32），内核事件把它推到 1（§5.3）；`--living-pulse` 同样接入。
- **同时循环动画 ≤ 1 条「运动」动画**：LIVING 呼吸光晕是唯一的运动循环；棱镜时钟只转色，不动几何。`check.cjs` 的 D2 断言按此判读。

### 4.4 材质：surface 数量收敛

当前 surface 有 7 级（void / chrome / panel / canvas / inset / raised / float）+ xterm 硬编码的 `#0D1014` = 8 级。

**收敛为 7 级**：

| token | 值 | 用途 | 变更 |
|---|---|---|---|
| `--surface-void` | #0F0F0F | 应用底色、终端底色 | 保留（终端改用它） |
| `--surface-chrome` | #181818 | 标题栏、会话带、状态栏 | 保留 |
| `--surface-panel` | #1B1B1B | 面板底 | 保留 |
| `--surface-canvas` | #1D1D1D | 编辑器底 | 保留 |
| `--surface-inset` | #161616 | 输入框内底 | 保留 |
| `--surface-raised` | #232323 | 悬浮 chip、hover 底 | 保留 |
| `--surface-float` | #282828 | 浮层/菜单底 | 保留 |
| ~~`--surface-terminal`~~ | ~~#0D1014~~ | — | **删除**，终端用 `--surface-void` |

**新增 1 级** `--surface-rail: #141414`（左栏视图切换器头部的深色带，仅 28px 高）。

### 4.5 presence 与亮度的关系（唯一公式）

**现状**：7 个触点、2 套互斥公式（§0 前置事实）。

**决策：唯一公式、唯一定义点、被动消费。**

```css
/* 唯一定义点：.app-shell（不是 :root —— 自定义属性在计算值阶段替换） */
.app-shell {
  --presence: 0;          /* 由 .mode-* 覆写 */
  --living-gain: 0;       /* 由 living.ts 写 */
  --intensity: clamp(0, calc(var(--presence) + var(--living-gain)), 1);
}
```

**硬规则**：

> **R-INT-1**：`--presence` 与 `--living-gain` 只允许在 `.app-shell` 这一处参与运算。
> **R-INT-2**：任何其它选择器**不得**写 `var(--presence)` 或 `var(--living-gain)`，只能读 `--intensity` 或 `--dial-fill`。
> **R-INT-3**：`:root` 中的 `--living-opacity` 定义**删除**；`.living-bloom` 的独立公式**删除**。

**派生量（同样只在 `.app-shell` 定义一次）**：

```css
.app-shell {
  --dial-fill: var(--presence);      /* 刻度器填充量 0..1 */
  --intensity: clamp(0, calc(var(--presence) + var(--living-gain)), 1);
}
```

**每个模式档位**（等分，不再用 0/.12/.30/.45/.70/.90 的非等分值）：

| 模式 | PRESENCE | `--presence` | 刻度格亮起数 | `--living-rate` | `--living-size` |
|---|---|---|---|---|---|
| IDE | 0 | **0** | 0 | — | — |
| deepsleep | 1 | **0.20** | 1 | **12s** | — |
| helping | 2 | **0.40** | 2 | 10s | — |
| advisor | 3 | **0.60** | 3 | 9s | — |
| coding | 4 | **0.80** | 4 | 5.2s | — |
| goal | 5 | **1.00** | 5 | 8s | — |

**「亮度」的定义（关键）**：

> **presence 改变的是「发光量」，不是「底色亮度」。界面 surface 色值与文本对比度在任何档位下完全不变。**

理由：档位切换不应导致正文对比度漂移（那会让「切换模式」变成一次可读性突变）。所以：

- `--intensity` 只允许影响：`opacity`、`box-shadow` 强度、`filter: blur()` 半径、`transform: scale()` 幅度。
- `--intensity` **禁止**影响：`background-color`（surface 系）、`color`（text 系）、任何 `mix-blend-mode` 的底色结果。

**例外（唯一允许的例外）**：棱镜光晕 `.living-halo` 的 `opacity` 与 `scale` 由 `--intensity` 驱动 —— 它是光，不是底。

### 4.6 颜色不得由 UI 编造

- 用量数字、连接状态、provider/模型名 **只能来自内核事件**。
- 没有任何内核事件时，相关 UI **整条不渲染**（不显示 `0`、不显示 `—`、不显示占位符）。
  这条直接替换当前「演示数据 / 非真实推理」标签的做法（见 §8.3）。

---

## §5 动效语言

### 5.1 时长档位（6 档，硬上限 640ms）

| token | 时长 | 用途 |
|---|---|---|
| `--t-instant` | **80ms** | 颜色/透明度微反馈（开关拨钮、hover 底色） |
| `--t-fast` | **120ms** | hover、焦点、图标状态、小元素展开 |
| `--t-base` | **180ms** | 面板/卡片出现、状态切换、列表项进入 |
| `--t-layout` | **320ms** | 布局位移（列宽、行高、模式切换、刻度器过渡） |
| `--t-slow` | **560ms** | 全屏视图切换、遮罩淡入淡出 |
| `--t-ambient` | **5.2s / 8s / 9s / 10s / 12s** | LIVING 环境动效（按模式，见 §5.3） |

**规则**：
- **任何动画时长 ≤ 640ms**，超过必须拆分为多段。
- 禁止 `infinite` 的动画，**唯一例外是 LIVING 环境层**（且同一时刻只允许 1 个循环动画，见 §5.5）。
- 禁止 bounce / elastic / spring 曲线。现有 `--ease-out: cubic-bezier(.16,1,.3,1)` 属于强 decelerate，
  只允许用于「进入」（一次性），不用于循环。

### 5.2 缓动与进入/退出

| token | 曲线 | 用途 |
|---|---|---|
| `--ease-enter` | `cubic-bezier(.16,1,.3,1)` | **进入**（面板出现、卡片落位、遮罩淡入） |
| `--ease-move` | `cubic-bezier(.22,.8,.2,1)` | **位移**（列宽、刻度器、模式切换） |
| `--ease-exit` | `cubic-bezier(.4,0,1,1)` | **退出**（面板收起、遮罩淡出） |
| `--ease-linear` | `linear` | 仅用于 LIVING 循环与进度条 |

**进入/退出的位移规则**：
- 进入：透明度 0→1 + `translateY(6px)`→0，`--t-base`，`--ease-enter`。
- 退出：透明度 1→0 + `translateY(0)`→`translateY(4px)`，`--t-fast`，`--ease-exit`。
- 展开/收起（高度类）：`grid-template-rows` 技巧，`--t-layout`，`--ease-move`。
- **禁止**：出现时的 scale 从 0.9→1 的「弹入」（当前 `.activity-item:active` 的 `scale(.97)` 允许，按压反馈除外）。

### 5.3 LIVING 动态层的载体（问题 1、3 的合并解法）

**当前问题**：
- `.living-core` 是独立粉红球，与棱镜并排 → 品牌分裂。
- `MODE_POLICY.deepsleep = { enabled:false, pulse:false }` + `.app-shell.mode-deepsleep { --living-opacity: 0 }`
  + `.living-wrap { display:none }` → **休眠模式完全无动态**（问题 3）。

**决策：删除 `.living-core` 球体，LIVING 层改为附着在标题栏棱镜上的光晕 + 一条顶部脉冲带。**

```css
/* 标题栏棱镜的光晕 */
.living-halo {
  position: absolute; inset: -14px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(207,224,240,.16) 0%, rgba(207,224,240,0) 62%);
  opacity: calc(var(--intensity) * .55);
  pointer-events: none;
  transition: opacity var(--t-layout) var(--ease-move);
  animation: living-breathe var(--t-ambient) var(--ease-in-out) infinite alternate;
}
@keyframes living-breathe {
  from { transform: scale(.92); opacity: calc(var(--intensity) * .38); }
  to   { transform: scale(1.06); opacity: calc(var(--intensity) * .62); }
}
/* 指针高光层（保留 --ptr-x/--ptr-y 驱动） */
.living-halo::after {
  content: ''; position: absolute; inset: 0; border-radius: 50%;
  background: radial-gradient(circle at 38% 32%, rgba(255,255,255,.34), rgba(255,255,255,0) 58%);
  transform: translate3d(calc(var(--ptr-x) * 5px), calc(var(--ptr-y) * 5px), 0);
  transition: transform var(--t-layout) var(--ease-move);
}
```

**LIVING 层的 4 个载体（穷举，不允许新增第 5 个）**：

| 载体 | 元素 | 驱动 | 何时可见 |
|---|---|---|---|
| 呼吸光晕 | `.living-halo` | `--intensity` + `--t-ambient` | 标题栏，presence ≥ 1 |
| 指针高光 | `.living-halo::after` | `--ptr-x/--ptr-y` | 同上，`pointer: coarse` 时禁用 |
| 顶部脉冲带 | `.app-shell::after`（2px） | `--living-gain` + `--living-pulse` | **常驻**（.32），内核事件时推到 1 |
| 刻度器当前格辉光 | `.dial-cell.is-current` | `--intensity` | 状态栏 / 标题栏 / 模式菜单 |

**棱镜相位（§4.3 的颜色循环，不是第 5 个载体）**：`--phase` 由 `.app-shell` 的 `prism-phase`
动画驱动，**只改色相、不动几何**；`--living-hue` 叠加在它上面，所以内核事件会让全应用的强调色
一起换位。IDE 与 deepsleep 暂停该时钟。

**`.living-core` / `.living-eye` / `.living-bloom` / `.living-highlight` / `.spectrum-living` / `.spectrum-living-b` 全部删除。**
`spectrum-living` 仅在 `--spectrum`（静态彩虹，用于脉冲带）保留一处使用。

### 5.4 deepsleep 的「低频存在感」方案（问题 3）

**设计目标**：deepsleep 不是「关掉动画」，也不是「换个更快的动画」。它要表达的是
**「有一个东西在，但它的节奏比你的工作慢得多」**。

三个信号，缺一不可：

| 信号 | 实现 | 数值 |
|---|---|---|
| **慢呼吸** | 标题栏光晕的呼吸周期 | **12s**（对比 coding 的 5.2s，慢 2.3 倍） |
| **暗** | `--intensity` 低 → 光晕 opacity ≤ .62×.2 ≈ .12 | presence = .20 |
| **时间在走** | `.sleep-log` 每 **4s** 推入 1 行并向上滚动 | 见下 |

**睡 log 的内容必须是「时间标记」，不是执行记录（硬要求）**

现状隐患：睡 log 若显示 `items.slice(-4)`（休眠**前**的 transcript 条目），用户会以为**它在休眠期间还在干活** ——
而内核在 deepsleep 期间**没有任何 round 在跑**，一条执行记录都不会产生。

**决策**：睡 log 的行内容 = **纯本地时钟的时间标记**，**零内核数据**：

| 项 | 值 |
|---|---|
| 行内容格式 | `已归档 · HH:MM`（`已归档` + **本地墙钟时刻**，如 `已归档 · 14:32`）。**不是时长** |
| 首行 | `已归档` |
| 说明行 | **W9**（文案见 §8.12 权威表，不在此处重复） |
| 英文 | **W9**（英文版见 §8.12 权威表，不在此处重复） |
| **禁止** | 任何来自 `items` / transcript / 内核事件的内容。**这是「时间流逝」不是「工作进度」** |

**为什么用墙钟时刻而不是时长**：时长的**起点不明确**（从进入 deepsleep 起算？从会话起算？从最后一次事件起算？），
用户无法解读；而**墙钟时刻无歧义**（就是当前几点），且「每 4s 推一行」的时间感更强。

**视觉形态完全不变**（4s 一行 / 104px 容器 / mask 渐隐 / 12s 呼吸）—— **只换内容**。

**时间流逝感的实现（关键）**：

```
.sleep-log { height: 104px; overflow: hidden; mask-image: linear-gradient(transparent, #000 42%); }
.sleep-log p { animation: sleep-tick 4s var(--ease-move) infinite; }  /* 每行错峰 4s */
@keyframes sleep-tick {
  0%   { transform: translateY(14px); opacity: 0; }
  8%   { transform: translateY(0);    opacity: 1; }
  92%  { transform: translateY(0);    opacity: 1; }
  100% { transform: translateY(-14px); opacity: 0; }
}
```

- **速率恒定 1 行 / 4s**，永不加速、永不停顿（除非 `prefers-reduced-motion`）。
- 行高 26px，容器高 104px → 同时可见约 4 行。
- **禁止**在 deepsleep 使用：闪烁、扫光、彩虹流动、粒子、任何 > 2s 周期的位移。
  → 棱镜相位时钟在 deepsleep **暂停**（`animation-play-state: paused`）：彩虹仍是静态的，只是不再流动。

**deepsleep 禁止清单（写进代码注释）**：
- 禁止 `.spectrum` 彩虹带（那是「AI 面板顶条」，deepsleep 无面板）。
- 禁止任何脉冲频率 > 1/12s 的动画。
- 禁止「等待动画」（转圈 / 三点跳动）——deepsleep 的状态是「不在等」，是「在消化」。

### 5.5 动效的允许与禁止（全局）

**必须有动效（缺一不可）**：

| # | 场景 | 数值 |
|---|---|---|
| M1 | 存在感刻度器在模式切换时的档位过渡 | 320ms `--ease-move`，逐格级联延迟 0/40/80/120/160ms |
| M2 | 面板/抽屉展开收起 | 320ms `--ease-move`（宽度/行高） |
| M3 | 新内容进入（transcript 条目、工具卡、空态） | 180ms `--ease-enter`，`translateY(6px)` |
| M4 | 内核事件脉冲（顶部带 + 光晕闪一下） | 480ms，WAAPI，见 `App.tsx` 现有实现 |
| M5 | 加载态（骨架屏 shimmer） | 1.4s linear infinite（**唯一允许的第二个循环**，且与 LIVING 循环不得同时存在） |
| M6 | hover / focus / active 反馈 | 80–120ms |
| M7 | 遮罩出现（唤醒简报、确认弹层） | 560ms `--ease-enter`（淡入，无位移） |

**禁止有动效（明令）**：

| # | 禁止项 | 原因 |
|---|---|---|
| X1 | 文本逐字打字机 | 内核未提供增量流（`speech_delta` 存在但 UI 未接），伪打字机是假的 |
| X2 | 布局抖动 / 元素高度跳变 | 抖动 = 不专业 |
| X3 | 数字无意义滚动 | 用量数字直接跳变 |
| X4 | 出现时的 scale 弹入 | 当前 `.activity-item:active { scale(.97) }` 允许，其余禁止 |
| X5 | 无限循环的装饰动画（>1 个同时） | GPU 占用 + 廉价感 |
| X6 | 滚动视差、鼠标跟随的装饰位移动画 | `--ptr` 只驱动光晕高光，不驱动任何位移 |
| X7 | 任何 > 640ms 的动画 | — |
| X8 | `filter: blur()` 动画 | 性能 |
| **X9** | **deepsleep 层的进度性表达**：「正在分析…」「等待消化…」「复盘中…」「消化中…」转圈、进度条、骨架屏（禁用措辞全表见 §8.12.1） | **内核确实没在跑** —— `spawn_clean_instance` 在生产代码里无调用方（`pristem-deepsleep/src/lib.rs:141` 全在 `#[cfg(test)]`），`switch_mode()` 只做「换工具表 + 重置上下文分区」（`session.rs:187`）。**画一个转圈就是在编。** 唯一允许动的是 §5.4 的 **12s 慢呼吸光晕** + **4s 一行的睡 log** —— 它们表达**时间流逝**，不是**工作进度**。这是两个语义，不得混用 |

**同时循环动画上限 = 1**：LIVING 环境层（呼吸光晕）是常驻循环；骨架屏 shimmer 在有加载态时出现，
此时**光晕呼吸暂停**（`animation-play-state: paused`，通过 `data-busy` 属性切换）。

### 5.6 `prefers-reduced-motion: reduce` 降级

**不是「关掉动画」，是「换成静态等价表达」**。所有状态必须仍可读。

| 原动效 | 降级后 |
|---|---|
| 呼吸光晕 | 静态光晕（`animation: none`，opacity 取计算值） |
| 顶部脉冲带 | 静态 `--living-gain` 亮度，无位移 |
| 骨架屏 shimmer | 静态斜纹 `repeating-linear-gradient(45deg, --surface-raised 0 6px, --surface-float 6px 12px)`，opacity .35 |
| 三点思考 `thinking-dots` | 静态实心点 + 文案「正在思考」 |
| `sleep-tick` 滚动 | 静态列表（保留全部行，不裁切） |
| 刻度器档位过渡 | 立即切换 |
| 所有进入/退出 | `animation: none; transition-duration: 0ms` |
| 指针跟随 | `transform: none`（已有 `@media (pointer: coarse)` 规则，扩展到 `reduce`） |

**代码落点**：`styles.css` 的 `@media (prefers-reduced-motion: reduce)` 块（当前 2 处，第 897 行、第 1205 行）**合并为 1 处**，置于文件末尾。

**可访问性硬约束**：任何**状态**（运行中 / 等待确认 / 阻塞 / 成功 / 失败）**不得**仅靠动效或仅靠颜色表达。
每个状态必须同时有：文字标签 或 形状差异。
当前 `.running-pill i`（脉冲圆点）、`.status-pill`（纯色文字）、`.flow-dot`（空心圆）需补文字或形状区分。

---

## §6 存在感刻度器（Presence Dial）

### 6.1 一套语法，两处形态

> **状态栏与模式菜单用的是同一个组件、同一种语法、同一套几何。模式菜单里的每一行是状态栏刻度器的静态展开。**

现状问题（截图 `clipboard-…-3fccad5f.png`）：`.dial` / `.menu-dial` 各画 6 根高度递增的柱子，
亮起的是**最短的几根**（`PRESENCE[q] <= PRESENCE[m]` 且按 q 的顺序排列 → 亮的在左边最矮的），
读起来像「信号强度条越矮越强」，语义完全反了；且 6 根柱子 vs 5 个档位（0..5）数量也对不上。

### 6.2 几何定义（唯一）

**刻度 = 5 格**（对应 presence 1..5；0 档 = 全灭）。

| 形态 | 单格宽 | 单格高 | 格间距 | 总宽 | 用途 |
|---|---|---|---|---|---|
| **sm**（紧凑） | 3px | 10px | 2px | **23px** | 状态栏、标题栏模式控件 |
| **md**（完整） | 4px | 12px | 2px | **28px** | 模式菜单行、会话带胶囊内的缩略 |

```
sm:  ▮ ▮ ▮ ▮ ▮      (23 × 10)
md:  ▮ ▮ ▮ ▮ ▮      (28 × 12)
```

**填充规则（从左向右，与旧实现相反）**：

- 第 1..N 格 = **已点亮**，N = 当前档位。
- 第 N+1..5 格 = **未点亮**（`--line-soft`），表示「还有余量」。
- 每一格的不透明度按位置递增，形成「渐亮的光束」而非平涂：
  第 i 格 `opacity = 0.55 + 0.1125 × (i-1)` → 第1格 .55，第5格 1.0。
- **当前档位格**（第 N 格）额外：填充色从 `--beam` 提升为 `--beam-bright`，并在其**上方 2px** 处
  加一条 2×2px 的 `--beam` 刻度游标（`gap: 2px`）。
- **0 档（IDE）**：5 格全部 `--line-soft`，**不渲染任何光晕、不渲染刻度器本体**（见 §7.5）。

**前沿辉光**：第 N 格带 `box-shadow: 0 0 6px rgba(207,224,240,.35)`；N=0 时无。

### 6.3 组件 API 与代码落点

**新建** `ui/src/components/PresenceDial.tsx`：

```tsx
export function PresenceDial({
  level,            // 0..5
  size = 'sm',      // 'sm' | 'md'
  current = true,   // 是否标记为「当前档位」
  className = '',
}: { level: number; size?: 'sm' | 'md'; current?: boolean; className?: string }) {
  return (
    <span className={`dial dial-${size} ${current ? 'is-current' : ''}`}
          role="img" aria-label={`存在感 ${level}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} className={`dial-cell ${i <= level ? 'on' : ''} ${current && i === level ? 'is-current' : ''}`} />
      ))}
    </span>
  );
}
```

**CSS 落点** `styles.css`（删除 `.dial`、`.menu-dial` 两套旧规则，替换为一套）：

```css
.dial { display: inline-flex; align-items: stretch; gap: 2px; height: 10px; }
.dial-md { height: 12px; gap: 2px; }
.dial-cell { width: 3px; border-radius: 0; background: var(--line-soft); }
.dial-md .dial-cell { width: 4px; }
.dial-cell.on { background: var(--beam); opacity: .55; }
.dial-cell.on:nth-child(2) { opacity: .66; }
.dial-cell.on:nth-child(3) { opacity: .78; }
.dial-cell.on:nth-child(4) { opacity: .89; }
.dial-cell.on:nth-child(5) { opacity: 1; }
.dial-cell.is-current { background: var(--beam-bright); opacity: 1; box-shadow: 0 0 6px rgba(207,224,240,.35); }
/* 当前档位游标：上方 2px 的刻度 */
.dial.is-current::before {
  content: ''; position: absolute; top: -3px; width: 2px; height: 2px;
  background: var(--beam); left: calc(3px * var(--level) + 2px * (var(--level) - 1));
}
.dial { position: relative; }
```

> 游标定位用 `--level` 变量（组件写入 `style={{'--level': level}}`），
> sm 宽度 = `3px × level + 2px × (level-1)`，md 宽度 = `4px × level + 2px × (level-1)`。
> 为避免两条公式，md 用同一公式并把 `--cell-w` 设为变量：`--cell-w: 3px`（md 为 4px）。

### 6.4 状态栏中的刻度器

**位置**：状态栏**左区第一项**，紧贴左边缘 10px 内。

**形态**：`sm`（23×10）+ 模式名。

```
[▮▮▮▮ ▯]  coding · 编码协作
```

- 刻度器：`--text` 无背景，纯几何。
- 模式名：中文模式名 `--fs-label`（11px/500）`--text-1`；内核模式标识（`coding`）用 mono 10px `--text-3` 置于其后，用 `·` 分隔。
- **IDE 模式**：不渲染刻度器（0 宽），只渲染 `IDE` 文本标签。点击仍然打开模式菜单。

**代码落点**：`views.tsx` `StatusBar` —— 删除 `.dial` / `.menu-dial` 的 `ALL_MODES.map` 渲染，
替换为 `<PresenceDial level={PRESENCE[mode]} size="sm" />`。

### 6.5 模式菜单中的刻度器

**位置**：模式菜单每一行的**第一列**，固定 28px 宽（md 形态），**所有行左对齐、同一基线**。

```
[▮▮▮▮▮]  goal      只谈目标，隐藏代码库        ✓
[▮▮▮▯▯]  coding    编辑与对话并行
[▮▮▯▯▯]  advisor   批注代码并交回内核
[▮▯▯▯▯]  helping   执行流停靠在文件树下方
[▯▯▯▯▯]  deepsleep ⟨W2⟩
[     ]  IDE       仅编辑器，无智能体
```

**规则**：
- 每行的刻度器显示**该行自己的档位**（不是当前档位），因此 6 行天然形成一条**可比较的阶梯**。
- 当前档位行：`.is-current` → 整行背景 `--beam-wash` + 左侧 2px `--beam` 竖条（沿用现有 `.mode-menu button.is-current` 规则）+ 右侧 `✓`。
- **所有行使用完全相同的动画语法**：非当前行的刻度器**不动画**；当前行的刻度器随 `--intensity` 呼吸。
  → 彻底消除「有的有动画有的没有」的观感：**菜单本身不动画，动画只在当前档位上，且与状态栏同一来源**。

### 6.6 档位过渡动效（模式切换时）

使用 CSS `@property` 注册数值型自定义属性，使 `--presence` 可过渡：

```css
@property --presence    { syntax: '<number>'; inherits: true; initial-value: 0; }
@property --living-gain { syntax: '<number>'; inherits: true; initial-value: 0; }
@property --intensity   { syntax: '<number>'; inherits: true; initial-value: 0; }

.app-shell {
  transition: --presence 320ms var(--ease-move),
              --intensity 320ms var(--ease-move);
}
```

- 模式类切换 → `--presence` 从旧值过渡到新值 → `--intensity` 重算 → 光晕、刻度器辉光同步过渡（**320ms**）。
- 逐格级联：第 i 格的点亮使用 `transition-delay: (i-1) × 40ms`（0/40/80/120/160ms），总感知时长 320+160 = **480ms**（≤ 640ms 上限）。
- **`--living-gain` 过渡 120ms**（`--t-fast`），因为它是内核事件的瞬时信号，过渡太长会拖影。
  → 拆开：`transition: --presence 320ms ..., --intensity 320ms ...;` 且 `--living-gain` 不参与过渡
  （由 `living.ts` 每次直接写值，配合 `--intensity` 的 320ms 过渡获得平滑衰减）。

**代码落点**：`styles.css` 顶部新增 `@property` 块；`living.ts` 的 `write()` 保持不变（仍写 `--living-gain`）。

### 6.7 极端形态

| 档位 | 形态 |
|---|---|
| **0（IDE）** | **刻度器整体不渲染**（宽度 0）。整个智能体表面不存在：光晕不渲染、状态栏无刻度、无模式名以外的存在感标识。模式菜单里 IDE 行的刻度器显示为**全灭的 5 格空轨**（明确表达「刻度存在，但你在 0」） |
| **1（deepsleep）** | 1 格点亮（opacity .55）+ 前沿辉光 + 12s 呼吸光晕（opacity ≈ .12）。状态栏刻度器左侧额外挂 2px 的 `--info` 色点表示「休眠中」 |
| **5（goal）** | 5 格全亮（第5格 opacity 1.0）+ 前沿辉光最强（`0 0 8px rgba(207,224,240,.45)`）+ 8s 呼吸。goal 模式下整个标题栏 brand/session/status 的透明化（现有 `.mode-goal` 规则）保留，但**刻度器不透明**（它是唯一的存在感标识） |

---

## §7 布局骨架

### 7.1 桌面端信息架构

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ R0  TITLE BAR  36px                                                            │
│ [◈18] pristem. │ [▮▮▮▮ coding 编码协作 ▾] │ [● session 01][● session 02][+]  │
│                │ [proj-chip] │ [⌕ search ───────] │ [⌘] │ [─][□][✕]          │
├──────────────────────────────────────────────────────────────────────────────┤
│ R1  SESSION STRIP  28px                                                        │
│ [◉ session 01 ×] [◉ session 02 ×]                          2 sessions        │
├──────────────┬───────────────────────────────────────────┬───────────────────┤
│ L  LEFT 268px│  STAGE  (flex)                            │  CONSOLE  360px   │
│              │                                           │                   │
│ ┌──────────┐ │  ┌─ doc strip 22px ──────────────────┐   │  ┌─ head 40px ──┐ │
│ │▮▮▮▮ 28px │ │  │ breadcrumb          Ln 14, Col 4 │   │  │[▮▮▮▮] coding │ │
│ │文件 搜索 │ │  ├────────────────────────────────────┤   │  │        ⤓  ✕  │ │
│ │版本   ⚙  │ │  │  (Monaco / 审阅画布 / 目标对话)     │   │  ├─ vitals 26px┤ │
│ ├──────────┤ │  │                                    │   │  │in 1.2k out…  │ │
│ │ view seg │ │  │                                    │   │  ├─ transcript ─┤ │
│ │ 24px     │ │  │                                    │   │  │             │ │
│ ├──────────┤ │  │                                    │   │  │             │ │
│ │ 文件树   │ │  │                                    │   │  ├─ composer ──┤ │
│ │ (flex)   │ │  │                                    │   │  │             │ │
│ └──────────┘ │  └────────────────────────────────────┘   │  └─────────────┘ │
├──────────────┴───────────────────────────────────────────┴───────────────────┤
│ ACTIVITY STRIP  176px   [终端][输出][问题]        [bash 1 ×][bash 2 ×][+]  [⌄] │
├──────────────────────────────────────────────────────────────────────────────┤
│ R4  STATUS BAR  24px                                                           │
│ [▮▮▮▮] coding 编码协作 │ ● 内核已连接      #1 │ 1.2k in 340 out │ 中 │ ipc │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 常驻 / 按模式出现 / 可折叠

| 区域 | 状态 | 说明 |
|---|---|---|
| R0 标题栏 | **常驻** | IDE 模式下品牌块整体不渲染（0 档） |
| R1 会话带 | **常驻** | 高度 28px；session 胶囊不是 tab（无下划线、无矩形） |
| L 左列 268px | **常驻**（goal/advisor/deepsleep 可为 0） | |
| STAGE | **常驻** | 内容随模式变化 |
| CONSOLE 360px | **仅 coding** | 可折叠为 0（`--right-w: 0`），折叠状态由一个 32×32 的「◈ 展开控制台」按钮贴在舞台右上角 |
| ACTIVITY STRIP 176px | 常驻（goal/advisor/deepsleep 整个工作区被替换，活动带不存在） | 可拖拽调高 120–420px；折叠**不是高度 0**，而是收成 **8px 把手条**（`.activity-handle`），折叠后入口仍可见 |
| R4 状态栏 | **常驻** | |

### 7.3 模式差异表

| 模式 | 档位 | 左列 268px | STAGE | CONSOLE | 活动带 176px | 状态栏刻度 | 标题栏光晕 |
|---|---|---|---|---|---|---|---|
| **IDE** | 0 | 文件/搜索/版本 | Monaco 编辑器 | **无** | 有（终端属于人） | **无刻度**，仅 `IDE` 文字 | **无** |
| **helping** | 2 | 文件/搜索/版本 | Monaco 编辑器（上 60%）+ **控制台停靠底部通栏**（下 260px，宽度 = 舞台全宽） | 无右侧列 | **收成 8px 把手条**（被控制台取代） | 2 格 | 10s 呼吸，opacity .22 |
| **coding** | 4 | 文件/搜索/版本 | Monaco 编辑器 | **右侧 360px** | 有 | 4 格 | 5.2s 呼吸，opacity .44 |
| **advisor** | 3（**0 宽**） | 审阅画布（通栏）+ 右侧批注轨 300px | — | 无 | **不存在**（工作区被替换） | 3 格 | 9s 呼吸，opacity .33 |
| **goal** | 5 | 居中对话，max-width 720px | — | 无 | **不存在**（工作区被替换，**连折叠把手也不存在**，见 §8.11.6） | 5 格 | 8s 呼吸，opacity .55 |
| **deepsleep** | 1 | **保留但变暗**（`filter: saturate(.5) brightness(.66)`，`pointer-events:none`） | 同进入 deepsleep 前的模式 | **无，且不渲染控制台**（见下方「deepsleep 不渲染控制台」） | 变暗 + **收成 8px 把手条**（入口仍在，§8.11.6） | 1 格 + 休眠点 | 12s 呼吸，opacity .12 |

**命令帮助浮层（`.help-pop`）整体删除**

旧的 `CommandHelp` 浮层（`views.tsx`）由**命令面板 `Ctrl+Shift+P`** 承载全部命令表（见 `UX_SPEC.md` §2 功能归属表：
原 10 个菜单动作 + 7 个活动栏入口**全部**有命令面板归属）。
→ `help.*` 系列 i18n key（`help.deepsleep` 等）随之删除。
→ **`help.deepsleep`「交回内核消化」命中禁用类别 ②**，即使保留浮层也必须改 —— 两条路都指向删除。

**deepsleep 不渲染控制台（写死，不可改）**

deepsleep 期间**不渲染**右侧控制台（AI 面板），四条理由：
1. **一致性** —— 工作台整体是「变暗 + `pointer-events:none` 的背景」，编辑器 / 文件树 / 活动带**都不可滚动不可交互**；单独给对话开一个可读区，与「背景」的语义自相矛盾。
2. **不制造「它还醒着」的错觉** —— 控制台是 `data-ai="true"` 表面，而 deepsleep 档位 = 1（智能体在休息）。摆一个带输入面的控制台，正是用户抱怨的「看起来在忙，其实没有」。
3. **内容不丢** —— 对话在 `active.items`，`mode_changed` **不清空**它，「继续工作」一次点击后完整可见。
4. **已有替代** —— deepsleep 层用「进入休眠前的执行链」（可逐行展开到原始输出，§8.7.3 的 L3）+ 唤醒简报，承载了「它刚才做了什么 / 它学到了什么」。用户要的是结论，不是全文。

> **将来若要改成只读控制台**，三条条件必须**同时**满足：① deepsleep 层**不覆盖**右侧列；② 控制台有独立只读形态（无 composer）；③ 状态栏元素数 ≤ 6 不被破坏。**当前一条都不具备，所以不做。**

**关键差异点（不是 VSCode 的地方）**：
1. **helpinng 的控制台在下方通栏**，不是右侧列 —— 智能体在替你做事时，编辑器让位。
2. **coding 与 helping 的控制台位置不同** —— 两种工作关系的空间表达不同，不是同一个壳换内容。
3. **deepsleep 不卸载工作台** —— 工作台变暗保留，用户始终有「回到工作台」的路径（见 §8.4）。
4. **IDE 模式下活动带保留**（终端是人类工具，不是 AI 表面），但控制台、刻度器、光晕全部不存在。

### 7.4 为什么不长成 VSCode（逐条对应用户的批评）

| VSCode 特征 | 用户原话 | pristem 的做法 | 为什么 |
|---|---|---|---|
| 标题栏菜单栏（会话/视图/内核/帮助） | 「借鉴到了 vscode 最边缘的设计」 | **智能体模式删除菜单栏**。全部命令进命令面板（Ctrl+Shift+P）；模式切换变成标题栏里的**常驻可见控件**；设置进左栏 ⚙。**IDE 模式例外（2026-11-15 决策）**：IDE 是纯编辑器，命令量足以需要索引，标题栏项目 chip 之后渲染 `.menubar`（File/Edit/View/Run/Help），与命令面板共用 `commands.ts` 一张表 | 菜单栏是「功能索引」。智能体的操作面是「状态 + 一个输入口」，不是菜单树。IDE 模式下没有智能体表面，用户是编辑器用户，菜单栏是他们的既有肌肉记忆。类名必须是 `.menubar`，不复活 `.title-menus` |
| 48px 图标活动栏 + 一堆侧面板挤在左栏 | 「挤在左栏的一堆侧面板」 | **删除活动栏**。左列头部 24px 的 **3 段视图切换器**（文件/搜索/版本）替代 | VSCode 的活动栏是「装更多插件」的产物。pristem 的文件/搜索/版本是**同一块工作区的三个投影**，用分段切换器更诚实，也省下 48px 给编辑器 |
| 底部状态栏塞满 git/诊断/光标/缩进/EOL | 「底部塞满的状态栏」 | 状态栏只回答**两个问题**：它在哪一档（刻度 + 模式）、它刚花了多少（用量 + 连接状态）。分支移到版本面板、诊断移到问题视图、光标/语言/EOL/缩进移到**文档状态条** | 状态栏是有限资源。pristem 的状态栏是**生命体征**，不是 IDE 上下文转储 |
| 三个假 tab（终端/输出/问题） | 「三个假 tab 的终端面板」 | 做成**真实的分段按钮**（`role="tab"` + `aria-selected`），并引入**终端实例**（bash 1 / bash 2） | 三者在 VSCode 里是平级 tab，因为它们是「人做三种事」。在 pristem 里它们是**一次智能体活动的三个投影**，因此归属同一个「活动带」，且终端有多个实例 |
| 右下角永远在右的 AI 面板 | 「cursor 最讨厌的部分：永远在右的 AI 面板」 | 控制台**只在 coding 出现**；helping 时它移到下方通栏；goal/advisor/deepsleep 完全没有；可折叠为 0 | 「永远在右」= AI 是外挂。pristem 的智能体是**在场**，它在场的形态随工作关系改变，不是固定插槽 |
| 面板头部堆 logo + 字标 + 模式 chip + 演示标签 | 「面板头部堆着 logo+字标+模式 chip+演示标签」 | 控制台头部只有：**刻度器 + 模式名** + 右侧 2 个图标按钮。连接状态**全局只有状态栏一处** | 头部是给「当前状态」用的，不是给「品牌 + 徽章」用的 |
| goal 模式三张巨大卡片模板 | 「目标模式三张巨大卡片模板」 | 改成**一行起步句 chip**（见 §8.2） | 模板是「让你从别人的起点开始」。pristem 的目标空间应该从**你的一句话**开始 |
| 「打开文件夹」= 路径输入框 | 「把打开文件夹做成路径输入框」 | **原生文件夹对话框**为主 + 路径粘贴为兜底（见 §8.6） | 手输路径是开发者的工具。人打开文件夹的动作应该是**选** |

### 7.5 IDE 模式的架构性休眠（不破坏既有约定）

**硬约束（来自既有架构约定，必须继续满足）**：IDE 模式下 DOM 中 `[data-ai="true"]` 元素数 = 0。

因此：
- 标题栏品牌块（棱镜 + 光晕 + 字标）在 IDE 模式下**整体不渲染**。
- 状态栏刻度器不渲染（宽度 0）。
- 控制台不存在。
- 状态栏保留一个纯文本 `IDE` 标签（chrome，不是 AI 表面，**不加 `data-ai`**）与模式菜单入口（F2 / 命令面板 `/mode coding`）。
- **验收**：`.visual-check/check.cjs` 现有断言 `IDE: ZERO AI elements in DOM` 必须继续通过。

**代码落点**：`App.tsx` 中 `mode === 'IDE'` 时对标题栏品牌块与状态栏刻度器做条件渲染。

---

## §8 专项组件规范

### 8.1 控制台（AI 面板）头部 —— 解决「头部堆砌」与「品牌分裂」

**目标形态**：

```
┌──────────────────────────────────────────────┐
│ [▮▮▮▮] coding · 编码协作        [● 工作中] ⤓ ✕ │
├──────────────────────────────────────────────┤
│ in 1.2k · out 340 · cached 8.1k · 4 calls · 3.2s │  ← vitals 条（26px）
├──────────────────────────────────────────────┤
```

| 元素 | 规格 | 相对现状 |
|---|---|---|
| 刻度器 | `sm` 23×10 | **新增**（当前无） |
| 模式名 | 中文 `--fs-label` 11px/500 `--text-1` + `·` + 内核标识 mono 10px `--text-3` | **替换** `.mode-chip` |
| 运行态 | 「工作中 / 等待确认 / 已阻塞」文字 + 6px 点 | **替换** `.running-pill`（当前只有 working） |
| 导出 / 收起 | 24×24 图标按钮 `--text-3` | 保留 |
| **删除** | — | `.living-core`（→ 移到标题栏光晕）、`pristem` 字标、`.ai-demo-tag` |
| **删除** | — | composer 脚部的 `pristem-core` 文字按钮 |

**代码落点**：`views.tsx` `AiPanel` 的 `.ai-head`；删除 `<LivingCore/>` 与 `<AiDemoTag/>`；新增 `<PresenceDial/>` 与模式名。

### 8.2 目标（goal）视图 —— 解决「三张巨大卡片」与「假的目标/约束/取舍」

**8.2.1 删除 INTENT_CHIPS（问题 10）**

`views.tsx` 的 `INTENT_CHIPS`（目标/约束/取舍）点击只是往输入框拼 `"目标: "` 前缀，
**没有任何语义**——内核不解析这个前缀。用户评价「编的功能」是准确的。

> **决策：删除 `.intent-chips` 与 `goal.intent1/2/3` 三条 i18n。**

理由不止是「假」：界面上的每一个控件都必须在语义上可兑现。
这三个 chip 让用户以为内核在接收结构化意图，实际没有。**宁可少一个控件，不可多一个假控件。**

若未来内核真的支持结构化目标（`ClientRequest::submit_round` 带结构化字段），再以
**真正生效的结构化表单**加入，而不是用文本前缀伪装。

**8.2.2 目标模板 → 起步句（问题 9）**

**从卡片改为 chip**：

```
┌────────────────────────────────────────────────────────┐
│  还没有设定目标                                         │
│  用一句话描述你想达成的结果                              │
│                                                        │
│  (梳理一个架构决策) (拆解一个模糊目标) (比较两条路线)    │  ← 一行 chip
│                                                        │
│  ┌──────────────────────────────────────────┐  [↑]      │
│  │ 你想达成什么？                            │           │
│  └──────────────────────────────────────────┘           │
└────────────────────────────────────────────────────────┘
```

| 属性 | 规格 |
|---|---|
| 容器 | `.goal-starters`，`display:flex; gap:6px; flex-wrap:wrap; justify-content:center; max-width:560px; margin:0 auto` |
| 单个 | 高 **26px**，padding `0 10px`，`border-radius: 999px`，底 `--surface-inset`，边 `1px --line-hair`，文字 `--fs-body-sm` 12px `--text-2` |
| hover | 底 `--surface-raised`，边 `--accent-quiet`，文字 `--text-1`，**120ms** |
| active | `transform: scale(.97)`，**90ms** |
| 点击行为 | **填入输入框，不自动发送**（与现状一致） |
| 数量 | 固定 3 个（文案走 i18n） |

**删除**：`.goal-templates`（`grid-template-columns: repeat(3, minmax(0,220px))`）、
`.goal-template`（`min-height:88px; padding:14px`）及其 nth-child 动画延迟。

**8.2.3 目标状态条**

`.goal-card`（当前是一张 2 行卡片）改为 **1 行状态条**（32px）：

```
目标空间 · session 01                     [还没有设定目标]
```

- **内核不持有结构化目标**（`ClientRequest` 的 12 个变体里没有任何 goal 字段），
  所以状态条**不得**显示「内核提供的目标文本」。
- **诚实口径**：显示**用户自己写的最后一条目标陈述**（来源 = 本会话最后一条 `/goal …` 用户消息，UI 本地状态），
  行尾挂 chip「**你的陈述**」—— 明确这不是内核持有的状态。
- 没有则显示「**还没有写下目标**」。
- **禁止**「内核已设定目标」「内核已确认目标」这类暗示内核持有状态的措辞。
- goal 模式隐藏代码库表面时**不隐藏表达能力**：composer 与 3 个起步句 chip 照常渲染
  （§9.5 F7 只约束「代码库表面」，不约束「表达」）。
- **不做任何结构化目标控件**（目标 / 约束 / 取舍三件套）：表达方式 = **一条普通 round 消息**，
  UI 不做字段切分、不加前缀、不做三段解析。三个起步句 chip 是**文本模板**（填入输入框、用户可改、作为普通消息发送），
  因此诚实 —— 内核收到的就是普通文本。

**8.2.4 删除目标视图的品牌块**

`.goal-brand`（棱镜 40 + `.goal-wordmark` 52px 衬线 + `.goal-sub`）**整体删除**。
标题栏已有唯一字标，目标视图不再重复。

**代码落点**：`views.tsx` `GoalView`；`styles.css` 删 `.goal-brand` / `.goal-wordmark` / `.goal-sub` /
`.goal-templates` / `.goal-template` / `.intent-chips` / `.intent-chip`；
`i18n.ts` 删 `goal.intent1/2/3`，新增 `goal.starters` 区域文案。

### 8.3 连接状态与「演示痕迹」清除（问题 5）

**现状**：`IS_DEMO`（`config.ts`）驱动 3 处标签 —— 状态栏 `.demo-badge`（"离线演示内核"）、
AI 面板头 `.ai-demo-tag`（"演示执行流"）、工具卡 `.demo-source-tag`（"非真实推理"）+ `.tool-card-demo-prefix`（"演示数据"）。

**决策**：

> **R-CONN-1：连接状态全局只有 1 处表达 —— 状态栏右区左侧的一个状态点 + 文本。**
> **R-CONN-2：任何面板、卡片、Toast 不得重复表达连接状态。**
> **R-CONN-3：可见文本中不得出现「演示 / demo / 假数据 / 未完成 / 占位 / TODO / 假」等词。**

**唯一的状态表达（状态栏）**：

| 内核状态 | 文本 | 指示 | 颜色 |
|---|---|---|---|
| 已连接真实 provider | `内核已连接` | 6px 实心圆 | `--success` |
| 已连接，离线夹具 transport | `离线夹具` | 6px 实心圆 | `--warn` |
| 未连接 | `内核未连接` | 6px 实心圆 | `--danger` |
| 连接中 | `正在连接内核` | 6px 圆 + 脉冲（`--t-fast` 1.4s 呼吸） | `--beam-dim` |

- 「离线夹具」是**一个真实的、被命名的传输模式**（`DemoTransport` 是内核里真实存在的实现），
  不是「未完成」的托词。它的 tooltip 沿用现有 `status.demoLong` 的诚实说明：
  「未连接真实模型，输出由内核离线协议夹具按调用次数生成，不代表真实推理或真实文件变更」。
- **删除** `.ai-demo-tag`（`AiDemoTag` 组件整体删除）、`.demo-source-tag`、`.tool-card-demo-prefix`。
- `config.ts` 的 `IS_DEMO` 保留（Phase 3 仍需据此选状态文案），但**只用于状态栏一处**。

**代码落点**：`views.tsx` `StatusBar`（新增 `connState`）；`ChromeExtras.tsx` 删除 `AiDemoTag`；
`ToolCard.tsx` 删除 demo tag 与 demo prefix；`styles.css` 删除 `.ai-demo-tag` / `.demo-source-tag` / `.tool-card-demo-prefix`。

### 8.4 deepsleep 视图 —— 解决「唤不醒/回不去」与「毫无动态」

**8.4.1 结构问题**

`App.tsx` 中 `fullView = mode === 'advisor' || mode === 'deepsleep' || mode === 'goal'`，
deepsleep 会**卸载整个 workbench**（`.workspace` 整块被条件渲染掉），
只剩 `DeepsleepView` 一个 `full-view`。用户被关在一个黑盒子里，唯一的出口是状态栏的模式菜单。

**决策：deepsleep 不再是 fullView。**

```
coding ──[切换到 deepsleep]──►  工作台保持挂载
                                ├─ .workspace  filter: saturate(.5) brightness(.66)
                                │               pointer-events: none
                                │               （终端/编辑器内容可见但不可交互）
                                └─ 叠一层 .deepsleep-layer（覆盖工作区，不覆盖标题栏/会话带/状态栏）
```

- **标题栏、会话带、状态栏保持正常渲染且可交互** —— 用户随时能看到自己在哪一档、随时能切回来。
- `.deepsleep-layer` 只覆盖工作区（`grid-area` 在 workbench 之上），z-index 低于标题栏。
- **明确出口**：deepsleep 中央列底部有 **两个行动按钮**：
  - 「继续工作」→ 发 `switch_mode coding`（**走内核**，UI 不自行 setMode，符合既有架构约定）
  - 「请求唤醒简报」→ 发 `list_reminders`（既有 `onWake`）

**8.4.2 中央列内容（最终形态）**

```
                    ░░░░░░░░░░░░░░░░░░░
                    ░   [棱镜 24px]      ░     ← 呼吸光晕 12s
                    ░                    ░
                       deepsleep          ← eyebrow mono 10px .14em, --text-3
                    智能体正在休息          ← --fs-display 26px/600 --text-1
                    消化这一轮的经验        ← --fs-subtitle 15px/600 --text-2（无斜体！）
                    ─────────────────
                    当前会话已归档，工具面已收窄。智能体保持安静，
                    直到你请求唤醒简报。

                    ┌ 进入休眠前的执行链 · 3 步 ──────┐
                    │ ● 12:04:31  read      1.4 KB  ok│
                    │ ● 12:04:32  search    3 行     ok│
                    │ ● 12:04:33  answer    —        完成│
                    └─────────────────────────────────┘
                    （链为空时整块不渲染；此处不显示 vitals）

              [ 继续工作 ]   [ 请求唤醒简报 ]

              ▸ 已归档 · 14:32   （睡 log，4s 推一行 · 纯本地墙钟）
```

| 元素 | 规格 |
|---|---|
| 容器 | `.deepsleep-center`，`max-width: 560px`，`text-align:center` |
| 标题 | `--fs-display` 26px/600，**`--font-ui`**（不是衬线），`--text-1` |
| 副标题 | `--fs-subtitle` 15px/600 `--text-2`，**无 `em`、无斜体** |
| 说明 | `--fs-body` 13px/1.65 `--text-3`，`max-width: 420px` |
| 执行链 | **快照**：数据源 = **进入休眠之前**那一轮已发生的 `call`/`result`（在 UI 本地 transcript 里）。标题写实为「**进入休眠前的执行链 · N 步**」——**不是**「休眠期间的」。**N = 0 时整块不渲染**（不画空框、不画占位符、不写「暂无」）。视觉规格同 §8.7.3。**类名 `.deepsleep-chain`** |
| 按钮 | 主按钮 `--beam` 底（36px 高）；次按钮描边（36px 高） |
| 睡 log | mono 10.5px / 行高 26px，4s 推一行（§5.4） |

**8.4.2a 「工具面已收窄」为什么是真的（依据，不是修辞）**

```
mode.rs:88    Self::Deepsleep => &["read","search","solo","pause","reminder"]                       // 5 个
mode.rs:58    Self::Coding    => &[read,search,write,edit,delete,exec,reminder,skill-load,improve]   // 9 个
agent_loop.rs:203   validate_calls_for_mode(&calls, &firewall.tool_table)                            // 越界调用会被拒
```

deepsleep 真的拿不到 `write` / `edit` / `delete` / `exec` —— 这是**运行时生效的机制**，不是比喻。
所以「工具面已收窄」是**可验证的事实陈述**；而「干净实例正在复盘输出链」是**假的**（`spawn_clean_instance` 生产代码零调用方）。

**8.4.2b deepsleep 不显示 vitals（用量）条**

clean instance 走**另一条推理路径**（`SoloChannel`），当前**不产生 `usage` 事件**，
因此 deepsleep 视图里**用量区整块不渲染**（与 §8.7.2「无事件不渲染」同一条规则，不显示 0、不显示破折号）。
vitals 条只出现在**控制台侧**（coding / helping / advisor）。

> **数据源说明（内核已核实）**：clean instance 是独立实体，**不跑 agent round**，
> 因此 deepsleep 期间内核**不会发出** `call` / `result` / `speech`。
> 上面的「进入休眠前的执行链」是**快照**，不是休眠期的实时流。
> 内核若将来把 clean instance 的 solo 活动回灌主会话事件流（B-12，P2），
> 本节可升级为实时链 —— **但前端不依赖它，不等它**。

**8.4.3 「回到工作台」的路径（硬要求）**

必须存在**三条**互相独立的返回路径，任何一条都不得依赖用户「知道 F2」：
1. deepsleep 中央列的 **「继续工作」** 主按钮。
2. **状态栏模式控件**（一直可点，一直能切回 coding）。
3. 唤醒简报卡片上的 **「回到工作台」** 次按钮。

**代码落点**：`App.tsx` 把 `fullView` 改为 `mode === 'advisor' || mode === 'goal'`；
新增 `.deepsleep-layer` 容器；`views.tsx` `DeepsleepView` 改为层内内容并接收 `onResume`（继续工作）。

### 8.5 唤醒简报卡片 —— 解决「不可关闭」与「标题灾难」

**8.5.1 必须可关闭**

现状：`wake-overlay` 覆盖整个视图（`position:absolute; inset:0; z-index:20`），**没有关闭按钮**，
只有「恢复会话」一个按钮。用户必须二选一：恢复，或永远留在这个遮罩里。

**决策**：

- 卡片右上角加 **关闭按钮**（24×24，`✕`），点击 → 只关闭覆盖层（**纯本地 state**，不改变模式、不发请求）。
- 卡片底部两个按钮：**「回到工作台」**（次按钮，只关卡片）+ **「恢复会话」**（主按钮，发 `resume` + `switch_mode coding`）。
- 覆盖层不再 `inset:0` 全屏阻断，改为**覆盖工作区**（与 deepsleep 层同域），标题栏/会话带/状态栏仍可交互。

**8.5.1b 唤醒简报的三态（不得混在一起）**

| 状态 | 数据 | 渲染 |
|---|---|---|
| `wakeBriefing === null` | **还没请求** | 「还没有唤醒简报」+ 「请求唤醒简报」按钮；**不渲染**卡片 |
| `wakeBriefing` 是**空数组** | 请求了但**无规则** | 卡片**只渲染**「回到工作台」；**不渲染**「恢复会话」（没有东西可恢复）；正文写 **W6**（文案见 §8.12 权威表） |
| 有规则 | 1..N 条 | §8.5.2 的完整三层形态（标题 / lead / 编号清单 ≤ 5 条 + 两个按钮） |

**8.5.2 卡片规格**

| 属性 | 现值 | 新值 |
|---|---|---|
| 宽度 | 540px | **480px** |
| 内边距 | 28px 32px | 24px 28px |
| 标题 | `.wake-card h2` 44px 衬线（中文 → 宋体灾难） | **24px / 600 / `--font-ui`**，`--text-1` |
| 眉标 | `唤醒简报` eyebrow | 保留 `wake.title`，mono 10px |
| 徽章 | ~~`已提交新规则`~~ 右上 chip（**已废弃**） | **W4** —— 「已提交」暗示休眠期有新规则被写入，而内核实际是**模型在之前的普通轮次里调 `reminder` 工具写入**的（`executor.rs:316`），deepsleep 期间没有轮次在跑 → **不会产生新规则** |
| **条目语义** | — | **每条 = 一条内核已登记的 REMINDER 规则（沉淀下来的规则）**，**不是**「哪些文件变了」。因此清单项**不加文件图标、不加文件名、不加 ✓ 勾、不加「已修改 X」前缀** |
| 顶条 | 彩虹 `--spectrum` 2px | **1px `--line-beam`** 单色 |
| 清单项 | 12.5px，`01/02/03` 等宽前缀 | 12px，最多 **5 条**，超出折叠为「还有 N 条」 |
| **lead 引导句** | ~~「这是休眠中的智能体了解文件变化的唯一通道」~~（**已废弃**） | **W5**（answer gate 的真实语义，不是修辞。**不得**写「在休眠期间提交」—— 休眠期没有轮次在跑） |
| **不渲染的控件** | — | **编辑 / 删除 / 勾选一律不渲染** —— 内核 `ClientRequest` 的 12 个变体里没有修改 reminder 的请求，渲染编辑控件就是「编的功能」 |
| 按钮 | 仅「恢复会话」 | 「回到工作台」+「恢复会话」 |

**代码落点**：`views.tsx` `DeepsleepView` 的 `.wake-card` 分支；`styles.css` `.wake-card`；
新增 `onDismiss` prop（本地 state）。

### 8.6 文件树与「打开文件夹」 —— 解决「打不开文件夹」（问题 6）

**8.6.1 交互分层**

| 层 | 触发 | 行为 | 代码落点 |
|---|---|---|---|
| **主路径** | 文件树头部 `FolderOpen` 按钮 / 欢迎页「打开文件夹」/ 命令面板「打开文件夹」 | 发 `fs.pickFolder` → **壳层弹原生文件夹对话框** → 用户选中 → 壳层设 root 并发 `workspace` 事件 → UI 已有逻辑自动刷新树 | `App.tsx` `openFolderPicker` |
| **兜底** | 同一处的次级文字链接「或粘贴路径…」 | 弹出 `.path-dialog` 模态：mono 输入框（28px，高 `D:/projects`）+ 粘贴按钮 + 最近项目列表（`readRecent()` 前 5 条）+ 校验错误提示（`--danger`） | 新增 `components/PathDialog.tsx` |
| **已移除** | 文件树头部的路径输入框 | **删除** `.path-input` 与 `FileTree` 的 `pathInput` state | `workspace.tsx` `FileTree` |

**8.6.2 现状必须修的 bug**

- `App.tsx`：`openFolderPicker = () => setActiveView('files')` —— **只切视图，什么都没做**。
  → 改为 `const openFolderPicker = () => { void sendIo({ op: 'fs.pickFolder' }); }`。
- `shell/src/io.rs`：`"fs.openFolder" | "fs.pickFolder" => { let p = req.path... }` —— 两者被合并处理，
  `pickFolder` 收到空 path 后**沿用旧 root**，因此永远打不开新文件夹。
  → **壳层必须区分**：`pickFolder` 弹原生对话框并返回选中路径；`openFolder` 才接受路径参数。
  （跨层依赖，见附录 B）

**8.6.3 文件树本身**

| 项 | 规格 |
|---|---|
| 树头部 | 32px 高（当前 34px），左：文件夹图标 + 名称（`--fs-label`）+ 展开箭头；右：`FolderOpen` 24×24 + 刷新 24×24 |
| 树项行高 | 28px（保持） |
| 图标 | 14px（当前 16px），`--text-3` |
| 目录项 | **可展开**（当前 `disabled={f.dir}` 导致目录完全不可用 —— 这是第二个 bug） |
| 展开深度 | 最多 2 层 |
| 空态 | `EmptyState` 默认（**无棱镜**），18px 文件夹图标 + 「这个文件夹里没有可显示的文件」+ 行动「打开文件夹」 |

**代码落点**：`workspace.tsx` `FileTree`（`pathInput` state 删除、目录可展开、`treeIcon` 尺寸 14px）；
`styles.css` `.path-input` 删除、`.pane-head` 34→32px、`.tree-item svg` 尺寸。

### 8.7 执行链与用量 —— 解决「看不到 token 消耗与执行流程」（问题 4）

**8.7.1 协议层（内核必须先做，UI 不得编造）**

现状：`ui/src/types.ts` 的 `ServerEvent` **没有** usage 事件；`pristem-ipc/src/events.rs` 的 `ServerEvent` 也没有；
`pristem_provider::Usage { input_tokens, output_tokens, cached_tokens }` 只存在于 provider 内部，未上报。

**规范要求内核新增事件**（`pristem-ipc/src/events.rs`，协议版本升 `v0.4`）：

```rust
/// One round's cost and duration. Emitted once per round, right before `finished`.
Usage {
    session: u64,
    input_tokens: u64,
    output_tokens: u64,
    cached_tokens: u64,
    /// Wall-clock from `submit_round` to this event.
    elapsed_ms: u64,
    /// Number of `call` events in this round.
    tool_calls: u32,
},
```

序列化：`{"type":"usage","session":1,"input_tokens":1234,"output_tokens":340,"cached_tokens":8100,"elapsed_ms":3200,"tool_calls":4}`

**语义约定（必须写进内核 doc comment）**：
- 每个 round 结束时发一次，紧邻 `finished` 之前。
- `elapsed_ms` = 从 `submit_round` 到本事件的墙钟时间。
- `tool_calls` = 本 round 内 `call` 事件的数量。
- UI 收到后按 session 累加成会话累计。

**UI 侧对应改动**（`ui/src/types.ts`）：
```ts
| { type: 'usage'; session: number; input_tokens: number; output_tokens: number;
    cached_tokens: number; elapsed_ms: number; tool_calls: number }
```
`ui/src/living.ts` 的 `EVENT_MAP` 增加 `usage: 'settle'`（低强度 settle，**不应**引发大脉冲；`SIGNALS.settle.gain` 已是 0.15，可接受）。

**8.7.2 用量的可视形态（vitals 条）**

**位置**：**控制台头部正下方**，**26px 一行**（`.ai-vitals`）。
> **deepsleep 视图不显示 vitals**（§8.4.2b：clean instance 不产生 `usage` 事件，整块不渲染）。

```
in 1.2k · out 340 · cached 8.1k · 4 calls · 3.2s
```

| 元素 | 规格 |
|---|---|
| 容器 | 高 26px，底 `--surface-inset`，底边 1px `--line-hair`，左右 padding 12px |
| 数字 | `--fs-num` 不适用（行内）；用 `--fs-mono-xs` 10px mono，`--text-2`，`tabular-nums` |
| 分隔 | `·`，`--text-4`，间距 6px |
| **缓存条** | 数字前一段 **120px × 4px** 的三段比例条：`cached` 段 `--beam` 填充，`input` 段 `--line-strong`，`output` 段 `--beam-dim` |
| 缺失数据 | **整条不渲染**（不是显示 0） |

**「整条不渲染」是硬要求**：demo transport 不产生 `usage` 事件时，vitals 条**不存在**，
不留空白、不显示 `0 tokens`、不显示破折号。这是「不编造」原则的直接落地。

**8.7.3 执行链的形态**

**位置**：控制台 transcript 内，**作为一个可折叠的分组出现在每轮回答之后**；deepsleep 中央列同款。

```
┌ 执行链 · 4 步 ────────────────────────────  ▾ ┐
│ ● 12:04:31  read       src/main.rs        ok   │
│ ● 12:04:31  search     "presence"         3 行  │
│ ● 12:04:32  read       src/types.ts       ok   │
│ ● 12:04:33  answer     —                  完成  │
└─────────────────────────────────────────────────┘
```

| 元素 | 规格 |
|---|---|
| 容器 | 1px `--line-hair` 边框，`--surface-inset` 底，`--r-3` 圆角，内 padding `4px 0` |
| 头 | 28px 高，mono 10px `--text-3`：`执行链 · N 步`，右侧展开箭头 |
| 行 | 高 26px，padding `0 10px` |
| 左侧轨 | 6px 圆点 + 1px 竖线连接（`--line-hair`），圆点：`--beam-dim`（调用中）/ `--success`（ok）/ `--danger`（blocked） |
| 工具名 | mono 10.5px `--text-1` |
| 摘要 | `--fs-micro` 10px `--text-2`，超出省略 |
| 状态 | 右对齐 mono 10px，ok 用 `--success`、blocked 用 `--danger` |
| 展开 | 点行展开原始输出，`<pre>` mono 10px，`max-height: 240px`，`--surface-void` 底 |
| 默认 | **折叠** |

**与现有 `ToolCard` 的关系**：`ToolCard`（`components/ToolCard.tsx`）聚合「同一工具的连续调用」，
是执行链的一个**特化视图**。二者**不并存**：执行链是通用形态，`ToolCard` 保留为「同一工具 ≥3 次调用」时的聚合形态
（此时执行链行折叠成一张 `ToolCard`）。执行链行数 ≤ 3 时直接平铺，不使用 `ToolCard`。

**8.7.4 用量的层级（信息优先级）**

| 层级 | 内容 | 出现位置 | 可见性 |
|---|---|---|---|
| L1 | 本轮 tokens（in/out/cached）+ 耗时 + 工具调用数 | 控制台 vitals 条（**deepsleep 无**） | 常驻（有 usage 事件时） |
| L2 | 每一步的工具、摘要、状态 | 执行链（可折叠） | 默认折叠标题，展开可见 |
| L3 | 原始工具输出 | 执行链行内展开 | 按需 |

**原则**：L1 常驻但**极轻**（10px mono、1 行）；L2 默认折叠；L3 按需。
用量不是主角，是**背景仪表**。

### 8.8 设置页 —— 解决「设置太少且被挤在 240px 左栏」（问题 7）

**8.8.1 形态：独立页，不是侧面板**

- `SettingsPanel`（`components/Panels.tsx`）**删除**。
- 新建 `components/SettingsPage.tsx`：**覆盖整个工作区**（标题栏 / 会话带 / 状态栏保留）的全视图层。
- 触发：左栏头部 ⚙ 按钮、命令面板「设置」、`(Ctrl+,)` 快捷键（**新增**，写在快捷键表里）。
- 布局：`max-width: 880px`，水平居中，**左侧导航 176px（sticky）+ 右侧内容 1fr**，上下 28px 内边距。
- 导航项：7 项，每项 30px 高，`--fs-body-sm`，hover 底 `--overlay-hover`，当前项 `--text-1` + 左侧 2px `--beam` 竖条。
- 关闭：右上角 `✕`（24×24）+ `Esc`。

**8.8.2 七个分区的信息架构**

| # | 分区 | 内容 | 控件 |
|---|---|---|---|
| 1 | **外观与动态** | 界面语言；主题（只读：深色 · 13px 基准）；基准字号（12/13/14）；动效强度（跟随系统 / 减弱 / 完整）；动态层开关 | 分段器、只读行、开关 |
| 2 | **模型与连接** | 当前 provider、模型名、端点、密钥是否存在（**只显示有无，不显示内容**）；重新连接；BYOK 说明 | 只读行、按钮 |
| 3 | **编辑与终端** | 编辑器字号（12/13/14/16）；Tab 宽度（2/4/8）；自动保存；终端提示符（只读 `›`）；光标样式（块 / 下划线 / 竖线）；终端默认实例数（1/2/3） | 分段器、开关、只读行 |
| 4 | **动态层 LIVING** | 呼吸开关；指针跟随开关；强度（0–100% 滑块）；低频档说明 | 开关、滑块、说明 |
| 5 | **数据与隐私** | 最近项目列表（可逐条移除 + 全部清除）；导出会话；清空当前会话；本地数据说明 | 列表、按钮、危险按钮 |
| 6 | **快捷键** | 完整键位表 | 表格（mono） |
| 7 | **关于** | 棱镜 64px；版本；`pristem.ipc` 版本；构建标识；许可 | 静态 |

**8.8.3 分区 2 不显示连接状态文案**

设置页**不显示**「内核已连接 / 内核未连接 / 离线夹具」等连接状态文本 —— R-CONN-1 与 §9.6 G12 规定
连接状态**全局只有状态栏一处**。分区 2 改为一行**指向**说明：「传输状态显示在窗口底部状态栏」
（11px `--text-3`，不含任何状态词），并保留「重新连接」**动作**按钮（动作不是状态陈述）。

> 与 `UX_SPEC.md` §0.2 R2 的裁定一致：取 R-CONN-1 + G12。
> 设置页是覆盖工作区的层，状态栏此时仍可见 → 用户始终只看到一处连接状态。

**8.8.4 控件形态规范（数值）**

| 控件 | 规格 |
|---|---|
| 分区标题 | `--fs-subtitle` 15px/600 `--text-1`，下方 1px `--line-hair`，上下 20px / 12px |
| 设置行 | `display:grid; grid-template-columns: minmax(0,1fr) auto; gap:24px; align-items:center; min-height:40px; padding:8px 0`，行间 1px `--line-soft` 分隔 |
| 行标题 | `--fs-body` 13px `--text-1` |
| 行说明 | `--fs-micro` 10px `--text-3`，`line-height:1.6`，`max-width: 52ch` |
| 开关 | 轨道 36×20，`--r-full`，`--surface-raised` + `1px --line-strong`（关）/ `--beam`（开）；拨钮 16×16，`--surface-void`（关）/ `--beam-ink`（开）；过渡 `--t-instant` 80ms |
| 分段器 | 高 26px，轨道 `--surface-inset` + `1px --line-hair`，`--r-3`，`gap:2px`；选中段 `--surface-raised` + `--text-1`；字号 11.5px/500，padding `0 10px` |
| 单选/下拉 | 高 28px，`--r-2`，边 `--line-strong`，值用 mono 11px |
| 数值输入 | 高 28px，`--surface-inset`，`--r-2`，mono 11px |
| 滑块 | 轨 180×3px，`--line-strong`，`--r-full`；已填充 `--beam`；滑块 12px 圆 `--beam`，`--beam-glow` |
| 主按钮 | 36px 高，`--beam` 底，`--beam-ink` 字，600/12.5px，`--r-3` |
| 次按钮 | 36px 高，透明底，`1px --line-strong` 边，`--text-1` 字 |
| 危险按钮 | 36px 高，`1px --danger` 边，`--danger` 字 |

**8.8.5 数据来源诚实性**

- 分区 1/3/4/5 的设置项**当前没有持久化后端**（内核无配置读写接口）。
  → 规范要求：**设置项要么接到真实的内核/本地配置读写，要么标注为「本次会话有效」**。
  当前 UI 层可用 `localStorage`（`pristem.lang` 已有先例）持久化**纯本地**设置（语言、字号、动效强度等）；
  涉及内核行为的（provider、终端实例数）标注「本次会话有效」并置灰不可选。
  → **禁止**把不可生效的设置做成可交互控件（那是「假功能」）。

**代码落点**：新增 `components/SettingsPage.tsx`；`App.tsx` 新增 `settingsOpen` state（**独立于 `activeView`**，
不再是左栏的一个视图）；`Panels.tsx` 删 `SettingsPanel`；`i18n.ts` 新增 `settings.*` 分区文案。

### 8.9 终端面板 —— 解决「提示符错乱 + 三个死 tab + 不能多终端」（问题 13）

**8.9.1 提示符统一（唯一符号 `›`）**

现状两套符号并存：
- UI 侧 `workspace.tsx` 写 `const PROMPT = '\x1b[38;2;217;228;239m›\x1b[0m '`
- 壳层 `io.rs` 回显 `format!("pristem@workspace % {command}\r\n")`

且 `term.done` 时**无条件** `t.write(PROMPT)` 且**不换行** → 截图里的 `› › › › ›` 连续堆积。

**决策**：

> **R-TERM-1：全应用只有一套提示符 `›`（U+203A + 一个空格）。壳层不再回显命令行。**

- `shell/src/io.rs` 的 `run_term`：**删除** `bus.emit("io", json!({ "type": "term.output", "data": format!("pristem@workspace % {command}\r\n") }))`。
  壳层只发 stdout/stderr。
- UI 侧在提交命令时**本地回显**：`› {command}\r\n`（`.term-host` 内自己写）。
- `term.done` 时的提示符写入**必须先判断行尾状态**：

```tsx
// workspace.tsx TerminalPane
const atLineStart = useRef(true);
const writePrompt = () => {
  if (!atLineStart.current) { t.write('\r\n'); }
  t.write(PROMPT);
  atLineStart.current = true;
};
// term.output 末尾是 '\n' 时置 false
```

- **必须同步修复 git 捕获逻辑**：`Panels.tsx` 的 `isGitEcho` 依赖 `l.startsWith('pristem@workspace %')`，
  壳层不再回显后该判断失效 → **改为依赖哨兵行本身**（`__PRISTEM_GIT_BEGIN__/END__`），
  并在 `Panels.tsx` 中删除 `pristem@workspace %` 的字符串匹配。
- **UI 侧临时防御（B-3 未就绪时的兜底）**：在 `TerminalPane` 的输出过滤里丢弃以
  `pristem@workspace % ` 开头的整行。这**不解决双提示符的根因**，只防止用户看到两套符号。
  > ⚠️ **这是临时状态，不是最终实现。** 根因是 B-3（壳层停止回显）。
  > **B-3 落地后这层过滤必须删除** —— 否则它会变成永久的掩盖性代码：内核一旦改用别的回显格式，
  > 这层过滤既不起作用又会掩盖真实的输出丢失。验收项 **D-6** 专查这一条。
- `PROMPT` 常量必须**带尾随空格**：`'\x1b[38;2;217;228;239m›\x1b[0m '`（现状已有尾随空格，保持）。

**8.9.2 光标**

现状 `cursorStyle: 'bar'` 在 WebView2 里渲染成空心方块。

> **决策：`cursorStyle: 'block'` + `cursorBlink: false` + `cursorAccent: '#0F0F0F'`（= `--surface-void`）**
> → 渲染为一个**实心反色块**（WebView2 下最稳定），不闪烁（终端闪烁是廉价感来源）。

```ts
new Terminal({
  cursorStyle: 'block',
  cursorBlink: false,
  cursorAccent: '#0F0F0F',      // 与 terminal background 相同 → 反色块
  cursorInactiveStyle: 'outline',
  theme: { background: '#0F0F0F', ... },   // 统一到 --surface-void，删掉硬编码 #0D1014
});
```

**8.9.3 三个真 tab**

`.panel-tabs` 里的三个 `<span>` 改为真按钮：

```tsx
<div className="panel-tabs" role="tablist" aria-label={t('editor.panels')}>
  {(['terminal', 'output', 'problems'] as const).map((v) => (
    <button key={v} type="button" role="tab" aria-selected={view === v}
      className={`panel-tab ${view === v ? 'is-active' : ''}`}
      onClick={() => setView(v)}>{t(`editor.${v}`)}</button>
  ))}
</div>
```

| 项 | 规格 |
|---|---|
| 高度 | 32px（当前 `.pane-head` 34px → 32px） |
| 标签 | `--fs-mono-xs` 10px mono，`--text-3`；选中 `--text-1` + 底部 2px `--beam` 下划线 |
| 未实现视图 | 「输出」与「问题」**必须真的实现**：输出 = 现有 `TERM_BUFFER`（`Panels.tsx` 已有）+ 内核 `result` 事件的 output；问题 = Monaco diagnostics（`monaco.editor.onDidChangeMarkers`） |
| 空态 | 用 `EmptyState`（无棱镜） |

> **不允许**保留「点了没反应」的 tab。若 Phase 3 时间不够，**宁可不显示**这两个 tab，也不显示死的。

**8.9.4 多终端实例**

现状 `TerminalPane` 是单实例（`useEffect` 建一个 xterm）。

**决策：终端实例化。**

```
活动带头部：[终端][输出][问题]              [ bash 1 ×][ bash 2 ×][ + ]   [⌄]
```

| 项 | 规格 |
|---|---|
| 实例胶囊 | 高 22px，`--r-3`，底 `--surface-raised`，边 `1px --line-strong`，文字 mono 10px；当前实例底 `--beam-wash` + 边 `--beam` |
| 新建 | `+` 24×24 图标按钮 → 新建实例并聚焦 |
| 关闭 | 胶囊上的 `✕` 12px，hover 显现（与 `.tab-x` 一致） |
| 布局 | 每个实例一个 `<div class="term-host">`，切换时 `display:none` 隐藏非当前实例（**不销毁**，保留 scrollback） |
| 名称 | `bash 1`、`bash 2`…（从 1 递增），可双击改名 |
| 状态点 | 实例上有 pending 命令时显示 6px `--beam` 点 |

**协议依赖**：多个实例共享同一条 `term.run` 通道，必须能区分输出归属。
→ **壳层 `term.run` 增加可选 `instance: u32`，`term.output` / `term.done` 携带同一 `instance` 字段**（默认 0，兼容旧行为）。
UI 按 `instance` 路由。**若壳层尚未支持，所有输出归实例 0，UI 必须只显示 1 个实例**（不假装支持多实例）。见附录 B。

**8.9.5 终端面板整体规格**

| 项 | 规格 |
|---|---|
| 高度 | 默认 176px（当前 206px），可拖拽 120–420px；折叠为 **8px 把手条**（`.activity-handle`，`--surface-chrome` 底 + 上边 1px `--line-hair`），**不折叠为高度 0** —— 折叠后入口必须仍然可见 |
| 底色 | `--surface-void` #0F0F0F |
| 字号 | 12px，行高 1.5（18px） |
| 内边距 | `8px 12px 4px`（保持） |
| 首行 | **不再有** `pristem terminal` 横幅（删），起始即提示符 |
| 滚动条 | 8px（全局已统一） |

### 8.10 唤醒简报 / 目标 / 空态 —— 其余专项

见 §8.5（唤醒简报）、§8.2（目标）、下条（空态）。

**空态规范（全局统一）**：

| 变体 | 图标 | 标题 | 描述 | 行动 |
|---|---|---|---|---|
| `first` | **棱镜 28px**（全屏 ≤ 1 处） | `--fs-subtitle` 15px/600 | `--fs-body-sm` 12px `--text-3` | ≤ 2 |
| `zero` | 功能图标 18px `--text-3` @50% | `--fs-subtitle` 15px/600 | 12px `--text-3` | ≤ 2 |
| `noresult` | 功能图标 18px | 同上 | 同上 + mono 查询词 | ≤ 1 |
| `loading` | **无图标** + 静态骨架条 | `--fs-subtitle` | 12px `--text-3` | 0 |
| `error` | 左侧 2px `--danger` 竖条（无图标） | `--fs-body` 13px/600 | 11.5px `--text-3` | ≤ 2 |

- **棱镜只允许 `first` 变体，且全屏 ≤ 1 处**（当前 `EmptyState` 每个空态都画棱镜 —— 棱镜「到处都是」的根源）。
- 行动按钮上限 2 个（当前 `EmptyState` 允许无限个 `.empty-actions`）。
- 描述文本 `max-width: 360px`。

---

### 8.11 Phase 2 引入的新形态（尺寸 / 表面色 / 动效 / 状态差异的最终定义）

> **本节以 `UX_SPEC.md` 附录 F（F-1 ~ F-8）为输入**（F 的 token 约束为硬约束，px 为建议值由本文定稿），
> 并与 `frontend-engineer` 的在途实现逐项对齐。
> 除 §8.11.9 列出的差异（工程师需改）外，本节数值 = 工程师当前实现值。
>
> **⚠ 本节数值 = 在途实现值，仅作回归基线；每条判据的治理依据见 §9.10 / §9.11 的「治理依据」列 ——
> 判定以治理依据为准，本节数值不单独构成判据。**
> 工程师将来改了值，只要仍满足治理约束，判据依然通过；违反了则判不通过。
> **§8.11 是快照，不是规格的唯一标准。**
>
> **两处对附录 F 的偏离，均已在下文注明理由**：
> 1. **F-2 的 `--text-3` 改为 `--text-2`** —— `--text-3` 在 `--surface-float` 上仅 3.38:1，违反 §4.1。
> 2. **F-3 的弹性轨道从「控件列」移到「说明列」** —— 控件是定宽控件，给它 `1fr` 会在右侧留大片空白。

#### 8.11.0 通用规则

| # | 规则 |
|---|---|
| N-R1 | **不得发明新 token。** 所有颜色、字号、圆角、阴影、时长引用 §4 的色彩 token、§3.3 的 type scale、§3.1 的字体；半透明底色用 `color-mix(in srgb, var(--X) N%, transparent)` 从既有 token 派生 |
| N-R2 | **浮层宽度 ≤ 560px**（§9.7 H2）；浮层**不遮挡**标题栏 / 会话带 / 状态栏 |
| N-R3 | **状态不得仅靠动效或颜色表达**（§5.6）——每个状态变体都要有文字或形状差异 |
| N-R4 | **同时循环动画 ≤ 1**（§5.5）——本节所有状态点**一律静态**，不脉冲 |
| N-R5 | 浮层 `Esc` 关闭后**焦点回到触发元素**（H-8） |
| N-R6 | 浮层进入：`--t-base` 180ms `--ease-enter`（`opacity 0→1` + `translateY(6px)→0`）；退出：`--t-fast` 120ms `--ease-exit` |

#### 8.11.1 左栏头部与 3 段视图切换器

```
┌ 268px ─────────────────────────────────────────────────┐
│ [📄 文件][🔍 搜索][⑂ 版本]              [⚙]  28px      │
└────────────────────────────────────────────────────────┘
```

| 元素 | 规格 |
|---|---|
| `.left-rail-head` | 高 **28px**，底 `--surface-rail`，`padding: 0 8px 0 10px`，`display:flex; align-items:center; gap:8px`，下边线 1px `--line-hair` |
| `.view-seg`（轨道） | 高 **24px**，`--surface-inset` 底，1px `--line-hair` 边，`--r-3`（6px），`padding: 2px`，`gap: 2px`，`inline-flex` |
| `.view-seg-item` | 高 **18px**（= 24 − 2×2 padding − 2×1 border），`padding: 0 10px`，`border-radius: var(--r-1)`（3px，**必须小于轨道 `--r-3`**），`inline-flex`，`gap: 4px`；**右侧 1px `--line-hair` 分隔线**（F-1，最后一段无） |
| 段内容 | **图标 + 文字**：图标 **15px**（lucide，`strokeWidth: 1.75`）+ 文字 `--fs-label` **11px**/500 |
| 段宽 | **内容宽**（`padding: 0 10px` 自然撑开），**不强制等分**。三段文案等长（文件/搜索/版本），内容宽与等分视觉等价，但内容宽在将来加长文案时不被裁切 |
| **段间分隔** | **1px `--line-hair`** 竖线（F-1），置于段右侧；轨道 `gap: 0`（分隔线本身承担间隔） |
| 默认态 | 文字与图标 `--text-3` |
| hover | 底 `var(--overlay-hover)`，文字与图标 `--text-2`，`--t-fast` 120ms |
| 选中态 `.is-active` | 底 `var(--beam-wash)`（F-1），文字与图标 `--text-1`，**`box-shadow: inset 0 -2px 0 var(--beam)`**（2px beam 底线在段底）——beam 语义 = 「当前选中」（§4.2）。**`--beam-wash` 与模式菜单当前行、终端实例当前态用同一个底色**，形成跨组件一致的「选中」语言 |
| 焦点态 | `:focus-visible` 时 `var(--focus-ring)`（外圈 focus-ring 与内圈 inset beam 叠加，不互相覆盖） |
| ⚙ 按钮 | **24×24**，lucide `Settings` 14px，`--text-3`，`--r-2`，hover 底 `var(--overlay-hover)` + 图标 `--text-1`，`--t-fast` |
| ⚙ 位置 | `margin-left: auto`（`.rail-settings`），与切换器之间 **1px `--line-hair` 竖分隔**（F-1）+ 间距 **8px** |

> **为什么「图标 + 文字」而不是纯图标**：用户明确反感 VSCode 那种「一堆图标栏」——
> 纯图标靠记忆，而 268px 的左栏完全放得下 3 段「图标 + 两字」。

#### 8.11.2 模式菜单的 pending / error 子区

| 项 | 规格 |
|---|---|
| `.mode-menu` 宽度 | **360px** |
| `.mode-menu` 底 / 边 | `--surface-float`，`--r-4`（8px），1px `--line-strong`，`box-shadow: 0 20px 60px rgba(0,0,0,.7)`，`padding: 6px` |
| 模式行 | 高 **36px**，`padding: 0 9px`，`display:flex; gap:9px`，文字 `--fs-body-sm` 12px `--text-2`，`--r-2` |
| `.menu-name` | 宽 **66px**，**mono** 10.5px，`letter-spacing: .05em` —— 内核模式标识是技术标识，用等宽字（§3.5 允许） |
| `.menu-hint` | `flex: 1`，10px **`--text-2`**（float 上 `--text-3` 仅 3.38:1，违反 §4.1 → 改用 `--text-2` 5.76:1），`white-space: nowrap; overflow: hidden; text-overflow: ellipsis` |
| 行间分隔 | **无分隔线** |
| hover | 底 `var(--overlay-hover)`，文字 `--text-1` |
| 当前行 `.is-current` | 底 `var(--beam-wash)`，文字 `--text-1`，**左 2px `--beam` 竖条**（`inset 2px 0 0`） |
| 不可用行 | `aria-disabled="true"`，`pointer-events:none`，文字 `--text-3`，**但仍可见**（隐藏会让菜单在切换中少几行 = 布局抖动） |

**`.mode-menu-pending`（UX_SPEC 附录 F-5：目标行尾）**：

| 项 | 规格 |
|---|---|
| 位置 | **目标行的行尾**（F-5 明确「目标行尾 6px `--beam` 圆点 + 文字『切换中』」）。**不另设底部横条** |
| 状态点 | 6px `--beam` 实心圆点，**静态不脉冲**（N-R4：菜单打开时 `iterations===Infinity` 的元素数仍 ≤ 1） |
| 文字 | **`--fs-label` 11px/500 `--text-2`**，内容「切换中」（**必须有文字**，N-R3） |
| 目标行其余部分 | 模式名与 hint 保持原样，**不置灰**（置灰会暗示「不可用」，而实际是「进行中」）；目标行另加 `.is-pending` 使其文字升 `--text-1` |
| 其余 5 行 | `aria-disabled="true"`，**但仍可见**（隐藏会让菜单在切换中「少几行」= 布局抖动，§5.5 X2） |
| 菜单本身 | **保持打开**（pending 阶段不关闭） |

**`.mode-menu-error`（内核拒绝 / 超时，UX_SPEC 附录 F-5）**：

| 项 | 规格 |
|---|---|
| 位置 | 6 行**下方**（与 pending 互斥，同一时刻只出现其一） |
| 形态 | `border-top: 1px solid var(--line-hair)`，`margin-top: 4px`，`padding: 8px 4px 4px` |
| 内容 | **直接复用 `EmptyState variant="error"`**（F-5：「不需要新形态」）。即：左 2px `--danger` 竖条（无图标）+ 标题 `--fs-body` 13px/600 `--text-1` + 描述 11.5px `--text-2`；菜单内**左对齐**、`max-width: none`（菜单本身只有 360px） |
| **对比度修正** | 描述文**不得用 `--text-3`** —— 在 `--surface-float` 上仅 **3.38:1**，违反 §4.1「`--surface-float` 上的文本最低 `--text-2`」（5.76:1） |
| 行动按钮 | ≤ 2，且必须是**可兑现的下一步**（H-6）：「重试」+「关闭」 |

#### 8.11.3 设置页（`.settings-page` 一套）

| 项 | 规格 |
|---|---|
| `.settings-page` | `position: fixed; inset: 64px 0 24px 0`（标题栏 36 + 会话带 28 = 64；状态栏 24），`z-index: 55`，底 `--surface-canvas`，`overflow-y: auto` |
| 宽度 | `max-width: 880px; margin: 0 auto`，`padding: 28px 0 40px`（左右 0 —— 宽度由 `max-width` 控制） |
| 栅格 | `grid-template-columns: 176px minmax(0, 1fr); gap: 24px; align-items: start` |
| `.settings-nav` | 宽 **176px**，`position: sticky; top: 0`，`display: grid; gap: 2px`；**不加独立底色** —— 设置页是**全屏替换层**不是叠加层，再给导航加底色会造成「浮层里的浮层」 |
| `.settings-nav-item` | 高 **30px**，`--r-2`，12px/500 `--text-2`，hover 底 `var(--overlay-hover)` + 文字 `--text-1` |
| 选中态 / scrollspy | 文字 `--text-1` + **左侧 2px `--beam` 竖条**（与 §8.11.1 同语法，不另发明高亮形态） |
| `.settings-search` | **在导航列顶部**（不是页头）：`<input>`，高 **28px**，`width: 100%`，`--surface-inset` 底，1px `--line-strong` 边，`--r-2`，`padding: 0 8px`，12px，`margin-bottom: 8px`；`:focus` 时边 `--line-beam` + `var(--focus-ring)` |

**`.settings-search` 与标题栏 `.search-capsule` 的区分**（避免两个搜索框混淆）：

| | 标题栏 `.search-capsule` | 设置页 `.settings-search` |
|---|---|---|
| 形状 | 胶囊形 `--r-full` | 矩形 `--r-2` |
| 边 | 1px `--line-hair` | 1px `--line-strong` |
| 内容 | 图标 + 居中文字 | **纯输入框，无图标**，左对齐 |
| 位置 | 标题栏 | 左导航列顶部 |

**设置行 `.settings-row`（四列网格）**：

```
grid-template-columns: 200px auto minmax(0, 1fr) 96px;
gap: 16px;
align-items: center;
min-height: 44px;
padding: 8px 0;
```

| 列 | 内容 | 对齐 | 规格 |
|---|---|---|---|
| 1 · 标签 | 行标题 | 左 | `--fs-body` 13px `--text-1`，固定 **200px** |
| 2 · 控件 | 分段器 / 开关 / 滑块 / 输入 | 左 | 规格见 §8.8.4；**宽度自适应（`auto`）**，紧跟标签 |
| 3 · 说明 | 行说明 | 左 | `--fs-micro` 10px/1.6 `--text-2`，`max-width: 52ch`，**吃掉剩余空间（1fr）** |
| 4 · 状态 chip | 「本次会话有效」等 | 右 | 固定 **96px**，右对齐 |

> **与 F-3 的一处收口**：F-3 写「四列 = 200px 标签 / 1fr 控件 / 180px 说明 / 96px 状态」，
> 我把弹性轨道从**控件列**移到**说明列**（控件列改 `auto`）——
> 控件是定宽控件（分段器 26px 高、开关 36×20、滑块 180px），给它 `1fr` 会在它右侧留出一大段空白，
> 而说明文字才是真正需要吸收剩余宽度的内容。**列的顺序与固定列宽度完全按 F-3。**
> 说明列给 `minmax(0,1fr)` 而非固定 180px，是为了让长说明自然换行而不撑破布局。

- **行间分隔**：`border-bottom: 1px solid var(--line-soft)`，最后一行 `border-bottom: 0`
- **行高**：单行 **44px**（F-3）；说明换行导致两行时 **56px**（F-3）。
  超过 56px → 说明**截断为 2 行 + `…`**，完整文本进 `title`。
- **分区标题** `.settings-section-title`：**12px/500 `--text-2`**（F-3）+ 1px `--line-hair` 下沿，
  `padding-bottom: 12px; margin-bottom: 12px`；分区间距 `margin-bottom: 26px`
- 控件列因 `align-items: center` 垂直居中，**不因说明换行而位移**（位移 = 布局抖动，§5.5 X2）
- `.settings-row.is-wide`（单列变体）用于「无说明、无 chip」的简单行

**`.settings-chip`**：

| 变体 | 底 | 边 | 字色 |
|---|---|---|---|
| 普通 / 「下一轮生效」 | `--surface-raised` | 1px `--line-strong` | `--text-3` |
| 本次会话有效 | `color-mix(in srgb, var(--warn) 16%, transparent)` | `color-mix(in srgb, var(--warn) 34%, transparent)` | `--warn` |
| 不可用 | `color-mix(in srgb, var(--danger) 14%, transparent)` | `color-mix(in srgb, var(--danger) 32%, transparent)` | `--danger` |
| 当前 | `color-mix(in srgb, var(--success) 16%, transparent)` | `color-mix(in srgb, var(--success) 34%, transparent)` | `--success` |

- 通用：高 **18px**，`--r-1`（3px，F-3），`padding: 0 6px`，`--fs-micro` 10px/500，`white-space: nowrap`
- chip 文案**不含连接状态陈述词**（连接状态只在状态栏，R-CONN-1）

#### 8.11.4 活动带与终端实例

```
┌─────────────────────────────────────────────────────────────────┐
│ 终端  输出  问题                          [bash 1 ×][bash 2 ×][+] │
└─────────────────────────────────────────────────────────────────┘
```

| 项 | 规格 |
|---|---|
| 头部高 | **32px**（与 `.pane-head` 一致，§9.7 H7），底 `--surface-chrome`，下边线 1px `--line-hair` |
| 左侧 tab | 3 个**真 button**（`role="tab"` + `aria-selected`），高 32px，`padding: 0 12px`，12px/500；未选中 `--text-3`，选中 `--text-1` + **底部 2px `--beam` 下划线** |
| tab 间分隔 | **无分隔线**，靠 12px padding 拉开 |
| 右侧实例区 | `margin-left: auto`，与左 tab 区**无竖线**（两组内容不相关，留白即分界，§4.3） |
| 新建实例 `+` | 24×24 图标按钮，`--text-3`，hover `--text-1` + `var(--overlay-hover)` |

**`.term-instance` 胶囊（22px）**：

| 变体 | 规格 |
|---|---|
| 常态 | 高 **22px**，`--r-3`（6px），`padding: 0 4px 0 8px`，`gap: 5px`，底 `--surface-raised`，边 1px `--line-strong`，mono 10px `--text-2` |
| hover | 边 `--accent-quiet`，`--t-fast` 120ms |
| 当前实例 `.is-current` | 底 `var(--beam-wash)`，边 `var(--beam)`，文字 `--text-1` |
| `.is-pending` | 胶囊内**左侧**加 6px `--beam` **静态**实心点（**不脉冲**，N-R4）；文字升 `--text-1`；`title` / `aria-label` 追加「· 命令执行中」 |
| 关闭 ✕ | 12px 图标 `--text-4`，`opacity: 0` → hover 胶囊时 `1`（`--t-instant` 80ms）；**`:focus-within` 时常显**（键盘可达性） |
| `.term-instance-rename` | 双击 → 胶囊内替换为 `<input>`：高 22px，`min-width: 72px`，`--surface-void` 底，`--r-2`，mono 10px `--text-1`；Enter 提交 / Esc 取消 / 失焦提交 |

**实例过多时**：`.term-instances` = `display:flex; gap:4px; overflow-x:auto; scrollbar-width:none`（滚动条隐藏）。
放不下时**右端追加 `+N` 计数胶囊**（10px `--text-3`，`--r-3`，`title` 列出全部实例名）。
**不折叠** —— 折叠会让入口消失（与 §8.11.6 同理）。

#### 8.11.5 三个浮层（UX_SPEC 附录 F-1 / F-2 / F-3）

> **编号以 `UX_SPEC.md` 附录 F 为准**（正本）。F-1 = `.path-dialog`、F-2 = `.jump-line-pop`、F-3 = `.outline-pop`。

**`.path-dialog`（F-1，480px，模态）**

| 项 | 规格 |
|---|---|
| 宽度 | **480px**，`max-width: calc(100vw - 32px)`，`max-height: calc(100vh - 120px)`（≤560px，§9.7 H2） |
| 底 / 边 / 圆角 | `--surface-float` / 1px `--line-strong` / **`--r-3`（6px）** |
| 阴影 | `0 24px 70px rgba(0,0,0,.72)` |
| 遮罩 | `rgba(16,20,26,.72)`（`--surface-void` 的 72%） |
| 焦点 | **焦点陷阱**（模态）；`Esc` 关闭后焦点回触发元素（H-8） |
| 标题 | 「打开文件夹」`--fs-subtitle` 15px/600 `--text-1`；右侧 ✕ 24×24 |
| 降级说明 | 仅当壳层返回 `unsupported` 时出现：「本机没有提供文件夹选择器，请粘贴路径」10px `--text-3` |
| 输入框 | 高 **28px**（F-1，= §8.8.4 数值输入规格），`--surface-inset` 底，`--r-2`，mono **11px** `--text-1`；右侧内嵌「粘贴」文字按钮 **28×24**（10px `--text-2`，hover `--text-1`） |
| 最近项目 | ≤ 5 条，行高 **28px**（F-1），mono 路径 10px `--text-2`，hover 底 `var(--overlay-hover)`；分组标题 11px `--text-3` |
| 主按钮 | 「打开」`--beam` 底，**36px** 高，`--beam-ink` 字 |
| 次按钮 | 「取消」1px `--line-strong` 描边，`--text-1` 字，36px 高 |
| `.path-dialog-error` | **左侧 2px `--danger` 竖条**（`border-left: 2px solid var(--danger)`）+ `padding-left: 8px`；文字 **11.5px `--text-2`**（**不是 `--danger`** —— 竖条已经承担了"这是错误"的信号，文字不必再压暗）；位置：输入框下方 |
| **禁止** | **不得出现 rainbow / spectrum**（§4.3 只允许 1 处） |

**`.jump-line-pop`（F-2，240px，非模态）**

| 项 | 规格 |
|---|---|
| 宽度 | **240px**（≤560px，H2），`position: fixed; z-index: 80` |
| 底 / 边 / 圆角 | `--surface-float` / 1px `--line-strong` / **`--r-3`（6px）** |
| 阴影 | `0 14px 40px rgba(0,0,0,.6)` |
| 遮罩 | **无**（非模态） |
| 焦点 | 打开时焦点移入输入框；`Esc` 关闭后焦点回触发元素；**不锁焦点**（非模态不设焦点陷阱） |
| 锚点 | **舞台左下角**（F-2）：左对齐舞台左边 **16px**，底边距 **16px** |
| 输入 | 高 **28px** mono，`--surface-inset` 底，`--r-2`；**只接受数字** |
| 错误 | 2px `--danger` 左竖条 + `--text-2` 文字（**非法**与**越界**各有独立文案） |
| 主按钮 | 28px 高，`--beam` 底 |
| 作用 | 替换 `window.prompt`（现有 `workspace.tsx` 的 `KeyG` 分支） |

**`.outline-pop`（F-3，320px，非模态）**

| 项 | 规格 |
|---|---|
| 宽度 | **320px**（F-3 建议值），`max-height: 320px`，`overflow-y: auto`，`position: fixed; z-index: 80` |
| 底 / 边 / 圆角 | `--surface-float` / 1px `--line-strong` / **`--r-3`（6px）** |
| 遮罩 | **无**（非模态） |
| 锚点 | 贴在 **22px doc strip** 上的符号按钮下方 |
| 数量上限 | **≤ 200 项**（§9.7 H1），超出显示「还有 N 项」 |
| 行高 | **28px**（实现值；F-3 只给上限 ≤44px，§9.7 H4） |
| 行内容 | 符号名 mono **10.5px `--text-1`**（mono 承载标识符，§3.5 允许）+ 行号 mono 10px `--text-2` |
| **符号图标** | **不加图标** —— 符号名本身即信息，加图标是噪声；层级用**缩进**表达：`padding-left: 8px + depth × 12px` |
| 键盘 | `↑/↓` 移动、`Enter` 跳行、`Esc` 关闭 |
| 空态 | `EmptyState variant="zero"`（**无棱镜**，§8.10） |

#### 8.11.6 连接重试菜单 `.conn-retry-menu`（F-8）

**用途**：连接断开时，状态栏的**连接指示器**变成可点控件，点击展开本菜单，**其中只有一项「重试连接」**。

| 项 | 规格 |
|---|---|
| 底 / 边 / 圆角 | `--surface-float` / 1px `--line-strong` / `--r-3`（6px） |
| 阴影 | `0 6px 24px rgba(0,0,0,.5)`（与 `.mode-menu` 同级） |
| 宽度 | **200px**（F-8 建议值；≤560px，§9.7 H2） |
| 菜单项 | 高 **30px**，`padding: 0 12px`，`--fs-body-sm` 12px **`--text-2`**（float 上 `--text-3` 不可用，§4.1），hover 底 `var(--overlay-hover)` + 字 `--text-1` |
| 唯一项 | 「重试连接」——文字 `--text-1`（它是唯一可行动作）。**只重新建立事件流，不重发任何业务请求** |
| 状态文字 | **不渲染**（见下方 G12 联动） |
| 行为 | `Esc` 关闭并把焦点还给指示器；**不播报**（纯 chrome）；**不新增状态栏元素**（状态栏 ≤ 6 条不被破坏） |

**与 G12（连接状态全屏 = 1 次）的联动 —— 本形态的关键约束**

连接状态词（内核已连接 / 离线夹具 / 内核未连接 / 正在连接内核）**只允许出现在状态栏那 1 处**。因此：

| 指示器状态 | 指示器语义 | 菜单 |
|---|---|---|
| **断连** | `role="button"` + `aria-haspopup="menu"` + 可点 → 展开 `.conn-retry-menu` | 渲染 **1 项**「重试连接」 |
| **正常** | **纯状态显示**（**无 button 语义、无 `tabindex`、不响应点击**）→ 不渲染菜单 | 不渲染 |

> **为什么正常态不点**：指示器在正常态**根本不是按钮**，所以不存在「看起来能点其实没用」的死控件（H-2）；
> 断连时它才**变成**按钮。这比「正常态点开一个只有状态文字的菜单」更诚实 ——
> 后者会让同一事实（连接状态）在屏幕上出现第二次，直接违反 R-CONN-1 与 G12。

#### 8.11.7 活动带折叠把手 `.activity-handle`（F-6）

| 项 | 规格 |
|---|---|
| 高度 | **8px**（F-6 建议值；**上限 ≤ 32px**，不超过 `.pane-head`） |
| 底 / 边 | `--surface-chrome` 底，**上边线 1px `--line-hair`** |
| 形态 | 整条可点击，`cursor: pointer`；**图标 14px `--text-2`**（F-6） |
| hover | 底 `var(--overlay-hover)`，图标 `--text-1`；`--t-fast` 120ms |
| **禁止** | **不得出现 beam 实心块**（beam 配额 ≤ 2，§4.2） |
| 焦点 | `:focus-visible` 时 `var(--focus-ring)`；**必须可键盘聚焦**（`tabindex="0"` + `role="button"` + `aria-label="展开活动带"`） |
| 展开 | 点击或拖拽 → 活动带恢复到上次高度（组件 state 记忆，不持久化） |

**goal 与其它模式的区别（关键，避免 F7 挂掉）**：

| 模式 | `.activity-strip` | `.activity-handle` |
|---|---|---|
| **goal** | **整个不存在**（工作区被替换，`.term-host` 必须不存在） | **不存在** |
| advisor | 整个不存在（工作区被替换） | 不存在 |
| **deepsleep** | 存在但变暗 | **存在**（折叠但入口在） |
| coding / helping / IDE | 存在 | 存在（仅在折叠时） |

> **规则**：goal / advisor 是「**整块不渲染**」；deepsleep / 其它是「**折叠但入口在**」。
> **goal 模式下绝不能留一条 8px 把手条** —— 那会让 §9.5 F7 判不通过。

#### 8.11.8 Toast 栈 `.toast-stack`（F-4）

**用途（F-4 的关键约束）**：**仅**承载「用户刚发起的、会话生命周期或导出类」操作失败。
**不得**用于连接类失败（连接状态只在状态栏，§4.3 R-CONN-1）。

| 项 | 规格 |
|---|---|
| 位置 | **右上角**，`position: fixed; right: 16px; top: 76px; z-index: 66; width: 320px`，`display: grid; gap: 8px`（`top: 76px` = 标题栏 36 + 会话带 28 + 12px 间距，**不压 chrome**） |
| 单个 toast | 宽 **320px**，`--surface-float` 底，`--r-3`（6px），1px `--line-strong`，`box-shadow: 0 4px 16px rgba(0,0,0,.45)`，`padding: 10px 12px` |
| 状态竖条 | 左侧 **2px** 竖条：错误 `--danger`、警告 `--warn`；`border-left: 2px solid` + `padding-left: 10px` |
| 标题 | `--fs-body` **13px**/600 `--text-1`（F-4） |
| 描述 | `--fs-body-sm` **12px** **`--text-2`**（F-4；float 上 `--text-3` 仅 3.38:1，**不可用**） |
| **标题 = 动作名** | 「会话未能创建」/「导出失败」——**不是**状态陈述 |
| **行动** | 按钮 = 「重试」，只含动作；**文案禁止出现**「内核未连接 / 离线夹具 / 内核已连接 / 正在连接内核」（R-CONN-1 / R-CONN-2 + G12） |
| 进入 | `--t-base` **180ms** `--ease-enter`（F-4） |
| 退出 | `--t-fast` **120ms** `--ease-exit`（F-4） |
| 自动消失 | **5s**；**可手动关**（× 24×24，`--text-3`） |
| reduced-motion | **直接消失**（无淡出、无位移），但**仍停留 5s** —— 状态变化仍被感知，只是没有渐变 |
| 可访问性 | `role="alert"` `aria-live="assertive"`（F-4）；容器 `pointer-events:none`、**单个 toast `pointer-events:auto`**；动作按钮**可键盘聚焦** |

> **与 `.sr-only[role="alert"]` 的分工**：toast 承载**动作失败**（assertive）；
> `.sr-only[role="alert"]` 承载**内核级阻塞错误**（如内核拒绝模式切换）。
> **两者不得同时播报同一件事** —— toast 已按 F-4 排除连接类失败，所以不冲突。
> **两者都不得含品牌词**（§2.4 #17：播报只说状态与动作，不说品牌名）。

#### 8.11.9 工程师需改的差异清单（以 `UX_SPEC.md` 附录 F 为准）

> 附录 F 是本节的**输入**（token 约束为硬约束，px 为建议值由本文定稿）。
> 下表是 **F 生效后，工程师当前在途实现与最终定义的差异**。改完即无差异。
> §9.10 / §9.11 的判据按**最终定义**写，改完即通过。

**⚠ 编号约定**：本节与 `UX_SPEC.md` 附录 F 一一对应 —— **F-1 `.path-dialog`**、**F-2 `.jump-line-pop`**、
**F-3 `.outline-pop`**、**F-4 `.toast-stack`**、**F-5 `.mode-menu-pending`/`error`**、
**F-6 `.activity-handle`**、**F-7 `.settings-chip`**、**F-8 `.conn-retry-menu`**。
左栏头部（`.left-rail-head`/`.view-seg`）、设置页、活动带与终端实例不属附录 F 编号，
它们来自 `UX_SPEC.md` §2.2 / §3.2 / §4.1。

| # | 差异 | 在途实现 | 应为 | 依据 |
|---|---|---|---|---|
| **Δ1** | `.view-seg-item` 文字尺寸 | 12px `--fs-body-sm` | **11px `--fs-label`** | §3.3（控件标签一律 `--fs-label`）；段高仅 18px |
| **Δ2** | `.view-seg-item` 圆角 | 硬编码 `2px` | **`var(--r-1)` 3px** | 不得硬编码（§8.11.0 N-R1）；内层圆角必须小于轨道 `--r-3` 6px |
| **Δ3** | `.view-seg-item` 图标尺寸 | 14px | **15px** | UX_SPEC §2.2 |
| **Δ4** | `.view-seg-item` 选中底色 | `--surface-raised` | **`--beam-wash`** | UX_SPEC §2.2；与模式菜单当前行、终端实例当前态统一为同一种「选中」语言 |
| **Δ5** | 段间分隔 + ⚙ 分隔 | 无分隔线 | **段间 1px `--line-hair`**；**⚙ 与轨道 1px `--line-hair` 竖分隔** | UX_SPEC §2.2 |
| **Δ6** | `.mode-menu-pending` **位置** | 菜单底部独立横条 | **目标行尾**（F-5 明确「目标行尾」） | UX_SPEC 附录 F-5 |
| **Δ7** | `.mode-menu-pending` 字号 | 10.5px `--text-2` | **`--fs-label` 11px/500 `--text-2`** | UX_SPEC 附录 F-5 |
| **Δ8** | `.mode-menu-error` | 自定义结构 | **直接复用 `EmptyState variant="error"`**，不需要新形态 | UX_SPEC 附录 F-5 + §8.10 error 变体 |
| **Δ9** | `.settings-row` 栅格 | 2 列 `minmax(0,1fr) auto`，min-height 40px | **4 列 `200px auto minmax(0,1fr) 96px`**、gap 16px、**min-height 44px** | UX_SPEC §3.2；列顺序 = 标签 / 控件 / 说明 / 状态 chip |
| **Δ10** | `.settings-chip` 圆角 | `--r-full` | **`--r-full`（保持）** | UX_SPEC 附录 F-7 —— **我先前提的 `--r-1` 是错的，已撤回** |
| **Δ11** | `.settings-chip` 文字色 | `var(--text-3)` on `--surface-raised` = **3.96:1** | **`var(--text-2)`**（同底 **6.76:1**） | §4.1 对比度层级（raised 上 `--text-3` 不可用）+ UX_SPEC 附录 F-7 |
| **Δ12** | `.settings-seg button` 字号与圆角 | `font-size: 11.5px` + `border-radius: 2px` 硬编码 | **`var(--fs-label)` 11px** + **`var(--r-1)` 3px** | 11.5px 是 `--fs-mono` 的值，但这是**无衬线控件标签**（§3.3）；圆角不得硬编码 |
| **Δ13** | `.settings-row.is-unavailable .settings-row-desc` | `color: var(--text-4)` | **`var(--text-3)`** + **左侧 2px `--danger` 竖条** | **C4 违规**：`--text-4` 在 `--surface-canvas` 上约 **2.7:1**，只允许纯装饰；「缺什么接口」的说明是**语义内容**。降级用 `text-3` + 竖条表达，**不靠压暗文字** |
| **Δ14** | `.settings-section-title` | `--fs-subtitle` 15px/600 `--text-1` | **12px/500 `--text-2`** + 1px `--line-hair` 下沿 | UX_SPEC §3.2 |
| **Δ15** | `.path-dialog` 圆角 | `--r-5`（10px） | **`--r-3`（6px）** | UX_SPEC 附录 F-1；与 jump-line / outline / conn-retry 四个浮层统一 |
| **Δ16** | `.path-dialog` 输入 | mono 11.5px | **mono 11px `--text-1`** | UX_SPEC 附录 F-1（= §8.8.4 数值输入规格） |
| **Δ17** | `.path-dialog-error` 文字色 | `--text-2` | **`--text-2`（保持）** | UX_SPEC 附录 F-1；**竖条已承担错误信号，文字不必再压暗** |
| **Δ18** | `.jump-line-pop` 圆角 | `--r-4`（8px） | **`--r-3`（6px）** | UX_SPEC 附录 F-2 |
| **Δ19** | `.jump-line-pop` 锚点 | 舞台水平居中 / 底部上方 64px | **舞台左下角**（左 16px、底 16px） | UX_SPEC 附录 F-2 |
| **Δ20** | `.outline-pop` 宽度 / 圆角 | 280px、`--r-4` | **320px**、**`--r-3`** | UX_SPEC 附录 F-3 |
| **Δ21** | `.outline-pop` 符号图标 | 无图标 | **无图标（保持）** | UX_SPEC 附录 F-3 只要求符号名 mono 10.5px，**未要求图标**；符号名本身即信息 |
| **Δ22** | `.toast-stack` 标题 / 描述 | 12px/600 `--text-1` + 10px `--text-3` | **13px/600 `--text-1`** + **12px `--text-2`** | UX_SPEC 附录 F-4（`--text-3` 在 float 上 3.38:1 违规） |
| **Δ23** | `.toast-stack` 退出时长 | — | **`--t-fast` 120ms `--ease-exit`** | UX_SPEC 附录 F-4 |
| **Δ24** | `.toast-stack` a11y | `role="status"` polite | **`role="alert"` assertive** | UX_SPEC 附录 F-4（动作失败需立即知晓） |
| **Δ25** | `.toast-stack` 位置 | 右下角 `right:16px; bottom:38px` | **右上角** `right:16px; top:76px` | UX_SPEC 附录 F-4 的「右上角」是**行为约束**不是 px 建议值。**右下角正好压住右侧控制台的 composer 发送按钮**（coding 模式下控制台在右、composer 在底部）—— 那才是 5 秒内挡住主操作区；右上角只压控制台头部（导出/收起） |
| **Δ26** | `.activity-handle` 图标 | 无图标 | **图标 14px `--text-2`** | UX_SPEC 附录 F-6；**不得出现 beam 实心块**（§4.2） |
| **Δ27** | `.conn-retry-menu`（F-8） | 不存在 | 见 §8.11.6 | UX_SPEC 附录 F-8 |
| **Δ28** | deepsleep 相关文案（W1–W9） | 「干净实例正在复盘输出链」「已提交新规则」「消化中」「新实例接手」「内核没有提交新规则」 | **逐字照 §8.12 权威文案表 W1–W9**（中英文各一份） | **内核语义核实后回改**（`spawn_clean_instance` 生产无调用方）+ §8.12 |
| **Δ29** | `i18n.ts` 的 **19 条残留字符串**（18 改写 + 1 死键删除） | 见 §8.12.1b 逐条表 | **逐条照 §8.12.1b / 权威文案表 W1–W11** | §8.12.1b（假话在**代码**里，规范扫不到）+ §8.12.1d |
| **Δ30** | 睡 log 内容 | `.sleep-log` **已从 JSX 中移除**（`logs` 变量在 `views.tsx:618` 计算但未使用），`.sleep-log` CSS 仍在 `styles.css:798-808` | **恢复渲染**，内容 = **纯本地墙钟时间标记** `已归档 · HH:MM`（W8/W9），**不得**用 `items.slice(-4)`；**不得**用时长格式 | §5.4 睡 log 内容 + §8.12 W8/W9 |
| **Δ31** | `.sleep-meta` chip 数 | 3 个（暂停 / 安静状态 / 休眠中） | **只保留 1 个**（`deepsleep.pause`） | §8.12.1c（另两条与 h1/eyebrow 重复） |
| **Δ32** | deepsleep 的 `<Vitals>` | `<Vitals usage={usage} />` **已渲染** | **必须保证 deepsleep 下 `usage` 为空 → 整条不渲染**（§8.4.2b） | §8.4.2b + §8.7.2 无事件不渲染 |

> **除上表 28 条外，本节其余数值 = 工程师当前在途实现值，无差异。**
> 活动带与终端实例（`.activity-strip` / `.term-instances` / `.term-instance`）**完全命中**：胶囊 22px `--r-3`、
> 底 `--surface-raised`、边 `--line-strong`、当前实例 `--beam-wash` + `--beam`、pending 6px `--beam` 点。

### 8.12 权威文案表（全队唯一来源 · deepsleep / 唤醒简报 / 目标）

> **这张表是 team-lead 裁定的全队唯一权威文案。** engineer 与 UX 引用它，不要各写各的。
> 每条都给出 **i18n key**、中文、英文、**代码落点**。
> **英文不是中文的机翻** —— 英文版本单独定稿，中文版是直译。

| # | i18n key | 中文（zh-CN） | English (en-US) | 代码落点 |
|---|---|---|---|---|
| **W1** | `deepsleep.note` | **当前会话已归档，工具面已收窄。智能体保持安静，直到你请求唤醒简报。** | The session is archived and the tool surface is narrowed. The agent stays quiet until you request a wake briefing. | `i18n.ts`；`views.tsx` `DeepsleepView` 中央列说明 |
| **W2** | **`modeHint.deepsleep`** | **归档会话 · 收窄工具面** | Archive session · narrow tool surface | `i18n.ts`；模式菜单行的 hint 列（`views.tsx` 读 `t(\`modeHint.${m}\`)`）。**注意**：`mode.hint.deepsleep` 是**同名死键**，见 §8.12.1d |
| **W3** | `mode.hint.deepsleepCost` | **进入 deepsleep 会归档当前会话并收窄工具面，智能体保持安静直到你请求唤醒简报。** | Entering deepsleep archives the session and narrows the tool surface. The agent stays quiet until you request a wake briefing. | `i18n.ts`；`views.tsx` `StatusBar` 模式行的 `title` 属性（**该 key 已被工程师接上**，`views.tsx` 用 `t('mode.hint.deepsleepCost')`） |
| **W4** | `wake.badge` | **当前生效的规则** | **Rules in effect** | `i18n.ts`；唤醒简报卡片右上徽章 |
| **W5** | `wake.lead` | **这些规则由智能体在之前的轮次里写入，恢复会话后它们会参与回答检查。** | These rules were written by the agent in earlier rounds. They take part in answer checking once the session resumes. | `i18n.ts`；唤醒简报卡片引导句 |
| **W6** | 唤醒简报**空数组态**正文 | **当前没有生效的规则。** | No rules are in effect. | `views.tsx` `DeepsleepView` 空数组分支 |
| **W7** | 切换后的 transcript 系统行 | **deepsleep · 会话已归档，工具面已收窄** | deepsleep · session archived, tool surface narrowed | `App.tsx` `mode_changed` 分支写入的 transcript 系统行 |
| **W8** | 睡 log 首行 | **已归档** | Archived | `i18n.ts`（新 key）；`views.tsx` `.sleep-log` 第一行 |
| **W9** | 睡 log 说明行 | **休眠期间不会产生新的执行记录；这里只显示经过的时间。** | No new execution records are produced **while the agent rests**; only elapsed time is shown here. | `i18n.ts`（改写 `deepsleep.noLogDesc`）；`views.tsx` `.sleep-log` 说明行 |
| **W10** | `deepsleep.subtitle` | **此刻没有任务在跑** | **nothing is running right now** | `i18n.ts`；`views.tsx` `.deepsleep-sub` |
| **W11** | `deepsleep.noBriefingDesc` | **请求内核列出当前生效的规则** | **Ask the kernel to list the rules currently in effect** | `i18n.ts`；`views.tsx` 唤醒简报**未请求**态的说明行 |

> **W10 是权威表未覆盖、由 UX 补位的一处**：现有值「消化这一轮的经验」/「Digesting this round of experience」
> **命中 §8.12.1 禁用类别 ②**（「消化」/「digesting」暗示有东西在跑）。
> **已由 UX（文案归属方）填定：「此刻没有任务在跑」/「nothing is running right now」** ——
> 与 W1 的「智能体保持安静」不冲突，且是 deepsleep 层唯一的 h1 副标题。
> **已裁定**（原「⚠ 待裁定」已解除）。

### 8.12.0b W10 / W11 的补位说明（权威表原未覆盖，UX 补位）

| # | 补位原因 | 现值（假） | 处置 |
|---|---|---|---|
| **W10** | 权威表覆盖了 note / modeHint / title / badge / lead / 空态 / transcript 行，但**没有覆盖 `deepsleep.subtitle`**。它现值「消化这一轮的经验」同样在声称内核没做的事，因此**必须改** | 消化这一轮的经验 / Digesting this round of experience | 由 UX（文案归属方）填定，与 W1 的 note 不冲突，且是 deepsleep 层唯一的 h1 副标题 |
| **W11** | 现值「请求内核汇总休眠期间的变化」/「Ask the kernel to summarize changes」——**「summarize changes」暗示休眠期有变化**，而深睡期没有任何 round，**不可能有变化** | 请求内核汇总休眠期间的变化 / Ask the kernel to summarize changes | 新值与 **W4** / **W5** 的「当前生效的规则」口径一致：**请求列出的是规则，不是变更** |

#### 8.12.1 全局禁用措辞（三类，任何界面文案不得出现）

| 类别 | 禁用措辞 | 为什么 |
|---|---|---|
| ① 暗示有独立实例在复盘 | 「干净实例」「新实例接手」「正在复盘」「复盘输出链」 | `spawn_clean_instance` 生产代码**零调用方**，进入 deepsleep **不会**启动干净实例、**不会**复盘输出链（`pristem-deepsleep/src/lib.rs:141` 全在 `#[cfg(test)]`） |
| ② 暗示有东西在跑 | 「消化中」「交回内核消化」 | deepsleep 期间**没有 round 在跑** → 没有 `call`/`result`/`speech` 事件。规则是**模型在之前的普通轮次**里调 `reminder` 工具写入的（`executor.rs:316`） |
| ③ 暗示休眠期提交了规则 | 「已提交新规则」「在休眠期间提交」「内核没有提交新规则」 | 同上：deepsleep 期间**不会产生新规则**。「内核没有提交新规则」同样错 —— 它暗示"本来会提交但这次没有"，而事实上**从来就不会** |

**英文对应禁用词 —— 两份清单的并集，共 12 词**（M10 中英文分别跑正则，**大小写不敏感**）：

| 类别 | 英文禁用词（并集） |
|---|---|
| ① | "clean instance"、"new instance takes over"、"reviewing output chains"、**"reviewing its own output chains"**、**"digesting its output chains"** |
| ② | "digesting"、"hand back to the kernel"、**"submitted during sleep"** |
| ③ | "rules committed"（**大小写不敏感，覆盖 "New rules committed"**）、"committed during deepsleep"、**"submitted during sleep"**、**"no new rules were committed"**、**"summarize changes"** |

> **为什么取并集**：两份清单任一词残留都应算不通过。**断言多查几个词不会漏判，少查会漏** ——
> 所以宁可多查。这条与 M-0 是同一个道理：**判据的输入源要更严，不是更松**。
> 实际去重后为 **12 条正则**（"New rules committed" 与 "rules committed" 大小写不敏感合并）。

> **⚠ 这三类词在本文档里出现是允许的**（§8.5.2 / §8.12.1 / §9 判据 / Δ 差异表都在**列举禁用词**）。
> **M10 判据查的是运行时界面文本节点，不是规范文档** —— 验收脚本必须查 DOM，不查 `DESIGN_SYSTEM.md`。

#### 8.12.1b `i18n.ts` 残留字符串逐条对照（工程师施工用）

> 下面是**当前 `ui/src/i18n.ts` 里实际存在的假话文案**，逐条给出命中类别与应改为的值。
> 这张表是团队-lead 扫 `DESIGN_SYSTEM.md` 时**没覆盖到**的 —— 因为假话在**代码**里，不在规范里。

| # | i18n key | 语言 | 现状 | 命中 | 应改为 |
|---|---|---|---|---|---|
| 1 | `deepsleep.subtitle` | zh | 消化这一轮的经验 | ② | **W10** |
| 2 | `deepsleep.subtitle` | en | Digesting this round of experience | ② | **W10** |
| 3 | `deepsleep.note` | zh | 当前会话已归档，干净实例正在复盘输出链。你无需做任何事。 | ① ×3 | **W1** |
| 4 | `deepsleep.note` | en | The current session is archived. A clean instance is reviewing its own output chains. Nothing is required from you. | ① ×2 | **W1**（EN） |
| 5 | **`modeHint.deepsleep`** | zh | 交回内核消化 · 新实例接手 | ① + ② | **W2** |
| 6 | **`modeHint.deepsleep`** | en | Hand back to the kernel · a new instance takes over | ① + ② | **W2**（EN） |
| 7 | `mode.hint.deepsleepCost` | zh | 进入 deepsleep 会归档当前会话并启动一个干净实例，下一轮会重新消耗 token | ① | **W3** |
| 8 | `mode.hint.deepsleepCost` | en | Entering deepsleep archives this session and spawns a clean instance; the next round spends tokens again | ① | **W3**（EN） |
| 9 | `wake.badge` | zh | 已提交新规则 | ③ | **W4** |
| 10 | `wake.badge` | en | New rules committed | ③ | **W4**（EN） |
| 11 | `wake.lead` | zh | 这是休眠中的智能体了解文件变化的唯一通道 | 语义错 | **W5** |
| 12 | `wake.lead` | en | This briefing is the only channel through which the sleeping agent learns its files changed. | 语义错 | **W5**（EN） |
| 13 | `deepsleep.noLog` | zh | 还没有可显示的记录 | 语义错（暗示有记录） | **W8** 语境改写：`已归档` |
| 14 | `deepsleep.noLogDesc` | zh | 休眠期间的执行记录会显示在这里 | 语义错 | **W9** |
| 15 | `deepsleep.noLog` | en | No entries yet | 语义错 | **W8**（EN） |
| 16 | `deepsleep.noLogDesc` | en | Execution records will appear here | 语义错 | **W9**（EN） |
| 17 | `deepsleep.noBriefingDesc` | zh | 请求内核汇总休眠期间的变化 | 语义错（暗示休眠期有变化） | **W11** |
| 18 | `deepsleep.noBriefingDesc` | en | Ask the kernel to summarize changes | 语义错 | **W11**（EN） |
| **19** | **`mode.hint.deepsleep`** | zh/en | 交回内核消化 · 新实例接手 / Hand back to the kernel · a new instance takes over | ① + ② | **整条删除**（死键，无人引用 —— §8.12.1d） |
| **20** | `deepsleep.quiet`「安静状态」 | zh/en | Quiet state | — | **不渲染**（§8.12.1c：`.sleep-meta` 只留 1 个 chip）。文案本身不命中禁用类别，`i18n.ts` 条目可留可删 |
| **21** | `deepsleep.sleeping`「休眠中」 | zh/en | Sleeping | — | **不渲染**（§8.12.1c：与 eyebrow `deepsleep`、h1 重复；档位已由状态栏刻度器表达） |
| **22** | `help.deepsleep`「交回内核消化」 | zh/en | Hand back to the kernel | **②** | **删除**（命令帮助浮层整体删除 —— §7.3 新增说明，命令由命令面板 `Ctrl+Shift+P` 承载） |

> **第 19 条是死键**：与第 5 / 6 条同名同值，但 `views.tsx` 读的是 `t(\`modeHint.${m}\`)`，
> `mode.hint.deepsleep` **无人引用**。留着就是「同一事实两个来源」—— 见 §8.12.1d。

> 第 7 / 8 条除了「干净实例」，还含**「下一轮会重新消耗 token」** —— 这也不对：
> clean instance 不跑 round，**下一轮不会因为 deepsleep 而多消耗 token**；下一次 token 消耗发生在用户真正发起新一轮时。
> W3 的权威文案已去掉这个断言。

#### 8.12.1d `mode.hint.deepsleep` 是死键，必须删除

`i18n.ts` 里**同时存在**两个 key，值相同、都是假话：

```
i18n.ts:110   'modeHint.deepsleep':   '交回内核消化 · 新实例接手'      ← 活的
i18n.ts:168   'mode.hint.deepsleep':  '交回内核消化 · 新实例接手'      ← 死的，无人引用
```

**谁在读**：

| key | 读取点 | 状态 |
|---|---|---|
| `modeHint.deepsleep` | `views.tsx:868` → `t(\`modeHint.${m}\`)`（模式菜单 hint 列，coding/IDE/helping/advisor/deepsleep/goal 全家） | **活的** → 承载 **W2** |
| `mode.hint.deepsleep` | **无人引用** | **死键** → **删除** |
| `mode.hint.deepsleepCost` | `views.tsx:863` → `t('mode.hint.deepsleepCost')`（模式菜单行的 `title`） | **活的** → 承载 **W3** |

> **为什么必须删**：留着就是一个**同一事实两个来源**（§4.3 R-CONN-1 / H-3 的同类问题）——
> 改 W2 时如果只改 `modeHint.deepsleep`，死键里的假话仍然在源码里，
> 将来有人 grep 到它会以为这是有效文案。**死键 + 假话 = 最坏组合。**

#### 8.12.1c `.sleep-meta` 三个 chip 的精简（实现现状）

工程师当前 `.sleep-meta` 渲染了 3 个 chip：`暂停不等于终止` / `安静状态` / `休眠中`。

| chip | 处置 | 理由 |
|---|---|---|
| `deepsleep.pause`「暂停不等于终止」 | **保留** | 这是**非显而易见且真实**的事实：deepsleep 是内核 mode，与 `pause` 是两回事 |
| `deepsleep.quiet`「安静状态」 | **删除** | 与 h1「智能体正在休息」和 W1「智能体保持安静」重复 |
| `deepsleep.sleeping`「休眠中」 | **删除** | 与 eyebrow `deepsleep`、h1 重复；档位已由状态栏刻度器表达 |

→ **`.sleep-meta` 最终只保留 1 个 chip**（`deepsleep.pause`）。中央列的真实信息是：
说明文案（W1）+ 执行链快照 + 睡 log（时间标记）+ 两个行动按钮。

**W1 的依据**（见 §8.4.2a）：deepsleep 的工具表只有 5 个（`read/search/solo/pause/reminder`），
coding 有 9 个；`validate_calls_for_mode` 会拒绝越界调用。所以「工具面已收窄」是**可验证的事实**。

---

### 8.13 IDE 工作台形态（2026-11-15 全面整备）

以下形态在「IDE 功能整备」中落地，数值 = 当前实现值，作为回归基线。

#### 8.13.1 菜单栏 `.menubar`

| 项 | 值 |
|---|---|
| 位置 | 标题栏（36px）内，项目 chip 之后、会话带之前；**仅 IDE 模式渲染** |
| 顶层按钮 | 高 24px，左右 padding 8px，`--r-2` 圆角，`--fs-label`，`--text-2`；hover/open = `--overlay-hover` + `--text-1` |
| 下拉 | `top:27px`，`min-width:240px`，`--surface-float`，`1px --line-strong`，`--r-3`，阴影 `0 18px 48px rgba(0,0,0,.5)`，`z-index:70` |
| 条目 | 高 ~28px，左 label + 右快捷键（mono `--fs-mono-xs`）；hover 用 `--info` 16% 混合；禁用项 `--text-4` 且不可聚焦 |
| 分隔 | 1px `--line-soft`，上下 4px |
| 响应 | `<1200px` 顶层标签隐藏，显示 `≡`（打开命令面板） |
| 语义 | `role="menubar"` / `role="menu"` / `role="menuitem"`，`aria-haspopup`/`aria-expanded` |

#### 8.13.2 拆分编辑器

| 项 | 值 |
|---|---|
| 容器 | `.editor-area` 占据 `grid-area: main`；最多 2 组，`row` = 左右，`column` = 上下 |
| 分隔条 | `.editor-splitter` 4px，`--line-hair`；hover/拖动变 `--info`；拖拽比例 0.2–0.8 |
| 组状态 | 非活动组标题略降透明度（`.editor-group.is-active` 才有完整强调） |
| tab 溢出 | 横向滚动，活动 tab `scrollIntoView` |
| 关闭 | 关闭一组 → tab 合并到另一组并回到单组 |

#### 8.13.3 布局分隔条 `.ws-separator`

| 项 | 值 |
|---|---|
| 命中区 | 5px，视觉线 1px；hover/focus/拖动 → `--info` |
| 范围 | 左 200–460，右 280–560（仅 `has-right`），活动带 120–520 |
| 交互 | 拖动写 CSS 变量（`--left-w`/`--right-w`/`--activity-h`），松手持久化；双击回 268/360/176；`role="separator"` + 方向键 ±16px |
| 隐藏 | `<900px` 不渲染手柄 |

#### 8.13.4 真实终端

| 项 | 值 |
|---|---|
| 宿主 | `.term-host` 始终挂载；折叠只隐藏 body（`display:none`），展开后 `fit.fit()` |
| 字体 | `settings.terminalFontSize`（12/13/14），行高 1.5 |
| 名称 | 来自 `term.open` 响应的真实 shell 名（`pwsh`/`powershell`/`cmd`），不是 `bash n` |
| 结束态 | `.term-tab.is-exited`（保留，不自动关闭） |
| 不可用 | 宿主显示 `[PTY unavailable: …]`，tab 标 `.is-exited` |

#### 8.13.5 文件树上下文菜单与内联命名

| 项 | 值 |
|---|---|
| 菜单 | `.tree-context-menu`（复用 `.tab-context-menu` 玻璃形态），`data-pop="tree-menu"`，定位在指针处 |
| 条目 | 新建文件 / 新建文件夹 / 重命名 / 删除（两步确认）/ 复制路径 / 在资源管理器中显示 / 刷新；根节点禁用重命名与删除 |
| 内联输入 | `.tree-name-input`，Enter 提交，Esc/blur 取消；非法字符（`\ / : * ? " < > \|`）与 `.`/`..` 拒绝并给出 `.tree-name-err` |
| 加载/错误 | `.tree-loading` / `.tree-error`（+ Retry），不出现静默空目录 |
| 键盘 | `role="tree"` / `treeitem`，roving tabindex；`↑↓` 移动、`←→` 折叠/展开、`Home/End`、`Enter` 打开、`F2` 重命名、`Delete` 删除 |

#### 8.13.6 任务选择 `.task-picker`

| 项 | 值 |
|---|---|
| 触发 | Run 菜单「任务列表」/ 命令面板 `run.tasks` |
| 形态 | 与命令面板同宽（520px）、`--surface-float`、`--r-4`、顶部 84px 居中 |
| 条目 | 左任务名、右实际命令（mono `--fs-mono-xs` `--text-4`） |
| 数据 | 测试命令 + 根 `package.json` scripts（≤20）+ 当前文件运行器 |
| 空态 | `.task-picker-empty`「没有检测到可运行的任务」 |

---

## §9 视觉验收清单

每条给出**可测量判据**。Phase 3 完成后逐条勾选，其中标 ✅ 的应写入 `.visual-check/check.cjs` 做自动化断言。
**清单共 132 条**（§9.1–9.7 共 73 条 + §9.8 已裁定硬约束 15 条 + §9.10 新形态 27 条 + §9.11 折叠把手互斥 2 条 + §9.12 语义诚实性 15 条）。
每条判据均带**「治理依据」**列 —— 判定以治理依据为准，§8.11 的数值只作回归基线（§9.0）。

### 9.0 验收执行方法（QA 口径）

Phase 3 视觉验收（任务 #5）按以下三层执行，**任一层不通过即退回 engineer**：

| 层 | 手段 | 覆盖 |
|---|---|---|
| **L1 自动化断言** | 扩写 `.visual-check/check.cjs`（Playwright + Edge headless，viewport 1440×900），逐条实现 §9.1–9.8 的 ✅ 项 | 可被 `getComputedStyle` / DOM 查询 / 文本遍历判定的项 |
| **L2 源码静态检查** | 对 `ui/src/` 做正则与 AST 级检查：硬编码版本号、`term_id`、`Usage` 字段集、`--font-display` 残留、`var(--presence)` 越界引用、spectrum 使用点计数、`brand-prism` 数量 | 静态可判定的项（C8、C9、B4、D-3a、D-4a、D-5） |
| **L3 截图核对** | 按 **§8 的形态定义**逐屏人工/视觉核对当前截图：字标计数、棱镜计数、beam 配额、密度、留白 | 静态判不了的项（B2、B6、G10、G12、F8） |

> **L3 的两个纪律**：
> 1. **比对对象是 §8 的形态定义，不是旧 PNG。** 「与旧截图比像素」没有意义 —— 旧截图是**被删掉的旧实现**，
>    不是规范。把 §8.11 的数字、§7 的骨架图、§8.12 的文案表当基准。
> 2. **截图输出目录必须与 `check.cjs` 分离。** `.visual-check/check.cjs` 把 8 张图（`01`–`08`）直接写进
>    `.screenshots/`，**每次运行都覆盖**；若验收脚本也写同一路径，两次运行互相踩。
>    → 验收截图一律输出到 **`.visual-check/qa-out/`**，**不写 `.screenshots/`**。
>    → `.screenshots/09`–`16` 这 7 张 `check.cjs` 不会覆盖的**重构前原始图**已另存到
>    **`.visual-check/baseline/`**（只读复制，未改动 `.screenshots/` 本身），作为「改造前」的存档参考。

**执行环境**：`pnpm build` 后的 `dist`，经壳层 `127.0.0.1:8787` 访问；需内核在线以触发 `usage` / `mode_changed` / `provider_changed` 事件。

**元规则 M-0：所有文本类断言的输入源必须是运行时 DOM，不得取自规范文档**

`.visual-check/check.cjs` 里**每一条**文本类断言（B1 / B2 / B8 / C1–C14 / D 系列 / G8 / G12 / G15 /
N 系列 / M1–M14）都必须读**运行时 DOM**：
`document.body.innerText` 或遍历文本节点（排除 `display:none` / `visibility:hidden` / `aria-hidden`）。

**禁止**把 `DESIGN_SYSTEM.md` / `UX_SPEC.md` 的内容作为断言输入。

> **唯一例外**：**M16**（规范自检）的检查对象**就是规范文档本身**，因此它读 `DESIGN_SYSTEM.md`。
> 这是唯一允许的例外，且它判定的是**文档的内部一致性**，不是产品界面。

> **为什么**：规范文档里**必然**出现被禁措辞 —— §8.12.1 的禁用措辞表本身就要列出它们，
> §8.12.1b 的 i18n 残留表要逐条引用现值，§9 的判据要写明禁用词。
> 拿文档当判据输入，脚本会**给自己打分**：它必然命中自己的禁用清单，然后判自己不合格。
> 这条元规则保护后面所有 L1 断言不被自己人钻空子。

**治理依据列（每条判据必填）**

§9 的每条判据都有三列：**判据 / 治理依据 / 测量方法**。
**「治理依据」指向约束的来源**（哪一节、哪个 token、哪条密度上限、哪条对比度下限），
**「测量方法」必须验证那条约束本身，而不是验证某个写死的数值**。

> **为什么**：如果判据是「`.view-seg-item` 高 18px」，它只能证明「没变」；
> 如果判据是「`.view-seg-item` 圆角用 token 且内层 < 外层、字号取自 §3.3 type scale、
> 对比度 ≥ 4.5」，它能证明「对」。
> **工程师将来改了值，只要仍满足治理约束，判据依然通过；违反了则判不通过。**
> §8.11 是**快照**，§9 才是**规格**。

**退回格式（强制）**：每条不达标写成一行 ——
`[清单编号] 文件:行 — 现象 — 期望值 — 实测值`
例：`[G4] ui/src/workspace.tsx:515 — 连续 3 条命令后出现 5 个 › — 每行 1 个 — 实测 5 个`

**「验收不通过不算完成」**：任一条 ✅ 未通过，Phase 3 不得标记完成。

### 9.1 品牌（对应问题 1、11、12）

| # | 判据 | 治理依据 | 测量方法 |
|---|---|---|
| ✅ B1 | 任意模式下，DOM 中 `.brand-prism` 元素数 **≤ 2** | §2.2 品牌出现次数硬上限（棱镜 ≤ 2） | `document.querySelectorAll('.brand-prism').length` |
| ✅ B2 | 任意模式下，可见的字标 "pristem" 文本节点数 **= 1**（协议标识 `pristem.ipc` 不计） | §2.3 字标出现次数硬上限（同屏 = 1） | 遍历文本节点，匹配 `/^pristem\.?$/i` |
| ✅ B3 | `.living-core` / `.living-eye` / `.living-bloom` / `.living-highlight` 元素数 **= 0** | §2.1 唯一标识（棱镜是唯一图形） | DOM 查询 |
| ✅ B4 | `--font-display` 在 `styles.css` 中**不存在** | §3.2 去掉衬线回退陷阱（删 `--font-display`） | 文本搜索 |
| ✅ B5 | 所有使用衬线字体的选择器，其文本内容**不含中日韩字符** | §3.1 字体职责边界（衬线只承载拉丁） | 静态检查：`--font-wordmark` 只允许 `.brand-name` 与 `.goal-wordmark`（后者已删） |
| ✅ B6 | 中文界面下 `.sleep-center h1` / `.wake-card h2` 的 `font-family` 解析结果不含 `serif` | §3.2 中文标题必须 `--font-ui` | `getComputedStyle(el).fontFamily` 不含 `serif` / `Songti` |
| ✅ B7 | 中文界面下不存在 `font-style: italic` 作用于含中文的元素 | §3.2 禁止对中文使用 `font-style: italic` | 静态检查 + 截图 |
| ✅ B8 | 可见文本中不出现「演示 / demo / 假数据 / 未完成 / 占位 / TODO」 | §8.3 R-CONN-3 可见禁用词 | 遍历文本节点正则 |

### 9.2 对比度与色彩

| # | 判据 | 治理依据 | 测量方法 |
|---|---|---|
| ✅ C1 | `--text-1` 在 `--surface-panel` 上对比度 **≥ 7.0**（实测 12.99） | §4.1 对比度层级（`--text-1` ≥ 7） | WCAG 计算 |
| ✅ C2 | `--text-2` 在 `--surface-panel` 上 **≥ 7.0**（实测 8.19） | §4.1 对比度层级（`--text-2` ≥ 7） | 同上 |
| ✅ C3 | `--text-3` 在 `--surface-panel`/`canvas` 上 **≥ 4.5**（实测 4.81 / 4.51） | §4.1 对比度层级（`--text-3` ≥ 4.5） | 同上 |
| ✅ C4 | `--text-4` **不出现在任何承载语义的元素上** | §4.1 对比度层级（`--text-4` 仅装饰） | 代码审查：`.micro` / `.text-4` 用途清单 |
| ✅ C5 | `--surface-raised` / `--surface-float` 上的文本对比度 **≥ 4.5** | §4.1 `--surface-raised`/`--surface-float` 上最低 `--text-2` | 逐元素检查 → 最低用 `--text-2` |
| ✅ C6 | 同视口内 accent **实心填充块**数 **≤ 2** | §4.2 accent 配额（实心块 ≤ 2） | `querySelectorAll` 过滤彩虹填充 / accent 单色块 |
| ✅ C7 | `--spectrum` 的**定义**恰好 **1** 处；**使用点**只在 §4.3 的强调位清单内 | §4.3 spectrum 单一定义 | `styles.css` 文本搜索 `--spectrum:` 与 `var(--spectrum)` |
| ✅ C8 | `--intensity` 公式在 `styles.css` 中**只出现 1 次定义** | §4.5 R-INT-3 唯一强度公式 | 文本搜索 `clamp(0, calc(var(--presence)` |
| ✅ C9 | 除 `.app-shell` 外，**无**选择器直接引用 `var(--presence)` 或 `var(--living-gain)` | §4.5 R-INT-2 越界引用禁令 | 文本搜索 |
| ✅ C10 | 切换模式时 surface 色值**不变** | §4.5 presence 不改 surface 色值 | 切换前后 `getComputedStyle(.editor-pane).backgroundColor` 相等 |
| ✅ C11 | 焦点环在 `--surface-float` 上可见（外圈 `--beam` 与背景差 **≥ 3:1**） | §4.1 焦点环对比度（≥ 3:1） | 计算 |
| ✅ C12 | `.settings-chip` 文字对比度 **≥ 4.5**（在 `--surface-raised` 上）—— 实测 `--text-3` = **3.96:1** 不达标，`--text-2` = **6.76:1** 达标（Δ13） | §4.1 对比度层级（raised 上最低 `--text-2`） | WCAG 实算（读 `getComputedStyle` 的 `color` 与父级 `backgroundColor`） |
| ✅ C13 | `.settings-seg button` 的 `font-size` **取自 §3.3 type scale 的控件标签档**（`--fs-label` 11px），**不得**取自 `--fs-mono` 的 11.5px；`border-radius` **必须用 token**（`--r-1`），不得硬编码（Δ14） | §3.3 type scale + §8.11.0 N-R1（不得硬编码） | 读 `getComputedStyle` 的 `fontSize` / `borderRadius`，与 `--fs-label` / `--r-1` 的**声明值**比对（不是与写死的 11px/3px 比对） |
| ✅ C14 | `.settings-row.is-unavailable .settings-row-desc` 的文字**不得用 `--text-4`**（在 `--surface-canvas` 上约 **2.7:1**，C4 违规）；降级说明用 `--text-3` + **左侧 2px `--danger` 竖条**表达，**不靠压暗文字**（Δ15） | §4.1 对比度层级（`--text-4` 仅装饰） | WCAG 实算 + 检查有无 `--danger` 竖条 |

### 9.3 动效

| # | 判据 | 治理依据 | 测量方法 |
|---|---|---|
| ✅ D1 | 所有 `animation-duration` / `transition-duration` **≤ 640ms**（无限循环的 LIVING 层除外） | §5.1 时长硬上限 640ms | 静态解析 `styles.css` |
| ✅ D2 | 同屏**运动循环动画 ≤ 1**（LIVING 呼吸）；棱镜时钟只转色，计入颜色循环但不算运动 | §5.5 同时循环动画 ≤ 1 + §4.3 棱镜时钟 | `getAnimations().filter(a => a.playState==='running' && a.effect.getTiming().iterations===Infinity)`，排除 `prism-phase` |
| ✅ D3 | deepsleep 模式下，光晕呼吸周期 **= 12s** | §5.4 deepsleep 呼吸 12s | `getComputedStyle(el).animationDuration` |
| ✅ D4 | deepsleep 模式下**不存在**周期 < 2s 的动画 | §5.4 deepsleep 禁止 < 2s 的动画 | 同上枚举 |
| ✅ D5 | 模式切换后刻度器过渡在 **480ms** 内完成 | §6.6 档位过渡总感知 ≤ 480ms | 采样 `--presence` 的计算值 |
| ✅ D6 | `prefers-reduced-motion: reduce` 下：所有动画 `animation: none`，所有过渡 `duration: 0ms`，**且所有状态仍可读** | §5.6 reduced-motion 静态等价表达 | Playwright `reducedMotion: 'reduce'` 截图审查 |
| ✅ D7 | 无 `bounce` / `elastic` / `spring` 缓动 | §5.2 缓动白名单（无 bounce/elastic） | 文本搜索 `styles.css` 的 `cubic-bezier` 值白名单 |
| ✅ D8 | 骨架屏 shimmer 与 LIVING 呼吸**不同时运行** | §5.5 M5/M8 骨架与 LIVING 互斥 | DOM 属性 `data-busy` |

### 9.4 存在感刻度

| # | 判据 | 治理依据 | 测量方法 |
|---|---|---|
| ✅ E1 | 状态栏刻度器宽度 = **23px**（sm） | §6.2 刻度几何（sm 23×10 / md 28×12） | `getBoundingClientRect().width` |
| ✅ E2 | 状态栏与模式菜单的刻度器使用**同一组件**（同一 class 家族） | §6.3 单一组件（状态栏与菜单同一套） | 源码检查 |
| ✅ E3 | 模式菜单 6 行刻度器的**亮格数**依次为 `0,1,2,3,4,5` 的某个排列，且**从左向右**点亮 | §6.2 填充规则（从左向右、亮格 = 档位） | 逐行数 `.dial-cell.on` |
| ✅ E4 | IDE（0 档）时状态栏刻度器**宽度 = 0** | §6.7 0 档不渲染刻度器 | `getBoundingClientRect().width === 0` |
| ✅ E5 | 6 个模式的刻度器亮格数**单调**且与 `PRESENCE` 一致 | §6.2 亮格数 = `PRESENCE` | 同 E3 |
| ✅ E6 | 模式菜单内**不存在**每行独立的循环动画（只有当前档位格有辉光） | §6.5 菜单本身不动画 | `getAnimations()` |

### 9.5 布局

| # | 判据 | 治理依据 | 测量方法 |
|---|---|---|
| ✅ F1 | **不存在**旧标题栏菜单栏（`.title-menus` / `.title-menu-btn` 元素数 = 0）；IDE 模式的 `.menubar` 是独立组件，不算复活（`<1200px` 折叠为 `≡`） | §7.4 删除旧菜单栏（IDE 例外） | DOM 查询 |
| ✅ F2 | **不存在** 48px 图标活动栏（`.activity-bar` 元素数 = 0） | §7.4 删除 48px 图标活动栏 | DOM 查询 |
| ✅ F3 | 标题栏高度 = **36px**；会话带 = **28px**；状态栏 = **24px** | §7.1 骨架尺寸（36/28/24） | `getBoundingClientRect().height` |
| ✅ F4 | 左列宽度 = **268px**（默认）；控制台 = **360px**；活动带 = **176px** | §7.1 骨架尺寸（268/360/176） | 同上 |
| ✅ F5 | IDE 模式下 `[data-ai="true"]` 元素数 = **0**（**保持现有断言**） | §7.5 IDE 架构性休眠（零 AI 元素） | 现有 check.cjs 已覆盖 |
| ✅ F6 | deepsleep 模式下 **`.workspace` 仍存在于 DOM**，且 `pointer-events: none` | §8.4.1 deepsleep 不卸载工作台 | DOM + 计算样式 |
| ✅ F7 | goal 模式下 `.filetree` / `.monaco-host` / `.term-host` 元素数 = 0（**保持现有断言**） | §7.3 goal 不渲染代码库表面 | 现有 check.cjs 已覆盖 |
| ✅ F8 | 状态栏元素数 **≤ 6**（左 2 + 右 4），且其中**实心强调 ≤ 1** | §7.2 状态栏元素数 ≤ 6 | DOM 查询 |
| ✅ F9 | 状态栏**不含** branch / diagnostics / cursor / eol / indent 文本 | §7.4 状态栏只回答两个问题 | 文本检查 |
| ✅ F10 | 光标位置信息出现在**文档状态条**而非状态栏 | §7.4 光标信息归文档状态条 | 文本位置检查 |
| ✅ F11 | 设置是**独立页**（`.settings-page` 存在），`.settings-panel`（侧栏版）不存在 | §8.8.1 设置是独立页 | DOM 查询 |
| ✅ F12 | 设置页 ≥ **7** 个分区 | §8.8.2 七个分区 | `.settings-section` 计数 |
| ✅ F13 | 文件树路径输入框 `.path-input` 元素数 = 0 | §8.6.1 删除手输路径输入框 | DOM 查询 |
| ✅ F14 | 「打开文件夹」按钮触发 `fs.pickFolder`（不是切视图） | §8.6.1 主路径必须真发 IO | 拦截 IO 请求断言 |
| ✅ F15 | 文件树目录项**可展开**（不再 `disabled`） | §8.6.3 目录项可展开 | DOM 属性检查 |

### 9.6 组件

| # | 判据 | 治理依据 | 测量方法 |
|---|---|---|
| ✅ G1 | goal 模板（起步句）**高度 ≤ 28px**，且**同一行** | §8.2.2 起步句高度 ≤ 28px | `getBoundingClientRect()` + `offsetTop` 比对 |
| ✅ G2 | `.goal-template` / `.intent-chips` 元素数 = **0** | §8.2.1 删除假 chip | DOM 查询 |
| ✅ G3 | 终端面板的三个 tab 是 `<button>` 且 `aria-selected` 正确 | §8.9.3 三个 tab 是真按钮 | DOM 属性检查 |
| ✅ G4 | 连续执行 3 条命令后，终端内 `›` 提示符**每行恰好 1 个** | §8.9.1 唯一提示符 `›` | 读 `.xterm-rows` 文本，逐行计数 |
| ✅ G5 | 终端首行**不含** `pristem terminal` | §8.9.5 删除首行横幅 | 文本检查 |
| ✅ G6 | 终端**不含** `pristem@workspace %` | §8.9.1 壳层不��显 | 文本检查 |
| ✅ G7 | 终端光标 `cursorStyle` = `block`，`cursorBlink` = `false` | §8.9.2 光标形态（block / 不闪烁） | 源码检查 |
| ✅ G8 | 唤醒简报卡片有**关闭按钮**，点击后卡片消失且**模式不变** | §8.5.1 简报可关闭 | 交互测试 |
| ✅ G9 | deepsleep 视图存在「继续工作」按钮，点击后**由内核**切回 coding | §8.4.3 「继续工作」走内核 | 交互 + `mode_changed` 事件断言 |
| ✅ G10 | 空态的棱镜图标数 **≤ 1**（全屏） | §8.10 棱镜仅 `first` 变体 | `document.querySelectorAll('.empty-state .brand-prism').length` |
| ✅ G11 | 每个 `.empty-actions` 的按钮数 **≤ 2** | §8.10 行动按钮 ≤ 2 | DOM 计数 |
| ✅ G12 | 连接状态在**状态栏只有 1 处**；面板/卡片内无重复 | §4.3 R-CONN-1 连接状态唯一 | 全屏文本搜索「内核未连接 / 离线夹具」出现次数 = 1 |
| ✅ G13 | 无内核 `usage` 事件时，vitals 条**不存在**（不是显示 0） | §8.7.2 无事件不渲染 | DOM 查询 |
| ✅ G14 | 有 `usage` 事件时，vitals 条显示 in/out/cached/elapsed/tool_calls **五项** | §8.7.4 用量五项 | 文本检查 |
| ✅ G15 | **全屏可见文本中，连接状态词（内核已连接 / 离线夹具 / 内核未连接 / 正在连接内核）出现次数 = 1**。覆盖四种场景：① 默认；② **`.toast-stack` 有 toast 时**；③ **`.conn-retry-menu` 展开时**；④ **设置页打开时**。四种场景都必须是 **1** | §4.3 R-CONN-1 连接状态全局唯一 + R-CONN-2 | 遍历**可见**文本节点做关键词计数（`display:none` / `visibility:hidden` 排除）；四种场景分别触发 |

### 9.7 密度上限

| # | 判据 | 治理依据 | 测量方法 |
|---|---|---|---|
| ✅ H1 | 任一面板列表项 **≤ 200** 条，超出显示「还有 N 项」 | §9.7 密度上限（列表 ≤ 200） | `querySelectorAll` 计数 + 「还有 N 项」文案存在性 |
| ✅ H2 | 浮层（popover / menu / dialog）宽度 **≤ 560px**；全屏视图除外 | §9.7 密度上限（浮层 ≤ 560px） | 枚举所有 `[data-pop]` / 浮层容器，测 `getBoundingClientRect().width` |
| ✅ H3 | 单行内控件 **≤ 3** 个 | §9.7 密度上限（行内控件 ≤ 3） | 遍历所有行级容器，数直接子级可交互元素 |
| ✅ H4 | 卡片/列表项高度 **≤ 44px**（终端与代码除外） | §9.7 密度上限（卡片 ≤ 44px） | 测卡片/列表项 `getBoundingClientRect().height` |
| ✅ H5 | 面板嵌套层级 **≤ 3** | §9.7 密度上限（嵌套 ≤ 3） | 计算 `.pane` / `.side-panel` 的 DOM 祖先链深度 |
| ✅ H6 | 同一视图内并列面板 **≤ 3** 区（左列 + 舞台 + 控制台） | §7.2 并列面板 ≤ 3 | 数同屏可见的并列面板容器 |
| ✅ H7 | 任一面板的 `.pane-head` 高度 = **32px** | §9.7 密度上限（`.pane-head` = 32px） | 测 `.pane-head` 的 `getBoundingClientRect().height` |

### 9.8 已裁定硬约束（D-1 ~ D-6，来自附录 B′）

> 这 5 条由 team-lead 裁定为**对全队的硬约束**，Phase 2（UX）与 Phase 3（工程）共用。
> Phase 3 视觉验收时逐条实测，不通过即退回。

| # | 判据 | 治理依据 | 测量方法 |
|---|---|---|
| ✅ D-1a | deepsleep 视图存在「**继续工作**」按钮，点击后**由内核**切回 coding（`mode_changed` 事件驱动，UI 不自行 setMode） | 附录 B′ D-1 + 既有架构约定（模式只由内核决定） | Playwright：点击 → 断言收到 `mode_changed{to:"coding"}`；断言 UI 无 `setMode` 调用 |
| ✅ D-1b | 状态栏模式控件在 deepsleep 下**可点**且能打开模式菜单 | 附录 B′ D-1（路径各自独立） | 交互测试 |
| ✅ D-1c | 唤醒简报卡片存在「**回到工作台**」按钮，点击后**仅关闭卡片**，模式**不变** | 附录 B′ D-1（不改模式） | 交互测试 |
| ✅ D-1d | 三条路径**各自独立**可用：逐条单独测试，不依赖另外两条 | 附录 B′ D-1（互不依赖） | 逐条测试 |
| ✅ D-2a | `App.tsx` 的 `openFolderPicker` **真的发出** `fs.pickFolder`（拦截 IO 请求断言） | 附录 B′ D-2（真发 IO） | 拦截 `/api/io` 请求体 |
| ✅ D-2b | 文件树**不含**手输路径输入框；存在原生对话框入口与路径粘贴兜底入口 | 附录 B′ D-2 + §8.6.1（主路径 + 兜底） | DOM 查询 + 交互 |
| ✅ D-3a | UI 源码中终端实例字段名为 **`instance`**（数字），不存在 `term_id` | 附录 B′ D-3（字段名 `instance`） | 源码检查 |
| ✅ D-3b | 壳层未回传 `instance` 时，终端实例胶囊**只有 1 个** | 附录 B′ D-3（降级为单实例） | 交互测试（在无 instance 回传的环境下） |
| ✅ D-3c | **双判定都在**：判定 A = 能力探测（`shell.capabilities`）为 false 时只显示 1 个实例；判定 B = **实际收到的 `term.output`/`term.done` 里没有任何 `instance` 字段**时立即收敛为 1 个实例 | 附录 B′ D-3（双判定） | 两道判定分别构造环境各测一次 |
| ✅ D-3d | **桩测试**：造一个「壳层 `term.run` 请求**接受** `instance`，但输出事件**不回传** `instance`」的桩，验证前端收敛为 **1 个实例**，而不是显示 2 个假实例 | 附录 B′ D-3（双判定 · 桩测试） | 桩件注入 + DOM 计数 `.term-instance` |
| ✅ D-4a | UI 源码中**不存在** `provider` / `model` 属于 `Usage` 事件的字段 | 附录 B′ D-4（字段集不含 provider/model） | 源码检查 + 事件结构断言 |
| ✅ D-4b | 无内核 `usage` 事件时，vitals 条**不存在**（不是显示 0 / — / 占位符） | 附录 B′ D-4（无事件整条不渲染） | DOM 查询 |
| ✅ D-4c | 有 `usage` 事件时，vitals 条显示 in / out / cached / elapsed / tool_calls **五项**，且数值与事件一致 | 附录 B′ D-4（五项） | 文本 + 数值比对 |
| ✅ D-5 | UI 源码中**不存在**硬编码的 `'pristem.ipc/v0.` 字面量；状态栏徽标内容 == `fs.list` 响应的 `protocol` 值 | 附录 B′ D-5（不硬编码版本号） | 源码正则 + 运行时比对 |
| ✅ D-6 | **临时防御已移除**：B-3（壳层停止回显）落地后，UI 源码中**不得再存在**过滤 `pristem@workspace % ` 的逻辑。该过滤是 B-3 未就绪期间的兜底，留着就是永久的掩盖性代码 | §9.9 S3 + §4.3（能力落地后删兜底） | 源码正则：`pristem@workspace %` 在 `ui/src/` 中出现次数 = 0 |

> **D-6 的执行时机**：B-3 落地**之前**不判（此时过滤必须存在）；B-3 落地**之后**必须判。
> 判据 = `ui/src/` 中 `pristem@workspace %` 字面量出现次数 = 0。
> 同一原则适用于所有「为未就绪的后端能力写的临时兜底」：**能力落地后必须回头删掉兜底**，
> 否则它会变成掩盖真实故障的永久代码。

### 9.9 验收执行顺序（与 #3/#4 的依赖关系）

#### 9.9.0 S0 预检（S1 之前必须全绿，否则 S1 无效）

| # | 预检项 | 判据 | 为什么 |
|---|---|---|---|
| **S0-1** | **端口 8787 空闲** | `Get-NetTCPConnection -LocalPort 8787 \| Where State -eq 'Listen'` **结果为空** | 壳层持有 LISTEN 套接字时新壳层起不来。且**不得**在工程师正在跑 `check.cjs` 时结束它 |
| **S0-2** | **无并发验收** | 进程列表中**没有** `node .visual-check/check.cjs`、无 Playwright/Edge 实例在跑 | 并发跑会互相抢 8787 与截图目录，断言结果不可信 |
| **S0-3** | **壳层来自当前源码** | `pristem-desktop.exe` 的构建时间戳 **晚于**最后一次源码修改 | 否则测到的是旧二进制，验收结论无效 |
| **S0-4** | **内核在线** | `usage` / `mode_changed` / `provider_changed` 可达 | D-4 / D-5 / B-6 的前置；这三项在 preview 适配器下测不到 |
| **S0-5** | **截图输出目录隔离** | 验收脚本的 `OUT` 指向 `.visual-check/qa-out/`，**不是** `.screenshots/` | `check.cjs` 会覆盖 `.screenshots/01`–`08`（见 §9.0 L3 纪律 2） |

> **S0-1 的实测记录（本轮）**：PID **15936** `pristem-desktop`（32.2 MB，StartTime **22:44:14**）
> 持有 8787 的 **LISTEN** 套接字，并有 **2 条 Established** 连接
> （`msedgewebview2` = 应用内 WebView、`msedge` = Playwright 驱动），
> 同时 `node .visual-check/check.cjs`（PID 9004）**正在运行**。
> → **这不是遗留孤儿，是 frontend-engineer 正在使用的测试实例**；**不能在 S1 前盲杀**。
> 正确做法：等工程师当前这轮跑完，由他关闭，或在 **S0-1 时点**（S1 正式开始前）再结束它。



| 阶段 | 前置 | 做什么 | 能测的条目 |
|---|---|---|---|
| **S1 接通** | #4 完成 | 工程师把 UI 接到**真实壳层**上跑通一轮 | 冒烟：启动、连接、模式切换、终端执行一条命令 |
| **S2 实测** | S1 通过 | 跑 §9.1–9.8 的 81 条（L1 + L2 + L3） | 全部 81 条 |
| **S3 清理** | S2 通过 | 删掉所有「为未就绪能力写的临时兜底」（D-6 是其中被显式命名的一条），**并验证删完之后功能仍成立** | D-6 + 复测受影响的条目 |

> **S3 的两条硬要求**（team-lead 补充）：
> 1. **清理不只是删代码，还要验证删完之后功能仍成立。**
>    例：删掉 `pristem@workspace % ` 过滤后，终端里必须**确实只剩 `›` 一套符号** ——
>    不能删完发现壳层还在回显，把 bug 从「两套符号」变成「命令不回显」。**每条清理都要复测受影响条目。**
> 2. **S3 完成后要产出「临时代码清单」**：哪些是为未就绪能力写的兜底、现在删了哪些、
>    **还有哪些保留及保留原因**。目的是确认**没有掩盖性代码留在产品里**。清单交 team-lead 复核后才算 S3 完成。
>
> **判定标准**：一条兜底代码算「保留」的唯一合法理由是「它对应的后端能力**还没落地**」；
> 能力已落地却还留着兜底 → 判不通过（掩盖性代码）。

> **顺序不可颠倒**：在 S1 之前跑 S2，B-2 / B-3 / B-4 / B-8 这几条无法实测，
> 只能标「阻塞于 #4」——**标记阻塞不等于通过**，Phase 3 不得据此标记完成。

### 9.10 Phase 2 引入的新形态（对应 §8.11，共 27 条）

> 数值**已与工程师在途实现对齐**（§8.11），除 §8.11.7 的 Δ1 / Δ2 / Δ3 三处。
> 写这些判据的目的不是「再定一遍」，而是**把已定的东西钉死成可回归的断言**。

| # | 判据 | 治理依据 | 测量方法 |
|---|---|---|
| ✅ N1 | `.left-rail-head` 高 **28px** + 底 `--surface-rail` + 下边线 1px `--line-hair`；`.view-seg` 轨道高 **24px**；`.view-seg-item` 高 **18px** | §8.11.1 尺寸定义 | `getBoundingClientRect().height` + 计算样式 |
| ✅ N2 | `.view-seg-item` **同时有图标与文字**（不允许纯图标段）；段间**无分隔线** | §8.11.1 图标 + 文字（不用纯图标） | DOM + 截图 |
| ✅ N3 | `.view-seg-item` 文字 **11px（`--fs-label`）**（Δ1）、圆角 `var(--r-1)` 3px（Δ2）、图标 **15px**（Δ3）；选中态 = **`--beam-wash` 底**（Δ4）+ `--text-1` + `inset 0 -2px 0 var(--beam)` | §3.3 type scale + §8.11.1 内层圆角 < 外层 | 计算样式（Δ1–Δ4 修完后判通过） |
| ✅ N4 | ⚙ 按钮 **24×24**、`margin-left: auto`、与切换器之间 **1px `--line-hair` 竖分隔**（Δ5）+ 间距 8px；段间亦有 1px `--line-hair` 分隔 | §8.11.1 分隔 | 计算样式 |
| ✅ N5 | `.mode-menu` 宽 **360px**；模式行高 **36px**；行间**无分隔线**；`.menu-name` 宽 **66px** 且为 **mono** | §6.2 刻度几何 | 计算样式 |
| ✅ N6 | `.mode-menu-pending` 在**目标行尾**：6px `--beam` **静态**点（`animation: none`）+ 文字「切换中」`--fs-label` **11px**/500 `--text-2`（Δ6/Δ7）；其余 5 行 `aria-disabled="true"` 但**仍可见**；菜单保持打开；**菜单内不出现进度类转圈** | §5.6 状态需文字 + §5.5 同时循环 ≤ 1 + UX_SPEC F-5 | DOM + `getAnimations()` + 截图 |
| ✅ N7 | `.mode-menu-error` **直接复用 `EmptyState variant="error"`**（Δ8）：左 **2px `--danger` 竖条** + 标题 `--fs-body` 13px/600 `--text-1` + 描述 11.5px `--text-2`（**不得用 `--text-3`** —— float 上仅 3.38:1）；左对齐 | §4.1 对比度层级 + §8.10 error 变体 + UX_SPEC F-5 | 计算样式 + DOM |
| ✅ N8 | `.settings-page` `max-width: 880px` 水平居中、底 `--surface-canvas`、`inset: 64px 0 24px 0`；栅格 `176px minmax(0,1fr)` + `gap: 24px`；`.settings-nav` `position: sticky` 且**无独立底色** | §8.8.2 / §8.11.3 栅格 | 计算样式 |
| ✅ N9 | `.settings-nav-item` 高 **30px**；选中 / scrollspy = 文字 `--text-1` + **左 2px `--beam` 竖条**（唯一一种高亮形态） | §8.11.3 选中形态统一（竖条） | 计算样式 + DOM |
| ✅ N10 | `.settings-row` 为 **4 列** `200px auto minmax(0,1fr) 96px`（Δ7，顺序 = 标签 / 控件 / 说明 / 状态 chip）、`gap: 16px`、`min-height: 44px`、`padding: 8px 0`；行间 1px `--line-soft`、最后一行无 | §8.11.3 四列 | `getComputedStyle().gridTemplateColumns` |
| ✅ N11 | 设置行单行高 **44px**、两行 **56px**；超过 56px 则说明截断为 2 行 + `…` 且 `title` 存在 | §8.11.3 行高 | 注入长说明文本后测行高 |
| ✅ N12 | `.settings-chip` 高 **18px**（≤20px）+ **`--r-full`** 胶囊形（Δ10）+ 文字 **`--text-2`**（Δ11，raised 上 `--text-3` 仅 3.96:1 不可用）+ `padding: 0 6px`；4 个变体的底/边/字色符合 §8.11.3 表；**chip 不得使用 `--beam` 底**（§4.2 配额）；**文案不含连接状态词** | §4.1 对比度层级 + §4.2 beam 配额 + UX_SPEC F-7 | 计算样式 + 文本搜索 |
| ✅ N13 | `.settings-search` 在**导航列顶部**，高 **28px**、**实边 1px `--line-strong`**、`--r-2`、**纯输入框无图标**、左对齐 —— 与标题栏 `.search-capsule`（胶囊形 + `--line-hair` 边 + 图标 + 居中）在形状/边色/内容上均不同；`.settings-section-title` = **12px/500 `--text-2`** + 1px `--line-hair` 下沿（Δ9） | §8.11.3 搜索框需与标题栏区分 | 计算样式对比 |
| ✅ N14 | 活动带头部高 **32px**；tab 选中 = 底部 2px `--beam` 下划线；实例区 `margin-left: auto` 且与 tab 区**无竖线** | §8.11.4 活动带与终端实例 | 计算样式 + DOM |
| ✅ N15 | `.term-instance` 高 **22px**；当前实例 `.is-current` = `--beam-wash` 底 + `--beam` 边；✕ hover 才显现（`opacity 0→1`）且 `:focus-within` 时常显；`.is-pending` 的 6px 点**静态不脉冲** | §5.6 状态需文字 + §5.5 状态点静态 | 计算样式 + `getAnimations()` |
| ✅ N16 | 实例过多时 `.term-instances` 横向滚动 + 滚动条隐藏 + 右端 `+N` 计数；**不得出现「收起实例」类折叠控件** | §8.11.4 入口不消失 | DOM + 注入多实例 |
| ✅ N17 | `.path-dialog` 宽 **480px**（≤560px）+ 圆角 **`--r-3`**（Δ15）+ **模态**（遮罩存在 + 焦点陷阱：Tab 循环不逃出）；输入框高 **28px** mono **11px**（Δ16）、最近项行高 **28px**；`.path-dialog-error` = 左 2px `--danger` 竖条 + `padding-left: 8px` + 文字 `--text-2`（Δ17）；**不得出现 rainbow/spectrum** | §9.7 H2 浮层宽度 + §4.3 spectrum 只允许 1 处 + UX_SPEC F-1 | 交互测试 + 计算样式 |
| ✅ N18 | `.jump-line-pop` 宽 **240px** + 圆角 **`--r-3`**（Δ18）+ **非模态**（无遮罩）+ 锚定**舞台左下角**（左 16px、底 16px，Δ19）；输入 28px mono；`Esc` 后焦点回触发元素 | §8.11.5 + H-8 焦点归还 + UX_SPEC F-2 | 交互测试 + `getBoundingClientRect()` |
| ✅ N19 | `.outline-pop` 宽 **320px**（Δ20）+ 圆角 `--r-3` + `max-height: 320px`；列表行高 **28px**（≤44px，H4）；**无符号图标**（Δ21）；符号名 mono 10.5px `--text-1`；层级用缩进（12px/级）表达；**条目 ≤ 200**（H1） | §8.11.5 + §9.7 H1/H4 + UX_SPEC F-3 | DOM + 计算样式 |
| ✅ N20 | `.toast-stack` 定位 **`right: 16px; top: 76px`**（右上角，Δ25）、容器宽 320px；单个 toast 宽 320px + 左 2px 状态竖条；**只含动作按钮**、**不含连接状态陈述**（与 §9.6 G12 联动：全屏「内核未连接 / 离线夹具」出现次数仍 = 1） | §4.3 R-CONN-1 连接状态唯一 + UX_SPEC F-4 行为约束 | 计算样式 + 全屏文本搜索 |
| ✅ N21 | toast **5s** 自动消失，淡出 **≤ 640ms**；`prefers-reduced-motion` 下**直接消失但仍停留 5s**（无渐变、无位移） | §5.1 淡出 ≤ 640ms + §5.6 降级 | 计时 + reduced-motion 截图 |

| ✅ N24 | `.conn-retry-menu` 宽 **200px**（≤560px，H2）、底 `--surface-float`、圆角 `--r-3`、边 `--line-strong`；**恒定只有一项**「重试连接」（30px，12px `--text-2`）；**菜单内不出现任何连接状态词**（G15） | §8.11.6 + §9.7 H2 | 计算样式 + 文本搜索 |
| ✅ N25 | 状态栏连接指示器：**断连态** = `role="button"` + `aria-haspopup="menu"` + 可点展开菜单；**正常态** = **无 button 语义、无 `tabindex`、点击不展开任何菜单**（不存在死控件，H-2）；`Esc` 关闭后焦点还给指示器（H-8） | §8.11.6 + H-2 + H-8 | 交互测试 + DOM 属性检查 |
| ✅ N26 | `.toast-stack` 定位 **`right: 16px; top: 76px`**（Δ25）、宽 320px；toast 底 `--surface-float`、圆角 `--r-3`、左 2px 状态竖条；标题 `--fs-body` 13px/600 `--text-1` + 描述 `--fs-body-sm` 12px **`--text-2`**（Δ22）；**只含动作按钮**、**不含连接状态陈述**（与 G15 联动）；**不得压住控制台 composer 的发送按钮**（右下角会压 —— 这是选右上角的原因） | §4.3 R-CONN-1 + §4.1 对比度层级 + UX_SPEC F-4 行为约束 | 计算样式 + 全屏文本搜索 |
| ✅ N27 | `.toast-stack` 进入 `--t-base` 180ms `--ease-enter`、退出 `--t-fast` 120ms `--ease-exit`（Δ23）、5s 自动消失、**可手动关**；`role="alert"` + `aria-live="assertive"`（Δ24）；reduced-motion 下**直接消失但仍停留 5s** | §5.1 动效档位 + §5.6 降级 + UX_SPEC F-4 | 计时 + DOM 属性检查 + reduced-motion 截图 |
| ✅ N29 | **toast 与控制台 composer 发送按钮不重叠**：`.toast-stack` 的 `getBoundingClientRect()` 与 `.send-btn` 的矩形**不相交**（coding 模式，toast 存在时测） | UX_SPEC F-4 行为约束（右上角不得压主操作区） | 取两个元素的矩形做相交判定 |
| ✅ N28 | `.activity-handle` 高 **8px**（≤32px）、图标 **14px `--text-2`**（Δ26）、底 `--surface-chrome` + 上边线 1px `--line-hair`；**不得出现 beam 实心块**（§4.2 配额） | UX_SPEC F-6 + §4.2 beam 配额 | 计算样式 |
### 9.11 折叠把手与 goal 的互斥（裁定 1 专项，共 2 条）

| # | 判据 | 治理依据 | 测量方法 |
|---|---|---|
| ✅ N22 | **goal 模式**下 `.activity-strip` 与 `.activity-handle` **元素数均为 0**；`.term-host` 不存在（与 §9.5 F7 同源） | §7.3 / §8.11.7 goal 整块不渲染 + F7 | DOM 查询 |
| ✅ N23 | **deepsleep / coding / helping / IDE** 模式下，折叠后 `.activity-handle` **仍在 DOM 里**、**可点击**、**可键盘聚焦**（`tabindex` + `role="button"` + `aria-label` 齐全），高度 = 8px | §8.11.7 把手条 + 键盘可达 | DOM + 键盘测试 |

### 9.12 语义诚实性专项（内核语义核实后新增，共 15 条）

> 这 7 条针对「界面说了内核做不到的事」这一类问题。内核语义已核实（`clean_instance.rs` / `reminder.rs` / `mode.rs:152`），
> 界面必须与之一致。**凡是编出来的语义，判不通过。**

| # | 判据 | 治理依据 | 测量方法 |
|---|---|---|
| ✅ M1 | deepsleep 执行链标题**必须**是「进入休眠前的执行链 · N 步」；**全文不得出现**「休眠期间的执行链」 | §8.4.2 快照口径 | 文本搜索 + 截图 |
| ✅ M2 | deepsleep 执行链 **N = 0 时整块不渲染** —— DOM 中不存在该容器，**不得**出现空框 / 占位符 / 「暂无」 | §8.4.2 N=0 整块不渲染 | DOM 查询（空 transcript 场景） |
| ✅ M3 | deepsleep 视图**不存在** vitals 条（无 `usage` 事件 → 整条不渲染，不显示 0 / 破折号） | §8.4.2b + D-4b（deepsleep 无 usage） | DOM 查询 |
| ✅ M4 | 唤醒简报清单项**不含**文件图标 / 文件名 / ✓ 勾选框 / 「已修改」「改了」字样（条目是**沉淀的规则**，不是文件变更摘要） | §8.5.2 条目 = 规则不是文件变更 | 元素查询 + 文本搜索 |
| ✅ M5 | 唤醒简报**不含**任何编辑 / 删除 / 勾选控件（内核无修改 reminder 的请求） | §8.5.2 内核无修改 reminder 的请求 | DOM 查询：`.wake-card` 内无 `input` / `button[data-*=edit]` / checkbox |
| ✅ M6 | 唤醒简报三态正确：`null` → **无卡片** + 请求按钮；**空数组** → 有卡片但**无「恢复会话」按钮**；有规则 → 完整形态（含两个按钮） | §8.5.1b 三态 | 三态分别构造后 DOM 断言 |
| ✅ M7 | goal 目标状态条显示 chip「**你的陈述**」；全文**不得出现**「内核已设定目标」「内核已确认目标」「内核已设定」等暗示内核持有状态的措辞；goal 模式下 composer 与 3 个起步句 chip **照常渲染** | §8.2.3 诚实口径（内核不持有目标） | 文本搜索 + DOM 查询 |
| ✅ M8 | **deepsleep 层不存在任何进度性表达**：「正在分析…」「等待消化…」「复盘中…」「消化中…」等文案节点、进度条、骨架屏、旋转指示器 —— **内核确实没在跑，画转圈就是在编**。允许的只有 12s 呼吸光晕 + 4s/行的睡 log（**时间流逝 ≠ 工作进度**） | §5.5 X9 禁令 | DOM 查询 + 文本搜索 + `getAnimations()`（`iterations===Infinity` 的元素数 ≤ 1） |
| ✅ M9 | 唤醒简报徽章文案 == **W4** 的权威值（`wake.badge`）；**不得**是「已提交新规则」（暗示休眠期有新规则被写入，而内核实际是模型在**之前的普通轮次**里调 `reminder` 写入） | §8.5.2 徽章诚实性 + §8.12 W4 | 运行时 DOM 取徽章文本，与 §8.12 W4 行的权威值**逐字比对**（中英文各切一次语言） |
| ✅ **M16** | **规范自检：W1–W11 每条文案的权威值在 `DESIGN_SYSTEM.md` 中只出现在 §8.12 权威表的对应单元格一次。** 其它章节只能引用编号 `W1`…`W11`，**不得抄写全文** —— 抄一遍就会漂一次 | §8.12 权威文案表（全队唯一来源）+ M-0 的同源精神 | **（规范自检，非 L1 DOM 断言）** 解析 `DESIGN_SYSTEM.md` 的表格单元格，对每条 W 的中/英文值做**整格精确匹配**，命中格数必须 **= 1**。**注意用整格匹配而非子串匹配** —— W4「当前生效的规则」是 W11「请求内核列出当前生效的规则」的子串，子串匹配会误报 |
| ✅ **M15** | **运行时可见文本中不得出现 i18n 兜底文案**：「内容暂不可用」/ "Content unavailable" —— 这是 **key 没接上**的信号（`t()` 落到 fallback）。命中数 = 0，中英文分别跑 | `i18n.ts` 的 fallback 行为（`t()` 找不到 key 时返回 `common.contentUnavailable`）+ §8.12 W3 不改名的理由 | 遍历**可见**文本节点做正则；**中英文各切一次语言**再跑一遍 |
| ✅ **M10** | **全屏可见文本中，不得出现禁用措辞**（§8.12.1）：中文 9 词 + **英文并集 12 词**（大小写不敏感）。中英文**分别**做正则匹配，**命中数 = 0** | §8.12.1 全局禁用措辞（三类 · 英文取并集，**断言宁可多查**） | 遍历**运行时 DOM** 的可见文本节点做正则匹配（**不查规范文档**）；中英文各跑一次，**每种模式各跑一遍** |
| ✅ M12 | **睡 log 只显示时间，不显示任何执行记录** —— `.sleep-log` 每行必须**完整匹配**中文正则 `^已归档( · \d{2}:\d{2})?$` 或英文正则 `^Archived( · \d{2}:\d{2})?$`（二选一）；**不得**出现工具名、文件名、`ok`/`blocked` 状态或任何来自 transcript 的文本。首行 = `已归档`（W8），说明行 = W9 全文（说明行**不在** `.sleep-log` 行内，单独断言） | §5.4 睡 log 内容（墙钟时刻，非时长）+ §8.12 W8/W9 | 取 `.sleep-log` 的行文本逐行正则**全匹配**（不是包含匹配）；再断言行文本集合与 `items` 的文本集合**无交集**；并断言 `HH:MM` 是**墙钟**（与系统当前时间差 ≤ 1 分钟）而非时长 |
| ✅ M13 | §8.12.1b 的 **19 条 i18n 残留**（18 条改写 + 1 条死键删除）全部处理（逐条比对，中英文分别） | §8.12.1b i18n 残留对照表 | 读 `i18n.ts` 的中英文两套字典，逐 key 与权威表**逐字比对**；并断言 `mode.hint.deepsleep` **已不存在** |
| ✅ M14 | `.sleep-meta` **只有 1 个 chip**（`deepsleep.pause`）；`deepsleep.quiet` 与 `deepsleep.sleeping` **不渲染** | §8.12.1c `.sleep-meta` 精简 | DOM 计数 `.sleep-meta` 的子项数 = 1 |
| ✅ M11 | §8.12 权威文案表 **W1–W11** 逐条落实 —— **中英文都与表内逐字一致**；且**每条文案在运行时只出现一次**（同一条文案在两个 surface 出现 = 同一事实两个来源，与 §4.3 R-CONN-1 / H-3 同类） | §8.12 权威文案表（全队唯一来源）+ §4.3 单一真相 | 逐条取渲染文本与表内字符串**逐字比对**（中英文各切一次语言）；再对每条文案做**全屏出现次数计数 = 1** |

---

## 附录 A · Token 变更表

> 施工时按此表逐条改 `ui/src/styles.css` 的 `:root` 与各模式覆写块。

### A.1 删除

| token / 规则 | 位置 | 原因 |
|---|---|---|
| `--font-display` | `:root` L22 | 中文回退陷阱；被 `--font-wordmark` 取代 |
| `--living-opacity`（`:root` 定义） | `:root` L37 | 与 `.app-shell` 重复定义 |
| `--spectrum-living` | `:root` L18 | LivingCore 删除后无使用者 |
| `--spectrum-living-b` | `:root` L19 | 同上 |
| `--living-size` | `:root` L30 + 5 个模式覆写 | 光晕尺寸不再由 CSS 变量控制 |
| `--living-amp` | `:root` L36 | 仅用于 `prefers-contrast` 覆写，随 `.living-core` 删除 |
| `.living-core` / `.living-eye` / `.living-bloom` / `.living-highlight` | L125–162 | 品牌图形分裂 → 改为 `.living-halo` |
| `.dial` / `.menu-dial` 旧规则 | L852–857 / L881–886 | 改为统一 `.dial` + `.dial-cell` |
| `.goal-brand` / `.goal-wordmark` / `.goal-sub` | L771–775 | 目标视图品牌块删除 |
| `.goal-templates` / `.goal-template` | L1152–1156 | 三张巨型卡片 → 起步句 chip |
| `.intent-chips` / `.intent-chip` | L1160–1162 | 假功能删除 |
| `.ai-demo-tag` / `.demo-source-tag` / `.tool-card-demo-prefix` | L938–942 / L1125 | 连接状态全局唯一 |
| `.path-input` | L393–399 | 手输路径不是主交互 |
| `.activity-bar` / `.activity-item` / `.activity-group` / `.activity-brand` | L334–351 | 图标活动栏删除 |
| `.title-menus` / `.title-menu-wrap` / `.title-menu-btn` / `.chrome-menu*` | L212–240 | 标题栏菜单栏删除 |
| `.panel-tab` 的 `<span>` 用法 | `workspace.tsx` | 改为真按钮 |

### A.2 新增

| token | 值 | 用途 |
|---|---|---|
| `--font-wordmark` | `'Instrument Serif',Georgia,serif` | 仅拉丁字标 |
| `--surface-rail` | `#141414` | 左栏视图切换头部 |
| `--focus-ring` | `0 0 0 2px var(--surface-void), 0 0 0 4px var(--beam)` | 全局焦点环 |
| `--fs-hero` … `--fs-num` | 见 §3.3 | type scale |
| `--t-instant` | `80ms` | 极快反馈 |
| `--t-ambient` | `5.2s`（按模式覆写） | LIVING 呼吸 |
| `--ease-enter` | `cubic-bezier(.16,1,.3,1)` | 进入（原 `--ease-out` 改名） |
| `--ease-move` | `cubic-bezier(.22,.8,.2,1)` | 位移（原 `--ease` 改名） |
| `--ease-exit` | `cubic-bezier(.4,0,1,1)` | 退出 |
| `--dial-cell-w` | `3px`（md 为 4px） | 刻度格宽 |
| `--dial-gap` | `2px` | 刻度格间距 |
| `--vitals-h` | `26px` | vitals 条高 |

### A.3 修改

| token | 现值 | 新值 | 原因 |
|---|---|---|---|
| `--font-ui` | `'IBM Plex Sans','Microsoft YaHei UI','Microsoft YaHei','PingFang SC','Noto Sans CJK SC',sans-serif` | `'IBM Plex Sans','PingFang SC','Microsoft YaHei UI','Microsoft YaHei','Noto Sans CJK SC',sans-serif` | macOS 优先 PingFang，Windows 优先雅黑 |
| `--beam-wash` | `rgba(207,224,240,.10)` | `rgba(207,224,240,.07)` | 激活态底色过亮，压低 |
| `--beam-wash-2` | `rgba(207,224,240,.055)` | `rgba(207,224,240,.045)` | 同上 |
| `--t-base` | `160ms` | `180ms` | 进入动画略慢，抑制突兀 |
| `--t-slow` | `480ms` | `560ms` | 遮罩淡入更柔 |
| `--presence`（各模式） | `0 / .12 / .30 / .45 / .70 / .90` | `0 / .20 / .40 / .60 / .80 / 1.00` | 等分，与刻度格一一对应 |
| `--living-rate`（各模式） | `0s/0s/40s/60s/24s/48s` | `12s(deepsleep) / 10s(helping) / 9s(advisor) / 5.2s(coding) / 8s(goal)` | 与 §5.4 的低频方案一致 |
| `--living-opacity`（各模式覆写） | `mode-ide`/`mode-deepsleep` 强制 0 | **删除** | deepsleep 需要低频存在感 |
| `--spectrum` 使用点 | 8 条规则 / 9 个选择器 | 1 处（`.app-shell::after`） | §4.3 |
| `--ease` / `--ease-out` / `--ease-in-out` | 存在 | 改名 `--ease-move` / `--ease-enter` / 保留 `--ease-in-out` | 语义化 |
| `--line-beam` | `#68788A` | 保留 | 用于焦点环外圈与单色顶条 |
| `.app-shell` grid rows | `36px 32px minmax(0,1fr) 24px` | `36px 28px minmax(0,1fr) 24px` | 会话带 32→28 |
| `.app-shell::before` inset | `68px 0 24px 0` | `64px 0 24px 0` | 随会话带高度变化 |
| `.app-shell::after` | 2px spectrum，`opacity: var(--living-opacity)` | 2px spectrum，`opacity: var(--living-gain)` | 脉冲带只在事件时出现 |
| `.pane-head` height | `34px` | `32px` | 密度收敛 |
| `.workspace` `--left-w` | `240px` | `268px` | 容纳会话胶囊与更宽的树 |
| `.workspace` `--right-w` | `366px` | `360px` | 整十 |
| `.workspace` `--term-h` | `206px` | `--activity-h: 176px` | 命名与数值 |
| `.goal-template` min-height | `88px` | — （删除） | §8.2 |
| `.empty-state` 棱镜 | 每个空态 | 仅 `first` 变体 | §8.10 |

### A.4 新增 DOM 类名清单（§8.11 全部形态，Phase 3 直接用）

> 与 `UX_SPEC.md` 附录 A 的类名清单**保持一致**。本清单是 §9.10 / §9.11 断言所依赖的选择器来源。

| 归属 | 类名 |
|---|---|
| 左栏头部 | `.left-rail-head`、`.view-seg`、`.view-seg-item`、`.rail-settings` |
| 模式菜单 | `.mode-menu-pending`、`.mode-menu-error` |
| 设置页 | `.settings-page`、`.settings-nav`、`.settings-nav-item`、`.settings-search`、`.settings-section`、`.settings-section-title`、`.settings-row`、`.settings-chip` |
| 活动带 | `.activity-strip`、`.activity-handle`、`.term-instances`、`.term-instance`、`.term-instance-rename` |
| 浮层 | `.path-dialog`、`.path-dialog-input`、`.path-dialog-error`、`.jump-line-pop`、`.outline-pop`、`.conn-retry-menu` |
| Toast | `.toast-stack` |
| deepsleep | `.deepsleep-chain`（§8.4.2，N=0 时不渲染） |

---

## 附录 A′ · 2026-11 工艺级精造（本轮变更）

> 本轮不推翻 v1.0 身份，只把可读性、节奏与窄窗行为做实。审计脚本：
> `ui-design/scripts/audit_ui.py`；证据与逐条记录见 `ui-design/worklog.md`。

### A′.1 token

| token | 现值 | 新值 | 依据 |
|---|---|---|---|
| `--text-3` | `#8C8C8C` | `#949494` | 全部 surface ≥4.5:1（最低 float 4.86），承担全部辅助文本 |
| `--text-4` | `#6E6E6E` | `#7E7E7E` | 只承担 disabled / 装饰；不得放语义文案 |
| `--fs-mono` | `11.5px` | `12px` | 去掉半点字号；与 `--fs-body-sm` 同档 |
| `--sp-1 … --sp-16` | 无（散落 px） | 2/4/6/8/12/16/24/32（`--sp-5` = 10px 兼容别名） | 2px 光学半步 + 8px 节奏；组件不再写裸间距。**不得**整体放大一档：`--sp-6` 必须是 12px，否则左栏头部与树工具行会被裁切 |
| `--dial-gap` | `var(--sp-1)` | `2px` | 刻度器总宽锁回 23px / 28px（§8.2） |

### A′.2 行为/尺寸

| 项 | 现值 | 新值 | 依据 |
|---|---|---|---|
| 窗口最小内尺寸 | `960×620` | `760×560` | 窄窗可用；UI 在 760 验证无横向滚动 |
| `--right-w` ≤1040px | 用户宽度 | `min(320px, 用户宽度)` | 编辑区不再被挤到不可读 |
| `--right-w` ≤880px | 列 | `0`（覆盖式浮层，右栏铺满树右侧） | 窄窗下会话面板不再压扁编辑器 |
| 标题栏搜索胶囊 ≤880px | 200px 起 | 26px 图标宽，聚焦展开 220px | 标题栏不溢出 |
| 会话胶囊 ≤880px | 常驻 | 隐藏（`Shift+@+S` / 命令面板仍可开） | 标题栏让位给搜索与窗口控件 |

### A′.3 项目列的自适应（按列宽，不按窗口宽）

左栏宽度由用户拖动决定（200–460px），所以它的 chrome 不能只靠 viewport 媒体查询：
`App.tsx` 由 `sizes.left` 派生 `rail-tight`（<248px）与 `rail-tighter`（<216px），
CSS 据此收紧头部 padding / 段间距 / 树工具行间距。

| 列宽 | 表现 |
|---|---|
| ≥248px | 设计值：`--sp-6` 内边距、8px 头部间距；三段文字 + 齿轮 + 7 个树动作全部可见 |
| 216–247px | 段与头部的水平 padding 收到 6px，树工具行 gap 收到 2px；文字不省略 |
| 200–215px | 再收到 4px/2px；齿轮分隔线隐藏；树标题「资源管理器」按 `text-overflow: ellipsis` 收缩，动作按钮一个不少 |

约束：三段视图切换器**始终保留文字**（§8.11.1 N2）；收缩只发生在 padding 与标题，不隐藏功能。

### A′.4 状态是标签块，不是色点

标题栏与状态栏不再用「圆点 + 文字」表达状态——单独一个点只有读懂颜色才知道含义。规则：

| 位置 | 形态 | 文字随状态变化 |
|---|---|---|
| 会话切换（标题栏） | 24px 边框块（`--surface-inset` + 1px `--line-hair`），打开时 `--beam-wash` + `--line-beam` + 频谱下划线 | 会话名 + 数量 |
| 传输状态（状态栏） | 16px 圆角块，底色为该状态色 12–14% 的混合，文字用同一状态色 | 内核已连接 / 演示模型 / 连接中 / 未连接 |
| 运行状态（AI 头） | 18px 圆角块，`--beam` 10% 底；awaiting 用 warn、blocked 用 danger 的 16% 底 | 正在运行 / 等待确认 / 被拦截 |

色块只是辅助信号，文字必须能独立说明状态；`conn-dot` / `.session-switcher .tab-dot` / `.running-pill i` 已删除。
Review 画布的「sample」角标是 `position: absolute`，其容器 `.review-canvas` 必须是 `position: relative`，
否则绝对定位会锚到滚动容器之外并被 `overflow: auto` 裁掉。

### A′.5 浮起层级与浮动曲率

| token | 值 | 用途 |
|---|---|---|
| `--elev-1` | `0 1px 2px rgba(0,0,0,.28), 0 4px 12px rgba(0,0,0,.26)` | 抬起的输入托盘（composer / goal input）、hero 图标砖 |
| `--elev-2` | `0 2px 8px rgba(0,0,0,.35), 0 18px 46px rgba(0,0,0,.52)` | 锚定浮层：菜单、popover、上下文菜单、doc picker、help |
| `--elev-3` | `0 4px 14px rgba(0,0,0,.40), 0 34px 90px rgba(0,0,0,.70)` | 模态：palette、model modal、path dialog、save prompt、toast |
| `--rim-top` | `inset 0 1px 0 rgba(255,255,255,.055)` | 浮层顶缘受光（代替彩色光晕） |

- 每级都是「接触阴影 + 环境阴影」两层：只有一层时物体贴地，两层才读作离开页面。
- 几何：浮动表面半径升一档（小浮层 8px、大浮层 12px），曲率 `superellipse(3)`（§4.1.1 例外）。
- 落地：`styles.css` 末尾「floating layer」块 + `polish.css` §14；阴影只用中性黑，禁止彩色光晕。
- 输入托盘从「内凹井」（`--surface-inset` + inset 阴影）改为「浮起托盘」（`--surface-raised` + `--elev-1`）。

---

## 附录 A″ · 2026-11 第二轮：Night Foundry

> **已被 A‴（VOID）取代**：暖石墨 + 琥珀被用户判定「更 AI 味」，色板以 A‴ 为准；
> 本附录仅保留为设计过程记录。

> 用户判定第一轮「不够好」，授权换方向。本轮只改**气质层**：色板、字标、强调色分配、
> 编辑器/终端配色；信息架构、列宽、控件尺寸、交互与协议全部不变。

### A″.1 色板（实测最差对比度在 `--surface-float`）

| token | 值 | 对比度 | 用途 |
|---|---|---|---|
| `--surface-void` | `#100E0C` | — | 应用底 |
| `--surface-rail` | `#14110E` | — | 左栏头部 |
| `--surface-chrome` | `#191512` | — | 标题栏 / 状态栏 |
| `--surface-panel` | `#1C1814` | — | 面板 |
| `--surface-canvas` | `#1F1A16` | — | 编辑器画布（最亮的工作面） |
| `--surface-inset` | `#17130F` | — | 搜索框 / 输入井 |
| `--surface-raised` | `#272119` | — | 抬起托盘 / 按钮 / 输入块 |
| `--surface-float` | `#2D261C` | — | 浮层 |
| `--text-1` | `#F2EADC` | 12.51 | 正文 / 标题 |
| `--text-2` | `#CFC3AE` | 8.59 | 次级正文 |
| `--text-3` | `#A99B84` | 5.48 | 辅助文本（最低档） |
| `--text-4` | `#857862` | 3.46 | 仅装饰 / 禁用 |
| `--beam` | `#E5A64C` | 7.04 | 信号（见 A″.2） |
| `--beam-bright` | `#F4C77C` | 9.47 | 悬停 / 主按钮高光 |
| `--beam-dim` | `#B9863C` | 4.65 | 眉标 / 弱信号 |
| `--success` | `#93B98D` | 6.80 | 成功 |
| `--warn` | `#D9A65A` | 6.80 | 警告 |
| `--danger` | `#D47A6C` | 4.84 | 错误 |
| `--info` | `#8FAECB` | 6.46 | 信息 |

中性色全部带棕调（R>G>B），不再有 R=G=B 的冷灰；线色 `#2A2319 / #342C21 / #463B2C /
#6B5636` 同样偏暖。

### A″.2 琥珀配额（唯一饱和色）

琥珀只表达三件事：**当前选中**（模式刻度、页签顶线、树选中行、终端页签）、
**可执行**（主按钮、发送按钮、焦点环）、**存在**（LIVING 光晕、频谱带）。
其余一律石墨灰；每视口琥珀实心块 ≤2（主行动 + 发送），描边/下划线 ≤6。

模式强调色：coding = `--beam`，goal = `--beam-bright`，helping = `--success`，
advisor = `--warn`，deepsleep = `--accent-quiet`，IDE = `--info`。

### A″.3 字体与氛围

- 字标 `Instrument Serif` + 琥珀句点；眉标 `--font-mono` 10px / 0.18em / `--beam-dim`。
- 画布空态标题升到 `--fs-display`（26px），保持 text-1。
- `.app-shell` 左上角一盏 `rgba(229,166,76,.055)` 的径向灯，无网格、无噪点。
- Monaco 与 xterm 主题同步改为暖语法色（keyword `#8FAECB`、string `#A9BE8F`、
  number `#D9B98A`、type `#C9A9C4`；终端光标 `#E5A64C`）。

### A″.4 未改动

半径 / 间距阶梯、G2 曲率、浮起层级、动效档位、六模式矩阵、列宽与所有 E2E 断言。

---

## 附录 A‴ · 2026-11 第三轮：VOID（纯黑 + 中性灰 + 白信号）

> 取代 A″ 与 §4.1 的色板。结构、尺寸、交互、协议全部不变。

### A‴.1 色板（实测最差对比度在 `--surface-float`）

| token | 值 | 对比度 | 用途 |
|---|---|---|---|
| `--surface-void` / `--surface-canvas` | `#000000` | — | 应用底 / 编辑器画布（真黑） |
| `--surface-rail` | `#030303` | — | 左栏头部 |
| `--surface-chrome` | `#060606` | — | 标题栏 / 状态栏 |
| `--surface-panel` | `#0A0A0A` | — | 面板（只比黑亮一点） |
| `--surface-inset` | `#101010` | — | 输入井 |
| `--surface-raised` | `#161616` | — | 抬起托盘 / 按钮 |
| `--surface-float` | `#1D1D1D` | — | 浮层 |
| `--text-1` | `#F5F5F5` | 15.46 | 正文 / 标题 |
| `--text-2` | `#C4C4C4` | 9.67 | 次级正文 |
| `--text-3` | `#9C9C9C` | 6.14 | 辅助文本（最低档） |
| `--text-4` | `#747474` | 3.61 | 仅装饰 / 禁用 |
| `--beam` | `#FFFFFF` | 16.86 | 信号：当前 / 可执行 / 存在 |
| `--beam-dim` | `#B4B4B4` | 8.13 | 弱信号 / 眉标 |
| `--success` | `#7FBF8A` | 7.80 | 成功（仅状态） |
| `--warn` | `#D6A85C` | 7.72 | 警告（仅状态） |
| `--danger` | `#D06A6A` | 4.78 | 错误（仅状态） |
| `--info` | `#86A9C4` | 6.81 | 信息（仅状态） |

### A‴.2 颜色归属

界面本身**没有色相**：所有 chrome 都是黑 / 灰 / 白。彩色只允许出现在三处：
1. 棱镜图标（品牌资产）；
2. 频谱带（`--spectrum`，事件时出现）；
3. 代码语法色（Monaco / xterm / diff）。
加上语义色仅用于成功、警告、错误、信息四种状态，不得作装饰。

**白色配额**：每视口白色实心块 ≤2（主行动 + 发送）；白色描边/下划线 ≤6。
主按钮是纯白底 + 黑字；悬停保持纯白，不做渐变或彩色光晕。

### A‴.3 字体与几何

沿用第二轮：衬线字标 + 灰句点、眉标 `--font-mono` 10px / 0.18em / `--beam-dim`、
画布空态标题 `--fs-display` 26px、G2 曲率、浮起层级、2px 间距阶梯。
空态图标砖改为灰字灰底（chrome 不再带蓝）。

### A‴.4 编辑器与终端

Monaco：背景 `#000000`、前景 `#F5F5F5`、当前行 `#0A0A0A`、光标白色；**代码是唯一的彩色表面**：
keyword `#C792EA`、string `#A9E08F`、number `#F2A65A`、type `#F4D06F`、function `#7FB2FF`、
variable `#8FE3E0`、tag `#FF8A8A`、comment `#5F6672`（斜体）；选区 `#7FB2FF30`。
xterm：背景 `#000000`、前景 `#D8DEE9`、光标 `#FFFFFF`，ANSI 16 色改为同一套高饱和色。
文件树图标按类型着色（code/keyword 紫、config/amber、script/type 金、doc 灰）。

### A‴.5 构图层（本轮补齐）

颜色只是底座；本轮让界面**在结构上**区别于居中模板：

| 项 | 规则 |
|---|---|
| UI 字族 | `--font-ui` 优先 **Bahnschrift**（Windows 自带 DIN 字族），拉丁标签/数字为工程字体；中文回退雅黑 |
| 画布空态 | 左对齐「标题页」：40px 白色规线、`--fs-hero` 34px 标题、左对齐描述与动作、快捷键两列表（`1fr auto`）；左边距 `clamp(48px,10vw,168px)` |
| 搜索 | 无胶囊、无填充：1px 底划线，聚焦变白线；不再使用 `--focus-ring` 外环 |
| 控件圆角 | 主按钮 / 发送 / 次要按钮 / 会话块 = `--r-1`（3px）；浮层仍为 8–12px + `superellipse(3)`，形成「锐利控件 / 柔软浮层」的对比 |
| 树选中 | `rgba(255,255,255,.045)` 底 + `inset 2px 0 0 var(--beam)`；不使用彩色卡片竖条 |
| 页签激活 | 透明底 + `inset 0 2px 0 var(--beam)`；不靠色块 |

---

## 附录 B · 跨层依赖清单

> 这些是**内核 / 壳层必须先完成**的事项。Phase 3 的视觉落地依赖它们。
> 若某项在 Phase 3 前不可用，UI 必须按本规范给出的**降级行为**处理，**不得编造**。

| # | 依赖 | 归属 | UI 的降级行为（必须遵守） |
|---|---|---|---|
| B-1 | `ServerEvent::Usage { session, input_tokens, output_tokens, cached_tokens, elapsed_ms, tool_calls }`，每 round 一次，协议升 `v0.4` | `pristem-ipc` | 事件未到 → **vitals 条整条不渲染**，不显示 0 |
| B-2 | `fs.pickFolder` 弹**原生文件夹对话框**并返回选中路径；与 `fs.openFolder` 分离 | `pristem-desktop/shell/src/io.rs` | 壳层不支持 → 走**路径粘贴对话框**兜底（§8.6） |
| B-3 | 壳层**不再回显命令行**（删除 `pristem@workspace %`） | `shell/src/io.rs` | 未改前 → 终端会同时出现 `›` 与 `pristem@workspace %` 两套提示符（**必须先改壳层**） |
| B-4 | `term.run` 增加 `instance: u32`；`term.output` / `term.done` 回传同一 `instance` | `shell/src/io.rs` | 未支持 → **只显示 1 个终端实例**，不假装支持多实例 |
| B-5 | `fs.list` 支持 `path` 参数并返回相对路径（当前忽略 `path`） | `shell/src/io.rs` | 未支持 → 文件树**只展开 1 层**，目录项显示为不可展开（并给出说明） |
| B-6 | 内核上报 `provider_changed` / `providers`（已有事件），UI 读取真实 provider/模型名 | `pristem-ipc`（已有） | 无事件 → composer 脚部**不显示** provider 名称（不写死 `pristem-core`） |
| B-7 | 内核配置读写（设置页分区 1/3/4/5 的持久化） | `pristem-ipc` | 无接口 → 纯本地设置走 `localStorage`，内核相关项标注「本次会话有效」并**置灰** |
| B-8 | `fs.list` 响应带 `protocol` 字段（壳层取 `pristem_ipc::PROTOCOL_VERSION`，即 `pristem.ipc/v0.4`） | `pristem-desktop/shell/src/io.rs` | 无该字段 → 状态栏**不渲染**协议徽标（不写死版本号） |
| B-9 | `{"op":"shell.capabilities"}` —— 壳层能力探测（原生对话框 / 多终端 / 目录展开是否可用） | `pristem-desktop/shell/src/io.rs` | op 未知 → 视为**全部能力为 false**：单终端实例 + 粘贴对话框 + 文件树一层 |
| B-10 | `ServerEvent::Error` 带 `session: u64` | `pristem-ipc` | 错误按「pending 意图 + 当前活跃会话」匹配 |

> **B-7 本轮不做**（team-lead 裁定）：设置页的本地项走 `localStorage`；内核相关项按 §8.8.5 的降级矩阵标注「本次会话有效」并置灰。
>
> **B-9 ~ B-11 与交互层的完整降级矩阵见 `UX_SPEC.md` §8.3**（含每项「用户看到什么 / 能不能用 / 怎么提示」三列）。
> 两份文档的降级行为必须一致；冲突时以 `UX_SPEC.md` §8.3 为准（那是交互面），本文只约束视觉面（不渲染什么、留不留白）。

---

## 附录 B′ · 已由 team-lead 裁定的 5 条硬约束（Phase 2/3/验收共同输入）

> 以下 4 条在 Phase 1 规范中已定，Phase 2 裁定后**逐条升级为对全队的硬约束**。
> Phase 3 视觉验收（任务 #5）逐条实测。

| # | 硬约束 | 违反判定 |
|---|---|---|
| **D-1** | deepsleep 的**三条返回路径各自独立可用**：①「继续工作」按钮 ②状态栏模式控件 ③唤醒简报卡片上的「回到工作台」。**任何一条都不得依赖用户「知道 F2」**。「继续工作」必须发 `switch_mode` 走内核，**UI 不得自行 setMode**（既有架构约定） | 三条中任一条不可用 → 不通过 |
| **D-2** | `App.tsx` 的 `openFolderPicker` 空实现必须改为真发 IO；壳层 `fs.pickFolder` 必须与 `fs.openFolder` **分离**（现状合并 → pickFolder 收到空 path 后沿用旧 root，永远打不开新文件夹） | 点「打开文件夹」后无原生对话框且无路径对话框 → 不通过 |
| **D-3** | 终端实例字段名固定为 **`instance: u32`（默认 0）**，不是 `term_id: String`。**壳层未回传 `instance` 时 UI 只显示 1 个实例**，不假装支持多实例 | 出现多于 1 个实例但无 instance 回传 → 不通过 |
| **D-4** | `Usage` 事件字段集最终定为 `Usage { session, input_tokens, output_tokens, cached_tokens, elapsed_ms, tool_calls: u32 }`（**不含** `provider`/`model`——那两项由 `provider_changed`/`providers` 事件提供，避免同一事实两个来源）。**每 round 一次，紧邻 `finished` 之前发出**。UI 侧：无该事件时 **vitals 条整条不渲染**（不显示 0、不显示占位符） | 无 usage 事件却显示 0 / 破折号 / 占位符 → 不通过 |
| **D-5** | 状态栏协议徽标**必须读 `fs.list` 响应的 `protocol` 字段**，前端源码中**不得出现硬编码版本号字符串** | UI 源码出现 `'pristem.ipc/v0.` 字面量 → 不通过 |

---

## 附录 C · 施工顺序建议（Phase 3 参考）

1. **token 层**（附录 A）→ 2. **字体系统**（§3）→ 3. **刻度器组件**（§6）→ 4. **品牌收敛**（§2）
→ 5. **布局骨架**（§7）→ 6. **控制台/目标/唤醒简报**（§8.1–8.5）
→ 7. **终端**（§8.9，需 B-3/B-4）→ 8. **设置页**（§8.8）→ 9. **用量与执行链**（§8.7，需 B-1）
→ 10. **验收脚本**（§9，扩 `.visual-check/check.cjs`）。

---

*本文档为 pristem 桌面端视觉方向的唯一权威来源。任何与本文冲突的实现视为缺陷，不视为设计选择。*
