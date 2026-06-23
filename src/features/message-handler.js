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
        
        // Ignorer status@broadcast (déjà géré par status-watcher)
        if (msg.key.remoteJid === 'status@broadcast') return;
        
        // Ignorer messages envoyés par moi
        if (msg.key.fromMe) return;

        const id = msg.key.id;
        const jid = msg.key.remoteJid;
        
        // 🔥 DÉTECTION : Groupe ou Contact ?
        const isGroup = jid.endsWith('@g.us');
        const isContact = jid.endsWith('@s.whatsapp.net');
        
        if (!isGroup && !isContact) return; // Ignorer autres formats
        
        // Extraction infos
        let identifier, senderName, groupName = null;
        
        if (isGroup) {
            // GROUPE : ID du groupe + nom de l'expéditeur dans le groupe
            identifier = jid.split('@')[0]; // ID groupe
            groupName = msg.pushName || 'Groupe inconnu'; // Nom du groupe
            senderName = msg.participant ? msg.participant.split('@')[0] : 'Membre'; // Qui a envoyé
        } else {
            // CONTACT : Numéro direct
            identifier = jid.split('@')[0];
            senderName = msg.pushName || 'Inconnu';
        }

        // Vérifier numéro valide
        if (!/^\d+$/.test(identifier)) {
            logger.warn(`ID invalide ignoré: ${identifier}`);
            return;
        }

        // 🔥 DÉTECTION VIEW-ONCE (v1, v2, extension)
        const isViewOnce = !!(
            msg.message?.viewOnceMessage ||
            msg.message?.viewOnceMessageV2 ||
            msg.message?.viewOnceMessageV2Extension ||
            msg.message?.imageMessage?.viewOnce ||
            msg.message?.videoMessage?.viewOnce
        );

        // Téléchargement média
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
        
        // Cache pour anti-delete
        this.cacheMessage(id, identifier, text, mediaType, isGroup, groupName, senderName);
        
        // 🔥 ENVOI avec distinction Groupe/Contact
        await this.forwardToTelegram(identifier, text, mediaType, mediaBuffer, isViewOnce, isGroup, groupName, senderName);
        
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

    async forwardToTelegram(identifier, text, mediaType, buffer, isViewOnce, isGroup, groupName, senderName) {
        try {
            if (mediaType && buffer) {
                await TelegramForwarder.notifyMessage(identifier, text, mediaType, isViewOnce, isGroup, groupName, senderName);
                await TelegramForwarder.sendMedia(buffer, mediaType);
            } else {
                await TelegramForwarder.notifyMessage(identifier, text, 'text', isViewOnce, isGroup, groupName, senderName);
            }
        } catch (error) {
            logger.error(`Forward error: ${error.message}`);
        }
    }

    cacheMessage(id, identifier, content, mediaType, isGroup, groupName, senderName) {
        if (this.messageCache.size >= this.cacheMaxSize) {
            const firstKey = this.messageCache.keys().next().value;
            this.messageCache.delete(firstKey);
        }
        
        this.messageCache.set(id, {
            identifier,
            content: content || `[${mediaType || 'média'}]`,
            isGroup,
            groupName,
            senderName,
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
        
        // View-once texte
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
