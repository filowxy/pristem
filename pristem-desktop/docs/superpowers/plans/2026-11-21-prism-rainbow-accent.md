# PRISM 彩虹强调色 Implementation Plan

> **Implementation note (2026-11-21):** shipped, with four deviations from this plan — the clock's tempo/sweep, the focus ring, the two painting forms, and the D2 loop rule. All four are recorded with their evidence in the spec's **§11 实现记录**: `docs/superpowers/specs/2026-11-21-prism-rainbow-accent-design.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 pristem 的强色从冷白 `--beam` 换成会随相位变化的彩虹，并补上与 TRAE 的密度差。

**Architecture:** 一个相位时钟（`@property --phase`，挂在 `.app-shell`）+ 一个光谱渐变（`--spectrum`，仍然只定义一次）+ 两个注入机制。**相位永远不写进自定义属性的定义里** —— CSS 在声明处做 `var()` 替换，写进去会被冻死。相位只经常规属性在使用处进入：`background-image: var(--spectrum)` + `filter: hue-rotate(calc(var(--phase) + var(--living-hue)))`（渐变面），或 `hsl(calc(var(--phase) + var(--living-hue)) …)`（单色面：描边、圆点、焦点环）。

**Tech Stack:** React 19 + TypeScript + Vite（`pristem-desktop/ui`）、原生 CSS（无预处理器）、Playwright + Edge（`pristem-desktop/.visual-check`）、Rust shell（`pristem-desktop/shell`）。

## Global Constraints

- **无新 npm 依赖**；Rust 依赖不变。
- **`--spectrum` 的定义必须恰好出现一次**（`check.cjs:238` 静态断言）。
- **彩虹永不承载文字**（R-BRAND-1）；文字色保持 `--text-1/2/3`。
- **`--beam-wash` / `--beam-glow` / `--beam-dim` 不动**（灰阶工具，非品牌色）。
- **语义色不动**：`--success` / `--warn` / `--danger` / `--info` / `--mode-accent`（R-BRAND-4）。
- **同屏无限循环动画 ≤ 1**（DESIGN D2）：相位动画是那唯一一个。
- **IDE 模式 `[data-ai="true"]` 元素数 = 0**；模式切换器只有标题栏那一个。
- **删除走 `.pristem/trash`**；不碰 shell/kernel。
- **注释用英文**，只写不变量与不可推断的约束。
- **每条新 i18n key 同时进 `ui/src/i18n.ts` 的两份字典**。
- **仓库不是 git 仓库** → 本计划没有 commit 步骤；每个 Task 的「checkpoint」= 跑该 Task 的验证命令。

---

## 文件地图

| 文件 | 职责 | 本次改动 |
|---|---|---|
| `ui/src/styles.css` | 令牌、布局、组件样式（2430+ 行） | 相位时钟、光谱 stops、强调面迁移、密度改造 |
| `ui/src/polish.css` | 后加载的「压平」层（覆盖 styles.css） | 同步按钮/焦点环的彩虹覆盖 |
| `ui/src/living.ts` | 事件 → `--living-hue/--living-gain/--living-pulse` | 不改逻辑（机制已在，缺的是消费端） |
| `.visual-check/check.cjs` | 218 条 L1/L2 断言 | 新增相位/强调/对比度断言 |
| `.visual-check/_living-selfcheck.cjs` | LIVING 行为自检 | 新增相位跳变断言 |
| `DESIGN_SYSTEM.md` | 设计契约 | §1.2/§4.2/§4.3/§5.3/§5.4/§9 改写 |

---

### Task 1: 相位时钟与强调令牌

**Files:**
- Modify: `pristem-desktop/ui/src/styles.css`（顶部 `@property` 块、`:root`、`--spectrum` 定义、`.app-shell` 块）
- Modify: `pristem-desktop/ui/src/polish.css`（reduced-motion 块）
- Test: `pristem-desktop/.visual-check/check.cjs`

**Interfaces:**
- Consumes: 无
- Produces: `--phase`（继承的 `<angle>`，动画于 `.app-shell`）、`--spectrum`（新 stops）、`--accent-ink:#0A0A0A`。后续 Task 全部消费这三个。

