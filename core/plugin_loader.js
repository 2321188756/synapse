'use strict';

/**
 * 插件加载器 — 扫描 plugins/ 目录、解析 manifest.yaml、热重载
 *
 * 修改此文件后检查: docs/架构设计.md §3.2 | docs/插件系统规范.md
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { child } = require('../modules/logger');
const log = child({ module: 'plugin_loader' });

const PLUGINS_DIR = path.join(__dirname, '..', 'plugins');

class PluginLoader {
    constructor() {
        /** @type {Map<string, { dir: string, manifest: object, config: object }>} */
        this.plugins = new Map();
    }

    /**
     * 扫描 plugins/ 目录，加载所有有效插件
     * @param {object} globalPluginConfig — config.yaml 中 plugins 段的配置
     */
    discover(globalPluginConfig = {}) {
        if (!fs.existsSync(PLUGINS_DIR)) {
            fs.mkdirSync(PLUGINS_DIR, { recursive: true });
            log.info('plugins/ directory created');
            return;
        }

        const entries = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
            this._loadPlugin(entry.name, globalPluginConfig);
        }
        log.info(`plugins loaded: ${this.plugins.size} active`);
    }

    _loadPlugin(dirName, globalPluginConfig) {
        const dir = path.join(PLUGINS_DIR, dirName);
        const manifestFile = path.join(dir, 'manifest.yaml');
        if (!fs.existsSync(manifestFile)) return;

        try {
            const manifest = yaml.load(fs.readFileSync(manifestFile, 'utf8'));
            if (!manifest || !manifest.name) { log.warn(`invalid manifest in ${dirName}`); return; }
            if (manifest.enabled === false) { log.info(`plugin disabled: ${manifest.name}`); return; }

            // 从 manifest.config schema 提取默认值，再用 config.yaml 覆盖
            const defaults = {};
            if (manifest.config) {
                for (const [key, schema] of Object.entries(manifest.config)) {
                    if (schema && typeof schema === 'object') {
                        defaults[key] = schema.default !== undefined ? schema.default : '';
                    } else {
                        defaults[key] = schema;  // 简单值
                    }
                }
            }
            const pluginConfig = { ...defaults, ...(globalPluginConfig[manifest.name] || {}) };

            this.plugins.set(manifest.name, { dir, manifest, config: pluginConfig });
            log.info(`plugin loaded: ${manifest.name} (${manifest.type || 'unknown'})`);
        } catch (e) {
            log.error(`failed to load plugin ${dirName}: ${e.message}`);
        }
    }

    /** 返回所有工具类插件 (type: tool) */
    getTools() {
        return [...this.plugins.values()]
            .filter(p => p.manifest.type === 'tool' && p.manifest.enabled !== false);
    }

    /** 返回所有 preprocessor 插件 (type: preprocessor)，按 priority 排序 */
    getPreprocessors() {
        return [...this.plugins.values()]
            .filter(p => p.manifest.type === 'preprocessor' && p.manifest.enabled !== false)
            .sort((a, b) => (a.manifest.preprocessor?.priority || 100) - (b.manifest.preprocessor?.priority || 100));
    }

    /** 返回所有 static 插件 (type: static) */
    getStatics() {
        return [...this.plugins.values()]
            .filter(p => p.manifest.type === 'static' && p.manifest.enabled !== false);
    }

    /** 返回所有 internal 插件 (type: internal) — 供 core 模块消费，不注入工具列表 */
    getInternals() {
        return [...this.plugins.values()]
            .filter(p => p.manifest.type === 'internal' && p.manifest.enabled !== false);
    }

    /** 根据名称获取插件 */
    get(name) {
        return this.plugins.get(name) || null;
    }

    /** 热重载，返回变更 diff */
    reload(globalPluginConfig) {
        const oldNames = new Set(this.plugins.keys());
        this.plugins.clear();
        this.discover(globalPluginConfig);
        const newNames = new Set(this.plugins.keys());

        const added = [...newNames].filter(n => !oldNames.has(n));
        const removed = [...oldNames].filter(n => !newNames.has(n));
        const updated = [...newNames].filter(n => oldNames.has(n));

        return { added, removed, updated, total: this.plugins.size };
    }
}

module.exports = new PluginLoader();