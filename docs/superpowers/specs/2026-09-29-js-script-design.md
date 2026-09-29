# JS Script(独立 .js 脚本文件)设计

日期：2026-09-29
状态：已实现（Part 1/Part 2 于 2026-09-28 落地并合入 feature/data-driven-testing；rename/delete 通道修复同日完成。本文档为事后补充的设计记录，与实现一致）

## 1. 背景与目标

官方文档（docs.usebruno.com/testing/script/js-file）宣称：右键集合/文件夹可创建
JS 文件，在脚本里 `require()` 复用，并可通过 `additionalContextRoots` 跨集合共享
脚本库。调查确认该菜单项从未进入开源仓库（闭源 Golden Edition 功能），而**执行层
已开源**：同集合 `require()` 在两种沙箱均支持，`additionalContextRoots` 的
electron→bruno-js 透传也已打通——但 quickjs 沙箱（Safe Mode）不支持 ACR，且 UI
创建/管理链路完全缺失。

本功能补齐两端：

- **Part 1（UI 链）**：New JS Script 菜单 → 创建 `.js` 文件 → 侧边栏显示 →
  编辑/保存 → 重命名 → 删除，形成与请求一致的完整生命周期
- **Part 2（执行链）**：quickjs 沙箱接入 `additionalContextRoots`，Safe Mode 下
  即可跨集合 require 公共脚本库，与 nodevm（Developer Mode）行为对齐

配套产出使用手册：`docs/js-script-guide_cn.md`。

## 2. 数据模型：type: 'js' 的语义决策

`type: 'js'` item 承载独立 `.js` 文件，与请求 item 的关键差异及**有意为之的后果**：

| 决策 | 内容 | 后果（接受） |
|---|---|---|
| **无 meta 块** | 文件是纯 JavaScript，不写 `meta { name }` 头 | 显示名 = 文件名（去 `.js`）。rename 防碰撞后缀 ` 1` 会**进显示名**（请求则保持 meta name、仅文件名加后缀）——e2e 用例已将该差异固化为断言 |
| **复用 request 的 uid 机制** | watcher 用 `hydrateRequestWithUuid`（= `getRequestUid(pathname)`）为 js 文件水合 uid，与 `.bru` 同表 | rename/delete 必须维护映射（`moveRequestUid`/`deleteRequestUid`），否则 tab 失效或 uid 泄漏 |
| **复用 `.bru` 事件通道** | watcher 为 `.js` 构造与 request 同构的 `{ meta, data }` 树事件，走同一个 `collectionAddFileEvent`/`collectionChangeFileEvent` reducer | renderer 侧对"文件出现/变更"**零新逻辑**；reducer 既有对 add/unlink 乱序的收敛（按 uid 原地更新）自动覆盖 js rename 场景 |
| **不参与搜索** | `flattenSidebarTree` 在 `hasSearch` 时隐藏 js 行（与 app 桶一致） | js 无请求元数据，搜索匹配无意义；代价是搜索时公共库不可见 |

不改动任何 on-disk DSL：`.js` 就是普通文本文件，`bruno.json`/`opencollection.yml`
仅需承载已存在的 `scripts.additionalContextRoots`（yml 格式经
`extensions.bruno.scripts` 归一化，`bruno-schema` 无需新字段）。

## 3. 创建链路

```
右键集合行 / 文件夹行 → New JS Script modal（Sidebar/NewJsScript/）
  → newJsScript thunk（slices/collections/actions.js）
      解析父目录（itemUid → 文件夹自身 / 集合根）
      fullName = path.join(parentDir, sanitizeName(scriptName))
      → IPC renderer:new-js-script(fullName, '// New JS Script\n')
  → 主进程 writeFileUnique（wx 原子写，防碰撞自动 " 1" 后缀）
  → watcher add 事件 → buildJsFileEvent → main:collection-tree-updated
  → reducer collectionAddFileEvent 入树
  → tasks middleware 匹配 OPEN_REQUEST → 自动开 tab（不乐观开 tab）
```

