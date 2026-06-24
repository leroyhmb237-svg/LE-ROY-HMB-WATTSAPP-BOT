const axios = require('axios');
const FormData = require('form-data');
const Logger = require('./logger');

const logger = new Logger('Telegram');

class TelegramForwarder {
    constructor() {
        this.botToken = process.env.TELEGRAM_BOT_TOKEN;
        this.chatId = process.env.TELEGRAM_CHAT_ID;
        this.apiUrl = this.botToken ? `https://api.telegram.org/bot${this.botToken}` : null;
        this.lastSent = 0;
        this.minDelay = 800;
        this.qrMessageIds = [];
        this.lastQRTime = 0;
        this.qrCooldown = 5000;
        this.isCleaning = false;
    }

    isConfigured() {
        return !!(this.botToken && this.chatId);
    }

    async throttle() {
        const now = Date.now();
        const wait = this.minDelay - (now - this.lastSent);
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
        this.lastSent = Date.now();
    }

    async cleanupOldQRs() {
        if (this.isCleaning) {
            await new Promise(r => setTimeout(r, 1000));
        }
        
        if (this.qrMessageIds.length === 0) return;
        
        this.isCleaning = true;
        
        for (const messageId of this.qrMessageIds) {
            try {
                await axios.post(`${this.apiUrl}/deleteMessage`, {
                    chat_id: this.chatId,
                    message_id: messageId
                });
                await new Promise(r => setTimeout(r, 300));
            } catch (e) {}
        }
        
        this.qrMessageIds = [];
        this.isCleaning = false;
    }

