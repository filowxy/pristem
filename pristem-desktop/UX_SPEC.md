# pristem 桌面端 · 体验规范与交互流 v1.0

> 状态：**Phase 2 交付物**。本文定义「交互与信息架构」：状态机、转场契约、分支行为、键盘与焦点、降级矩阵、可执行的验收步骤。
>
> 视觉决策（色彩、字体、动效时长、组件尺寸、密度上限）**全部来自 `DESIGN_SYSTEM.md` v1.0，本文不重复推导、不得推翻**。本文只回答 DESIGN_SYSTEM 没有回答的问题：**什么时候发生、发生什么、失败了怎么办、键盘怎么走、屏幕怎么说、怎么被自动验证**。
>
> 适用版本：`pristem.ipc/v0.3` → 本文要求 `v0.4`（`usage` 事件）+ 壳层 `shell.capabilities` 与 `fs.list.protocol`（见附录 B）。
> 已裁定硬约束：`DESIGN_SYSTEM.md` 附录 B′ 的 **D-1 ~ D-5** 是 Phase 2 / Phase 3 / 验收的共同输入，本文逐条对齐（落地位置见 §0.3）。
>
> 前置事实（已核对源码，非推测）：
> - `pristem-core/src/mode.rs` `transition_table()`：进 deepsleep 仅允许 from `goal|coding|advisor`；出 deepsleep 仅允许 to `coding|goal`；`helping → deepsleep` = `allowed:false`。
> - `pristem-ipc/src/server.rs:157`：`switch_mode` 目标为 deepsleep 时**先发** `ServerEvent::Buttons{prompt:"Enter deepsleep?"}`，**不切换**；`confirm` 后才走 `manager.switch_mode`，非法则发 `ServerEvent::Error`（message 形如 `mode transition helping -> deepsleep is forbidden: {note}`）。
> - `pristem-ipc/src/server.rs:241`：`ConfirmAction::ModeSwitch(to) && choice != "cancel"` 才真正切换。
> - `ServerEvent::Error` **没有 session 字段**（`events.rs:187`）——错误只能按「当前活跃会话」归属，这是本文 §A.6 的一处已知限制。
> - `ClientRequest::ListProviders{client}` → `ServerEvent::Providers{providers}`；`ClientRequest::SetProvider{session,provider}` → `ServerEvent::ProviderChanged{session,provider,model}`。两者**已存在**，UI 未接。
> - `ProviderInfo` 字段：`id / adapter / model / api_key_env / base_url / key_present / is_default`。
> - `shell/src/io.rs:137`：`fs.openFolder` 与 `fs.pickFolder` 合并处理，`pickFolder` 空 path 沿用旧 root → **永远打不开新文件夹**。
> - `shell/src/io.rs:78`：壳层回显 `pristem@workspace % {command}`，与 UI 的 `›` 提示符并存 → 双提示符。
> - `Panels.tsx:168` `captureActive` 是**全局单例**；`workspace.tsx:515` `term.done` 无条件写 `PROMPT` → 多实例下必然互相污染。
> - `App.tsx:148` 只在 `s.handoff > 0`（advisor 交接路径）时自动 confirm，用户手动切 deepsleep 时不 confirm → 用户原话「为什么我自己要开 deepsleep 需要自己的同意」。
> - `App.tsx:494` `openFolderPicker = () => setActiveView('files')` —— **只切视图，什么都没做**。
> - `App.tsx:733` 与 `views.tsx:94` 各有一套按钮渲染 → **确认提示重复两处**（`.confirm-toast` 与 `.line-buttons`）。

---

## 目录

| 章 | 内容 | 对应任务 |
|---|---|---|
| §0 | 本文与 DESIGN_SYSTEM 的关系 · 3 处显式和解 · **D-1~D-5 硬约束落地位置** · **§0.7 与 DESIGN 的 5 处差异记录** · 8 条交互硬规则 | 总纲 |
| §1 | 模式切换状态机与转场契约（含 deepsleep 确认闭环最终结论） | A |
| §2 | 功能归属表（删掉菜单栏/活动栏后的每一项功能）+ 协议徽标 + 快速打开 | B |
| §3 | 设置页导航模型 | C |
| §4 | 终端三 tab 与多实例模型 | D |
| §5 | 打开文件夹全流程 | E |
| §6 | 空态 / 加载 / 错误 / 确认 四类分支的统一语法 | F |
| §7 | 键盘地图与焦点 | G |
| §8 | 无障碍与降级矩阵 | H |
| §9 | 13 条用户反馈 → 可执行验收步骤（QA 口径 + 断言 + **自动化覆盖对照表 §9.2**） | I |
| 附录 A | 新增 DOM 类名 / 选择器清单 | 施工 |
| 附录 B | 跨层依赖（壳层 + 内核）清单 B-1 ~ B-12 | 施工 |
| 附录 C | 新增 i18n key 全量文案（中/英） | 施工 |
| 附录 D | `check.cjs` 断言增补（可直接粘贴） | 施工 |
| 附录 E | Phase 3 施工顺序 11 步 | 施工 |
| 附录 F | **需要 visual-architect 给形态定义的新界面形态（F-1 ~ F-7）** | 跨角色请求 |

---

## §0 本文与 DESIGN_SYSTEM 的关系

### 0.1 权威边界

| 领域 | 唯一权威 | 本文做什么 |
|---|---|---|
| 色彩 / 字体 / 动效时长 / 尺寸 / 密度 | `DESIGN_SYSTEM.md` | **只引用，不复述数值，不改数值** |
| 组件形态（EmptyState 变体表、vitals 条、执行链、PresenceDial） | `DESIGN_SYSTEM.md` | 定义它们在什么状态下出现、出现时能点什么 |
| 信息架构、状态机、键盘、焦点、错误分支、降级 | **本文** | — |

本文与 `DESIGN_SYSTEM.md` 冲突时，以 `DESIGN_SYSTEM.md` 为准；本文中任何看起来越界的地方都已在 §0.2 逐条列出和解方式。

### 0.2 三处显式和解（DESIGN 内部两章的措辞需要收口，本文收口）

| # | 冲突点 | 冲突双方 | 收口结论 |
|---|---|---|---|
| **R1** | 左栏头部高度 | §7.1 草图标 `40px`；§4.4 明确「`--surface-rail`（左栏视图切换器头部的深色带，**仅 28px 高**）」；§7.4 说「左列头部 **24px** 的 3 段视图切换器」 | **取 §4.4 的 28px**：`.left-rail-head` 高 **28px**，`--surface-rail` 底；其中的 3 段切换器轨道高 **24px**（§7.4），上下各留 2px。§7.1 的 `40px` 是低分辨率草图标注，**作废**。 |
| **R2** | 设置页「模型与连接」分区是否显示连接状态 | §8.8.2 分区 2 列了「连接状态」；§8.3 **R-CONN-1** 规定「连接状态全局只有 1 处表达 —— 状态栏」；§9.6 **G12** 断言「全屏文本搜索『内核未连接 / 离线夹具』出现次数 = 1」 | **取 R-CONN-1 + G12**：分区 2 **不显示**连接状态文案，改为一行**指向**说明「传输状态显示在窗口底部状态栏」（不含被禁词）。设置页是覆盖工作区的层，状态栏此时仍可见 → 用户仍然只看到一处。 |
| **R3** | 唤醒简报卡「回到工作台」按钮的行为 | §8.4.3 把「唤醒简报卡片上的『回到工作台』」列为 deepsleep 的**第三条返回路径**；§8.5.1 定义「『回到工作台』（次按钮，**只关卡片**）」 | 两个按钮**都保留**：卡片上「回到工作台」= 关卡片 + 焦点移到舞台（**不改模式**）；卡片上「恢复会话」= `resume` + `switch_mode coding`（**改模式**）。第三条返回路径由**这一张卡片**承担，卡片上同时存在「不改模式」与「改模式」两个动作，**不存在死路**。 |

### 0.3 已裁定硬约束 D-1 ~ D-5 的落地位置（`DESIGN_SYSTEM.md` 附录 B′ / §9.8）

team-lead 裁定的 5 条硬约束是 **Phase 2 / Phase 3 / 验收的共同输入**。本文逐条对齐，落地位置如下（**违反判定**照抄附录 B′）：

| # | 硬约束 | 本文落地位置 | 状态 |
|---|---|---|---|
| **D-1** | deepsleep 三条返回路径各自独立可用；「继续工作」必须发 `switch_mode` 走内核，UI 不得自行 setMode | §1.7（三条路径逐条定义请求与前置条件）+ §0.3 H-1 + §9.1 第 2b 条 + 附录 D | ✅ 已对齐 |
| **D-2** | `openFolderPicker` 真的发 IO；`fs.pickFolder` 与 `fs.openFolder` 分离 | §5.2（含 `openFolder()` 的完整实现）+ §5.3 兜底 + §9.1 第 6/6b 条 | ✅ 已对齐 |
| **D-3** | 终端实例字段名固定为 **`instance: u32`（默认 0）**，不是 `term_id: String`；壳层未回传 `instance` 时只显示 1 个实例 | §4.3（协议 instance 号、缺省归实例 0、能力与实测双重判定）+ §9.1 第 13c 条 | ✅ 已对齐 |
| **D-4** | `Usage { session, input_tokens, output_tokens, cached_tokens, elapsed_ms, tool_calls }`（**不含** provider/model）；无 usage 事件时 vitals 条整条不渲染 | §3.4（provider 事实来自 `providers`/`provider_changed`）+ §4.2 + §9.1 第 4 条 | ✅ 已对齐 |
| **D-5** | 状态栏协议徽标必须读 `fs.list` 响应的 `protocol` 字段；UI 源码不得出现硬编码版本号 | §2.4（协议徽标）+ §3.3（关于分区同源）+ 附录 B 的 B-8 | ✅ 已对齐 |

**两条易被忽略的推论，已写进本文**：

1. **D-5 的降级形态是「不渲染」而不是「显示旧版本」**：壳层还没提供 `protocol` 字段时，状态栏**不渲染协议徽标**（不得写死 `pristem.ipc/v0.3`）。设置页 › 关于的 `pristem.ipc` 版本**读同一个来源**，没有就不显示该行。
2. **D-3b 的判定不能只靠能力探测**：除了「能力探测为 false」，**实际收到的 `term.output`/`term.done` 里没有任何 `instance` 字段**同样必须收敛到 1 个实例 —— 壳层可能实现了 `term.run.instance` 却忘了在事件里回传。判定规则见 §4.3。

### 0.4 与 D-1 ~ D-5 的相左项：**无**

本文逐条自查过 §0.3 的 5 条硬约束，**没有任何一条与 D-1 ~ D-5 相左**，因此不触发「写明相左、请 team-lead 裁定」的流程。

自查记录：

| 硬约束 | 本文最可能被认为相左的地方 | 自查结论 |
|---|---|---|
| D-1 | 唤醒简报卡上的「回到工作台」只关卡片、不改模式 —— 会不会让「第三条返回路径」失效？ | **不冲突**：DESIGN §8.5.1 本身就定义它是「只关卡片」；本文把它保留为「收起卡片」，而**卡片上还有「恢复会话」（`resume` + `switch_mode coding`）**承担改模式，且 deepsleep 层始终露出「继续工作」。D-1 要求的「三条路径各自独立可用」由「继续工作」/「状态栏模式控件」/「恢复会话」三条独立满足（D-1d）。 |
| D-2 | §5.2 的 `openFolder()` 在能力为 false 时**直接**走粘贴对话框，不先试原生 —— 会不会违反「主路径原生对话框」？ | **不冲突**：D-2 要求「点「打开文件夹」后有原生对话框**或**路径对话框」（违反判定原文）。本文在能力可用时走原生、不可用时走粘贴，能力未知时乐观发起 + 失败降级 —— 三种情况都满足 D-2 的判据。 |
| D-3 | 协议 instance 从 0 开始、显示名 `bash 1` = instance 0；Git 用保留通道 9000 —— 会不会违反「默认 0」？ | **不冲突**：D-3 说「默认 0」，本文正是「缺省即实例 0」。9000 是 UI 保留给内部 Git 通道的 id，不是用户实例，**不渲染成胶囊**，不违反「未回传时只显示 1 个实例」。 |
| D-4 | §3.4 的 provider 区块显示模型名 —— 会不会与 vitals 条重复？ | **不冲突**：D-4 明确「不含 provider/model，那两项由 `ProviderChanged`/`Providers` 提供」，本文正是**只在设置页**显示模型名，vitals 条**不显示**模型名（§1.5 / §9.1 第 4 条）。 |
| D-5 | §2.4 让状态栏徽标在 `protocol` 缺失时**不渲染** —— 会不会与「状态栏元素数 ≤ 6」冲突？ | **不冲突**：不渲染只会让元素更少。 |

### 0.7 与 `DESIGN_SYSTEM.md` 的差异记录（待 team-lead 转视觉负责人修正）

> 本文与 DESIGN 的**唯一权威来源分工**：DESIGN §8.12（W1–W11）= **文案正本**；UX_SPEC 附录 C.0 = **既有 key 的改写清单**。
> 以下 5 处是本文核对两份文档时发现的**不一致**。**本文一律按「已裁定 / 活动代码 / 多数条目」为准执行**，并把差异记在这里，请 team-lead 转视觉负责人修正 DESIGN 侧。

| # | 差异 | DESIGN 侧 | 本文采用 | 理由 |
|---|---|---|---|---|
| **Δ1** | **W2 的 key 名** | §8.12 W2 写 `mode.hint.deepsleep`；但 §8.12.1b 第 5/6 条与 §9.12 M11 写 **`modeHint.deepsleep`** | **`modeHint.deepsleep`**（活的） | `views.tsx:868` 读的是 `t(\`modeHint.${m}\`)`；`mode.hint.deepsleep` 无人引用（§8.12.1d 已定为死键 → 删） |
| **Δ2** | **W3 的 key 名** | §8.12 W3 与 §8.12.1b 第 7/8 条写 `mode.hint.deepsleepCost`；team-lead 裁定改名为 `mode.hint.deepsleepTitle` | **`mode.hint.deepsleepTitle`**（改名） | 遵循 team-lead 裁定。**连带依赖**：`views.tsx:863` 的 `t('mode.hint.deepsleepCost')` 必须**同一次**改掉，否则 `t()` 落到 `common.contentUnavailable`（第 23 条判据专查这个） |
| **Δ3** | **`.toast-stack` 的位置** | §9.10 **N20 / N26** 写定位 `right: 16px; bottom: 38px`（**右下角**） | **右上角** | team-lead 裁定 ②：右下角会压住 coding 模式下右侧控制台的 **composer 发送按钮**（5 秒内挡住主操作区）；右上角只压控制台头部。**「右上角」是行为约束不是 px 建议值** |
| **Δ4** | **英文禁用词清单** | §8.12.1 的英文表（`reviewing output chains` / `rules committed` / `committed during deepsleep` / `no new rules were committed`）与 team-lead 转达的清单（`reviewing its own output chains` / `New rules committed` / `submitted during sleep` / `summarize changes`）**不一致** | **取两份的并集**（12 词） | 断言宁可多查：两份里任一词残留都算不通过。判定以并集为准，DESIGN 侧后续统一到哪一份都不影响本文 |
| **Δ5** | **`help.deepsleep` 未被 §8.12.1b 收录** | §8.12.1b 的 19 条里没有 `help.deepsleep` | **补第 20–22 条**（见附录 C.0） | `help.deepsleep` = 「交回内核消化」/「Hand off to digestion」，命中 §8.12.1 禁用类别 ②；且 §7.3 已定命令帮助浮层整体删除 → 该 key 应**删除**。另有 `deepsleep.quiet` / `deepsleep.sleeping` 两个 chip 的删除（§8.12.1c） |

### 0.5 本文**不重新决策**的事项（直接引用 DESIGN_SYSTEM）

以下全部是 `DESIGN_SYSTEM.md` 已冻结的数值与规则，本文**只引用、不复述推导、不改动**：

| 类别 | 引用内容 |
|---|---|
| **动效 6 档时长** | `--t-instant 80ms` / `--t-fast 120ms` / `--t-base 180ms` / `--t-layout 320ms` / `--t-slow 560ms` / `--t-ambient`（5.2s–12s 按模式）；硬上限 640ms |
| **缓动三条** | `--ease-enter` / `--ease-move` / `--ease-exit`，分工按 DESIGN §5.2 |
| **同时循环动画** | ≤ 1（LIVING 层）；有加载态时骨架 shimmer 与 LIVING 呼吸互斥 |
| **密度上限** | 浮层 ≤ 560px ｜ 行内控件 ≤ 3 ｜ 卡片/列表项 ≤ 44px ｜ 面板嵌套 ≤ 3 ｜ 列表 ≤ 200 项 ｜ `.pane-head` = 32px ｜ 并列面板 ≤ 3 区 |
| **对比度** | `--text-1`/`--text-2` ≥ 7.0 ｜ `--text-3` ≥ 4.5 且**在 `--surface-raised`/`--surface-float` 上不可用**（这两处最低 `--text-2`）｜ `--text-4` 仅装饰、不得承载语义 |
| **空态 5 变体** | `first`（棱镜，全屏 ≤ 1）/ `zero` / `noresult` / `loading` / `error`；行动按钮 ≤ 2 |

**本文自己定的只有两类时间**（不与动效时长混用，单独声明以免误读）：

| 类别 | 本文取值 | 性质 |
|---|---|---|
| **交互/协议超时** | 静默代答兜底 2000ms ｜ pending 意图 TTL 3000ms ｜ pending 切换超时 8000ms ｜ 播报节流 500ms / 1500ms ｜ 搜索防抖 220ms ｜ markers 防抖 200ms | 这些是**等待与节流**的时限，不是 CSS 动画时长，不受 640ms 上限约束 |
| **常驻时间** | 唤醒简报「还有 N 条」折叠 —— 无时限（静态规则） | — |

**本文新增的任何界面形态**（错误态 / 确认态 / 浮层 / 胶囊）**不在本文发明 token 或数值**，统一列在**附录 F**，注明「用途 + 必须使用哪几个 token + 硬上限」，由 visual-architect 给形态定义。

### 0.6 八条交互硬规则（Phase 3 逐条对照）

| # | 规则 | 判据 |
|---|---|---|
| **H-1** | **模式只由内核决定。** UI 永远不写 `setMode`。任何模式变化只能发生在收到 `mode_changed` 之后。 | 代码审查：`ui/src/` 中不存在对 `session.mode` 的直接赋值（`mode_changed` 分支除外） |
| **H-2** | **界面上每个控件都必须在语义上可兑现。** 没有后端能力的控件一律不渲染或置灰 + 说明缺什么，禁止做成可交互的死控件。 | 代码审查：每个 `<button>` 都有对应的请求/状态变化 |
| **H-3** | **同一事实只有一处真相。** 连接状态只有状态栏；用量只有 vitals 条；字标只有标题栏；刻度器只有状态栏 + 标题栏模式控件。 | §9.6 G12 / B2 断言 |
| **H-4** | **状态不得仅靠动效或颜色表达。** 每个状态同时有文字标签或形状差异。 | §8.2 表逐条 |
| **H-5** | **任何异步 ≥ 200ms 的操作必有加载态；≥ 3s 必有文字说明。** 加载态不阻塞全局。 | §6.2 |
| **H-6** | **错误必须能重试或能给出可兑现的下一步。** 不可重试的错误（语义错误）给替代行动，不给「重试」。 | §6.3 |
| **H-7** | **确认只保留一处载体**（transcript 内联），不设全局浮层确认。 | `.confirm-toast` 元素数 = 0 |
| **H-8** | **浮层关闭后焦点必须回到触发元素**；模态浮层焦点不得逃到底层。 | §7.4 |

---

## §1 模式切换状态机与转场契约

### 1.1 状态定义

UI 侧为**每个会话**维护一个模式切换状态机（不是一个全局布尔）。当前实现 `App.tsx` 的 `switchMode` 直接发请求、无 pending 概念，是本节要替换的核心。

```
ModeSwitchState = {
  phase: 'idle' | 'pending' | 'confirming' | 'failed',
  target: Mode | null,          // 用户想去的模式
  origin: Mode,                 // 点击时的当前模式（用于错误文案）
  source: 'user' | 'advisor-handoff',
  buttonId: number | null,      // 内核 buttons 事件里对应的确认 id
  startedAt: number,            // 用于超时
}
```

| phase | 含义 | 允许的动作 |
|---|---|---|
| `idle` | 无进行中的切换 | 任意模式行可点 |
| `pending` | 已发 `switch_mode`，等内核回音（≤ 8s） | 模式菜单**保持打开**，全部行 `aria-disabled=true`；目标行显示「切换中」 |
| `confirming` | 收到内核 `buttons`，UI 正在（或将要）静默代答 | 卡片不渲染；2s 内没有 `mode_changed`/`error` → 降级为 `failed` 并把卡片显出来 |
| `failed` | 内核拒绝 / 超时 / 代答未生效 | 模式菜单底部渲染内联错误 + 恢复动作 |

**关键：`mode_changed` 是唯一的完成信号。** `phase` 回到 `idle` 只发生在收到 `mode_changed` 或 `error` 时。

### 1.2 一次切换的完整时序（以「coding → deepsleep」为例）

```
用户            UI                          内核
 │  点击模式菜单「deepsleep」行              │
 │ ──────────► │                            │
 │              │ phase=pending, target=deepsleep
 │              │ 发送 SwitchMode{deepsleep} │
 │              │ ─────────────────────────► │
 │              │                            │ add_pending(ModeSwitch(deepsleep))
 │              │ ◄──── Buttons{prompt:"Enter deepsleep?", buttons:[{id:N,choice:"deepsleep"}]} ──
 │              │ phase=confirming           │
 │              │ 命中规则：用户意图 target==button.choice 且 buttons.length==1
 │              │ → 静默代答                  │
 │              │ 发送 Confirm{id:N, choice:"deepsleep"} ─────────────────────────► │
 │              │                            │ manager.switch_mode() → 查 6×6 表
 │              │                            │ coding→deepsleep allowed=true
 │              │ ◄──── ModeChanged{from:coding,to:deepsleep} ──────────────────────
 │              │ phase=idle                 │
 │              │ 关闭模式菜单 / 刻度器过渡 320ms / 追加 transcript 系统行
 │              │ 播报「模式已切换为 深睡」
```

**分支（b-2）内核拒绝**（例：`helping → deepsleep`）：

```
 │              │ ◄──── Error{message:"mode transition helping -> deepsleep is forbidden: deepsleep entry requires a clean-instance handoff"} ──
 │              │ phase=failed
 │              │ 模式菜单保持打开，底部渲染内联错误：
 │              │   标题「不能从 helping 进入 deepsleep」
 │              │   原因「内核拒绝了这次转换：deepsleep entry requires a clean-instance handoff」
 │              │   行动 1 个：「先切到 coding 再进入 deepsleep」→ 发 SwitchMode{coding}
 │              │ 播报（assertive）「不能从 helping 切换到 deepsleep」
```

### 1.3 「用户的这一次点击就是同意」如何落地

**结论：可以接受，并且必须落地。** 理由三条：

1. 用户在模式菜单里点 `deepsleep` 是一次**明确的、指向唯一目标的主动行为**，它就是同意。再要求一次「Enter deepsleep?」是把同一次决定问两遍——这正是用户原话「为什么我自己要开 deepsleep 需要自己的同意？？？」所指的伤害。
2. 内核的这次确认**同时承担了两个职责**：① 人类许可；② **在真正切换的那一刻校验 6×6 转换表**。职责 ② 是安全关键，必须保留；职责 ① 是冗余的。UI 静默代答**不削弱**职责 ②——内核依然会在 `confirm` 分支里查表、依然会拒绝非法转换、依然会回 `Error`。
3. **代价不隐藏，但也不编造。** deepsleep 真实发生的代价是**归档当前会话 + 收窄工具面**（两项都由内核真实执行，依据见 §1.5）；UI 在**切换之前**用菜单行说明 + `title` 把这两项明说。内核 prompt 里那句关于启动独立实例的承诺**内核并不兑现**，因此前端不复述它、也不替它圆场。

**实现契约（静默代答）**：

| 规则 | 内容 |
|---|---|
| **R-C1 命中条件** | 同时满足全部三条才代答：① 存在 `phase==='pending'` 且 `source==='user'` 的意图；② `buttons.length === 1`；③ 该 button 的 `choice === intent.target`。 |
| **R-C2 一次性** | 维护 `answeredButtonIds: Set<number>`。同一 button id **只代答一次**；代答前先 `add`，重复事件直接忽略。 |
| **R-C3 作用域** | 代答只对 `switch_mode` 产生的 `buttons` 生效。以下三类**一律不代答、必须由人点击**：① `choice === 'release'`（隔离内容人工释放，是内核防线的安全闸）；② `buttons.length > 1`（内核给了多个选项，如 `ListModes` 的 6 选 1）；③ `choice !== intent.target`（意图不匹配，说明这是内核发起的其它询问）。 |
| **R-C4 时机（advisor 交接）** | `source==='advisor-handoff'` 的意图**不立即代答**：handoff 卡片动画（`handoff` 1→4，共 2100ms）跑完后才发 `Confirm`。实现：收到 `buttons` 时若 `handoff` 动画未结束，把 `buttonId` 存起来并挂一个 `handoffDone` 回调；动画结束的同一帧发 `Confirm`。这样 deepsleep 层不会盖掉交接动画。 |
| **R-C5 超时兜底** | 代答发出后 **2000ms** 内没有收到 `mode_changed` / `error` → `phase='failed'`，并把该 `buttons` 载荷**以卡片形式显出来**（`.line-buttons`），用户可以手动点。同时播报「内核没有确认这次切换」。 |
| **R-C6 意图 TTL** | `pending` 意图 3s 未收到任何内核回音 → `phase='failed'`，错误文案「内核没有回应这次切换」，行动「重试」。 |
| **R-C7 不静默失败** | 任何 `phase='failed'` 都必须在**模式菜单内**可见（不只是 toast），因为失败发生在用户正看着的菜单里。 |

**代答不是「假装」。** UI 必须在两处留下可见记录：
- 切换完成后在 transcript 追加一条系统行：`deepsleep · 会话已归档，工具面已收窄`（§1.5）。
- deepsleep 层本身显示：`当前会话已归档，工具面已收窄。智能体保持安静，直到你请求唤醒简报。`（§1.5）。

### 1.4 「点击前阻止」还是「点击后裁决」——最终判断

