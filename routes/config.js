'use strict';

/**
 * 配置管理 API — GET /api/config, PUT /api/config
 *
 * GET 返回脱敏后的当前配置，PUT 更新运行时可改项。
 * 修改此文件后检查: docs/接口设计.md §4
 */

const { Router } = require('express');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const router = Router();
const config = require('../core/config');

const CONFIG_PATH = path.join(__dirname, '..', 'config.yaml');

// GET /api/config — 当前配置（脱敏）
router.get('/config', (_req, res) => {
    const cfg = config.get();
    const safe = JSON.parse(JSON.stringify(cfg));
    // 脱敏
    if (safe.api_key) safe.api_key = maskKey(safe.api_key);
    if (safe.admin?.password) safe.admin.password = '****';
    if (safe.models?.api_key) safe.models.api_key = maskKey(safe.models.api_key);
    res.json(safe);
});

// PUT /api/config — 更新配置（内存生效 + 写回文件）
router.put('/config', (req, res) => {
    try {
        const updates = req.body;
        const current = config.get();

        // 只允许更新安全无关的字段
        const allowedFields = ['system_prompt', 'memory', 'plugins', 'logging', 'server'];
        for (const key of Object.keys(updates)) {
            if (allowedFields.includes(key)) {
                current[key] = { ...current[key], ...updates[key] };
            }
        }

        // 写回 config.yaml
        fs.writeFileSync(CONFIG_PATH, yaml.dump(current, { lineWidth: 120 }), 'utf8');
        // 内存中的配置已通过引用更新（config.get() 返回引用）

        res.json({ status: 'ok' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

function maskKey(key) {
    if (!key || key.length < 8) return '****';
    return key.slice(0, 4) + '-...' + key.slice(-4);
}

module.exports = router;