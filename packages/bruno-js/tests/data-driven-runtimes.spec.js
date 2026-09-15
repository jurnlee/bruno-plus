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

  it('QuickJS sandbox exposes the same APIs', async () => {
    const runtime = new ScriptRuntime({ runtime: 'quickjs' });
    const request = { url: 'http://x', dataVariables, iterationInfo, script: {} };
    const result = await runtime.runRequestScript(
      `test('row', () => { expect(bru.getData('token')).to.equal('data-token'); })`,
      request,
      {},
      {},
      '',
      () => {},
      {},
      {},
      null,
      'col'
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
      {},
      {},
      {}
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
