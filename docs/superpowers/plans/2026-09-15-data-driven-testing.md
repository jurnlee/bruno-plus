# 数据驱动测试（Data-Driven Testing）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collection Runner 支持从 CSV/JSON 数据文件按行迭代运行请求序列，数据行通过 `{{var}}` 插值与 `bru.getData()` 等 API 注入，GUI 与 CLI 同步支持。

**Architecture:** 数据变量作为新的独立变量层（优先级：`…request < oauth2 < data < runtime < prompt`），通过在 prepared request 对象上设置 `request.dataVariables` / `request.iterationInfo` 传递——与现有 `request.globalEnvironmentVariables` 等作用域的流转模式完全一致，不改各 runtime 的长位置参数签名。Electron 与 CLI 的 runner 循环外套 iteration for 循环，每 iteration 重置 runtimeVariables。

**Tech Stack:** TypeScript + rollup（bruno-common）、Jest（各包）、React/Redux（bruno-app）、yargs（bruno-cli）、Playwright（e2e）。

**Spec:** `docs/superpowers/specs/2026-09-15-data-driven-testing-design.md`（本计划的唯一需求来源，含已确认的语义决策）

## Global Constraints

- 设计 spec 的所有语义决策为硬约束：runtime 每 iteration 重置、env 跨 iteration 持续、对外 iteration 一律 1-based、无数据时 API 返回 undefined/null（不报错）
- 插值链新层必须同步加到全部四处镜像：electron `interpolate-vars.js`、CLI `interpolate-vars.js`、`bruno-js/src/interpolate-string.js`、`bruno-js/src/bru.js#interpolate`
- bruno-common 保持**零运行时依赖**（CSV 解析手写，不引入 papaparse 等）
- 不做任何 on-disk DSL 变更（数据文件不进 `.bru`/`.yml`）
- 改 bruno-common 后必须 `npm run build:bruno-common` 才能被 electron/cli 从 dist 消费
- 机械风格交给 `npm run lint:fix`；每任务结束跑受影响 workspace 的测试
- 行内代码注释遵循 conventions.md：只注释"为什么"，不注释"改了什么"
- 以下文件中的行号是写计划时的锚点，实现时以引用的代码内容定位，行号可能漂移

---

### Task 1: bruno-common `parseDataFile`（CSV/JSON 解析）

**Files:**
- Create: `packages/bruno-common/src/data-file/index.ts`
- Test: `packages/bruno-common/src/data-file/index.spec.ts`
- Modify: `packages/bruno-common/src/index.ts`（导出）

**Interfaces:**
- Consumes: 无（纯函数，零依赖）
- Produces: `parseDataFile(content: string, format: 'csv' | 'json'): { rows: Record<string, any>[]; errors: { line: number; message: string }[] }` — 后续所有任务的数据解析入口。rows 为空且 errors 为空 = 文件合法但无数据行（由调用方决定禁用/退出）。CSV 值全为 string；JSON 值保留类型。缺失列 = key 不存在（`undefined`）；CSV 空字段 = `''`。

- [ ] **Step 1: 写失败测试**

```typescript
// packages/bruno-common/src/data-file/index.spec.ts
import { parseDataFile } from './index';

describe('parseDataFile - csv', () => {
  it('parses basic csv with header row', () => {
    const result = parseDataFile('username,password\nalice,secret\nbob,pass', 'csv');
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      { username: 'alice', password: 'secret' },
      { username: 'bob', password: 'pass' }
    ]);
  });

  it('handles CRLF line endings and a BOM', () => {
    const result = parseDataFile('\uFEFFa,b\r\n1,2\r\n', 'csv');
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([{ a: '1', b: '2' }]);
  });

  it('supports quoted fields with commas, embedded newlines and escaped quotes (RFC 4180)', () => {
    const result = parseDataFile('name,notes\n"Smith, John","line1\nline2"\n"say ""hi""",plain', 'csv');
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      { name: 'Smith, John', notes: 'line1\nline2' },
      { name: 'say "hi"', notes: 'plain' }
    ]);
  });

  it('missing trailing columns leave keys absent (undefined) and extra columns are ignored', () => {
    const result = parseDataFile('a,b,c\n1,\n1,2,3,4', 'csv');
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toEqual({ a: '1', b: '' });
    expect('c' in result.rows[0]).toBe(false);
    expect(result.rows[1]).toEqual({ a: '1', b: '2', c: '3' });
  });

  it('empty header cell is a structural error with line number', () => {
    const result = parseDataFile('a,,c\n1,2,3', 'csv');
    expect(result.errors).toEqual([{ line: 1, message: 'Column 2 has an empty header name' }]);
    expect(result.rows).toEqual([]);
  });

  it('unterminated quote is a structural error', () => {
    const result = parseDataFile('a,b\n"unterminated,x', 'csv');
    expect(result.errors[0].message).toMatch(/Unterminated quoted field/);
    expect(result.rows).toEqual([]);
  });

  it('empty content and header-only files yield zero rows without errors', () => {
    expect(parseDataFile('', 'csv')).toEqual({ rows: [], errors: [] });
    expect(parseDataFile('a,b,c', 'csv')).toEqual({ rows: [], errors: [] });
  });
});

describe('parseDataFile - json', () => {
  it('parses an array of objects preserving value types', () => {
    const result = parseDataFile('[{"n":1,"ok":true,"cfg":{"port":80}}]', 'json');
    expect(result.rows).toEqual([{ n: 1, ok: true, cfg: { port: 80 } }]);
    expect(result.errors).toEqual([]);
  });

  it('non-array json is an error', () => {
    const result = parseDataFile('{"rows": []}', 'json');
    expect(result.errors).toEqual([{ line: 0, message: 'JSON data file must be an array of objects' }]);
    expect(result.rows).toEqual([]);
  });

  it('non-object array elements are errors', () => {
    const result = parseDataFile('[{"a":1}, "x"]', 'json');
    expect(result.errors[0].message).toMatch(/must be an object/);
    expect(result.rows).toEqual([]);
  });

  it('invalid json is an error', () => {
    const result = parseDataFile('[{"a":}', 'json');
    expect(result.errors[0].message).toMatch(/Invalid JSON/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test --workspace=packages/bruno-common -- src/data-file`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```typescript
// packages/bruno-common/src/data-file/index.ts
export type DataFileFormat = 'csv' | 'json';

export interface DataFileError {
  line: number;
  message: string;
}

export interface ParsedDataFile {
  rows: Record<string, any>[];
  errors: DataFileError[];
}

interface CsvRecord {
  fields: string[];
  line: number;
}

// RFC 4180 record reader: quote-enclosed fields may contain commas, newlines
// and escaped quotes (""). Records are split on CRLF / LF / CR outside quotes.
const readCsvRecords = (content: string): CsvRecord[] => {
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldWasQuoted = false;
  let line = 1;
  let recordStartLine = 1;
  let i = 0;

  const pushField = () => {
    // An unquoted empty field is '' only when the record actually had content;
    // a completely empty line is a record separator (handled in pushRecord).
    fields.push(field);
    field = '';
    fieldWasQuoted = false;
  };

  const pushRecord = () => {
    if (fields.length === 0 && field === '' && !fieldWasQuoted) {
      // skip empty lines (trailing newline / blank separator)
      field = '';
      return;
    }
    pushField();
    records.push({ fields, line: recordStartLine });
    fields = [];
    recordStartLine = line;
  };

  while (i < content.length) {
    const char = content[i];

    if (inQuotes) {
      if (char === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      if (char === '\n' || char === '\r') line++;
      field += char;
      i++;
      continue;
    }

    if (char === '"' && field === '' && !fieldWasQuoted) {
      inQuotes = true;
      fieldWasQuoted = true;
      i++;
      continue;
    }
    if (char === ',') {
      pushField();
      i++;
      continue;
    }
    if (char === '\r' || char === '\n') {
      if (char === '\r' && content[i + 1] === '\n') i++;
      i++;
      pushRecord();
      line++;
      continue;
    }
    field += char;
    i++;
  }

  if (inQuotes) {
    return [...records, { fields: [], line: recordStartLine, unterminated: true } as CsvRecord];
  }
  if (field !== '' || fields.length > 0) pushRecord();
  return records;
};

const parseCsv = (content: string): ParsedDataFile => {
  // strip BOM
  const clean = content.startsWith('\uFEFF') ? content.slice(1) : content;
  const records = readCsvRecords(clean);

  if (records.length > 0 && (records[records.length - 1] as any).unterminated) {
    const bad = records[records.length - 1];
    return {
      rows: [],
      errors: [{ line: bad.line, message: `Unterminated quoted field starting at line ${bad.line}` }]
    };
  }
  if (records.length === 0) {
    return { rows: [], errors: [] };
  }

  const header = records[0].fields;
  const errors: DataFileError[] = [];
  header.forEach((name, index) => {
    if (name.trim() === '') {
      errors.push({ line: records[0].line, message: `Column ${index + 1} has an empty header name` });
    }
  });
  if (errors.length) {
    return { rows: [], errors };
  }

  const rows = records.slice(1).map((record) => {
    const row: Record<string, any> = {};
    header.forEach((name, index) => {
      if (index < record.fields.length) {
        row[name] = record.fields[index];
      }
    });
    return row;
  });

  return { rows, errors: [] };
};

const parseJson = (content: string): ParsedDataFile => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    return { rows: [], errors: [{ line: 0, message: `Invalid JSON: ${(err as Error).message}` }] };
  }
  if (!Array.isArray(parsed)) {
    return { rows: [], errors: [{ line: 0, message: 'JSON data file must be an array of objects' }] };
  }
  const badIndex = parsed.findIndex((entry) => typeof entry !== 'object' || entry === null || Array.isArray(entry));
  if (badIndex >= 0) {
    return {
      rows: [],
      errors: [{ line: 0, message: `JSON array element at index ${badIndex} must be an object` }]
    };
  }
  return { rows: parsed as Record<string, any>[], errors: [] };
};

export const parseDataFile = (content: string, format: DataFileFormat): ParsedDataFile => {
  if (format === 'json') {
    return parseJson(content);
  }
  return parseCsv(content);
};
```

