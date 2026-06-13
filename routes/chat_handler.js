'use strict';

/**
 * POST /v1/chat/completions — OpenAI 兼容聊天接口 (Phase 2: + 工具调用循环)
 *
 * 编排: context_builder → llm_client → tool_protocol → plugin_executor → loop
 * 修改此文件后检查: docs/接口设计.md §2
 */

const { Router } = require('express');
const { buildMessages } = require('../core/context_builder');
const { chat } = require('../core/llm_client');
const { parseToolCalls, hasToolCalls, generateToolPrompt } = require('../core/tool_protocol');
const { executeBatch } = require('../core/plugin_executor');
const pluginLoader = require('../core/plugin_loader');
const memoryEngine = require('../core/memory_engine');
const { execute } = require('../core/plugin_executor');
const { saveConversation } = require('./conversations');

const router = Router();
const MAX_TOOL_ROUNDS = 5;

// Static 插件缓存（key: pluginName, value: { content, ts }）
const _staticCache = new Map();
async function getStaticVariables(pluginLoader) {
    const vars = {};
    for (const p of pluginLoader.getStatics()) {
        const name = p.manifest.name;
        const interval = (p.manifest.static?.interval || 300) * 1000;
        const cached = _staticCache.get(name);
        if (cached && (Date.now() - cached.ts) < interval) {
            vars[p.manifest.static?.placeholder || name] = cached.content;
            continue;
        }
        try {
            const result = await execute(p, { name, params: {} });
            const content = result.status === 'success' ? (result.content || '') : '';
            _staticCache.set(name, { content, ts: Date.now() });
            vars[p.manifest.static?.placeholder || name] = content;
        } catch (_) { /* skip failed statics */ }
    }
    return vars;
}

// 辅助函数
function modelName(cfg) { return cfg?.primary || 'unknown'; }

