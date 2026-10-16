# 重命名引用检测与更新机制设计（bru.runRequest / setNextRequest / require）

日期：2026-10-16
状态：设计已评审通过，待实施（分两期：一期检测+提示，二期自动改写）

## 1. 背景与问题

Bruno 集合内脚本可以引用其他请求/脚本文件。用户重命名请求或文件夹后，这些引用
会**静默失效**——直到运行脚本时才报错，且报错信息难以让用户关联到重命名操作：

- `bru.runRequest("folder/request")` → 运行时 `invalid request path`
- `bru.setNextRequest("name")` → runner 打印 `Could not find request with name`
- JS 脚本间 `require("./util")` → 运行时模块解析失败

本机制在重命名提交时**主动检测**这些引用并告知用户；二期提供"重命名并自动更新
引用"。定位为**辅助提示机制**：动态引用（变量拼接路径）静态分析无法覆盖，机制不
承诺引用一致性保证。

## 2. 现状调研结论

- **无任何引用检测/更新机制。** `renameItem` thunk
  （`bruno-app/src/providers/ReduxStore/slices/collections/actions.js:837`）只做
  rename IPC + Redux 树更新 + `moveRequestUid` uid 稳定，不碰任何脚本文本。
- **`bru.runRequest` 运行时按相对集合根的文件路径解析**：
  Electron 侧 `runRequestByItemPathname`
  （`bruno-electron/src/ipc/network/index.js:773`）`path.join(collection.pathname, relativeItemPathname)`
  → 缺扩展名则补 → 按 `pathname` 精确查找；CLI 侧同构
  （`bruno-cli/src/commands/run.js:823`）。参数带不带扩展名均可。
- **`bru.setNextRequest` 按请求显示名裸匹配**：写入侧只存字符串
  （`bruno-js/src/bru.js:446`）；消费侧 runner 把运行范围内请求**递归**收集成扁平列表
  （`getAllRequestsInFolderRecursively`，`bruno-electron/src/ipc/network/index.js:1630`），
  然后 `request.name === nextRequestName`（`index.js:2225`）。**不支持
  `folder/request` 路径语法**；子文件夹请求在运行范围内可被匹配；同名请求命中
  第一个（运行时既有歧义）；仅 folder/collection runner 生效。
- **`moveRequestUid`/`deleteRequestUid`**
  （`bruno-electron/src/cache/requestUids.js`）维护 pathname→uid 缓存以保住 draft
  状态，属内部 uid 稳定性机制，与脚本引用无关。
- **词法扫描先例**：`stripBruExtInRunRequest`
  （`bruno-electron/src/ipc/yml-migration.js:188`）是 BRU→YML 迁移中的完整 JS 词法
  扫描器（字符串/模板字面量/`${}` 插值/注释/正则），专用于定位并改写 `runRequest`
  路径参数——证明"扫描并改写引用"在本代码库已被实现过一次，词法框架可直接参照。

## 3. 需求定义

- **一期（检测+提示）**：重命名提交时扫描集合内脚本引用；命中则弹确认框列出引用
  位置，用户选择"仍要重命名"或取消。
- **二期（自动改写）**：同一确认框增加"重命名并更新引用"主操作，确认后 rename 并
  逐处改写引用字面量。
- **交互模式：每次确认。** 不做静默自动改写；每序列出引用位置由用户逐次决定。
- 覆盖三类引用：`runRequest` 路径、`setNextRequest` 显示名、JS 脚本间 `require`
  相对路径。
- 入口仅为 `RenameCollectionItem`（请求/文件夹/JS 脚本重命名）。CLI 无 rename 操作，
  不涉及。

## 4. 核心匹配模型：解析-比对，而非字符串替换

对每个引用字面量，**按运行时相同规则解析出它指向的目标**，判断目标是否落在被
重命名范围内 → 命中；改写 = 用新路径/新名**重新计算**字面量。统一处理文件夹前缀
变化、`./xx` 相对形式等情形：