设计要点：

- **初始模板** `// New JS Script\n` 常量在 thunk 侧定义，IPC 只负责写文件
- **文件名校验在 IPC 边界再做一次**：`path.basename` 剥 `.js` 后走 `validateName`
  （preload 无 channel 白名单，handler 必须自校验）
- **`writeFileUnique` 而非直接 write**：与 new-request/new-folder 同机制，并发创建
  同名文件时落为 `xxx 1.js` 且 thunk 拿到实际创建路径开正确的 tab
- 菜单项两处挂载：`CollectionRow`（集合根）与 `CollectionItemRow` 的 folder 分支
  （`new-js-script`，图标 `IconFileCode`），与 New App 完全同构

## 4. 编辑与保存

- tab：`addTab({ uid, collectionUid, type: 'js', pathname })`；
  `RequestTabPanel` 在 `collection.fileMode || item.type === 'js'` 时渲染
  `FileEditor`（无请求面板，纯文件编辑器，editorMode `js → javascript` 复用既有映射）
- 保存：`RequestTab` 既有 `item.type === 'js' → saveFile` 分支（Ctrl+S）；autosave
  middleware 的 fileMode 条件扩为含 `item.type === 'js'`
- watcher `change` 事件对 js 走 `buildJsFileEvent(..., 'change')`，reducer upsert
  已存在 item 的 `raw`——外部编辑器修改同样回流

## 5. 重命名与删除（单文件通道）

JS Script 无 meta 块，rename 的"name 通道"对它无意义；文件名是唯一身份。修复前
两个通道都会失败（renderer 拼 `.bru` 扩展名；electron 侧 `hasRequestExtension`
拒绝 `.js`）。修复后的语义：

### renderer（actions.js `renameItem` thunk）

```js
if (item.type === 'folder') {
  newPath = path.join(dirname, trim(newFilename));
} else if (item.type === 'js') {
  newPath = path.join(dirname, `${trim(newFilename)}.js`);
} else {
  const filename = resolveRequestFilename(newFilename, collection.format);
  newPath = path.join(dirname, filename);
}
```

RenameCollectionItem modal 中改显示名时 formik 自动同步 filename，因此 js rename
实际总走 `renameFile` 通道；`rename-item-name` 通道对 js 是 no-op（见下）。

### electron（ipc/collection.js）

- `renderer:rename-item-name`：`.js` 提前 `return`——无 meta 块可改，显示名由
  filename 通道负责
- `renderer:rename-item-filename`：`isJsFile = extname(oldPath) === '.js'` 时
  `derivedFilename = newFilename + '.js'`，且走**纯文件移动**：
  `moveRequestUid(oldPath, newPath)` + `fs.promises.rename`——不 parse/stringify
  内容（js 文件不是 DSL，解析必然失败或损坏）
- `renderer:delete-item`：`'js'` 并入 request 类型分支（`deleteRequestUid` +
  `unlinkSync`）——修复前 js 落入 else 抛 `Unsupported item type for delete: js`
- `DeleteCollectionItems` 弹窗补 js 计数与标题（修复前单个 js 显示
  "Delete 0 Requests"）

### 收敛保证

rename 后 watcher 发 unlink(旧) + add(新) 事件，平台间到达顺序不定，两种顺序均
正确收敛：

- **add 先到**：uid 不变（`moveRequestUid` 保持映射），reducer 按 uid 找到现有项
  原地更新 name/filename/pathname；随后的 unlink(旧路径) 按 pathname 找不到项，自然跳过
- **unlink 先到**：旧项按 pathname 删除；add 到达后 push 新项（uid 相同，tab 不失效）

## 6. 脚本执行：require 与模块解析

**核心规则：相对路径以集合根为基准，不是脚本文件所在目录**（两种沙箱一致）。