function createChatRouter(modelConfig, systemPrompt, log) {
    router.post('/chat/completions', async (req, res) => {
        const requestId = req.requestId || `req_${Date.now().toString(36)}`;
        const chatLog = log || { info: () => {}, debug: () => {}, error: console.error };

        // 对话自动保存
        const allMsgs = [];
        req._synapseMessages = allMsgs;
        res.on('finish', () => {
            if (allMsgs.length > 0) {
                try { saveConversation(requestId, (allMsgs[0]?.content || '').slice(0, 50), allMsgs); } catch (_) {}
            }
        });

        try {
            const reqStart = Date.now();
            const { messages: incomingMessages, stream = true, model } = req.body;

            if (!incomingMessages || !Array.isArray(incomingMessages) || incomingMessages.length === 0) {
                return res.status(400).json({ error: { code: 'invalid_request', message: 'messages 数组不能为空' } });
            }

            // 提取系统提示 / 历史 / 用户消息
            const systemMsg = incomingMessages.find(m => m.role === 'system')?.content;
            const lastMsg = incomingMessages[incomingMessages.length - 1];
            const userMessage = lastMsg?.role === 'user' ? lastMsg.content : '';
            const history = incomingMessages.filter(m => m.role !== 'system' && m.role !== lastMsg?.role);

            chatLog.info('--- REQ ' + requestId + ' --- user=' + userMessage.slice(0, 80), { requestId });

            // 记忆召回
            const memories = await memoryEngine.recall(userMessage, 5, requestId);
            chatLog.info('memories: ' + memories.length, { requestId });
            if (memories.length > 0) {
                chatLog.info('  memory content: ' + memories.map(m => m.content).join(' | '), { requestId });
            }

            // Static 插件注入（带 60s 缓存）
            const staticVars = await getStaticVariables(pluginLoader);
            for (const [k, v] of Object.entries(staticVars)) {
                chatLog.info('  static: ' + k + '=' + v.slice(0, 60), { requestId });
            }

            // 上下文装配 (注入工具列表 + 记忆)
            const toolPrompt = generateToolPrompt(pluginLoader.getTools());
            chatLog.info('  tools injected: ' + (toolPrompt ? toolPrompt.length + ' chars' : 'none'), { requestId });

            // 展开 {AgentName} 引用
            const rawPrompt = systemMsg || systemPrompt || '你是一个有用的 AI 助手。';
            const expandedPrompt = require('../core/agent_manager').expand(rawPrompt);

            let messages = buildMessages({
                systemPrompt: expandedPrompt,
                history,
                userMessage,
                variables: {
                    __tool_prompt: toolPrompt,
                    __memories: memoryEngine.formatForContext(memories),
                    ...staticVars,
                },
            });

            chatLog.info('  messages: ' + messages.length + ' items | system=' + (messages[0]?.content || '').slice(0, 300), { requestId });

            // 记录到对话保存
            allMsgs.push({ role: 'user', content: userMessage });

            // ---- 工具调用循环 ----
            let fullContent = '';
            let toolCallCount = 0;
            const toolRounds = []; // { calls, results } 每轮保存，避免二次解析

            for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
                chatLog.info('  [round ' + round + '] calling LLM...', { requestId });
                fullContent = await chat(messages, modelConfig, { model, stream: false, requestId });
                chatLog.info('  [round ' + round + '] response: ' + fullContent.length + ' chars, hasTool=' + hasToolCalls(fullContent), { requestId, round });

                if (!hasToolCalls(fullContent)) break;

                const toolCalls = parseToolCalls(fullContent);
                chatLog.info('  [round ' + round + '] tools parsed: ' + toolCalls.length, { requestId, round });
                const results = await executeBatch(pluginLoader, toolCalls);
                toolCallCount += toolCalls.length;
                toolRounds.push({ calls: toolCalls, results });
                chatLog.info('  [round ' + round + '] results: ' + results.map(r => r.status + (r.error ? ':' + r.error : '')).join(', '), { requestId, round });

                // daily_note 结果通过 memory_engine 统一写入（不再直写 SQLite）
                for (let i = 0; i < toolCalls.length; i++) {
                    if (toolCalls[i].name !== 'DailyNote' || results[i]?.status !== 'success') continue;
                    const d = results[i]?.data || {};
                    try {
                        if (d.action === 'create') {
                            memoryEngine.remember({ content: d.content, tags: d.tags, source: 'ai_generated' });
                        } else if (d.action === 'update') {
                            const updates = {};
                            if (d.content) updates.content = d.content;
                            if (d.tags) updates.tags = d.tags;
                            memoryEngine.modify(d.id, updates);
                        }
                    } catch (e) { chatLog.warn('memory write failed: ' + e.message); }
                }

                // 追加到对话历史
                messages.push({ role: 'assistant', content: fullContent });
                for (const r of results) {
                    messages.push({ role: 'user', content: '[工具结果] ' + (r.content || r.error || '') });
                }
            }

            // ---- 最终流式输出 ----
            if (toolCallCount > 0) {
                // 工具执行过 — 非流式直接用 fullContent（工具循环最后一轮已拿到回复，不重复调 LLM）
                if (!stream) {
                    chatLog.info('chat done: ' + (Date.now() - reqStart) + 'ms (tools: ' + toolCallCount + ')', { requestId });

                    return res.json({
                        id: 'chatcmpl-' + requestId,
                        object: 'chat.completion',
                        created: Math.floor(Date.now() / 1000),
                        model: modelName(modelConfig),
                        choices: [{ index: 0, message: { role: 'assistant', content: fullContent }, finish_reason: 'stop' }],
                        usage: { prompt_tokens: Math.ceil(JSON.stringify(messages).length / 4), completion_tokens: Math.ceil(fullContent.length / 4), total_tokens: Math.ceil((JSON.stringify(messages).length + fullContent.length) / 4) },
                    });
                }

                // 流式 — 先发工具卡片，再用已有的 fullContent 流式输出（不重复调 LLM）
                res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
                res.setHeader('X-Request-ID', requestId);

                // 注入工具调用卡片
                let cardCount = 0;
                for (const tr of toolRounds) {
                    for (let i = 0; i < tr.calls.length; i++) {
                        const name = tr.calls[i].name;
                        const result = tr.results[i] || {};
                        const ok = result.status === 'success';
                        // 完整展示 AI 的工具调用参数
                        const params = tr.calls[i].params || {};
                        let rawCall = '<<<TOOL>>>\nname: ' + name;
                        for (const [k, v] of Object.entries(params)) {
                            const val = typeof v === 'string' ? v : JSON.stringify(v);
                            rawCall += '\n  ' + k + ': ' + (val.length > 200 ? val.slice(0,200) + '...' : val);
                        }
                        rawCall += '\n<<<END>>>';
                        const preview = (result.content || result.error || '').replace(/\n/g, '\\n');
                        const cardData = JSON.stringify({ t: name, s: ok ? 'ok' : 'fail', p: preview, r: rawCall });
                        sseWrite(res, requestId, modelName(modelConfig), '🔧TOOL' + cardData);
                        cardCount++;
                    }
                }
                chatLog.info('tool cards injected: ' + cardCount, { requestId });

                // 用已有的 fullContent 伪流式输出，不重复调 LLM
                const streamGen = fakeStream(fullContent);
                return streamResponse(res, streamGen, requestId, modelConfig, chatLog, reqStart, toolCallCount);
            }

            // 无工具调用 — 直接流式
            if (!stream) {
                chatLog.info('chat done: ' + (Date.now() - reqStart) + 'ms', { requestId });
                return res.json({
                    id: 'chatcmpl-' + requestId,
                    object: 'chat.completion',
                    created: Math.floor(Date.now() / 1000),
                    model: modelName(modelConfig),
                    choices: [{ index: 0, message: { role: 'assistant', content: fullContent }, finish_reason: 'stop' }],
                    usage: { prompt_tokens: Math.ceil(JSON.stringify(messages).length / 4), completion_tokens: Math.ceil(fullContent.length / 4), total_tokens: Math.ceil((JSON.stringify(messages).length + fullContent.length) / 4) },
                });
            }

            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Request-ID', requestId);

            // 复用 loop 中 chat() 已拿到的 fullContent，不重复调 LLM
            const streamGen = fakeStream(fullContent);
            return streamResponse(res, streamGen, requestId, modelConfig, chatLog, reqStart, 0);

        } catch (err) {
            chatLog.error('chat error: ' + err.message, { requestId });
            if (res.headersSent) {
                sseWrite(res, requestId, modelConfig, '\n\n[错误] ' + err.message);
                res.write('data: [DONE]\n\n');
                return res.end();
            }
            res.status(503).json({ error: { code: 'upstream_error', message: err.message, request_id: requestId } });
        }
    });

    return router;
}