**决策：点击后由内核裁决，UI 不预判、不置灰任何模式行。**

| 方案 | 判断 |
|---|---|
| UI 硬编码一份 6×6 转换表，点击前置灰非法目标 | **否决。** ① 违反「同一事实只有一处真相」——转换表是内核的语义，UI 抄一份必然漂移；② 6×6 表里 30/36 是自由转换，只有 deepsleep 的进/出受限，为 6 个例外复制整张表不划算；③ 内核演进时 UI 的表会静默过期，产生「界面说能切、切了被拒」的最坏体验。 |
| 让内核新增 `list_transitions` 事件 | **本阶段不做。** 收益仅是提前置灰 2 类目标；代价是协议升版 + 内核改造 + UI 双路径（表到位前/后行为不同）。用户最痛的是 deepsleep **要点两次**，不是「非法目标没有提前变灰」。**作为 v0.5 的可选增强**：若内核愿意提供，UI 收到后把非法目标置灰并显示原因，UI 逻辑预留一个 `transitions` 字段，**当前恒为空 → 不置灰任何行**。 |
| **点击后由内核裁决 + UI 诚实呈现 + 给必然可兑现的恢复动作** | **采用。** ① 不新增协议；② 错误来自内核原文，100% 准确；③ 恢复动作「先切到 coding 再进入 deepsleep」在 6×6 表里必然可兑现（`coding → deepsleep` = `allowed:true`），不是编的。 |

**错误文案规范（必须是内核原文 + UI 的中文标题）**：

| 场景 | 标题 | 原因 | 行动（≤2） |
|---|---|---|---|
| 内核拒绝转换 | 「不能从 {from} 切换到 {to}」 | UI 解析 `Error.message`：`mode transition {from} -> {to} is forbidden: {note}` → `{note}` 原文（mono 10.5px） | 「先切到 coding 再进入 deepsleep」（仅当 from≠coding 且 coding→to 合法） |
| 内核报未知模式 | 「内核不认识这个模式」 | 原文 `unknown mode \`{x}\`` | 无（去掉重试） |
| 代答未生效 / 超时 | 「内核没有回应这次切换」 | 「模式没有改变，可以再试一次」 | 「重试」 |

**错误出现在哪里**：模式菜单**保持打开**，错误渲染在菜单底部（`.mode-menu-error`），形态 = `EmptyState variant="error"`（DESIGN §8.10：左侧 2px `--danger` 竖条、无图标、13px/600 标题、11.5px 描述）。**不使用**全局浮层。

### 1.5 deepsleep 的真实代价怎么诚实表达（不隐藏，也不编造）

**先划清「内核真的发生了」与「内核并没有发生」**（依据见 §1.9）：

| 代价 | 内核是否真的发生 | 依据 |
|---|---|---|
| **归档当前会话** | **是** | 进入 deepsleep 时会话被 `archived`；`ModeRouter::switch()` 重置上下文分区（`session.rs` `switch_mode`） |
| **收窄工具面** | **是** | `mode.rs:88` Deepsleep = `read / search / solo / pause / reminder`（**5** 个）；`mode.rs:58` Coding = `read/search/write/edit/delete/exec/reminder/skill-load/improve`（**9** 个）。`agent_loop.rs:203` `validate_calls_for_mode(&calls, &firewall.tool_table)` —— 越界调用**会被拒** |
| **智能体保持安静** | **是** | deepsleep 期间没有任何 round 在跑（§1.9） |
| ~~启动独立实例~~ | **否** | `DeepsleepEngine::spawn_clean_instance` 生产代码零调用方（`lib.rs:160/175/197` 全在 `#[cfg(test)]` 内） |
| ~~消耗 token（新一轮推理）~~ | **否** | 没有 round 就没有推理；独立实例未接线 |
| ~~复盘输出链~~ | **否** | 同上 |
| ~~在休眠期间提交新规则~~ | **否** | 规则只由模型在**普通轮次**里调 `reminder` 工具写入（`executor.rs:316` `"reminder" => reminders.append(session, Reminder{ source: "round" })`）；deepsleep 期间没有轮次 |

> **代价只有两项真实发生：归档会话 + 收窄工具面。界面只说这两项。**
>
> 内核自己的 prompt 字符串 `"Enter deepsleep? A clean instance will be spawned."` 在承诺一件它不做的事 —— 该字符串的修改属内核责任（已由 team-lead 转给 Rust 侧）。**前端不替它圆场，也不复述它**：附录 B 的 **B-11 已撤回**（不再要求内核暴露长 prompt），UI 改用自己的诚实文案。

**四处表达（逐字采用团队权威文案表）**：

| 时机 | 位置 | 文案 | 来源 |
|---|---|---|---|
| **切换前** | 模式菜单 `deepsleep` 行的说明列 | 「归档会话 · 收窄工具面」 | `modeHint.deepsleep` |
| **切换前** | 模式菜单 `deepsleep` 行的 `title` | 「进入 deepsleep 会归档当前会话并收窄工具面，智能体保持安静直到你请求唤醒简报。」 | UI 静态文案 |
| **切换后** | transcript 系统行 | 「deepsleep · 会话已归档，工具面已收窄」 | UI 依据 `mode_changed{from,to}` 生成 |
| **切换后** | deepsleep 中央列说明（`deepsleep.note`） | 「当前会话已归档，工具面已收窄。智能体保持安静，直到你请求唤醒简报。」 | UI 静态文案 |

**用量**：vitals 条**只来自内核 `usage` 事件**（in / out / cached / elapsed / tool_calls 五项，**不含** provider / 模型名，D-4a）；无事件则**整条不渲染**（D-4b）。

### 1.6 pending 期间 UI 的精确状态

| 元素 | pending 时的状态 |
|---|---|
| 模式菜单 | **保持打开**（不自动关闭）。全部 6 行 `aria-disabled="true"` + `pointer-events:none`（保留键盘焦点，不用 `disabled` 以免焦点丢失）。 |
| 目标行 | 行尾追加 6px `--beam` **静态**点（`animation: none` —— 不新增循环动画，DESIGN §5.5 / N6）+ 文字「切换中」（`--fs-label` 11px/500 `--text-2`）。**状态有文字，不只靠动效**，H-4。 |
| 其它 5 行 | 降低对比（**`--text-2`**，模式菜单底是 `--surface-float`，text-3 在 float 上不可用），保持可读；点击无效。 |
| 状态栏模式控件 | 模式名后追加「· 切换中」（11px `--text-3`）。 |
| 重复点击 | 被 `phase!=='idle'` 拦截；`switchMode` 在 `phase!=='idle'` 时直接 return（幂等）。 |
| 菜单关闭 | `Esc` / 外部点击 / 点模式行之外的空白 → 关闭菜单，**`phase` 保持 `pending`**（内核的切换仍在进行）；`mode_changed` 到达后正常更新。 |
| **菜单底部** | **只保留 `.mode-menu-error` 区** —— pending **不**在底部另起一行（同一事实只有一处表达，H-3；DESIGN N6）。 |
| 超时 | 8s 无回音 → `phase='failed'`，菜单内错误「内核没有回应这次切换」+「重试」。 |

### 1.7 deepsleep 的三条返回路径（DESIGN §8.4.3 的可施工化）

| # | 路径 | 触发元素 | 请求 | 前置条件 | 结果 |
|---|---|---|---|---|---|
| **P1** | 「继续工作」主按钮 | deepsleep 层中央列底部，`.deepsleep-resume`（36px 主按钮） | `SwitchMode{coding}` **仅此一条** | 无（deepsleep→coding 在 6×6 表里 allowed=true，且非 deepsleep 目标不会触发 `buttons`） | 一次点击即回到 coding，**不需要第二次确认** |
| **P2** | 状态栏模式控件 | `.mode-glyph`（状态栏左区第一项）→ 模式菜单 → 点 `coding` | `SwitchMode{coding}` | 无 | 与 P1 同路径，多一次菜单点击 |
| **P3** | 唤醒简报卡片 | `.wake-card` 底部的「恢复会话」主按钮 | `resume` 然后 `SwitchMode{coding}` | 已有简报 | 先恢复暂停的循环再回到 coding |

**P3 卡片的另一个按钮「回到工作台」**：只关卡片（本地 state）+ 焦点移到舞台，**不改模式**（DESIGN §8.5.1）。因此关闭卡片后 deepsleep 层露出，用户仍能按 P1 离开 —— **不存在死路**。

**卡片不得遮挡 P1**：`.wake-card`（480px 宽）在 deepsleep 层内**顶部 48px** 起排；deepsleep 层的行动行固定在层底部（`padding-bottom:24px`），z-index 高于卡片。视口高度 < 700px 时卡片改为**可滚动**（`max-height: calc(100% - 160px); overflow:auto`），行动行仍可见。

### 1.8 模式菜单的最终结构

```
┌──────────────────────────────────────────┐
│ 切换模式                                  │  ← eyebrow（拉丁/数字，不 uppercase 中文）
├──────────────────────────────────────────┤
│ [▮▮▮▮▮]  goal       只谈目标，隐藏代码库   ✓│
│ [▮▮▮▮▯]  coding     编辑与对话并行         │
│ [▮▮▮▯▯]  advisor    批注代码并交回内核     │
│ [▮▯▯▯▯]  helping    执行流停靠在文件树下方 │
│ [▯▯▯▯▯]  deepsleep  归档会话·收窄工具面      │  ← title 说明代价
│ [     ]  IDE        仅编辑器，无智能体      │
├──────────────────────────────────────────┤
│ [▮▮▮▮▯]  coding     编辑与对话并行   ● 切换中│  ← pending：点在目标行尾，不在底部
├──────────────────────────────────────────┤
│ (failed 时)  ▎不能从 helping 切换到 deepsleep│  ← EmptyState variant="error"
│              内核拒绝了这次转换：…         │
│              [先切到 coding 再进入 deepsleep]│
└──────────────────────────────────────────┘
```

- 6 行**全部不置灰**（§1.4 决策）。
- 刻度器每行显示自己的档位（DESIGN §6.5）。
- 当前档位行：`.is-current` + 背景 `--beam-wash` + 左侧 2px `--beam` 竖条 + 右侧 `✓`。
- **pending 只在目标行尾**（6px `--beam` **静态**点 + 文字「切换中」`--fs-label` 11px/500 `--text-2`）；**菜单底部只保留 `.mode-menu-error` 区**。
  → **同一个事实只有一处表达**（H-3）：pending 不再在底部另起一行。
  → 对应 DESIGN §9.10 **N6**（含「菜单内不出现进度类转圈」「状态点一律静态不脉冲」）。
- `.mode-menu-error` **直接复用 `EmptyState variant="error"`**（左 2px `--danger` 竖条 + 13px/600 `--text-1` 标题 + 11.5px `--text-2` 描述，左对齐）→ DESIGN §9.10 **N7**。

### 1.9 deepsleep 期间的内核事件流 —— 执行链到底有没有数据（回应「最关键的交互缺口」）

**先纠正一个前提**：`App.tsx` 的 `dormant(s.mode)` **不会**丢弃 deepsleep 期间的事件。`types.ts:135` 的定义是 `dormant = (m) => m === 'IDE'` —— **只有 IDE 算 dormant**。现状真正丢弃事件的是另一条：`App.tsx:142` 的 `if (s.mode === 'goal' && (ev.type === 'call' || ev.type === 'result')) return s;`（goal 模式丢弃 call/result，与 deepsleep 无关）。

**所以「事件被 UI 丢掉」不是阻塞点。真正的阻塞点是内核侧：deepsleep 期间主会话没有 round 在跑。**

内核事实（已核对源码）：

| 事实 | 出处 | 对 UI 的含义 |
|---|---|---|
| deepsleep 的工具表 = `read / search / solo / pause / reminder`，输出标签 = `answer / call / solo` | `mode.rs:93-95, 99-106` | deepsleep **有** `call` 输出标签 —— 协议层**允许**发 call/result |
| **`switch_mode` 只做两件事**：`ModeRouter::switch()` 换工具表 + 重置上下文分区。**它不 spawn clean instance、不启动任何后台工作、不发任何事件** | `session.rs` `switch_mode()` 全文 | **进入 deepsleep 时内核什么都不会开始跑** |
| `DeepsleepEngine::spawn_clean_instance` **在生产代码里没有任何调用方** —— 唯一调用点是 `pristem-deepsleep/src/lib.rs` 的三个单元测试 | `lib.rs:160 / 175 / 197`（全部在 `#[cfg(test)]` 内） | 「独立实例接手复盘」这个说法**目前没有能力支撑** |
| **所有 round 事件都来自 `AgentLoop::run`**，而 `AgentLoop::run` 只被 `SessionManager::submit` 调用，`submit` 只被 `ClientRequest::SubmitRound` 触发 | `agent_loop.rs`（`observer.on_event(...)` 全部在 `run` 内）、`session.rs` `submit()`、`server.rs` 的 `SubmitRound` 分支 | **不发 `submit_round` → 一个事件都不会有** |
| `BackgroundJobs::spawn` 起的是 **shell 命令线程**，**没有 observer** | `executor.rs` | 后台作业也**不发事件** |
| deepsleep 的执行体（若接线）是一个**独立实例（Rust 侧 `CleanInstance`）**：全新上下文，探索归档与输出链，**只**通过 `edit-solo` 写 `SOLO.md` | `pristem-deepsleep/src/clean_instance.rs`（`DEEPSLEEP_SYSTEM_PROMPT` + `CleanInstance::spawn`） | 它跑在 **solo 通道**上，产出写 `SOLO.md`，**不进主会话的事件流** |
| 会话进入 deepsleep 后被 `archived: true`，没有新的 `submit_round` | `App.tsx:129` | **没有 round → 没有 `call`/`result` 事件** |

**结论（可施工，不含糊）**：

> **deepsleep 期间内核不会向该会话发 `call` / `result` 事件 —— 而且不是「UI 拦掉了」，是内核根本没有事件可发。**
>
> 因此 **UI 不需要放开任何过滤**（`dormant` 只对 IDE 为真，过滤本身是对的）；真正缺的是内核侧的事件。DESIGN §8.4.2 中央列画的那条「休眠期间的执行链」**当前没有数据来源** —— 那是一个**空口承诺**，Phase 3 直接照画会得到一个永远空的框。

**本规范给出两级处理**：

| 级别 | 内容 | 何时生效 |
|---|---|---|
| **L-实装（当前内核可兑现）** | deepsleep 中央列的链**展示「进入休眠前那一轮已发生的执行链」** —— 数据来自 UI 本地 transcript 里进入 deepsleep 前的 `call`/`result` 条目（`App.tsx` 已经在收集）。**标题必须写实**：`进入休眠前的执行链 · N 步`（**不是**「休眠期间的执行链」）。链为空时该区块**整块不渲染**（不画空框）。 | 立即可用，无内核改动 |
| **L-远期（需要内核补两件事）** | ① 内核在 `switch_mode(Deepsleep)` 时真正 `spawn_clean_instance` 并跑起来；② 把 clean instance 的 solo 活动以 `call`/`result`（带 `session`）回灌主会话事件流。两者齐备后，该链升级为真正的「休眠期间的执行链」，标题改为 `休眠期间的执行链 · N 步`。 | 见附录 B 的 **B-12**（本文新增，P2） |

**UI 侧的硬约束（无论内核是否补 B-12 都成立）**：

1. deepsleep 层**不得**渲染一个标题为「休眠期间的执行链」但数据来自休眠前 transcript 的区块 —— 那是撒谎。
2. deepsleep 层**唯一**还能拿到的内核数据是**唤醒简报**（`reminder` 事件）—— 但它展示的是**之前轮次里写入、当前仍然生效**的规则，**不是休眠期间产生的新规则**（deepsleep 期间没有轮次 → 没有 `reminder` 工具调用 → 不会有新规则；依据 `executor.rs:316`）。文案必须据此写（§1.10）。
3. deepsleep 层的「用量」区**只在有 `usage` 事件时渲染**（D-4b）。deepsleep 的独立实例走的是另一条推理路径，**当前不产生 `usage` 事件** → 该区在 deepsleep 下**整块不渲染**。若内核将来为 digest 路径发 `usage`，按同一位置渲染。
4. **UI 不得为「等待内核在休眠期发事件」而占位**：deepsleep 层**不渲染**任何「正在分析…」「等待消化…」的动态进度 —— 内核确实没在跑，画一个转圈就是在编。
5. **睡 log（DESIGN §5.4 的 4s 推一行）的行内容必须是「时间标记」，不能是休眠前的工具输出**：现状 `views.tsx` 的 `logs = items.slice(-4)` 会把**休眠前**的 transcript 条目当成睡 log 显示 —— 那会让用户以为智能体在休眠期间还在干活。**改为**：每行只显示「归档后经过的时间」（mono 10.5px，形如 `已归档 · 00:12`），首行是归档时刻本身。数据来源 = **本地时钟**（进入 deepsleep 的时刻 + 当前时刻），**不含任何内核数据**。这诚实表达「时间在走」，不暗示「在干活」。
   - 视觉形态（4s 一行、104px 容器、mask 渐隐、12s 呼吸光晕）**不变**，只有**内容**变 —— 不需要新的形态定义。
   - **行的格式**：首行 = `deepsleep.noLog` = 「已归档」；其后每行 = `已归档 · HH:MM`（**墙钟时刻**，每 4s 一行）。EN 形态 `Archived` / `Archived · HH:MM`（DESIGN §9.12 **M12** 的正则）。
   - **断言（M12）**：`.sleep-log` 的全部文本节点逐行匹配上述形态；**不得**出现工具名、文件名、`ok`/`blocked` 状态或任何来自 transcript 的文本；并断言与 `items` / transcript **无交集**。
   - 说明行用 `deepsleep.noLogDesc` = 「休眠期间不会产生新的执行记录；这里只显示经过的时间。」（附录 C.0）。
6. **「时间在走」与「在干活」必须分得清**：唯一允许动的元素是 12s 慢呼吸光晕 + 4s 一行的睡 log（**时间流逝**）。任何表示**工作进度**的动效（转圈、进度条、正在分析…）一律禁止。

### 1.9b deepsleep 期间控制台（AI 面板）在不在 —— 决定

**决策：deepsleep 不渲染控制台**（保持 `DESIGN_SYSTEM.md` §7.3 模式差异表的「CONSOLE：无」）。

理由（四条，按重要性）：

| # | 理由 |
|---|---|
| 1 | **一致性**：deepsleep 的工作台整体是「变暗 + `pointer-events:none` 的背景」—— 编辑器、文件树、活动带**都不可滚动、不可交互**。单独给对话开一个可读区，与「背景」的语义自相矛盾。 |
| 2 | **不重复表达**：控制台是 `data-ai="true"` 表面。deepsleep 档位 = 1（智能体在休息），把一个「随时能说话」的输入面摆在旁边，会让用户以为它还醒着 —— 这正是用户抱怨的「看起来在忙，其实没有」。 |
| 3 | **内容不丢**：对话数据在 `active.items`，`mode_changed` **不清空**它。「继续工作」一次点击后完整可见（§1.7 的 P1）。 |
| 4 | **已有替代**：deepsleep 层用「进入休眠前的执行链」（可逐行展开到**原始输出**，DESIGN §8.7.3 的 L3）+ **唤醒简报**承载了「它刚才做了什么 / 它学到了什么」。用户要的是结论，不是全文。 |

**如果将来要改成只读控制台**，条件是同时满足：① deepsleep 层**不覆盖**右侧列（即层只覆盖左列 + 舞台）；② 控制台有独立的只读形态（无 composer、无发送框）；③ 状态栏元素数 ≤ 6 不被破坏（F8）。**当前不具备这三条，因此不做。**

### 1.10 唤醒简报清单项的语义 —— 每条是「当前生效的规则」还是「变更摘要」

**结论：每一条 = 一条当前生效的 REMINDER 规则（必答约束），不是变更摘要；且这些规则是在**之前的轮次**里写入的，不是休眠期间产生的。**

内核事实（已核对源码）：

| 事实 | 出处 |
|---|---|
| `ServerEvent::Reminder { session, lines: Vec<String> }` 的 `lines` 来自 `ReminderStore::required_lines(session)` —— 它把 global + per-session 的每条 `Reminder` 的 `lines` **去重后依次累加** | `pristem-harness/src/reminder.rs` |
| `Reminder::new(id, &["REMINDER: preserve v0.3.0"], ...)` —— `lines` 就是**规则文本本身** | 同上（单元测试） |
| 这些行被 `pristem-defense` 的 **answer gate** 消费：`answer_gate("done", session, tier, &src)` 在规则未满足时 `must_not_answer()` | `pristem-defense/src/outbound.rs`（`ReminderSource` trait + `answer_gate`） |
| **规则只由模型在普通轮次里调 `reminder` 工具写入**：`"reminder" => reminders.append(session, Reminder{ source: "round" })` | `pristem-core/src/executor.rs:316` |
| 转换表对 deepsleep 退出的 note 是 "wake briefing is the new-rules commit point" | `mode.rs:152` —— 这是**内核对转换点的命名**，不是「休眠期间产生了新规则」的承诺 |

**推论（必须写进文案）**：**deepsleep 期间不会有任何新规则产生**（没有轮次 → 没有 `reminder` 工具调用）。所以唤醒简报展示的是**之前轮次里写入、当前仍然生效**的规则，**不是**「休眠期间的新规则」。徽章因此从「已提交新规则」改为「**当前生效的规则**」。

**UI 必须表达的四件事**：

| # | 表达 | 落地 |
|---|---|---|
| 1 | **每条是一条规则，不是一条变更** | 列表项**不加**文件图标、不加「改了 X」的前缀；用编号 + 规则原文（正文 12px `--text-1`）。DESIGN §8.5.2 的清单形态（`01/02/03` 等宽前缀）**正好适合规则**，保留。 |
| 2 | **规则来自之前的轮次** | 卡片 lead 一行（12px `--text-2`），逐字用：「**这些规则由智能体在之前的轮次里写入，恢复会话后它们会参与回答检查。**」—— 这是 answer gate 的真实语义，不是修辞。**不得**写成「在休眠期间提交」。 |
| 3 | **这些规则会被检查** | 同上句的后半段「恢复会话后它们会参与回答检查」就是强制力的表达。 |
| 4 | **用户不能编辑它们** | 内核**没有**修改/删除 reminder 的请求（`ClientRequest` 里不存在），因此清单项**不渲染**任何编辑/删除/勾选控件。唯一的动作是「恢复会话」（让规则参与检查）与「回到工作台」（先不看）。 |

**徽章**：逐字用「**当前生效的规则**」（DESIGN §8.5.2 的「已提交新规则」据此修订）。

**三种状态必须区分开**（现状混在一起了）：

| 状态 | 判定 | 呈现 |
|---|---|---|
| **还没请求** | `wakeBriefing === null` | deepsleep 层显示「还没有唤醒简报」+ 行动「请求唤醒简报」（现状行为，保留） |
| **请求了，但没有生效的规则** | `wakeBriefing` 是**空数组** | 卡片打开，正文逐字用「**当前没有生效的规则。**」+ 只留「回到工作台」（**不渲染「恢复会话」** —— 没有规则就没有需要参与检查的东西） |
| **有生效的规则** | `wakeBriefing.length > 0` | 卡片打开，lead + 编号清单（≤5 条，超出「还有 N 条」）+ 两个按钮（「回到工作台」/「恢复会话」） |

**规则条数上限**：DESIGN §8.5.2 已定「最多 5 条，超出折叠为『还有 N 条』」。**不重新决策。**

---

## §2 功能归属表（删掉菜单栏与活动栏后）

### 2.1 旧入口 → 新入口（逐条，10 个菜单动作 + 7 个活动栏入口，全部有归属）

**会话（原「会话」下拉，3 项）**

| 旧入口 | 新入口 | 键盘路径 | 视觉位置 | 语义兑现 |
|---|---|---|---|---|
| 会话 › 新建会话 | 会话带末尾 `+` 按钮 | 命令面板「会话：新建会话」 | R1 会话带右侧（`.new-tab` 24×24） | `open_session{mode:'coding'}` |
| 会话 › 关闭当前会话 | 会话胶囊上的 `✕` | 命令面板「会话：关闭当前会话」 | R1 胶囊内（`.tab-x` 12px，hover 显现） | `close_session{session}`；关闭最后一个时自动新建一个空会话（现状行为保留） |
| 会话 › 恢复上次会话 | **无独立按钮**（避免"点了没反应"的重复入口） | `Shift + @ + S`；命令面板「会话：恢复上次会话」 | — | 现状 `loadLastSession()`：优先切回上一个标签，否则重开最近关闭的会话（**必须在帮助/快捷键表里说明这是"标签恢复"，不是内核的归档加载**，因为内核没有归档枚举接口） |

**视图（原「视图」下拉 3 项 + 活动栏 5 项）**

| 旧入口 | 新入口 | 键盘路径 | 视觉位置 | 语义兑现 |
|---|---|---|---|---|
| 视图 › 文件树 | 左栏头部 3 段切换器「文件」段 | `Ctrl+Shift+E`；命令面板「视图：文件」 | 左栏头部 `.left-rail-head` 第 1 段 | `FileTree`（目录可展开，DESIGN §8.6.3） |
| 视图 › 搜索 | 左栏头部「搜索」段 | `Ctrl+Shift+F`；命令面板「视图：搜索」 | 第 2 段 | `SearchPanel`（客户端全文搜索，上限 200 条） |
| 视图 › 版本(git) | 左栏头部「版本」段 | `Ctrl+Shift+G`；命令面板「视图：版本」 | 第 3 段 | `GitPanel`（真实 `git` 命令，哨兵帧） |
| 活动栏 › 大纲 | **文档状态条上的「符号」按钮**（22px doc strip 右侧图标 14px）→ 锚定浮层 `.outline-pop` | `Ctrl+Shift+O`；命令面板「视图：大纲」 | STAGE 顶部 doc strip（`breadcrumb` 右侧，`Ln/Col` 左侧） | `parseOutline()` + 跳行。**理由**：3 段切换器被 DESIGN 固定为「文件/搜索/版本」，大纲是**当前文档**的属性而非工作区的投影，放 doc strip 才不撒谎。 |
| 活动栏 › 终端 | **活动带（ACTIVITY STRIP 176px）的「终端」tab** | `Ctrl + \`` 聚焦终端；命令面板「终端：聚焦」 | 窗口底部活动带 | xterm 面板（多实例，见 §4） |
| 活动栏 › 快捷键 | 设置页 › 快捷键 分区 | `Ctrl+,` 后进入；命令面板「帮助：命令与快捷键」 | 设置页左导航第 6 项 | 键位表 + 命令表（只读） |
| 活动栏 › 设置 | **左栏头部 ⚙ 按钮** + 设置页 | `Ctrl+,`；命令面板「设置：打开」 | 左栏头部右端（24×24） | 独立设置页（§3） |