解析顺序（quickjs `shims/local-module.js` 的 `resolveModuleCandidate`，与 nodevm
`cjs-loader` 的 `resolveLocalModulePath` 对齐）：

```
精确文件 → 补 .js → 目录（package.json main → index.js）
```

Part 2 之前 quickjs 只有"补 .js"一种解析，官方文档/bruno-tests 的目录形式
`require('../lib')` 在 Safe Mode 失败——目录解析补齐后两种沙箱行为一致。

嵌套 require：模块内部再 require 相对**当前模块目录**（quickjs 在 VM 工厂里以
`path.resolve(bru.cwd(), mod, '..', subModule)` 近似，nodevm 用 `currentModuleDir`）。

裸名（`require('axios')`）不走本地 loader：Safe Mode 解析到内置 shim 库
（`axios`/`uuid`/`nanoid`/`path`/`jsonwebtoken`），**不解析集合 node_modules**；
Developer Mode 由 Node 完整解析（npm 包可用）。这是两种模式的本质能力差异，
公共库的"零依赖层 / Node 依赖层"拆分策略据此而来（见使用手册案例二/三）。

## 7. 沙箱与 additionalContextRoots（Part 2）

### 传参链（此前 quickjs 分支不收 scriptingConfig）

四处调用点各加一行透传：`script-runtime.js`（runRequestScript/runResponseScript）、
`test-runtime.js`、`grpc-script-runtime.js` → `executeQuickJsVmAsync({ …, scriptingConfig })`
→ `addRequireShimToContext(vm, collectionPath, scriptingConfig)`。

electron/CLI 上层原本就传 scriptingConfig，无需改动。

### roots 解析与边界（shims/require.js + shims/local-module.js）

```js
// 与 node-vm/index.js 相同的解析规则
additionalContextRoots.map((root) =>
  path.normalize(path.isAbsolute(root) ? root : path.join(collectionPath, root)));
```

- loader 收 `allowedRoots` 数组，校验在**宿主侧**：`realpathSync` 集合根与候选文件
  双侧真实路径后，`isPathWithinAllowedRoots`（复用 `node-vm/utils.js`）遍历判定——
  符号链接指向 root 外的文件被拒
- **未配 ACR 时行为与文案逐字不变**：`OUTSIDE_COLLECTION_ERROR`
  （`Access to files outside of the collectionPath is not allowed.`）被既有
  `tests/local-module-boundary.spec.js` 断言，保持原样
- **配置 ACR 后越界**改用 nodevm 风格文案，列出全部 allowed roots 便于排查
- 配置来源：`bruno.json` 顶层 `scripts.additionalContextRoots`（yml 集合为
  `opencollection.yml` 的 `extensions.bruno.scripts.additionalContextRoots`，
  `parseCollection` 归一化）；UI 暂无配置界面，手动编辑文件

### 安全不变量

- 边界校验只在宿主侧；VM 端 `shims/require.js` 的工厂把 loader 作为参数闭包捕获，
  **loader handle 从不挂在 VM 全局**（`consume` 后即毁，既有
  quickjs-local-module-private.spec 继续约束）
- VM 只拿到模块**源码字符串**，在 VM 内重新编译——宿主不执行任何来自模块的代码
- `requireObject`（内置库表）与本地 loader 互不暴露：裸名查表、路径走 loader，
  两条路在 VM 源码里显式分流

## 8. 改动落点（实现清单）