注意：`CsvRecord` 里的 `unterminated` 标记需要加进接口（`unterminated?: boolean`）；实现时按 lint 要求整理（如 prefer 具名类型），保持逻辑不变。

在 `packages/bruno-common/src/index.ts` 追加导出（紧随 `interpolate` 导出之后）：

```typescript
export { parseDataFile } from './data-file';
export type { DataFileFormat, DataFileError, ParsedDataFile } from './data-file';
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test --workspace=packages/bruno-common -- src/data-file`
Expected: PASS（全部用例）

- [ ] **Step 5: 构建 + 全量 common 测试 + 提交**

```bash
npm run build:bruno-common
npm test --workspace=packages/bruno-common
git add packages/bruno-common/src/data-file packages/bruno-common/src/index.ts
git commit -m "feat(common): add parseDataFile for CSV/JSON test data files"
```

---

### Task 2: bruno-js `Bru` 数据 API 与插值层

**Files:**
- Modify: `packages/bruno-js/src/bru.js`（constructor、`interpolate`、新方法）
- Test: `packages/bruno-js/tests/data-driven-bru.spec.js`（新建，参照 `tests/collectionVar.spec.js` 的直接构造模式）

**Interfaces:**
- Consumes: 无
- Produces: `new Bru({ ..., dataVariables?: Record<string, any>, iterationInfo?: { index: number; count: number } | null })`；实例方法 `getData(key): any`、`getAllData(): Record<string, any> | undefined`、`getIteration(): number | null`（1-based）、`getIterationCount(): number | null`；实例属性 `dataVariables`、`iterationInfo`（Task 3/4 的 assert-runtime `interpolationContext` 会读 `context.bru.dataVariables`）。`interpolate()` 的 combinedVars 在 oauth2 层之后、runtime 层之前展开 `dataVariables`。

- [ ] **Step 1: 写失败测试**

```javascript
// packages/bruno-js/tests/data-driven-bru.spec.js
const Bru = require('../src/bru');

describe('Bru data-driven APIs', () => {
  it('getData returns the current row field; getAllData returns a shallow copy', () => {
    const bru = new Bru({
      runtime: 'nodevm',
      dataVariables: { username: 'alice', cfg: { port: 80 } },
      iterationInfo: { index: 1, count: 3 }
    });
    expect(bru.getData('username')).toBe('alice');
    expect(bru.getData('cfg')).toEqual({ port: 80 });
    expect(bru.getData('missing')).toBeUndefined();
    const all = bru.getAllData();
    expect(all).toEqual({ username: 'alice', cfg: { port: 80 } });
    all.username = 'mutated';
    expect(bru.getData('username')).toBe('alice');
  });

  it('getIteration is 1-based; getIterationCount returns row count', () => {
    const bru = new Bru({ runtime: 'nodevm', dataVariables: {}, iterationInfo: { index: 0, count: 5 } });
    expect(bru.getIteration()).toBe(1);
    expect(bru.getIterationCount()).toBe(5);
  });

  it('without data, getData/getAllData return undefined and iteration APIs return null', () => {
    const bru = new Bru({ runtime: 'nodevm' });
    expect(bru.getData('x')).toBeUndefined();
    expect(bru.getAllData()).toBeUndefined();
    expect(bru.getIteration()).toBeNull();
    expect(bru.getIterationCount()).toBeNull();
  });

  it('interpolate resolves data vars above env/folder/request but below runtime', () => {
    const bru = new Bru({
      runtime: 'nodevm',
      envVariables: { token: 'from-env' },
      folderVariables: { token: 'from-folder' },
      requestVariables: { token: 'from-request' },
      dataVariables: { token: 'from-data' },
      runtimeVariables: {}
    });
    expect(bru.interpolate('{{token}}')).toBe('from-data');

    bru.setVar('token', 'from-runtime');
    expect(bru.interpolate('{{token}}')).toBe('from-runtime');
  });

  it('interpolate serializes object data values as JSON', () => {
    const bru = new Bru({ runtime: 'nodevm', dataVariables: { cfg: { port: 80 } } });
    expect(bru.interpolate('{{cfg}}')).toBe('{"port":80}');
    expect(bru.interpolate('{{cfg.port}}')).toBe('80');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test --workspace=packages/bruno-js -- tests/data-driven-bru`
Expected: FAIL（getData is not a function）

- [ ] **Step 3: 实现**

`packages/bruno-js/src/bru.js` 三处修改：

(a) constructor 解构与赋值（在 `promptVariables,` 之后加参数，在 `this.oauth2CredentialVariables = …` 之后赋值；**不设默认值**，保留 undefined 以区分"无数据"）：

```javascript
    // constructor 参数列表追加:
    dataVariables,
    iterationInfo,
    // constructor 体追加:
    this.dataVariables = dataVariables;
    this.iterationInfo = iterationInfo || null;
```

(b) `interpolate` 的 `combinedVars`（`oauth2CredentialVariables` 之后、`runtimeVariables` 之前插入）：

```javascript
      ...this.oauth2CredentialVariables,
      ...this.dataVariables,
      ...this.runtimeVariables,
```

(c) JSDoc `@property` 注释补两行；类方法追加（放在 `getRequestVar` 之后、`setNextRequest` 之前）：

```javascript
  getData(key) {
    return this.dataVariables?.[key];
  }

  getAllData() {
    return this.dataVariables ? Object.assign({}, this.dataVariables) : undefined;
  }

  getIteration() {
    return this.iterationInfo ? this.iterationInfo.index + 1 : null;
  }

  getIterationCount() {
    return this.iterationInfo ? this.iterationInfo.count : null;
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test --workspace=packages/bruno-js -- tests/data-driven-bru`
Expected: PASS

- [ ] **Step 5: 全量 bruno-js 测试 + 提交**

```bash
npm test --workspace=packages/bruno-js
git add packages/bruno-js/src/bru.js packages/bruno-js/tests/data-driven-bru.spec.js
git commit -m "feat(js): add data row and iteration APIs to Bru with data variable layer"
```

---

### Task 3: bruno-js 各 runtime 读取 `request.dataVariables`