**内核（原「内核」下拉 3 项）**

| 旧入口 | 新入口 | 键盘路径 | 视觉位置 | 语义兑现 |
|---|---|---|---|---|
| 内核 › 暂停 | **命令面板**「内核：暂停」 | `Ctrl+Shift+P` → 输入「暂停」 | —（不占常驻视觉位置） | `pause{session}` → 内核 `advisor.pause()`。**说明**：暂停只作用于 advisor 的循环，所以**不放在模式菜单里**（模式菜单是刻度器的展开视图，DESIGN §2.5） |
| 内核 › 恢复 | 命令面板「内核：恢复」 | 同上 | — | `resume{session}` → `advisor.resume()` |
| 内核 › 切换模式… | **状态栏模式控件**（常驻）+ F2 + 命令面板 6 条「模式：…」 | `F2` 打开模式菜单；`Ctrl+Shift+P` → 「模式：coding」等 | R4 状态栏左区第一项（`.mode-glyph`） | `switch_mode`（§1） |

**帮助（原「帮助」下拉 3 项）**

| 旧入口 | 新入口 | 键盘路径 | 视觉位置 | 语义兑现 |
|---|---|---|---|---|
| 帮助 › 快捷键 | 设置页 › 快捷键 | `Ctrl+,` | 设置页左导航第 6 项 | 只读键位表 |
| 帮助 › 命令列表 | 设置页 › 快捷键 分区的**「命令表」子表**（与键位表同页） | `Ctrl+,` | 同上 | 只读命令表。**不与「快捷键」分成两个入口**——两者的内容是同一张表的两半，分成两个菜单项就是两个「点了没反应」的近似物 |
| 帮助 › 关于 | 设置页 › 关于 | `Ctrl+,` | 设置页左导航第 7 项 | 棱镜 64px + 版本 + `pristem.ipc` 版本（读 `fs.list.protocol`，无则不渲染该行）+ 构建标识 + 许可 |

### 2.2 左栏头部 3 段视图切换器（可施工规格）

```
┌─ .left-rail-head  高 28px  底 --surface-rail  下边 1px --line-hair ─────────────┐
│ [ 文件 ][ 搜索 ][ 版本 ]                                        [ ⚙ ]        │
│  ↑ .view-seg  高 24px  轨道 --surface-inset + 1px --line-hair  --r-3  gap:2px │
└──────────────────────────────────────────────────────────────────────────────┘
```

| 项 | 规格 |
|---|---|
| 容器 | `.left-rail-head`，`height: 28px`，`background: var(--surface-rail)`，`border-bottom: 1px solid var(--line-hair)`，`display:flex; align-items:center; gap:8px; padding:0 8px 0 10px` |
| 切换器 | `.view-seg`，`display:inline-flex; height:24px; background:var(--surface-inset); border:1px solid var(--line-hair); border-radius:var(--r-3); gap:2px; padding:2px` |
| 单段 | `height:18px; padding:0 10px; font: var(--fs-body-sm) 12px/1 var(--font-ui); color: var(--text-3); border-radius:2px` |
| 选中段 | `background: var(--surface-raised); color: var(--text-1); box-shadow: inset 0 -2px 0 var(--beam)` |
| hover | `color: var(--text-2)`，`--t-fast` 120ms |
| 语义 | `role="tablist" aria-label="视图"`；每段 `role="tab" aria-selected`；**roving tabindex**（组内仅当前段 `tabindex=0`，`←/→` 移动） |
| ⚙ 按钮 | 24×24 `icon-btn`，`aria-label="设置"`，打开设置页；**右端**，与切换器之间 `margin-left:auto` |
| 高度来源 | §0.2 R1：28px 带 + 24px 切换器（§7.4） |

**左栏只有这 3 段。** 终端在活动带，大纲在 doc strip，快捷键在设置页 —— 没有第 4 段，没有活动栏。

### 2.3 命令面板（`Ctrl+Shift+P`）承载的完整命令表

命令面板 = **全部命令的唯一索引**。每条都有：稳定 id、中文名、快捷键（可空）、执行体、来源。

| # | id | 中文名 | 快捷键 | 执行 |
|---|---|---|---|---|
| 1 | `session.new` | 会话：新建会话 | — | `open_session{coding}` |
| 2 | `session.close` | 会话：关闭当前会话 | — | `close_session` |
| 3 | `session.restore` | 会话：恢复上次会话 | `Shift+@+S` | `loadLastSession()` |
| 4 | `view.files` | 视图：文件 | `Ctrl+Shift+E` | `activeView='files'` |
| 5 | `view.search` | 视图：搜索 | `Ctrl+Shift+F` | `activeView='search'` |
| 6 | `view.git` | 视图：版本 | `Ctrl+Shift+G` | `activeView='git'` |
| 7 | `view.outline` | 视图：大纲 | `Ctrl+Shift+O` | 打开 doc strip 符号浮层 |
| 8 | `file.openFolder` | 文件：打开文件夹 | — | §5 的 `openFolder()` |
| 9 | `file.newFile` | 文件：新建文件 | — | `fs.write` + 打开 |
| 10 | `file.quickOpen` | 文件：快速打开 | `Ctrl+P` | 打开快速打开面板 |
| 11 | `file.closeWorkspace` | 文件：关闭工作区 | — | 清空 root/files/openFiles |
| 12 | `kernel.pause` | 内核：暂停 | — | `pause` |
| 13 | `kernel.resume` | 内核：恢复 | — | `resume` |
| 14 | `kernel.wake` | 内核：请求唤醒简报 | — | `list_reminders` |
| 14b | `kernel.reconnect` | 内核：重试连接 | — | 重新建立事件流（**不重发任何业务请求**）；等价于点击状态栏连接指示器 → 「重试连接」 |
| 15–20 | `mode.coding` / `mode.IDE` / `mode.helping` / `mode.advisor` / `mode.deepsleep` / `mode.goal` | 模式：编码协作 / 仅编辑器 / 协助执行 / 审阅席 / 深睡 / 目标 | `F2` 打开菜单 | `switch_mode`（§1） |
| 21 | `term.focus` | 终端：聚焦 | `Ctrl+\`` | 聚焦当前终端实例 |
| 22 | `term.new` | 终端：新建实例 | — | 新建实例（**壳层不支持多实例时该命令不出现**） |
| 23 | `term.output` | 终端：打开输出 | — | 活动带切到「输出」tab |
| 24 | `term.problems` | 终端：打开问题 | — | 活动带切到「问题」tab |
| 25 | `settings.open` | 设置：打开 | `Ctrl+,` | 打开设置页 |
| 26 | `help.keys` | 帮助：命令与快捷键 | — | 设置页 › 快捷键 |
| 27 | `help.about` | 帮助：关于 | — | 设置页 › 关于 |
| 28 | `ui.lang` | 界面：切换语言 | — | `setLang()` |
| 29 | `file.save` | 文件：保存 | `Ctrl+S` | 转发 `pristem:save-request`（无打开文件时置灰） |
| 30 | `file.saveAll` | 文件：全部保存 | `Ctrl+Shift+S` | 逐个写盘并清脏 |
| 31 | `file.closeEditor` | 文件：关闭编辑器 | `Ctrl+W` | 关闭当前组的活动 tab（脏文件先问） |
| 32 | `edit.undo` | 编辑：撤销 | `Ctrl+Z` | Monaco `undo` |
| 33 | `edit.redo` | 编辑：重做 | `Ctrl+Y` | Monaco `redo` |
| 34 | `edit.find` | 编辑：查找 | `Ctrl+F` | Monaco `actions.find` |
| 35 | `edit.replace` | 编辑：替换 | `Ctrl+H` | Monaco `startFindReplaceAction` |
| 36 | `view.wordWrap` | 视图：自动换行 | `Alt+Z` | 切 `editorWordWrap` 并持久化 |
| 37 | `view.minimap` | 视图：缩略图 | — | 切 `editorMinimap` 并持久化 |
| 38 | `split.right` | 视图：向右拆分 | `Ctrl+\` | 第二编辑组（≤2 组） |
| 39 | `split.down` | 视图：向下拆分 | `Ctrl+Shift+\` | 同上，纵向 |
| 40 | `run.activeFile` | 运行：运行当前文件 | — | `.py`/`.js`/`.ps1`/`.sh`/`.rs`；无运行器时置灰并给出原因 |
| 41 | `run.tests` | 运行：测试 | — | 测试命令探测（原 `runTests`） |
| 42 | `run.tasks` | 运行：任务列表 | — | 任务选择浮层（测试命令 + 根 `package.json` scripts + 当前文件） |
| 43 | `run.stop` | 运行：停止任务 | — | 向实例 0 写 `\u0003` |
| 44 | `run.kernelPause/resume/wake` | 见 12–14 | — | 同上 |

**菜单栏（IDE 模式）**：`.menubar` 由同一张命令表生成，File / Edit / View / Run / Help 五个菜单；点击展开、悬停换菜单、`←/→` 在顶层移动、`↑/↓` 在条目间移动、`Enter` 执行、`Esc` 关闭。`role="menubar|menu|menuitem"`，条目右侧显示快捷键，禁用项给出原因。`<1200px` 折叠为 `≡`（打开命令面板）——不维护第二套菜单布局。**其他模式没有菜单栏**（命令面板仍是唯一索引）。

**面板行为**：
- 输入框 `autofocus`；`↑/↓` 移动选中；`Enter` 执行；`Esc` 关闭并还焦。
- 结果列表**最多 40 条**（现状 12 条太短，28 条命令会被截断）。超出显示「还有 N 条匹配」。
- 输入 `>` 强制命令模式；输入文件名片段切到快速打开（与现状一致）。
- 每条右侧显示快捷键（mono 10px `--text-4` 装饰性 `--text-3`）；**没有快捷键的命令不显示占位符**。
- 分组：按「会话 / 视图 / 文件 / 内核 / 模式 / 终端 / 设置 / 帮助」分组显示，组头 11px `--text-3`。

### 2.4 协议徽标（D-5：版本号不是 UI 的常量）

| 项 | 规则 |
|---|---|
| 数据来源 | `fs.list` 响应的 **`protocol`** 字段（壳层取 `pristem_ipc::PROTOCOL_VERSION`） |
| 渲染位置 | 状态栏右区最右（`.proto-badge`），mono 10px `--text-4`（DESIGN §2.3 豁免：协议标识是技术标识，不算品牌展示） |
| 渲染条件 | **`protocol` 字段存在才渲染**。字段缺失 → **不渲染徽标**（不留空、不显示旧版本、不写死 `pristem.ipc/v0.3`） |
| 源码约束 | `ui/src/` 中**不得出现** `'pristem.ipc/v0.` 字面量（D-5 的违反判定）。版本号只有壳层一个来源。 |
| 设置页 › 关于 | `pristem.ipc` 版本**读同一个 `protocol` 值**（同一个 state，不另取来源）。字段缺失 → 该行不渲染。 |
| 验收 | DESIGN **D-5**；§9.1 第 12 条 |

> **这条同时修掉一个现存断言**：`.visual-check/check.cjs` 现状有 `check('coding: session connected', (await page.locator('.proto-badge').innerText()) === 'pristem.ipc/v0.3')`。协议升到 v0.4 后这条必然 FAIL，且它本身就是「写死版本号」的写法。Phase 3 必须改成**与 `fs.list` 响应的 `protocol` 值比对**，而不是与字面量比对。

### 2.5 快速打开（`Ctrl+P`）

| 项 | 规格 |
|---|---|
| 触发 | 全局 `Ctrl+P`（**移除 Monaco 内的 Ctrl+P 绑定**，改为 Monaco 命令转发到全局面板，避免两套实现） |
| 数据源 | 当前工作区已加载的文件（`fs.list` 结果，展开后的全部文件） |
| 上限 | 200 条（DESIGN H1）；超出显示「已显示前 200 项」 |
| 匹配 | 子串匹配，路径片段优先（`src/` 前缀命中排前面） |
| 选中 | `Enter` 打开文件；`↑/↓` 移动 |
| 空工作区 | 显示 `EmptyState variant="zero"`「还没有打开工作区」+ 行动 1 个「打开文件夹」 |
| 焦点 | 打开时焦点在输入框；关闭后焦点回到触发处（`document.activeElement` 快照） |

---

## §3 设置页导航模型

### 3.1 进入 / 退出

| 项 | 规格 |
|---|---|
| **形态** | 独立页，`.settings-page`，**覆盖整个工作区**（标题栏 / 会话带 / 状态栏保留且可交互）——DESIGN §8.8.1 |
| **进入点 1（主）** | 左栏头部 ⚙ 按钮（24×24，`aria-label="设置"`） |
| **进入点 2** | `Ctrl+,`（全局，任何模式可用，任何焦点可用） |
| **进入点 3** | 命令面板「设置：打开」 |
| **退出** | 右上角 `✕`（24×24，`aria-label="关闭设置"`）或 `Esc` |
| **退出后回到哪里** | **回到进入前的完整视图状态**：进入时记录 `activeView`、当前模式、设置页滚动位置、进入触发元素。退出时恢复 `activeView` 与模式（模式不变，本来就没变），滚动位置不恢复（避免「设置页滚到中间 → 退出后工作区也滚到中间」的错位），**焦点还给触发元素**（左栏 ⚙ 或命令面板输入框）。 |
| **进入时** | 焦点移到设置页的**左侧导航第 1 项**（不是搜索框——先让用户看到结构）；同时左侧导航第 1 项获得焦点环。 |

**三处进入点都要吗？** —— **要**，但它们指向同一个目标，不构成「三处真相」：
- ⚙ 是**空间入口**（左栏头部就在那儿）。
- `Ctrl+,` 是**肌肉记忆入口**（VSCode 用户必按）。
- 命令面板是**发现入口**（不知道左栏有 ⚙ 的人会先打开命令面板）。
三者的存在不违反 H-3（连接状态/用量/字标才受「唯一」约束），因为设置页**不是状态**。

### 3.2 布局

```
┌─ .settings-page ─────────────────────────────────────────────────────────┐
│  设置                                                  [ ✕ 24×24 ]        │  ← --fs-title 20px/600
│ ┌─ .settings-nav 176px (sticky) ─┐  ┌─ .settings-body 1fr ────────────┐ │
│ │ [🔍 搜索设置]                   │  │ 外观与动态                       │ │
│ │                                │  │ ─────────────────────           │ │
│ │ 外观与动态            ← 当前项  │  │ 界面语言      [中文][English]   │ │
│ │ 模型与连接                    │  │ 说明文字                        │ │
│ │ 编辑与终端                    │  │ ─────────────────────           │ │
│ │ 动态层                        │  │ 基准字号  [12][13][14]           │ │
│ │ 数据与隐私                    │  │ ...                             │ │
│ │ 快捷键                        │  │                                │ │
│ │ 关于                          │  │                                │ │
│ └────────────────────────────────┘  └────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

| 项 | 规格（沿用 DESIGN §8.8.1 / §8.8.3） |
|---|---|
| 容器 | `max-width: 880px`，水平居中，上下 28px 内边距，左导航 176px + 右内容 1fr，`gap: 24px` |
| 导航项 | 每项 30px 高，`--fs-body-sm` 12px；当前项 `--text-1` + 左侧 2px `--beam` 竖条；hover `--surface-raised` 底 |
| 滚动 | 右内容滚动，左导航 `position: sticky; top: 0`；**scrollspy**：滚动时当前分区高亮（`IntersectionObserver`，`rootMargin: '-28px 0px -70% 0px'`） |
| 分区标题 | `--fs-subtitle` 15px/600 `--text-1`，下方 1px `--line-hair`，上下 20px / 12px（DESIGN §8.8.3） |
| 设置行 | `grid-template-columns: minmax(0,1fr) auto; gap:24px; align-items:center; min-height:40px; padding:8px 0`，行间 1px `--line-soft` |
| 行标题 / 行说明 | `--fs-body` 13px `--text-1` / `--fs-micro` 10px `--text-3`，`max-width:52ch` |
| 搜索 | 左导航顶部一个 28px 输入框（`.settings-search`），占位「搜索设置」 |
| 设置内搜索行为 | 过滤**设置项**（不隐藏分区标题，保留结构）：命中项的标题与说明文本做 `<mark>` 高亮；未命中的行 `display:none`；某个分区 0 命中时该分区整体 `display:none`；全部 0 命中 → 右内容显示 `EmptyState variant="noresult"`「没有匹配的设置项」+ 行动 1 个「清除搜索」 |
| 关闭 | 右上角 `✕` + `Esc`（`Esc` 优先级低于浮层栈：若有更上层的浮层，先关它） |

**搜索的必要性**：7 个分区共 28 项设置，没有搜索时找「终端实例数」要扫 3 屏。搜索框在左导航顶部，**不是**一个独立命令。

### 3.3 立即生效 / 置灰清单（逐项，含置灰项的形态）

**置灰项的两种形态（定义一次，全局复用）**：

| chip | 含义 | 控件形态 |
|---|---|---|
| **`本次会话有效`** | 该项**生效**，但内核/壳层没有配置写接口，重启后回到默认 | 控件**可用**（不是置灰），行尾追加 chip：`--surface-raised` 底、**`--text-2`** 字（raised 上 text-3 不可用）、`--r-full`、10px、padding `0 6px` |
| **`不可用`** | 该功能在当前内核/壳层版本里没有对应接口 | 控件**禁用**（`disabled` + `aria-disabled="true"`，`opacity:.5`），行标题改 `--text-2`，行尾追加同款 chip，行说明写明缺什么 |

> chip 文案**不使用**「未完成 / 占位 / TODO / 演示」等被禁词（DESIGN §8.3 R-CONN-3）。

| 分区 | 设置项 | 生效方式 | 状态 |
|---|---|---|---|
| **1 外观与动态** | 界面语言 | `localStorage['pristem.lang']`，**立即** | 可用 |
| | 主题 | 深色 · 13px 基准 | **只读行**（mono 值） |
| | 基准字号 12 / 13 / 14 | `localStorage['pristem.baseFont']`，**立即**（改 `:root` 的 `--fs-*` 缩放因子） | 可用 |
| | 动效强度：跟随系统 / 减弱 / 完整 | `localStorage['pristem.motion']`，**立即**（`documentElement.dataset.motion`） | 可用 |
| | 动态层开关 | `localStorage['pristem.living']`，**立即** | 可用 |
| **2 模型与连接** | 当前 provider（模型名） | 内核 `provider_changed` 事件 | **只读**（真实数据） |
| | 可用 provider 列表 | `ListProviders` → `Providers` 事件 | 可用（见 §3.4） |
| | 传输状态 | — | **不在本页显示**（§0.2 R2），改为一行指向说明「传输状态显示在窗口底部状态栏」 |
| | 重新连接 | 无协议 | **不可用**，说明「内核没有提供重连接口」 |
| | BYOK 说明 | 说明文本 | 只读 |
| **3 编辑与终端** | 编辑器字号 12/13/14/16 | `localStorage`，**立即**（`monaco.editor.updateOptions`） | 可用 |
| | Tab 宽度 2/4/8 | `localStorage`，**立即** | 可用 |
| | 自动保存 开/关 | `localStorage`，**立即** | 可用 |
| | 终端提示符 | 只读 `›` | 只读行 |
| | 光标样式：块 / 下划线 / 竖线 | `localStorage`，**立即**（重建 xterm 实例） | 可用 |
| | 终端默认实例数 1/2/3 | 依赖壳层 `termInstance` 能力 | 能力为 true → 可用；false → **不可用**，说明「壳层未提供多实例通道」 |
| **4 动态层 LIVING** | 呼吸开关 | `localStorage`，**立即** | 可用 |
| | 指针跟随开关 | `localStorage`，**立即** | 可用 |
| | 强度 0–100% 滑块 | `localStorage`，**立即** | 可用 |
| | 低频档说明 | 说明文本 | 只读 |
| **5 数据与隐私** | 最近项目列表（逐条移除 + 全部清除） | `localStorage['pristem.recentWorkspaces']`，**立即** | 可用 |
| | 导出会话 | 现有导出（`pristem-session.md`） | 可用 |
| | 清空当前会话 | 现有 `/clear` 逻辑 | 可用 |
| | 本地数据说明 | 说明文本 | 只读 |
| **6 快捷键** | 键位表 | 本文档 §7 | 只读表 |
| | 命令表 | 本文档 §2.3 | 只读表 |
| **7 关于** | 棱镜 64px / 应用版本 / `pristem.ipc` 版本 / 构建标识 / 许可 | `pristem.ipc` 版本读 `fs.list.protocol`（**同一个来源**，无该字段则该行不渲染）；其余为构建时常量 | 只读 |

**「重新连接」为什么置灰而不是删掉**：DESIGN §8.8.2 把「重新连接」列在分区 2 里。协议里**没有**重连请求（`ClientRequest` 只有 10 个变体 + `SetProvider` + `ListProviders`）。按 H-2，做成可点的死按钮就是「编的功能」；按 H-2 的另一半，做成**置灰 + 说明缺什么**就是诚实的。**保留行，禁用控件**。

### 3.4 「模型与连接」分区的完整形态（接真实数据）

**数据获取**：进入设置页时发 `ClientRequest::ListProviders{client:'desktop'}` → 内核回 `ServerEvent::Providers{providers:[ProviderInfo]}` → UI 渲染。同时订阅 `ServerEvent::ProviderChanged{session,provider,model}` 更新「当前」标记。

**列表行（每 provider 一行，`min-height:44px`，DESIGN H4）**：

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [●] openai-chat              gpt-4o                       [ 当前 ]      │  ← 行 1
│     openai_chat · 端点 https://api.openai.com/v1 · 密钥已就绪             │  ← 行 2 (11px --text-3)
└──────────────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────────────┐
│ [○] anthropic-messages       claude-sonnet-4                            │
│     anthropic_messages · 密钥未就绪                                      │
│     设置环境变量 ANTHROPIC_API_KEY 后重启内核即可使用          [ 切换到此 ] │
└──────────────────────────────────────────────────────────────────────────┘
```

| 字段 | 来源 | 呈现 |
|---|---|---|
| 当前标记 | `is_default` | 行首 6px 点（`--beam` = 当前 / `--line-strong` = 非当前）+ 行尾 chip「当前」 |
| id | `id` | mono 10.5px `--text-1` |
| adapter | `adapter` | mono 10px `--text-3`（与 id 同行的分隔点后） |
| model | `model` | mono 10px `--text-2` |
| 端点 | `base_url` | mono 10px `--text-3`；**`base_url` 为 null 时这一段整个不渲染**（不显示「无」/「默认」等占位） |
| 密钥 | `key_present` | true → 「密钥已就绪」`--success` 文字；false → 「密钥未就绪」`--text-3` 文字 |
| 环境变量名 | `api_key_env` | 密钥未就绪时以 mono 显示：`设置环境变量 {api_key_env} 后重启内核即可使用` |

**「没有配置密钥」的诚实表达（禁用词清单）**：

- 文案**只能**是：「密钥未就绪」+「设置环境变量 `{api_key_env}` 后重启内核即可使用」。
- **禁止**出现：「演示 / demo / 假数据 / 未完成 / 占位 / TODO / 假 / 模拟」。
- `key_present === false` 的行，其「切换到此」按钮**禁用**（`--danger` 不适用，用 `--text-3` 描边），`title` 写「该端点没有可用密钥」。
  > 依据：`set_default` 只检查 id 是否已注册，**不检查密钥**；但没有密钥的端点在实际调用时会失败。UI 提前禁用是**阻止一个必然失败的行动**，同时不伪造内核行为。
- 整个分区**不显示任何密钥内容**（内核只给 `key_present`，UI 也没有别的地方能拿到密钥）。

**切换 provider 的完整流程**：

```
点「切换到此」
  → phase='switching'（该行按钮进入 pending：6px --beam 点 + 文字「切换中」）
  → 发 ClientRequest::SetProvider{session, provider:id}
  → 内核回 ProviderChanged{session, provider, model}   → 更新「当前」标记 + 该行显示「下一轮生效」
  → 内核回 Error{...}                                     → 该行内联显示 --danger 11px 错误 + 恢复原 provider 标记
```

- **「下一轮生效」必须写出来**：`SetProvider` 只改默认 provider，已在途的 round 不受影响。行尾追加 chip「下一轮生效」（`--surface-raised` 底 / **`--text-2`** 字）。
- 切换**不需要确认弹层**：它不是不可逆操作（下一轮可以再切回来），H-6 只要求「可重试」。
- `SetProvider` 需要 `session` 字段 → 用当前活跃会话的 `id`；若没有活跃会话（连接中），按钮禁用 + 说明「内核连接后可切换」。

### 3.5 goal 模式如何表达「目标 / 约束 / 取舍」（回应「目标空间需要一个真实的意图表达方式」）

**结论：不做三个控件。用户用一条自然语言消息表达三者。**

**内核事实（已核对源码）**：

| 事实 | 出处 | 含义 |
|---|---|---|
| `ClientRequest` 的 12 个变体里**没有任何 goal / 目标字段** | `pristem-ipc/src/events.rs:53-109` | 内核**不持有结构化目标**。任何独立的「目标」「约束」「取舍」控件都无法被兑现 |
| goal 模式的工具表 = `read / search / write / edit / delete / exec / reminder / skill-load / improve / pause` | `mode.rs:79-80` | goal 模式**能写文件**，它不是一个「只聊天」的沙盒 |
| goal 模式的输出标签 = `answer / call`（无 `annotation`） | `mode.rs:100-106` | goal 表面不产生批注 |
| 现状 `/goal …` 的实现：`patch(local goal)` + `submit_round{text:"/goal …"}` | `App.tsx:330-336` | 目标文本是**UI 本地状态** + 一条普通 round 消息 |

**因此（逐条可施工）**：

