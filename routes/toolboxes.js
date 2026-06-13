'use strict';

const { Router } = require('express');
const router = Router();
const pluginLoader = require('../core/plugin_loader');

// GET /api/toolboxes
router.get('/toolboxes', (_req, res) => {
    const boxes = pluginLoader.getToolboxes();
    const result = [];
    for (const [name, plugins] of boxes) {
        result.push({ name, plugins, count: plugins.length });
    }
    res.json({ toolboxes: result });
});

// PUT /api/toolboxes/:name — 启用/禁用整个工具箱
router.put('/toolboxes/:name', (req, res) => {
    const target = req.params.name;
    const { enabled } = req.body;
    const boxes = pluginLoader.getToolboxes();
    const box = boxes.get(target);
    if (!box) return res.status(404).json({ error: '工具箱不存在' });

    let changed = 0;
    for (const p of box) {
        const plugin = pluginLoader.get(p.name);
        if (plugin && plugin.manifest.enabled !== !!enabled) {
            plugin.manifest.enabled = !!enabled;
            changed++;
        }
    }
    res.json({ name: target, enabled, plugins_changed: changed });
});

module.exports = router;
