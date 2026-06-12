'use strict';

const request = require('supertest');
const express = require('express');
const http = require('http');

// 重置模块级单例
beforeEach(() => {
    jest.resetModules();
    // 初始化最小化 config
    jest.mock('../../core/config', () => ({
        init: () => ({
            api_key: 'test-key',
            server: { port: 0, host: '127.0.0.1' },
            admin: { username: 'admin', password: 'test' },
            models: {
                api_base: 'http://localhost/v1',
                api_key: 'sk-test',
                primary: 'test-model',
                embedding: { model: 'test-embed', dimension: 128 },
            },
            plugins: { disabled: [] },
            security: { cors_origins: ['*'] },
            logging: { level: 'error', file: '' },
        }),
        get: () => ({ api_key: 'test-key' }),
    }));
    jest.mock('../../core/plugin_loader', () => ({
        discover: () => {},
        getTools: () => [],
        getInternals: () => [],
        get: () => null,
        plugins: new Map(),
        reload: () => ({ added: [], removed: [], updated: [], total: 0 }),
    }));
    jest.mock('../../core/memory_engine', () => ({
        init: () => {},
        recall: () => [],
        formatForContext: () => '',
        remember: () => {},
        modify: () => ({ id: 'test', changed: true }),
        reindex: () => Promise.resolve(),
    }));
    jest.mock('../../core/database', () => ({ init: () => ({ get: () => null }) }));
    jest.mock('../../core/ws_server', () => ({ init: () => {} }));
    jest.mock('../../modules/logger', () => ({
        createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
        queryLogs: () => [],
        child: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
    }));
});

describe('API Routes', () => {
    let app;

    beforeEach(() => {
        app = express();
        app.use(express.json());
        // Auth middleware — simplified for tests
        app.use((req, res, next) => {
            if (req.path === '/api/health') return next();
            const auth = req.headers.authorization;
            if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'unauthorized' });
            next();
        });
    });

    describe('GET /api/health', () => {
        test('returns ok', async () => {
            const healthRouter = require('../../routes/health');
            app.use('/api', healthRouter);
            const res = await request(app).get('/api/health');
            expect(res.status).toBe(200);
            expect(res.body.status).toBe('ok');
            expect(res.body.version).toBeDefined();
            expect(res.body.uptime).toBeGreaterThanOrEqual(0);
        });
    });

    describe('GET /api/plugins', () => {
        test('requires auth', async () => {
            const pluginsRouter = require('../../routes/plugins');
            app.use('/api', pluginsRouter);
            const res = await request(app).get('/api/plugins');
            expect(res.status).toBe(401);
        });

        test('returns empty plugins list', async () => {
            const pluginsRouter = require('../../routes/plugins');
            app.use('/api', pluginsRouter);
            const res = await request(app).get('/api/plugins').set('Authorization', 'Bearer test-key');
            expect(res.status).toBe(200);
            expect(res.body.plugins).toBeDefined();
        });
    });

    describe('GET /api/config', () => {
        test('returns sanitized config', async () => {
            const configRouter = require('../../routes/config');
            app.use('/api', configRouter);
            const res = await request(app).get('/api/config').set('Authorization', 'Bearer test-key');
            expect(res.status).toBe(200);
            expect(res.body.api_key).toBeDefined();
            expect(res.body.api_key).not.toBe('test-key'); // masked
        });
    });

    describe('GET /api/memories', () => {
        beforeEach(() => {
            jest.resetModules();
            jest.mock('../../core/database', () => ({
                init: () => {},
                get: () => ({
                    prepare: () => ({ all: () => [] }),
                    exec: () => {},
                    pragma: () => {},
                }),
            }));
            jest.mock('../../core/memory_engine', () => ({
                list: () => [],
                forget: () => {},
                modify: () => ({ id: 'test', changed: true }),
            }));
        });

        test('returns memories list', async () => {
            const memoriesRouter = require('../../routes/memories');
            app.use('/api', memoriesRouter);
            const res = await request(app).get('/api/memories').set('Authorization', 'Bearer test-key');
            expect(res.status).toBe(200);
            expect(res.body.count).toBe(0);
            expect(res.body.memories).toEqual([]);
        });
    });
});
