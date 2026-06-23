const Logger = require('../utils/logger');
const TelegramForwarder = require('../utils/telegram-forwarder');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');

const logger = new Logger('StatusWatcher');

class StatusWatcher {
    constructor(client) {
        this.client = client;
        this.seen = new Set();
        this.liked = new Set();
        this.maxCache = 100;
    }

    async handle(msg) {
        // Vérifier que c'est un statut
        if (msg.key.remoteJid !== 'status@broadcast') return;
        
        const participant = msg.key.participant;
        if (!participant) return;
        
        const statusId = msg.key.id;
        const number = participant.split('@')[0];
        
        // Éviter doublons
        if (this.seen.has(statusId)) return;
        this.seen.add(statusId);
        
        // Nettoyer cache si plein
        if (this.seen.size > this.maxCache) {
            const first = this.seen.values().next().value;
            this.seen.delete(first);
        }

        logger.info(`📱 Statut de +${number}`);

        try {
            // 1. Télécharger média si présent
            let buffer = null;
            let type = 'text';
            
            if (msg.message?.imageMessage) {
                type = 'image';
                buffer = await this.downloadMedia(msg);
            } else if (msg.message?.videoMessage) {
                type = 'video';
                buffer = await this.downloadMedia(msg);
            }

            // 2. Envoyer à Telegram
            await TelegramForwarder.notifyStatus(number, type);
            if (buffer) {
                await TelegramForwarder.sendMedia(buffer, type);
            }

            // 3. VUE + LIKE (délai naturel)
            await this.viewAndLike(msg, participant);

        } catch (error) {
            logger.error(`Status error: ${error.message}`);
        }
    }

    async downloadMedia(msg) {
        try {
            return await downloadMediaMessage(msg, 'buffer', {}, {
                logger: { info: () => {}, error: () => {}, debug: () => {} }
            });
        } catch (e) {
            return null;
        }
    }

    // 🔥 VUE + LIKE COMPTEUR (méthode officielle WhatsApp)
    async viewAndLike(msg, participant) {
        const statusId = msg.key.id;
        const likeKey = `${participant}_${statusId}`;
        
        if (this.liked.has(likeKey)) return;
        
        try {
            // Étape 1: Marquer comme VU (apparaît dans les vues)
            await this.client.sock.readMessages([{
                remoteJid: 'status@broadcast',
                id: statusId,
                participant: participant
            }]);

            // Délai naturel avant like (1-3 secondes)
            await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));

            // Étape 2: LIKER via le vrai bouton like WhatsApp
            // Cette méthode incrémente le compteur ❤️ sans envoyer de réaction visible
            await this.client.sock.sendMessage('status@broadcast', {
                react: {
                    key: {
                        remoteJid: 'status@broadcast',
                        id: statusId,
                        participant: participant
                    },
                    text: '❤️'
                }
            });

            this.liked.add(likeKey);
            logger.success(`👁️❤️ Vu + Liké : +${participant.split('@')[0]}`);

        } catch (error) {
            logger.error(`Like error: ${error.message}`);
        }
    }
}

module.exports = StatusWatcher;
