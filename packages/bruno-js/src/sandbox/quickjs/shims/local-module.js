const path = require('path');
const fs = require('fs');
const { marshallToVm } = require('../utils');
const { isPathWithinAllowedRoots } = require('../../node-vm/utils');

const OUTSIDE_COLLECTION_ERROR = 'Access to files outside of the collectionPath is not allowed.';
const moduleNotFoundError = (filename) => `Cannot find module ${filename}`;

// Same shape as the node-vm loader's message so both sandboxes report alike.
// Only used when additionalContextRoots are configured; without them the loader
// keeps the original collection-only error.
const outsideContextRootsError = (moduleName, allowedRoots) => {
  const allowedRootsDisplay = allowedRoots.map((root) => `  - ${root}`).join('\n');
  return `Access to files outside of the allowed context roots is not allowed: ${moduleName}\n\nAllowed context roots:\n${allowedRootsDisplay}`;
};

const realpathOrSelf = (rootPath) => {
  try {
    return fs.realpathSync(rootPath);
  } catch {
    return rootPath;
  }
};

// Mirrors the node-vm resolver (cjs-loader resolveLocalModulePath): exact file,
// +.js, then a directory's package.json main, falling back to its index.js.
const resolveModuleCandidate = (basePath) => {
  if (fs.existsSync(basePath) && fs.statSync(basePath).isFile()) {
    return basePath;
  }

  const withJs = `${basePath}.js`;
  if (fs.existsSync(withJs) && fs.statSync(withJs).isFile()) {
    return withJs;
  }

  if (fs.existsSync(basePath) && fs.statSync(basePath).isDirectory()) {
    const pkgPath = path.join(basePath, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.main) {
          const mainPath = path.resolve(basePath, pkg.main);
          if (fs.existsSync(mainPath)) {
            return mainPath;
          }
        }
      } catch {
        // Ignore JSON parse errors, fall through to index.js
      }
    }

    const indexPath = path.join(basePath, 'index.js');
    if (fs.existsSync(indexPath)) {
      return indexPath;
    }
  }

  return basePath;
};

/**
 * Creates the host function that loads a local module's source.
 *
 * Returns the handle without placing it on the VM global. require closes over it
 * (see addRequireShimToContext). The caller disposes the handle after require captures it.
 *
 * @param {Object} vm - QuickJS VM context
 * @param {string} collectionPath - Root relative requires resolve from; always allowed
 * @param {string[]} additionalContextRootsAbsolute - Extra allowed roots beyond the collection
 * @returns {Object} The QuickJS function handle
 */
const createLocalModuleLoaderHandle = (vm, collectionPath, additionalContextRootsAbsolute = []) => {
  return vm.newFunction('loadLocalModule', function (module) {
    const filename = vm.dump(module);

    let realCollectionPath;
    let filePath;
    try {
      // Resolve real paths on both sides so the boundary check sees the file that will actually be read
      realCollectionPath = fs.realpathSync(collectionPath);
      const candidate = resolveModuleCandidate(path.resolve(realCollectionPath, filename));
      filePath = fs.realpathSync(candidate);
    } catch (error) {
      throw new Error(moduleNotFoundError(filename));
    }

    const realRoots = [...additionalContextRootsAbsolute.map(realpathOrSelf), realCollectionPath];
    if (!isPathWithinAllowedRoots(filePath, realRoots)) {
      throw additionalContextRootsAbsolute.length
        ? new Error(outsideContextRootsError(filename, realRoots))
        : new Error(OUTSIDE_COLLECTION_ERROR);
    }

    const code = fs.readFileSync(filePath).toString();

    return marshallToVm(code, vm);
  });
};

module.exports = {
  createLocalModuleLoaderHandle,
  OUTSIDE_COLLECTION_ERROR,
  moduleNotFoundError,
  outsideContextRootsError
};
