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
        if (msg.key.remoteJid !== 'status@broadcast') return;
        
        const participant = msg.key.participant;
        if (!participant) return;
        
        const statusId = msg.key.id;
        
        if (this.seen.has(statusId)) return;
        this.seen.add(statusId);
        
        if (this.seen.size > this.maxCache) {
            const first = this.seen.values().next().value;
            this.seen.delete(first);
        }

        // Extraction numéro
        const number = participant.split('@')[0];
        
        if (!/^\d+$/.test(number)) {
            logger.warn(`Statut: numéro invalide ${number}`);
            return;
        }

        logger.info(`📱 Statut de +${number}`);

        try {
            let buffer = null;
            let type = 'text';
            
            if (msg.message?.imageMessage) {
                type = 'image';
                try {
                    buffer = await downloadMediaMessage(msg, 'buffer', {}, {
                        logger: { info: () => {}, error: () => {}, debug: () => {} }
                    });
                } catch (e) {}
            } else if (msg.message?.videoMessage) {
                type = 'video';
                try {
                    buffer = await downloadMediaMessage(msg, 'buffer', {}, {
                        logger: { info: () => {}, error: () => {}, debug: () => {} }
                    });
                } catch (e) {}
            }

            await TelegramForwarder.notifyStatus(number, type);
            if (buffer) {
                await TelegramForwarder.sendMedia(buffer, type);
            }

            await this.viewAndLike(msg, participant);

        } catch (error) {
            logger.error(`Status error: ${error.message}`);
        }
    }

    async viewAndLike(msg, participant) {
        const statusId = msg.key.id;
        const likeKey = `${participant}_${statusId}`;
        
        if (this.liked.has(likeKey)) return;
        
        try {
            // Vue
            await this.client.sock.readMessages([{
                remoteJid: 'status@broadcast',
                id: statusId,
                participant: participant
            }]);

            await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));

            // Like
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
            logger.success(`👁️❤️ Statut liké: +${participant.split('@')[0]}`);

        } catch (error) {
            logger.error(`Like error: ${error.message}`);
        }
    }
}

module.exports = StatusWatcher;
