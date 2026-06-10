'use strict';

/**
 * 工具协议 — YAML 块解析 + AI 工具描述生成
 *
 * 协议格式: <<<TOOL>>>\nname: xxx\nparams:\n  ...\n<<<END>>>
 * 修改此文件后检查: docs/架构设计.md §3.4 | docs/工具协议规范.md
 */

const yaml = require('js-yaml');

// ========== 解析 ==========

const TOOL_RE = /<<<TOOL>>>\s*\n([\s\S]*?)<<<END>>>/g;

/**
 * 从 AI 响应中提取工具调用块，解析为结构化对象
 * @returns {Array<{ name: string, params: object, raw: string }>}
 */
function parseToolCalls(text) {
    if (typeof text !== 'string') return [];
    TOOL_RE.lastIndex = 0;
    const calls = [];
    let m;
    while ((m = TOOL_RE.exec(text)) !== null) {
        try {
            const data = yaml.load(m[1].trim());
            if (data && typeof data === 'object' && data.name) {
                calls.push({ name: data.name, params: data.params || {}, raw: m[0] });
            }
        } catch (_) { /* 跳过解析失败的块 */ }
    }
    return calls;
}

function hasToolCalls(text) {
    return typeof text === 'string' && text.includes('<<<TOOL>>>');
}

// ========== 生成工具描述 (注入 system prompt) ==========

/**
 * 根据插件注册表生成 AI 可读的工具列表
 * @param {Array<{ manifest: object }>} plugins — plugin_loader 提供的插件列表
 */
function generateToolPrompt(plugins) {
    const tools = plugins.filter(p => p.manifest && p.manifest.type === 'tool' && p.manifest.enabled !== false);

    if (tools.length === 0) return '';

    const lines = [
        '', '## 行为准则（重要）', '',
        '- 不要编造你不知道的信息。如果搜索无结果或记忆中没有，直接告诉用户你不知道。',
        '- 关于用户的信息，只能从上方「已记录的信息」中获取，不要猜测或编造。',
        '- 只有当问题需要查找最新资讯、实时数据时才使用 web_search，日常对话不需要搜索。',
        '', '## 可用工具', '', '工具调用方法：直接输出以下格式', '', '```', '<<<TOOL>>>', 'name: <工具名>', 'params:', '  <参数>: <值>', '<<<END>>>', '```', '',
    ];

    for (const { manifest } of tools) {
        const t = manifest.tool || {};
        lines.push(`### ${manifest.display_name} (\`${manifest.name}\`)`);
        lines.push('');
        if (t.instruction) lines.push(t.instruction.trim());
        lines.push('');

        const params = t.parameters || {};
        const paramNames = Object.keys(params);
        if (paramNames.length > 0) {
            lines.push('**参数：**');
            for (const name of paramNames) {
                const p = params[name];
                const req = p.required ? '必填' : '可选';
                const def = p.default !== undefined ? `，默认: ${p.default}` : '';
                const enm = p.enum ? ` (${p.enum.join('/')})` : '';
                lines.push(`- \`${name}\` (${p.type || 'string'}, ${req}${def}): ${p.description || ''}${enm}`);
            }
            lines.push('');
        }

        if (t.examples && t.examples.length) {
            lines.push('**示例：**');
            for (const ex of t.examples) {
                lines.push(`// ${ex.description}`);
                lines.push('```');
                lines.push(ex.call.trim());
                lines.push('```');
                lines.push('');
            }
        }
        lines.push('---');
        lines.push('');
    }

    return lines.join('\n');
}

module.exports = { parseToolCalls, hasToolCalls, generateToolPrompt };