| # | 规则 | 落地 |
|---|---|---|
| **G-1** | **不新增任何结构化目标控件** | 维持 DESIGN §8.2.1 对 `.intent-chips` 的删除决定，且**不引入替代控件**。理由与 DESIGN 同源：内核不解析，任何独立字段都是「编的功能」。 |
| **G-2** | **表达方式 = 一条普通 round 消息** | 用户在 goal composer 里写「目标是 X；约束是 Y；取舍是 Z」，作为 `submit_round` 的 text 发出。UI **不做字段切分、不加前缀、不做三段解析**。 |
| **G-3** | **唯一的结构化辅助是 3 个起步句 chip**（DESIGN §8.2.2 已有） | 它们是**文本模板**：点击 → 填入输入框（不自动发送）→ 用户可改 → 作为普通消息发送。**因此诚实**：内核收到的就是普通文本。三个起步句本身（梳理一个架构决策 / 拆解一个模糊目标 / 比较两条路线）恰好覆盖「目标」「取舍」「澄清」三类典型表达，无需再拆字段。 |
| **G-4** | **目标状态条必须改口径** | DESIGN §8.2.3 写「有目标时显示**内核提供的**目标文本」—— **内核不提供**。诚实做法：状态条显示**用户自己写的最后一条目标陈述**（来源 = 本会话 transcript 里最后一条 `/goal …` 用户消息，UI 本地状态），行尾挂 chip「**你的陈述**」（明确不是内核持有的状态）。没有则显示「还没有写下目标」。**禁止**出现「内核已设定目标」这类暗示内核持有状态的措辞。 |
| **G-5** | **goal 模式隐藏代码库表面时，输入能力不隐藏** | goal 模式不渲染 filetree / monaco / term（F7），但 composer 与 3 个起步句**照常渲染** —— 用户仍然能表达一切。F7 只约束「代码库表面」，不约束「表达」。 |

**未来条件（写清楚，避免以后被当成欠账）**：若内核新增 `submit_round` 的结构化字段（或一个 `SetGoal` 请求），再以**真正生效的表单**加入 —— 届时目标状态条的数据源从「你的陈述」换成内核字段，chip「你的陈述」换成「内核的目标」。**在此之前不做。**

---

## §4 终端三 tab 与多实例模型

### 4.1 活动带结构

```
┌─ .activity-strip  高 176px（可拖 120–420，可折叠为 0）────────────────────┐
│ [终端][输出][问题 3]              [ bash 1 ×][ bash 2 ×][ + ]      [ ⌄ ]  │  ← 32px 头
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│                        （当前 tab 的内容区）                               │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

| 元素 | 规格 |
|---|---|
| tab 容器 | `.panel-tabs`，`role="tablist" aria-label="活动"`；三个都是 `<button role="tab" aria-selected>` |
| tab 高度 | 32px（`.pane-head` 统一 32px，DESIGN §8.9.3） |
| tab 标签 | `--fs-mono-xs` 10px mono `--text-3`；选中 `--text-1` + 底部 2px `--beam` 下划线 |
| tab 角标 | 「问题」tab 显示问题数 `问题 3`；数字用 `tabular-nums`；**角标不是唯一信息**（文字仍在） |
| 实例胶囊 | 高 22px，`--r-3`，底 `--surface-raised`，边 `1px --line-strong`，文字 mono 10px；当前实例底 `--beam-wash` + 边 `--beam` |
| `+` 按钮 | 24×24，新建实例并聚焦。**壳层不支持多实例时整个 `+` 不渲染**（不置灰、不显示提示文字） |
| `⌄` 按钮 | 折叠/展开活动带（176px ↔ 0）。折叠后活动带头部仍可见 8px？不 —— **整条折叠为 0**，恢复入口是状态栏？ → 见 §4.5 |
| 单行控件数 | ≤ 3（DESIGN H3）：头部一行里 `tablist`（算 1 组）+ 实例胶囊组（算 1 组）+ 折叠按钮（1）→ 满足 |

### 4.2 三个 tab 的数据来源与空态

| tab | 数据来源 | 空态 | 行动 |
|---|---|---|---|
| **终端** | xterm 实例（§4.3） | 永不为空（至少 1 个实例，总有提示符） | — |
| **输出** | ① 壳层终端输出（现状 `TERM_BUFFER`）② 内核 `result` 事件的 `output` 字段 | `EmptyState variant="zero"`「还没有输出」+ 描述「运行一条命令，或让智能体执行一次工具调用」 | 1 个：「聚焦终端」 |
| **问题** | Monaco `monaco.editor.onDidChangeMarkers` | `EmptyState variant="zero"`「没有发现问题」+ 描述「编辑文件后诊断会显示在这里」 | 0 个 |

**输出 tab 的形态**：
- 合并流：壳层输出与内核 `result` 输出按到达时间合并。
- 每行前缀标注来源：`bash 1`（壳层，mono 9.5px `--text-4`→装饰性，用 `--text-3`）、`内核`（`result` 事件）。
- 终端提示符行**不进入**输出 tab（只进 xterm）。
- 上限 200 行；超出顶部显示「已显示前 200 行」。
- 顶部一行实例筛选 chip（`全部 / bash 1 / bash 2`），默认「全部」；chip 数量 ≤ 3（DESIGN H3）→ 超过 3 个实例时筛选器改为下拉。

**问题 tab 的形态**：
- 订阅：`monaco.editor.onDidChangeMarkers(() => emitMarkers())`，**200ms 防抖**。
- 数据：`monaco.editor.getModelMarkers({})` 全量 + 增量事件。
- 行结构：`[错误] src/main.rs:42:7  消息` —— 严重级别用**文字**（`错误` / `警告` / `提示`）+ 颜色（`--danger` / `--warn` / `--text-3`）。**不能只靠颜色**（H-4 / DESIGN §5.6）。
- 点击行 → `pristem:jump-line` 事件 + Monaco `revealLineInCenter` + `setPosition`，并把焦点交给编辑器。
- 刷新时机：① markers 变化；② 切换打开的文件；③ 打开「问题」tab 时立即重读一次。
- 排序：按文件路径 → 行号 → 列号，稳定排序（避免每次刷新跳动）。
- 上限 200 条，超出显示「已显示前 200 项」。

### 4.3 终端实例模型

```
TerminalStore = {
  instances: TerminalInstance[],       // 按创建顺序
  activeId: number,                    // 当前聚焦实例的 id
  nextId: number,                      // 自增分配
}
TerminalInstance = {
  id: number,                          // 协议 instance 号，从 0 开始
  name: string,                        // 显示名 'bash 1'
  term: Terminal,                      // xterm 实例（不销毁）
  pending: boolean,                    // 有命令在途
  buffer: string[],                    // 该实例的输出行（≤200）
}
```

| 规则 | 内容 |
|---|---|
| **创建** | `+` 按钮 → 分配 `id = nextId++` → `name = 'bash ' + (id+1)` → 建 xterm → 写入提示符 `› ` → `activeId = id` → 焦点交给该实例 |
| **协议 instance 号** | **从 0 开始**，显示名 = `id + 1`（`bash 1` = instance 0）。缺省 `instance` 字段的事件 → 归 instance 0（向后兼容现状单终端） |
| **显示名 vs 改名** | 默认名 `bash N`；**双击胶囊名**进入改名：内联 `<input>`（mono 10px，宽度自适应，`min-width:64px`），`Enter` 提交，`Esc` 取消，失焦提交。规则：1–24 字符、不可含控制字符；为空或非法 → 回退到 `bash N`（不报错，只回退） |
| **聚焦** | 点胶囊 → `activeId = id`；该实例的 `.term-host` 变可见，其余 `display:none`（**不销毁 → 保留 scrollback**）；焦点移到该实例的 xterm 隐藏输入框（这样打字直接进终端） |
| **关闭** | 胶囊上的 `✕`（12px，hover 显现，与 `.tab-x` 一致）→ 从 store 移除 → `xterm.dispose()` → 若关闭的是当前实例，焦点移到**下一个**实例（无则上一个） |
| **关闭最后一个** | **最后一个实例不渲染 `✕`**（DOM 中不存在）。「至少保留一个终端」由「折叠活动带」承担，不靠禁用按钮表达 |
| **pending 状态** | 该实例有在途命令（UI 发了 `term.run` 但没收到它的 `term.done`）→ 胶囊上显示 6px `--beam` 点 + `aria-label` 追加「· 命令执行中」 |
| **`term.done` 无 instance 字段时** | 若**恰好一个**实例处于 pending → 清除它的 pending；若**多个** pending → 清除**最早**那个（FIFO）；若 0 个 pending → 忽略（不写提示符） |
| **能力探测** | `shell.capabilities.termInstance === false` → **整个实例胶囊区与 `+` 不渲染**，只有 1 个终端，**不显示任何「多实例」字样**（不假装支持） |
| **实测收敛（D-3b，能力探测之外的第二道判定）** | **只要实际收到的 `term.output` / `term.done` 事件里没有任何 `instance` 字段，就收敛到 1 个实例**：隐藏实例胶囊区、隐藏 `+`、把已创建的第 2 个实例销毁（`xterm.dispose()`）。理由：壳层可能实现了 `term.run.instance` 却忘了在事件里回传 —— **没有回传就无法路由**，多实例就是假的。判定在**收到第一条无 `instance` 的事件时立即执行**（不等能力探测的结果），两条判定任一命中都收敛。 |

### 4.4 实例与「输出」面板、Git 队列的共存

**与输出面板**：每个实例的 `buffer` 独立；输出 tab 合并所有实例 + 内核 `result` 输出（§4.2）。终端提示符与回显**不进入** buffer。

**与 Git 面板的命令队列（关键，当前必坏）**：

现状问题：`Panels.tsx` 的 `captureActive` 是模块级全局布尔；`workspace.tsx:515` 在**任何** `term.done` 上无条件写 `PROMPT`；`isGitEcho` 依赖壳层回显的 `pristem@workspace %`（壳层一旦按 B-3 删掉回显，这个判断就失效）。

**终局设计**：

| 项 | 规则 |
|---|---|
| **Git 专用通道** | Git 面板的所有命令发到 **`instance = 9000`**（保留通道）。UI **不**把 9000 渲染成实例胶囊。 |
| **壳层支持 instance 时** | Git 的输出与 `term.done` 都带 `instance:9000` → 终端侧**完全无视**（不写 xterm、不写提示符）；Git 侧按 9000 收集。**用户终端零污染**。 |
| **壳层不支持 instance 时**（降级） | 所有输出都落在 instance 0。→ 沿用哨兵帧机制，但**判定改为只看哨兵行本身**（DESIGN §8.9.1 已要求）：`__PRISTEM_GIT_BEGIN__:{id}` 开启静默窗，`__PRISTEM_GIT_END__:{id}` 关闭静默窗。**删除** `pristem@workspace %` 字符串匹配（`Panels.tsx:260`、`workspace.tsx:506` 两处）。 |
| **静默窗内禁止写提示符** | `gitSilent === true` 期间，**任何** `term.done` 都**不得**写 `PROMPT`。静默窗关闭后，若 `atLineStart === false` 才补一个换行 + 提示符。**这是现状的 bug 修复点**（`workspace.tsx:515` 现在无条件写）。 |
| **静默窗按实例** | `gitSilent` 从模块级全局布尔改为 `Map<instanceId, boolean>`。多实例下用户在 bash 2 打字不应被 bash 1 的 git 命令影响。 |
| **Git 队列串行** | 保持现状：4 条命令串行，每条靠自己的 `END` 哨兵提交，`term.done` 与 350ms 超时只是兜底。**队列改为按实例计**：`busy` 标志从模块级改为「Git 通道占用中」的单一状态（Git 永远只用 9000 通道，不会与用户实例竞争）。 |
| **Git 通道不进入输出 tab** | 9000 通道的输出**不写入**任何实例的 `buffer`，也不进输出 tab（那是内部通道，不是用户的输出）。 |

### 4.5 活动带折叠后的入口

活动带折叠为 0 时，用户需要一条回来的路。**决策**：
- 活动带头部保留 **8px 的把手条**（`.activity-handle`），可点击 / 可拖拽恢复；把手条上有一个 14px 的 `⌃` 图标 + `aria-label="展开活动带"`。
- 折叠高度 **不是 0**，而是 **8px**（把手条）。这样「折叠为 0」在视觉上等于收起内容，但入口不会消失。
- 键盘：`Ctrl+\`` 在活动带折叠时**展开并聚焦**终端；再次按 `Ctrl+\`` 折叠。
- **把手条的可达性**：折叠后 `.activity-handle` **仍在 DOM 里**、**可点击**、**可键盘聚焦**（`tabindex="0"` + `role="button"` + `aria-label="展开活动带"` 齐全），高度 8px（DESIGN §9.11 N23）。
- **goal 例外**：**goal 模式下 `.activity-strip` 与 `.activity-handle` 元素数均为 0**（goal 整块工作台不渲染，与 F7 同源；DESIGN §9.11 N22）。deepsleep / coding / helping / IDE 四个模式下折叠后把手条仍在。

---

## §5 打开文件夹全流程

### 5.1 入口（4 处，**同一个函数**）

| # | 入口 | 位置 | 选择器 |
|---|---|---|---|
| 1 | 文件树头部的文件夹按钮 | 树头右侧（32px 头，24×24 图标） | `.filetree .pane-head .icon-btn[aria-label="打开文件夹"]` |
| 2 | 欢迎页主行动「打开文件夹」 | 欢迎页 `.welcome-actions` 第一张卡 | `.welcome-action.is-primary` |
| 3 | 编辑器空态的行动「打开文件夹」 | `EmptyState variant="first"` 的 action | `.empty-state .empty-actions .primary-btn` |
| 4 | 命令面板「文件：打开文件夹」 | 面板 | — |

**四处调用同一个 `openFolder()`**，行为完全一致。区别只有欢迎页**额外**提供「新建项目」「克隆仓库」「最近项目」三个入口 —— 那是欢迎页的职责，不是「打开文件夹」的变体。

### 5.2 主路径（原生对话框）

```
openFolder()
  → 能力判定 capabilities.pickFolder
      ├─ true  → 发 { op:'fs.pickFolder' }
      │            ├─ 壳层弹原生文件夹对话框
      │            ├─ 用户选中 → 壳层设 root → 广播 io 'workspace'{root} → UI 刷新
      │            │                 → 返回 { ok:true, root }
      │            └─ 用户取消 → 返回 { ok:false, cancelled:true }，**不发** workspace
      │                          → UI **无任何反应**（取消不是错误：不弹错、不播报）
      └─ false → 直接打开路径粘贴对话框（§5.3）
```

**`openFolder()` 的实现（替换 `App.tsx:494` 的 `setActiveView('files')`）**：

```
const openFolder = async () => {
  if (!capabilities.pickFolder) { setPathDialogOpen(true); return; }
  const r = await sendIo({ op: 'fs.pickFolder' }) as { ok?: boolean; cancelled?: boolean; root?: string; error?: string };
  if (r?.cancelled) return;                       // 静默
  if (r?.ok === false) { setPathDialogOpen(true); setPathError(r.error ?? 'pickFailed'); return; }
  // 成功路径由 io 'workspace' 事件统一处理（§5.5）
};
```

> **能力为 false 时直接走兜底**，不「先试一次再降级」——避免每次都多一次往返，也避免用户看到原生对话框闪一下又变成粘贴框。

**壳层未升级时的兜底（capabilities op 返回 unknown）**：`pickFolder:false` → 直接粘贴对话框。若壳层实现了 pickFolder 但 capabilities op 缺失（老壳层），UI 走粘贴对话框，**仍然可用**（粘贴路径是完全真实的能力）。

### 5.3 兜底路径（路径粘贴对话框）

`.path-dialog`，**模态**，宽 480px（≤560px，DESIGN H2），居中。

```
┌─ .path-dialog ──────────────────────────────────────────┐
│ 打开文件夹                                            [✕] │  ← --fs-subtitle 15px/600
│ ┌──────────────────────────────────────────┬───────────┐ │
│ │ D:/projects                              │  [粘贴]    │ │  ← mono 输入 28px 高
│ └──────────────────────────────────────────┴───────────┘ │
│ ▎这个路径不是文件夹                                     │  ← 仅出错时；2px --danger 左竖条
│                                                           │
│ 最近项目                                                 │
│ ┌───────────────────────────────────────────────────────┐ │
│ │ pristem-desktop                          D:/projects  │ │  ← 点击直接打开
│ │ pristem-kernel                           D:/projects/…│ │
│ └───────────────────────────────────────────────────────┘ │
│                                        [取消]  [ 打开 ]   │  ← 主按钮 --beam 36px
└───────────────────────────────────────────────────────────┘
```

| 项 | 规格 |
|---|---|
| 打开方式 | ⚙ 之外的三处入口在 `capabilities.pickFolder===false` 时直接打开它；也提供次级文字链接「或粘贴路径…」→ 打开它（即使主路径可用也要有） |
| 宽度 | 480px |
| 标题 | 「打开文件夹」 |
| 输入框 | `.path-dialog-input`，mono（`--font-mono`）11.5px，高 28px，`--surface-inset` 底，`--r-2`，`aria-label="文件夹路径"`，placeholder `D:/projects`，**打开时自动聚焦** |
| 「粘贴」按钮 | 次按钮 28px；点击读 `navigator.clipboard.readText()` 填入输入框；读取失败 → 内联错误「无法读取剪贴板，请手动输入」 |
| 「最近项目」 | `readRecent()` 前 **5** 条（DESIGN §8.6.1）。每行：label（13px `--text-1`）+ 完整 root（mono 10px **`--text-2`**，超长省略；对话框底是 `--surface-float`，text-3 在 float 上不可用）。**点击 = 直接打开该路径**（已知有效，不再要求确认）。空列表 → 一行 11px **`--text-2`**「还没有最近打开的文件夹」 |
| 主按钮 | 「打开」36px `--beam` 底；`Enter` 等价 |
| 次按钮 | 「取消」36px 描边；`Esc` 等价 |
| 焦点 | 打开 → 输入框；关闭 → 回到触发按钮（H-8） |
| 焦点陷阱 | 模态：`Tab` 在对话框内循环；底层加 `inert` |
| 滚动 | 内容超过 420px 时对话框内部滚动，按钮行固定在底部 |

**校验规则（逐条，含精确文案）**：