- [ ] **Step 1: 注册相位属性**

在 `styles.css` 顶部已有的 `@property` 块之后追加：

```css
/* The prism's phase. One clock for the whole app: the rainbow's hue rotates
   through 360° in 26s. Registered so it can be animated and inherited. */
@property --phase { syntax: '<angle>'; inherits: true; initial-value: 0deg; }
```

- [ ] **Step 2: 换掉光谱 stops（保持单一定义）**

把 `styles.css` 的

```css
  --spectrum:linear-gradient(90deg,rgba(255,255,255,.45) 0%,#CC504D 16%,#DEB349 36%,#59A15C 56%,#4680E1 76%,rgba(255,255,255,.9) 100%);
```

替换为（亮度锁 58%–62%，保证与墨色 `#0A0A0A` 的对比度 ≥ 4.5:1）：

```css
  --spectrum:linear-gradient(90deg,#E0564B 0%,#DEB349 20%,#59A15C 42%,#4680E1 66%,#8E6BE0 84%,#E0569E 100%);
```

并在 `:root` 里加：

```css
  --accent-ink:#0A0A0A;   /* ink on a rainbow fill — never white on spectrum */
```

- [ ] **Step 3: 挂上相位时钟**

在 `.app-shell` 规则块内追加（`--phase` 继承给所有后代）：

```css
  /* One clock. The animation lives on .app-shell so a mode can pause it
     without :has(), and so --phase reaches every surface inside the app. */
  animation: prism-phase 26s linear infinite;
```

并在 `styles.css` 的 `.app-shell` 规则之后追加：

```css
@keyframes prism-phase { from { --phase: 0deg; } to { --phase: 360deg; } }
/* IDE and deepsleep must stay still: the editor is a workplace, deepsleep
   is digestion (§5.4 bans rainbow flow). */
.app-shell.mode-ide, .app-shell.mode-deepsleep { animation-play-state: paused; }
```

- [ ] **Step 4: 尊重动效偏好**

`styles.css` 已有的 `@media (prefers-reduced-motion: reduce)` 块内追加一行：

```css
  :root:not([data-motion="full"]) .app-shell { animation: none; }
```

`polish.css` 内追加（应用内的动效档位独立于系统设置）：

```css
:root[data-motion="reduced"] .app-shell { animation: none; }
```

- [ ] **Step 5: 加静态断言**

`check.cjs` 的 rainbow 断言之后追加：

```js
  check('L2: the prism phase is registered exactly once',
    (cssText.match(/@property\s+--phase/g) || []).length === 1);
  check('L2: the rainbow never carries text',
    !/color:\s*var\(--spectrum/.test(cssText) && !/color:\s*var\(--accent-line)/.test(cssText));
  check('L2: the phase is never frozen inside a custom property',
    !/--[a-z-]+:[^;]*var\(--phase\)/.test(cssText));
```

第三条断言守的就是 §3.2 的坑：相位不得出现在任何自定义属性的定义里。

- [ ] **Step 6: 验证**

```bash
cd pristem-desktop/ui && pnpm build
```

Checkpoint: 构建通过；`check.cjs` 的 3 条新 L2 断言为绿。

---

### Task 2: 强调原语（fill / line / 单色）

**Files:**
- Modify: `pristem-desktop/ui/src/styles.css`
- Test: `pristem-desktop/.visual-check/check.cjs`

**Interfaces:**
- Consumes: `--spectrum`、`--phase`、`--living-hue`（Task 1）
- Produces: 两个可复用类 `.accent-fill` / `.accent-line`，以及「旋转单色」写法 `hsl(calc(var(--phase) + var(--living-hue)) 70% 62%)`

- [ ] **Step 1: 写强调原语**

在 `styles.css` 的 `/* ---------- sessions */` 之前插入：

