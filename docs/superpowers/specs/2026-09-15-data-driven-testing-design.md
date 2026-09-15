# 数据驱动测试（Data-Driven Testing）设计

日期：2026-09-15
状态：已与用户逐节评审通过，待实现

## 1. 背景与目标

Bruno 的 Collection Runner 目前一次运行只用一套变量值跑一遍选中的请求序列。测试同一个接口的多种输入（不同账号、不同关键词、不同边界数据）时，用户只能建多套环境或复制请求链，期望值硬编码在各断言里，难以维护，也无法在 CI 中按数据行扩展。

本功能在 Collection Runner 上扩展数据驱动能力：

- 从外部 **CSV / JSON 文件** 加载 N 行测试数据
- 每个 **iteration** 用一行数据完整跑一遍选中的请求序列（Postman Runner 模式：顺序依赖的请求链必须整链跑完再换下一行）
- 数据行通过**双通道**注入：`{{var}}` 插值（URL/params/headers/body/断言值）+ 脚本 API（`bru.getData()` 等，断言期望值的主通道）
- **GUI 与 CLI 同步支持**（`bru run --data <path>`），CI 直接产出带 iteration 维度的报告
- 运行配置存 **app 级状态**（现有 `runnerConfiguration` 机制），不做任何 on-disk DSL 变更

## 2. 核心使用场景：一套用例，两种模式

请求中的 `{{var}}` 引用不关心变量来自哪一层，只按名字解析。两种模式的差别只在"有没有数据行参与"：

| 模式 | `{{username}}` 解析结果 |
|---|---|
| 单次 Send（请求编辑器直接发） | 从现有变量层取：request vars → folder → env → collection（任何一层均可提供默认值） |
| Runner + 数据文件 | 数据行的值覆盖上述所有层（data 层优先级更高），逐行注入 |

推荐工作流：

1. 在 request vars（或调试用环境）里放单发默认值：`username: alice`、`keyword: ali`、`expectedCount: 1`
2. 数据文件列名与这些变量**同名**
3. 请求、body、断言只写一次 `{{var}}` / `bru.getData(var)`
4. 平时单发调试走默认值；Runner run 时数据行自动接管

脚本侧兼容写法（`bru.getData()` 单发时返回 `undefined`）：

```js
var expected = bru.getData('expectedCount');
if (expected !== undefined) {
  test('返回条数符合数据行预期', function() {
    expect(res.getBody().total).to.equal(Number(expected));
  });
}
```

单发时若哪层都未定义，`{{var}}` 按现有插值行为保留字面量——与今天任何未定义变量的行为一致，不是本功能引入的新问题。

## 3. 端到端示例（评审时确认的效果）

数据文件 `testdata.csv`（放 collection 旁边，进 Git）：

```csv
username,password,keyword,expectedCount,expectLoginOk
alice,Passw0rd!,ali,1,true
bob,wrongpass,,,false
charlie,Passw0rd!,,5,true
```

请求 1 `login` — `POST {{baseUrl}}/api/login`，JSON body：

```json
{ "username": "{{username}}", "password": "{{password}}" }
```

post-response 脚本：

```js
var body = res.getBody();
bru.setVar('token', body.token);   // runtime 变量，每个 iteration 自动重置

test('登录结果与数据行预期一致', function() {
  expect(body.success).to.eql(bru.getData('expectLoginOk') === 'true');
});
```

请求 2 `查询列表` — `GET {{baseUrl}}/api/users?keyword={{keyword}}`，Header `Authorization: Bearer {{token}}`。

pre-request 脚本（bob 行预期登录失败，跳过后续请求）：

```js
if (bru.getData('expectLoginOk') === 'false') {
  bru.runner.skipRequest();        // 复用现有 skip 机制
}
```

test 脚本：

```js
test('返回条数符合数据行预期', function() {
  expect(res.getBody().total).to.equal(Number(bru.getData('expectedCount')));
});
```

Runner 执行 3 iteration × 2 请求 = 6 次请求，结果按 iteration 分组：

```
Iteration 1/3  ●●
  POST /api/login   200  ✓ 登录结果与数据行预期一致     ← {{username}}=alice, token 存入 runtime
  GET  /api/users   200  ✓ 返回条数符合数据行预期       ← keyword=ali, total=1
Iteration 2/3  ●○
  POST /api/login   401  ✓ 登录结果与数据行预期一致     ← 预期失败且确实失败，测试通过
  GET  /api/users    —   skipped                       ← pre-request 里 skipRequest
Iteration 3/3  ●●
  POST /api/login   200  ✓
  GET  /api/users   200  ✓                             ← total=5
```