| 输入 | 判定 | 内联错误文案 | 按钮 |
|---|---|---|---|
| 空 / 只有空白 | 空 | 「请输入文件夹路径」 | 「打开」保持可用（点了就报这个错） |
| 不以 `/`、`\`、`X:`（盘符）开头 | 非绝对路径 | 「请输入绝对路径，例如 D:/projects」 | 可用 |
| 含 `..` 路径段 | 越界 | 「路径不能包含 ..」 | 可用 |
| 提交后壳层回 `{ok:false,error:'not a directory'}` | 不存在 / 不是目录 | 「这个路径不是文件夹」 | 可用 |
| 提交后壳层回 `{ok:false,error:'not a directory'}`（权限） | 无权限 | 「没有权限读取这个文件夹」 | 可用 |

- 错误文案渲染在输入框下方，形态 = 左侧 2px `--danger` 竖条 + 11.5px `--text-2`（**不是** `--danger` 文字 —— 4.80 的对比度够但正文用 `--text-2` 更稳；竖条承担危险语义）。
- 输入框同时设 `aria-invalid="true"` + `aria-describedby` 指向错误行。
- **新输入时立即清除旧错误**（不等到再次提交）。
- 校验时机：**提交时**校验（不是每次按键都报错）。空路径在提交时校验。

### 5.4 欢迎页与文件树入口的行为一致性

| 维度 | 欢迎页 | 文件树头 | 是否一致 |
|---|---|---|---|
| 主路径 | `fs.pickFolder` | `fs.pickFolder` | ✓ |
| 兜底 | 粘贴对话框 | 粘贴对话框 | ✓ |
| 取消原生对话框 | 无反应 | 无反应 | ✓ |
| 打开后刷新 | 欢迎页消失 → 文件树出现 | 文件树刷新 | ✓ |
| 额外入口 | 新建项目 / 克隆仓库 / 最近项目 | 无 | **不同（欢迎页独有）** |

**克隆仓库的既有行为修正**：`App.tsx:502` `cloneRepo` 克隆完成后 `setTimeout(1200)` 就 `fs.openFolder`，**这是定时猜测**，不是真状态。决策：克隆命令执行完后，**由用户手动打开**（克隆完成后欢迎页的「最近项目」区刷新，克隆出的目录若在 root 内则出现在最近项目里）。**删除 1200ms 定时器**（它会在慢机器上打开一个还不存在的目录）。同理 `newProject`（`App.tsx:506`）的 400ms 定时器 → 删除，改为：创建目录成功后**自动打开该目录**（因为路径是 UI 自己造的，确定存在），用 `fs.openFolder`。

### 5.5 打开后的 UI 刷新

壳层广播 io 事件 `workspace{root}` → `App.tsx` 的 `handleIo`：

```
if (io.type === 'workspace' && io.root) {
  if (io.root !== root) {                 // 换工作区
    setOpenFiles([]); setActivePath(null);   // 清掉旧工作区的打开文件
    setSearch(''); setPanelQuery(''); setPanelHits([]);
    setActiveView('files');
  }
  setRoot(io.root);
  pushRecent(io.root);                   // 最近项目（localStorage）
  const res = await sendIo({ op:'fs.list' });
  setFiles(res.files ?? []);
  setWorkspaceReady(true);
}
```

- **换工作区必须清空 `openFiles`**：否则编辑器会显示上一个目录的文件，路径与内容对不上（现状 bug）。
- `fs.changed` 事件 → 只重新 `fs.list`，不清空 openFiles（同一工作区内的文件变更）。
- 最近项目 `pushRecent` 去重 + 上限 8 条（`Panels.tsx:18`），显示时取前 5。

---

## §6 空态 / 加载 / 错误 / 确认 四类分支的统一语法

### 6.1 总则

| # | 规则 |
|---|---|
| 1 | **空态不是错误。** 数据为空 → `EmptyState`，不显示 `ErrorCard`。 |
| 2 | **加载不是空态。** 加载中 → `EmptyState variant="loading"`（骨架），**不显示标题文案**（避免闪烁）。 |
| 3 | **错误必须归属一个 surface。** 属于某个面板 → 内联；全局性 → 浮层。 |
| 4 | **确认只有一处载体**（transcript 内联 `.line-buttons`）。**删除** `.confirm-toast`（`App.tsx:733`）。H-7。 |
| 5 | 每个 surface 的行动按钮 **≤ 2**（DESIGN G11）。 |
| 6 | 状态**不得**只靠颜色或只靠动效表达（H-4）。 |

### 6.2 每个 surface 的四态表

| surface | 空 | 加载 | 错误 | 确认 |
|---|---|---|---|---|
| **文件树** | `zero`「这个文件夹里没有可显示的文件」+ 行动「打开文件夹」「新建文件」 | `loading` 骨架（3 条 28px 行） | `error`「无法列出这个文件夹」+ 行动「重试」「打开文件夹」 | 无（文件树不产生确认） |
| **搜索面板** | `noresult`「没有找到匹配」+ 显示查询词 + 行动「清空」 | `loading` 骨架 | `error`「搜索失败」+ 行动「重试」 | 无 |
| **版本面板** | `zero`「工作区没有未提交的改动」 | `loading` 骨架 | `error`「这里不是 Git 仓库」+ 行动「打开文件夹」「聚焦终端」（**不是「重试」**，H-6） | 无 |
| **大纲浮层** | `zero`「这个文件没有可解析的符号」 | 立即（同步计算，无加载态） | 无 | 无 |
| **终端 tab** | 不可能为空（至少 1 个实例） | 不适用 | `error`「终端不可用」+ 行动「重试」（重建 xterm） | 无 |
| **输出 tab** | `zero`「还没有输出」+ 行动「聚焦终端」 | 不适用（追加式，无加载态） | `error`「输出读取失败」+ 行动「重试」 | 无 |
| **问题 tab** | `zero`「没有发现问题」 | `loading` 骨架（3 行） | `error`「诊断读取失败」+ 行动「重试」 | 无 |
| **transcript** | `zero`「还没有对话」+ 3 条起步句（点击填入输入框，**不自动发送**） | 追加式，无加载态；`running` 时显示「正在思考…」+ 停止按钮 | 内联 `system` 行（内核错误原文，11.5px `--text-2`）+ 右侧「复制详情」 | **`.line-buttons`**（唯一确认载体） |
| **控制台头部 vitals** | **整条不渲染**（无 usage 事件） | 不渲染 | 不渲染 | 无 |
| **设置页分区** | `noresult`「没有匹配的设置项」+ 行动「清除搜索」 | 不适用（纯本地） | `error`「内核没有返回 provider 列表」+ 行动「重试」（重新 `ListProviders`） | 无 |
| **欢迎页** | 不适用 | `loading` 骨架 | `error`「无法读取工作区」+ 行动「重试」「打开文件夹」 | 无 |
| **模式菜单** | 不适用 | 目标行「切换中」（文字） | **内联错误**（§1.4） | 无 |
| **路径对话框** | 最近项目为空 → 一行说明 | 不适用 | 内联校验错误（§5.3） | 无 |

### 6.3 错误的两级形态

| 级别 | 形态 | 何时用 | 结构 |
|---|---|---|---|
| **内联（inline）** | `EmptyState variant="error"`：左侧 2px `--danger` 竖条、**无图标**、13px/600 标题、11.5px `--text-2` 描述 | 错误属于某个 surface（文件树、搜索、版本、输出、问题、设置分区、路径对话框、模式菜单） | 标题 + 原因 + ≤2 行动 + 可选 `<details>` 详情 |
| **浮层（toast）** | 右上角浮层，320px 宽，`--surface-float` 底，`--r-3`，5s 自动消失，可手动关 | **仅「用户刚发起的一个操作失败，且不归属任何单一 surface」** —— 见下方限定 | `role="alert"`，标题（= 动作名）+ 一行原因 + 「重试」 |

**浮层错误的限定（硬约束，直接关系 DESIGN G12 断言）**：

> **toast 内禁止出现「内核未连接」「离线夹具」「内核已连接」「正在连接内核」这四个词。**

理由：DESIGN §8.3 **R-CONN-1** 规定「连接状态全局只有 1 处表达 —— 状态栏」，**R-CONN-2** 规定「任何面板、卡片、**Toast** 不得重复表达连接状态」；DESIGN **G12** 的实测口径是「全屏文本搜索『内核未连接 / 离线夹具』出现次数 = 1」。状态栏已经占了那一次，toast 再写一遍 → **G12 必然 FAIL**。

**因此（连接类失败的正确处理）**：

| 失败 | 状态栏显示 | toast | 恢复路径 |
|---|---|---|---|
| 内核未连接 / SSE 断开（`kernelDisconnected`、`sseInterrupted`） | 「内核未连接」（**唯一一次**出现该状态） | **不弹** | **状态栏的连接指示器可点** → 展开只有「重试连接」一项的小菜单（`.conn-retry-menu`） |
| 会话新建 / 关闭失败 | 不变 | **弹**「会话未能创建」+ 内核原文原因 + 「重试」 | toast 内的「重试」 |
| 导出会话失败 | 不变 | **弹**「导出失败」+ 原因 + 「重试」/「复制内容」 | toast 内的「重试」 |

**结论**：现状 `App.tsx:703` 的 `.global-error` 浮层（渲染 `error.kernelDisconnected.title` = 「内核未连接」）**整块删除** —— 它是 R-CONN-2 与 G12 的直接违反者。`ErrorCode` 里的 `kernelDisconnected` / `sseInterrupted` 两个码**不再渲染 ErrorCard**，改为**更新状态栏的连接状态**。

**状态栏连接指示器的可点击行为**（新增交互，不新增元素）：

| 项 | 规格 |
|---|---|
| 元素 | 状态栏右区的连接状态点 + 文本（DESIGN §8.3 已定的那一处）。**不加新元素**（保 F8 的 ≤ 6） |
| **正常态** | 指示器**不是按钮**：无 `pointer`、无 `tabindex`、不占焦点、**点击不展开任何菜单**。理由：正常态点开一个只有一行状态文字的菜单毫无意义 —— 那正是 H-2 说的死控件（DESIGN §9.10 N25） |
| **异常态**（内核未连接 / 断流） | 指示器**变成可点按钮**：`role="button"` + `aria-haspopup="menu"` + `tabindex="0"`；点击 → 展开 `.conn-retry-menu`（锚在指示器上方，宽 ≤ 560px（H2），建议 200px） |
| 菜单内容 | **恒定只有一项**「重试连接」（30px，12px `--text-2`）；**菜单内不出现任何连接状态词**（G15：全屏连接状态词仍须 = 1，DESIGN §9.10 N24） |
| 「重试连接」做什么 | 重新建立与服务的事件流（`service.ready()` 级别的重连）；**不重发任何业务请求** |
| 键盘 | 打开后焦点在菜单第一项；`Esc` 关闭并还焦到指示器（H-8） |
| 播报 | 菜单打开/关闭不播报（纯 chrome） |

**错误卡必须有恢复路径**：
- 可重试的 → 行动「重试」（重发同一请求）。
- 不可重试的语义错误 → 行动是**替代路径**，不是「重试」：
  - 「这里不是 Git 仓库」→ 「打开文件夹」/「聚焦终端」。
  - 「需要先打开工作区」→ 「打开文件夹」。
  - 「不能从 helping 切换到 deepsleep」→ 「先切到 coding 再进入 deepsleep」。
- 详情：`ErrorCard` 的 `<details class="error-detail">` + 「复制详情」按钮保留；**详情区允许内核原文**（如 `mode transition helping -> deepsleep is forbidden: ...`），因为详情是诊断信息不是界面文案。但 UI 自己生成的文案仍受禁用词约束。

### 6.4 确认的唯一载体

**形态**（`.line-buttons`，transcript 内）：

```
┌ ▎等待你的确认：这条动作被内核拦下了                        [ 释放 ] [ 忽略 ] ┐
└──────────────────────────────────────────────────────────────────────────────┘
```

| 元素 | 规格 |
|---|---|
| 容器 | `--surface-inset` 底，1px `--line-hair` 边，**左侧 2px `--warn` 竖条**，内 padding `8px 12px`，`--r-3` |
| prompt | 12.5px `--text-2`（内核原文） |
| 按钮 | ≤3 个；第一个 = `primary-btn small`（`--beam` 底 28px），其余 `mini-btn` 描边 |
| 出现时机 | 内核发来 `buttons` 且**未被 UI 自动代答**（R-C3 的三类） |
| 焦点 | **不抢焦点**（用户在输入时不能被夺走）；但 `aria-live="assertive"` 播报「等待你的确认」 |
| 消失 | 点击任一按钮 → 发 `confirm{session,id,choice}` → 该 item 从 transcript 移除（现状 `confirm()` 已实现） |
| 超时 | 30s 未处理 → **不自动消失**（内核的 pending 还在，超时消失会造成状态丢失）；行尾追加 11px `--text-3`「等待中」 |

**删除 `.confirm-toast`**：`App.tsx:733-743` 的全局浮层与 transcript 的 `.line-buttons` 是同一个内核事件的两个渲染器。保留 transcript 里的，删掉浮层。H-7。

**deepsleep 的确认**在 §1.3 由 UI 自动代答，**因此不会**产生 `.line-buttons` 卡片（除非 R-C5 超时兜底）。这是预期行为，不是「确认消失了」。

---

## §7 键盘地图与焦点

### 7.1 全局键位表（**每一行都有实际行为，无占位**）

| 键 | 动作 | 生效模式 | 实现位置 | 备注 |
|---|---|---|---|---|
| `Ctrl+Shift+P` | 打开命令面板 | 全部 | 全局 `keydown` | 与编辑器焦点无关 |
| `Ctrl+P` | 打开快速打开（文件） | 全部（有工作区时） | 全局 `keydown` | **移除** Monaco 的 Ctrl+P 绑定，改为 `pristem:quick-open` 事件转发 |
| `Ctrl+,` | 打开设置页 | 全部 | 全局 `keydown` | DESIGN §8.8.1 |
| `F2` | 打开/关闭模式菜单 | 全部 | 全局 `keydown` | 焦点移到菜单第 1 行；Esc 关闭并还焦到 `.mode-glyph` |
| `Ctrl+B` | 显示/隐藏控制台（coding 的 360px 右列） | coding | 全局 | 其余模式**无控制台**，按键**不响应**（不抢焦点、不报错） |
| `Ctrl+\`` | 聚焦终端 / 再按折叠活动带 | 全部 | 全局 | 活动带折叠时先展开 |
| `Ctrl+S` | 保存当前文件 | 有打开文件时 | 全局 + Monaco | 全局先 `preventDefault`；无打开文件 → 播报「没有可保存的文件」；文件不脏 → 播报「文件已是最新」，**不写盘** |
| `Ctrl+G` | 打开跳行输入 | 有 Monaco 时 | 全局 | 替换现状的 `window.prompt`（§7.3） |
| `Ctrl+W` | 关闭当前编辑器 tab | 有打开文件时 | 全局 | 脏文件先弹保存确认；关闭后活动组自动选相邻 tab |
| `Ctrl+\` / `Ctrl+Shift+\` | 向右 / 向下拆分编辑器 | 有打开文件时 | 全局 | 最多 2 组；关闭一组时 tab 合并回另一组 |
| `Ctrl+Shift+S` | 全部保存 | 有工作区时 | 全局 | 等价 `pristem:save-all-request` |
| `Ctrl+Shift+H` | 聚焦搜索面板的替换行 | 有左栏的模式 | 全局 | 先切到搜索视图，再聚焦替换输入 |
| `Alt+Z` | 自动换行开关 | 有 Monaco 时 | 全局 | 写入 `editorWordWrap` 并立即生效 |
| `Ctrl+Shift+E` | 视图：文件 | 有左栏的模式 | 全局 | goal/deepsleep 无左栏 → 不响应 |
| `Ctrl+Shift+F` | 视图：搜索 | 同上 | 全局 | 同上 |
| `Ctrl+Shift+G` | 视图：版本 | 同上 | 全局 | 同上 |
| `Ctrl+Shift+O` | 视图：大纲（符号浮层） | 有打开文件时 | 全局 | 无文件 → 播报「没有打开的文件」 |
| `Shift+@+F1` | 召唤智能体 | 全部 | 全局 | **仅当编辑器里存在待定的单独 `@`** 才触发（§7.5）；否则不响应 |
| `Shift+@+S` | 恢复上次会话 | 全部 | 全局 | 不在可编辑元素里触发（现状已有 `isEditableTarget` 守卫） |
| `Esc` | 关闭最上层浮层 | 全部 | 全局 | 浮层栈空 → 依次关闭 summon / help / mode-menu / palette（统一走 `overlayStack`，删掉 `App.tsx:406` 的手写多重关闭） |
| `Enter` / `Space` | 激活当前聚焦项 | 全部 | 原生 | roving tabindex 组内 |
| `↑/↓` | 在浮层列表 / roving 组内移动 | 浮层打开时 | 组件内 | — |
| `Tab` | 移动焦点；模态内循环 | 全部 | 原生 + 焦点陷阱 | H-8 |
| `Ctrl+Home` / `Ctrl+End` | transcript 顶部 / 底部 | coding | Transcript | 滚动到顶/底 |
| `Shift+@`（单独） | 不触发任何东西 | — | — | `@` 永远是普通文本（现状保证，必须保持） |

**被删除的键**（Phase 1 之前有、Phase 2 明确去掉）：

| 键 | 处理 |
|---|---|
| `Ctrl+P` 在 Monaco 内（原：聚焦文件树第一项） | **删除**，改为打开快速打开面板（与全局一致） |
| `Ctrl+G` 在 Monaco 内的 `window.prompt` | **删除**，替换为 `.jump-line-pop` 浮层 |
| `Ctrl+Shift+M` / `Ctrl+B` 在 VSCode 语境下的旧绑定 | 不存在，无冲突 |
| 任何「以后再说」的占位键 | **本表即为全集**；新增键必须先进本表 |

### 7.2 焦点顺序（删掉活动栏后）

```
1. 标题栏    [模式控件] [项目 chip] [搜索框] [命令图标] [最小化][最大化][关闭]
              ↑ 品牌块不可聚焦（.brand 无 tabindex）
2. 会话带    [session 01][session 02][+]        （roving tabindex，←/→ 移动）
3. 左栏      [文件][搜索][版本] [⚙]             （roving tabindex）
              → 面板头 → 面板内容（文件树 / 搜索框 / 提交框 …）
4. 舞台      [文档 tab …] [breadcrumb] [符号按钮] → Monaco → [文档状态条]
5. 活动带    [终端][输出][问题] → [bash 1][bash 2][+] → [⌄]  （roving tabindex）
6. 控制台    [头部按钮] → transcript（role="log"，可滚动，Tab 到 composer）→ [composer]
7. 状态栏    [模式控件] [语言切换]               （协议标识不可聚焦）
8. 浮层      最上层优先（模态 → 陷阱内循环；非模态 → 不陷阱）
```

**规则**：
- 删掉活动栏后，**左栏是标题栏/会话带之后的第一个可聚焦区域**。
- 每一行内部按 DOM 顺序；视觉顺序与 DOM 顺序必须一致（`flex-direction` 不做 `row-reverse`）。
- 浮层关闭 → 焦点回到触发元素（快照 `document.activeElement`）。
- **不可聚焦的元素**：品牌块、协议标识、状态栏静态文本、装饰性点、`.term-host` 本身（聚焦的是 xterm 的隐藏 textarea）。

### 7.3 浮层清单、焦点陷阱与关闭规则

| 浮层 | 选择器 | 模态？ | 焦点陷阱 | Esc | 外部点击 | 关闭后焦点回到 |
|---|---|---|---|---|---|---|
| 命令面板 | `.palette[data-pop="palette"]` | **是** | 是 | ✓ | ✗（点击遮罩也关） | 触发元素 |
| 快速打开 | `.palette[data-pop="palette"]`（file 模式） | **是** | 是 | ✓ | ✓ | 触发元素 |
| 模式菜单 | `.mode-menu[data-pop="mode-menu"]` | 否 | 否 | ✓ | ✓ | `.mode-glyph` |
| 设置页 | `.settings-page` | **是** | 是 | ✓ | ✗ | 触发元素（§3.1） |
| 路径对话框 | `.path-dialog` | **是** | 是 | ✓ | ✗ | 触发元素 |
| 跳行 | `.jump-line-pop` | 否 | 否 | ✓ | ✓ | 原焦点 |
| 连接重试 | `.conn-retry-menu` | 否 | 否 | ✓ | ✓ | 指示器（仅断连态存在） |
| 符号大纲 | `.outline-pop` | 否 | 否 | ✓ | ✓ | 原焦点 |
| 摘要通知 | `.toast-stack` | 否 | 否 | ✗（5s 自动消失） | ✓ | 不移动 |
| 任务选择 | `.task-picker[data-pop="task-picker"]` | **是** | 否 | ✓ | ✗ | 触发元素（Run 菜单） |
| 菜单栏下拉 | `.menubar-menu[data-pop="menubar"]` | 否 | 否 | ✓ | ✓ | 顶层菜单按钮 |
| 命令帮助（旧浮层） | — | — | — | — | — | **删除**（内容并入设置页 › 快捷键） |

**实现契约**：
- `overlayStack` 扩展：`push(id, close, { modal: boolean, returnFocus: HTMLElement | null })`。
- `overlayStack.pop()` 无参时弹**最上层**（现状已是）；`modal` 层在打开时给底层加 `inert`（`document.querySelector('.workbench').inert = true`），关闭时移除。
- **一次 Esc 只关一层**。现状 `App.tsx:404-407` 在 `overlayStack.pop()` 返回 false 后又手工关闭 4 个状态 —— 改为：所有可关闭浮层**必须** `useDismissable` 注册到 `overlayStack`；Esc 统一走 `overlayStack.pop()`，栈空时**不做任何事**（不关工作台）。
- `installOutsideDismiss()` 维持：点击 `[data-pop]` / `[data-pop-trigger]` 之外 → 弹最上层。模态层不响应外部点击（必须走 Esc 或按钮）。

### 7.4 跳行（`Ctrl+G`）—— 替换 `window.prompt`

```
┌─ .jump-line-pop（锚在舞台左下，宽 240px）────────────────┐
│ 跳到行号                                                │
│ [        42 ]  [ 跳转 ]                                  │
└──────────────────────────────────────────────────────────┘
```

| 项 | 规格 |
|---|---|
| 位置 | 锚定在舞台左下角（`.monaco-host` 左下，12px 内缩），不居中 |
| 输入 | mono 11.5px，宽 120px，只接受数字；`Enter` 跳转；`Esc` 取消 |
| 非法输入 | 空或非数字 → 输入框 `aria-invalid="true"`，下方 11px 「请输入行号」，不跳转 |
| 越界行号 | 行号 > 文件行数 → 「这个文件没有这么多行」，不跳转 |
| 跳转动作 | `revealLineInCenter(line)` + `setPosition({lineNumber:line, column:1})` + 焦点给编辑器 |
| 关闭 | 跳转后自动关闭；Esc 关闭并还焦原位置 |

### 7.5 `Shift+@+F1` 的精确语义

现状：全局监听 `e.key === '@' && e.shiftKey` 置 `atHeld`，`atHeld && F1` 触发召唤；`pristem:remove-at` 事件删除 Monaco 里待定的 `@`。

**问题**：若焦点在 composer（可编辑元素），`@` 会被真打进去，触发后 `@` 留在输入框里。

**决策**：
- `Shift+@+F1` **只在 Monaco 里存在待定单独 `@` 时触发**（即 `pendingAt.current !== null`）。
- 实现：`App.tsx` 的全局处理改为 —— 触发时派发 `pristem:remove-at`；`EditorPane` 的 `deletePendingAt()` 成功删除后，回派 `pristem:summon-ready`；`App` 收到该事件才打开召唤浮层。**删除 `@` 与「打开浮层」由编辑器侧的原子操作保证**，不会出现「@ 还在但浮层开了」。
- 没有待定 `@` 时：`Shift+F1` **不响应**（不抢 F1 的默认行为，不弹任何东西）。
- `Shift+@+S` 保持现状守卫：`!isEditableTarget(e.target)` 才触发（不在输入框里劫持大写 S）。

### 7.6 各模式下的键位有效性

| 键 | IDE | coding | helping | advisor | deepsleep | goal |
|---|---|---|---|---|---|---|
| `Ctrl+Shift+P` 命令面板 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `Ctrl+P` 快速打开 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓（无工作区 → 空态 + 打开文件夹） |
| `Ctrl+,` 设置 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `F2` 模式菜单 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `Ctrl+B` 控制台 | ✗（无控制台） | ✓ | ✗（控制台在下方通栏） | ✗ | ✗ | ✗ |
| `Ctrl+\`` 终端 | ✓ | ✓ | ✗（活动带折叠） | ✗ | ✗ | ✗ |
| `Ctrl+S` 保存 | ✓ | ✓ | ✓ | ✓ | ✗（工作台 inert） | ✗ |
| `Ctrl+G` 跳行 | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| `Ctrl+Shift+E/F/G/O` | ✓ | ✓ | ✓ | ✗（左栏 0 宽） | ✗ | ✗ |
| `Shift+@+F1` 召唤 | ✓ | ✗（有 composer，直接输入） | ✗ | ✗ | ✗ | ✗ |
| `Shift+@+S` 恢复上次会话 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

**deepsleep 的工作台 inert**：`.workspace` 在 deepsleep 下 `pointer-events:none`（DESIGN §8.4.1）。键盘上必须同步：给 `.workspace` 加 `inert` 属性 → 其内部所有元素不可聚焦、不可 Tab 到。**只做 `pointer-events:none` 是不够的**（键盘仍能进 Monaco）。

**goal 的工作台不存在**（F7 断言：`.filetree` / `.monaco-host` / `.term-host` 元素数 = 0）→ 键位天然失效。

**IDE 的架构性休眠**（F5 断言：`[data-ai="true"]` 元素数 = 0）→ 控制台、vitals、刻度器、光晕、composer 全部不渲染。

### 7.7 菜单栏（仅 IDE）

- 位置：标题栏项目 chip 之后（`ChromeExtras.tsx` 的 `menubar` 槽位）。其他模式**不渲染** `.menubar`。
- 数据：`commands.ts` 的同一张命令表；菜单结构（File / Edit / View / Run / Help）只是命令 id 的排列，**没有第二写实现**。
- 键位：`←/→` 在顶层菜单间移动（打开时自动切换），`↑/↓` 在条目间移动，`Enter/Space` 执行，`Esc` 关闭并把焦点还给顶层按钮。
- 禁用项：`disabled` + `title` 说明原因（如「当前文件没有可用的运行器」）；禁用项不可聚焦。
- `<1200px`：顶层标签隐藏，显示 `≡`，点击打开命令面板（同一张表的另一种呈现）。
- 静态约束：类名是 `.menubar`，**不得**复用 `.title-menus` / `.title-menu-btn`（L2 断言仍要求这些旧类名不存在）。

### 7.8 工作区持久化

- 键：`pristem.ws:<root>`，由 `workspaceState.ts` 读写（`writeWorkspaceState` 300ms 防抖）。
- 内容：展开目录、编辑组（每组 path 列表 + activePath）、拆分方向与比例、活动带开合与 tab、左栏视图、三处尺寸。
- 恢复时机：`fs.openFolder` / 启动恢复根目录之后；逐级展开祖先目录，缺失路径静默丢弃，尺寸按 `clampSize` 收敛。
- 关闭工作区：清内存，**保留** storage（再次打开可恢复）。
- 刷新页面：恢复 tab / 展开 / 尺寸（`_phase4-selfcheck.cjs` 4d 断言）。

### 7.9 PTY 不可用时的降级

`shell.capabilities.pty === false` 时：

- 终端面板仍可打开，但 `.term-host` 显示一行说明（`[PTY unavailable: …]`），tab 标记 `.is-exited`，**不自动关闭**；
- 输入不再发送 `term.write`（没有会话）；`term.run` 类命令（运行测试、Git 之外的克隆等）由壳层的 `proc.exec` / 一次性命令承担；
- Git 面板完全不依赖 PTY（`proc.exec`），所以降级不影响版本视图；
- 不报错、不弹卡片：降级是一等状态，不是失败。

**请求的 shell 起不来**（例如本机 Windows PowerShell 5.1 在 ConPTY 下 0xC0000142）：壳层给伪控制台一个回车触发首帧，1.2s 内没有输出就杀掉子进程（系统错误框被 `SetErrorMode` 抑制/随进程关闭），改用 **ConPTY + cmd** 重试，最后才退到管道；失败过的 shell 在本进程内不再重试。`term.open` 的 `shell`/`path`/`kind` 返回真实结果（`pty` 或 `pipe`），tab 名与实际一致。启动期间的按键在 UI 侧排队，`term.open` 成功后按序发送，不会丢。

**Ctrl+C** 走 `term.interrupt`：终止该会话 shell 的子进程（正在跑的命令），shell 与其 cwd 存活，随后正常给新提示符。xterm 在没有选区时拦截 Ctrl+C 调用该 op；`运行：停止任务` 同路径。管道回退下同样有效（同样是子进程树终止，字节 0x03 只是兜底）。

---

## §8 无障碍与降级矩阵

### 8.1 aria-live 播报文案表

现状 `living.ts:137` 的 `announce()` 有两个问题：① 只有**一个** live region（`role="status"`），错误与普通事件混在一起；② 播报「pristem 正在执行」——播报的是**品牌**而不是**状态**（DESIGN §2.4 #17 要求删品牌词）。

**改造**：拆成两个区域
- `.sr-only[role="status"][aria-live="polite"]` —— 常规进度
- `.sr-only[role="alert"][aria-live="assertive"]` —— 需要打断的错误 / 拦截 / 等待确认

| 事件 | 播报文案（zh） | 区域 | 节流 |
|---|---|---|---|
| `speech` / `call` / `result` | 正在执行 | polite | 同类 500ms 内合并 |
| `answer` | 回答已就绪 | polite | 500ms |
| `finished` | 执行完成 | polite | 500ms |
| `usage` | 本轮消耗 {{in}} 输入、{{out}} 输出 token | polite | 1500ms |
| `mode_changed` | 模式已切换为 {{中文模式名}} | polite | 立即 |
| 模式 pending | 正在切换到 {{中文模式名}} | polite | 立即 |
| 模式失败 | 不能从 {{from}} 切换到 {{to}} | **assertive** | 立即 |
| 模式代答超时 | 内核没有确认这次切换 | **assertive** | 立即 |
| `intercepted` | 内核拦截了一次动作 | **assertive** | 立即 |
| `error` | 内核报错：{{message 前 80 字}} | **assertive** | 立即 |
| `buttons` | 等待你的确认 | **assertive** | 立即 |
| `providers` | 已连接 {{n}} 个模型端点 | polite | 1500ms |
| `provider_changed` | 已切换到 {{model}}，下一轮生效 | polite | 立即 |
| 队列满 | 队列已满，最多 5 条 | **assertive** | 立即 |
| 无可导出内容 | 没有可导出的内容 | polite | 立即 |
| 终端实例 pending | bash {{n}} 命令执行中 | polite | 500ms |
| 文件已是最新 | 文件已是最新 | polite | 立即 |
| 没有可保存的文件 | 没有可保存的文件 | polite | 立即 |
| 路径错误 | {{校验错误文案}} | **assertive** | 立即 |

**规则**：
1. **播报只说状态与动作，不说品牌名**（DESIGN §2.4 #17）。禁止出现「pristem 正在执行」。
2. 播报**不重复可见文本**（如果同一个信息已经在视口里且有 `role="status"` 的元素，live region 不再复述）。例外：错误与确认必须播报，因为它们可能出现在视口外。
3. 节流按「类别」而非「事件」：`lastAnnounce.cat` 的 500ms 窗口沿用现状机制，扩展到上表每一行。
4. 模式名用**中文名**（深睡 / 编码协作 / 协助执行 / 审阅席 / 目标 / 仅编辑器），不用 `deepsleep` 这种标识符 —— 读屏用户听到的是人话。

### 8.2 动效 → 非动效等价表达（H-4 逐条）

| 动效 | 等价表达（`prefers-reduced-motion: reduce` 下**换表达**，不是关掉） | 判据 |
|---|---|---|
| 标题栏呼吸光晕 | 静态光晕 + 标题栏品牌块始终可见 + 模式名文本 | `.living-halo` 的 opacity 取计算值；`animation: none` |
| 顶部脉冲带 | 静态 `--living-gain` 亮度 + 状态栏运行态文字 | `.app-shell::after` 无位移 |
| 骨架 shimmer | 静态斜纹（`repeating-linear-gradient(45deg, --surface-raised 0 6px, --surface-float 6px 12px)`，opacity .35） | DESIGN §5.6 |
| 三点思考 | 静态实心点 + 文字「正在思考…」 | `.thinking-dots i` 去掉动画 |
| 刻度器档位过渡 | 立即切换（`--presence` 无过渡） | 亮格数立刻变 |
| 模式切换 pending 脉冲点 | **文字「切换中」**（本来就必须有，不依赖动效） | §1.6 |
| 终端实例 pending 点 | 胶囊 `aria-label` 追加「· 命令执行中」+ `title` | §4.3 |
| deepsleep 时间流逝滚动 | 静态列表（保留全部行，不裁切） | `.sleep-log` 去 `mask-image` |
| 面板展开/收起 | 立即展开/收起 | `transition-duration: 0ms` |
| 指针跟随高光 | `transform: none` | 已有 `@media (pointer: coarse)`，扩展到 `reduce` |

**通用规则**：任何带动效的状态元素，**同一元素内**必须有一个文字标签或形状差异表达该状态。DESIGN §5.6 已点名 `.running-pill i`（脉冲圆点）、`.status-pill`（纯色文字）、`.flow-dot`（空心圆）需要补文字或形状区分 —— 落地为：
- `.running-pill` → 「工作中 / 等待确认 / 已阻塞」**文字**（三种运行态必须能区分，DESIGN §8.1）。
- `.flow-dot` → 执行链的圆点已有 ok/blocked 两种形状与右侧文字（§8.7.3）→ 保持。
- `.status-pill` → 已有文字（`ok` / `blocked` / `pending`）→ 保持。

### 8.3 降级矩阵（DESIGN 附录 B 的 B-1 ~ B-8 + 本文新增的 B-9 ~ B-12）