**Files:**
- Modify: `packages/bruno-js/src/runtime/script-runtime.js`（`runRequestScript` + `runResponseScript` 两处）
- Modify: `packages/bruno-js/src/runtime/test-runtime.js`（`runTests`）
- Modify: `packages/bruno-js/src/runtime/assert-runtime.js`（`runAssertions` 的 Bru 构造、`context`、`interpolationContext`）
- Modify: `packages/bruno-js/src/interpolate-string.js`
- Test: `packages/bruno-js/tests/data-driven-runtimes.spec.js`（新建）

**Interfaces:**
- Consumes: Task 2 的 `Bru({ dataVariables, iterationInfo })`
- Produces: 所有 runtime 从 `request.dataVariables`（`Record<string, any> | undefined`）与 `request.iterationInfo`（`{ index: 0-based, count } | undefined`）读取数据上下文——**这是 Electron/CLI 注入数据的唯一契约**（Task 6/9 依赖）。`interpolateString(str, { …, dataVariables })` 增加可选参数（断言 RHS 与 VarsRuntime 插值用）。

- [ ] **Step 1: 写失败测试**

```javascript
// packages/bruno-js/tests/data-driven-runtimes.spec.js
const ScriptRuntime = require('../src/runtime/script-runtime');
const TestRuntime = require('../src/runtime/test-runtime');
const AssertRuntime = require('../src/runtime/assert-runtime');
const { interpolateString } = require('../src/interpolate-string');

describe('runtimes pick up request.dataVariables', () => {
  const dataVariables = { token: 'data-token', expectedCount: '2' };
  const iterationInfo = { index: 0, count: 3 };

  it('ScriptRuntime exposes bru.getData / getIteration in scripts', async () => {
    const runtime = new ScriptRuntime({ runtime: 'nodevm' });
    const request = { url: 'http://x', dataVariables, iterationInfo, script: {} };
    const result = await runtime.runRequestScript(
      `test('row', () => {
        expect(bru.getData('token')).to.equal('data-token');
        expect(bru.getIteration()).to.equal(1);
        expect(bru.getIterationCount()).to.equal(3);
      })`,
      request,
      {}, // envVariables
      {}, // runtimeVariables
      '', // collectionPath
      null, // onConsoleLog
      {}, // processEnvVars
      {}, // scriptingConfig
      null, // runRequestByItemPathname
      'col' // collectionName
    );
    expect(result.results[0].status).toBe('pass');
  });

  it('TestRuntime exposes the same APIs', async () => {
    const runtime = new TestRuntime({ runtime: 'nodevm' });
    const request = { url: 'http://x', dataVariables, iterationInfo };
    const response = { status: 200, data: {}, headers: {} };
    const result = await runtime.runTests(
      `test('iter', () => { expect(bru.getData('expectedCount')).to.equal('2'); })`,
      request,
      response,
      {}, // envVariables
      {}, // runtimeVariables
      '', // collectionPath
      null, // onConsoleLog
      {}, // processEnvVars
      {}, // scriptingConfig
      null, // runRequestByItemPathname
      'col' // collectionName
    );
    expect(result.results[0].status).toBe('pass');
  });

  it('QuickJS sandbox exposes the same APIs (marshal 层验证)', async () => {
    const runtime = new ScriptRuntime({ runtime: 'quickjs' });
    const request = { url: 'http://x', dataVariables, iterationInfo, script: {} };
    const result = await runtime.runRequestScript(
      `test('row', () => { expect(bru.getData('token')).to.equal('data-token'); })`,
      request, {}, {}, '', null, {}, {}, null, 'col'
    );
    expect(result.results[0].status).toBe('pass');
  });

  it('AssertRuntime interpolates {{var}} from data row and merges row into eval context', () => {
    const runtime = new AssertRuntime({ runtime: 'nodevm' });
    const request = {
      url: 'http://x',
      dataVariables,
      iterationInfo
    };
    const response = { status: 200, data: { count: 2 }, headers: {} };
    const results = runtime.runAssertions(
      [{ name: 'res.body.count', value: '{{expectedCount}}', enabled: true }],
      request,
      response,
      {}, {}, {}
    );
    expect(results[0].status).toBe('pass');
  });

  it('interpolateString places data above request vars and below runtime vars', () => {
    const out = interpolateString('{{token}}', {
      requestVariables: { token: 'req' },
      dataVariables: { token: 'data' },
      runtimeVariables: {}
    });
    expect(out).toBe('data');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test --workspace=packages/bruno-js -- tests/data-driven-runtimes`
Expected: FAIL

- [ ] **Step 3: 实现（四处镜像）**

(a) `script-runtime.js` — `runRequestScript` 与 `runResponseScript` 各自在 `const promptVariables = request?.promptVariables || {};` 之后加：

```javascript
    const dataVariables = request?.dataVariables;
    const iterationInfo = request?.iterationInfo;
```

并在两处 `new Bru({` 的 `promptVariables,` 之后传 `dataVariables, iterationInfo,`。

(b) `test-runtime.js` — `runTests` 同样两处修改。

(c) `assert-runtime.js` — `runAssertions` 内：
- Bru 构造同上；
- `const context = {` 的展开链在 `...oauth2CredentialVariables,` 之后、`...runtimeVariables,` 之前插 `...(request?.dataVariables || {}),`；
- `interpolationContext`（`evaluateRhsOperand` 内，`globalEnvironmentVariables: context.bru.globalEnvironmentVariables,` 处）追加一行：

```javascript
    dataVariables: context.bru.dataVariables,
```

