'use strict';

/**
 * 插件执行器 — spawn 子进程、stdin/stdout JSON 通信、超时控制
 *
 * 修改此文件后检查: docs/架构设计.md §3.3 | docs/插件系统规范.md §4.1
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { child } = require('../modules/logger');
const log = child({ module: 'plugin_executor' });

const DEFAULT_TIMEOUT = 30000;  // 30s

/**
 * 执行单个工具调用
 * @param {object} plugin — PluginLoader.get() 返回的插件对象
 * @param {object} toolCall — { name, params }
 * @returns {Promise<{ status: 'success'|'error', content: string, error?: string, base64?: string }>}
 */
function execute(plugin, toolCall) {
    const manifest = plugin.manifest;
    const entry = manifest.entry || 'main.py';
    const entryPath = path.join(plugin.dir, entry);
    const timeout = (manifest.tool?.timeout || (DEFAULT_TIMEOUT / 1000)) * 1000;  // manifest 配的是秒 → 转毫秒

    return new Promise((resolve) => {
        // 同进程模式
        if (manifest.runtime === 'inline') {
            try {
                const result = require(entryPath).execute(toolCall.params, plugin.config);
                resolve(normalizeResult(result));
            } catch (e) {
                resolve({ status: 'error', content: '', error: e.message });
            }
            return;
        }

        // 子进程模式
        const cmd = entry.endsWith('.py') ? (process.platform === 'win32' ? 'python' : 'python3') : 'node';
        const child = spawn(cmd, [entryPath], {
            cwd: plugin.dir,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        });

        const input = JSON.stringify({ params: toolCall.params, config: plugin.config });
        let stdout = '';
        let stderr = '';

        child.stdout.on('data', d => stdout += d.toString());
        child.stderr.on('data', d => stderr += d.toString());

        const timer = setTimeout(() => {
            child.kill();
            if (!resolved) {
                resolved = true;
                log.warn(`plugin timeout: ${manifest.name} (${timeout}ms)`);
                resolve({ status: 'error', content: '', error: '执行超时 (' + timeout / 1000 + 's)' });
            }
        }, timeout);

        let resolved = false;
        child.on('close', (code) => {
            clearTimeout(timer);
            if (resolved) return;
            resolved = true;

            if (code !== 0) {
                const err = stderr || stdout || 'exit code ' + code;
                fs.appendFileSync(path.join(__dirname, '..', 'logs', 'plugin_error.log'),
                    new Date().toISOString() + ' [' + manifest.name + '] exit=' + code + '\n' + err + '\n---\n');
                log.warn('plugin FAIL ' + manifest.name + ' (saved to logs/plugin_error.log)');
                resolve({ status: 'error', content: '', error: err.slice(0, 300) });
                return;
            }
            try {
                resolve(normalizeResult(JSON.parse(stdout.trim())));
            } catch (_) {
                // stdout 可能是纯文本
                log.info('plugin stdout(raw): ' + stdout.trim().slice(0, 200), { plugin: manifest.name });
                resolve({ status: 'success', content: stdout.trim() });
            }
        });

        child.on('error', (err) => {
            clearTimeout(timer);
            if (resolved) return;
            resolved = true;
            resolve({ status: 'error', content: '', error: err.message });
        });

        child.stdin.write(input);
        child.stdin.end();
    });
}

/**
 * 并发执行多个工具调用。
 * 异步工具（params.async 或 manifest.tool.async）不阻塞，立即返回 "submitted"。
 */
async function executeBatch(pluginLoader, toolCalls) {
    const results = await Promise.all(
        toolCalls.map(async (tc) => {
            const plugin = pluginLoader.get(tc.name);
            if (!plugin) {
                return { status: 'error', content: '', error: `工具 '${tc.name}' 不存在` };
            }

            const isAsync = tc.params?.async || plugin.manifest?.tool?.async;

            if (isAsync) {
                // 异步：fire-and-forget，完成后 WS 推送
                execute(plugin, tc).then(result => {
                    try {
                        require('./ws_server').broadcast({
                            type: 'tool_result',
                            name: tc.name,
                            status: result.status,
                            content: result.content || result.error || '',
                            ts: Date.now(),
                        });
                    } catch (_) { /* ws not available */ }
                }).catch(() => {});
                log.info(`tool submitted (async): ${tc.name}`);
                return { status: 'submitted', content: `工具 ${tc.name} 已提交，完成后通知`, async: true };
            }

            const t0 = Date.now();
            const result = await execute(plugin, tc);
            log.info(`tool executed: ${tc.name} (${Date.now() - t0}ms) ${result.status}`);

            // 失败计数 + 自动禁用
            if (result.status === 'success') {
                pluginLoader.recordSuccess(tc.name);
            } else {
                pluginLoader.recordFailure(tc.name);
            }

            return result;
        })
    );
    return results;
}

function normalizeResult(r) {
    if (typeof r === 'string') return { status: 'success', content: r };
    return r;
}

module.exports = { execute, executeBatch };