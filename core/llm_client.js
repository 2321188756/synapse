'use strict';

/**
 * LLM 调用封装 — 统一接口、SSE 流式、自动检测协议、容灾回退
 *
 * 修改此文件后检查: docs/架构设计.md §3.7 | docs/接口设计.md §5
 */

const axios = require('axios');
const { child } = require('../modules/logger');
const log = child({ module: 'llm_client' });

// ========== 工具函数 ==========

function safeStringify(obj) {
    if (typeof obj === 'string') return obj;
    try { return JSON.stringify(obj); }
    catch (_) {
        // JSON 化失败 → 返回 key 列表
        try { return JSON.stringify(Object.keys(obj || {})); }
        catch (__) { return String(obj).slice(0, 500); }
    }
}

// ========== 协议自动检测 ==========

function isAnthropic(apiBase) {
    return apiBase && apiBase.includes('anthropic.com');
}

function buildRequest(messages, config, model) {
    const stream = config.stream ?? true;
    const maxTokens = config.max_tokens || 4096;

    if (isAnthropic(config.api_base)) {
        const systemMsg = messages.find(m => m.role === 'system');
        const conversation = messages.filter(m => m.role !== 'system');
        return {
            url: (config.api_base || '').replace(/\/$/, '') + '/messages',
            headers: {
                'x-api-key': config.api_key,
                'anthropic-version': '2023-06-01',
                'Content-Type': 'application/json; charset=utf-8',
            },
            body: {
                model: model || config.model,
                system: systemMsg?.content || '',
                messages: conversation,
                stream,
                temperature: config.temperature ?? 0.7,
                max_tokens: maxTokens,
            },
        };
    }

    // OpenAI 兼容 (NewAPI / one-api / Ollama / vLLM 全走这里)
    return {
        url: (config.api_base || 'https://api.openai.com/v1').replace(/\/$/, '') + '/chat/completions',
        headers: {
            Authorization: 'Bearer ' + config.api_key,
            'Content-Type': 'application/json; charset=utf-8',
        },
        body: { model: model || config.model, messages, stream, temperature: config.temperature ?? 0.7, max_tokens: maxTokens },
    };
}

function parseChunk(chunk, apiBase) {
    if (isAnthropic(apiBase)) {
        if (chunk.type === 'content_block_delta') return { content: chunk.delta?.text || '', finish: null };
        if (chunk.type === 'message_stop') return { content: '', finish: 'stop' };
        return { content: '', finish: null };
    }
    const delta = chunk.choices?.[0]?.delta?.content;
    const finish = chunk.choices?.[0]?.finish_reason;
    return { content: delta || '', finish };
}

// ========== 模型路由 ==========

function routeModel(messages, routingConfig) {
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';
    const is = kw => kw.some(k => lastUserMsg.includes(k));

    if (is(['代码', '编程', 'bug', '函数', '类', 'API', 'GitHub', '重构', '优化']))
        return routingConfig.coding || routingConfig.default;
    if (is(['写文章', '故事', '诗歌', '创意', '设计', '角色扮演']))
        return routingConfig.creative || routingConfig.default;
    if (lastUserMsg.length < 20)
        return routingConfig.fast || routingConfig.default;
    return routingConfig.default;
}

// ========== 候选模型展开 ==========

function expandCandidate(modelConfig, candidate) {
    const name = typeof candidate === 'string' ? candidate : candidate.model;
    const result = {
        model: name,
        api_base: modelConfig.api_base,
        api_key: modelConfig.api_key,
    };
    // 只在有值时传递，避免 undefined 覆盖默认值
    if (typeof candidate === 'object') {
        if (candidate.max_tokens != null) result.max_tokens = candidate.max_tokens;
        if (candidate.stream != null) result.stream = candidate.stream;
        if (candidate.temperature != null) result.temperature = candidate.temperature;
    }
    return result;
}

// ========== SSE 流式调用 ==========

