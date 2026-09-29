# 数据驱动测试使用指导（Data-Driven Testing）

Bruno 的 Collection Runner 支持数据驱动运行：从一份 CSV 或 JSON 数据文件读取行，**每行数据把选中的请求序列完整执行一遍**。请求中的 `{{变量}}` 与脚本里的 `bru.getData()` 会逐行取到不同的值，适合用同一组请求覆盖多组输入/预期组合。

本文覆盖桌面端（Collection Runner）与 CLI（`bru run --data`）两种用法。

---

## 目录

- [快速开始（桌面端）](#快速开始桌面端)
- [数据文件格式](#数据文件格式)
  - [CSV](#csv)
  - [JSON](#json)
- [在请求中使用数据行](#在请求中使用数据行)
- [变量优先级](#变量优先级)
- [Iteration 语义](#iteration-语义)
- [CLI 用法](#cli-用法)
- [错误处理](#错误处理)
- [常见问题](#常见问题)

---

## 快速开始（桌面端）

1. 在侧边栏集合上打开菜单，选择 **Run** 进入 Collection Runner。
2. 左侧配置面板找到 **Data** 区，点击 **Choose CSV/JSON file…** 选择数据文件。
3. 面板会解析并预览数据：显示文件名、总行数与前 50 行的表格。Run 按钮文案变为 `Run N Requests × M iterations`（M = 数据行数）。
4. 点击 Run。集合按数据行逐行迭代执行，结果区按 iteration 分组展示（`Iteration 1 / M`、`Iteration 2 / M`…），每组有独立的通过/跳过统计。
5. 点击任一结果行的状态码，可在右侧查看**该 iteration** 实际发出的请求与收到的响应。

选择的数据文件路径会保存在集合的运行配置中（app 级偏好，不写入任何 `.bru` 文件），下次打开 Runner 时仍然生效；点击 **Clear** 可清除。

> 预览只是展示；真正执行时主进程会重新读取并解析数据文件，因此运行前修改文件内容会生效。

---

## 数据文件格式

### CSV

- 第一行是**表头**，列名即变量名；之后每行一条数据。
- 遵循 RFC 4180：字段可用双引号包裹，引号内可以包含逗号与换行；引号内的 `"` 用两个 `""` 转义。
- 行分隔符支持 CRLF / LF / CR；完全空白的行被忽略。

```csv
username,password,expected_status
alice,secret-a,200
bob,"secret,b",200
carol,"say ""hi""",200
```

上面第一行数据执行时，`{{username}}` 为 `alice`、`{{password}}` 为 `secret-a`。

### JSON

JSON 文件必须是**对象数组**，每个对象是一条数据行，键名即变量名：

```json
[
  { "username": "alice", "expected_status": 200 },
  { "username": "bob", "expected_status": 200 }
]
```

数组元素必须是对象（不能是数字、字符串、数组等）；否则解析报错。

两种格式都只接受 `.csv` / `.json` 扩展名。列值一律作为**字符串**处理（JSON 中保留了类型的值除外），如需数字请在脚本里自行转换。

---

## 在请求中使用数据行

**方式一：`{{变量}}` 插值** —— 与环境变量用法相同，可用于 URL、查询参数、Header、请求体（JSON/表单等）任何支持插值的位置：

```
body:json {
  {
    "username": "{{username}}"
  }
}
```

**方式二：脚本 API** —— pre-request / post-response / test 脚本中通过 `bru` 对象访问当前行：

| API | 说明 |
| --- | --- |
| `bru.getData(key)` | 当前数据行中 `key` 列的值 |
| `bru.getAllData()` | 当前整行数据对象（副本） |
| `bru.getIteration()` | 当前 iteration 序号，**1-based**；非数据驱动运行时为 `null` |
| `bru.getIterationCount()` | 数据总行数；非数据驱动运行时为 `null` |

配合 test 断言（断言风格为 Chai）：

```js
tests {
  test('request body carries the data row', () => {
    expect(res.body.username).to.equal(bru.getData('username'));
    expect(res.status).to.equal(Number(bru.getData('expected_status')));
    console.log(`iteration ${bru.getIteration()} / ${bru.getIterationCount()}`);
  });
}
```

> 脚本里对 `bru.getData()` 返回值做的修改不会写回数据文件；数据行在本次运行中是只读的。

---

## 变量优先级

数据变量加入既有变量链，位置固定（从低到高）：

```
globalEnv < collection < env < folder < request < oauth2 < data < runtime < prompt
```

要点：

- **data 高于环境变量**：同名时数据行的值覆盖 collection/env 变量 —— 可以用环境变量给"默认值"，数据文件按行覆盖。
- **runtime 变量高于 data**：脚本里 `bru.setVar()` 写入的值在该次请求内优先于数据行。
- 数据变量只在数据驱动运行中存在，普通运行不受影响。

---

## Iteration 语义

数据驱动运行 = 外层按数据行循环，内层按选中的请求顺序执行。每次 iteration 开始时：

- **runtime 变量重置**：恢复到本次运行开始时的状态。前一行脚本里 `setVar` 的值不会泄漏到下一行。
- **环境变量持续**：前一行脚本里 `setEnvVar` / `setCollectionVar` 等写入的值会带入后续 iteration（用于"第一行登录、后续行复用 token"这类场景）。
- 请求序列、delay、tags 等运行配置对所有 iteration 相同。

控制流的边界：

- `bru.setNextRequest(null)` 只结束**当前 iteration** 的请求序列，下一行数据仍会从头执行。
- `stopExecution`（脚本）与 CLI `--bail` 会结束**整个运行**，后续 iteration 不再执行。

对外展示（结果分组、`bru.getIteration()`、报告里的 iteration 字段）一律 **1-based**。

---

## CLI 用法

```bash
# 整个集合按 users.csv 每行跑一遍
bru run --data users.csv

# 组合其他选项
bru run folder -r --data users.csv --env local --reporter-json report.json --bail
```

- `--data` 路径相对**集合根目录**（当前工作目录）解析，也可以用绝对路径；仅接受 `.csv` / `.json`。
- 运行前会先完整解析数据文件，解析失败或没有数据行时**在任何请求发出之前**退出。
- 报告输出：
  - JSON reporter：每条结果带 `iteration` 字段（1-based），`suitename` 后缀 ` [iteration N]`；
  - HTML reporter：每个 iteration 渲染独立的结果块与汇总；
  - JUnit reporter：依赖上述 suitename 后缀区分各 iteration 的用例。
- 退出码：数据文件不存在为 `5`；扩展名不支持、解析错误、无数据行为 `10`。

---

## 错误处理

| 场景 | 桌面端 | CLI |
| --- | --- | --- |
| 文件不存在 | 选择文件由系统对话框保证；路径失效时 Data 面板显示读取错误 | `Data file not found`，退出码 5 |
| 扩展名不支持 | 对话框已按 `csv/json` 过滤 | `Unsupported data file extension`，退出码 10 |
| 解析错误（如 CSV 未闭合引号、JSON 非对象数组） | Data 面板显示 `Line N: <原因>`，**Run 按钮禁用**，不执行任何请求 | `Data file has errors: line N: <原因>`，退出码 10 |
| 文件没有数据行 | 面板显示 `Data file contains no data rows`，Run 按钮禁用 | `Data file contains no data rows`，退出码 10 |

---

## 常见问题

**数据行和请求级变量同名，谁生效？**
数据行优先（data 层高于 request 变量），低于 runtime 变量。完整优先级见上文。

**一行数据中途失败了，后面的行还会跑吗？**
会。默认每行独立执行，某行的请求失败/测试失败不影响后续 iteration。使用 CLI `--bail` 时首个失败即停止整个运行。

**数据文件需要放进集合目录吗？**
不需要。桌面端任选任意路径的文件即可；CLI 的 `--data` 路径相对集合根目录解析。文件本身不会被修改，也不参与集合的版本管理约定（`.bru` 文件格式没有任何变化）。

**想在两行之间传递状态怎么办？**
用环境变量或集合变量（`bru.setEnvVar` / `bru.setCollectionVar`）传递 —— 它们跨 iteration 持续；runtime 变量（`bru.setVar`）每行开始时会被重置。

---

## 参考

- 设计规格：`docs/superpowers/specs/2026-09-15-data-driven-testing-design.md`
- 实现计划：`docs/superpowers/plans/2026-09-15-data-driven-testing.md`
- 端到端用例（含完整 fixture 示例）：`tests/runner/data-driven/`
- CLI 集成测试：`packages/bruno-cli/tests/data-driven/run.spec.js`
