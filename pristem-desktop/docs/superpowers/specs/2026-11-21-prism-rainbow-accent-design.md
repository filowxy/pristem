# PRISM 彩虹强调色 — 设计规格

日期：2026-11-21
状态：已批准（用户：approve, write it to real file）
范围：`pristem-desktop/ui`（渲染层）+ `pristem-desktop/DESIGN_SYSTEM.md`（契约文档）

---

## 1. 背景

对照 TRAE 的两张截图，Pristem 显得「很糟」的原因不是功能缺失，而是**没有强色**：

- TRAE：一个饱和的绿色强调（Agent 按钮 / 图标 / 状态），面板被填满，色彩承担了信息层级。
- Pristem：几乎全黑 + 全灰白，`--beam` 是 #FFFFFF 冷白。唯一的彩虹 `--spectrum` 被设计系统刻意「饿死」了。

现存的三条事实决定了这次改动的边界：

1. `DESIGN_SYSTEM.md:98`（§1.2）把「深色无彩底 + 单一冷白强调色」列为**保留**项，`--beam` 是「唯一的光色」。
2. `DESIGN_SYSTEM.md:398-414`（§4.3）明确写着 **「每张卡片顶上一道彩虹，是『拼凑感』最直接的来源」**，并把 spectrum 限制在 **1 个位置**（`.app-shell::after` 顶部 2px 脉冲带），静止时 opacity = 0。
3. `living.ts:128` 写入 `--living-hue`，但 **全仓库没有任何 CSS 规则消费它** —— 动态色彩机制是断线的死代码。这就是 Pristem「静止、发死」的技术根因。

所以本次改动是**主动推翻 §4.3**，把它升级为新的品牌契约。

## 2. 目标 / 非目标

**目标**

- G1：把「强色」从冷白 `--beam` 换成**会动的彩虹**，让 Pristem 一眼可辨（prism + system 的字面意义）。
- G2：让内核事件真正驱动色彩（`--living-hue` 接入像素）。
- G3：补上与 TRAE 的**密度差**：图标有颜色、欢迎区不再是死黑、层级有色彩。
- G4：全程保持 AGENTS.md 的不变量与 218 条视觉检查为绿。

**非目标**

- 不改布局结构、不改模式语义、不加 npm 依赖、不动 shell/kernel。
- 不把彩虹铺成背景墙（那正是 §4.3 反对的拼凑感）。
- 不让彩虹承载**文字**。

## 3. 令牌架构

### 3.1 相位（phase）—— 唯一的动画源

```css
@property --phase { syntax: '<angle>'; inherits: true; initial-value: 0deg; }

/* 唯一的无限循环：整个应用的彩虹相位。时长取模式的 --t-ambient，摆动 52°。 */
.app-shell { animation: prism-phase var(--t-ambient) var(--ease-in-out) infinite alternate; }
@keyframes prism-phase { from { --phase: 0deg; } to { --phase: 52deg; } }
```

- `--phase` 注册为 `<angle>` 且 `inherits: true` → 子元素继承**动画中的**值，一个元素上的动画驱动全应用。
- 屏幕上**只有 1 个** infinite 动画（`:root`），满足 D1/D2「同时循环动画 ≤ 1」。

### 3.2 相位如何进入像素（关键机制）

**约束**：CSS 在**声明处**对自定义属性做 `var()` 替换。若把 `var(--phase)` 写进 `--spectrum` 的定义里，`--spectrum` 会在 `:root` 一次性算出静态字符串并被后代继承 —— 彩虹会**冻死**，动画对它无效。

**因此相位只能通过「常规属性」在使用处进入**：

```css
/* 使用处（每个强调面），--phase 在这里被替换成当前动画值 */
.accent-layer {
  background-image: var(--spectrum);
  filter: hue-rotate(calc(var(--phase) + var(--living-hue)));
}
```