| # | 依赖 | 归属 | 未支持时用户看到什么 | 能用吗 | 怎么提示 |
|---|---|---|---|---|---|
| **B-1** | `ServerEvent::Usage` | `pristem-ipc` | **vitals 条整条不渲染**（无空白、无 `0`、无破折号） | 能（只是看不到用量） | **无提示**（不显示占位符就是最诚实的提示） |
| **B-2** | `fs.pickFolder` 原生对话框 | 壳层 | 打开文件夹 → **直接弹路径粘贴对话框** | 能 | 对话框顶部一行 11px **`--text-2`**「本机没有提供文件夹选择器，请粘贴路径」（对话框底是 float，text-3 不可用）|
| **B-3** | 壳层不再回显命令行 | 壳层 | **未改前**：终端出现 `›` 与 `pristem@workspace %` 两套提示符 → **这是阻塞项，必须先改壳层** | ✗ | UI 侧防御：过滤掉以 `pristem@workspace % ` 开头的输出行（临时兜底，不解决双提示符的根因） |
| **B-4** | `term.run` 的 `instance` | 壳层 | **只显示 1 个终端实例**；实例胶囊区与 `+` 按钮**不渲染** | 能（单实例） | **无提示**（不出现「多实例」字样，不假装支持） |
| **B-5** | `fs.list` 的 `path` 参数 | 壳层 | 文件树**只展开 1 层**；目录项**不可展开** | 部分 | 目录项右侧 12px `--text-3`「仅一层」+ `title="此版本只能展开一层"` |
| **B-6** | `provider_changed` / `providers` 事件 | `pristem-ipc`（已有） | composer 脚部**不显示** provider 名（不写死 `pristem-core`）；设置页 › 模型与连接显示「内核没有返回 provider 列表」+ 行动「重试」 | 能（设置页该分区不可用） | 设置分区内联 `EmptyState variant="error"` |
| **B-7** | 内核配置读写 | `pristem-ipc` | 纯本地设置走 `localStorage`；内核相关项标注 chip「本次会话有效」 | 部分 | chip 本身 |
| **B-8** | `fs.list` 响应的 `protocol` 字段 | 壳层 | 状态栏**不渲染**协议徽标（不写死版本号）；设置页 › 关于的版本行同样不渲染 | 能（只是看不到版本号） | **无提示** |
| **B-9** | `{"op":"shell.capabilities"}` op | 壳层 | op 未知 → 视为**全部能力为 false**：单终端实例 + 粘贴对话框 + 文件树一层 | 能（降级可用） | 同 B-2 / B-4 / B-5 各自的提示 |
| **B-10** | `ServerEvent::Error` 带 `session: u64` | `pristem-ipc` | 错误按「pending 意图 + 当前活跃会话」匹配 | 能（准确度略降） | 无 |
| **B-11** | 内核 `Buttons.prompt` 不得承诺启动独立实例（该串的修改属内核责任） | `pristem-ipc` | P2 | UI 用自己的诚实文案表达代价，**不复述内核 prompt** | 能 | 无 |
| **B-12** | 内核把 deepsleep 的 clean instance 活动以 `call`/`result`（带 `session`）回灌到主会话事件流 | `pristem-ipc` | deepsleep 中央列展示**进入休眠前那一轮**的链，标题写实为「进入休眠前的执行链」；链为空则整块不渲染（§1.9） | 能（链是休眠前的，不是休眠中的） | 无 |

**降级的统一原则**：**能力缺失时，界面减少功能，不增加解释文字来掩饰**。唯一允许的解释文字是「为什么这个控件不可用」和「本机没有提供 X，请用 Y」——两句都在使用场景里，不是免责声明。

### 8.4 焦点与读屏的硬约束

| # | 约束 |
|---|---|
| 1 | 模态浮层打开时，底层加 `inert`；读屏与键盘都进不去底层。 |
| 2 | 每个 `<button>` / `<a>` / `<input>` 有可访问名称（`aria-label` 或可见文本）。图标按钮**必须**有 `aria-label`。 |
| 3 | 所有 `<div role="tab">` 必须有 `role="tablist"` 父容器 + `aria-selected` + 可键盘操作（`←/→`）。 |
| 4 | transcript 是 `role="log" aria-live="polite"`（现状已是）；新增的确认卡改为 `role="group" aria-label="需要确认"` + 独立的 assertive 播报。 |
| 5 | 焦点环统一 `--focus-ring`（DESIGN §4.1）；不得被 `overflow:hidden` 裁掉。 |
| 6 | 颜色不是唯一信道：错误除 `--danger` 外有左侧 2px 竖条；状态除颜色外有文字。 |
| 7 | 动态内容（vitals、实例 pending、问题数）用 `aria-live="polite"` 区域承载，不抢焦点。 |
| 8 | `aria-label` 里不出现品牌词（与可见文本同一标准，DESIGN §2.4 #17）。 |

### 8.5 窗口尺寸降级（760–1040px）

原生窗口最小内尺寸 760×560。桌面端不做移动端布局；三个宽度档只改变**列的存在形式**，
不改信息架构、文案与功能归属。

| 宽度 | 文件树 | 会话面板（右栏） | 标题栏 |
|---|---|---|---|
| ≥1200 | 268px 列 | 360px 列（用户可拖宽，≤680px） | 完整：会话胶囊 + 搜索胶囊 + 菜单栏 |
| 1041–1199 | 268px 列 | 用户宽度，最多 360px | 菜单栏收成一个按钮；其余不变 |
| 881–1040 | 268px 列 | `min(320px, 用户宽度)` 列 | 同上 |
| 760–880 | 268px 列 | **覆盖式**：`--right-w: 0`，面板浮在文件树右侧的整个工作区上 | 搜索胶囊收成 26px 图标（聚焦展开 220px）；会话胶囊隐藏 |

- 覆盖式右栏是抽屉：点面板头部的 `×` 关闭；`Shift+@+S` 或命令面板仍可重新打开。
  关闭后编辑器恢复原宽度，不写入用户宽度记忆。
- 会话胶囊隐藏期间，会话面板本身仍可用 `Shift+@+S` 打开；宽度档不修改用户保存的
  `--right-w`，只在本档内做 `min()` 收敛。
- 每档都必须满足：`document.scrollingElement.scrollWidth === clientWidth`（无横向滚动），
  标题栏 `scrollWidth <= clientWidth`（无控件挤出）。验证截图：760 / 880 / 1040 / 1440。

---

## §9 13 条用户反馈 → 可执行验收步骤

### 9.0 验收口径（对齐 `DESIGN_SYSTEM.md` §9.0，三层执行）

本文的断言全部属于 **L1 自动化断言**层，跑在 `.visual-check/check.cjs`（Playwright + Edge headless，viewport 1440×900）。三层分工：

| 层 | 手段 | 本文的归属 |
|---|---|---|
| **L1 自动化断言** | 扩写 `.visual-check/check.cjs`，逐条实现 §9.1–9.8 的 ✅ 项 | **本文 §9.1 + 附录 D**（本文的断言是 L1 的**增量**，不替代 DESIGN §9.1–9.8 的 81 条） |
| **L2 源码静态检查** | 对 `ui/src/` 做正则 / AST 级检查 | 本文的 **D-5**（源码不得出现 `'pristem.ipc/v0.` 字面量）、**D-3a**（字段名必须是 `instance` 不是 `term_id`）、**D-4a**（`Usage` 不得含 provider / model 字段）属这一层 |
| **L3 截图比对** | 复用 `.screenshots/` 的 15 张基准图重新出图比对 | 静态判不了的项（字标计数 B2、beam 配额 C6、棱镜计数 B1/G10、状态栏元素数 F8） |

**退回格式（强制，照抄 DESIGN §9.0）**：每条不达标写成一行 ——
`[清单编号] 文件:行 — 现象 — 期望值 — 实测值`
例：`[G4] ui/src/workspace.tsx:515 — 连续 3 条命令后出现 5 个 › — 每行 1 个 — 实测 5 个`

**「验收不通过不算完成」**：任一条 ✅ 未通过，Phase 3 不得标记完成。

**一条通用诚实性判据（§9.1 第 22 条）**：界面**不得声称内核做不到的事**。这条比逐条列文案更狠 —— 它的判据是「**全屏可见文本中不得出现那 9 个中文 + 12 个英文措辞**」，任何一处残留都算不通过。**Phase 3 结束时它会在每一种模式下各跑一遍。**

**⚠ 元规则（team-lead 确认采纳，视觉负责人提出）：所有文本类断言的输入源必须是运行时 DOM。**

> 断言读 `document.body.innerText` / 遍历**运行时**文本节点，**不得取自规范文档**（`DESIGN_SYSTEM.md` / `UX_SPEC.md`）。
>
> 理由：`DESIGN_SYSTEM.md` §8.12.1 的禁用措辞表**本身就要列出那些词**（那是「现值」列），如果断言去扫规范文档，**脚本就在给自己打分**。
> 配套约束：① 扫描对象是**可见**文本节点（`display:none` / `visibility:hidden` 排除）；② 断言代码里的正则**必须**包含禁用词本身 —— 这与「不得扫规范文档」不矛盾：**词在断言里可以，在界面里不行**。

### 9.1 逐条

> **每一条的自动化覆盖层级见 §9.2。** 标注为 **人工核对** 的条目**不计入自动化通过率**，Phase 3 结束时由 visual-architect 实测并人工确认。

| # | 用户反馈 | 点哪里 | 看到什么 | 断言（选择器 + 期望） | check 名称 |
|---|---|---|---|---|---|
| **1** | 品牌图标分裂 | 任意模式 | 只有标题栏 1 个棱镜 | `document.querySelectorAll('.brand-prism').length` **≤ 2**（通常 = 1）；`.living-core/.living-eye/.living-bloom/.living-highlight` 计数 **= 0** | `brand: prism count <= 2` |
| **2** | deepsleep 唤不醒 / 回不去 | 状态栏 `.mode-glyph` → 模式菜单 → 点 `deepsleep` | **一次点击**直接进入 deepsleep（无二次确认） | `await page.waitForFunction(() => document.querySelector('.app-shell')?.className.includes('mode-deepsleep'))`，超时 5000ms（现状需 2 次点击）；`.line-buttons` 计数 **= 0** | `deepsleep: one click, no second confirmation` |
| **2b** | 同上 · 三条返回路径 | deepsleep 层 | 存在 `.deepsleep-resume` 按钮；状态栏 `.mode-glyph` 可点；唤醒卡片上有返回按钮 | `page.locator('.deepsleep-resume').count() === 1`；点它 → `mode-coding`；唤醒卡片 `.wake-card` 存在且有 `✕` | `deepsleep: three return paths exist` |
| **3** | deepsleep 毫无动态 | 进入 deepsleep | 标题栏有光晕，呼吸周期 12s | `getComputedStyle(document.querySelector('.living-halo')).animationDuration` **= '12s'**；deep-sleep 下不存在周期 < 2s 的动画 | `deepsleep: 12s breathing halo` |
| **4** | 看不到 token 消耗 | 有 `usage` 事件时 | vitals 条出现且含 **5 项**（in / out / cached / elapsed / tool_calls），**不含** provider / 模型名（D-4a） | 无 usage 事件：`.ai-vitals` 计数 **= 0**（不是显示 0）；有事件：文本含 `in` / `out` / `cached` / `calls` / `s`，且**数值与事件一致**（D-4c） | `usage: vitals row absent without event` |
| **5** | 「演示执行流」标签 | 任意模式 | 全文没有「演示 / demo / 假数据 / 未完成 / 占位 / TODO」 | 遍历可见文本节点，正则 `/演示\|demo\|假数据\|未完成\|占位\|TODO/i` 命中数 **= 0**；`.ai-demo-tag`/`.demo-source-tag`/`.tool-card-demo-prefix` 计数 **= 0** | `no demo wording anywhere` |
| **6** | 打不开文件夹 | 文件树头 `.pane-head .icon-btn[aria-label="打开文件夹"]` | 发 `fs.pickFolder`（不是切视图） | 拦截 `POST /api/io` 的 body，`op === 'fs.pickFolder'`；`.path-input` 计数 **= 0**；路径对话框 `.path-dialog` 可打开且含最近项目 | `open folder: sends fs.pickFolder` |
| **6b** | 同上 · 兜底 | 能力为 false 时点「打开文件夹」 | 弹出 `.path-dialog` | `.path-dialog` 计数 = 1；`.path-dialog-input` 有 `aria-label="文件夹路径"`；空提交 → 内联错误「请输入文件夹路径」 | `open folder: paste fallback validates` |
| **7** | 设置太少且挤在左栏 | `Ctrl+,` | 打开**独立页**，7 个分区 | `.settings-page` 计数 = 1；`.settings-panel` 计数 **= 0**；`.settings-section` 计数 **≥ 7**；`.settings-nav` 内导航项计数 = 7 | `settings: standalone page with 7 sections` |
| **8** | 模式菜单图标不一致 | F2 打开模式菜单 | 6 行刻度器，左→右填充，亮格数 0..5 递增 | 逐行数 `.mode-menu .dial-cell.on`，得到 **[0,1,2,3,4,5]** 的某个排列且**单调递增**；状态栏 `.dial` 宽 **= 23px** | `dial: 5 cells, left-to-right fill` |
| **9** | goal 模板框太大 | 进入 goal | 一行 chip | `.goal-template` 高度 **≤ 28px**；所有 `.goal-template` 的 `offsetTop` **相同**（同一行）；`.goal-templates` 计数 = 3 | `goal: starters are one row of chips` |
| **10** | 「目标/约束/取舍」是假功能 | 进入 goal | 没有这 3 个 chip | `.intent-chip` 计数 **= 0** | `goal: no fake intent chips` |
| **11** | 衬线字标（中文宋体） | 中文界面 | 中文标题用 `--font-ui` | `.sleep-center h1`/`.wake-card h2` 的 `getComputedStyle(el).fontFamily` **不含** `serif` / `Songti`；`--font-display` 在 `styles.css` 中**不存在** | `typography: no serif for CJK` |
| **12** | 「pristem」出现太多次 | 任意模式 | 字标只有标题栏 1 处 | 可见文本节点匹配 `/^pristem\.?$/i` 计数 **= 1**（`pristem.ipc` 协议标识不计） | `brand: wordmark appears once` |
| **13a** | 三个死 tab | 活动带 | 三个 tab 是 `<button>` 且可切 | `.panel-tabs [role="tab"]` 计数 = 3 且每个 `tagName === 'BUTTON'`；点「输出」→ `.output-panel` 出现；点「问题」→ `.problems-panel` 出现 | `activity strip: three real tabs` |
| **13b** | 终端提示符错乱 | 终端跑 3 条命令 | 每行恰好 1 个 `›` | 读 `.xterm-rows` 文本，逐行数 `›`，每行 **≤ 1**；文本**不含** `pristem terminal`；**不含** `pristem@workspace %` | `terminal: one prompt per line` |
| **13c** | 不能多终端 | 活动带 `+` | 新建实例 `bash 2` | 能力支持时：`.term-instance` 计数 = 2，第二个名为 `bash 2`；切换后第一个的 `.xterm-rows` 内容**仍在**（scrollback 保留）；能力不支持时：`.term-instance` 计数 = 1 且无 `+` 按钮 | `terminal: multiple instances` |
| **14** | 「为什么我要自己同意」（模式闭环） | 模式菜单 → `deepsleep` | 一次点击到位 | 见 #2（同一断言）；且 `App.tsx` 中不再有 `handoff > 0` 的条件自动 confirm | `mode switch: user intent is the consent` |
| **15** | 「为什么有一些有动画有一些没有」 | 模式菜单 | 只有当前档位的刻度器有辉光，其余行**无动画** | 菜单打开时 `getAnimations()` 里 `iterations === Infinity` 的元素数 **≤ 1**（仅当前档位的刻度器/光晕） | `motion: one infinite animation at a time` |
| **16** | 「为什么设置不能打开一个新界面」 | 左栏 ⚙ | 设置页覆盖工作区，标题栏/会话带/状态栏仍在 | `.settings-page` 存在时 `.titlebar` / `.session-bar` / `.statusbar` **仍存在**；Esc 后 `.settings-page` 计数 = 0 | `settings: opens as a separate view` |
| **17** | 确认只应有一处 | 触发一次内核确认 | 只有 transcript 内一处 | `.confirm-toast` 计数 **= 0**；`.line-buttons` 计数 ≤ 1 | `confirm: single surface` |
| **18** | toast 不得重复连接状态 | 制造一次操作失败 | toast 里只有动作，没有「内核未连接」 | 全屏文本搜索「内核未连接」出现次数 **= 1**（DESIGN G12）；`.toast-stack` 文本**不含**「内核未连接 / 离线夹具 / 内核已连接 / 正在连接内核」 | `toast: never repeats connection state` |
| **19** | 连接恢复路径 | 点状态栏连接指示器 | 下拉里出现「重试连接」 | `.conn-retry-menu` 计数 = 1；其内文本含「重试连接」；`Esc` 后计数 = 0 且焦点回到指示器 | `connection: retry lives in the status bar` |
| **20** | deepsleep 不渲染控制台 | 进入 deepsleep | 只有 deepsleep 层 + 变暗工作台 | `.ai-panel` 计数 **= 0**（控制台不存在）；`.deepsleep-layer` 计数 = 1 | `deepsleep: no console surface` |
| **21** | pending 态必须有文字 | 点模式菜单某行 | 目标行出现「切换中」 | `.mode-menu-pending` 的 `innerText` **含**「切换中」（不能只有圆点） | `mode menu: pending has a text label` |
| **22** | **通用诚实性判据**：界面不得声称内核做不到的事 | 任意模式，遍历全部**可见**文本 | 无下列中英措辞 | 遍历运行时文本节点，**中文与英文分别**做正则，命中数 **= 0**（每种模式各跑一遍）。<br>**中文 9 词**：干净实例 / 新实例接手 / 正在复盘 / **复盘输出链** / 消化中 / 交回内核消化 / 已提交新规则 / 在休眠期间提交 / 内核没有提交新规则<br>**英文 12 词**（DESIGN §8.12.1 与 team-lead 转达清单的**并集**）：clean instance / new instance takes over / reviewing its own output chains / reviewing output chains / digesting its output chains / digesting / hand back to the kernel / rules committed / committed during deepsleep / submitted during sleep / no new rules were committed / summarize changes | `honesty: no claims the kernel cannot deliver` |
| **23** | **i18n 兜底文案不得出现在运行时** | 任意模式 | 无「内容暂不可用」/「Content unavailable」 | 遍历运行时可见文本节点，正则 `/内容暂不可用\|Content unavailable/` 命中数 **= 0**。<br>理由：`i18n.ts` 的 `t()` 在 key 缺失时回落到 `'common.contentUnavailable'` —— 这是「**key 没接上**」的信号。key 改名（如 `mode.hint.deepsleepCost` → `mode.hint.deepsleepTitle`）若漏改调用点，界面会安静地显示一句废话，而它**不在禁用词表里**，第 22 条抓不到 | `i18n: no fallback text on screen` |
| **24** | 睡 log 只显示时间标记 | 进入 deepsleep，等 5s | 每行 `已归档 · HH:MM` | `.sleep-log` 全部文本节点逐行匹配 `/^(已归档 \|Archived)( · \d{2}:\d{2})?$/`；且与 `items` / transcript 文本**无交集**（DESIGN §9.12 M12） | `deepsleep: sleep log shows time only` |

### 9.2 自动化覆盖对照表（L1 / L2 / L3）

**这张表是 §9.1 每一条的「能不能被自动化断言」的唯一权威。** 「人工核对」= 无法用 `getComputedStyle` / DOM 查询 / 文本遍历判定，必须由人眼看或手动操作确认。

> **元规则（适用于本表全部文本类断言）**：输入源**必须是运行时 DOM** —— 读 `document.body.innerText` / 遍历运行时可见文本节点，**不得取自规范文档**（理由见 §9.0）。

| §9.1 # | 覆盖层 | 落地方式 | 对应 check 名称 / 判定方法 |
|---|---|---|---|
| 1 品牌图标分裂 | **L1 自动化** | DOM 计数 | `brand: prism count <= 2`、`brand: legacy living parts removed` |
| 2 deepsleep 一次点击 | **L1 自动化** | `waitForFunction` + DOM 计数 | `deepsleep: one click, no second confirmation`、`deepsleep: no confirmation card left behind` |
| 2b 三条返回路径 | **L1 自动化**（P1/P3）/ **人工核对**（P2 视觉可点性） | DOM 存在性 + 交互 | `deepsleep: resume button exists`、`deepsleep: workbench still mounted`、`deepsleep: workbench is not interactive`；**P2**（状态栏控件在 deepsleep 下可点并能打开菜单）→ **人工核对**（D-1b 的违反判定写的是「交互测试」，本文把它拆成可自动化的部分与需人工确认的部分） |
| 3 deepsleep 动态 | **L1 自动化** | `getComputedStyle(...).animationDuration` | `deepsleep: 12s breathing halo` |
| 4 token 消耗 | **L1 自动化** | DOM 存在性 + 文本数值比对 | `usage: vitals row absent without event`（有事件时的五项数值比对属 **L1**，但需要内核在线发 `usage`） |
| 5 演示痕迹 | **L1 自动化** | 文本遍历正则 | `no demo wording anywhere`、`no demo tag elements` |
| 6 打不开文件夹 | **L1 自动化** | 拦截 `/api/io` 请求体 | `open folder: sends fs.pickFolder`、`open folder: path input is gone` |
| 6b 兜底对话框 | **L1 自动化** | DOM + 交互 | `open folder: paste fallback validates` |
| 7 设置独立页 | **L1 自动化** | DOM 计数 | `settings: opens as a separate view`、`settings: side-panel version is gone`、`settings: at least 7 sections`、`settings: nav has 7 items`、`settings: chrome stays reachable` |
| 8 刻度器一致性 | **L1 自动化** | DOM 计数 + `getBoundingClientRect` | `dial: 5 cells, left-to-right fill`、`dial: status-bar dial is 23px` |
| 9 goal 模板太大 | **L1 自动化** | `getBoundingClientRect` + `offsetTop` | `goal: starters are one row of chips` |
| 10 假功能 chip | **L1 自动化** | DOM 计数 | `goal: no fake intent chips` |
| 11 衬线字标 | **L1 自动化**（font-family）+ **L2 静态**（`--font-display` 残留） | `getComputedStyle` + 源码搜索 | `typography: no serif for CJK`；`--font-display` 残留属 DESIGN B4（L2） |
| 12 pristem 出现太多次 | **L1 自动化** | 文本节点遍历 | `brand: wordmark appears once` |
| 13a 三个死 tab | **L1 自动化** | DOM 标签名 + `aria-selected` | `activity strip: three real tabs`、`activity strip: output tab renders`、`activity strip: problems tab renders` |
| 13b 提示符错乱 | **L1 自动化** | `.xterm-rows` 文本逐行计数 | `terminal: one prompt per line` |
| 13c 多终端 | **L1 自动化**（能力为 true 时）/ **SKIP**（能力为 false 时） | DOM 计数 + 名称断言 | `terminal: multiple instances` / `terminal: single instance when unsupported` |
| 14 模式闭环 | **L1 自动化** | 同第 2 条 | `deepsleep: one click, no second confirmation` |
| 15 动画一致性 | **L1 自动化** | `getAnimations()` 枚举 | `motion: one infinite animation at a time` |
| 16 设置新界面 | **L1 自动化** | DOM 计数 + 交互 | `settings: opens as a separate view`、`settings: Esc closes` |
| 17 确认唯一载体 | **L1 自动化** | DOM 计数 | `confirm: single surface` |
| **D-5 协议徽标** | **L1 自动化** + **L2 静态** | 与 `fs.list.protocol` 比对；源码无 `'pristem.ipc/v0.` 字面量 | `D-5: badge equals fs.list.protocol` / `D-5: badge not rendered without fs.list.protocol`；源码字面量检查属 L2 |
| **§1.9 deepsleep 执行链的数据来源** | **L1 自动化** | deepsleep 下 `.deepsleep-chain` 的标题文本 | 断言标题**不含**「休眠期间」且**含**「进入休眠前」；链为空时 `.deepsleep-chain` 计数 = 0 |
| **§1.10 唤醒简报三条语义** | **L1 自动化** | 卡片文案与列表项结构 | 断言 lead 含「新规则」；清单项**不含**文件图标（`.wake-card li svg` 计数 = 0）；清单项**不含**编辑/删除按钮 |
| **第 18 条 toast 不重复连接状态** | **L1 自动化** | 全屏文本遍历 + DOM | `toast: never repeats connection state` |
| **第 19 条 连接恢复路径** | **L1 自动化** | DOM 计数 + 文本 | `connection: retry lives in the status bar` |
| **第 20 条 deepsleep 无控制台** | **L1 自动化** | DOM 计数 | `deepsleep: no console surface` |
| **第 21 条 pending 有文字** | **L1 自动化** | 文本断言 | `mode menu: pending has a text label` |
| **第 22 条 通用诚实性判据** | **L1 自动化** | 遍历**运行时**文本节点 + **中英双语**正则 | `honesty: no claims the kernel cannot deliver`（**任何模式**都要跑一遍；**中英各跑一次**） |
| **第 23 条 i18n 兜底文案** | **L1 自动化** | 遍历**运行时**文本节点 + 正则 | `i18n: no fallback text on screen` |
| **第 24 条 睡 log 只显示时间** | **L1 自动化** | 逐行正则 + 与 transcript 求交集 | `deepsleep: sleep log shows time only` |

**明确属于「人工核对」的条目（不计入自动化通过率）**：

| 条目 | 为什么不能自动化 | 谁来核 |
|---|---|---|
| D-1b「状态栏模式控件在 deepsleep 下可点」 | DESIGN 的判据写的是「交互测试」，但它验证的是「用户能不能找到并点到」——**可发现性**只有人能判断 | visual-architect 实测（Phase 3 末） |
| D-1d「三条路径各自独立」 | 「独立」指互不依赖，需要**逐条单独操作**并观察结果，Playwright 可以驱动但判据是主观的「没有依赖另两条」 | visual-architect 实测 |
| §9.1 第 3 条「deepsleep 毫无动态」的观感 | `animationDuration` 能测到 12s，但「有没有生气」是主观 | visual-architect 实测 |
| §9.1 第 15 条「为什么有的有动画有的没有」的观感 | 循环动画数能枚举，但「观感一致」要人看 | visual-architect 实测 |
| 全部「L3 截图比对」项（B2 / C6 / G10 / G12 / F8） | 静态判不了 | visual-architect 实测（DESIGN §9.0 已定） |

---

### 9.3 必须保持通过的既有断言（F5 / F7）

