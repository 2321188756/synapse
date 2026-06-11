// N-API bridge — loads the compiled Rust module
const path = require('path');

// Try platform-specific .node file first (napi-rs naming), fallback to generic name
const names = [
    `synapse-vector.${process.platform}-${process.arch}-msvc.node`,
    'synapse-vector.node',
];

let mod = null;
for (const name of names) {
    try {
        mod = require(path.join(__dirname, name));
        break;
    } catch (_) {}
}

if (!mod) {
    throw new Error(
        'synapse-vector: compiled .node module not found. Run `npm run build:rust` first.'
    );
}

module.exports = mod;