async function* chatStream(messages, modelConfig, options = {}) {
    const candidate = expandCandidate(modelConfig, { model: modelConfig.primary, ...options });
    const { url, headers, body } = buildRequest(messages, { ...modelConfig, ...candidate }, options.model || candidate.model);
    const modelName = candidate.model || 'unknown';
    const label = isAnthropic(modelConfig.api_base) ? 'anthropic' : 'openai';

    const t0 = Date.now();
    const rid = options.requestId ? ` [${options.requestId}]` : '';
    log.info('LLM call -> ' + label + ':' + modelName + rid, { model: modelName, url, requestId: options.requestId });

    const isStreaming = body.stream !== false;
    log.debug('LLM request: ' + url + ' | model=' + (body.model || '?'), { url, model: body.model, stream: body.stream });
    const resp = await axios.post(url, body, {
        headers,
        responseType: isStreaming ? 'stream' : 'json',
        timeout: 120_000,
        family: 4,
        validateStatus: null,
    });

    if (resp.status !== 200) {
        let errBody = '';
        if (isStreaming) {
            for await (const chunk of resp.data) errBody += chunk.toString();
        } else {
            errBody = safeStringify(resp.data);
        }
        log.error('LLM fail: ' + label + ':' + modelName + ' HTTP ' + resp.status + ' body=' + errBody.slice(0, 300), { status: resp.status });
        throw new Error('LLM API ' + resp.status + ': ' + errBody.slice(0, 500));
    }

    // 非流式 → 直接解析 JSON 返回
    if (!isStreaming) {
        const data = resp.data;
        if (isAnthropic(modelConfig.api_base)) {
            const text = data.content?.[0]?.text || '';
            yield { content: text, finish: text ? 'stop' : null };
        } else {
            const text = data.choices?.[0]?.message?.content || '';
            yield { content: text, finish: text ? 'stop' : null };
        }
        log.info('LLM done: ' + label + ':' + modelName + ' (' + (Date.now() - t0) + 'ms)');
        return;
    }

    // 流式 → SSE 解析
    let buf = '';
    for await (const chunk of resp.data) {
        buf += chunk.toString('utf8');
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
            const s = line.trim();
            if (!s || !s.startsWith('data: ')) continue;
            const data = s.slice(6);
            if (data === '[DONE]') { log.info('LLM done: ' + label + ':' + modelName + ' (' + (Date.now() - t0) + 'ms)'); return; }
            try {
                const r = parseChunk(JSON.parse(data), modelConfig.api_base);
                if (r.content) yield r;
                if (r.finish === 'stop') return;
            } catch (_) { /* skip */ }
        }
    }
    log.info('LLM done: ' + label + ':' + modelName + ' (' + (Date.now() - t0) + 'ms)');
}

// ========== 容灾回退 ==========

async function* chatStreamWithFallback(messages, modelConfig, options = {}) {
    // model: auto → 直接走 primary，不路由（路由由 routing:auto 显式触发）
    const modelName = (options.model === 'auto' || !options.model)
        ? (typeof modelConfig.primary === 'string' ? modelConfig.primary : modelConfig.primary?.model)
        : options.model;

    const primary = expandCandidate(modelConfig, { ...options, model: modelName });
    const fallbacks = (modelConfig.fallback || []).map(f => expandCandidate(modelConfig, f));

    // 去重：从 fallback 中移除与 primary 同名的模型
    const unique = [];
    const seen = new Set([primary.model]);
    for (const f of fallbacks) {
        if (!seen.has(f.model)) { seen.add(f.model); unique.push(f); }
    }
    const candidates = [primary, ...unique];
    const errors = [];

    for (const c of candidates) {
        try {
            const stream = chatStream(messages, modelConfig, { ...options, ...c });  // c 覆盖 options
            for await (const chunk of stream) yield chunk;
            return;
        } catch (e) {
            const name = c.model || 'unknown';
            const detail = e.response ? (safeStringify(e.response.data).slice(0, 200)) : e.message;
            log.warn('LLM failover: ' + name + ' -> next | ' + detail, { failed: name });
            errors.push(name + ': ' + detail);
            const idx = candidates.indexOf(c);
            if (idx < candidates.length - 1) {
                await new Promise(r => setTimeout(r, Math.min(1000 * (idx + 1), 5000)));
            }
        }
    }
    log.error('All models failed: ' + errors.join('; '));
    throw new Error('All models failed: ' + errors.join('; '));
}

async function chat(messages, modelConfig, options = {}) {
    let full = '';
    // 始终流式收集（兼容 NewAPI 等只支持流式的网关）
    const stream = chatStreamWithFallback(messages, modelConfig, { ...options, stream: true });
    for await (const chunk of stream) full += chunk.content;
    return full;
}

module.exports = { chatStreamWithFallback, chat, routeModel };