```css
/* ------------------------------------------------------------------ PRISM accent
   Two primitives carry the brand colour. Both read the one spectrum and the
   one phase clock. The filter lives here, on a regular property, because a
   var() inside a custom property is substituted once at the declaring element
   — a phase written into --spectrum would freeze the gradient. */
.accent-fill, .accent-line {
  background-image: var(--spectrum);
  filter: hue-rotate(calc(var(--phase) + var(--living-hue)));
}
/* The layer form: the gradient sits behind the content, so text and icons
   keep their ink while the fill changes hue. */
.accent-fill-layer { position: relative; isolation: isolate; overflow: hidden; }
.accent-fill-layer::before {
  content: ''; position: absolute; inset: 0; z-index: -1; border-radius: inherit;
  background-image: var(--spectrum);
  filter: hue-rotate(calc(var(--phase) + var(--living-hue)));
}
/* The single-colour form: a rotating accent for rings, borders and dots.
   Written inline on purpose — as a custom property it would freeze. */
.accent-solid { background: hsl(calc(var(--phase) + var(--living-hue)) 70% 62%); }
.accent-border { border-color: hsl(calc(var(--phase) + var(--living-hue)) 70% 62%); }
```

- [ ] **Step 2: 验证**

```bash
cd pristem-desktop/ui && pnpm build
```

Checkpoint: 构建通过；`grep` 确认 `var(--phase)` 只出现在 `filter:` / `hsl(` / `calc(` 里，没有出现在 `--xxx:` 定义中。

---

### Task 3: 按钮、焦点环与原生控件

**Files:**
- Modify: `pristem-desktop/ui/src/styles.css`（`.send-btn` 1007、`.primary-btn` 1099、`:focus-visible` 125、`.context-option input` 1025、`.settings-slider` 1641、`.settings-switch` 1638）
- Modify: `pristem-desktop/ui/src/polish.css`（404-424 按钮覆盖、63-79 焦点环）
- Test: `pristem-desktop/.visual-check/check.cjs`

**Interfaces:**
- Consumes: `.accent-fill-layer`、`.accent-solid`（Task 2）
- Produces: 彩虹主按钮 / 发送按钮 / 焦点环

- [ ] **Step 1: 主按钮与发送按钮换成彩虹填充**

`styles.css` 的 `.primary-btn` 与 `.send-btn` 规则改为使用 `.accent-fill-layer` 的层形态（`::before` 承载渐变，文字与图标留在未过滤的父元素上）：

```css
.primary-btn {
  position: relative; isolation: isolate; overflow: hidden;
  height: 36px; display: flex; align-items: center; justify-content: center; gap: var(--sp-4);
  background: var(--surface-raised);
  color: var(--accent-ink);
  padding: 0 var(--sp-8);
  border: 1px solid var(--line-strong);
  font-size: var(--fs-body-sm); font-weight: 600; border-radius: var(--r-1);
  box-shadow: 0 1px 2px rgba(0,0,0,.35);
  transition: box-shadow var(--t-fast), transform 90ms var(--ease-move);
}
.primary-btn::before {
  content: ''; position: absolute; inset: 0; z-index: -1; border-radius: inherit;
  background-image: var(--spectrum);
  filter: hue-rotate(calc(var(--phase) + var(--living-hue)));
}
.primary-btn:hover:not(:disabled) { box-shadow: 0 2px 10px rgba(0,0,0,.5); transform: translateY(-1px); }
.primary-btn:active:not(:disabled) { transform: translateY(1px); }
.primary-btn:disabled { opacity: .38; cursor: not-allowed; }
.primary-btn.small { height: 30px; font-size: var(--fs-label); }
```

`.send-btn` 同构：`position: relative; isolation: isolate; overflow: hidden; color: var(--accent-ink);`，并加同样的 `::before`。

- [ ] **Step 2: 同步 polish.css 的覆盖层**

`polish.css:404-424` 的「quiet controls」规则现在会把按钮压回平面白。改为：

