const Logger = require('../utils/logger');
const TelegramForwarder = require('../utils/telegram-forwarder');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');

const logger = new Logger('Messages');

class MessageHandler {
    constructor() {
        this.messageCache = new Map();
        this.cacheMaxSize = 200;
    }

    async handle(m) {
        if (!m?.messages || !Array.isArray(m.messages)) return;

        for (const msg of m.messages) {
            try {
                await this.process(msg);
            } catch (e) {
                logger.error(`process error: ${e.message}`);
            }
        }
    }

    async process(msg) {
        if (!msg?.key?.remoteJid) return;
        if (msg.key.remoteJid === 'status@broadcast') return;
        if (msg.key.fromMe) return;

        const id = msg.key.id;
        const number = msg.key.remoteJid.split('@')[0];

        const isViewOnce =
            !!msg.message?.viewOnceMessage ||
            !!msg.message?.viewOnceMessageV2 ||
            msg.message?.imageMessage?.viewOnce ||
            msg.message?.videoMessage?.viewOnce;

        let mediaBuffer = null;
        let mediaType = null;

        if (this.hasMedia(msg) || isViewOnce) {
            try {
                mediaBuffer = await downloadMediaMessage(
                    msg,
                    'buffer',
                    {},
                    {
                        logger: { info: () => {}, error: () => {}, debug: () => {} }
                    }
                );

                mediaType = this.getMediaType(msg);
            } catch (e) {
                logger.error(`downloadMediaMessage: ${e.message}`);
            }
        }

        const text = this.extractText(msg);

        this.cacheMessage(id, number, text, mediaType);

        await this.forwardToTelegram(
            number,
            text,
            mediaType,
            mediaBuffer,
            isViewOnce
        );

        this.cleanOldCache();
    }

    hasMedia(msg) {
        return !!(
            msg.message?.imageMessage ||
            msg.message?.videoMessage ||
            msg.message?.audioMessage ||
            msg.message?.stickerMessage ||
            msg.message?.documentMessage
        );
    }

    getMediaType(msg) {
        if (msg.message?.imageMessage) return 'image';
        if (msg.message?.videoMessage) return 'video';
        if (msg.message?.audioMessage?.ptt) return 'voice';
        if (msg.message?.audioMessage) return 'audio';
        if (msg.message?.stickerMessage) return 'sticker';
        if (msg.message?.documentMessage) return 'document';
        return 'document';
    }

    async forwardToTelegram(number, text, mediaType, buffer, isViewOnce) {
        try {
            if (buffer && mediaType) {
                await TelegramForwarder.notifyMessage(number, text, mediaType, isViewOnce);
                await TelegramForwarder.sendMedia(buffer, mediaType);
            } else {
                await TelegramForwarder.notifyMessage(number, text, 'text', isViewOnce);
            }
        } catch (e) {
            logger.error(`forward error: ${e.message}`);
        }
    }

    cacheMessage(id, number, content, mediaType) {
        if (this.messageCache.size >= this.cacheMaxSize) {
            const firstKey = this.messageCache.keys().next().value;
            this.messageCache.delete(firstKey);
        }

        this.messageCache.set(id, {
            number,
            content: content || `[${mediaType || 'media'}]`,
            timestamp: Date.now()
        });
    }

    cleanOldCache() {
        const limit = Date.now() - 3600000;

        for (const [key, val] of this.messageCache.entries()) {
            if (val.timestamp < limit) {
                this.messageCache.delete(key);
            }
        }
    }

    getCachedMessage(id) {
        return this.messageCache.get(id);
    }

    extractText(msg) {
        const m = msg.message;
        if (!m) return '';

        return (
            m.conversation ||
            m.extendedTextMessage?.text ||
            m.imageMessage?.caption ||
            m.videoMessage?.caption ||
            ''
        );
    }
}

module.exports = MessageHandler;