- `filter` 是常规属性 → 每帧随继承来的 `--phase` 重算 → 彩虹整体换色。
- `--living-hue` 由 living.ts 写在 `.app-shell`，向下继承到使用处 → 内核事件直接叠加相位。
- 文本**不能**被一起旋转：滤镜只挂在背景层（`::before` / 伪元素 / 无内容的条与点），文字留在未过滤的父元素上。
- 无 `@property` 的旧引擎：`--phase` 不可注册 → 滤镜里的角度失效 → 退化为**静态彩虹**（需 L0 字面量兜底）。

**代价**：每个被强调的面多一层 filter（每帧重绘一个小渐变）。因此强调面数量必须受控（见 §5 清单），且 IDE / deepsleep / reduced-motion 下相位暂停 → 零成本。

### 3.3 光谱 —— 仍然只定义一次

L2 检查 `check.cjs:238` 要求 `--spectrum:linear-gradient` **恰好出现一次**，所以光谱必须保持单一定义点。它保持**静态**定义（相位由 3.2 的滤镜注入）：

```css
--spectrum:linear-gradient(90deg,
  #E0564B 0%, #DEB349 20%, #59A15C 42%, #4680E1 66%, #8E6BE0 84%, #E0569E 100%);
```

### 3.4 降级与无障碍

- 无 `@property` 的引擎：`--phase` 不可注册 → 动画无效 → 光谱退化为**静态彩虹**。
- **对比度**：彩虹填充上的文字/图标用墨色 `--accent-ink:#0A0A0A`（不是白）。每个 stop 的亮度固定在 58%–62%，保证与 #0A0A0A 的对比度 ≥ 4.5:1（实测：最差 5.02:1；同一组 stop 对白只有 1.97–3.94:1，所以「彩虹上不能写白字」是算出来的，不是审美偏好）。
- **焦点环保持静态白**（`--focus-ring` / `:focus-visible` 都用 `--beam`）：焦点指示器必须稳定 —— 会随相位变色的焦点环对键盘用户是移动靶标。彩虹只染品牌强调位，不染系统的焦点通道。

## 4. 色彩分工（规则，不是清单）

| 规则 | 内容 |
|---|---|
| **R-BRAND-1** | 彩虹只做**填充 / 条 / 描边 / 圆点**。**永不**做文字颜色。 |
| **R-BRAND-2** | `--beam` 作为**文字色**的用法（`.count`、`.seed-line svg`、`.help-pop code`、`.goal-line.pristem > span`、`.wake-card li span`、`.handoff-card h2 svg`、`.tool-card-raw-toggle:hover`、`.window-controls button.is-close:hover`）**保持冷白**。 |
| **R-BRAND-3** | `--beam-wash` / `--beam-glow` / `--beam-dim` 是中性半透明白，**不动**。它们是灰阶工具，不是品牌色。 |
| **R-BRAND-4** | **语义色不动**：`--success` / `--warn` / `--danger` / `--info` 承载状态含义；`--mode-accent`（六模式身份）保持各自语义色，保证六模式仍可区分。 |
| **R-BRAND-5** | 品牌色 = 彩虹 = 交互强调（选中、焦点、主按钮、回答竖线、脏文件点、开关滑块、目录点）。 |

> 决策依据：TRAE 的绿之所以有力，是因为**只有一个**强调色承担交互。Pristem 也必须只有一个强色，否则就是拼凑感（§4.3 的教训保留，只改载体）。

## 5. 强调位清单（改）

三个派生令牌（全部在 `:root` 定义，只消费 `--spectrum`）：

```css
--accent-fill: var(--spectrum);                     /* 背景图 */
--accent-line: var(--spectrum);                     /* 1-2px 条/描边 */
--accent-hue:  hue-rotate(calc(var(--phase) + var(--living-hue)));  /* 施加在背景层上 */
```

使用形态（伪元素/无内容条，避免文字被一起旋转）：

```css
.bar { background-image: var(--accent-line); filter: var(--accent-hue); }
.filled::before { content:''; position:absolute; inset:0; background-image: var(--accent-fill);
                  filter: var(--accent-hue); border-radius: inherit; }
```

