'use strict';

/**
 * 配置加载 — 单例，server.js 调用 init()，其他模块直接 require
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

let _config = null;

function init(configPath) {
    const configFile = configPath || path.join(__dirname, '..', 'config.yaml');
    if (!fs.existsSync(configFile)) {
        console.error('[config] config.yaml not found. Copy config.example.yaml -> config.yaml');
        process.exit(1);
    }
    _config = yaml.load(fs.readFileSync(configFile, 'utf8'));

    if (!_config.api_key || _config.api_key === 'change-me-to-a-random-string') {
        console.error('[config] api_key is still default. Server refused to start.');
        process.exit(1);
    }
    return _config;
}

function get() {
    if (!_config) throw new Error('config not initialized — call init() first');
    return _config;
}

module.exports = { init, get };
