const path = require('path');
const { createLocalModuleLoaderHandle } = require('./local-module');

/**
 * Resolves the additionalContextRoots the same way the node-vm sandbox does:
 * relative roots hang off the collection path. The collection root itself is
 * always allowed on top of these (enforced by the loader).
 *
 * @param {string} [collectionPath] - Collection directory
 * @param {Object} [scriptingConfig] - bruno.json `scripts` block
 * @returns {string[]} Normalized absolute additional roots
 */
const resolveAllowedRoots = (collectionPath, scriptingConfig) => {
  const additionalContextRoots = scriptingConfig?.additionalContextRoots || [];
  return additionalContextRoots.map((root) =>
    path.normalize(path.isAbsolute(root) ? root : path.join(collectionPath, root))
  );
};

/**
 * Returns a factory function (as VM source) that installs globalThis.require.
 *
 * The factory takes the host loader as an argument, so require closes over it and the
 * loader is never placed on the VM global where user scripts could call it directly.
 *
 * @returns {string} JavaScript source of the factory, to eval then call with the loader
 */
function getRequireFactoryCode() {
  return `
    (loadLocalModule) => {
      globalThis.require = (mod) => {
        let lib = globalThis.requireObject[mod];
        // Bare names resolve against requireObject only; relative and absolute paths go
        // to the host loader, which owns the boundary check (incl. additionalContextRoots).
        let isModuleAPath = (module) => Boolean(module && (module.startsWith('.') || module.startsWith('/') || /^[a-zA-Z]:[\\\\/]/.test(module)))
        if (lib) {
          return lib;
        }
        else if (isModuleAPath(mod)) {
          // fetch local module
          let localModuleCode = loadLocalModule(mod);

          // compile local module. Function compiles it in global scope, so it cannot
          // reach this closure or loadLocalModule.
          const module = { exports: {} };
          let require = (subModule) => isModuleAPath(subModule)
            ? globalThis.require(path.resolve(bru.cwd(), mod, '..', subModule))
            : globalThis.require(subModule);
          new Function('module', 'exports', 'require', localModuleCode)(module, module.exports, require);
          globalThis.requireObject[mod] = module.exports;

          // resolve module
          return globalThis.requireObject[mod];
        }
        else {
          throw new Error("Cannot find module " + mod);
        }
      }
    }
  `;
}

/**
 * Installs require() into a QuickJS VM context.
 * @param {Object} vm - QuickJS VM context
 * @param {string} [collectionPath] - Root local modules resolve from
 * @param {Object} [scriptingConfig] - bruno.json `scripts` block; its
 * `additionalContextRoots` widen the local-module boundary across collections
 */
function addRequireShimToContext(vm, collectionPath, scriptingConfig) {
  const allowedRoots = resolveAllowedRoots(collectionPath, scriptingConfig);
  createLocalModuleLoaderHandle(vm, collectionPath, allowedRoots).consume((loadLocalModule) => {
    const evalCode = vm.evalCodeRetained || vm.evalCode;
    const fn = vm.unwrapResult(evalCode.call(vm, getRequireFactoryCode()));
    try {
      vm.unwrapResult(vm.callFunction(fn, vm.global, loadLocalModule)).dispose();
    } finally {
      fn.dispose();
    }
  });
}

module.exports = {
  getRequireFactoryCode,
  addRequireShimToContext,
  resolveAllowedRoots
};
