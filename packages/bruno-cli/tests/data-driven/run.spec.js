const { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } = require('@jest/globals');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { runCli } = require('../integration/helpers/run-cli');

const writeFixtureFile = (filePath, content) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
};

describe('CLI run --data (data-driven collection runs)', () => {
  let server;
  let seenUsernames;
  let port;
  let tmpDir;

  // Echo server that records the interpolated username of every request body
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        let username = null;
        try {
          username = JSON.parse(body).username;
        } catch (err) {
          username = null;
        }
        seenUsernames.push(username);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(body);
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bru-cli-data-driven-'));
    seenUsernames = [];
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  const stageCollection = () => {
    writeFixtureFile(
      path.join(tmpDir, 'bruno.json'),
      JSON.stringify({ version: '1', name: 'data-driven', type: 'collection' }, null, 2) + '\n'
    );
    writeFixtureFile(path.join(tmpDir, 'collection.bru'), 'meta {\n  name: data-driven\n  seq: 1\n}\n');
    writeFixtureFile(
      path.join(tmpDir, 'echo-user.bru'),
      `meta {
  name: echo-user
  type: http
  seq: 1
}

post {
  url: http://127.0.0.1:${port}/echo
  body: json
  auth: none
}

headers {
  content-type: application/json
}

body:json {
  {
    "username": "{{username}}"
  }
}

tests {
  test('request body carries the data row', () => {
    expect(res.body.username).to.equal(bru.getData('username'));
  });
}
`
    );
  };

  it('runs the collection once per data row and reports 1-based iterations', async () => {
    stageCollection();
    writeFixtureFile(path.join(tmpDir, 'users.csv'), 'username,password\nalice,secret-a\nbob,secret-b\n');

    const { code, stderr } = await runCli(
      ['run', 'echo-user.bru', '--data', 'users.csv', '--noproxy', '--reporter-json', 'report.json'],
      tmpDir
    );
    expect(stderr).toBe('');
    expect(code).toBe(0);

    expect(seenUsernames).toEqual(['alice', 'bob']);

    const report = JSON.parse(fs.readFileSync(path.join(tmpDir, 'report.json'), 'utf8'));
    expect(report.results.map((r) => r.iteration)).toEqual([1, 2]);
    expect(report.results.map((r) => r.suitename)).toEqual([
      expect.stringContaining('[iteration 1]'),
      expect.stringContaining('[iteration 2]')
    ]);
    report.results.forEach((r) => {
      expect(r.testResults[0].status).toBe('pass');
    });
  }, 60_000);

  it('exits before any request when the data file is invalid', async () => {
    stageCollection();
    writeFixtureFile(path.join(tmpDir, 'broken.csv'), 'username\n"unterminated\n');

    const { code, stderr } = await runCli(['run', 'echo-user.bru', '--data', 'broken.csv', '--noproxy'], tmpDir);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/Unterminated|Data file/);
    expect(seenUsernames).toEqual([]);
  }, 30_000);
});
