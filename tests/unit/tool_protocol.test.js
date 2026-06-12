'use strict';

const { parseToolCalls, hasToolCalls, generateToolPrompt } = require('../../core/tool_protocol');

describe('tool_protocol', () => {
    describe('parseToolCalls', () => {
        test('parses single tool call', () => {
            const text = `<<<TOOL>>>
name: web_search
params:
  query: test
<<<END>>>`;
            const calls = parseToolCalls(text);
            expect(calls).toHaveLength(1);
            expect(calls[0].name).toBe('web_search');
            expect(calls[0].params.query).toBe('test');
        });

        test('parses multiple tool calls', () => {
            const text = `<<<TOOL>>>
name: web_search
params:
  query: hello
<<<END>>>
<<<TOOL>>>
name: daily_note
params:
  title: test
  content: some content
<<<END>>>`;
            const calls = parseToolCalls(text);
            expect(calls).toHaveLength(2);
            expect(calls[0].name).toBe('web_search');
            expect(calls[1].name).toBe('daily_note');
        });

        test('returns empty array for text without tools', () => {
            expect(parseToolCalls('hello world')).toEqual([]);
            expect(parseToolCalls('')).toEqual([]);
            expect(parseToolCalls(null)).toEqual([]);
        });

        test('skips malformed YAML blocks', () => {
            const text = `<<<TOOL>>>
::: bad yaml :::
<<<END>>>`;
            expect(parseToolCalls(text)).toEqual([]);
        });

        test('skips blocks without name field', () => {
            const text = `<<<TOOL>>>
params:
  x: 1
<<<END>>>`;
            expect(parseToolCalls(text)).toEqual([]);
        });
    });

    describe('hasToolCalls', () => {
        test('detects tool marker', () => {
            expect(hasToolCalls('<<<TOOL>>>')).toBe(true);
            expect(hasToolCalls('hello <<<TOOL>>> world')).toBe(true);
            expect(hasToolCalls('no tools here')).toBe(false);
            expect(hasToolCalls('')).toBe(false);
            expect(hasToolCalls(null)).toBe(false);
        });
    });

    describe('generateToolPrompt', () => {
        test('returns empty for empty plugins', () => {
            expect(generateToolPrompt([])).toBe('');
        });

        test('filters out non-tool plugins', () => {
            const plugins = [
                { manifest: { name: 'internal', type: 'internal', enabled: true } },
                { manifest: { name: 'static', type: 'static', enabled: true } },
            ];
            expect(generateToolPrompt(plugins)).toBe('');
        });

        test('generates prompt for tool plugins', () => {
            const plugins = [
                {
                    manifest: {
                        name: 'test_tool',
                        display_name: 'Test',
                        type: 'tool',
                        enabled: true,
                        tool: {
                            instruction: 'A test tool.',
                            parameters: {
                                query: { type: 'string', required: true, description: 'query param' }
                            }
                        }
                    }
                }
            ];
            const prompt = generateToolPrompt(plugins);
            expect(prompt).toContain('test_tool');
            expect(prompt).toContain('A test tool');
            expect(prompt).toContain('query');
        });

        test('excludes disabled tools', () => {
            const plugins = [
                { manifest: { name: 'enabled', type: 'tool', enabled: true, tool: { instruction: 'on' } } },
                { manifest: { name: 'disabled', type: 'tool', enabled: false, tool: { instruction: 'off' } } },
            ];
            const prompt = generateToolPrompt(plugins);
            expect(prompt).toContain('enabled');
            expect(prompt).not.toContain('disabled');
        });
    });
});