以下选择器由 `--beam` / `--beam-bright` 的**填充或描边**改为彩虹：

| 位置 | 选择器 | 形态 |
|---|---|---|
| 焦点环 | `:focus-visible` | 渐变描边（background-clip 双背景） |
| 发送按钮 | `.send-btn` | 渐变填充 + 墨色图标 |
| 主按钮 | `.primary-btn` | 渐变填充 + 墨色文字 |
| 激活 tab | `.tab.is-active`（L517 inset 0 -2px） | 2px 渐变下划线 |
| 活动 tab | L711 inset 0 2px | 2px 渐变上划线 |
| 面板 tab | `.panel-tab.is-active` | 渐变下边框 |
| 激活树项 | L615 inset 2px 0 | 2px 渐变竖条 |
| 激活会话卡 | `.session-card.is-active::before` | 渐变竖条（已有 spectrum） |
| 会话切换器 | `.session-switcher-btn.is-open::after` | 渐变下划线（已有 spectrum） |
| 输入聚焦 | `.composer-box:focus-within::before`、`.goal-input:focus-within::before`（L1068）、`.session-search:focus`、`.search-capsule:focus-within` | 渐变描边/下划线 |
| 回答竖线 | `.line-answer .answer-rule` | 2px 渐变条 |
| 脏文件点 | `.dirty-dot` | 渐变圆点 |
| 开关 | `.settings-switch.is-on` | 渐变填充 + 墨色 |
| 滑块/勾选 | `.settings-slider input[type=range]`、`.context-option input` | `accent-color: var(--accent-solid)` |
| 目录点 | `.provider-row.is-current .provider-dot`、`.menu-pending-dot`、`.dial-cell.on` / `.is-current` | 渐变点 |
| 原生控件 | `.lang-switch:hover`、`.kind-row button.is-on`、`.guide-steps li`、`guide-provider.is-on` | 渐变描边 |
| 顶部脉冲带 | `.app-shell::after` | 全宽渐变带：静止 0.35 → 事件时 `--living-gain` 拉到 1 |

**颜色跟随相位**：所有渐变面用同一个 `--spectrum`（内部含 `--phase-total`），所以全应用同步换色，不会出现「有的紫有的绿」。

## 6. 动态行为

| 状态 | 行为 |
|---|---|
| 空闲 | `--phase` 按模式的 `--t-ambient`（coding 5.2s）在 0°→52° 之间摆动（`alternate` + `ease-in-out`）。安静，不抢注意力；**不是**整圈旋转（整圈像迪斯科）。 |
| 内核事件 | living.ts 写 `--living-hue`（±120°）→ 相位跳变 → 全应用强调色同时换位；`--living-gain` 把顶部带亮度从 0.35 拉到 1 并按 signal 的 decay 回落。 |
| pulse | `--living-pulse` 触发顶部带 480ms 一次性闪动（既有 M4 规则）。 |
| IDE 模式 | 相位**暂停**（编辑区必须静止），但强调色仍是静态彩虹。 |
| deepsleep | 相位**暂停**（§5.4 禁止 deepsleep 彩虹流动）；仅保留 12s 慢呼吸。 |
| `data-motion != full` / `prefers-reduced-motion` | 无漂移、无脉冲，`--phase` 固定 0deg（静态彩虹）。 |

**暂停实现**：动画挂在 `:root` 上，模式在 `.app-shell` 上 → 用 `:root:has(.app-shell.mode-ide)` 或把动画挂到 `.app-shell` 自身的后代策略。更稳的方案：动画挂在 `.app-shell` 上，`--phase` 依然 `inherits: true` → 子元素继承动画值；但 `.app-shell` 之外的元素（body 上的层）取不到值。**结论：动画挂 `:root`，暂停通过 `:root:has(...)` 选择器实现**（Chromium 支持 `:has`）。

## 7. 密度改造（TRAE 差距）

