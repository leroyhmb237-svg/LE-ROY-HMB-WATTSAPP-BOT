const Logger = require('../utils/logger');
const TelegramForwarder = require('../utils/telegram-forwarder');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');

const logger = new Logger('StatusWatcher');

class StatusWatcher {
    constructor(client) {
        this.client = client;
        this.seen = new Set();
        this.maxCache = 100;
    }

    async handle(msg) {
        if (msg?.key?.remoteJid !== 'status@broadcast') return;

        const participant = msg?.key?.participant;
        if (!participant) return;

        const id = msg.key.id;
        if (this.seen.has(id)) return;

        this.seen.add(id);

        if (this.seen.size > this.maxCache) {
            const first = this.seen.values().next().value;
            this.seen.delete(first);
        }

        const number = participant.split('@')[0];

        let type = 'text';
        let buffer = null;

        if (msg.message?.imageMessage) type = 'image';
        if (msg.message?.videoMessage) type = 'video';

        if (type !== 'text') {
            try {
                buffer = await downloadMediaMessage(msg, 'buffer', {}, {
                    logger: { info: () => {}, error: () => {}, debug: () => {} }
                });
            } catch (e) {
                logger.error(`download status: ${e.message}`);
            }
        }

        await TelegramForwarder.notifyStatus(number, type);

        if (buffer) {
            await TelegramForwarder.sendMedia(buffer, type);
        }

        await this.react(msg, participant);
        await this.markRead(msg, participant);
    }

    async react(msg, participant) {
        try {
            await this.client.sock.sendMessage('status@broadcast', {
                react: {
                    text: '❤️',
                    key: msg.key
                }
            });
        } catch {}
    }

    async markRead(msg, participant) {
        try {
            await this.client.sock.readMessages([msg.key]);
        } catch {}
    }
}

module.exports = StatusWatcher;
