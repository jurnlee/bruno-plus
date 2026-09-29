# JS Script(JS 脚本)使用手册

JS Script 是集合里的**独立 `.js` 文件**,用来承载可复用的公共代码——工具函数、签名/加密
逻辑、造数器、断言辅助等。它在请求的 Scripts(Scripts: Pre Request / Post Response)、
Tests、Assertions 等脚本执行环境中通过 `require()` 引用;**文件本身不会自动执行**,
只有被 `require` 时才会运行并导出。

侧边栏中 JS Script 与请求、文件夹并列显示;它的显示名就是文件名(去 `.js` 扩展名),
文件内容是纯 JavaScript,没有 `meta` 头块——这一点与 `.bru` 请求文件不同。

---

## 目录

1. [创建、编辑、重命名、删除](#1-创建编辑重命名删除)
2. [在脚本中 require:路径规则](#2-在脚本中-require路径规则)
3. [沙箱模式:Safe 与 Developer](#3-沙箱模式safe-与-developer)
4. [公共脚本库:构建与使用(核心案例)](#4-公共脚本库构建与使用)
5. [安全模型与边界](#5-安全模型与边界)
6. [CLI 中的行为](#6-cli-中的行为)
7. [常见问题(FAQ)](#7-常见问题faq)

---

## 1. 创建、编辑、重命名、删除

### 创建

- 右键**集合行**或**文件夹行** → **New JS Script**
- 输入名称提交后:
  - 磁盘上创建 `<名称>.js`,初始内容为 `// New JS Script`
  - 文件监听器(watcher)感知后,侧边栏自动出现该条目(无需刷新)
  - 编辑器 tab 自动打开

命名规则与请求一致(禁止保留名 `collection` / `folder`、Windows 保留设备名等)。
若同名文件已存在,会自动落为 `<名称> 1.js`、`<名称> 2.js`(与请求的防碰撞行为相同)。

### 编辑

点击侧边栏条目打开 tab,即为纯文件编辑器(没有请求面板)。默认自动保存开启时
(Preferences → autoSave)改动自动落盘;也可 `Ctrl+S` 手动保存。改动同样会被
watcher 感知,`require` 该文件的请求**下一次执行**时取到最新代码——不需要重启应用。

### 重命名

右键条目 → **Rename**。JS Script 没有独立的显示名,对话框里改名字就是改文件名
(高级选项里可单独查看/编辑文件系统名,扩展名固定为 `.js`)。

> 注意:与请求不同,JS Script 的防碰撞后缀会**直接进显示名**——重命名为已存在的
> `signin` 时,磁盘与侧边栏都会是 `signin 1`(请求则保持显示名 `signin`、仅文件名
> 加后缀)。重命名后 tab 身份保持不变,不会出现重复 tab。

### 删除

右键条目 → **Delete** → 确认。侧边栏条目、打开的 tab、磁盘文件一并移除。

---

## 2. 在脚本中 require:路径规则

**最重要的规则:相对路径以集合根为基准,不是脚本所在目录。**

```
my-collection/
├── bruno.json
├── scripts/
│   └── format-date.js
└── api/
    └── login.bru
```

在**任意**请求的脚本里(包括子文件夹 `api/` 下的),都这样引用:

```javascript
// Scripts: Pre Request 或 Tests 中
const { formatDate } = require('./scripts/format-date');   // = 集合根/scripts/format-date.js

bru.setVar('today', formatDate(new Date()));
```

补充规则:

| 写法 | 解析 |
|---|---|
| `require('./x')` | 集合根下 `x.js`(精确名 → 补 `.js` → 目录,见下) |
| `require('../shared/x')` | 相对集合根向上走出仍受边界约束(见 [安全模型](#5-安全模型与边界)) |
| 嵌套 require(模块内部再 require) | 相对**当前模块所在目录**,与 Node 习惯一致 |
| `require('axios')` 等裸名 | 走内置库或 npm 包,取决于沙箱模式(见下节) |

**目录形式模块**:目标可以是目录,解析顺序为精确文件 → 补 `.js` → 目录下的
`package.json` 的 `main` 字段 → 目录下的 `index.js`。Safe 与 Developer 两种模式
均支持,可以按 Node 包的形式组织库:

```
scripts/
├── my-utils/
│   ├── package.json      // { "main": "lib/main.js" }
│   └── lib/main.js
└── (或省略 package.json,直接放 index.js)
```

```javascript
const { something } = require('./scripts/my-utils');   // 解析到 my-utils/lib/main.js 或 index.js
```

---

## 3. 沙箱模式:Safe 与 Developer

每个集合有独立的 JavaScript Sandbox 设置(集合 tab 顶部工具栏的盾牌/代码图标
选择器,持久化在集合的安全配置里),两种模式下 `require` 的能力不同:

| 能力 | Safe Mode(默认,QuickJS) | Developer Mode(Node VM) |
|---|---|---|
| require 集合内 JS Script | ✅ | ✅ |
| require additionalContextRoots 内文件 | ✅ | ✅ |
| 目录形式模块(`index.js` / package.json main) | ✅ | ✅ |
| require npm 包(集合 `node_modules`) | ❌(裸名只解析内置库) | ✅ |
| 内置库(`axios` `uuid` `nanoid` `path` `jsonwebtoken` 等) | ✅(内置 shim) | ✅ |
| 访问 fs / 系统 | ❌ | ✅(完整 Node 能力,谨慎) |

**给公共库作者的结论:**

- 库要做到 **Safe Mode 可用**,必须**零 npm 依赖**(只用语言内置 + Bruno 内置库),
  并避免依赖 QuickJS 不支持的 Node API(如 `fs`、`Buffer` 的部分能力)。
- 库依赖 npm 包时,只有 Developer Mode 的集合能 require 它;Safe Mode 集合会在
  require 链上失败。团队里两种模式混用时,建议把"零依赖层"与"Node 依赖层"拆成
  两个文件/目录,按集合模式选用(见案例二)。

---

## 4. 公共脚本库:构建与使用

以下案例均可在本仓库 e2e fixtures 中找到可运行的对应物
(`tests/scripting/additional-context-roots/fixtures/workspace/`)。

### 案例一:单集合内的公共脚本(入门)

一个集合内多个请求共享工具函数——不需要任何配置,建文件、require、用:

```
my-collection/
├── scripts/
│   └── format-date.js
└── api/login.bru
```

`scripts/format-date.js`:

```javascript
function formatDate(input) {
  return new Date(input).toISOString().slice(0, 10);
}

module.exports = { formatDate };
```

任意请求的 Scripts: Pre Request:

```javascript
const { formatDate } = require('./scripts/format-date');

bru.setVar('startDate', formatDate('2024-06-15T12:00:00Z'));
// 后续 URL / body / 断言里通过 {{startDate}} 使用
```

### 案例二:跨集合共享库(additionalContextRoots,推荐布局)

多个集合共用一套脚本时,把库放到集合**外**的独立目录,再在需要它的集合里通过
bruno.json 的 `scripts.additionalContextRoots` 授权访问:

```
api-workspace/
├── shared-scripts/                  ← 公共脚本库(不是集合,无需 bruno.json)
│   ├── format-date.js               ← 零依赖:Safe/Developer 通用
│   ├── utils.js                     ← 依赖 npm 包:仅 Developer 可用
│   ├── deep/
│   │   └── nested/nested-helper.js  ← 支持嵌套目录与嵌套 require
│   └── node_modules/
│       └── signature-utils/         ← 库自带的 npm 依赖(Developer 模式解析)
└── collections/
    ├── collection-a/
    │   └── bruno.json               ← 在这里声明 additionalContextRoots
    └── collection-b/
        └── bruno.json
```

`collections/collection-a/bruno.json`:

```json
{
  "version": "1",
  "name": "Collection A",
  "type": "collection",
  "ignore": ["node_modules", ".git"],
  "scripts": {
    "additionalContextRoots": ["../../shared-scripts"]
  }
}
```

要点:

- 路径**相对于集合根**解析,也支持绝对路径;数组可声明多个 root。
- 本例中集合在 `collections/collection-a`,库在 `workspace/shared-scripts`,
  所以是 `../../shared-scripts`。
- UI 暂无配置界面,需手动编辑 `bruno.json`(集合为 OpenCollection `.yml` 格式时,
  写在 `opencollection.yml` 的 `extensions.bruno.scripts.additionalContextRoots`)。
- 该配置在**脚本执行时**读取;若编辑后未生效,重新发送请求或重新打开集合即可。

`shared-scripts/format-date.js`(零依赖层——Safe Mode 集合引用这个):

```javascript
// 无 npm 依赖,QuickJS(safe)与 Node VM(developer)均可加载
function formatDate(input) {
  return new Date(input).toISOString().slice(0, 10);
}

module.exports = { formatDate };
```

`collection-a` 的请求里引用(路径仍以**集合根**为基准写出):

```javascript
// Scripts: Pre Request
const { formatDate } = require('../../shared-scripts/format-date');

bru.setVar('formattedDate', formatDate('2024-03-15T10:30:00Z'));
```

Tests 中断言:

```javascript
test('shared lib loaded', function() {
  expect(bru.getVar('formattedDate')).to.eql('2024-03-15');
});
```

`collection-b` 做同样配置后引用同一份文件——**一处维护,多集合生效**;库文件随
workspace 一起进 git,与业务集合独立演进。

### 案例三:带 npm 依赖的共享库(Developer Mode)

库自身需要 npm 包时,把依赖放进库目录的 `node_modules`(或直接使用 monorepo 提升),
只有沙箱为 Developer Mode 的集合能加载它:

`shared-scripts/utils.js`:

```javascript
const { computeChecksum } = require('signature-utils');   // 裸名:Node VM 解析 node_modules

function generateAuthToken({ apiKey, timestamp }) {
  return `${apiKey}.${timestamp}.${computeChecksum(`${apiKey}:${timestamp}`)}`;
}

module.exports = { generateAuthToken };
```

`shared-scripts/node_modules/signature-utils/index.js`(示意,真实场景用 npm 安装):

```javascript
function computeChecksum(input) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash ^ input.charCodeAt(i)) * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

module.exports = { computeChecksum };
```

Developer Mode 集合的请求脚本:

```javascript
const { generateAuthToken } = require('../../shared-scripts/utils');

bru.setVar('authToken', generateAuthToken({ apiKey: 'k1', timestamp: 1700000000 }));
```

同一集合若切回 Safe Mode,该 require 会失败(`Cannot find module 'signature-utils'`)
——这正是案例二建议"零依赖层与 Node 依赖层分文件"的原因:`format-date.js` 任何
模式都能加载,`utils.js` 只给 Developer 集合用。

### 嵌套 require 与目录形式(库内部组织)

库内部可以自由组织,模块间的 require 相对**当前模块目录**解析:

`shared-scripts/deep/nested/nested-helper.js`:

```javascript
const { computeChecksum } = require('signature-utils');   // 相对本模块向上找 node_modules(developer)

function buildRequestId(endpoint, method = 'GET') {
  const slug = endpoint.replace(/[^a-z0-9]/gi, '_');
  return `${method}_${slug}_${computeChecksum(`${method} ${endpoint}`)}`;
}

module.exports = { buildRequestId };
```

也可以做成目录入口(`shared-scripts/geo/index.js`),调用方 `require('../../shared-scripts/geo')`。

---

## 5. 安全模型与边界

- **默认边界 = 集合根**。未配置 additionalContextRoots 时,require 到集合外的文件
  一律拒绝,报错:
  `Access to files outside of the collectionPath is not allowed.`
- **配置后边界 = 集合根 + 全部 additionalContextRoots**。越界报错会列出当前允许的
  roots,便于排查路径写错:
  `Access to files outside of the allowed context roots is not allowed: <模块名>`,
  后附 `Allowed context roots:` 列表。
- **符号链接不构成逃逸**:边界校验在 realpath(resolve 真实路径)之后进行,把
  root 内的软链接指向外部文件同样会被拒绝。
- **Safe Mode 下加载器不进沙箱**:脚本拿到的是模块源码字符串;宿主侧的 loader
  句柄不会暴露给脚本全局,脚本无法绕过边界直接读文件。
- **Developer Mode 是全权的**:脚本可访问文件系统、执行系统命令。只对信任作者的
  集合开启(设置页的警告同样这么写)。

## 6. CLI 中的行为

`bruno run` 从集合 `bruno.json` 读取同一个 `scripts` 块,additionalContextRoots
在 CLI 下同样生效,行为与 GUI 一致:

- 默认 runtime 为 Node VM(`nodevm`),npm 包依赖可用;
- `--sandbox safe` 切换为 QuickJS,限制与 GUI 的 Safe Mode 相同(零依赖库才可加载)。

因此**同一个公共脚本库可以同时服务 GUI 调试与 CI 里的 `bruno run`**。

## 7. 常见问题(FAQ)

**Q:require 报 `Access to files outside of the collectionPath is not allowed.`**
路径解析后落在了集合外。要么把路径改回集合内,要么在集合 bruno.json 里配置
`scripts.additionalContextRoots` 授权库目录(注意相对路径以集合根为基准)。

**Q:配置了 ACR 仍报 outside of the allowed context roots?**
按报错列出的 allowed roots 核对:相对路径是否数对了层级(`../../` 从集合根起算)、
Windows 下是否混用了盘符大小写路径、目标是否为符号链接指向了 root 之外。

**Q:Safe Mode 下 `Cannot find module '<npm 包名>'`**
Safe Mode 的裸名只解析内置库。把库改为零依赖,或把该集合切到 Developer Mode。

**Q:改了 .js 文件,正在写的请求没生效?**
require 发生在**脚本执行时**。保存 .js 后重新发送请求即可;不需要重启应用。

**Q:重命名后侧边栏出现旧名/新名闪烁或短暂重复?**
rename 落盘后由 watcher 的 add/unlink 事件驱动刷新,两种事件到达顺序在不同平台
可能有差异,最终状态一致(旧名消失、新名出现、tab 保留)。若长时间不刷新,
检查磁盘上文件名是否已变更。

**Q:js 文件能放 `.git` 里被提交吗?**
可以,它就是普通文本文件。建议在集合 bruno.json 的 `ignore` 之外正常提交;
库目录若含 `node_modules`(案例三),按惯例将其加入 gitignore 并在安装方执行
`npm install --prefix shared-scripts`。

---

*对应实现:`packages/bruno-app`(New JS Script 菜单、侧边栏、rename/delete)、
`packages/bruno-electron/src/ipc/collection.js`(`renderer:new-js-script`、rename/delete IPC)、
`packages/bruno-electron/src/app/collection-watcher.js`(.js 文件事件)、
`packages/bruno-js/src/sandbox/`(quickjs / node-vm 的模块解析与 additionalContextRoots 边界)。*