该示例验证的三个关键机制：runtime 每 iteration 重置（iteration 2 的 token 不串 iteration 1）、双通道注入、skipRequest 复用。

CLI：

```bash
bru run ./user-collection --data ./testdata.csv --env testing --reporter-junit report.xml
```

CSV 值一律为字符串（`'true'`、`Number(...)` 转换）；JSON 数据文件保留原始类型，断言可直接 `to.eql(true)` / `to.equal(1)`。

## 4. 数据文件格式

- **CSV**：RFC 4180（引号转义、字段内逗号/换行），CRLF-aware（按 cross-platform 规则用 `/\r\n|\r|\n/` 分行），首行为表头，每行数据成为 `{ 表头: 值 }` 对象，值一律为字符串。**空字段值为空字符串 `''`**（注意 `Number('')` 为 `0`，脚本侧自行转换）；行内**缺失的列**才是 `undefined`——两者语义不同
- **JSON**：对象数组 `[ {...}, {...} ]`，值保留原始 JSON 类型；对象/数组值在 `{{var}}` 插值时序列化为字符串（与现有 runtimeVariables 对象值行为一致）
- 统一入口 `parseDataFile(content)` → `{ rows, errors }`，**纯 JS 零依赖**实现，放 `bruno-common`（CLI 与 Electron 主进程复用；GUI 预览经 IPC 取主进程解析结果，renderer 不解析）。bruno-common 保持零运行时依赖红线
- 表头不做变量名强校验（如 `user id` 带空格）：`bru.getData('user id')` 按字面 key 可取；插值引用需合法变量名字符集（文档提示）

## 5. 执行模型

Electron 主进程 `run-collection-folder` handler（`packages/bruno-electron/src/ipc/network/index.js`）中，现有请求 while 循环外面套一层 iteration 循环：

```
for (iterationIndex = 0 .. rows.length - 1)      ← 新增外层
  恢复 runtimeVariables = run 启动时快照          ← 每个 iteration 开始时重置
  while (currentRequestIndex < folderRequests)    ← 现有内层，不动
    发请求（插值链中注入当前行 dataVars）
```

关键语义决策：

1. **runtimeVariables 每 iteration 重置**为 run 启动时的快照。否则第 1 行 `bru.setVar('token', ...)` 污染第 2 行；典型链路（login → setVar token → 用 token）每轮重新登录，正确。
2. **环境变量跨 iteration 持续**（保持现有跨请求持续语义不动）。env 变更牵涉 GUI 同步与磁盘写入，重置影响面大。**已知边界**：测试链路若用 `setEnvVar` 传递状态，iteration 间会串；应改用 runtime var 或 data var。"iteration 间内存态重置 env"留作二期选项。
3. `bru.runner.setNextRequest` 跳转只在当前 iteration 内生效；`bru.runner.stopExecution` 停掉整个 run（含后续 iteration，沿用现有 `stopRunnerExecution` 机制）。
4. 请求间 delay 同样应用于 iteration 之间；取消（AbortController）在两层循环每圈检查。
5. 每个 iteration 的 requestUid 均为新生成的 uuid——现有 sqlite runner-exchange 存储（按 uid upsert）天然隔离，无需改动。
6. **快照语义**：run 启动时一次性读入数据文件，启动后文件被外部修改/删除不影响本次 run。

## 6. 变量优先级与注入点

新数据层插入优先级链（低 → 高）：

```
globalEnv < collection < env < folder < request < oauth2 【data（新）】 runtime < prompt
```

- data 高于 folder/request：数据驱动语义即"同环境下喂不同数据"，数据行是最具体的输入层
- data 低于 runtime：脚本 `bru.setVar` 可显式覆盖——"数据行给默认值、脚本按需覆盖"的工作流

需要同步修改的插值链镜像（当前是同一优先级链的多个副本）：

- `packages/bruno-electron/src/ipc/network/interpolate-vars.js`（GUI 主进程插值）
- `packages/bruno-cli/src/runner/interpolate-vars.js`（CLI 插值，独立副本）
- `packages/bruno-js/src/bru.js` 的 `interpolate()`（脚本内 bru.interpolate 插值）

