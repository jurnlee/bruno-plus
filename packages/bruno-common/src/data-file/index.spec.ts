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
    const bom = String.fromCharCode(0xfeff);
    const result = parseDataFile(bom + 'a,b\r\n1,2\r\n', 'csv');
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
