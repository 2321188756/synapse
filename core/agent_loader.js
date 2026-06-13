'use strict';

/**
 * Agent 加载器 — 读取 agents/*.txt，解析 {AgentName} 引用
 *
 * 修改此文件后检查: docs/架构设计.md
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const AGENTS_DIR = path.join(__dirname, '..', 'agents');
const MAPPING_FILE = path.join(AGENTS_DIR, 'mapping.yaml');

let _mapping = null;
let _agents = new Map(); // name → prompt text

function discover() {
    if (!fs.existsSync(MAPPING_FILE)) return;
    _mapping = yaml.load(fs.readFileSync(MAPPING_FILE, 'utf8')) || {};
    _agents.clear();

    for (const [name, file] of Object.entries(_mapping)) {
        const filePath = path.join(AGENTS_DIR, file);
        if (fs.existsSync(filePath)) {
            const text = fs.readFileSync(filePath, 'utf8');
            _agents.set(name, text);
        }
    }
}

/**
 * 展开 prompt 中的 {AgentName} 引用
 * @param {string} prompt - 含 {Name} 引用的 prompt
 * @returns {string} 展开后的 prompt
 */
function expandRefs(prompt) {
    if (!prompt || typeof prompt !== 'string') return prompt;
    return prompt.replace(/\{(\w+)\}/g, (match, name) => {
        if (_agents.has(name)) return _agents.get(name);
        return match; // 不在 mapping 中的引用保留原样
    });
}

function getMapping() { return _mapping || {}; }
function getAgents() { return _agents; }

module.exports = { discover, expandRefs, getMapping, getAgents };
