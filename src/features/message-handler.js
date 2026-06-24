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
        if (m.type !== 'notify') return;

        for (const msg of m.messages) {
            await this.process(msg);
        }
    }

    async process(msg) {
        if (!msg.key.remoteJid) return;
        if (msg.key.remoteJid === 'status@broadcast') return;
        if (msg.key.fromMe) return;

        const id = msg.key.id;
        const jid = msg.key.remoteJid;
        
        const isGroup = jid.endsWith('@g.us');
        const isContact = jid.endsWith('@s.whatsapp.net');
        
        if (!isGroup && !isContact) return;

        let identifier, senderNumber, groupName = null;
        
        if (isGroup) {
            identifier = jid.split('@')[0];
            groupName = msg.pushName || 'Groupe';
            senderNumber = msg.participant ? msg.participant.split('@')[0] : 'Inconnu';
        } else {
            identifier = jid.split('@')[0];
            senderNumber = identifier;
        }

        if (!/^\d+$/.test(identifier)) return;

        const isViewOnce = !!(
            msg.message?.viewOnceMessage ||
            msg.message?.viewOnceMessageV2 ||
            msg.message?.viewOnceMessageV2Extension ||
            msg.message?.imageMessage?.viewOnce ||
            msg.message?.videoMessage?.viewOnce
        );

        let mediaBuffer = null;
        let mediaType = null;
        
        if (isViewOnce || this.hasMedia(msg)) {
            try {
                mediaBuffer = await downloadMediaMessage(msg, 'buffer', {}, {
                    logger: { info: () => {}, error: () => {}, debug: () => {} }
                });
                mediaType = this.getMediaType(msg);
            } catch (e) {
                logger.error(`Erreur DL: ${e.message}`);
            }
        }

        const text = this.extractText(msg);
        
        this.cacheMessage(id, identifier, text, mediaType, isGroup, groupName, senderNumber);
        
        await this.forwardToTelegram(identifier, text, mediaType, mediaBuffer, isViewOnce, isGroup, groupName, senderNumber);
        
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

    async forwardToTelegram(identifier, text, mediaType, buffer, isViewOnce, isGroup, groupName, senderNumber) {
        try {
            if (mediaType && buffer) {
                await TelegramForwarder.notifyMessage(identifier, text, mediaType, isViewOnce, isGroup, groupName, senderNumber);
                await TelegramForwarder.sendMedia(buffer, mediaType);
            } else {
                await TelegramForwarder.notifyMessage(identifier, text, 'text', isViewOnce, isGroup, groupName, senderNumber);
            }
        } catch (error) {
            logger.error(`Forward error: ${error.message}`);
        }
    }

    cacheMessage(id, identifier, content, mediaType, isGroup, groupName, senderNumber) {
        if (this.messageCache.size >= this.cacheMaxSize) {
            const firstKey = this.messageCache.keys().next().value;
            this.messageCache.delete(firstKey);
        }
        
        this.messageCache.set(id, {
            identifier,
            content: content || `[${mediaType || 'média'}]`,
            isGroup,
            groupName,
            senderNumber,
            timestamp: Date.now()
        });
    }

    cleanOldCache() {
        const oneHourAgo = Date.now() - (60 * 60 * 1000);
        for (const [key, value] of this.messageCache.entries()) {
            if (value.timestamp < oneHourAgo) {
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
        
        if (m.viewOnceMessage?.message?.conversation) {
            return m.viewOnceMessage.message.conversation;
        }
        if (m.viewOnceMessageV2?.message?.conversation) {
            return m.viewOnceMessageV2.message.conversation;
        }
        if (m.viewOnceMessageV2Extension?.message?.conversation) {
            return m.viewOnceMessageV2Extension.message.conversation;
        }
        
        return m.conversation || 
               m.extendedTextMessage?.text ||
               m.imageMessage?.caption ||
               m.videoMessage?.caption ||
               '';
    }
}

module.exports = MessageHandler;
