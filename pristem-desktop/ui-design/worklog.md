# 修改记录 — pristem 桌面端 UI 精造（第一轮）

> 证据口径：`ui-design/scripts/audit_ui.py`（静态）、`analyze_pixels.py`（像素）、
> 760/880/1040/1440 截图（`ui-design/screenshots/`）、`.visual-check` 各套件、`cargo test`。
> 状态：完成 / 豁免（给依据）/ 残留（给原因）。

| # | 时间 | 阶段 | 文件 | 改了什么 | 为什么 | 依据 | 状态 |
|---|---|---|---|---|---|---|---|
| 1 | 11-19 21:00 | 实现 T1 | `ui/src/styles.css` | `--text-3` #8C8C8C→#949494、`--text-4` #6E6E6E→#7E7E7E | 辅助文字在 float 上原为 4.38:1，低于 4.5 | 脚本实测：text-3 最低 4.86（float），text-4 仅装饰 | 完成 |
| 2 | 11-19 21:00 | 实现 T1 | `ui/src/polish.css` | 可读小字（`.line-tag`/`.send-hint`/`.menubar-key`/placeholder 等）统一走 `--text-3`；`--text-4` 只留 disabled、caret、分隔符、mode-accent 回退 | 把 token 层级兑现到用法层 | `grep --text-4` 现仅 5 处，全部非语义 | 完成 |
| 3 | 11-19 21:00 | 实现 T2 | `ui/src/styles.css`、`.guide-done h2` | `--fs-mono` 11.5→12px；guide 完成页裸 18px→`var(--fs-title)` | 去掉半点字号与孤立字号 | 审计 `type_ladder` 9 档：10,11,12,13,14,15,20,26,34 | 完成 |
| 4 | 11-19 21:00 | 实现 T3 | `ui/src/styles.css` | 建立 `--sp-*` 间距 token，组件内的 5/7/9/11/13/14/18/22/26/28/30px 全部改走 token | 间距节奏可审计 | 审计 `off_grid_values` 为空 | 完成 |
| 5 | 11-19 21:00 | 实现 T5 | `ui/src/styles.css`、`workspace.tsx` | 画布空态：标题 `--fs-title`/text-1；动作组与快捷键组用 hairline 合为一组 | 原按钮与提示相隔约 120px，读作两座孤岛 | 实测：动作区底到快捷键组顶 **24px**；标题 20px / #E8E8E8 | 完成 |
| 6 | 11-19 21:24 | 实现 T4 | `ui/src/styles.css` | `.goal` 渐变的 `#1D1D1D/#0F0F0F` 改 token；`.search-done/.search-error` 的 `--ok/--danger` 回退字面量改 `--success/--danger`；关闭按钮 hover 的 `#000/#fff` 改 token | token 块之外不留裸 hex | 审计 `stray_colours` = 6，全部为 mask 的 `#000` 不透明度通道（见 #7） | 完成 |
| 7 | 11-19 21:25 | 审计工具 | `ui-design/scripts/audit_ui.py` | ①`palette-sprawl` 改为“token 块之外的裸 hex”（含注释屏蔽、mask 停点除外、token 行多字面量视为声明）；②`--text-4` 不计入正文对比度（装饰/禁用层） | 原规则把 token 定义本身算进色板（35 色），也无法表达 text-4 的契约 | 复审：`stray_colours` 0；`contrast-fail` 0 | 完成 |
| 8 | 11-19 21:30 | 实现 T6 | `ui/src/styles.css` | ≤1040 右栏 `min(320px, 用户宽度)`；≤880 右栏改覆盖式（`--right-w:0`、`grid-area:auto`、left=`--left-w`）；≤880 搜索胶囊 26px/聚焦 220px；≤880 会话胶囊隐藏；补 `panel-slide` 与 reduced-motion | 760–1040 窗口下编辑器不再被挤到不可读 | 760/880 截图：右栏铺满树右侧，无被切断的文字；1040 为 320px 列 | 完成 |
| 9 | 11-19 21:31 | 实现 T6 | `ui/src/components/ChromeExtras.tsx` | 搜索胶囊 `onClick` 聚焦输入框 | 胶囊收成图标后，点图标必须能展开（聚焦即展开） | 探针：点击后胶囊 26→220px，`activeElement` = INPUT | 完成 |
| 10 | 11-19 21:31 | 实现 T6 | `shell/src/main.rs` | 最小内尺寸 960×620 → 760×560 | 窄窗支持的前提 | `cargo build` 通过；UI 在 760 无横向滚动 | 完成 |
| 11 | 11-19 21:33 | 缺陷修复 | `ui/src/workspace.tsx` | 终端在 `document.fonts.ready` 后再 `fit()` 一次 | 字体晚到会改变单元格宽度；当前 xterm 渲染网格在每档均比宿主宽约 3%（窄档右缘超出视口 2–7px） | 残留：见 #12 | 完成 |
| 12 | 11-19 21:34 | 残留 | `.xterm-screen` | xterm 渲染网格比宿主宽约 31px（<1 个字符单元的可见裁切，窄档下跨出视口 1–7px） | 上游 FitAddon 的 cell 宽度测量与 DOM 渲染不一致；页面本身无横向滚动（`scrollWidth == clientWidth`，四档实测） | 全局存在（1440 亦 764→792），非本轮引入；修复需改 xterm 测量，超出本轮范围 | 残留 |
| 13 | 11-19 21:35 | 缺陷修复 | `ui/src/styles.css` | `--dial-gap` 从 `var(--sp-1)` 改回 `2px` | 间距 token 化后刻度器从 23/28px 变成 31/36px，E2E E1/E2 失败 | 主套件 201/201（修复前 199/201） | 完成 |
| 14 | 11-19 21:36 | 收敛 | `ui/src/styles.css`、`ui/src/polish.css` | 间距 token 只在 `styles.css` 定义一次；最终为 **2/4/6/8/12/16/24/32**（`--sp-5`=10 兼容别名），删除 polish 层重复定义 | 两处同名 token 会被后加载层覆盖，实际生效值与声明处不符 | 计算样式：`.term-host` padding 回到设计值 8/12 | 完成 |
| 15 | 11-19 21:40 | 文档 | `DESIGN_SYSTEM.md` | §3.3 `--fs-mono` 12px；§4.1 text-3/text-4 实测值；§4.1 跨 surface 表实测值；新增附录 A′（token 与窄窗变更） | token 改动必须回写 | 对比度由 `audit_ui` 同一函数计算 | 完成 |
| 16 | 11-19 21:41 | 文档 | `UX_SPEC.md` | 新增 §8.5 窗口尺寸降级（≥1200 / 1041–1199 / 881–1040 / 760–880） | 右栏变抽屉是行为变化 | 760/880/1040/1440 截图与探针 | 完成 |
| 17 | 11-19 21:42 | 交付 | `FINDER.md` | 新增仓库文件地图：所有权、模块表、按任务索引、阅读顺序、验证清单 | 新接入的 section 需要快速定位文件 | 与 `AGENTS.md` 的 “Where things live” 对齐 | 完成 |
| 18 | 11-19 21:05 | 豁免 | `ui/src/styles.css` | `side-tab` 13 处 | 均为 1px hairline 分隔线或 2–3px 语义严重度标记（错误/警告行），不是“圆角卡片 + 粗彩色竖条” | 人工核对选择器 | 豁免 |
| 19 | 11-19 21:05 | 豁免 | `ui/src/styles.css` | `glassmorphism` 17 处 | 全部在浮层/对话框/命令面板；内容容器零使用 | 人工核对（`.palette/.model-modal/.menubar-menu/...`） | 豁免 |
| 20 | 11-19 21:05 | 豁免 | `ui/src/styles.css` | `cream-magazine`：`#FAFAFA` | 它是 `--beam-bright`（唯一冷白强调），不是奶油底 | token 声明行 | 豁免 |
| 21 | 11-19 21:05 | 豁免 | `ui/src/styles.css` | `type-scale-chaos`：9 档 | 密集工具需要 10–34px 的压缩区间；已删除 11.5 与孤立 18px | DESIGN §3.3 | 豁免 |
| 22 | 11-19 21:05 | 豁免 | `ui/src/styles.css` | `untinted-neutral`：R=G=B 中性色 | DESIGN §4.1 刻意无彩底；本轮只提亮度不加色相 | DESIGN §1.2/§4.1 | 豁免 |
| 23 | 11-19 21:43 | 验证 | `.visual-check/*`、`scripts/smoke.mjs` | 主套件 206/206（新增 5 条窄窗检查：无横向滚动、覆盖式右栏、会话胶囊隐藏、搜索胶囊收起/展开）；effects 35/35；explorer 23/23；search 19/19；phase4 14/14；terminal 6/6；smoke 15/15 | 每套件独立端口、独立服务 | 各套件输出行 | 完成 |
| 24 | 11-19 21:43 | 验证 | `shell/` | `cargo build` 通过；`cargo test` 37/37 | 最小尺寸与主题改动 | cargo 输出 | 完成 |
| 25 | 11-19 21:47 | 验证 | 截图 | `ui-design/screenshots/w1440,w1040,w880,w760.png`；像素统计 | 主色 #181818 79–85%（chrome），近白 0%，均值亮度 29.2–29.4，RMS 19.3–20.5 | `analyze_pixels.py` | 完成 |
| 26 | 11-20 10:05 | 缺陷修复（用户反馈） | `ui/src/styles.css` | 间距阶梯从被翻倍的 4/8/12/16/20/24/32/48 还原为计划值 **2/4/6/8/12/16/24/32**（`--sp-5`=10 兼容别名） | 用户截图：左栏「文件/搜索/版本」与树工具行被面板边缘遮挡。根因是 polish 层把 `--sp-*` 整体翻倍，`--sp-6` 12→24：左栏头部 `scrollWidth 355 > clientWidth 268`，树工具行 `277 > 267`；齿轮与最后两个动作被裁掉 | 探针 scrollWidth/clientWidth；修复后 268/268 与 267/267 | 完成 |
| 27 | 11-20 10:08 | 自适应 | `ui/src/App.tsx`、`ui/src/styles.css` | 按**列宽**（非窗口宽）派生 `rail-tight`(<248px) / `rail-tighter`(<216px)：收紧头部与段 padding、树工具行 gap；窄档树标题走 `text-overflow: ellipsis`，动作按钮不隐藏；三段切换器始终保留文字 | 左栏可被拖到 200px；只靠 viewport 媒体查询无法覆盖列宽变化 | 实测 236px 与 200px：`.left-rail-head`、`.filetree .pane-head` 的 `scrollWidth == clientWidth`，齿轮始终在列内 | 完成 |
| 28 | 11-20 10:10 | 验证 | `.visual-check/check.cjs`、全部套件 | 新增 N5×2：键盘把左栏收窄到 236px 后头部/树工具行不裁切、齿轮在列内；双击恢复 268px。主套件 **208/208**；effects 35/35；explorer 23/23；search 19/19；phase4 14/14；terminal 6/6 | 用户报告的「栏目被遮挡」必须由测试守住 | 套件输出行 + 四档截图 | 完成 |
| 29 | 11-20 11:05 | 用户反馈：状态改块 | `SessionBar.tsx`、`ChromeExtras.tsx`、`views.tsx`、`styles.css` | 删除 `.session-switcher .tab-dot`、`.conn-dot`、`.running-pill i`；会话切换改为 24px 边框块，传输状态改为 16px 状态色 12–14% 底块，运行状态改为 18px 块（awaiting=warn / blocked=danger） | 孤立的点只能靠颜色传信息；块 + 会变的文字才是可读状态 | 标题栏/状态栏截图：块内文字完整，无点 | 完成 |
| 30 | 11-20 11:10 | 缺陷修复（适配审计） | `ui/src/styles.css` | `.review-canvas` 加 `position: relative` | advisor 的 «sample» 角标是绝对定位，原容器无定位上下文，角标锚到画布外并被 `overflow:auto` 裁掉（探针：tag 1366..1420 被 1140 的容器裁切） | 修复后 tag 1065..1119 完全在 canvas 0..1140 内 | 完成 |
| 31 | 11-20 11:15 | 适配审计 | 六模式 + search/git/settings/palette/sessions，1440 与 760 | 逐元素比较「自身右缘 vs 最近裁剪祖先右缘」；仅 advisor 角标命中；IDE/deepsleep 的 `.dial.is-off`（宽 0）命中属既定隐藏态 | 排查其他会「挤出去」的 UI 元素 | 审计输出：coding/helping/goal/advisor(修复前除外) 均为空 | 完成 |
| 32 | 11-20 11:18 | 验证 | `.visual-check/check.cjs`、全部套件 | 新增 3 条：连接状态/会话切换是「文字块而非色点」、advisor 角标在画布内。主套件 **211/211**；effects 35/35；explorer 23/23（首轮拖拽用例偶发失败，重跑通过）；search 19/19；phase4 14/14；terminal 6/6 | 新规则必须由测试守住 | 套件输出行 + 截图 | 完成 |
| 33 | 11-20 12:05 | 实现：浮起层级 | `ui/src/styles.css` | 新增 `--elev-1/2/3`（接触阴影 + 环境阴影双层）与 `--rim-top`；统一菜单/popover（elev-2）、palette/对话框/toast（elev-3）；composer 与 goal input 从「内凹井」改为「浮起托盘」（`--surface-raised` + elev-1）；hero 图标砖加 elev-1 | 只有一层阴影时物体贴地；两层阴影 + 顶缘受光才读作离开页面 | 计算样式：palette `0 4px 14px + 0 34px 90px` + inset rim；composer `rgb(35,35,35)` + elev-1 | 完成 |
| 34 | 11-20 12:08 | 实现：浮动曲率 | `ui/src/styles.css`、`ui/src/polish.css` | 浮动表面半径升一档（小浮层 8px、palette/对话框 12px），曲率 `superellipse(3)`；控制件保持 `superellipse(2)` | 6px 以下看不出连续曲率；浮层的 8–12px 才让 G2 可辨 | 计算样式：`.palette` r=12px shape=`superellipse(3)`；`.mode-menu` r=8px shape=`superellipse(3)`；放大截图角部平滑 | 完成 |
| 35 | 11-20 12:12 | 验证 | 全部套件 | 主套件 **211/211**（首轮一次点击超时，重跑通过）；effects 35/35；explorer 23/23；search 19/19；phase4 14/14；terminal 6/6 | 浮起与曲率不得破坏交互与布局 | 套件输出行 + after-*.png | 完成 |
| 36 | 11-20 13:10 | 第二轮改向：Night Foundry | `ui/src/styles.css` | 全站色板改为温暖石墨（8 级表面）+ 单一琥珀信号；文本改暖白/暖灰；语义色改暖调；频谱与 hover/bevel 全部转暖；`.app-shell` 加左上琥珀灯；coding/goal 模式强调色改琥珀 | 第一轮仍是冷灰 IDE 质感，用户判定「不够好」并要求 brave；暖石墨 + 琥珀是能落到 token 的方向 | 对比度实测：text-3 5.48、danger 4.84、beam 7.04（float，最低档均 ≥4.5）；audit 0 ERROR | 完成 |
| 37 | 11-20 13:14 | 字体与强调分配 | `ui/src/styles.css`、`monaco-setup.ts`、`workspace.tsx` | 眉标改 `--beam-dim` + 0.18em；画布空态标题 20→26px；主按钮/发送按钮改琥珀渐变；页签/终端页签/树选中/分隔线/命令面板选中统一用琥珀；Monaco 与 xterm 主题同步为暖语法色（keyword 钢蓝、string 鼠尾草、number 琥珀、type 藕紫），终端光标琥珀 | 让「当前 / 可执行 / 存在」三件事共享同一个信号色；编辑器与终端不能留在冷色孤岛 | 计算样式 + 截图：页签顶线/终端页签琥珀，Monaco 背景 `#1F1A16` | 完成 |
| 38 | 11-20 13:17 | 一致性修复 | `workspace.tsx`、`ui/src/styles.css` | 终端降级标记从 6px 圆点改为文字块（「管道」/「pipe」）；终端激活页签改琥珀 | 延续「状态是文字块，不是色点」；终端页签不该是唯一冷蓝激活态 | 套件 terminal 6/6 | 完成 |
| 39 | 11-20 13:20 | 验证 | 全部套件 + 审计 + 截图 | 主套件 **211/211**；effects 35/35；explorer 23/23；search 19/19；phase4 14/14；terminal 6/6；审计 0 ERROR / 16 WARN（全部已豁免）；修正审计的 `cream-magazine` 只检查 `--surface-*`（避免把暖白文字误判为奶油底） | 大改色不得破坏几何与交互 | 套件输出 + `nf-*.png` | 完成 |
| 40 | 11-20 14:05 | VOID：纯黑改向 | `ui/src/styles.css` | 色板整体替换：void/canvas `#000000`、面板 `#0A0A0A`、chrome `#060606`、raised `#161616`、float `#1D1D1D`；文本 `#F5F5F5/#C4C4C4/#9C9C9C/#747474`；`--beam` 改纯白、`--beam-ink` 纯黑；语义色回中性；移除琥珀灯与暖色渐变 | 暖石墨 + 琥珀被用户判定「更 AI 味」；纯黑 + 灰 + 白是工具而非 AI 产品的语言 | 对比度实测（float）：text-3 6.14、danger 4.78、beam 16.86，全部 ≥4.5 | 完成 |
| 41 | 11-20 14:08 | 颜色归属 | `ui/src/styles.css`、`monaco-setup.ts`、`workspace.tsx` | chrome 全部灰阶：空态图标砖改灰、页签/树选中/终端页签/命令面板选中改白色；主按钮与发送保持纯白底黑字；Monaco / xterm 背景 `#000000`，语法色回棱镜四色，光标白色 | 彩色只允许出现在棱镜、频谱、代码语法与四种状态；chrome 不得有色相 | 计算样式；截图 `void-final.png` | 完成 |
| 42 | 11-20 14:15 | 验证 | 全部套件 + 审计 | 主套件 **211/211**（首轮一次点击超时，重跑通过）；effects 35/35；explorer 23/23；search 19/19；phase4 14/14；terminal 6/6；审计 0 ERROR / 16 WARN（已豁免） | 大改色不得破坏几何与交互 | 套件输出 + `void-*.png` | 完成 |
| 43 | 11-20 15:05 | 构图层：标题页 | `ui/src/styles.css` | 画布空态从居中模板改为**左对齐标题页**：40px 白规线、34px 标题、左对齐描述/动作、快捷键两列表（`1fr auto`）、左边距 clamp(48,10vw,168) | 用户指出 VOID 只是换色、构图没变；居中 icon+title+buttons 是 AI 模板本身 | 1440 截图：标题页可读、无溢出；主套件 211/211 | 完成 |
| 44 | 11-20 15:08 | 构图层：字形与控件 | `ui/src/styles.css` | `--font-ui` 优先 **Bahnschrift**（DIN）；搜索从 pill 改**底划线输入**；主按钮/发送/会话块圆角 6→3px；树选中改白竖线；页签激活改透明底 + 白顶线 | 让界面在结构上而不只是色值上区别于旧版 | 截图：拉丁标签与数字为工程字体，控件锐利、浮层仍圆润 | 完成 |
| 45 | 11-20 15:12 | 验证 | 全部套件 | 主套件 **211/211**；effects 35/35；explorer 23/23；search 19/19；phase4 14/14；terminal 6/6 | 构图调整不得破坏交互 | 套件输出 + `swiss-*.png` | 完成 |
| 46 | 11-20 15:40 | 用户反馈：代码颜色 | `ui/src/styles.css`、`monaco-setup.ts`、`workspace.tsx` | Chrome 保持黑/灰/白，**代码表面恢复高饱和**：keyword `#C792EA`、string `#A9E08F`、number `#F2A65A`、type `#F4D06F`、function `#7FB2FF`、variable `#8FE3E0`、tag `#FF8A8A`、comment `#5F6672`；选区改蓝；终端 ANSI 16 色同一套；树图标按类型着色 | 用户指出 IDE 颜色被削弱；「黑房 + 亮代码」才是本轮的方向——界面无色，内容有色 | 打开 `workspace.tsx` 截图：关键字紫、字符串青柠、类型金、函数蓝，黑底可读 | 完成 |
| 47 | 11-20 15:45 | 验证 + 记录 | 全部套件、`bug_log_optimize.md` | 主套件 **211/211**；effects 35/35；search 19/19；把 Monaco 缺少 tsconfig 导致的红色波浪线记为 OPEN（非配色问题） | 代码颜色改动不得影响交互；诊断噪声需与配色问题分开 | 套件输出 + `color-code.png` | 完成 |