| 包 / 文件 | 内容 |
|---|---|
| `bruno-app/src/components/Sidebar/NewJsScript/` | 新 modal（含 `index.spec.js`），formik 单字段 + submitLockRef，仿 NewApp |
| `bruno-app/.../CollectionRow/index.jsx`、`.../CollectionItemRow/index.jsx` | New JS Script 菜单项（集合 / 文件夹两处）+ modal 挂载 |
| `bruno-app/src/utils/collections/flattenSidebarTree.js` | `jsFiles` 桶（`sortByNameThenSequence`，搜索时隐藏），行 `id: ${collectionUid}:${jsFile.uid}` |
| `bruno-app/.../RequestTabPanel/index.js`、`RequestTab/index.js`、`middlewares/autosave/middleware.js` | js tab 渲染 / 保存 / 自动保存 |
| `bruno-app/.../RenameCollectionItem/index.js` | 扩展名角标 js 显示 `.js` |
| `bruno-app/.../DeleteCollectionItems/index.js` | js 计数与标题 |
| `bruno-app/src/providers/ReduxStore/slices/collections/actions.js` | `newJsScript` thunk；`renameItem` 的 js 分支 |
| `bruno-electron/src/ipc/collection.js` | `renderer:new-js-script`（writeFileUnique）；rename 两 handler 的 js 语义；`renderer:delete-item` js 分支 |
| `bruno-electron/src/app/collection-watcher.js` | `isJsFile`/`buildJsFileEvent`，add/change/unlink 三处 |
| `bruno-js/src/sandbox/quickjs/shims/require.js` | `resolveAllowedRoots`；工厂签名收 scriptingConfig |
| `bruno-js/src/sandbox/quickjs/shims/local-module.js` | allowedRoots 边界 + `resolveModuleCandidate` 目录解析 |
| `bruno-js/src/sandbox/{script-runtime,test-runtime,grpc}/…`、`quickjs/index.js` | scriptingConfig 透传（4+1 处） |

## 9. 测试策略与实际覆盖

1. **bruno-js 单元**：`tests/quickjs-local-module-roots.spec.js`（真实 QuickJS
   WASM + tmpdir）——ACR 相对/绝对路径、嵌套 require、目录 index.js 解析、越界拒绝
   （含 symlink 逃逸）、未配 ACR 的旧行为回归；既有 `local-module-boundary.spec.js`
   等全量通过
2. **bruno-app 组件单元**：`NewJsScript/index.spec.js`；`DeleteCollectionItems`
   既有 spec 回归
3. **e2e（Playwright，page-module 模式）**：
   - `tests/js-script/create.spec.ts`（集合根 / 文件夹内创建，watcher 异步用
     auto-retry 断言 + 磁盘存在性）
   - `tests/js-script/rename.spec.ts`（根 rename + tab 身份保持、文件夹内 rename、
     冲突后缀进显示名——js 与 request 的差异点）
   - `tests/js-script/delete.spec.ts`（sidebar/tab/磁盘三处消失）
   - `tests/scripting/additional-context-roots/`（workspace fixture：collectionA/B
     切 developer 模式走 npm 依赖层；collectionC 覆盖 developer 与默认 safe 两种
     模式，safe 用例走零依赖层）
4. **helper 扩展**：`ItemType` 增加 `'js'`、modal title `Rename JS Script`
   （`getItemTypeLabel` 既有映射）

**e2e 环境注**：playwright.config 的第一个 webServer 只有 stdout 探测（无
url/port），`reuseExistingServer` 无法复用遗留进程——遗留的 dev:web 会占住 3000
端口迫使新实例换端口，electron 加载到陈旧旧实例后白屏。跑 js-script e2e 前确保
3000/8081 无遗留监听；Windows 下 electron 冷启动偶发超 30s，必要时
`--timeout 90000`。

## 10. 范围边界（本期非目标）

- **additionalContextRoots 的 UI 配置界面**——手动编辑 bruno.json，二期
- **Safe Mode 下 require npm 包**——quickjs 裸名只解析内置库，属沙箱能力边界
  而非缺陷；依赖 npm 包的库须 Developer Mode
- **js 文件参与侧边栏搜索**——无请求元数据，搜索时隐藏（与 app 桶一致）
- **js 文件的 `.bru` 式元数据**（seq/tags/description）——文件即纯 JS，无 meta 块
  是既定语义
- **js item 的 Clone/Run**——菜单不提供（`isCloneable` 不含 js；js 非可执行请求）
- **nodevm 的 ACR**——已开源既有能力，本期未改动
