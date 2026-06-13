'use strict';

/**
 * AgentBus — Agent 间通讯总线 (internal 插件，inline 模式)
 *
 * 用于 Agent 间消息传递。例如 Coder 完成任务后通知 Nova。
 */

const EventEmitter = require('events');

class AgentBus extends EventEmitter {
    constructor() {
        super();
        this.history = []; // 最近 100 条消息
        this.setMaxListeners(50);
    }

    /**
     * 发送消息
     * @param {string} from - 发送方 Agent 名
     * @param {string} to - 接收方 Agent 名（'*' = 广播）
     * @param {object} data
     */
    send(from, to, data) {
        const msg = { from, to, data, ts: Date.now() };
        this.history.push(msg);
        if (this.history.length > 100) this.history.shift();

        if (to === '*') {
            this.emit('broadcast', msg);
        } else {
            this.emit('msg:' + to, msg);
        }
    }

    /** 获取最近消息 */
    getHistory(limit = 20) {
        return this.history.slice(-limit);
    }
}

// 单例导出
module.exports = new AgentBus();