## 读图命题（封闭式，逐档）

| 命题 | 结果 | 证据 |
|---|---|---|
| 是否存在横向滚动条 | 否 | `scrollWidth === clientWidth`（1440/1040/880/760） |
| 标题栏是否把控件挤出 | 否 | `.titlebar scrollWidth == clientWidth`（四档） |
| 800/880 档是否还有被面板切断的文字 | 否 | 覆盖式右栏铺满树右侧（w760/w880 截图） |
| 空态标题与说明是否可读 | 是 | 20px `#E8E8E8`；12px `#B8B8B8`（9.66:1） |
| 动作组与快捷键提示是否成组 | 是 | 间隔 24px + 1px hairline |
| 节点/列是否有重叠遮挡 | 否 | 三列/覆盖式布局截图 |
| 左栏头部三段 + 齿轮是否完整可见 | 是 | 268px：`scrollWidth 268/268`，齿轮右缘 260；236px 与 200px 亦不裁切 |
| 树工具行 7 个动作是否完整可见 | 是 | 268px：`267/267`；窄档标题省略、按钮全在 |

> 读图限制：本环境没有安装 `image-understanding` 技能，截图由多模态读图 + 像素统计 + 代码声明三源交叉，
> 未做基于外部 OCR 的二次验证；结论只覆盖上述封闭命题。

## 未验证项

- 真实 760×560 原生窗口的首帧（截图来自 760×720 的 WebView viewport；`main.rs` 的最小尺寸已改，但未做窗口级截图）。
- `_desktop-selfcheck.cjs`（真实 WebView2 + 原生对话框）未在本轮重跑；它不在本轮计划的 E2E 清单内。
- 动效的流畅度（只验证了 `prefers-reduced-motion` 分支存在与不报错）。