```css
.primary-btn, .send-btn {
  background: var(--surface-raised);
  border-color: var(--line-strong);
  color: var(--accent-ink);
  box-shadow: none;
  transform: none;
}
.primary-btn::before, .send-btn::before {
  content: ''; position: absolute; inset: 0; z-index: -1; border-radius: inherit;
  background-image: var(--spectrum);
  filter: hue-rotate(calc(var(--phase) + var(--living-hue)));
}
.primary-btn:hover:not(:disabled), .send-btn:hover {
  border-color: var(--line-strong);
  box-shadow: none;
  transform: none;
}
.primary-btn:active:not(:disabled), .send-btn:active {
  border-color: var(--line-strong);
  box-shadow: none;
  transform: none;
}
```

- [ ] **Step 3: 焦点环换成旋转单色**

`styles.css:125`：

```css
:focus-visible { outline: 2px solid hsl(calc(var(--phase) + var(--living-hue)) 70% 62%); outline-offset: 2px; }
```

`polish.css:76` 与 `:79` 同步替换 `var(--beam)` 为同一条 `hsl(calc(...))` 写法。

- [ ] **Step 4: 原生控件**

```css
.context-option input { accent-color: hsl(calc(var(--phase) + var(--living-hue)) 70% 62%); }
.settings-slider input[type="range"] { accent-color: hsl(calc(var(--phase) + var(--living-hue)) 70% 62%); }
.settings-switch.is-on { background: hsl(calc(var(--phase) + var(--living-hue)) 70% 62%); border-color: transparent; }
.settings-switch.is-on::after { background: var(--accent-ink); }
```

- [ ] **Step 5: 加断言并验证**

```js
  check('L2: no button paints itself with the flat white beam any more',
    !/\.primary-btn[^{]*\{[^}]*background:\s*var\(--beam\)/.test(cssText));
```

```bash
cd pristem-desktop/ui && pnpm build
```

Checkpoint: 构建通过；断言为绿；`pnpm dev`/套件截图里主按钮是彩虹而不是白块。

---

### Task 4: 条、点、描边（tab / 树 / 回答 / 脏点 / 目录点）

**Files:**
- Modify: `pristem-desktop/ui/src/styles.css`（517、615、702、711、713、730、779、796、898、944、1068、1153、1181、1533、1648、1561、232、237）
- Test: `pristem-desktop/.visual-check/check.cjs`

**Interfaces:**
- Consumes: Task 2 的原语
- Produces: 彩虹 2px 条 / 圆点 / 描边

- [ ] **Step 1: 长条用渐变，短点用旋转单色**

```css
/* editor tab */
.editor-tab.is-active::after {
  content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 2px;
  background-image: var(--spectrum);
  filter: hue-rotate(calc(var(--phase) + var(--living-hue)));
}
/* panel tab */
.panel-tab.is-active { border-bottom-color: transparent; }
.panel-tab.is-active::after {
  content: ''; position: absolute; left: var(--sp-4); right: var(--sp-4); bottom: 0; height: 1px;
  background-image: var(--spectrum);
  filter: hue-rotate(calc(var(--phase) + var(--living-hue)));
}
/* tree active row */
.tree-item.is-active::before {
  content: ''; position: absolute; left: 0; top: 4px; bottom: 4px; width: 2px;
  background-image: var(--spectrum);
  filter: hue-rotate(calc(var(--phase) + var(--living-hue)));
}
/* the answer rule */
.line-answer .answer-rule {
  background-image: var(--spectrum);
  filter: hue-rotate(calc(var(--phase) + var(--living-hue)));
}
/* short dots — a rotating colour, no filter */
.dirty-dot { background: hsl(calc(var(--phase) + var(--living-hue)) 70% 62%); }
.provider-row.is-current .provider-dot { background: hsl(calc(var(--phase) + var(--living-hue)) 70% 62%); }
.menu-pending-dot { background: hsl(calc(var(--phase) + var(--living-hue)) 70% 62%); }
.dial-cell.on { background: hsl(calc(var(--phase) + var(--living-hue)) 70% 62%); }
.dial-cell.is-current { background: hsl(calc(var(--phase) + var(--living-hue)) 78% 66%); }
```