| 引用 | 运行时解析基准 | 触发检测的重命名 | 改写规则 |
|---|---|---|---|
| `bru.runRequest("folder/req")` | 相对**集合根**的路径（带/不带扩展名均可） | 请求或祖先文件夹的**文件名**变化 | 重算新相对路径（文件夹重命名 = 子树内所有目标前缀更新） |
| `bru.setNextRequest("name")` | 请求**显示名**（runner 内匹配） | 请求**显示名**变化 | 替换为新显示名 |
| `require("./util")`（JS 脚本间） | 相对**引用方文件所在目录**的路径 | 目标 js 文件或祖先文件夹的**文件名**变化 | 重算新相对路径 |

**两类名字独立触发**：显示名变化只扫 `setNextRequest`；文件名变化只扫
`runRequest`/`require`；两者都变则都扫。文件夹重命名对 `setNextRequest` 无影响
（名字匹配无路径成分）。

### 匹配细节

- 字面量比较基于 `normalizePath` 后的**精确匹配**（与运行时解析一致，不做大小写
  折叠——运行时查找本身是精确字符串比较）。
- `runRequest` 参数带/不带 `.bru`/`.yml` 扩展名都识别。
- **动态参数**（`` bru.runRequest(`folder/${x}`) ``、变量传入）：无法解析目标——不
  参与改写，但**计数并在确认框提示**"存在 N 处动态引用，无法自动更新"。
- **检测为运行范围的超集**：扫描集合级全量（不做运行范围过滤），宁可多报不漏报。

### 扫描载体

集合树全部 item 的 `script.req` / `script.res` / `tests`、folder/collection root
脚本、`.js` 脚本文件内容。扫描作用于**内存脚本文本**，与 `.bru`/`.yml` 格式无关
——**无任何 DSL 变更**。扫描的数据源是 Redux 树（含未保存 draft），故未保存的
脚本也在检测范围内。

## 5. 架构与组件

实现采用 **renderer 侧扫描 + 词法扫描器下沉 bruno-common**（评审选定的方案 A）：
无新 IPC 往返，draft 状态天然可见，扫描器独立可测可复用。未加载/部分加载
（partial mount）集合扫不到，但这类集合本身无法 rename 其内部项，不构成缺口。

### 5.1 词法扫描器（bruno-common，新增）

纯函数、零依赖、browser-safe（符合架构边界：bruno-common 是无 Node 内建依赖的叶包）：

- `scanScriptLiterals(scriptText, { calleeNames })` →
  `[{ kind, arg, isLiteral, start, end }]`——词法级跳过注释/正则，识别单双引号字符
  串与模板字面量（`${}` 插值内或变量传入 → `isLiteral: false`）；入参先 `indexOf`
  预筛走快路径。
- `rewriteScriptLiterals(scriptText, edits)` → 按位置**倒序**替换（仅二期使用）。
- 词法框架参照 `stripBruExtInRunRequest`；实施时评估将该 tokenizer 迁至
  bruno-common 共享，若迁移回归风险高则保留原实现，并在两处注明配对
  （feature-parity 规则：同逻辑双份必须注明）。

### 5.2 引用扫描 util（bruno-app，`utils/collections/` 下新增）

`scanCollectionReferences(collection, { oldFilenamePath, newFilenamePath,
oldDisplayName, newDisplayName })`（路径入参均为**相对集合根**的路径，扩展名可选）
→ 遍历树收集脚本载体 → 逐段调扫描器 → 按运行时
规则解析每个字面量的目标 → 命中产出
`{ itemUid, itemName, carrier, kind, arg, editRange }`；动态调用单独计数。
路径解析与运行时一致：`runRequest` 基于集合根、`require` 基于引用方目录、
`normalizePath` 精确比较、扩展名可选。

### 5.3 确认对话框（bruno-app，新增 `RenameReferenceWarning/` 组件目录）

- 列出命中引用：位置（显示名 + 相对路径）、类型、当前字面量值；有未保存 draft 的
  引用方标注"含未保存修改"。
- 按钮：一期 `[仍要重命名] [取消]`；二期增加主按钮 `[重命名并更新引用]`。
- 动态引用计数提示常驻底部。

