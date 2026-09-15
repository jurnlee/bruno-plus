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