- [ ] **Step 2: 描边类**

```css
.session-search:focus { border-color: hsl(calc(var(--phase) + var(--living-hue)) 70% 62%); }
.search-capsule:focus-within { border-bottom-color: hsl(calc(var(--phase) + var(--living-hue)) 70% 62%); }
.kind-row button.is-on { border-color: hsl(calc(var(--phase) + var(--living-hue)) 70% 62%); }
.lang-switch:hover { border-color: hsl(calc(var(--phase) + var(--living-hue)) 70% 62%); }
.guide-provider.is-on { border-color: hsl(calc(var(--phase) + var(--living-hue)) 70% 62%); }
.handoff-step.is-active > span { border-color: hsl(calc(var(--phase) + var(--living-hue)) 70% 62%); }
```

composer 的聚焦下划线（`:1068` 的 `background-image: linear-gradient(var(--beam), var(--beam))`）改为渐变光谱 + 滤镜。

- [ ] **Step 3: 验证**

```bash
cd pristem-desktop/ui && pnpm build
```

Checkpoint: 构建通过；截图里激活 tab / 树项 / 回答竖线呈现彩虹。

---

### Task 5: 顶部光谱带与 LIVING 联动

**Files:**
- Modify: `pristem-desktop/ui/src/styles.css`（`.app-shell::after` 161-166）
- Test: `pristem-desktop/.visual-check/_living-selfcheck.cjs`

**Interfaces:**
- Consumes: `--living-gain`、`--living-hue`（`living.ts` 已写）、Task 1 的相位
- Produces: 常驻可见、随内核事件增强的光谱带

- [ ] **Step 1: 光谱带常驻**

`.app-shell::after` 改为：静止时可见（opacity .35），事件时被 `--living-gain` 拉到 1。

```css
.app-shell::after {
  content: ''; position: absolute; left: 0; right: 0; top: 36px; height: 2px;
  background-image: var(--spectrum);
  background-size: 200% 100%;
  filter: hue-rotate(calc(var(--phase) + var(--living-hue)));
  opacity: calc(.35 + var(--band-gain) * .65);
  pointer-events: none; z-index: 45;
}
```

`--band-gain` 是 `.app-shell` 上的 `--living-gain` 别名，已存在，无需新增。

- [ ] **Step 2: LIVING 自检加断言**

`_living-selfcheck.cjs` 追加一项：内核事件后 `getComputedStyle(.app-shell, '::after').filter` 的 hue 角与事件前不同。

- [ ] **Step 3: 验证**

```bash
cd pristem-desktop/shell && cargo build
$svc = Start-Process pristem-desktop/shell/target/debug/pristem-desktop.exe -ArgumentList '--no-window','--port','8791' -PassThru
$env:PR_URL = 'http://127.0.0.1:8791/'
node pristem-desktop/.visual-check/_living-selfcheck.cjs
Stop-Process -Id $svc.Id
```

Checkpoint: 自检为绿；带子在事件后变亮。

---

### Task 6: 密度改造（TRAE 差距）

**Files:**
- Modify: `pristem-desktop/ui/src/styles.css`（`.welcome-action-icon` 1952-1959、`.editor-empty` 721-739、`.pane-head`/`.statusbar` 188-191、文件图标 602-609）
- Modify: `pristem-desktop/ui/src/i18n.ts`（如新增文案，两份字典同时加）

**Interfaces:**
- Consumes: Task 1-5 的令牌
- Produces: 欢迎区光谱洗色、图标分色、细线染色

- [ ] **Step 1: 欢迎区加一层光谱洗色**

```css
.welcome-main::before {
  content: ''; position: absolute; inset: -80px -120px auto -120px; height: 320px;
  background: radial-gradient(60% 70% at 30% 30%, hsl(calc(var(--phase) + 210deg) 60% 40% / .10), transparent 70%);
  pointer-events: none; z-index: -1;
}
```

