'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const TEST_CONFIG = path.join(__dirname, '..', '..', 'data', 'test_config.yaml');

beforeEach(() => {
    jest.resetModules();
    if (fs.existsSync(TEST_CONFIG)) fs.unlinkSync(TEST_CONFIG);
});

function writeConfig(obj) {
    fs.writeFileSync(TEST_CONFIG, yaml.dump(obj), 'utf8');
}

describe('config validation', () => {
    test('rejects missing api_key', () => {
        writeConfig({ server: { port: 5890 } });
        const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
        const mockError = jest.spyOn(console, 'error').mockImplementation(() => {});
        expect(() => require('../../core/config').init(TEST_CONFIG)).toThrow('exit');
        mockExit.mockRestore();
        mockError.mockRestore();
    });

    test('rejects default api_key', () => {
        writeConfig({ api_key: 'change-me-to-a-random-string', models: { api_base: 'http://x', api_key: 'sk' } });
        const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
        expect(() => require('../../core/config').init(TEST_CONFIG)).toThrow('exit');
        mockExit.mockRestore();
    });

    test('rejects missing models.api_base', () => {
        writeConfig({ api_key: 'sk-test', models: { api_key: 'sk' } });
        const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
        expect(() => require('../../core/config').init(TEST_CONFIG)).toThrow('exit');
        mockExit.mockRestore();
    });

    test('rejects invalid port', () => {
        writeConfig({ api_key: 'sk-test', models: { api_base: 'http://x', api_key: 'sk' }, server: { port: 99999 } });
        const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
        expect(() => require('../../core/config').init(TEST_CONFIG)).toThrow('exit');
        mockExit.mockRestore();
    });

    test('rejects non-http api_base', () => {
        writeConfig({ api_key: 'sk-test', models: { api_base: 'ftp://bad', api_key: 'sk' } });
        const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
        expect(() => require('../../core/config').init(TEST_CONFIG)).toThrow('exit');
        mockExit.mockRestore();
    });

    test('rejects invalid log level', () => {
        writeConfig({ api_key: 'sk-test', models: { api_base: 'http://x', api_key: 'sk' }, logging: { level: 'verbose' } });
        const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
        expect(() => require('../../core/config').init(TEST_CONFIG)).toThrow('exit');
        mockExit.mockRestore();
    });

    test('accepts valid config', () => {
        writeConfig({
            api_key: 'sk-valid',
            models: { api_base: 'http://localhost:3000/v1', api_key: 'sk', primary: 'test', embedding: { model: 'e', dimension: 128 } },
            server: { port: 5890, host: '0.0.0.0' },
            logging: { level: 'info', file: '' },
            admin: { username: 'admin', password: 'pass' },
        });
        const config = require('../../core/config').init(TEST_CONFIG);
        expect(config.api_key).toBe('sk-valid');
        expect(config.models.api_base).toBe('http://localhost:3000/v1');
    });
});
