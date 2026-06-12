'use strict';

/**
 * 配置加载 + Schema 校验 — 单例
 * server.js 调用 init()，其他模块直接 require → get()
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

let _config = null;
let _errors = [];

function fail(msg) {
    _errors.push(msg);
}

function init(configPath) {
    const configFile = configPath || path.join(__dirname, '..', 'config.yaml');
    _errors = [];

    // 1. 文件存在
    if (!fs.existsSync(configFile)) {
        console.error('[config] config.yaml not found.');
        console.error('[config] Copy: cp config.example.yaml config.yaml');
        console.error('[config] Then edit config.yaml with your API keys.');
        process.exit(1);
    }

    // 2. YAML 解析
    try {
        _config = yaml.load(fs.readFileSync(configFile, 'utf8'));
    } catch (e) {
        console.error('[config] Invalid YAML in config.yaml:', e.message);
        process.exit(1);
    }

    if (!_config || typeof _config !== 'object') {
        console.error('[config] config.yaml is empty or malformed.');
        process.exit(1);
    }

    // 3. 必填字段校验
    if (!_config.api_key || _config.api_key === 'change-me-to-a-random-string') {
        fail('api_key: 不能使用默认值，请修改为随机字符串');
    }

    if (!_config.models?.api_base) {
        fail('models.api_base: 必填，如 http://192.168.0.123:3000/v1');
    }

    if (!_config.models?.api_key) {
        fail('models.api_key: 必填，上游 LLM API Key');
    }

    // 4. 格式校验
    if (_config.server) {
        const port = _config.server.port;
        if (port !== undefined && (port < 1 || port > 65535)) {
            fail('server.port: 必须在 1-65535 范围内，当前 ' + port);
        }
    }

    if (_config.models?.api_base && !_config.models.api_base.startsWith('http')) {
        fail('models.api_base: 必须以 http:// 或 https:// 开头');
    }

    if (_config.models?.embedding) {
        if (!_config.models.embedding.model) {
            fail('models.embedding.model: 必填，如 gemini-embedding-001');
        }
    }

    // 5. admin 默认密码警告
    if (_config.admin?.password === 'change-me-please') {
        console.warn('[config] ⚠️  admin.password 使用默认值，建议修改。');
    }

    // 6. 日志级别校验
    const validLevels = ['debug', 'info', 'warn', 'error'];
    if (_config.logging?.level && !validLevels.includes(_config.logging.level)) {
        fail(`logging.level: 无效值 "${_config.logging.level}"，可选 ${validLevels.join('/')}`);
    }

    // 汇总
    if (_errors.length > 0) {
        console.error('[config] Configuration errors found:');
        _errors.forEach(e => console.error('  ✗ ' + e));
        console.error('[config] Server refused to start. Fix config.yaml and try again.');
        process.exit(1);
    }

    return _config;
}

function get() {
    if (!_config) throw new Error('config not initialized — call init() first');
    return _config;
}

module.exports = { init, get };