`.welcome-main` 需要 `position: relative`。

- [ ] **Step 2: 三张欢迎卡的分色图标**

`.welcome-action-icon` 现在是统一的 `--info` 8% 底。改为按序号取光谱的三段色相：

```css
.welcome-actions .welcome-action:nth-child(1) .welcome-action-icon { color: hsl(calc(var(--phase) + 205deg) 62% 66%); background: hsl(calc(var(--phase) + 205deg) 60% 45% / .14); }
.welcome-actions .welcome-action:nth-child(2) .welcome-action-icon { color: hsl(calc(var(--phase) + 145deg) 58% 62%); background: hsl(calc(var(--phase) + 145deg) 58% 45% / .14); }
.welcome-actions .welcome-action:nth-child(3) .welcome-action-icon { color: hsl(calc(var(--phase) +  25deg) 66% 64%); background: hsl(calc(var(--phase) +  25deg) 62% 45% / .14); }
```

- [ ] **Step 3: 面板细线染相位**

`.pane-head` / `.statusbar` 的描边混色把 `--mode-accent` 换成相位色，混合比保持 ≤18%：

```css
.pane-head, .ai-head, .activity-head, .left-rail-head {
  border-bottom-color: color-mix(in srgb, hsl(calc(var(--phase) + var(--living-hue)) 70% 62%) 22%, var(--line-hair));
}
.statusbar { border-top-color: color-mix(in srgb, hsl(calc(var(--phase) + var(--living-hue)) 70% 62%) 18%, var(--line-hair)); }
```

- [ ] **Step 4: 文件图标补色**

`.ico-doc` 现在是灰（`--accent-quiet`）。改为光谱取色的静态相（静态便于扫读，不随相位漂移）：

```css
.ico-doc { color: hsl(28 55% 62%); }
```

其余 `.ico-*` 已有语义色，不动。

- [ ] **Step 5: 验证**

```bash
cd pristem-desktop/ui && pnpm build
```

Checkpoint: 构建通过；欢迎区截图有三色图标 + 洗色；树里 md 文件不再是灰图标。

---

### Task 7: 套件断言（对比度 / 循环数 / 强调存在）

**Files:**
- Modify: `pristem-desktop/.visual-check/check.cjs`
- Test: 同上

**Interfaces:**
- Consumes: Task 1-6 的产物
- Produces: 新的 L1/L2 判据，防止回归

- [ ] **Step 1: 对比度断言**

在 `check.cjs` 的静态段追加：

```js
  const ink = '#0A0A0A';
  const spectrumStops = ['#E0564B', '#DEB349', '#59A15C', '#4680E1', '#8E6BE0', '#E0569E'];
  const relLum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const contrast = (a, b) => {
    const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const worst = Math.min(...spectrumStops.map((s) => contrast(s, ink)));
  check('C9: every spectrum stop carries the accent ink at 4.5:1 or better',
    worst >= 4.5, `worst=${worst.toFixed(2)}:1`);
```

- [ ] **Step 2: 循环动画数断言（运行时）**

```js
  const loops = await page.evaluate(() => document.getAnimations()
    .filter((a) => a.playState === 'running' && a.effect?.getTiming?.().iterations === Infinity)
    .map((a) => a.effect?.target?.className || a.effect?.target?.tagName));
  check('D2: at most one infinite animation runs on screen',
    loops.length <= 1, loops.join(' | '));
```

- [ ] **Step 3: 强调存在断言**

```js
  const primaryBg = await page.evaluate(() => {
    const el = document.querySelector('.primary-btn');
    return el ? getComputedStyle(el, '::before').backgroundImage : '';
  });
  check('PRISM: the primary button paints the spectrum gradient',
    /gradient/.test(primaryBg), primaryBg.slice(0, 60));
```

- [ ] **Step 4: 验证**