| 断言 | 保持方式 |
|---|---|
| **F5** `IDE: ZERO AI elements in DOM` —— IDE 模式 `[data-ai="true"]` 元素数 = 0 | IDE 模式下不渲染：控制台、vitals、刻度器、光晕、品牌块、composer、summon 之外的任何 AI 表面。**注意**：`data-ai="true"` 只能加在 AI 表面上；左栏 ⚙、模式菜单、状态栏**不得**带 `data-ai`。 |
| **F7** `goal: NO codebase surfaces` —— goal 模式 `.filetree` / `.monaco-host` / `.term-host` 元素数 = 0 | goal 模式整块工作台不渲染（DESIGN §7.3）。**注意**：活动带在 goal 下折叠为 0，但**元素仍然存在**（折叠 = 高度 0，不是卸载）→ `.term-host` 必须在 goal 下**不渲染**，不能靠 `height:0` 藏。**实现约束**：goal 模式下 `TerminalPane` **不挂载**。 |
| 既有 `IDE: right column width is 0` | 保持 `.workspace` 的 `grid-template-columns` 右列为 `0px`。 |
| 既有 `helping: dock occupies lower half of file tree column` | 保持 `.left-column` 内 FileTree + `.ai-panel.dock` 的几何关系（树高 == dock 高，dock 顶 ≥ 树底 - 2px）。 |
| 既有 `terminal: command executes via service IO` | 保留 `term.run` 的命令执行路径（多实例后仍走 `term.run`，只是带 `instance`）。 |

## 附录 A · 新增 DOM 类名 / 选择器清单（Phase 3 直接用）

| 类名 | 元素 | 用途 |
|---|---|---|
| `.left-rail-head` | 左栏头部带（28px） | 3 段切换器容器 |
| `.view-seg` | 分段器轨道（24px） | 文件/搜索/版本 |
| `.view-seg-item` | 单段（`role="tab"`） | — |
| `.mode-menu-pending` | 模式菜单 pending 行内提示 | 「正在切换到 X」 |
| `.mode-menu-error` | 模式菜单内联错误 | `EmptyState variant="error"` |
| `.deepsleep-layer` | deepsleep 覆盖层（只覆盖工作区） | 覆盖 `.workspace`，不覆盖标题栏/会话带/状态栏 |
| `.deepsleep-resume` | 「继续工作」主按钮 | 返回路径 P1 |
| `.deepsleep-actions` | deepsleep 层底部行动行 | 永不被唤醒卡片遮挡 |
| `.wake-card-close` | 唤醒卡片 `✕` | 只关卡片 |
| `.wake-card-back` | 「回到工作台」 | 关卡片 + 还焦 |
| `.settings-page` | 设置独立页 | 覆盖工作区 |
| `.settings-nav` / `.settings-nav-item` | 左导航 / 导航项 | 7 项 |
| `.settings-search` | 设置搜索框 | 过滤设置项 |
| `.settings-section` | 分区 | ≥ 7 个 |
| `.settings-row` | 设置行 | 网格 |
| `.settings-chip` | 行尾 chip | 「本次会话有效」/「不可用」/「当前」/「下一轮生效」 |
| `.provider-row` | provider 行 | 设置页分区 2 |
| `.path-dialog` | 路径粘贴对话框（模态） | 兜底打开文件夹 |
| `.path-dialog-input` | mono 路径输入 | — |
| `.path-dialog-error` | 内联校验错误 | 2px `--danger` 竖条 |
| `.jump-line-pop` | 跳行浮层 | 替换 `window.prompt` |
| `.outline-pop` | 符号大纲浮层 | 大纲的新家 |
| `.activity-strip` | 活动带（176px） | 终端/输出/问题 |
| `.activity-handle` | 折叠把手条（8px） | 折叠后仍可展开 |
| `.panel-tab`（真按钮） | 3 个 tab | `role="tab"` + `aria-selected` |
| `.term-instances` | 实例胶囊容器 | — |
| `.term-instance` | 单个实例胶囊 | `aria-current` 标当前 |
| `.term-instance.is-pending` | 有命令在途 | 6px `--beam` 点 |
| `.term-instance-rename` | 改名输入框 | 双击进入 |
| `.output-panel` / `.problems-panel` | 两个新 tab 的内容 | — |
| `.problem-row` | 问题行 | 文字级别 + 颜色 |
| `.toast-stack` | 操作失败浮层容器 | 仅会话生命周期 / 导出类操作失败（**不含连接状态**，§6.3） |
| `.conn-retry-menu` | 状态栏连接指示器的下拉 | 唯一的连接恢复入口（.conn-retry-menu 单项） |
| `.mode-switch-state` | 模式切换状态（`data-phase`） | `idle/pending/confirming/failed` |
| `.sr-only[role="alert"]` | assertive 播报区 | §8.1 |

---

## 附录 B · 跨层依赖清单（复述 DESIGN 附录 B 的 B-1 ~ B-8 + 本文新增的 B-9 ~ B-12）

> **编号规则**：B-1 ~ B-8 **沿用 `DESIGN_SYSTEM.md` 附录 B 的编号**（含 DESIGN 新增的 B-8 = `fs.list` 的 `protocol` 字段，对应硬约束 **D-5**）；本文新增的四条从 **B-9** 起编号（B-12 为 deepsleep 执行链事件），不与 DESIGN 冲突。
>
> **同步状态（本文最后更新时）**：`DESIGN_SYSTEM.md` 附录 B 已采纳本文的 **B-9（`shell.capabilities`）** 与 **B-10（`Error.session`）**，与本文一致；DESIGN 在该表下方注明「B-9 ~ B-11 的完整降级矩阵见 `UX_SPEC.md` §8.3，冲突时以 UX_SPEC 为准（交互面），DESIGN 只约束视觉面」。**B-11（`Buttons.prompt` 长文案）与 B-12（deepsleep 执行链事件）目前只存在于本文。**

| # | 依赖 | 归属 | 优先级 | UI 降级 |
|---|---|---|---|---|
| **B-1** | `ServerEvent::Usage{session,input_tokens,output_tokens,cached_tokens,elapsed_ms,tool_calls}` | `pristem-ipc` | P2 | vitals 条整条不渲染 |
| **B-2** | `fs.pickFolder` 弹原生对话框并与 `fs.openFolder` 分离；取消返回 `{ok:false,cancelled:true}` 且不发 `workspace` | 壳层 | **P0** | 直接走粘贴对话框 |
| **B-3** | 壳层不再回显命令行 | 壳层 | **P0（阻塞）** | 临时过滤 `pristem@workspace % ` 开头的行 |
| **B-4** | `term.run{instance}` / `term.output{instance}` / `term.done{instance}`；UI 保留 9000 作 Git 通道 | 壳层 | **P0** | 只显示 1 个实例 |
| **B-5** | `fs.list` 支持 `path` 并返回相对路径 | 壳层 | P1 | 文件树只展开 1 层 |
| **B-6** | `providers` / `provider_changed` 事件（**已存在**，UI 未接） | `pristem-ipc` | P1 | 设置页分区 2 内联错误 + 重试 |
| **B-7** | 内核配置读写 | `pristem-ipc` | P2 | 本地项走 `localStorage`，内核项 chip「本次会话有效」 |
| **B-8（DESIGN 新增）** | `fs.list` 响应带 `protocol` 字段（壳层取 `pristem_ipc::PROTOCOL_VERSION`） | 壳层 | **P1（D-5）** | 状态栏**不渲染**协议徽标（不写死版本号）；设置页 › 关于的 `pristem.ipc` 版本行同样不渲染 |
| **B-9（本文新增）** | `{"op":"shell.capabilities"}` → `{ok:true,capabilities:{pickFolder,termInstance,fsListPath}}`；未知 op 时返回 `{ok:false,error:"unknown io op"}` | 壳层 | P1 | 视为全部能力 false |
| **B-10（本文新增）** | `ServerEvent::Error` 需带 `session: u64`（现状无 session，多会话并发时错误会串台） | `pristem-ipc` | P2 | 退化为「pending 意图 + 当前活跃会话」匹配 |
| ~~B-11（**已撤回**）~~ | ~~`Buttons.prompt` 需用长 prompt~~ —— **撤回原因**：那段 prompt 本身在承诺内核不兑现的事。改为：**内核的 `Buttons.prompt` 不得承诺启动独立实例**（该字符串的修改属内核责任，team-lead 已转 Rust 侧）；UI **不复述内核 prompt**，改用自己的诚实文案（§1.5） | `pristem-ipc` | P2 | UI 静态文案（`modeHint.deepsleep` + `mode.hint.deepsleepTitle`） |
| **B-12（本文新增）** | 内核把 deepsleep 的 clean instance 活动以 `call`/`result`（带 `session`）回灌到主会话事件流 | `pristem-ipc` | P2 | deepsleep 中央列展示**进入休眠前那一轮**的链，标题写实为「进入休眠前的执行链」；链为空则整块不渲染（§1.9） |

**本文明确不引入的依赖**：`list_transitions` / 转换表事件 —— 理由见 §1.4。

---

## 附录 C · 新增 i18n key 全量文案

### 附录 C.0 · 既有 `i18n.ts` key 的**改写 / 改名 / 删除清单**（不是文案表）

> **权威分工**：`DESIGN_SYSTEM.md` §8.12（W1–W11）是 **i18n key + 中英文文案 + 代码落点**的**唯一来源**。
> **本表只做一件事**：列出 `ui/src/i18n.ts` 里**已经存在**、但当前值是假话的那些 key，以及它们各自该怎么处理。
> **本表的「新值」列必须与 §8.12 的 W1–W11 逐字一致**；若发现任何一字之差，写进本文并通知 team-lead（**不要直接找视觉负责人**）。
> 关键数字：**19 条残留 = 18 条改写 + 1 条死键删除**（对应 DESIGN §8.12.1b / M13）。
>
> **「现值」列是要被删除的字符串**（不是要保留的文案）；「新值」列才是运行时可见文本。

| # | key | 语言 | 现值（假） | 处置 | 新值 / 依据 |
|---|---|---|---|---|---|
| 1 | `deepsleep.subtitle` | zh | 消化这一轮的经验 | 改写 | **此刻没有任务在跑**（W10，team-lead 已裁定采用 UX 提案） |
| 2 | `deepsleep.subtitle` | en | Digesting this round of experience | 改写 | **nothing is running right now**（W10 EN） |
| 3 | `deepsleep.note` | zh | 当前会话已归档，干净实例正在复盘输出链。你无需做任何事。 | 改写 | **当前会话已归档，工具面已收窄。智能体保持安静，直到你请求唤醒简报。**（W1） |
| 4 | `deepsleep.note` | en | The current session is archived. A clean instance is reviewing its own output chains. Nothing is required from you. | 改写 | **The session is archived and the tool surface is narrowed. The agent stays quiet until you request a wake briefing.**（W1 EN） |
| 5 | **`modeHint.deepsleep`** | zh | 交回内核消化 · 新实例接手 | 改写 | **归档会话 · 收窄工具面**（W2） |
| 6 | **`modeHint.deepsleep`** | en | Hand back to the kernel · a new instance takes over | 改写 | **Archive session · narrow tool surface**（W2 EN） |
| 7 | **`mode.hint.deepsleepCost`** | zh | 进入 deepsleep 会归档当前会话并启动一个干净实例，下一轮会重新消耗 token | **改名** → `mode.hint.deepsleepTitle` + 改写 | **进入 deepsleep 会归档当前会话并收窄工具面，智能体保持安静直到你请求唤醒简报。**（W3） |
| 8 | **`mode.hint.deepsleepCost`** | en | Entering deepsleep archives this session and spawns a clean instance; the next round spends tokens again | **改名** → `mode.hint.deepsleepTitle` + 改写 | **Entering deepsleep archives the session and narrows the tool surface. The agent stays quiet until you request a wake briefing.**（W3 EN） |
| 9 | `wake.badge` | zh | 已提交新规则 | 改写 | **当前生效的规则**（W4） |
| 10 | `wake.badge` | en | New rules committed | 改写 | **Rules in effect**（W4 EN） |
| 11 | `wake.lead` | zh | 这是休眠中的智能体了解文件变化的唯一通道 | 改写 | **这些规则由智能体在之前的轮次里写入，恢复会话后它们会参与回答检查。**（W5） |
| 12 | `wake.lead` | en | This briefing is the only channel through which the sleeping agent learns its files changed. | 改写 | **These rules were written by the agent in earlier rounds. They take part in answer checking once the session resumes.**（W5 EN） |
| 13 | `deepsleep.noLog` | zh | 还没有可显示的记录 | 改写 | **已归档**（W8） |
| 14 | `deepsleep.noLogDesc` | zh | 休眠期间的执行记录会显示在这里 | 改写 | **休眠期间不会产生新的执行记录；这里只显示经过的时间。**（W9） |
| 15 | `deepsleep.noLog` | en | No entries yet | 改写 | **Archived**（W8 EN） |
| 16 | `deepsleep.noLogDesc` | en | Execution records will appear here | 改写 | **No new execution records are produced while the agent is away; only elapsed time is shown here.**（W9 EN） |
| 17 | `deepsleep.noBriefingDesc` | zh | 请求内核汇总休眠期间的变化 | 改写 | **请求内核列出当前生效的规则**（W11） |
| 18 | `deepsleep.noBriefingDesc` | en | Ask the kernel to summarize changes | 改写 | **Ask the kernel to list the rules currently in effect**（W11 EN） |
| **19** | **`mode.hint.deepsleep`** | zh/en | 交回内核消化 · 新实例接手 / Hand back to the kernel · a new instance takes over | **整条删除** | **死键**：`views.tsx` 读的是 `t(\`modeHint.${m}\`)` → 活的 key 是 `modeHint.deepsleep`（第 5/6 条）。留着就是「同一事实两个来源」→ **删**（DESIGN §8.12.1d / M13） |

**另外 3 条本文补充（DESIGN §8.12.1b 的 19 条里没有，但同样是假话）**：

| # | key | 语言 | 现值（假） | 处置 | 理由 |
|---|---|---|---|---|---|
| **20** | `deepsleep.quiet` | zh/en | 安静状态 / Quiet state | **删除（不渲染）** | 与 h1「智能体正在休息」和 W1「智能体保持安静」重复（DESIGN §8.12.1c） |
| **21** | `deepsleep.sleeping` | zh/en | 休眠中 / Sleeping | **删除（不渲染）** | 与 eyebrow `deepsleep`、h1 重复；档位已由状态栏刻度器表达（DESIGN §8.12.1c） |
| **22** | `help.deepsleep` | zh/en | 交回内核消化 / Hand off to digestion | **删除**（命令帮助浮层整体删除，见 §7.3） | 「交回内核消化」命中 DESIGN §8.12.1 禁用类别 ②；若浮层将来恢复，该 key 改为「进入深睡」/「Enter deep sleep」 |

> `.sleep-meta` 最终**只保留 1 个 chip**（`deepsleep.pause`「暂停不等于终止」/「Pause is not termination」—— 这是**非显而易见且真实**的事实：deepsleep 是内核 mode，与 `pause` 是两回事）。

**⚠ 第 7/8 条的改名有连带依赖（必须同一次改完）**：

```
i18n.ts      'mode.hint.deepsleepCost'  →  'mode.hint.deepsleepTitle'
views.tsx:863  t('mode.hint.deepsleepCost')  →  t('mode.hint.deepsleepTitle')
```

只改 `i18n.ts` 而漏改 `views.tsx:863`，`t()` 会落到 `i18n.ts` 的兜底值 `'common.contentUnavailable'` → 模式菜单的 `title` 变成「内容暂不可用」。**该兜底文案不在禁用词表里，诚实性断言抓不到 —— 所以另立一条判据**（§9.1 第 23 条：`运行时不得出现 i18n 兜底文案`）。

### 附录 C.1 中文（zh-CN）

```ts
// ── 模式切换 ───────────────────────────────────────────────
'mode.pending': '正在切换到 {mode}',
'mode.failed.timeout': '内核没有回应这次切换',
'mode.failed.timeoutDesc': '模式没有改变，可以再试一次',
'mode.failed.retry': '重试',
'mode.failed.forbidden': '不能从 {from} 切换到 {to}',
'mode.failed.forbiddenDesc': '内核拒绝了这次转换：{note}',
'mode.failed.recover': '先切到 coding 再进入 deepsleep',
'mode.failed.unknown': '内核不认识这个模式',
'mode.hint.deepsleepTitle': '进入 deepsleep 会归档当前会话并收窄工具面，智能体保持安静直到你请求唤醒简报。',
'mode.announce': '模式已切换为 {mode}',
'mode.cost': 'deepsleep · 会话已归档，工具面已收窄',
'wake.noRules': '当前没有生效的规则。',

// ── 会话 / 视图 ─────────────────────────────────────────────
'session.announce.restore': '已恢复上次会话',
'view.announce': '已切换到{view}',

// ── 设置页 ─────────────────────────────────────────────────
'settings.searchPlaceholder': '搜索设置',
'settings.noMatch': '没有匹配的设置项',
'settings.clearSearch': '清除搜索',
'settings.chip.sessionOnly': '本次会话有效',
'settings.chip.unavailable': '不可用',
'settings.chip.current': '当前',
'settings.chip.nextRound': '下一轮生效',
'settings.transportHint': '传输状态显示在窗口底部状态栏',
'settings.reconnectUnavailable': '内核没有提供重连接口',
'settings.terminalInstancesUnavailable': '壳层未提供多实例通道',
'settings.localOnly': '这一项在重启后回到默认',
'settings.keysTitle': '键位表',
'settings.commandsTitle': '命令表',
'settings.commandColumn': '命令',
'settings.keyColumn': '快捷键',
'settings.sourceColumn': '入口',
'settings.source.palette': '命令面板',
'settings.source.bar': '界面控件',
'settings.source.mode': '模式菜单',

// ── 模型与连接 ─────────────────────────────────────────────
'provider.title': '模型与连接',
'provider.keyPresent': '密钥已就绪',
'provider.keyMissing': '密钥未就绪',
'provider.keyHint': '设置环境变量 {env} 后重启内核即可使用',
'provider.endpoint': '端点 {url}',
'provider.switch': '切换到此',
'provider.switching': '切换中',
'provider.noKeyBlocked': '该端点没有可用密钥',
'provider.retry': '重试',
'provider.loadFailed': '内核没有返回 provider 列表',
'provider.loadFailedDesc': '检查内核连接后重试',
'provider.byok': '自带密钥',
'provider.byokDesc': '密钥只存在于内核进程，本界面只读取「是否存在」，不读取内容。',

// ── 打开文件夹 ─────────────────────────────────────────────
'pathDialog.title': '打开文件夹',
'pathDialog.placeholder': 'D:/projects',
'pathDialog.paste': '粘贴',
'pathDialog.open': '打开',
'pathDialog.cancel': '取消',
'pathDialog.recent': '最近项目',
'pathDialog.recentEmpty': '还没有最近打开的文件夹',
'pathDialog.noNative': '本机没有提供文件夹选择器，请粘贴路径',
'pathDialog.err.empty': '请输入文件夹路径',
'pathDialog.err.relative': '请输入绝对路径，例如 D:/projects',
'pathDialog.err.parent': '路径不能包含 ..',
'pathDialog.err.notDir': '这个路径不是文件夹',
'pathDialog.err.permission': '没有权限读取这个文件夹',
'pathDialog.err.clipboard': '无法读取剪贴板，请手动输入',
'pathDialog.err.pickFailed': '文件夹选择没有完成，请粘贴路径',

// ── 终端 ───────────────────────────────────────────────────
'terminal.instance': 'bash {n}',
'terminal.newInstance': '新建终端实例',
'terminal.closeInstance': '关闭 {name}',
'terminal.renameInstance': '重命名 {name}',
'terminal.instancePending': '{name} 命令执行中',
'terminal.instanceCount': '{n} 个终端',
'activity.output': '输出',
'activity.problems': '问题',
'output.title': '输出',
'output.empty': '还没有输出',
'output.emptyDesc': '运行一条命令，或让智能体执行一次工具调用',
'output.sourceKernel': '内核',
'output.shownFirst': '已显示前 {n} 行',
'problems.title': '问题',
'problems.empty': '没有发现问题',
'problems.emptyDesc': '编辑文件后诊断会显示在这里',
'problems.severity.error': '错误',
'problems.severity.warning': '警告',
'problems.severity.info': '提示',
'problems.shownFirst': '已显示前 {n} 项',

// ── 大纲 / 跳行 ────────────────────────────────────────────
'outline.title': '大纲',
'outline.button': '符号',
'jumpLine.title': '跳到行号',
'jumpLine.go': '跳转',
'jumpLine.invalid': '请输入行号',
'jumpLine.outOfRange': '这个文件没有这么多行',

// ── 播报 ───────────────────────────────────────────────────
'a11y.executing': '正在执行',
'a11y.answered': '回答已就绪',
'a11y.finished': '执行完成',
'a11y.usage': '本轮消耗 {in} 输入、{out} 输出 token',
'a11y.awaitingConfirm': '等待你的确认',
'a11y.error': '内核报错：{msg}',
'a11y.intercepted': '内核拦截了一次动作',
'a11y.queueFull': '队列已满，最多 5 条',
'a11y.nothingToExport': '没有可导出的内容',
'a11y.nothingToSave': '没有可保存的文件',
'a11y.alreadySaved': '文件已是最新',
'a11y.noOpenFile': '没有打开的文件',
'kernel.reconnect': '重试连接',
'conn.menuTitle': '内核连接',
'conn.connected': '内核已连接',
'toast.sessionFailed': '会话未能创建',
'toast.exportFailed': '导出失败',
'toast.retry': '重试',
```

### 附录 C.2 英文（en-US）

```ts
'mode.pending': 'Switching to {mode}',
'mode.failed.timeout': 'The kernel did not answer this switch',
'mode.failed.timeoutDesc': 'The mode did not change. Try again.',
'mode.failed.retry': 'Retry',
'mode.failed.forbidden': 'Cannot switch from {from} to {to}',
'mode.failed.forbiddenDesc': 'The kernel refused this transition: {note}',
'mode.failed.recover': 'Switch to coding first, then enter deepsleep',
'mode.failed.unknown': 'The kernel does not know this mode',
'mode.hint.deepsleepTitle': 'Entering deepsleep archives the session and narrows the tool surface. The agent stays quiet until you request a wake briefing.',
'mode.announce': 'Mode switched to {mode}',
'mode.cost': 'deepsleep · session archived, tool surface narrowed',
'wake.noRules': 'No rules are in effect.',

'session.announce.restore': 'Last session restored',
'view.announce': 'Switched to {view}',

'settings.searchPlaceholder': 'Search settings',
'settings.noMatch': 'No matching setting',
'settings.clearSearch': 'Clear search',
'settings.chip.sessionOnly': 'This session only',
'settings.chip.unavailable': 'Unavailable',
'settings.chip.current': 'Current',
'settings.chip.nextRound': 'Takes effect next round',
'settings.transportHint': 'Transport status is shown in the status bar',
'settings.reconnectUnavailable': 'The kernel exposes no reconnect request',
'settings.terminalInstancesUnavailable': 'The shell exposes no multi-instance channel',
'settings.localOnly': 'This resets on restart',
'settings.keysTitle': 'Keyboard',
'settings.commandsTitle': 'Commands',
'settings.commandColumn': 'Command',
'settings.keyColumn': 'Shortcut',
'settings.sourceColumn': 'Entry point',
'settings.source.palette': 'Command palette',
'settings.source.bar': 'Interface',
'settings.source.mode': 'Mode menu',

'provider.title': 'Models and connections',
'provider.keyPresent': 'Key present',
'provider.keyMissing': 'No key',
'provider.keyHint': 'Set {env} and restart the kernel to enable this endpoint',
'provider.endpoint': 'Endpoint {url}',
'provider.switch': 'Use this',
'provider.switching': 'Switching',
'provider.noKeyBlocked': 'This endpoint has no usable key',
'provider.retry': 'Retry',
'provider.loadFailed': 'The kernel returned no provider list',
'provider.loadFailedDesc': 'Check the kernel connection and retry',
'provider.byok': 'Bring your own key',
'provider.byokDesc': 'Keys live in the kernel process; this screen only reads whether one exists.',

'pathDialog.title': 'Open Folder',
'pathDialog.placeholder': 'D:/projects',
'pathDialog.paste': 'Paste',
'pathDialog.open': 'Open',
'pathDialog.cancel': 'Cancel',
'pathDialog.recent': 'Recent',
'pathDialog.recentEmpty': 'No recently opened folders',
'pathDialog.noNative': 'No folder picker is available here; paste a path instead',
'pathDialog.err.empty': 'Enter a folder path',
'pathDialog.err.relative': 'Enter an absolute path, for example D:/projects',
'pathDialog.err.parent': 'A path cannot contain ..',
'pathDialog.err.notDir': 'That path is not a folder',
'pathDialog.err.permission': 'This folder cannot be read',
'pathDialog.err.clipboard': 'The clipboard could not be read; type the path instead',
'pathDialog.err.pickFailed': 'The folder picker did not finish; paste a path instead',

'terminal.instance': 'bash {n}',
'terminal.newInstance': 'New terminal instance',
'terminal.closeInstance': 'Close {name}',
'terminal.renameInstance': 'Rename {name}',
'terminal.instancePending': '{name} is running a command',
'terminal.instanceCount': '{n} terminals',
'activity.output': 'Output',
'activity.problems': 'Problems',
'output.title': 'Output',
'output.empty': 'No output yet',
'output.emptyDesc': 'Run a command, or let the agent make a tool call',
'output.sourceKernel': 'kernel',
'output.shownFirst': 'Showing the first {n} lines',
'problems.title': 'Problems',
'problems.empty': 'No problems found',
'problems.emptyDesc': 'Diagnostics appear here as you edit',
'problems.severity.error': 'Error',
'problems.severity.warning': 'Warning',
'problems.severity.info': 'Info',
'problems.shownFirst': 'Showing the first {n} items',

'outline.title': 'Outline',
'outline.button': 'Symbols',
'jumpLine.title': 'Go to line',
'jumpLine.go': 'Go',
'jumpLine.invalid': 'Enter a line number',
'jumpLine.outOfRange': 'This file has no such line',

'a11y.executing': 'Working',
'a11y.answered': 'Answer ready',
'a11y.finished': 'Finished',
'a11y.usage': '{in} input and {out} output tokens this round',
'a11y.awaitingConfirm': 'Waiting for your confirmation',
'a11y.error': 'Kernel error: {msg}',
'a11y.intercepted': 'The kernel intercepted an action',
'a11y.queueFull': 'The queue is full, 5 messages max',
'a11y.nothingToExport': 'Nothing to export',
'a11y.nothingToSave': 'No file is open',
'a11y.alreadySaved': 'The file is already saved',
'a11y.noOpenFile': 'No file is open',
'kernel.reconnect': 'Reconnect',
'conn.menuTitle': 'Kernel connection',
'conn.connected': 'Kernel connected',
'toast.sessionFailed': 'The session could not be created',
'toast.exportFailed': 'Export failed',
'toast.retry': 'Retry',
```

