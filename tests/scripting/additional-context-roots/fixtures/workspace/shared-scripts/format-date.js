// Dependency-free so the quickjs sandbox (safe mode) can require it too —
// utils.js needs the signature-utils npm package, which only nodevm resolves.
function formatDate(input) {
  return new Date(input).toISOString().slice(0, 10);
}

module.exports = { formatDate };