```bash
$svc = Start-Process pristem-desktop/shell/target/debug/pristem-desktop.exe -ArgumentList '--no-window','--port','8792' -PassThru
$env:PR_URL = 'http://127.0.0.1:8792/'
node pristem-desktop/.visual-check/check.cjs
Stop-Process -Id $svc.Id
```

Checkpoint: 全部断言为绿（含原有 218 条）。

---

### Task 8: DESIGN_SYSTEM.md 契约改写

**Files:**
- Modify: `pristem-desktop/DESIGN_SYSTEM.md`（§1.2 98、§4.2 378-396、§4.3 398-414、§5.3 529-572、§5.4 574+、§9 2150+）

**Interfaces:**
- Consumes: Task 1-7 的最终实现
- Produces: 与代码一致的契约

- [ ] **Step 1: §1.2 保留项表**

把

```
| 深色无彩底 + 单一冷白强调色 | 保留。`--beam` 是唯一「光」色 |
```

改为

```
| 深色无彩底 + **彩虹强调色** | 保留底，**换色**。`--spectrum` 是唯一强色，单一定义；`--phase` 是唯一时钟（26s/圈） |
```

- [ ] **Step 2: §4.3 spectrum 收敛 → spectrum 作为唯一强色**

替换决策句：

> **spectrum 是 Pristem 的唯一强色：一个定义、一个时钟、一个墨色。**
> 相位只经常规属性在使用处注入（`filter: hue-rotate(calc(var(--phase) + var(--living-hue)))` / `hsl(calc(...))`）——
> **禁止**把 `var(--phase)` 写进任何自定义属性的定义（会在声明处被替换并冻死）。
> **禁止**彩虹承载文字；**禁止**彩虹铺成背景墙；语义色（success/warn/danger/info）与 `--mode-accent` 不受彩虹影响。

- [ ] **Step 3: §9 判据**

C7 改为：`--spectrum` 的**定义**恰好 1 处；新增 C9（每个 stop 与墨色 ≥ 4.5:1）与 D2 补充（相位动画是那唯一一个循环）。

- [ ] **Step 4: 验证**

```bash
Select-String -Path pristem-desktop/DESIGN_SYSTEM.md -Pattern '单一冷白强调色','每张卡片顶上一道彩虹'
```

Checkpoint: 两句旧表述都已消失。

---

### Task 9: 全量验证与截图

**Files:**
- Test: 全部

- [ ] **Step 1: 渲染层与 shell**

```bash
cd pristem-desktop/ui && pnpm build
cd pristem-desktop/shell && cargo build
cd pristem-desktop/shell && cargo test
```

- [ ] **Step 2: 全套件（独立端口）**

```bash
$svc = Start-Process pristem-desktop/shell/target/debug/pristem-desktop.exe -ArgumentList '--no-window','--port','8793' -PassThru
$env:PR_URL = 'http://127.0.0.1:8793/'
node pristem-desktop/.visual-check/check.cjs
Stop-Process -Id $svc.Id
```

- [ ] **Step 3: 截图（供与 TRAE 并排比对）**

coding / goal / helping / deepsleep / IDE 五态截图存到 `pristem-desktop/.screenshots/prism/`。

- [ ] **Step 4: 汇报**

列出：改了哪些文件、哪些断言新增/通过、截图路径、以及**任何未通过或跳过的检查**（不谎报）。

---

## 自查（写完计划后立刻做）

1. **规格覆盖**：§3.1→Task 1；§3.2→Task 2；§3.4→Task 1+7；§4 规则→Task 2/3/4 的 R-BRAND 落点；§5 清单→Task 3/4；§6 动态→Task 1/5；§7 密度→Task 6；§8 不变量→Task 7/9；§9 验证→Task 7/9；§10 文档→Task 8。✓ 无缺口。
2. **占位符扫描**：无 TBD/TODO；每步都有真实代码或真实命令。✓
3. **命名一致性**：`--phase`、`--spectrum`、`--accent-ink`、`.accent-fill`、`.accent-line`、`.accent-fill-layer`、`.accent-solid`、`.accent-border` 在各 Task 间一致。✓