/** 把已有文本转成流式生成器，避免重复调用 LLM */
async function* fakeStream(text) {
    // 每次吐出少量字符，模拟打字效果
    const chunkSize = 3;
    for (let i = 0; i < text.length; i += chunkSize) {
        yield { content: text.slice(i, Math.min(i + chunkSize, text.length)) };
    }
}

function sseWrite(res, requestId, modelConfig, content) {
    res.write('data: ' + JSON.stringify({
        id: 'chatcmpl-' + requestId, object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000), model: modelName(modelConfig),
        choices: [{ index: 0, delta: { content: content }, finish_reason: null }],
    }) + '\n\n');
}

async function streamResponse(res, streamGen, requestId, modelConfig, chatLog, reqStart, toolCount) {
    for await (const chunk of streamGen) {
        res.write('data: ' + JSON.stringify({
            id: 'chatcmpl-' + requestId, object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000), model: modelName(modelConfig),
            choices: [{ index: 0, delta: { content: chunk.content }, finish_reason: chunk.finish || null }],
        }) + '\n\n');
    }
    res.write('data: ' + JSON.stringify({
        id: 'chatcmpl-' + requestId, object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000), model: modelName(modelConfig),
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    }) + '\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
    chatLog.info('chat done: ' + (Date.now() - reqStart) + 'ms' + (toolCount ? ' (tools: ' + toolCount + ')' : ''), { requestId });
}

module.exports = createChatRouter;