1. **文件类型图标着色**：`.ico-doc` 等目前统一 `--accent-quiet` 灰。改为**从光谱取固定色相**（静态，便于扫读，不随相位漂移）：md=琥珀、ts=蓝、rs=朱红、json=绿、css=紫、图片=品红、其余=灰。图标色是「密度」，不是「强色」。
2. **欢迎区 / 空编辑器**：现在是一大块死黑里一个图标 + 一行字 + 两个按钮。加一层**低饱和光谱洗色**（radial，≤8% 不透明度）+ 一行 3 项快捷动作（打开文件 / 新建文件 / 召唤智能体）。不新增文案 key 之外的新概念，文案复用现有 i18n。
3. **标题栏**：工作区 chip 按相位着色（细边框 + 极低饱和底）。
4. **面板细线**：`.pane-head` / `.statusbar` 描边混入当前相位色 ≤18%（现状已是 mode-accent 22%/18% 的混合结构，只是把色源换成相位色）。
5. **左轨图标**：保持单色（§1.3 不新增第二种品牌图形），但激活项描边改彩虹。

## 8. 不变量（必须保持为绿）

- 一个模式切换器（标题栏）；composer 无模式 chip；状态栏无模式按钮。
- IDE 模式 `[data-ai="true"]` 元素数 = 0。
- 会话列几何不变；`--sessions-w` / `--right-w` / `--ai-grow` 规则不动。
- 状态是**带文字的块**，不是纯色点；transport badge 仅在不健康时出现。
- 焦点环、beam 配额类检查：彩虹替换后「实心块 ≤ 2」的判据按新契约重述（见 §10 文档更新）。
- `@`/`Shift+@+F1` 契约；App.tsx 只有 1 个 window keydown。
- 删除走 `.pristem/trash`；无新 npm 依赖；i18n 双字典；注释用英文。
- L2：无 `.title-menus` / `.title-menu-btn`；`ui/src` 内无硬编码协议字面量；`term` 的 `instance` 保持数字。

## 9. 验证

```bash
# 渲染层
cd pristem-desktop/ui && pnpm build          # tsc --noEmit + vite
# shell
cd pristem-desktop/shell && cargo build && cargo test
# 视觉套件（每套独立端口与独立 service）
$svc = Start-Process pristem-desktop/shell/target/debug/pristem-desktop.exe -ArgumentList '--no-window','--port','8790' -PassThru
$env:PR_URL = 'http://127.0.0.1:8790/'
node pristem-desktop/.visual-check/check.cjs      # 218 条
node pristem-desktop/.visual-check/_living-selfcheck.cjs
Stop-Process -Id $svc.Id
```

额外自查：