三处均以**可选参数、默认空对象**扩展——无数据时行为与今天完全一致，现有调用零改动。

声明式断言（Assertions 面板）的期望值若写 `{{expectedCount}}`，因走统一插值链同样自动吃到数据行。

## 7. 脚本 API（bruno-js）

`Bru` 类新增四个方法，沿用现有平铺风格：

| API | 返回 | 说明 |
|---|---|---|
| `bru.getData(key)` | 当前行该字段的值，不存在则 `undefined` | 单字段访问 |
| `bru.getAllData()` | 当前行对象的浅拷贝 | 整行访问；浅拷贝与 `getAllEnvVars()` 等一致 |
| `bru.getIteration()` | 当前 iteration 编号（**1-based**）或 `null` | 与事件字段、UI 显示统一 1-based |
| `bru.getIterationCount()` | 总行数或 `null` | 进度感知 |

无数据时的行为（空数据语义，不是报错）：

- `bru.getData(key)` / `bru.getAllData()` → `undefined`
- `bru.getIteration()` / `bru.getIterationCount()` → `null`

现有集合脚本不受影响；脚本可用 `bru.getIterationCount()` 是否为 `null` 判断是否处于数据驱动运行中。

**只读语义（有意设计）**：没有 `setData`。数据行是本轮迭代的只读输入；运行中覆盖值用 `bru.setVar`（runtime 层优先级更高）。

传递链路：`Bru` 构造函数新增两个选项（与现有 `envVariables`/`promptVariables` 并列）：

```
{ dataVariables: {…当前行}, iterationInfo: { index, count } | null }
```

传入三个 runtime（Electron 与 CLI 调用方各自同步）：

- `ScriptRuntime`（pre-request / post-response 脚本）
- `TestRuntime`（test 脚本）——断言期望值场景的主用户
- `AssertRuntime`（声明式断言）

QuickJS 与 node:vm 两个沙箱的 bru 上下文注入同步扩展（实现时验证 marshal 层对纯数据对象无特殊处理需求）。

脚本侧组合能力均由现有机制承载，无需新增：条件跳过 `bru.runner.skipRequest()`、终止全部 `bru.runner.stopExecution()`、链内跳转 `bru.runner.setNextRequest(name)`（限当前 iteration 内）。

## 8. GUI 设计

### DataFilePanel（新组件，遵循组件目录规则）

放 `RunnerResults` 运行配置区（与 tags / delay 同区），`RunConfigurationPanel` 不动：

- **选择文件**：文件对话框 → 新 IPC `renderer:read-data-file` → 主进程读取并 `parseDataFile` 解析 → 返回 `{ rows, errors }`
- **预览**：只读表格，列头即变量名；超过 50 行截断显示 + "共 N 行"
- **错误处理**：文件不存在 / 格式错 → 预览区显示带行号错误，**Run 按钮禁用**（路径保留，方便修好重试）
- **清除**：移除数据文件，回到普通 run 模式（单 iteration）
- 持久化：`runnerConfiguration.dataFilePath`，与 `requestItemsOrder` 同机制（会话级 Redux 状态，重启后重选）

### 结果视图：按 iteration 分组

仅数据驱动 run 时，`RunnerResults` 从平铺列表改为分组列表（分组头含本组统计）；非数据驱动 run 渲染路径与今天完全一致。

- All/Passed/Failed/Skipped 过滤器保留，跨 iteration 作用于全部 items
- 详情面板（ResponsePane）不变——sqlite 存储按 requestUid 隔离
- 运行中顶部进度显示 `Iteration 2/3`（由 `testrun-started` 的 `iterationCount` + 当前事件推导）

### 事件流与 Redux

- `main:run-folder-event` 所有请求级事件统一附加 `iteration`（1-based）；`testrun-started` 附加 `iterationCount`、`dataFilePath`
- 不新增独立 iteration-started/completed 事件——分组边界由 items 的 `iteration` 字段推导（YAGNI）
- Redux：`runnerResult.info` 增加 `iterationCount`/`dataFilePath`；`items[]` 每项增加 `iteration`；`updateRunnerConfiguration` 存 `dataFilePath`；`runCollectionFolder` thunk 签名扩展透传给 IPC

### 改动落点

