'use strict';

const { buildMessages, replaceVariables } = require('../../core/context_builder');

describe('context_builder', () => {
    describe('replaceVariables', () => {
        test('replaces date/time placeholders', () => {
            const result = replaceVariables('Today is {{Date}}');
            expect(result).toMatch(/\d{4}\/\d{1,2}\/\d{1,2}/);
        });

        test('preserves unknown placeholders', () => {
            expect(replaceVariables('{{UnknownVar}}')).toBe('{{UnknownVar}}');
        });

        test('uses extra variables', () => {
            expect(replaceVariables('Hello {{name}}', { name: 'World' })).toBe('Hello World');
        });

        test('extra vars override builtins', () => {
            const result = replaceVariables('Date={{Date}}', { Date: 'custom' });
            expect(result).toBe('Date=custom');
        });
    });

    describe('buildMessages', () => {
        test('builds basic messages array', () => {
            const msgs = buildMessages({
                systemPrompt: 'You are helpful.',
                userMessage: 'Hello',
            });
            expect(msgs).toHaveLength(2);
            expect(msgs[0].role).toBe('system');
            expect(msgs[0].content).toContain('You are helpful.');
            expect(msgs[1].role).toBe('user');
            expect(msgs[1].content).toBe('Hello');
        });

        test('injects date and anti-hallucination rules', () => {
            const msgs = buildMessages({ systemPrompt: 'test', userMessage: 'hi' });
            const content = msgs[0].content;
            expect(content).toContain('当前时间');
            expect(content).toContain('北京时间');
            expect(content).toContain('不编造信息');
        });

        test('injects yesterday/tomorrow dates', () => {
            const msgs = buildMessages({ systemPrompt: 'x', userMessage: 'hi' });
            const content = msgs[0].content;
            expect(content).toContain('昨天是');
            expect(content).toContain('明天是');
        });

        test('injects memories when provided', () => {
            const msgs = buildMessages({
                systemPrompt: 'test',
                userMessage: 'hi',
                variables: { __memories: '- [mem_123] test memory' }
            });
            expect(msgs[0].content).toContain('test memory');
        });

        test('injects tool prompt', () => {
            const msgs = buildMessages({
                systemPrompt: 'test',
                userMessage: 'hi',
                variables: { __tool_prompt: 'TOOLS HERE' }
            });
            expect(msgs[0].content).toContain('TOOLS HERE');
        });

        test('handles empty system prompt gracefully', () => {
            const msgs = buildMessages({ userMessage: 'hi' });
            expect(msgs[0].role).toBe('system');
            expect(msgs[1].role).toBe('user');
        });

        test('inserts history messages', () => {
            const history = [
                { role: 'user', content: 'q1' },
                { role: 'assistant', content: 'a1' },
            ];
            const msgs = buildMessages({
                systemPrompt: 's',
                history,
                userMessage: 'q2'
            });
            expect(msgs).toHaveLength(4);
            expect(msgs[1]).toEqual(history[0]);
            expect(msgs[2]).toEqual(history[1]);
        });
    });
});
