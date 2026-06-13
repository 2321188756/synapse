'use strict';

/**
 * Agent 管理器 — Agent 实例化、引用解析、上下文路由
 */

const agentLoader = require('./agent_loader');
const { child } = require('../modules/logger');
const log = child({ module: 'agent_manager' });

class AgentManager {
    constructor() {
        this.registry = new Map(); // name → { prompt, tools: [], memory: 'private' }
        this.active = null;        // 当前活跃 Agent 名
        this._init = false;
    }

    init() {
        agentLoader.discover();
        const agents = agentLoader.getAgents();

        for (const [name, text] of agents) {
            const tools = this._parseToolHeader(text);
            this.registry.set(name, { prompt: text, tools, memory: 'private' });
        }

        // 默认激活 Nova
        if (this.registry.has('Nova')) {
            this.active = 'Nova';
        } else if (agents.size > 0) {
            this.active = [...agents.keys()][0];
        }

        this._init = true;
        log.info('agent manager ready: ' + this.registry.size + ' agents, active=' + this.active);
    }

    /** 解析 `# tools: ...` 首行声明 */
    _parseToolHeader(text) {
        const firstLine = text.split('\n')[0] || '';
        const match = firstLine.match(/^#\s*tools:\s*(.+)/i);
        if (!match) return [];
        const tools = match[1].trim();
        if (tools.toLowerCase() === 'none') return [];
        return tools.split(',').map(t => t.trim()).filter(Boolean);
    }

    /** 获取当前活跃 Agent 的设定 */
    getActivePrompt() {
        if (!this.active) return '';
        const agent = this.registry.get(this.active);
        return agent ? agent.prompt : '';
    }

    /** 获取当前活跃 Agent 的工具白名单（空数组 = 全部可用） */
    getActiveTools() {
        if (!this.active) return [];
        const agent = this.registry.get(this.active);
        return agent ? agent.tools : [];
    }

    /** 切换 Agent（通过 AgentBus 广播切换事件） */
    switchTo(name) {
        if (this.registry.has(name)) {
            const prev = this.active;
            this.active = name;
            try {
                const bus = require('../plugins/AgentBus/main');
                bus.send(prev || 'system', name, { type: 'agent_switch', from: prev, to: name });
            } catch (_) { /* AgentBus not loaded */ }
            return true;
        }
        return false;
    }

    /** 展开 prompt 中的 {AgentName} 引用 */
    expand(prompt) {
        return agentLoader.expandRefs(prompt);
    }
}

module.exports = new AgentManager();