| 位置 | 改动 |
|---|---|
| `RunnerResults/DataFilePanel/` | 新组件：选择/预览/错误/清除，含 StyledWrapper 与 `data-testid` |
| `RunnerResults/index.jsx` | 分组渲染 + run 调用传 `dataFilePath` |
| Redux `collections` slice | thunk 扩展、reducer 落 `iteration` / `dataFilePath` |
| `bruno-electron/src/ipc/` | 新 handler `renderer:read-data-file`（命名导出、可单测） |

大行数（如 1000 行）渲染压力与现状平铺列表同量级，第一版不引入虚拟化（与现有行为持平，不倒退）。

## 9. CLI（bruno-cli）

- 新参数 `--data <path>`，路径解析规则与现有 `--env-file` 一致
- `commands/run.js` 请求 while 循环外套同构 iteration 循环；`runSingleRequest` 收到当前行 + iteration 信息
- CLI 的 `interpolate-vars.js` 副本同步加 data 层
- 单请求 + `--data` 自然支持（1 请求 × N 行）
- **报告**：json 每条 result 加 `iteration` 字段；junit suite 名加 `[iteration N]` 后缀、html 表格加 iteration 列（均仅数据驱动时）；`getRunnerSummary` 总统计跨 iteration 聚合
- `--data` 文件不存在/解析失败：**跑任何请求之前**报错退出（非零码）

## 10. 错误处理汇总

| 场景 | GUI | CLI |
|---|---|---|
| 文件不存在 / 不可读 | 预览区报错 + Run 禁用，路径保留 | stderr 报错，退出 |
| CSV 引号未闭合等格式错 | 预览区报错带行号 + Run 禁用 | 报错退出 |
| JSON 非数组 / 元素非对象 | 同上 | 同上 |
| 空文件 / 只有表头（0 行） | 显示 0 行 + Run 禁用 | 报错退出 |
| 行内列数不一致 | 宽容解析（缺失列 `undefined`，预览可见） | 同 |
| run 中请求失败 | 记录错误继续下一请求/iteration（现有语义） | 同 |
| 取消 | 现有 AbortController，两层循环均检查 | Ctrl-C 现有处理 |

## 11. 测试策略

1. **bruno-common 单元**：`parseDataFile` 的 RFC 4180 边界——引号转义、字段内逗号/换行、CRLF、BOM、空行、列数不一致；JSON 类型保留与非法输入
2. **bruno-js 单元**：四个新 API 的空数据语义；`bru.interpolate` 的 data 层优先级
3. **插值回归（两份镜像 spec 同步加用例）**：`bruno-electron/tests/network/interpolate-vars.spec.js` + `bruno-cli/tests/runner/interpolate-vars.spec.js`——data 覆盖 env/folder/request、runtime 覆盖 data、无 data 时行为与今天完全一致
4. **electron runner 单元**：现有 runner spec 模式下验证 iteration 循环——顺序、runtime 每 iteration 重置、事件带 `iteration`、`stopExecution` 跨 iteration 生效、iteration 间应用 delay
5. **CLI 集成**：fixture collection + CSV 对 bruno-tests 的 express 服务器跑 N×M，断言报告含 iteration、失败定位到行
6. **e2e（Playwright，用 write-e2e-test skill）**：选数据文件 → 预览 → run → 分组结果 → 失败过滤 → 详情查看

## 12. 实现顺序建议（供实现计划参考）

1. `bruno-common`：`parseDataFile`（纯函数，独立可测）
2. `bruno-js`：`Bru` 扩展 + 三个 runtime 传参
3. `bruno-electron`：`interpolateVars` data 层 + `run-collection-folder` iteration 循环 + `renderer:read-data-file` IPC
4. `bruno-cli`：`interpolate-vars` 镜像 + `--data` + 报告
5. `bruno-app`：DataFilePanel + 分组结果 + Redux
6. e2e + 回归

## 13. 范围边界（本期非目标）

- 数据集库、行级勾选、内联编辑（二期"数据集库"）
- 任何 on-disk DSL 变更（数据文件不进 `.bru`/`.yml`）
- env 变量的 iteration 间重置（已知边界，二期选项）
- 请求编辑器内的单发数据文件快捷运行（双模式由 request vars 默认值达成）
- WS/gRPC 请求（runner 本身不支持，沿用现有跳过行为）
