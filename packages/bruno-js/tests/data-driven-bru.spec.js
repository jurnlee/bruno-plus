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