    async sendQRImage(qrDataUrl) {
        if (!this.isConfigured()) return;
        
        const now = Date.now();
        if (now - this.lastQRTime < this.qrCooldown) {
            logger.warn('QR ignoré (cooldown)');
            return;
        }
        this.lastQRTime = now;
        
        await this.cleanupOldQRs();
        await new Promise(r => setTimeout(r, 500));

        try {
            const base64Data = qrDataUrl.replace(/^data:image\/png;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');
            
            const form = new FormData();
            form.append('chat_id', this.chatId);
            form.append('photo', buffer, { filename: 'qr-code.png' });
            form.append('caption', 
                '🤖 ✦ 𝗛𝗠𝗕 𝗕𝗢𝗧 ✦\n\n' +
                '📱 𝐍𝐎𝐔𝐕𝐄𝐀𝐔 𝐐𝐑 𝐂𝐎𝐃𝐄\n\n' +
                '🔐 Statut : 𝘀𝗲𝘀𝘀𝗶𝗼𝗻 𝘀𝗲́𝗰𝘂𝗿𝗶𝘀𝗲́𝗲\n' +
                '📲 Action : 𝙨𝙘𝙖𝙣𝙣𝙚𝙯 𝙥𝙤𝙪𝙧 𝙘𝙤𝙣𝙣𝙚𝙘𝙩𝙚𝙧\n' +
                '⏱ Durée : 20 secondes\n\n' +
                '✨ État : 𝗢𝗡𝗟𝗜𝗡𝗘 🟢'
            );
            
            const response = await axios.post(`${this.apiUrl}/sendPhoto`, form, {
                headers: form.getHeaders(),
                timeout: 15000
            });
            
            if (response.data?.result?.message_id) {
                this.qrMessageIds.push(response.data.result.message_id);
            }
            
        } catch (error) {
            await this.sendMessage(
                '🤖 ✦ 𝗛𝗠𝗕 𝗕𝗢𝗧 ✦\n\n' +
                '📱 𝐐𝐑 𝐂𝐎𝐃𝐄\n' +
                '🔗 ' + (process.env.RENDER_EXTERNAL_URL || 'dashboard')
            );
        }
    }

    // 🔥 SUPPRIMÉ : notifyQR() causait les doublons

    async sendMessage(text, retry = 2) {
        if (!this.isConfigured()) return;
        await this.throttle();

        try {
            await axios.post(`${this.apiUrl}/sendMessage`, {
                chat_id: this.chatId,
                text,
                parse_mode: 'HTML'
            }, { timeout: 10000 });
        } catch (error) {
            if (retry > 0) {
                await new Promise(r => setTimeout(r, 1500));
                return this.sendMessage(text, retry - 1);
            }
        }
    }

    async sendMedia(buffer, type, caption = '') {
        if (!this.isConfigured() || !buffer || !Buffer.isBuffer(buffer)) return;

        await this.throttle();

        try {
            const form = new FormData();
            form.append('chat_id', this.chatId);

            const typeConfig = {
                image: { field: 'photo', filename: 'image.jpg', endpoint: 'sendPhoto' },
                video: { field: 'video', filename: 'video.mp4', endpoint: 'sendVideo' },
                audio: { field: 'audio', filename: 'audio.mp3', endpoint: 'sendAudio' },
                voice: { field: 'voice', filename: 'voice.ogg', endpoint: 'sendVoice' },
                sticker: { field: 'sticker', filename: 'sticker.webp', endpoint: 'sendSticker' },
                document: { field: 'document', filename: 'file.pdf', endpoint: 'sendDocument' }
            };

            const config = typeConfig[type] || typeConfig.document;
            form.append(config.field, buffer, { filename: config.filename });
            
            if (caption) form.append('caption', caption.substring(0, 1024));

            await axios.post(`${this.apiUrl}/${config.endpoint}`, form, {
                headers: form.getHeaders(),
                timeout: 30000
            });
        } catch (error) {
            logger.error(`sendMedia: ${error.message}`);
        }
    }

    async notifyConnected() {
        return this.sendMessage(
            '🤖 ✦ 𝗛𝗠𝗕 𝗕𝗢𝗧 ✦\n\n' +
            '🟢 𝐁𝐎𝐓 𝐂𝐎𝐍𝐍𝐄𝐂𝐓𝐄́\n\n' +
            '🔐 Statut : 𝘢𝘶𝘵𝘩𝘦𝘯𝘵𝘪𝘧𝘪𝘤𝘢𝘵𝘪𝘰𝘯 𝘳𝘦́𝘶𝘴𝘴𝘪𝘦\n' +
            '📡 Connexion : 𝙨𝙩𝙖𝙗𝙡𝙚\n' +
            '👥 Groupes : 𝐚𝐜𝐭𝐢𝐟𝐬\n' +
            '💌 Contacts : 𝐚𝐜𝐭𝐢𝐟𝐬\n\n' +
            '✨ État : 𝘰𝘱𝘦́𝘳𝘢𝘵𝘪𝘰𝘯𝘯𝘦𝘭'
        );
    }

    async notifyDisconnected() {
        return this.sendMessage(
            '🤖 ✦ 𝗛𝗠𝗕 𝗕𝗢𝗧 ✦\n\n' +
            '🔴 𝐁𝐎𝐓 𝐃𝐄́𝐂𝐎𝐍𝐍𝐄𝐂𝐓𝐄́\n\n' +
            '⚠️ Statut : 𝘴𝘦𝘴𝘴𝘪𝘰𝘯 𝘪𝘯𝘵𝘦𝘳𝘳𝘰𝘮𝘱𝘶𝘦\n' +
            '📡 Connexion : 𝙥𝙚𝙧𝙙𝙪𝙚\n\n' +
            '⏳ État : 𝐞𝐧 𝐚𝐭𝐭𝐞𝐧𝐭𝐞 𝐝𝐞 𝐫𝐞𝐜𝐨𝐧𝐧𝐞𝐱𝐢𝐨𝐧'
        );
    }

    async notifyMessage(identifier, text, type, isViewOnce = false, isGroup = false, groupName = null, senderNumber = null) {
        let message = '🤖 ✦ 𝗛𝗠𝗕 𝗕𝗢𝗧 ✦\n\n';
        
        if (isGroup) {
            message += '👥 𝐌𝐄𝐒𝐒𝐀𝐆𝐄 𝐃𝐄 𝐆𝐑𝐎𝐔𝐏𝐄\n\n' +
                      `🏷 Groupe : ${groupName || 'Inconnu'}\n` +
                      `👤 Auteur : +${senderNumber || 'Inconnu'}\n`;
        } else {
            const typeLabels = {
                text: '💌 𝐍𝐎𝐔𝐕𝐄𝐀𝐔 𝐌𝐄𝐒𝐒𝐀𝐆𝐄',
                image: '📷 𝐍𝐎𝐔𝐕𝐄𝐋𝐋𝐄 𝐈𝐌𝐀𝐆𝐄',
                video: '🎥 𝐍𝐎𝐔𝐕𝐄𝐋𝐋𝐄 𝐕𝐈𝐃𝐄́𝐎',
                audio: '🎵 𝐍𝐎𝐔𝐕𝐄𝐋 𝐀𝐔𝐃𝐈𝐎',
                voice: '🎙️ 𝐍𝐎𝐔𝐕𝐄𝐀𝐔 𝐕𝐎𝐂𝐀𝐋',
                document: '📎 𝐍𝐎𝐔𝐕𝐄𝐀𝐔 𝐃𝐎𝐂𝐔𝐌𝐄𝐍𝐓',
                sticker: '😀 𝐍𝐎𝐔𝐕𝐄𝐀𝐔 𝐒𝐓𝐈𝐂𝐊𝐄𝐑'
            };
            
            const header = typeLabels[type] || typeLabels.text;
            message += `${header}\n\n` +
                      `👤 Source : +${identifier}\n`;
        }

        if (type === 'text') {
            message += `💬 Contenu : 𝙢𝙚𝙨𝙨𝙖𝙜𝙚 𝙧𝙚𝙘̧𝙪`;
        } else {
            message += `🖼️ Média : ${type} reçu`;
        }
        
        message += '\n\n✨ Statut : 𝐧𝐨𝐭𝐢𝐟𝐢𝐜𝐚𝐭𝐢𝐨𝐧 𝐫𝐞𝐜̧𝐮𝐞';

        if (isViewOnce) {
            message += '\n\n⚠️ 𝐕𝐈𝐄𝐖 𝐎𝐍𝐂𝐄 𝐃𝐄́𝐓𝐄𝐂𝐓𝐄́\n\n' +
                      '🔓 Statut : protection active\n' +
                      '📥 Média : contenu reçu\n' +
                      '👁️ État : lecture unique\n\n' +
                      '✨ Résultat : 𝐧𝐨𝐭𝐢𝐟𝐢𝐜𝐚𝐭𝐢𝐨𝐧 𝐜𝐚𝐩𝐭𝐮𝐫𝐞́𝐞';
        }

        return this.sendMessage(message);
    }

    async notifyStatus(number, type) {
        const typeLabel = type === 'image' ? 'image' : type === 'video' ? 'vidéo' : 'média';
        
        return this.sendMessage(
            '🤖 ✦ 𝗛𝗠𝗕 𝗕𝗢𝗧 ✦\n\n' +
            '📱 𝐍𝐎𝐔𝐕𝐄𝐀𝐔 𝐒𝐓𝐀𝐓𝐔𝐓\n\n' +
            `👤 Numéro : +${number}\n` +
            `📂 Type : ${typeLabel}\n\n` +
            '✨ État : 𝐜𝐚𝐩𝐭𝐮𝐫𝐞́ 𝐚𝐯𝐞𝐜 𝐬𝐮𝐜𝐜𝐞̀𝐬'
        );
    }

    async notifyDeleted(identifier, content, isGroup = false, groupName = null, senderNumber = null) {
        let message = '🤖 ✦ 𝗛𝗠𝗕 𝗕𝗢𝗧 ✦\n\n';
        
        if (isGroup) {
            message += '🗑️ 𝐌𝐄𝐒𝐒𝐀𝐆𝐄 𝐒𝐔𝐏𝐏𝐑𝐈𝐌𝐄́ 𝐃𝐔 𝐆𝐑𝐎𝐔𝐏𝐄\n\n' +
                      `🏷 Groupe : ${groupName || 'Inconnu'}\n` +
                      `👤 Auteur : +${senderNumber || 'Inconnu'}\n`;
        } else {
            message += '🗑️ 𝐌𝐄𝐒𝐒𝐀𝐆𝐄 𝐒𝐔𝐏𝐏𝐑𝐈𝐌𝐄́\n\n' +
                      `👤 Source : +${identifier}\n`;
        }
        
        message += `📄 Contenu : ${content || '[média]'}\n\n` +
                  '⚠️ Statut : 𝐬𝐮𝐩𝐩𝐫𝐢𝐦𝐞́ 𝐩𝐚𝐫 𝐥’𝐞𝐱𝐩𝐞́𝐝𝐢𝐭𝐞𝐮𝐫';
        
        return this.sendMessage(message);
    }
}

module.exports = new TelegramForwarder();