---

## 附录 D · `check.cjs` 断言增补（可直接粘贴）

> 以下代码块追加到 `.visual-check/check.cjs`（现状 25 条断言之后，`no uncaught page errors` 之前）。
> **前置**：Phase 3 已实现 §1–§8 的行为。若某条依赖尚未落地的跨层能力（B-1 / B-4 / B-9），该条在 `capabilities` 为 false 时**跳过并打印 SKIP**，不得 FAIL。
>
> **注意（D-5）**：`.visual-check/check.cjs` 现状的 `check('coding: session connected', ... === 'pristem.ipc/v0.3')` 是一条**写死版本号**的断言，协议升到 v0.4 后必然 FAIL。Phase 3 必须改成**与 `fs.list` 响应的 `protocol` 值比对**；`protocol` 字段缺失时断言「徽标不渲染」（`page.locator('.proto-badge').count() === 0`）。

```js
  // =====================================================================
  // Phase 2 · UX spec assertions (UX_SPEC.md §9)
  // =====================================================================
  const caps = await page.evaluate(async () => {
    const r = await fetch('/api/io', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'shell.capabilities' }),
    });
    try { return (await r.json()).capabilities || {}; } catch { return {}; }
  });
  const text = async (sel) => (await page.locator(sel).count())
    ? (await page.locator(sel).first().innerText()) : '';

  // ---- 1 brand: one prism, one wordmark -------------------------------
  check('brand: prism count <= 2',
    (await page.locator('.brand-prism').count()) <= 2,
    `count=${await page.locator('.brand-prism').count()}`);
  check('brand: legacy living parts removed',
    (await page.locator('.living-core, .living-eye, .living-bloom, .living-highlight').count()) === 0);
  const wordmarks = await page.evaluate(() => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n = 0, node;
    while ((node = w.nextNode())) {
      const t = (node.textContent || '').trim();
      if (/^pristem\.?$/i.test(t) && node.parentElement &&
          getComputedStyle(node.parentElement).display !== 'none') n++;
    }
    return n;
  });
  check('brand: wordmark appears once', wordmarks === 1, `count=${wordmarks}`);

  // ---- D-5: protocol badge is data, not a constant ---------------------
  const protoFromList = await page.evaluate(async () => {
    const r = await fetch('/api/io', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'fs.list' }),
    });
    try { return (await r.json()).protocol ?? null; } catch { return null; }
  });
  const badgeCount = await page.locator('.proto-badge').count();
  if (protoFromList) {
    check('D-5: badge equals fs.list.protocol',
      badgeCount === 1 && (await text('.proto-badge')) === protoFromList,
      `badge="${await text('.proto-badge')}" list="${protoFromList}"`);
  } else {
    check('D-5: badge not rendered without fs.list.protocol', badgeCount === 0,
      `badgeCount=${badgeCount}`);
  }

  // ---- 5 no demo wording ----------------------------------------------
  const banned = await page.evaluate(() => {
    const re = /演示|demo|假数据|未完成|占位|TODO/gi;
    const hits = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = w.nextNode())) {
      const txt = (node.textContent || '');
      if (re.test(txt)) hits.push(txt.trim().slice(0, 40));
      re.lastIndex = 0;
    }
    return hits;
  });
  check('no demo wording anywhere', banned.length === 0, banned.slice(0, 3).join(' | '));
  check('no demo tag elements',
    (await page.locator('.ai-demo-tag, .demo-source-tag, .tool-card-demo-prefix').count()) === 0);

  // ---- 7 settings: standalone page, 7 sections -------------------------
  await page.keyboard.press('Control+,');
  await page.waitForSelector('.settings-page', { timeout: 5000 }).catch(() => {});
  check('settings: opens as a separate view', (await page.locator('.settings-page').count()) === 1);
  check('settings: side-panel version is gone', (await page.locator('.settings-panel').count()) === 0);
  check('settings: at least 7 sections', (await page.locator('.settings-section').count()) >= 7,
    `count=${await page.locator('.settings-section').count()}`);
  check('settings: nav has 7 items', (await page.locator('.settings-nav-item').count()) === 7);
  check('settings: chrome stays reachable',
    (await page.locator('.titlebar').count()) === 1 &&
    (await page.locator('.session-bar').count()) === 1 &&
    (await page.locator('.statusbar').count()) === 1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('settings: Esc closes', (await page.locator('.settings-page').count()) === 0);

  // ---- 8 dial: 5 cells, filled left to right --------------------------
  await page.locator('.mode-glyph').click();
  await page.waitForSelector('.mode-menu', { timeout: 3000 });
  const lit = await page.evaluate(() =>
    [...document.querySelectorAll('.mode-menu [role="menuitem"], .mode-menu button')]
      .map((b) => b.querySelectorAll('.dial-cell.on').length));
  check('dial: 5 cells, left-to-right fill',
    lit.length === 6 && lit.every((n, i) => i === 0 || n >= lit[i - 1]) &&
    Math.max(...lit) === 5 && Math.min(...lit) === 0,
    `lit=[${lit.join(',')}]`);
  const dialW = await page.evaluate(() =>
    document.querySelector('.statusbar .dial')?.getBoundingClientRect().width ?? -1);
  check('dial: status-bar dial is 23px', Math.round(dialW) === 23, `w=${dialW}`);

  // ---- 14/2 mode switch: one click, no second confirmation -------------
  await page.locator('.mode-menu button').filter({ hasText: 'deepsleep' }).first().click();
  const reached = await page.waitForFunction(
    () => document.querySelector('.app-shell')?.className.includes('mode-deepsleep'),
    null, { timeout: 6000 }).then(() => true).catch(() => false);
  check('deepsleep: one click, no second confirmation', reached);
  check('deepsleep: no confirmation card left behind',
    (await page.locator('.line-buttons').count()) === 0);

  // ---- 2b deepsleep return paths --------------------------------------
  check('deepsleep: resume button exists', (await page.locator('.deepsleep-resume').count()) === 1);
  check('deepsleep: workbench still mounted', (await page.locator('.workspace').count()) === 1);
  const pe = await page.evaluate(() => {
    const w = document.querySelector('.workspace');
    return w ? getComputedStyle(w).pointerEvents : 'missing';
  });
  check('deepsleep: workbench is not interactive', pe === 'none', `pointer-events=${pe}`);

  // ---- 3 deepsleep has a slow breathing halo ---------------------------
  const haloDur = await page.evaluate(() => {
    const h = document.querySelector('.living-halo');
    return h ? getComputedStyle(h).animationDuration : 'none';
  });
  check('deepsleep: 12s breathing halo', haloDur === '12s', `duration=${haloDur}`);

  await page.locator('.deepsleep-resume').click();
  await page.waitForFunction(
    () => document.querySelector('.app-shell')?.className.includes('mode-coding'),
    null, { timeout: 6000 }).catch(() => {});
  check('deepsleep: resume returns to coding', (await modeClass()).includes('mode-coding'));

  // ---- §1.9 deepsleep chain must not claim to be "during sleep" ---------
  await page.locator('.mode-glyph').click();
  await page.locator('.mode-menu button').filter({ hasText: 'deepsleep' }).first().click();
  await page.waitForFunction(
    () => document.querySelector('.app-shell')?.className.includes('mode-deepsleep'),
    null, { timeout: 6000 }).catch(() => {});
  const chainCount = await page.locator('.deepsleep-chain').count();
  if (chainCount) {
    const chainText = await page.locator('.deepsleep-chain .deepsleep-chain-title').innerText();
    check('deepsleep: chain is labelled as pre-sleep, not during sleep',
      chainText.includes('进入休眠前') && !chainText.includes('休眠期间'), `title="${chainText}"`);
  } else {
    check('deepsleep: chain absent when there is nothing to show', true);
  }
  check('deepsleep: no usage block without a usage event',
    (await page.locator('.deepsleep .ai-vitals').count()) === 0);

  // ---- §1.10 wake briefing items are rules, not change summaries -------
  const wakeBtn2 = page.locator('.deepsleep-actions .text-btn');
  if (await wakeBtn2.count()) {
    await wakeBtn2.first().click();
    await page.waitForSelector('.wake-card', { timeout: 8000 }).catch(() => {});
    if (await page.locator('.wake-card').count()) {
      const lead = await page.locator('.wake-card-lead').innerText().catch(() => '');
      check('wake briefing: lead states these are new rules', lead.includes('新规则'), `lead="${lead}"`);
      check('wake briefing: items carry no file icons',
        (await page.locator('.wake-card li svg').count()) === 0);
      check('wake briefing: items carry no edit controls',
        (await page.locator('.wake-card li button').count()) === 0);
    }
    await page.locator('.wake-card-close').click().catch(() => {});
  }

  // ---- 6 open folder: fs.pickFolder, not a view switch -----------------
  const ioCalls = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/io') && r.method() === 'POST') {
      try { ioCalls.push(JSON.parse(r.postData() || '{}')); } catch { /* ignore */ }
    }
  });
  await page.locator('.filetree .pane-head .icon-btn[aria-label="打开文件夹"]').click();
  await page.waitForTimeout(600);
  check('open folder: sends fs.pickFolder',
    ioCalls.some((c) => c.op === 'fs.pickFolder'),
    JSON.stringify(ioCalls.map((c) => c.op)));
  check('open folder: path input is gone', (await page.locator('.path-input').count()) === 0);

  // ---- 13a three real tabs --------------------------------------------
  const tabs = page.locator('.panel-tabs [role="tab"]');
  const tabCount = await tabs.count();
  let allButtons = true;
  for (let i = 0; i < tabCount; i++) {
    if ((await tabs.nth(i).evaluate((el) => el.tagName)) !== 'BUTTON') allButtons = false;
  }
  check('activity strip: three real tabs', tabCount === 3 && allButtons, `count=${tabCount}`);
  await tabs.nth(1).click();
  await page.waitForTimeout(250);
  check('activity strip: output tab renders', (await page.locator('.output-panel').count()) === 1);
  await tabs.nth(2).click();
  await page.waitForTimeout(250);
  check('activity strip: problems tab renders', (await page.locator('.problems-panel').count()) === 1);
  await tabs.nth(0).click();

  // ---- 13b/13c terminal instances --------------------------------------
  if (caps.termInstance) {
    await page.locator('.term-instances .icon-btn').first().click();
    await page.waitForTimeout(400);
    check('terminal: multiple instances', (await page.locator('.term-instance').count()) === 2,
      `count=${await page.locator('.term-instance').count()}`);
    check('terminal: second instance is named bash 2',
      (await text('.term-instance.is-current')).includes('bash 2'));
  } else {
    console.log('SKIP  terminal: multiple instances (shell has no instance channel)');
    check('terminal: single instance when unsupported',
      (await page.locator('.term-instance').count()) === 1);
  }

  // ---- 4 usage: vitals row absent without a usage event -----------------
  check('usage: vitals row absent without event', (await page.locator('.ai-vitals').count()) === 0);

  // ---- 17 confirm: one surface only ------------------------------------
  check('confirm: single surface', (await page.locator('.confirm-toast').count()) === 0);

  // ---- 18 toast must never repeat the connection state ------------------
  const connWords = await page.evaluate(() => {
    const words = ['内核未连接', '离线夹具', '内核已连接', '正在连接内核'];
    const hits = { toast: [], page: 0 };
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = w.nextNode())) {
      const t = (node.textContent || '').trim();
      if (!t) continue;
      for (const k of words) {
        if (t.includes(k)) {
          hits.page++;
          const inToast = !!node.parentElement?.closest('.toast-stack');
          if (inToast) hits.toast.push(t.slice(0, 40));
        }
      }
    }
    return hits;
  });
  check('toast: never repeats connection state', connWords.toast.length === 0,
    connWords.toast.join(' | '));
  check('G12: connection state appears exactly once on screen', connWords.page === 1,
    `count=${connWords.page}`);

  // ---- 19 the only connection recovery lives in the status bar ---------
  const connIndicator = page.locator('.statusbar .status-conn');
  if (await connIndicator.count()) {
    await connIndicator.first().click();
    await page.waitForTimeout(250);
    check('connection: retry lives in the status bar',
      (await page.locator('.conn-retry-menu').count()) === 1 &&
      (await text('.conn-retry-menu')).includes('重试连接'));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    check('connection: menu closes on Esc', (await page.locator('.conn-retry-menu').count()) === 0);
  } else {
    console.log('SKIP  connection: retry lives in the status bar (no .status-conn element)');
  }

  // ---- 20 deepsleep renders no console surface -------------------------
  check('deepsleep: no console surface', (await page.locator('.ai-panel').count()) === 0);

  // ---- 22 honesty: never claim what the kernel cannot deliver ------------
  // 运行时 DOM（不是规范文档）+ 中英双语分别匹配 + 只看可见文本
  const falseClaims = await page.evaluate(() => {
    const ZH = /干净实例|新实例接手|正在复盘|复盘输出链|消化中|交回内核消化|已提交新规则|在休眠期间提交|内核没有提交新规则/g;
    const EN = /clean instance|new instance takes over|reviewing its own output chains|reviewing output chains|digesting its output chains|digesting|hand back to the kernel|rules committed|committed during deepsleep|submitted during sleep|no new rules were committed|summarize changes/gi;
    const hits = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = w.nextNode())) {
      const t = (node.textContent || '').trim();
      if (!t) continue;
      const el = node.parentElement;
      if (!el) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      ZH.lastIndex = 0; EN.lastIndex = 0;
      const mz = t.match(ZH), me = t.match(EN);
      if (mz) hits.push(`ZH ${mz[0]} :: ${t.slice(0, 50)}`);
      if (me) hits.push(`EN ${me[0]} :: ${t.slice(0, 50)}`);
    }
    return hits;
  });
  check('honesty: no claims the kernel cannot deliver', falseClaims.length === 0,
    falseClaims.slice(0, 3).join(' | '));

  // ---- 23 no i18n fallback text on screen ---------------------------------
  const fallbackText = await page.evaluate(() => {
    const re = /内容暂不可用|Content unavailable/g;
    const hits = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = w.nextNode())) {
      const t = (node.textContent || '').trim();
      if (!t) continue;
      const el = node.parentElement;
      if (!el || getComputedStyle(el).display === 'none') continue;
      re.lastIndex = 0;
      if (re.test(t)) hits.push(t.slice(0, 60));
    }
    return hits;
  });
  check('i18n: no fallback text on screen', fallbackText.length === 0,
    fallbackText.slice(0, 3).join(' | '));

  // ---- 24 deepsleep sleep log shows elapsed time only ---------------------
  await page.locator('.mode-glyph').click();
  await page.locator('.mode-menu button').filter({ hasText: 'deepsleep' }).first().click();
  await page.waitForFunction(
    () => document.querySelector('.app-shell')?.className.includes('mode-deepsleep'),
    null, { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(5200); // let the sleep log push at least one row
  if (await page.locator('.sleep-log').count()) {
    const logLines = await page.locator('.sleep-log').innerText();
    const bad = logLines.split('\n').map((l) => l.trim()).filter(Boolean)
      .filter((l) => !/^(已归档|Archived)( · \d{2}:\d{2})?$/.test(l));
    check('deepsleep: sleep log shows time only', bad.length === 0,
      bad.slice(0, 3).join(' | '));
  } else {
    console.log('SKIP  deepsleep: sleep log shows time only (no .sleep-log element)');
  }

  // ---- 21 pending state must carry a text label -------------------------
  await page.locator('.mode-glyph').click();
  await page.waitForSelector('.mode-menu', { timeout: 3000 });
  await page.locator('.mode-menu button').filter({ hasText: 'goal' }).first().click();
  const pendingText = await page.locator('.mode-menu-pending').innerText().catch(() => '');
  check('mode menu: pending has a text label', pendingText.includes('切换中'),
    `pending="${pendingText}"`);
  await page.waitForFunction(
    () => document.querySelector('.app-shell')?.className.includes('mode-goal'),
    null, { timeout: 8000 }).catch(() => {});

  // ---- F5 / F7 must still hold -----------------------------------------
  await page.locator('.mode-glyph').click();
  await page.locator('.mode-menu button').filter({ hasText: 'goal' }).first().click();
  await page.waitForFunction(
    () => document.querySelector('.app-shell')?.className.includes('mode-goal'),
    null, { timeout: 8000 }).catch(() => {});
  check('goal: NO codebase surfaces',
    (await page.locator('.filetree').count()) === 0 &&
    (await page.locator('.monaco-host').count()) === 0 &&
    (await page.locator('.term-host').count()) === 0);
```

---

## 附录 E · 实施顺序（Phase 3 参考）

1. **模式切换状态机**（§1）—— 直接解决用户第 12 条与「为什么要自己同意」。改 `App.tsx` 的 `switchMode` + `handleKernel`。
2. **删除 `.confirm-toast`**（§6.4）—— 一处删除，解决「确认两处重复」。
3. **左栏头部 3 段切换器 + 删除活动栏**（§2.2）—— 功能归属的骨架。
4. **命令面板补全 28 条命令**（§2.3）+ 快速打开全局化（§2.4）。
5. **设置独立页**（§3）—— 用户第 7 条。
6. **打开文件夹全流程**（§5）—— 依赖 B-2。
7. **终端三 tab + 多实例**（§4）—— 依赖 B-3 / B-4 / B-9。
8. **四类分支语法**（§6）—— 统一 `EmptyState` / `ErrorCard` 的用法。
9. **键盘地图与焦点**（§7）—— 与 1–7 一起收口。
10. **无障碍播报表**（§8.1）—— 拆两个 live region，改 `living.ts` 的 `announce()`。
11. **验收脚本扩写**（§9 + 附录 D）。

---

## 附录 F · 需要 visual-architect 给形态定义的新界面形态（本文不发明 token 与数值）

> 本文按 team-lead 的要求：**不自行发明 token 或数值**。以下 7 个形态在 Phase 1 规范里没有对应定义，本文只给「用途 + 行为 + 必须使用哪几个 token + 硬上限」，形态定义（尺寸、间距、圆角、阴影、进出动效）由 visual-architect 按同一套 token 与密度规则给出。
>
> **本文给出的 px 建议值一律标注「建议值」**，冲突时以 visual-architect 的形态定义为准。

| # | 形态（选择器） | 用途 | 行为约束（本文已定） | 必须使用的 token / 上限（本文给的约束，不是形态定义） |
|---|---|---|---|---|
| **F-1** | `.path-dialog` | 打开文件夹的**兜底**输入（原生对话框不可用时） | 模态；标题「打开文件夹」；mono 输入 + 「粘贴」+ 「最近项目」前 5 条 + 「打开」/「取消」；校验错误内联（5 条文案见 §5.3）；Esc 关闭；焦点陷阱 | 底 `--surface-float`；边 `--line-strong`；圆角 `--r-3`；标题 `--fs-subtitle` 15px/600 `--text-1`；输入框按 DESIGN §8.8.3 数值输入（高 28px / `--surface-inset` / `--r-2` / mono 11px / `--text-1`）；错误用 2px `--danger` 左竖条 + `--text-2` 文字；主按钮 `--beam` 底 36px `--beam-ink` 字；次按钮 1px `--line-strong` 描边 `--text-1`；**宽度 ≤ 560px（H2）**，建议值 480px；**不得出现 rainbow/spectrum** |
| **F-2** | `.jump-line-pop` | `Ctrl+G` 跳到指定行 | 非模态；锚在舞台左下；输入只接受数字；`Enter` 跳转 / `Esc` 取消；非法与越界各有内联文案 | 底 `--surface-float`；边 `--line-strong`；圆角 `--r-3`；输入 28px mono `--surface-inset`；错误 2px `--danger` 左竖条 + `--text-2`；主按钮 28px `--beam`；**宽度 ≤ 560px（H2）**，建议值 240px |
| **F-3** | `.outline-pop` | 当前文件的符号列表（大纲的新归属，见 §2.1） | 非模态；锚在 22px doc strip 的符号按钮下方；`↑/↓` 移动、`Enter` 跳行、`Esc` 关闭；最多 200 项（H1），超出显示「还有 N 项」 | 底 `--surface-float`；边 `--line-strong`；圆角 `--r-3`；行高 ≤ 44px（H4）；符号名 mono 10.5px `--text-1`（mono 承载标识符，DESIGN §3.5 允许）；行号 mono 10px `--text-2`；**宽度 ≤ 560px（H2）**，建议值 320px |
| **F-4** | `.toast-stack` | **仅**「用户刚发起的、会话生命周期或导出类」操作失败 | **位置 = 右上角**（team-lead 裁定；见下方理由）；`role="alert"` + `aria-live="assertive"`；5s 自动消失；可手动关；**不得**用于连接类失败（见 §6.3）；**标题 = 动作名**（「会话未能创建」/「导出失败」），描述 = 内核原文或一句原因，按钮 = 「重试」；**文案禁止出现「内核未连接 / 离线夹具 / 内核已连接 / 正在连接内核」**（R-CONN-1/R-CONN-2 + G12/G15）；`prefers-reduced-motion` 下**直接消失但仍停留 5s**（无渐变、无位移） | 底 `--surface-float`；圆角 `--r-3`；边 `--line-strong`；单个 toast 左 **2px 状态竖条**；标题 `--fs-body` 13px/600 `--text-1`；描述 `--fs-body-sm` 12px **`--text-2`**（float 上 text-3 不可用）；进入 `--t-base` 180ms `--ease-enter`，退出 `--t-fast` 120ms `--ease-exit`（≤640ms）；容器宽 320px；**宽度 ≤ 560px（H2）** |
> **F-4 的位置裁定理由（team-lead，2025-xx）**：**右上角**，不是右下角。右下角正好压住**右侧控制台的 composer 发送按钮**（coding 模式下控制台在右、composer 在底部）—— 那是 5 秒内挡住主操作区。右上角只压控制台头部。**「右上角」是行为约束，不是 px 建议值。**
>
> ⚠ **DESIGN §9.10 的 N20 / N26 目前写的是 `right: 16px; bottom: 38px`（右下角），与本裁定相左** —— 已列入本文 §0.7 的差异记录，请 team-lead 转视觉负责人修正。

| **F-8** | `.conn-retry-menu` | **仅在断连态出现**的连接恢复菜单（唯一的连接恢复入口） | **正常态：连接指示器不是按钮** —— 无 `pointer`、无 `tabindex`、不占焦点、**点击不展开任何菜单**（点了没反应的东西不该长得像能点，H-2）。**异常态（内核未连接 / 断流）：指示器变成可点按钮**（`role="button"` + `aria-haspopup="menu"` + `tabindex="0"`），点开菜单**恒定只有一项**「重试连接」；`Esc` 关闭后焦点还给指示器（H-8）；**不播报**；**不新增状态栏元素**（保 F8 的 ≤ 6）；**菜单内不出现任何连接状态词**（G15：全屏连接状态词仍须 = 1） | 底 `--surface-float`；圆角 `--r-3`；边 `--line-strong`；菜单项行高 30px、`--fs-body-sm` 12px **`--text-2`**（float 上 text-3 不可用）；**宽度 ≤ 560px（H2）**，建议值 200px |
| **F-5** | `.mode-menu-pending` / `.mode-menu-error` | 模式切换中的指示 + 内核拒绝后的内联错误 | pending：目标行尾 6px `--beam` 圆点 + **文字**「切换中」（状态不靠动效表达）；failed：**直接复用 `EmptyState variant="error"`**，**不需要新形态** | pending 点 6px `--beam`；文字 `--fs-label` 11px/500 `--text-2`（模式菜单底是 float）；failed 全部由 DESIGN §8.10 的 error 变体提供（2px `--danger` 竖条 / 13px/600 `--text-1` 标题 / 11.5px `--text-2` 描述） |
| **F-6** | `.activity-handle` | 活动带折叠后仍可展开的把手条 | 折叠高度不是 0 而是把手条；点击或拖拽展开；`aria-label="展开活动带"` | 高度 **≤ 32px**（不超过 `.pane-head` 上限），建议值 8px；底 `--surface-chrome`；上边线 1px `--line-hair`；图标 14px `--text-2`；**不得**出现 beam 实心块（beam 配额 ≤ 2，DESIGN §4.2） |
| **F-7** | `.settings-chip` | 设置行的行尾状态标记（4 种：「本次会话有效」/「不可用」/「当前」/「下一轮生效」） | 行尾追加，不换行；与行标题同行；`aria-label` 与可见文本一致 | 底 `--surface-raised`；文字 **11px `--text-2`**（raised 上 text-3 不可用）；圆角 `--r-full`；padding `0 6px`；高 ≤ 20px；**不使用** `--beam` 底（beam 实心块配额 ≤ 2） |

**另有 3 项 Phase 1 已有形态、只需 Phase 3 补 CSS，不在本文请求范围内**（列出以免遗漏）：

| 形态 | 已有规范出处 | 本文新增的使用点 |
|---|---|---|
| `.left-rail-head` + `.view-seg` 3 段切换器 | DESIGN §4.4（`--surface-rail` 28px 带）、§7.4（24px 3 段切换器） | §2.2 的具体结构与 roving tabindex |
| `.term-instance` 终端实例胶囊 | DESIGN §8.9.4（22px 高 / mono 10px / `--surface-raised` 底 / `--line-strong` 边 / 当前实例 `--beam-wash` 底 + `--beam` 边） | §4.3 的改名、pending 点、关闭规则 |
| `.settings-page` 独立页 | DESIGN §8.8.1（`max-width 880px` / 左导航 176px sticky / 7 项 / 30px 高 / 当前项左 2px `--beam` 竖条 / 控件形态 §8.8.3） | §3.1–3.3 的导航模型、搜索、置灰清单 |

---

*本文档为 pristem 桌面端交互与信息架构的唯一权威来源。视觉决策以 `DESIGN_SYSTEM.md` 为准；本文新增的界面形态以 visual-architect 在 `DESIGN_SYSTEM.md` 中给出的形态定义为准（本文附录 F 是请求清单，不是形态定义）。任何与本文冲突的实现视为缺陷，不视为设计选择。*