(d) `interpolate-string.js` — 解构参数追加 `dataVariables = {}`，`combinedVars` 在 `...requestVariables,` 之后、`...runtimeVariables,` 之前插 `...dataVariables,`（该文件没有 oauth2 层，保持相对顺序一致：data 紧邻 runtime 之下）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test --workspace=packages/bruno-js -- tests/data-driven-runtimes`
Expected: PASS

- [ ] **Step 5: 全量测试 + 提交**

```bash
npm test --workspace=packages/bruno-js
git add packages/bruno-js/src
git commit -m "feat(js): thread data row context through script/test/assert runtimes"
```

---

### Task 4: bruno-electron 插值镜像加 data 层

**Files:**
- Modify: `packages/bruno-electron/src/ipc/network/interpolate-vars.js:41-86`
- Test: `packages/bruno-electron/tests/network/interpolate-vars.spec.js`（追加用例）

**Interfaces:**
- Consumes: `request.dataVariables`（Task 3 契约）
- Produces: GUI 主进程插值感知 data 层（无签名变化——从 request 对象读取）

- [ ] **Step 1: 追加失败测试**

在 `packages/bruno-electron/tests/network/interpolate-vars.spec.js` 末尾追加：

```javascript
describe('data variables layer', () => {
  it('data row overrides env/folder/request vars but not runtime vars', () => {
    const request = {
      url: '{{token}}',
      method: 'GET',
      headers: {},
      collectionVariables: {},
      folderVariables: { token: 'folder' },
      requestVariables: { token: 'request' },
      dataVariables: { token: 'data' },
      runtimeVariables: {}
    };
    const result = interpolateVars(request, { token: 'env' }, { token: 'runtime' }, {});
    expect(result.url).toBe('runtime');
  });

  it('data row wins when no runtime var exists', () => {
    const request = {
      url: '{{token}}',
      method: 'GET',
      headers: {},
      dataVariables: { token: 'data' }
    };
    const result = interpolateVars(request, { token: 'env' }, {}, {});
    expect(result.url).toBe('data');
  });

  it('requests without dataVariables behave exactly as before', () => {
    const request = { url: '{{token}}', method: 'GET', headers: {} };
    const result = interpolateVars(request, { token: 'env' }, {}, {});
    expect(result.url).toBe('env');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test --workspace=packages/bruno-electron -- tests/network/interpolate-vars`
Expected: 前 2 个新用例 FAIL

- [ ] **Step 3: 实现**

`interpolate-vars.js` 的 `interpolateVars` 函数体，在 `const requestVariables = request?.requestVariables || {};` 之后加：

```javascript
  const dataVariables = request?.dataVariables || {};
```

`_interpolate` 的 `combinedVars` 在 `...oauth2CredentialVariables,` 之后、`...runtimeVariables,` 之前插 `...dataVariables,`。函数签名**不改**。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test --workspace=packages/bruno-electron -- tests/network/interpolate-vars`
Expected: PASS（含原有全部用例）

- [ ] **Step 5: 提交**

```bash
git add packages/bruno-electron/src/ipc/network/interpolate-vars.js packages/bruno-electron/tests/network/interpolate-vars.spec.js
git commit -m "feat(electron): interpolate data row variables in the runner request pipeline"
```

---

### Task 5: bruno-electron 数据文件 IPC（`renderer:read-data-file`）

**Files:**
- Create: `packages/bruno-electron/src/ipc/data-file.js`
- Create: `packages/bruno-electron/src/ipc/data-file.spec.js`
- Modify: `packages/bruno-electron/src/index.js`（注册 `registerDataFileIpc()`，加在 ready 块内现有 `register*Ipc` 调用旁）

**Interfaces:**
- Consumes: Task 1 的 `parseDataFile`
- Produces: `readDataFile(filePath: string): { rows, errors }`（命名导出，fs 错误/不支持扩展名时 throw）；IPC `renderer:read-data-file(filePath)` → resolve `{ rows, errors }`，fs 异常 reject。Task 6 与 Task 8（DataFilePanel）依赖。

- [ ] **Step 1: 写失败测试**

```javascript
// packages/bruno-electron/src/ipc/data-file.spec.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readDataFile } = require('./data-file');

describe('readDataFile', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-data-file-'));

  const writeTmp = (name, content) => {
    const p = path.join(tmp, name);
    fs.writeFileSync(p, content);
    return p;
  };

  it('reads and parses a csv file', () => {
    const p = writeTmp('rows.csv', 'a,b\n1,2');
    expect(readDataFile(p)).toEqual({ rows: [{ a: '1', b: '2' }], errors: [] });
  });

  it('reads and parses a json file', () => {
    const p = writeTmp('rows.json', '[{"a":1}]');
    expect(readDataFile(p)).toEqual({ rows: [{ a: 1 }], errors: [] });
  });

  it('throws for unsupported extensions', () => {
    const p = writeTmp('rows.txt', 'a,b');
    expect(() => readDataFile(p)).toThrow(/Unsupported data file extension/);
  });

  it('throws for missing files', () => {
    expect(() => readDataFile(path.join(tmp, 'nope.csv'))).toThrow();
  });

  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test --workspace=packages/bruno-electron -- src/ipc/data-file`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```javascript
// packages/bruno-electron/src/ipc/data-file.js
const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');
const { parseDataFile } = require('@usebruno/common');

const FORMATS_BY_EXTENSION = {
  '.csv': 'csv',
  '.json': 'json'
};

const readDataFile = (filePath) => {
  if (typeof filePath !== 'string' || !filePath.length) {
    throw new Error('A data file path is required');
  }
  const extension = path.extname(filePath).toLowerCase();
  const format = FORMATS_BY_EXTENSION[extension];
  if (!format) {
    throw new Error(`Unsupported data file extension "${extension}" — expected .csv or .json`);
  }
  const content = fs.readFileSync(path.resolve(filePath), 'utf8');
  return parseDataFile(content, format);
};

const registerDataFileIpc = () => {
  ipcMain.handle('renderer:read-data-file', async (event, filePath) => {
    // fs/extension failures reject so the renderer can surface them as data-file errors
    return readDataFile(filePath);
  });
};

module.exports = { readDataFile, registerDataFileIpc };
```

`packages/bruno-electron/src/index.js`：顶部 require 区加 `const { registerDataFileIpc } = require('./ipc/data-file');`，在 `app.on('ready')` 的 `// register all ipc handlers` 块内（与其它 `register*Ipc` 并列）加 `registerDataFileIpc();`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test --workspace=packages/bruno-electron -- src/ipc/data-file`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/bruno-electron/src/ipc/data-file.js packages/bruno-electron/src/ipc/data-file.spec.js packages/bruno-electron/src/index.js
git commit -m "feat(electron): add renderer:read-data-file IPC for test data files"
```

---

### Task 6: bruno-electron runner iteration 循环

**Files:**
- Modify: `packages/bruno-electron/src/ipc/network/index.js`（handler `renderer:run-collection-folder` 及其内部 `runRequest`）

**Interfaces:**
- Consumes: Task 3 的 `request.dataVariables`/`request.iterationInfo` 契约、Task 5 的 `readDataFile`
- Produces: IPC `renderer:run-collection-folder` 第 10 个参数 `dataFilePath`（string | null）；事件流：`testrun-started` 附带 `iterationCount`/`dataFilePath`（仅数据驱动时），所有请求级事件的 `eventData` 附带 `iteration`（1-based，仅数据驱动时）。`runRequest` 新增可选参数 `dataContext = null`（形如 `{ dataVariables, iterationInfo }`）。Task 7/8（Redux 与 GUI）依赖事件字段。

**测试说明（诚实边界）**：该 handler 是 ~700 行内联函数，仓库现状无其单元测试。本任务不新增单测（不为此重构 handler）；iteration 语义的自动化覆盖由 Task 9（CLI 同构循环，集成测试）与 Task 10（e2e）承担。本任务验证 = 受影响 spec 全绿 + lint。

- [ ] **Step 1: 实现循环改造（锚点定位，行号会漂移，以代码内容为准）**

(a) handler 签名（`'renderer:run-collection-folder', async (event, folder, collection, environment, runtimeVariables, recursive, delay, tags, selectedRequestUids) =>`）追加第 10 参数 `dataFilePath`。

(b) 在 `const processEnvVars = getProcessEnvVars(collectionUid);` 之后插入（**必须在 `testrun-started` 事件发送之前**，使解析失败直接 reject invoke、不产生任何事件）：

```javascript
      let dataRows = null;
      if (dataFilePath) {
        const parsed = readDataFile(dataFilePath);
        if (parsed.errors.length) {
          throw new Error(`Data file has errors: ${parsed.errors.map((e) => `line ${e.line}: ${e.message}`).join('; ')}`);
        }
        if (!parsed.rows.length) {
          throw new Error('Data file contains no data rows');
        }
        dataRows = parsed.rows;
      }
```

文件顶部 require 区加 `const { readDataFile } = require('../data-file');`。

(c) 在 `let currentRunnerEventData = null;` 之后加：

```javascript
      // Data-driven runs reset runtime variables per iteration; snapshot the
      // pre-run state so each data row starts from the same baseline.
      const runtimeVariablesSnapshot = cloneDeep(runtimeVariables);
      let currentDataVariables = null;
      let currentIterationInfo = null;
```

(d) `runRequest`（`const runRequest = async ({ item, collection, envVars, …, parentRequestUid = null }) => {`）：
- 解构追加 `dataContext = null`；
- 在 `const request = await prepareRequest(item, collection, abortController);` 之后加：

```javascript
    if (dataContext?.dataVariables) {
      request.dataVariables = dataContext.dataVariables;
      request.iterationInfo = dataContext.iterationInfo;
    }
```

(e) handler 内 `runRequestByItemPathname` 的 `runRequest({ … })` 调用追加 `dataContext: { dataVariables: currentDataVariables, iterationInfo: currentIterationInfo }`（嵌套 `bru.runRequest` 继承当前行）。

(f) `testrun-started` 事件 payload 追加 `...(dataRows ? { iterationCount: dataRows.length, dataFilePath } : {})`。

(g) **核心循环重构**。现状：

```javascript
        let currentRequestIndex = 0;
        let nJumps = 0; // count the number of jumps to avoid infinite loops
        while (currentRequestIndex < folderRequests.length) {
          …循环体…
        }

        deleteCancelToken(cancelTokenUid);
        if (!stopRunnerExecution) {
          mainWindow.webContents.send('main:run-folder-event', { type: 'testrun-ended', … });
        }
```

改为（`currentRequestIndex`/`nJumps` 移入 for；`while` 与其后的 `deleteCancelToken`/`testrun-ended` 之间插入 for 收尾）：

```javascript
        const iterationCount = dataRows ? dataRows.length : 1;
        for (let iterationIndex = 0; iterationIndex < iterationCount; iterationIndex++) {
          if (dataRows) {
            // Reset in place: scripts and variable-update handlers hold references
            // to this object, so it must be cleared rather than replaced.
            for (const key of Object.keys(runtimeVariables)) {
              delete runtimeVariables[key];
            }
            Object.assign(runtimeVariables, cloneDeep(runtimeVariablesSnapshot));
            currentDataVariables = dataRows[iterationIndex];
            currentIterationInfo = { index: iterationIndex, count: dataRows.length };
          }

          let currentRequestIndex = 0;
          let nJumps = 0; // count the number of jumps to avoid infinite loops
          while (currentRequestIndex < folderRequests.length) {
            …现有循环体，仅下面两处小改…
          }

          if (stopRunnerExecution) {
            break;
          }
        }

        deleteCancelToken(cancelTokenUid);
        if (!stopRunnerExecution) {
          mainWindow.webContents.send('main:run-folder-event', {
            type: 'testrun-ended',
            collectionUid,
            folderUid,
            runCompletionTime: new Date().toISOString()
          });
        }
```

循环体内两处小改：
1. `eventData` 构造（`const eventData = { collectionUid, folderUid, itemUid };`）改为：

```javascript
          const eventData = {
            collectionUid,
            folderUid,
            itemUid,
            // 1-based in events; undefined for non-data runs keeps the old shape
            ...(dataRows ? { iteration: iterationIndex + 1 } : {})
          };
```

2. `request.__bruno__executionMode = 'runner';` 之后加：

```javascript
          if (currentDataVariables) {
            request.dataVariables = currentDataVariables;
            request.iterationInfo = currentIterationInfo;
          }
```

**保留的现有语义（勿改）**：`break`（`nextRequestName === null`）只退出 while——数据驱动下自然进入下一 iteration（spec 决策 3）；`stopRunnerExecution` 的 `break` 发 `testrun-ended` 后退出 while，由 for 的收尾检查退出整个 run；cancel 检查在 while 顶部（每圈生效，两层级联）；delay 在每个请求发送前应用（iteration 间天然覆盖）。

- [ ] **Step 2: 验证**

```bash
npm test --workspace=packages/bruno-electron
npm run lint:fix --workspace=packages/bruno-electron 2>/dev/null || npm run lint:fix
```
Expected: 现有全部测试 PASS（无回归）；lint 无 error。

- [ ] **Step 3: 手动冒烟（可选但推荐）**

`npm run dev` → 打开任意 collection → Runner → 无数据文件 Run 一次（行为应与改造前一致）。

- [ ] **Step 4: 提交**

```bash
git add packages/bruno-electron/src/ipc/network/index.js
git commit -m "feat(electron): run collection folder once per data row with runtime var reset"
```

---

### Task 7: bruno-app Redux（thunk / reducer / 事件）

**Files:**
- Modify: `packages/bruno-app/src/providers/ReduxStore/slices/collections/actions.js`（`runCollectionFolder` thunk、新增 `updateRunnerDataFile` thunk）
- Modify: `packages/bruno-app/src/providers/ReduxStore/slices/collections/index.js`（`runFolderEvent` reducer、`updateRunnerDataFile` reducer、导出）
- Test: `packages/bruno-app/src/providers/ReduxStore/slices/collections/runner-data-driven.spec.js`（新建，参照 `runner-exchange-events.spec.js` 的 reducer 测试模式）

**Interfaces:**
- Consumes: Task 6 的事件字段（`iteration`、`iterationCount`、`dataFilePath`）
- Produces: `runCollectionFolder(collectionUid, folderUid, recursive, delay, tags, selectedRequestUids, dataFilePath)`（第 7 参新增）；`updateRunnerDataFile(collectionUid, dataFilePath | null)` action；state 形状：`collection.runnerResult.items[].iteration`、`collection.runnerResult.info.iterationCount/dataFilePath`、`collection.runnerConfiguration.dataFilePath`。Task 8 依赖。

- [ ] **Step 1: 写失败测试**

```javascript
// packages/bruno-app/src/providers/ReduxStore/slices/collections/runner-data-driven.spec.js
import reducer, { runFolderEvent, updateRunnerDataFile, resetCollectionRunner } from './index';

const baseState = () => ({
  collections: [
    {
      uid: 'col-1',
      items: [{ uid: 'req-1', type: 'http-request' }],
      runnerResult: null,
      runnerConfiguration: null
    }
  ]
});

describe('data-driven runner events', () => {
  it('testrun-started stores iterationCount and dataFilePath in info', () => {
    const state = reducer(baseState(), runFolderEvent({
      type: 'testrun-started',
      collectionUid: 'col-1',
      folderUid: null,
      isRecursive: true,
      iterationCount: 3,
      dataFilePath: 'C:/data/rows.csv'
    }));
    const info = state.collections[0].runnerResult.info;
    expect(info.iterationCount).toBe(3);
    expect(info.dataFilePath).toBe('C:/data/rows.csv');
  });

  it('request-queued stores the 1-based iteration on the item', () => {
    let state = reducer(baseState(), runFolderEvent({
      type: 'testrun-started', collectionUid: 'col-1', folderUid: null
    }));
    state = reducer(state, runFolderEvent({
      type: 'request-queued', collectionUid: 'col-1', folderUid: null, itemUid: 'req-1', requestUid: 'ru-1', iteration: 2
    }));
    expect(state.collections[0].runnerResult.items[0].iteration).toBe(2);
  });

  it('later events target the latest item for a repeated request uid (findLast across iterations)', () => {
    let state = reducer(baseState(), runFolderEvent({
      type: 'testrun-started', collectionUid: 'col-1', folderUid: null
    }));
    for (const iteration of [1, 2]) {
      state = reducer(state, runFolderEvent({
        type: 'request-queued', collectionUid: 'col-1', folderUid: null, itemUid: 'req-1', requestUid: `ru-${iteration}`, iteration
      }));
      state = reducer(state, runFolderEvent({
        type: 'response-received', collectionUid: 'col-1', folderUid: null, itemUid: 'req-1', responseReceived: { status: 200, iteration }
      }));
    }
    const items = state.collections[0].runnerResult.items;
    expect(items).toHaveLength(2);
    expect(items[1].responseReceived.status).toBe(200);
  });

  it('updateRunnerDataFile persists and clears the path', () => {
    let state = reducer(baseState(), updateRunnerDataFile({ collectionUid: 'col-1', dataFilePath: 'C:/data/rows.csv' }));
    expect(state.collections[0].runnerConfiguration.dataFilePath).toBe('C:/data/rows.csv');
    state = reducer(state, updateRunnerDataFile({ collectionUid: 'col-1', dataFilePath: null }));
    expect(state.collections[0].runnerConfiguration.dataFilePath).toBeNull();
  });

  it('resetCollectionRunner clears data-driven state', () => {
    let state = reducer(baseState(), updateRunnerDataFile({ collectionUid: 'col-1', dataFilePath: 'x' }));
    state = reducer(state, resetCollectionRunner({ collectionUid: 'col-1' }));
    expect(state.collections[0].runnerConfiguration).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test --workspace=packages/bruno-app -- slices/collections/runner-data-driven`
Expected: FAIL（updateRunnerDataFile 未导出）

- [ ] **Step 3: 实现**

(a) `actions.js` — `runCollectionFolder` thunk 签名加 `dataFilePath`（第 7 参），`ipcRenderer.invoke('renderer:run-collection-folder', …)` 参数列表末尾追加 `dataFilePath`。文件内新增 thunk：

```javascript
export const updateRunnerDataFile = (collectionUid, dataFilePath) => (dispatch) => {
  dispatch(_updateRunnerDataFile({ collectionUid, dataFilePath }));
};
```

（import 处把 reducer action `updateRunnerDataFile` 以 `_updateRunnerDataFile` 别名引入，避免与 thunk 同名——遵循该文件现有同名处理惯例，若现有惯例不同则照惯例调整。）

(b) `index.js` reducer：
- `runFolderEvent` 的 `testrun-started` 分支追加：

```javascript
          if (action.payload.iterationCount !== undefined) {
            info.iterationCount = action.payload.iterationCount;
          }
          if (action.payload.dataFilePath !== undefined) {
            info.dataFilePath = action.payload.dataFilePath;
          }
```

- `request-queued` 分支 push 的对象追加 `iteration: action.payload.iteration`；
- 新增 reducer：

```javascript
    updateRunnerDataFile: (state, action) => {
      const { collectionUid, dataFilePath } = action.payload;
      const collection = findCollectionByUid(state.collections, collectionUid);
      if (collection) {
        collection.runnerConfiguration = {
          ...collection.runnerConfiguration,
          dataFilePath: dataFilePath ?? null
        };
      }
    },
```

并在 slice 文件底部 action-creators 导出区（与 `updateRunnerConfiguration` 相邻）加入 `updateRunnerDataFile`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test --workspace=packages/bruno-app -- slices/collections`
Expected: PASS（含既有 runner 相关 spec）

- [ ] **Step 5: 提交**

```bash
git add packages/bruno-app/src/providers/ReduxStore/slices/collections
git commit -m "feat(app): track data-driven iteration and data file in runner redux state"
```

---

### Task 8: bruno-app GUI（DataFilePanel + 分组结果 + run 接线）

**Files:**
- Create: `packages/bruno-app/src/components/RunnerResults/DataFilePanel/index.jsx`
- Create: `packages/bruno-app/src/components/RunnerResults/DataFilePanel/StyledWrapper.jsx`
- Modify: `packages/bruno-app/src/components/RunnerResults/index.jsx`
- Modify: `packages/bruno-app/src/components/RunnerResults/StyledWrapper.js`（分组头样式，如需）

**Interfaces:**
- Consumes: Task 5 的 `renderer:read-data-file` IPC 与现有 `renderer:browse-files`（文件对话框，`packages/bruno-electron/src/ipc/filesystem.js:32`，传 filters）；Task 7 的 `updateRunnerDataFile`、`runCollectionFolder(…, dataFilePath)`、`items[].iteration`、`info.iterationCount`
- Produces: `<DataFilePanel collection onStatusChange />`，`onStatusChange(status)` 其中 `status = { filePath, rows, errors, loading } | null`；data-testids：`data-file-choose`、`data-file-clear`、`data-file-preview`、`data-file-error`、`data-file-row-count`、`runner-iteration-group`。

- [ ] **Step 1: 实现 DataFilePanel**

```jsx
// packages/bruno-app/src/components/RunnerResults/DataFilePanel/index.jsx
import React, { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import { IconFileImport, IconX } from '@tabler/icons';
import { updateRunnerDataFile } from 'providers/ReduxStore/slices/collections/actions';
import StyledWrapper from './StyledWrapper';

const MAX_PREVIEW_ROWS = 50;

const formatErrors = (errors, fallback) => {
  if (errors?.length) {
    return errors.map((e) => (e.line ? `Line ${e.line}: ${e.message}` : e.message)).join(' · ');
  }
  return fallback;
};

const DataFilePanel = ({ collection, onStatusChange }) => {
  const dispatch = useDispatch();
  const savedPath = collection?.runnerConfiguration?.dataFilePath || null;
  const [rows, setRows] = useState([]);
  const [errors, setErrors] = useState([]);
  const [readError, setReadError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    onStatusChange({ filePath: savedPath, rows, errors: errors.length ? errors : (readError ? [readError] : []), isLoading });
  }, [savedPath, rows, errors, readError, isLoading]);

  useEffect(() => {
    if (!savedPath) {
      setRows([]);
      setErrors([]);
      setReadError(null);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    const { ipcRenderer } = window;
    ipcRenderer
      .invoke('renderer:read-data-file', savedPath)
      .then((parsed) => {
        if (cancelled) return;
        setRows(parsed.rows);
        setErrors(parsed.errors);
        setReadError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setRows([]);
        setErrors([]);
        setReadError({ message: err?.message || 'Failed to read data file' });
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [savedPath]);

  const handleChoose = async () => {
    const { ipcRenderer } = window;
    const filePaths = await ipcRenderer.invoke('renderer:browse-files', [
      { name: 'Data Files', extensions: ['csv', 'json'] }
    ]);
    if (filePaths?.length) {
      dispatch(updateRunnerDataFile(collection.uid, filePaths[0]));
    }
  };

  const handleClear = () => {
    dispatch(updateRunnerDataFile(collection.uid, null));
  };

  // Rows are preview-only; the run itself re-reads the file in the main process
  const previewRows = rows.slice(0, MAX_PREVIEW_ROWS);
  const columnNames = previewRows.length ? Object.keys(previewRows[0]) : [];
  const hasFatalError = Boolean(readError) || errors.length > 0;

  return (
    <StyledWrapper data-testid="data-file-panel">
      <div className="flex items-center justify-between mb-2">
        <div className="runner-section-title">Data File</div>
        {savedPath ? (
          <button className="link" onClick={handleClear} data-testid="data-file-clear">
            <IconX size={12} className="mr-1" /> Clear
          </button>
        ) : null}
      </div>
      {!savedPath ? (
        <button className="btn btn-sm btn-secondary" onClick={handleChoose} data-testid="data-file-choose">
          <IconFileImport size={14} className="mr-1" /> Choose CSV/JSON file…
        </button>
      ) : (
        <div className="file-header">
          <span className="file-name" title={savedPath}>{savedPath.split(/[\\/]/).pop()}</span>
          <span className="row-count" data-testid="data-file-row-count">
            {isLoading ? 'Reading…' : `${rows.length} row${rows.length === 1 ? '' : 's'}`}
          </span>
        </div>
      )}
      {hasFatalError ? (
        <div className="error" data-testid="data-file-error">
          {formatErrors(errors) || formatErrors(null, readError?.message)}
        </div>
      ) : null}
      {!hasFatalError && previewRows.length > 0 ? (
        <div className="preview" data-testid="data-file-preview">
          <table>
            <thead>
              <tr>{columnNames.map((name) => <th key={name}>{name}</th>)}</tr>
            </thead>
            <tbody>
              {previewRows.map((row, idx) => (
                <tr key={idx}>
                  {columnNames.map((name) => (
                    <td key={name} title={String(row[name] ?? '')}>{String(row[name] ?? '')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > MAX_PREVIEW_ROWS ? (
            <div className="more-rows">Showing first {MAX_PREVIEW_ROWS} of {rows.length} rows</div>
          ) : null}
        </div>
      ) : null}
      {!hasFatalError && !isLoading && savedPath && rows.length === 0 ? (
        <div className="error" data-testid="data-file-error">Data file contains no data rows</div>
      ) : null}
    </StyledWrapper>
  );
};

export default DataFilePanel;
```

StyledWrapper.jsx 提供最小样式（表格滚动、`.error` 红字、`.file-header` 行），配色用 `theme` 变量、布局用 Tailwind 类（项目规范）。

- [ ] **Step 2: RunnerResults 接线**

`packages/bruno-app/src/components/RunnerResults/index.jsx` 修改：

(a) 顶部 import 加 `DataFilePanel`；组件内加状态：

```javascript
  const [dataFileStatus, setDataFileStatus] = useState(null);
  const dataFilePath = dataFileStatus?.filePath || null;
  const dataFileHasErrors = Boolean(dataFileStatus && (dataFileStatus.errors?.length || (dataFileStatus.filePath && dataFileStatus.rows?.length === 0 && !dataFileStatus.isLoading)));
```

(b) 配置屏（Timings/Filters 区之后、Run 按钮之前）插入：

```jsx
            <div className="runner-section-title mt-6">Data</div>
            <div className="runner-section mt-2">
              <DataFilePanel collection={collection} onStatusChange={setDataFileStatus} />
            </div>
```

(c) Run 按钮禁用条件追加：`|| dataFileHasErrors`；按钮文案在数据模式显示行数（可选）。

(d) `runCollection` 与 `runAgain`：

```javascript
  const runCollection = async () => {
    const savedOrder = get(collection, 'runnerConfiguration.requestItemsOrder', selectedRequestItems);
    dispatch(updateRunnerConfiguration(collection.uid, selectedRequestItems, savedOrder, delay));
    await clearStoredRunnerExchanges();
    dispatch(runCollectionFolder(collection.uid, null, true, Number(delay), tags, selectedRequestItems, dataFilePath));
  };
```

`runAgain` 中 `savedSelectedItems`/`savedDelay` 旁取 `const savedDataFilePath = get(collection, 'runnerConfiguration.dataFilePath', null);` 并作为第 7 参传入。

(e) **分组渲染**。`items` 计算保持不变；渲染处（结果列表 map）改为按 iteration 分组（仅 `runnerInfo.iterationCount > 1` 时）：

```javascript
  const isDataDriven = get(collection, 'runnerResult.info.iterationCount', 0) > 1;
  const groupedItems = isDataDriven
    ? items.reduce((groups, item) => {
        const key = item.iteration || 1;
        (groups[key] = groups[key] || []).push(item);
        return groups;
      }, {})
    : { 1: items };
```

渲染循环外层改为遍历 `Object.entries(groupedItems)`，每组先计算统计再渲染分组头：

```javascript
  // 组内统计与顶部总计同源：items 映射处（RunnerResults 顶部）已给每项算好 testStatus
  const passedCount = groupItems.filter((item) => item.testStatus === 'pass').length;
  const skippedCount = groupItems.filter((item) => item.testStatus === 'error' && item.skipped).length;
```

（`testStatus` 的取值集合以 items 映射处的现有实现为准——若现有顶部统计用的是别的判定，照抄同一判定，保证分组头与总计一致。）

```jsx
        <div className="iteration-group" data-testid="runner-iteration-group">
          {`Iteration ${Number(iterationKey)} / ${runnerInfo.iterationCount}`}
          <span className="group-stats">
            {passedCount} passed{skippedCount ? ` · ${skippedCount} skipped` : ''}
          </span>
        </div>
```

组内沿用现有 item 行渲染（`filteredItems` 的过滤逻辑不变，分组只作用于展示层——先 filter 再 group）。运行中进度：顶部信息条在 `isDataDriven && runnerInfo.status === 'started'` 时显示 `Iteration ${items.findLast(() => true)?.iteration ?? 1} / ${runnerInfo.iterationCount}`。

- [ ] **Step 3: 验证**

```bash
npm test --workspace=packages/bruno-app
npm run dev
```
手动冒烟：Runner 选 CSV → 预览出现 → Run → 分组结果。若 `renderer:browse-files` 的参数签名与上不符（filters 传法），按 `ipc/filesystem.js:32` 的实际签名调整调用。

- [ ] **Step 4: 提交**

```bash
git add packages/bruno-app/src/components/RunnerResults
git commit -m "feat(app): data file picker, preview and iteration-grouped runner results"
```

---

### Task 9: bruno-cli `--data` 与报告

**Files:**
- Modify: `packages/bruno-cli/src/runner/interpolate-vars.js`（镜像 Task 4）
- Modify: `packages/bruno-cli/src/runner/run-single-request.js`（第 13 参 + 注入）
- Modify: `packages/bruno-cli/src/commands/run.js`（option、解析、iteration 循环、results 字段）
- Modify: `packages/bruno-cli/src/reporters/html.js`（按 iteration 分组）
- Test: `packages/bruno-cli/tests/runner/interpolate-vars.spec.js`（追加）；`packages/bruno-cli/tests/data-driven/run.spec.js`（新建集成测试）

**Interfaces:**
- Consumes: Task 1 `parseDataFile`、Task 3 `request.dataVariables` 契约
- Produces: CLI flag `--data <path>`；`runSingleRequest(item, collectionPath, runtimeVariables, envVariables, processEnvVars, brunoConfig, collectionRoot, runtime, collection, runSingleRequestByPathname, globalEnvVars, persistPaths, dataContext = {})`（`dataContext = { dataVariables?: object; iterationInfo?: { index, count } | null }`）；results 条目新增 `iteration`（1-based）与数据模式下 `suitename` 后缀 `[iteration N]`。

- [ ] **Step 1: 插值镜像失败测试**

在 `packages/bruno-cli/tests/runner/interpolate-vars.spec.js` 追加（与 Task 4 相同的三个用例，request 带 `dataVariables`）：

```javascript
describe('data variables layer', () => {
  it('data row overrides env/request vars but not runtime vars', () => {
    const request = {
      url: '{{token}}', method: 'GET', headers: {},
      requestVariables: { token: 'request' },
      dataVariables: { token: 'data' }
    };
    expect(interpolateVars(request, { token: 'env' }, { token: 'runtime' }, {}).url).toBe('runtime');
  });

  it('data row wins when no runtime var exists', () => {
    const request = { url: '{{token}}', method: 'GET', headers: {}, dataVariables: { token: 'data' } };
    expect(interpolateVars(request, { token: 'env' }, {}, {}).url).toBe('data');
  });

  it('no dataVariables keeps prior behavior', () => {
    const request = { url: '{{token}}', method: 'GET', headers: {} };
    expect(interpolateVars(request, { token: 'env' }, {}, {}).url).toBe('env');
  });
});
```

- [ ] **Step 2: 确认失败后实现镜像**

`packages/bruno-cli/src/runner/interpolate-vars.js`：与 Task 4 相同的两处修改（读 `request?.dataVariables`，spread 进 combinedVars 的 oauth2 与 runtime 之间；该文件若无 oauth2 层则放 requestVariables 与 runtimeVariables 之间，保持"data 紧邻 runtime 之下"的相对顺序）。

Run: `npm test --workspace=packages/bruno-cli -- tests/runner/interpolate-vars` → PASS

- [ ] **Step 3: runSingleRequest 注入**

`packages/bruno-cli/src/runner/run-single-request.js`：
- 签名末尾追加 `dataContext = {}`（在 `persistPaths = {}` 之后）；
- `request = await prepareRequest(item, collection);` 之后加：

```javascript
    if (dataContext?.dataVariables) {
      request.dataVariables = dataContext.dataVariables;
      request.iterationInfo = dataContext.iterationInfo;
    }
```

- [ ] **Step 4: 集成失败测试（子进程跑真实 CLI，覆盖参数解析 + 循环 + 报告）**

```javascript
// packages/bruno-cli/tests/data-driven/run.spec.js
const { execFile } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CLI_ENTRY = path.join(__dirname, '..', '..', 'bin', 'bru.js');

const runCli = (args, cwd) =>
  new Promise((resolve) => {
    execFile(process.execPath, [CLI_ENTRY, ...args], { cwd }, (error, stdout, stderr) =>
      resolve({ code: error ? error.code : 0, stdout, stderr })
    );
  });

describe('bru run --data', () => {
  it('runs the collection once per data row and reports iteration', async () => {
    const seenUsernames = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const payload = body ? JSON.parse(body) : {};
        seenUsernames.push(payload.username);
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: true, username: payload.username }));
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-cli-dd-'));
    const collectionDir = path.join(tmp, 'col');
    fs.mkdirSync(collectionDir);
    fs.writeFileSync(path.join(collectionDir, 'bruno.json'), JSON.stringify({ name: 'dd', version: '1' }));
    fs.writeFileSync(
      path.join(collectionDir, 'echo.bru'),
      [
        'meta {',
        '  name: echo',
        '  type: http',
        '  seq: 1',
        '}',
        'method POST',
        `url http://127.0.0.1:${port}/echo`,
        'headers {',
        '  content-type: application/json',
        '}',
        'body {',
        '  {"username": "{{username}}"}',
        '}',
        'script:post-response {',
        "  test('echo matches row', () => expect(res.getBody().username).to.equal(bru.getData('username')));",
        '}',
        ''
      ].join('\n')
    );
    const csvPath = path.join(collectionDir, 'rows.csv');
    fs.writeFileSync(csvPath, 'username\nalice\nbob\n');
    const jsonReportPath = path.join(tmp, 'report.json');

    const { code, stderr } = await runCli(
      ['run', collectionDir, '--data', csvPath, '--reporter-json', jsonReportPath],
      tmp
    );

    expect(stderr).toBe('');
    expect(code).toBe(0);
    expect(seenUsernames).toEqual(['alice', 'bob']);

    const report = JSON.parse(fs.readFileSync(jsonReportPath, 'utf8'));
    expect(report.results.map((r) => r.iteration)).toEqual([1, 2]);
    report.results.forEach((r) => {
      expect(r.testResults[0].status).toBe('pass');
    });

    server.close();
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }, 60000);

  it('exits before any request when the data file is invalid', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-cli-dd-bad-'));
    const badCsv = path.join(tmp, 'bad.csv');
    fs.writeFileSync(badCsv, 'username\n"unterminated\n');
    const collectionDir = path.join(tmp, 'col');
    fs.mkdirSync(collectionDir);
    fs.writeFileSync(path.join(collectionDir, 'bruno.json'), JSON.stringify({ name: 'dd', version: '1' }));
    fs.writeFileSync(
      path.join(collectionDir, 'noop.bru'),
      ['meta {', '  name: noop', '  type: http', '  seq: 1', '}', 'method GET', 'url http://127.0.0.1:1/x', ''].join('\n')
    );

    const { code, stderr } = await runCli(['run', collectionDir, '--data', badCsv], tmp);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/Unterminated|Data file/);

    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }, 30000);
});
```

注：json 报告的 results 条目字段（`testResults[].status`）以 reporter 实际输出为准——实现时先跑一次非数据驱动 `bru run --reporter-json`，按真实形状校对断言字段名。`.bru` fixture 若与 v2 语法有出入，参照 `packages/bruno-cli` 既有 fixture（或 bruno-tests 集合）的真实写法调整。

- [ ] **Step 5: 实现循环（原地改造，与 Task 6 同构）**

`packages/bruno-cli/src/commands/run.js`：`--data` 的解析放在 handler 内、进入请求循环**之前**：

```javascript
    let dataRows = null;
    if (data) {
      const dataPath = path.resolve(process.cwd(), data);
      if (!(await exists(dataPath))) {
        console.error(chalk.red(`Data file not found: ${dataPath}`));
        process.exit(constants.EXIT_STATUS.ERROR_FILE_NOT_FOUND);
      }
      const extension = path.extname(dataPath).toLowerCase();
      const format = extension === '.json' ? 'json' : 'csv';
      if (extension !== '.json' && extension !== '.csv') {
        console.error(chalk.red(`Unsupported data file extension: ${extension} — expected .csv or .json`));
        process.exit(constants.EXIT_STATUS.ERROR);
      }
      const parsed = parseDataFile(fs.readFileSync(dataPath, 'utf8'), format);
      if (parsed.errors.length) {
        console.error(chalk.red(`Data file errors: ${parsed.errors.map((e) => `line ${e.line}: ${e.message}`).join('; ')}`));
        process.exit(constants.EXIT_STATUS.ERROR);
      }
      if (!parsed.rows.length) {
        console.error(chalk.red('Data file contains no data rows'));
        process.exit(constants.EXIT_STATUS.ERROR);
      }
      dataRows = parsed.rows;
    }
```

（`constants.EXIT_STATUS.ERROR` 的确切键名以 `packages/bruno-cli/src/constants.js` 为准，若只有具体类别码则选最接近的通用失败码；`exists` 若无现成 util，用 `fs.existsSync`。）

option 声明（与 `--env-file` 相邻）：

```javascript
    .option('data', {
      describe: 'Path to a CSV/JSON data file — the collection runs once per data row',
      type: 'string'
    })
```

argv 解构加 `data`；文件顶部 require 加 `const { parseDataFile } = require('@usebruno/common');`（若 `cloneDeep` 未引入则一并引入）。

请求 while 循环原地套 iteration for（`currentRequestIndex`/`nJumps` 移入 for，与 Task 6 (g) 完全同构）：

```javascript
        const runtimeVariablesSnapshot = cloneDeep(runtimeVariables);
        const iterationCount = dataRows ? dataRows.length : 1;
        for (let iterationIndex = 0; iterationIndex < iterationCount; iterationIndex++) {
          if (dataRows) {
            // Reset in place — runSingleRequest holds a reference to runtimeVariables
            for (const key of Object.keys(runtimeVariables)) {
              delete runtimeVariables[key];
            }
            Object.assign(runtimeVariables, cloneDeep(runtimeVariablesSnapshot));
          }
          const dataContext = dataRows
            ? { dataVariables: dataRows[iterationIndex], iterationInfo: { index: iterationIndex, count: dataRows.length } }
            : null;

          let currentRequestIndex = 0;
          let nJumps = 0;
          while (currentRequestIndex < requestItems.length) {
            // …现有循环体，仅以下改动点…
          }

          if (stopExecution) {
            break;
          }
        }
```

循环体内改动点：
1. `runSingleRequest(...)` 调用末尾追加第 13 参 `dataContext`
2. delay 的 `isLastRun` 判定改为最后一个 iteration 的最后一个请求：`const isLastRun = iterationIndex === iterationCount - 1 && currentRequestIndex === requestItems.length - 1;`
3. `results.push({...})` 追加 `iteration: dataRows ? iterationIndex + 1 : undefined`；数据模式下 `suitename` 追加 ` [iteration N]` 后缀（junit 的 testsuite 名以此区分）
4. bail 分支为剩余 requests 合成的合成结果同样带 `iteration` 字段
5. `setNextRequest(null)` 的 `break` 只退出本 iteration 的 while（现状即如此，语义正确，勿动）
6. `stopExecution` 退出 while 后由 for 收尾的 `break` 退出整个 run（junit/html 的收尾逻辑在 for 之后，不受影响）

- [ ] **Step 6: html 报告分组**

`packages/bruno-cli/src/reporters/html.js` 现状把全部 results 包成单个 `{ iterationIndex: 0, results, summary }`。改为：数据驱动（results 中存在 `iteration` 字段）时按 `iteration - 1` 分桶，每桶各自调 `getRunnerSummary` 生成 `runnerResults` 数组——bruno-common 的 html 模板已内置 "Iteration N" 渲染（`generate-report.ts` 消费 `[{ iterationIndex, results, summary }]`），无需改模板。非数据驱动保持现状。

- [ ] **Step 7: 跑测试**

```bash
npm test --workspace=packages/bruno-cli
```
Expected: PASS（含新集成测试与既有全部 spec）

- [ ] **Step 8: 手动冒烟（可选）**

```bash
node packages/bruno-cli/src/index.js run <fixture-collection> --data <rows.csv>
```

- [ ] **Step 9: 提交**

```bash
git add packages/bruno-cli/src packages/bruno-cli/tests
git commit -m "feat(cli): add --data flag for data-driven collection runs"
```

---

### Task 10: e2e（Playwright）

**Files:**
- Create: `tests/runner/data-driven.spec.ts`
- 可能 Modify: `playwright/index.ts`（dialog stub，若尚无）

**Interfaces:**
- Consumes: Task 5-8 的全部 GUI 能力；Task 1 的数据文件

**执行要求**：动笔前先调用 **write-e2e-test** skill 加载本仓库 e2e 规范（fixtures、isolation、陷阱清单在 `.claude/rules/testing.md`）。

- [ ] **Step 1: 写 e2e**

场景（数据文件放 `tests/runner/fixtures/data-driven-rows.csv`，内容 `username,expectedStatus\nalice,200\n`；fixture collection 一个请求指向 bruno-tests 的 echo server 或本地 stub）：

1. 打开 runner（collection 右键 → Run Collection，或现有 e2e 的入口路径）
2. **原生文件对话框 stub**（Electron 下 Playwright 的 `filechooser` 事件不适用于 `dialog.showOpenDialog`；用 `electronApp.evaluate` 覆盖）：

```typescript
await electronApp.evaluate(({ dialog }, filePath) => {
  // e2e-only stub of the native open dialog
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
}, fixtureCsvPath);
```

3. 点击 `data-file-choose` → 断言 `data-file-row-count` 文本 `1 row`、`data-file-preview` 表头含 `username`
4. Run → 断言出现 2 个请求行（若 fixture 2 请求 × 2 行数据则 4 行）与 `runner-iteration-group` 分组头
5. 失败路径：写入坏 CSV（未闭合引号）→ 断言 `data-file-error` 可见且 Run 按钮 disabled
6. 响应详情：点击某行 → ResponsePane 显示该 iteration 的交换内容

- [ ] **Step 2: 跑 e2e**

```bash
npx playwright test tests/runner/data-driven.spec.ts --project=default
```
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add tests/runner playwright
git commit -m "test(e2e): cover data-driven runner flows"
```

---

## 完成定义（对照 spec 验收）

- [ ] spec §3 示例场景可完整复现（login/查询列表 × 3 行，含 skipRequest 行）
- [ ] 单发 Send 与 Runner 数据驱动共用同一用例（spec §2 双模式）
- [ ] 无数据文件时所有现有行为不变（插值、runner、CLI、报告）
- [ ] CSV/JSON 解析边界全绿；四处插值镜像优先级用例全绿
- [ ] `bru run --data` 在 CI 产出带 iteration 的 json/junit/html 报告
