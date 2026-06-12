'use strict';

/**
 * WebSocket 服务 — 鉴权、连接池、广播
 *
 * 用于异步工具结果推送，前端调试页实时接收。
 * 修改此文件后检查: docs/架构设计.md §3.8 | docs/接口设计.md §3
 */

const { Server } = require('ws');
const { child } = require('../modules/logger');
const log = child({ module: 'ws_server' });

class WsServer {
    constructor() {
        this.wss = null;
        /** @type {Set<import('ws').WebSocket>} */
        this.clients = new Set();
    }

    /**
     * 挂载到 HTTP Server
     * @param {import('http').Server} httpServer
     * @param {string} apiKey — 鉴权用的 API Key
     */
    init(httpServer, apiKey) {
        this.wss = new Server({
            server: httpServer,
            path: '/ws',
            verifyClient: (info, cb) => {
                // 从 query string 取 token
                const url = new URL(info.req.url, 'http://localhost');
                const token = url.searchParams.get('token') || '';
                if (token === apiKey) {
                    cb(true);
                } else {
                    cb(false, 401, 'Unauthorized');
                }
            },
        });

        this.wss.on('connection', (ws) => {
            this.clients.add(ws);
            log.info('ws client connected (' + this.clients.size + ' active)');

            ws.on('close', () => {
                this.clients.delete(ws);
                log.info('ws client disconnected (' + this.clients.size + ' active)');
            });

            ws.on('error', (err) => {
                log.warn('ws error: ' + err.message);
                this.clients.delete(ws);
            });

            // 发送欢迎消息确认连接
            ws.send(JSON.stringify({ type: 'connected', ts: Date.now() }));
        });

        log.info('ws server ready (path=/ws)');
    }

    /**
     * 广播消息给所有连接的客户端
     * @param {object} data — JSON 序列化的消息体
     */
    broadcast(data) {
        const msg = JSON.stringify(data);
        let sent = 0;
        for (const ws of this.clients) {
            if (ws.readyState === 1) { // OPEN
                ws.send(msg);
                sent++;
            }
        }
        if (sent > 0) log.debug('ws broadcast: ' + data.type + ' → ' + sent + ' clients');
    }

    /** 活跃连接数 */
    get connectionCount() {
        return this.clients.size;
    }
}

module.exports = new WsServer();