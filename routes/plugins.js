'use strict';

/**
 * 插件管理 API — GET /api/plugins, POST /api/plugins/reload, PUT /api/plugins/:name
 *
 * 修改此文件后检查: docs/接口设计.md §4
 */

const { Router } = require('express');
const router = Router();
const pluginLoader = require('../core/plugin_loader');
const config = require('../core/config');

// GET /api/plugins — 所有插件及状态
router.get('/plugins', (_req, res) => {
    const plugins = [...pluginLoader.plugins.values()].map(p => ({
        name: p.manifest.name,
        display_name: p.manifest.display_name || p.manifest.name,
        type: p.manifest.type || 'unknown',
        category: p.manifest.category || 'General',
        version: p.manifest.version || '0.0.0',
        enabled: p.manifest.enabled !== false,
        runtime: p.manifest.runtime || 'subprocess',
        config: sanitizeConfig(p.config),
    }));
    res.json({ count: plugins.length, plugins });
});

// POST /api/plugins/reload — 热重载
router.post('/plugins/reload', (_req, res) => {
    const cfg = config.get();
    const diff = pluginLoader.reload(cfg.plugins || {});
    res.json({ status: 'ok', diff });
});

// PUT /api/plugins/:name — 启用/禁用/改配置
router.put('/plugins/:name', (req, res) => {
    const plugin = pluginLoader.get(req.params.name);
    if (!plugin) return res.status(404).json({ error: '插件不存在' });

    const { enabled, config: pluginConfig } = req.body;
    if (enabled !== undefined) plugin.manifest.enabled = !!enabled;
    if (pluginConfig) {
        Object.assign(plugin.config, pluginConfig);
        // 同步写回 config.yaml（手动编辑提示）
    }

    res.json({
        name: plugin.manifest.name,
        enabled: plugin.manifest.enabled !== false,
        config: sanitizeConfig(plugin.config),
    });
});

function sanitizeConfig(cfg) {
    const clean = { ...cfg };
    if (clean.api_key) clean.api_key = 'sk-...' + clean.api_key.slice(-4);
    if (clean.TAVILY_API_KEY) clean.TAVILY_API_KEY = 'tvly-...' + clean.TAVILY_API_KEY.slice(-4);
    return clean;
}

module.exports = router;