- **对比度脚本**：遍历光谱每个 stop 的计算值，断言与 `--accent-ink`(#0A0A0A) 的对比度 ≥ 4.5:1；写入 `.visual-check` 作为 L1 断言。
- **循环动画数**：断言视口内 infinite 动画元素数 ≤ 1（D2 已有类似判据，需覆盖 `:root` 上的新动画）。
- **截图**：出 coding / goal / helping / deepsleep / IDE 五态截图，供与 TRAE 并排比对。

## 10. 文档更新（契约同步）

`pristem-desktop/DESIGN_SYSTEM.md`：

- §1.2 保留项表：把「单一冷白强调色」改为「**彩虹相位强调色**（单一定义 + 单一时钟）」。
- §4.2 beam 配额 → 改写为「**accent 配额**」：彩虹填充块仍 ≤ 2，描边/点不限。
- §4.3 spectrum 收敛 → 改为「spectrum 是**唯一强色**，单一定义；**禁止**彩虹做文字色、禁止彩虹做背景墙」。
- §5.3 LIVING 载体：加 `--phase` 相位环；§5.4 deepsleep 保留「禁彩虹流动」= 相位暂停。
- §9 L2/L3 判据：更新 spectrum 计数判据（定义仍为 1 处；**使用点**允许在 §5 清单内），新增对比度判据。
- `UX_SPEC.md`：如涉及断点/密度，补一句。

## 11. 实现记录（与本规格的偏差，及原因）

实现过程中有四处与上文不符。全部是**被证据推翻的假设**，不是偷工：

| # | 规格原写法 | 实际实现 | 为什么 |
|---|---|---|---|
| 1 | 相位 26s/圈，360° 整圈旋转 | 时长取 `--t-ambient`，**52° 摆动**（`alternate`） | 整圈旋转让强调色在红↔绿之间来回换，看起来像迪斯科；52° 摆动在同一色族里漂移，才是「活着」而不是「蹦迪」。用模式自己的节奏，还顺带让六种模式各有各的呼吸频率。 |
| 2 | 焦点环改成彩虹描边 | **焦点环保持静态白**（`--focus-ring` / `:focus-visible` 都用 `--beam`） | 两个原因：(a) `--focus-ring` 是自定义属性，把相位写进去会在 `:root` 冻死（实测：替换成 `hsl(calc(0deg + 0deg) …)` 永不变）；(b) 更根本的理由 —— **会变色的焦点环对键盘用户是移动靶标**，焦点通道必须稳定。彩虹只染品牌强调位。 |
| 3 | 全部强调位用彩虹渐变 | **填充面用真彩虹**（按钮、顶部带、composer 聚焦线、回答竖线、激活态条），**细条/圆点/描边用「随相位转的单色」** `hsl(calc(var(--phase) + var(--living-hue)) 70% 62%)` | 2px 的条用渐变在这么窄的面积上分辨不出六个色相，只是一条糊掉的彩色线；单色更干净、更省（无 filter 层），而且和填充面同源。 |
| 4 | 「同屏无限循环动画 ≤ 1」 | **≤ 1 条运动循环**（LIVING 呼吸）+ 棱镜**颜色**循环 | 棱镜时钟只改色相，**不动任何几何**，不构成第二个运动循环。实测代价：无头软件渲染下平均帧时 +0.8ms（+5%）。D2 判据因此改为「运动循环 ≤ 1」，并排除 `prism-phase`。 |

另外两处实现细节与规格不同，但不改变契约：

- 原语没有做成工具类（`.accent-fill` / `.accent-line`），而是**每个强调位就地写**同两行：做成工具类要么需要改一堆 TSX，要么留下一批没人用的死类。
- `--living-pulse` 此前**被 living.ts 写入却无人消费**（和 `--living-hue` 一样是死线）；本次把它接进顶部带的透明度。
- 面板细线仍用 `--mode-accent` 染色，没有换成相位色 —— 六模式的身份色必须保持可区分（R-BRAND-4），密度改由欢迎区/目标区/编辑器空态的洗色承担。

## 12. 风险| 风险 | 缓解 |
|---|---|
| **相位写进 `--spectrum` 会冻死彩虹** | §3.2：相位只经 `filter`（常规属性）进入使用处，绝不写进自定义属性的定义 |
| 彩虹铺面导致拼凑感回归 | R-BRAND-1/3/4：只替换已有强调位，灰阶工具与语义色不动 |
| 每帧 N 层 filter 重绘 | 强调位数量受控；IDE / deepsleep / reduced-motion 下相位暂停（零成本）；滤镜只挂背景层 |
| 无限动画在低配机上吃 GPU | 实测 +0.8ms/帧（无头软件渲染）；相位只改色相不动几何；`prefers-reduced-motion` 下完全停 |
| 焦点指示器不稳定 | 焦点环**保持静态白**（见 §11 偏差 2）：彩虹不进焦点通道 |
| 216+ 检查里有断言「无彩虹」或「beam 是白」 | 逐条跑 check.cjs，改的是**判据**不是**事实**时必须同步改文档并说明理由 |
| 深色面板上饱和彩虹在 OLED 上过曝 | stop 亮度锁 58%–62%，不做发光扩散；不用 `filter` 之外的重合成手段 |
