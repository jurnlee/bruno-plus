const { describe, it, expect, beforeAll, afterAll } = require('@jest/globals');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { executeQuickJsVmAsync } = require('../src/sandbox/quickjs');
const {
  OUTSIDE_COLLECTION_ERROR,
  outsideContextRootsError
} = require('../src/sandbox/quickjs/shims/local-module');

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-local-module-roots-')));
const workspace = path.join(root, 'workspace');
const collectionA = path.join(workspace, 'collectionA');
const sharedScripts = path.join(workspace, 'shared-scripts');
const outside = path.join(root, 'outside');

// Windows needs admin or Developer Mode to create symlinks. CI runners have it,
// local accounts often do not, so skip when the fixture cannot be built.
const symlinksSupported = (() => {
  try {
    const probe = path.join(root, 'symlink-probe');
    fs.symlinkSync(path.join(root, 'workspace'), probe, 'dir');
    fs.rmSync(probe);
    return true;
  } catch (e) {
    return e.code !== 'EPERM';
  }
})();

describe('quickjs local module loader with additionalContextRoots', () => {
  beforeAll(() => {
    fs.mkdirSync(collectionA, { recursive: true });
    fs.mkdirSync(path.join(sharedScripts, 'deep', 'nested'), { recursive: true });
    fs.mkdirSync(path.join(sharedScripts, 'dirmod'), { recursive: true });
    fs.mkdirSync(path.join(sharedScripts, 'pkgmod'), { recursive: true });
    fs.mkdirSync(outside, { recursive: true });

    fs.writeFileSync(path.join(sharedScripts, 'utils.js'), 'module.exports = { scope: "shared utils" };');
    fs.writeFileSync(
      path.join(sharedScripts, 'deep', 'nested', 'nested-helper.js'),
      'module.exports = "nested helper";'
    );
    fs.writeFileSync(
      path.join(sharedScripts, 'aggregates-nested.js'),
      'module.exports = require("./deep/nested/nested-helper");'
    );
    fs.writeFileSync(path.join(sharedScripts, 'dirmod', 'index.js'), 'module.exports = "from index";');
    fs.writeFileSync(path.join(sharedScripts, 'pkgmod', 'entry.js'), 'module.exports = "from pkg main";');
    fs.writeFileSync(
      path.join(sharedScripts, 'pkgmod', 'package.json'),
      JSON.stringify({ name: 'pkgmod', main: './entry.js' })
    );
    fs.writeFileSync(path.join(sharedScripts, 'escapes.js'), 'module.exports = require("../../outside/secret");');
    fs.writeFileSync(path.join(outside, 'secret.js'), 'module.exports = "SECRET FROM OUTSIDE";');
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const runScript = async (script, { scriptingConfig, collectionPath = collectionA } = {}) => {
    let value;
    let error;
    const bru = {
      cwd: () => collectionPath,
      setVar: (_name, loaded) => {
        value = loaded;
      }
    };

    try {
      await executeQuickJsVmAsync({ script, context: { bru }, collectionPath, scriptingConfig });
    } catch (e) {
      error = e;
    }

    return { value, error };
  };

  it('loads a module from a relative additionalContextRoot', async () => {
    const { value, error } = await runScript(`bru.setVar('v', require('../shared-scripts/utils').scope)`, {
      scriptingConfig: { additionalContextRoots: ['../shared-scripts'] }
    });
    expect(error).toBeUndefined();
    expect(value).toBe('shared utils');
  });

  it('loads a module from an absolute additionalContextRoot', async () => {
    const { value, error } = await runScript(`bru.setVar('v', require('../shared-scripts/utils').scope)`, {
      scriptingConfig: { additionalContextRoots: [sharedScripts] }
    });
    expect(error).toBeUndefined();
    expect(value).toBe('shared utils');
  });

  it('resolves a nested relative require inside the shared root', async () => {
    const { value, error } = await runScript(`bru.setVar('v', require('../shared-scripts/aggregates-nested'))`, {
      scriptingConfig: { additionalContextRoots: ['../shared-scripts'] }
    });
    expect(error).toBeUndefined();
    expect(value).toBe('nested helper');
  });

  it('resolves a directory through its index.js', async () => {
    const { value, error } = await runScript(`bru.setVar('v', require('../shared-scripts/dirmod'))`, {
      scriptingConfig: { additionalContextRoots: ['../shared-scripts'] }
    });
    expect(error).toBeUndefined();
    expect(value).toBe('from index');
  });

  it('resolves a directory through its package.json main', async () => {
    const { value, error } = await runScript(`bru.setVar('v', require('../shared-scripts/pkgmod'))`, {
      scriptingConfig: { additionalContextRoots: ['../shared-scripts'] }
    });
    expect(error).toBeUndefined();
    expect(value).toBe('from pkg main');
  });

  it('still loads collection-local modules alongside the shared root', async () => {
    fs.writeFileSync(path.join(collectionA, 'local.js'), 'module.exports = "collection local";');
    const { value, error } = await runScript(
      `bru.setVar('v', require('./local') + '/' + require('../shared-scripts/utils').scope)`,
      { scriptingConfig: { additionalContextRoots: ['../shared-scripts'] } }
    );
    expect(error).toBeUndefined();
    expect(value).toBe('collection local/shared utils');
  });

  it('reports a path beyond every root with the context-roots message', async () => {
    const { error } = await runScript(`require('../../outside/secret.js')`, {
      scriptingConfig: { additionalContextRoots: ['../shared-scripts'] }
    });
    const expectedRoots = [fs.realpathSync(sharedScripts), fs.realpathSync(collectionA)];
    expect(error.message).toBe(outsideContextRootsError('../../outside/secret.js', expectedRoots));
  });

  it('rejects a shared module that itself requires outside every root', async () => {
    const { error } = await runScript(`require('../shared-scripts/escapes')`, {
      scriptingConfig: { additionalContextRoots: ['../shared-scripts'] }
    });
    expect(error.message).toContain('Access to files outside of the allowed context roots');
  });

  it('reports a missing module inside the shared root as module not found', async () => {
    const { error } = await runScript(`require('../shared-scripts/does-not-exist')`, {
      scriptingConfig: { additionalContextRoots: ['../shared-scripts'] }
    });
    expect(error.message).toBe(`Cannot find module ../shared-scripts/does-not-exist`);
  });

  it('keeps the collection-only message when no additionalContextRoots are configured', async () => {
    const { error } = await runScript(`require('../shared-scripts/utils')`);
    expect(error.message).toBe(OUTSIDE_COLLECTION_ERROR);
  });

  const describeIfSymlinks = symlinksSupported ? describe : describe.skip;
  describeIfSymlinks('with symlinks', () => {
    beforeAll(() => {
      fs.symlinkSync(path.join(outside, 'secret.js'), path.join(sharedScripts, 'link.js'), 'file');
    });

    it('rejects a shared-root symlink whose target lies outside every root', async () => {
      const { error } = await runScript(`require('../shared-scripts/link.js')`, {
        scriptingConfig: { additionalContextRoots: ['../shared-scripts'] }
      });
      expect(error.message).toContain('Access to files outside of the allowed context roots');
    });
  });
});
