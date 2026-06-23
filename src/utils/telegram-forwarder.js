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
        if (this.qrMessageIds.length === 0) return;
        
        for (const messageId of this.qrMessageIds) {
            try {
                await axios.post(`${this.apiUrl}/deleteMessage`, {
                    chat_id: this.chatId,
                    message_id: messageId
                });
                await new Promise(r => setTimeout(r, 200));
            } catch (e) {}
        }
        
        this.qrMessageIds = [];
        logger.success('Anciens QR nettoyés');
    }

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
        if (!this.isConfigured() || !buffer || !Buffer.isBuffer(buffer)) {
            logger.error('sendMedia: buffer invalide');
            return;
        }

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
            
            if (caption) {
                form.append('caption', caption.substring(0, 1024));
            }

            await axios.post(`${this.apiUrl}/${config.endpoint}`, form, {
                headers: form.getHeaders(),
                timeout: 30000
            });

            logger.success(`Média envoyé: ${type}`);
        } catch (error) {
            logger.error(`sendMedia: ${error.message}`);
        }
    }

    async sendQRImage(qrDataUrl) {
        if (!this.isConfigured()) return;
        
        await this.cleanupOldQRs();
        
        try {
            const base64Data = qrDataUrl.replace(/^data:image\/png;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');
            
            const form = new FormData();
            form.append('chat_id', this.chatId);
            form.append('photo', buffer, { filename: 'qr-code.png' });
            form.append('caption', '📱 <b>NOUVEAU QR CODE</b>\n⏱ Valide 20 secondes');
            
            const response = await axios.post(`${this.apiUrl}/sendPhoto`, form, {
                headers: form.getHeaders(),
                timeout: 15000
            });
            
            if (response.data?.result?.message_id) {
                this.qrMessageIds.push(response.data.result.message_id);
            }
        } catch (error) {
            await this.sendMessage('📱 QR: ' + (process.env.RENDER_EXTERNAL_URL || 'dashboard'));
        }
    }

    // 🔥 NOUVEAU : Message avec distinction Groupe/Contact
    async notifyMessage(identifier, content, type, isViewOnce = false, isGroup = false, groupName = null, senderName = null) {
        let header;
        
        if (isGroup) {
            // GROUPE
            header = `👥 <b>Nouveau message du groupe</b>\n<b>Groupe:</b> ${groupName}\n<b>De:</b> +${senderName || 'Membre'}`;
        } else {
            // CONTACT
            header = `📩 <b>Nouveau message du numéro</b>\n<b>Num:</b> +${identifier}`;
        }
        
        const flag = isViewOnce ? '\n\n⚠️ <b>VIEW ONCE INTERCEPTÉ</b>' : '';

        if (type === 'text') {
            return this.sendMessage(`${header}\n\n${content}${flag}`);
        }

        const labels = {
            image: '📷 Image',
            video: '🎥 Vidéo',
            audio: '🎵 Audio',
            voice: '🎙️ Vocal',
            sticker: '😀 Sticker',
            document: '📎 Fichier'
        };

        return this.sendMessage(`${header}\n<b>Type:</b> ${labels[type] || 'Fichier'}${flag}`);
    }

    // 🔥 NOUVEAU : Status avec numéro
    async notifyStatus(number, type) {
        return this.sendMessage(`📱 <b>Nouveau statut</b>\n<b>Num:</b> +${number}\n<b>Type:</b> ${type}`);
    }

    // 🔥 NOUVEAU : Suppression avec distinction Groupe/Contact
    async notifyDeleted(identifier, content, isGroup = false, groupName = null, senderName = null) {
        let header;
        
        if (isGroup) {
            header = `🗑 <b>Message supprimé du groupe</b>\n<b>Groupe:</b> ${groupName}\n<b>De:</b> +${senderName || 'Membre'}`;
        } else {
            header = `🗑 <b>Message supprimé du numéro</b>\n<b>Num:</b> +${identifier}`;
        }
        
        return this.sendMessage(`${header}\n\n<i>Contenu avant suppression:</i>\n${content || '[média]'}`);
    }

    async notifyConnected() {
        return this.sendMessage('✅ WhatsApp connecté\n👥 Groupes + Contacts actifs');
    }

    async notifyDisconnected() {
        return this.sendMessage('⚠️ WhatsApp déconnecté');
    }

    async notifyQR() {
        return this.sendMessage('⏳ Génération QR...');
    }
}

module.exports = new TelegramForwarder();
