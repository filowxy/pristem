# 计划：pristem 桌面端 UI 精造（第一轮）

> 方向：沿用 "darkroom instrument panel" 身份，做工艺级精造 + 空态主角感 + 窄窗折叠。
> 用户确认（2026-11-19 20:54）：**范围 A（工艺级精造），先出计划**；**窗口需支持缩到约 700–800px**。
> 证据来源：`ui-design/scripts/audit_ui.py` 输出（40 文件 / 0 ERROR / 27 WARN / 36 INFO）。

## 保留清单（不可动）

- [x] **功能行为**：六模式矩阵、模式切换器唯一性、终端多开、设置页分区、引导流程、E2E 全部断言。
- [x] **文案与信息架构**：所有中英文案（含"还没有打开文件""还没有对话"等）、i18n key 语义；
      新增文案必须同时进 `ui/src/i18n.ts` 两份字典。
- [x] **品牌资产**：棱镜图形、"pristem." 字标、存在感刻度器（唯一的脸）、beam 单一强调色。
- [x] **接口契约**：`io:*` / `ClientRequest` / SSE 通道，不动。
- [x] **DESIGN_SYSTEM.md v1.0 的身份条款**：无彩暗房底色、单一冷白 beam、hairline 分隔线、动效 6 档。
- [x] **token 契约**：改动 token 必须同步 `DESIGN_SYSTEM.md` 附录 A（现值 → 新值）。

## 任务清单

- [x] **T1 对比度底线** ｜验收：`audit_ui.py` 报告 **0 条 contrast-fail**；每个可读文字 token 在全部
      surface 上 ≥4.5:1（脚本数值入 worklog）；`DESIGN_SYSTEM.md` §4.1 与附录 A 同步。
      做法：`--text-3` #8C8C8C→**#949494**（最差 4.86:1）、`--text-4` #6E6E6E→**#7E7E7E**（3.63:1），
      并把承担可读文字的 text-4 用法（.micro / .line-tag / .send-hint / .menubar-key / input placeholder）
      改到 text-3；text-4 只留 disabled、装饰 caret、分隔符、mode-accent 回退。

- [x] **T2 字号阶梯收紧** ｜验收：独立 px 字号 11 → **9**（`--fs-mono` 11.5→12px；`.guide-done h2`
      裸 18px→`var(--fs-title)`）；阶梯写进 `DESIGN_SYSTEM.md` §3.3。

- [x] **T3 间距 token 化** ｜验收：新增 `--sp-1..--sp-16` 8 档；组件里
      5/7/9/11/13/14/18/22/26/28/30px 全部改走 token；`spacing-grid` INFO 归零。
      最终档位回到计划值 **2/4/6/8/12/16/24/32**（`--sp-5`=10 为兼容别名）。
      中途 polish 层曾把整档放大一倍，导致左栏头部与树工具行被裁切（用户截图确认），
      已按根因还原，见 worklog #26。

- [x] **T4 颜色纪律** ｜验收：token 块之外无裸 hex（`#382D2D`/`#4A3535`/`#B44646` 改 danger 派生色）；
      `palette-sprawl` 从 38 → token 体系内的声明级计数。
      实现：审计脚本把 `palette-sprawl` 定义为"token 块之外的裸 hex"，现为 0（mask 的 `#000`
      是不透明度通道，已排除）；颜色收敛在 `:root` 一处。

- [x] **T5 空态主角** ｜验收：中心画布"打开文件夹"按钮与快捷键提示组的垂直间距 ≤32px（现约 120px，
      脚本量）；标题升到 `--fs-title` 且走 text-1；右栏空态只留一句核心信息，不加装饰；
      截图读图确认无"孤立大片空白"。实测 24px、标题 20px/#E8E8E8。

- [x] **T6 窄窗折叠（700–800px）** ｜验收：在 **760 / 880 / 1040 / 1440** 四档宽度截图，
      **0 元素溢出视口**（脚本量）；标题栏搜索胶囊在窄档收成图标宽、聚焦展开；session chip 窄档隐藏；
      右栏 1040px 以下收窄、880px 以下变覆盖式；`main.rs` 最小内尺寸 960×620 → **760×560**；
      1200/1440 两档 E2E 断言不受影响。实测：四档 `scrollWidth == clientWidth`；
      xterm 内部渲染网格有 <1 字符单元的越界（上游测量，见 worklog #12 残留）。

- [x] **T7 验证与回写** ｜验收：审计 ERROR=0 且无未豁免 WARN；像素统计（`analyze_pixels.py`）记录
      主色分布/近白占比/RMS；封闭命题读图全部通过；`cargo test` 全绿；**全部 E2E 套件全绿**；
      `DESIGN_SYSTEM.md` 附录 A 记录 token 变更；`ui-design/worklog.md` 每处改动一行。

## 审计与验证

- [x] 静态审计通过（ERROR=0，WARN 已修/已豁免）：`ERROR=0 WARN=17 INFO=2`，17 条全部为已豁免类别
- [x] 桌面截图（1440 / 1040 / 880 / 760）验证 + 像素统计
- [x] 读图命题全部通过（对齐/截断/重叠/可读性/间距/溢出）
- [x] E2E：主套件 206/206（含 5 条窄窗断言）+ effects 35/35 + explorer 23/23 + search 19/19 +
      phase4 14/14 + terminal 6/6 + smoke 15/15；`cargo test` 37/37

## 风险与残留

- **整体亮度上升**：T1 抬高 text-3/text-4 后，暗房底色整体变亮，可能与"暗房"气质冲突 →
  只抬到刚好达标（#949494 / #7E7E7E），不再多给；若读图判定过亮，回退 text-3 到 #8E8E8E（4.50:1），
  并把可读文字再上一档。
- **E2E 布局断言**：`F4: console column is 360px` 等在 1200px 下测量；T6 的折叠阈值必须 >1200px，
  否则既有断言失效。
- **窄窗右栏变抽屉**：属于行为变化（原来永远是列），需在 `UX_SPEC.md` 记录降级规则；
  若用户手动拖过宽度，窄档仍以抽屉呈现，不覆盖其设置。
- **390px 移动端**：豁免（原生桌面窗口，最小 760×560），不投入。
- **并发编辑**：仓库里有另一个 agent 同时改动（工作区持久化）；本轮只动 `ui/src`、`shell/src/main.rs`
  的最小内尺寸、`DESIGN_SYSTEM.md`、`UX_SPEC.md`，冲突时以本计划为准并记录。