### 5.4 集成点（改 `RenameCollectionItem`）

`onSubmit` 中：计算显示名/文件名是否变化 → 有变化则调扫描 → 命中则打开对话框并
暂存 rename payload；确认后走**原封不动的** `renameItem` 流程。`renameItem` thunk
本身零改动。

### 5.5 改写 thunk（bruno-app，仅二期新增）

`rewriteScriptReferences({ collectionUid, edits })`：rename 成功后执行——按新路径
重算每个字面量 → 更新内存态 → **保存策略**：无 draft 的引用方自动保存；有 draft
的只改写内存内容、**不自动保存**（避免连带保存用户半成品），由对话框标注 + toast
提醒用户自行保存。

## 6. 数据流（二期完整形态）

```
提交 rename → 名字有变化？→ 否：直接 renameItem
                          → 是：扫描 → 无命中 → 直接 renameItem
                                   → 命中 → 确认框
        ├─ 取消：结束
        ├─ 仍要重命名：renameItem（引用不动）
        └─ 重命名并更新引用：renameItem → 逐条改写（按位置倒序）
                                        → 无 draft 者自动保存，有 draft 者仅内存改写
                                        → toast 汇总（更新 N 处 / M 处待手动保存）
```

## 7. 边界与错误处理

- **动态引用**：永不改写，仅计数提示。
- **改写失败**（某 item 保存报错）：跳过该项、toast 汇总失败清单，rename 本身不
  回滚。
- **扫描器异常**：fallback 为跳过检测直接 rename——检测是增强，不得阻塞重命名。
- **文件夹重命名**：命中可能几十处，逐项串行保存即可，无并发优化（YAGNI）。
- **CLI**：不涉及（CLI 无 rename）；扫描器在 bruno-common，未来 CLI 可复用。
- **QuickJS shim**：不涉及（`runRequest` 路径解析在 host 侧，不在 sandbox 内）。

## 8. 性能

- 扫描一次性、同步、仅在提交 rename 时触发：`indexOf` 预筛 + 词法解析，
  O(集合总脚本文本)。万级请求 × 2KB 脚本为百毫秒内，无需 worker/常驻索引。
- 运行时零开销：不改变 `runRequest`/`setNextRequest` 的运行时解析路径。
- 改写仅在命中时写盘，走现有 `saveRequest` 链路与既有 watcher 回环处理模式。

## 9. 分期交付

| 期 | 内容 |
|---|---|
| 一期 | bruno-common 扫描器 + 扫描 util + `RenameReferenceWarning`（只读列表/仍要重命名/取消）+ `RenameCollectionItem` 集成 + 三类字面量检测 + 动态引用计数 |
| 二期 | 改写 util + "重命名并更新引用"主操作 + `rewriteScriptReferences` thunk + draft 保存策略 |

## 10. 测试策略

- **扫描器单测**（bruno-common）：注释中的调用不命中、模板插值判非字面量、转义
  引号、正则字面量不误判、多行字符串、三类 callee 各形态。
- **扫描 util 单测**（bruno-app jest）：路径匹配（带/不带扩展名、文件夹前缀、
  `./` 相对形式）、显示名精确匹配、动态计数、draft 载体覆盖。
- **e2e**：一期——rename 命中弹框 → 仍要重命名 → 引用保持原样（后续运行报错的
  行为不变）；无命中时无弹框直通。二期——重命名并更新 → 断言脚本文本已改写且
  落盘。
- **手动**：有 draft 引用方的"仅内存改写 + 提醒手动保存"场景。

## 11. 范围外说明

- 动态引用（变量拼接/环境变量路径）的静态分析不在范围内——机制定位为辅助提示，
  无法保证引用一致性。
- 不引入引用倒排索引/启动时全量扫描（YAGNI，rename 低频且全量扫描已足够快）。
- 不改变 `setNextRequest` 的显示名匹配语义（含同名请求歧义——运行时既有行为）。
- 无 DSL/on-disk 格式变更（扫描与改写均作用于已解析的内存脚本文本）。
