'use strict';

/**
 * 上下文装配 — system prompt + 变量替换 + 历史消息拼接
 *
 * 修改此文件后检查: docs/架构设计.md §3.5
 */

const dayjs = require('dayjs');
const timezone = require('dayjs/plugin/timezone');
const utc = require('dayjs/plugin/utc');
dayjs.extend(utc);
dayjs.extend(timezone);

// ========== 变量表 ==========

/**
 * 内置占位符变量。
 * Phase 1 仅支持日期和时间。Phase 2 以后扩展天气、记忆等。
 */
const BUILTIN_VARIABLES = {
    Date: () => dayjs().tz(DEFAULT_TZ).format('YYYY/M/D'),
    Time: () => dayjs().tz(DEFAULT_TZ).format('H:mm:ss'),
    Today: () => {
        const d = dayjs().tz(DEFAULT_TZ);
        const days = ['日', '一', '二', '三', '四', '五', '六'];
        return `星期${days[d.day()]}`;
    },
};

const DEFAULT_TZ = process.env.DEFAULT_TIMEZONE || 'Asia/Shanghai';

// ========== 变量替换 ==========

/**
 * 替换 system prompt 中的 {{占位符}}
 * @param {string} text - 含占位符的文本
 * @param {Object} [extras] - 额外变量 { key: value }
 * @returns {string}
 */
function replaceVariables(text, extras = {}) {
    return text.replace(/\{\{(\w+)\}\}/g, (match, name) => {
        // 额外变量优先
        if (extras[name] !== undefined) return extras[name];
        // 内置变量
        if (BUILTIN_VARIABLES[name]) return BUILTIN_VARIABLES[name]();
        // 未匹配 → 保留原样
        return match;
    });
}

// ========== 上下文装配 ==========

/**
 * 组装发送给 LLM 的完整 messages 数组
 *
 * 装配顺序：
 * 1. 加载 base system prompt
 * 2. 变量替换
 * 3. (Phase 2) 记忆注入
 * 4. (Phase 2) 工具列表注入
 * 5. 拼接历史消息
 * 6. 追加当前用户消息
 *
 * @param {Object} ctx
 * @param {string} ctx.systemPrompt - 角色 system prompt 文本
 * @param {Array<{role: string, content: string}>} ctx.history - 历史消息
 * @param {string} ctx.userMessage - 当前用户消息
 * @param {Object} ctx.variables - 额外变量
 * @returns {Array<{role: string, content: string}>}
 */
function buildMessages({ systemPrompt, history = [], userMessage, variables = {} }) {
    const messages = [];

    // Step 1+2: system prompt + 变量替换
    let sysParts = [];
    if (systemPrompt) sysParts.push(replaceVariables(systemPrompt, variables));

    // Step 3: 记忆注入（必须在 messages.push 之前完成！）
    if (variables.__memories) {
        sysParts.push(variables.__memories);
    }

    // Step 4: 工具列表注入
    if (variables.__tool_prompt) sysParts.push(variables.__tool_prompt);

    // Step 4.5: 始终注入当前日期时间 + 相对日期参照 + 防幻觉准则
    const now = dayjs().tz(DEFAULT_TZ);
    const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
    const yesterday = now.subtract(1, 'day');
    const tomorrow = now.add(1, 'day');
    const dateStr = [
        `当前时间：${now.format('YYYY年M月D日')} 星期${weekDays[now.day()]} ${now.format('H:mm:ss')}（北京时间）`,
        `昨天是 ${yesterday.format('YYYY年M月D日')}，明天是 ${tomorrow.format('YYYY年M月D日')}。`,
        '用户说「昨天/今天/明天」时，请根据以上日期推算实际日期写入记忆。',
    ].join('\n');
    sysParts.push(dateStr);

    // 防幻觉准则 + 日期规范 + 记忆写入规则
    sysParts.push([
        '【重要准则】',
        '1. 不编造信息。不知道就说不知道，不要猜测。',
        '2. 关于用户的信息只能从上方「已记录的信息」引用，不能凭空编造。',
        '3. 用户纠正你时，必须立即用 daily_note update 更新对应记忆，不要只口头认错。',
        '4. 记录记忆时，只写用户明确说过的内容，不要自己补充细节、评价或推断（用户说"不好吃"，不要加"紫菜卷很干"）。',
        '5. 将相对时间（昨天/上周）转换为具体日期（YYYY年M月D日），不要写「昨天」。',
        '6. 文件操作（创建/读取/写入/删除）必须使用 file_manager 工具，不要说"已完成"却不调用工具。',
    ].join('\n'));

    if (sysParts.length > 0) {
        messages.push({ role: 'system', content: sysParts.join('\n\n') });
    }

    // Step 5: 历史消息（最近 N 轮，默认 20）
    const maxHistory = parseInt(process.env.CONTEXT_MAX_HISTORY, 10) || 20;
    const recent = history.slice(-maxHistory * 2); // user+assistant 各算一条
    messages.push(...recent);

    // Step 6: 当前用户消息
    messages.push({ role: 'user', content: userMessage });

    return messages;
}

module.exports = { buildMessages, replaceVariables };
