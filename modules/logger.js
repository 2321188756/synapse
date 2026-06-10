'use strict';

/**
 * 运行时日志 — winston 封装，统一格式 + 分级 + 文件轮转
 *
 * 修改此文件后检查: docs/架构设计.md §3.9 | CLAUDE.md 同步矩阵
 */

const fs = require('fs');
const path = require('path');
const winston = require('winston');

// ========== 日志内存缓冲区（供 GET /api/logs 查询） ==========
const MAX_BUFFER_LINES = 5000;
const logBuffer = [];
const logDir = path.join(__dirname, '..');  // 项目根目录
let logConfig = null;

// ========== 日志格式化 ==========

const synapseFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const rid = meta.requestId ? ` [${meta.requestId}]` : '';
        const base = `${timestamp} ${level.toUpperCase()}${rid} ${message}`;
        // 如果有额外 meta 数据（非标准字段），追加为 JSON
        const extra = Object.keys(meta).filter(k => !['timestamp', 'level', 'message', 'requestId'].includes(k));
        return extra.length > 0
            ? `${base} | ${JSON.stringify(Object.fromEntries(extra.map(k => [k, meta[k]])))}`
            : base;
    })
);

// ========== 内存缓冲 transport ==========

class BufferTransport extends winston.Transport {
    log(info, callback) {
        setImmediate(() => this.emit('logged', info));
        logBuffer.push({
            timestamp: info.timestamp || new Date().toISOString(),
            level: info.level,
            message: info.message,
            requestId: info.requestId || null,
        });
        // 超过上限裁剪前半
        while (logBuffer.length > MAX_BUFFER_LINES) {
            logBuffer.shift();
        }
        callback();
    }
}

// ========== 工厂 ==========

let logger = null;

function createLogger(config) {
    logConfig = config;

    const transports = [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                synapseFormat
            ),
        }),
        new BufferTransport(),
    ];

    // 文件输出（按 config.logging.file 启用）
    if (config?.logging?.file) {
        const logFile = path.isAbsolute(config.logging.file)
            ? config.logging.file
            : path.join(logDir, config.logging.file);

        const logDirPath = path.dirname(logFile);
        if (!fs.existsSync(logDirPath)) {
            fs.mkdirSync(logDirPath, { recursive: true });
        }

        transports.push(new winston.transports.File({
            filename: logFile,
            format: synapseFormat,
            maxsize: 10 * 1024 * 1024,  // 10MB 轮转
            maxFiles: 7,
        }));
    }

    logger = winston.createLogger({
        level: config?.logging?.level || 'info',
        transports,
    });

    return logger;
}

// ========== 查询接口 ==========

/**
 * 查询内存中的日志缓冲区
 * @param {Object} filter
 * @param {string} [filter.level]  - 日志级别过滤 (error/warn/info/debug)
 * @param {number} [filter.lines]  - 返回行数，默认 100
 * @param {string} [filter.requestId] - 按请求 ID 过滤
 * @returns {Object[]}
 */
function queryLogs({ level, lines = 100, requestId } = {}) {
    let result = [...logBuffer];

    if (level) {
        const levels = ['error', 'warn', 'info', 'debug'];
        const minSeverity = levels.indexOf(level);
        result = result.filter(entry => levels.indexOf(entry.level) >= minSeverity);
    }

    if (requestId) {
        result = result.filter(entry => entry.requestId === requestId);
    }

    return result.slice(-Math.min(lines, MAX_BUFFER_LINES));
}

// ========== 便捷方法 ==========

function child(meta = {}) {
    if (!logger) {
        logger = createLogger({ logging: { level: 'info' } });
    }
    // 返回包装对象，自动附加 meta 字段
    return {
        error: (msg, extra = {}) => logger.error(msg, { ...meta, ...extra }),
        warn:  (msg, extra = {}) => logger.warn(msg, { ...meta, ...extra }),
        info:  (msg, extra = {}) => logger.info(msg, { ...meta, ...extra }),
        debug: (msg, extra = {}) => logger.debug(msg, { ...meta, ...extra }),
    };
}

module.exports = { createLogger, queryLogs, child, getLogger: () => logger };
