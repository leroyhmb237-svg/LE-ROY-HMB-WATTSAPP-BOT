const pino = require('pino');

const logger = pino({
    level: 'info',
    base: null,
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    transport: process.env.NODE_ENV === 'production'
        ? undefined
        : {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'HH:MM:ss',
                ignore: 'pid,hostname'
            }
        }
});

class Logger {
    constructor(name) {
        this.name = name;
    }

    info(msg) {
        logger.info(`[${this.name}] ${msg}`);
    }

    success(msg) {
        logger.info(`[${this.name}] ✅ ${msg}`);
    }

    error(msg) {
        logger.error(`[${this.name}] ❌ ${msg}`);
    }

    warn(msg) {
        logger.warn(`[${this.name}] ⚠️ ${msg}`);
    }
}

module.exports = Logger;
