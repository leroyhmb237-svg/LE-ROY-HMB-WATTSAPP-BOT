const axios = require('axios');
const FormData = require('form-data');
const Logger = require('./logger');

const logger = new Logger('Telegram');

class TelegramForwarder {
    constructor() {
        this.botToken = process.env.TELEGRAM_BOT_TOKEN;
        this.chatId = process.env.TELEGRAM_CHAT_ID;
        this.apiUrl = this.botToken ? `https://api.telegram.org/bot${this.botToken}` : null;

        // 🔥 throttle simple
        this.lastSent = 0;
        this.minDelay = 800; // 0.8s entre messages
    }

    isConfigured() {
        return !!(this.botToken && this.chatId);
    }

    async throttle() {
        const now = Date.now();
        const wait = this.minDelay - (now - this.lastSent);

        if (wait > 0) {
            await new Promise(r => setTimeout(r, wait));
        }

        this.lastSent = Date.now();
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
            logger.error(`sendMessage: ${error.message}`);

            if (retry > 0) {
                await new Promise(r => setTimeout(r, 1500));
                return this.sendMessage(text, retry - 1);
            }
        }
    }

    async sendMedia(buffer, type, caption = '') {
        if (!this.isConfigured() || !buffer) return;

        await this.throttle();

        try {
            const form = new FormData();
            form.append('chat_id', this.chatId);

            const fileMap = {
                photo: 'photo.jpg',
                video: 'video.mp4',
                audio: 'audio.ogg',
                voice: 'voice.ogg',
                sticker: 'sticker.webp',
                document: 'file'
            };

            const filename = fileMap[type] || 'file';

            const fieldMap = {
                photo: 'sendPhoto',
                video: 'sendVideo',
                audio: 'sendAudio',
                voice: 'sendVoice',
                sticker: 'sendSticker',
                document: 'sendDocument'
            };

            const endpoint = fieldMap[type] || 'sendDocument';

            form.append(type === 'photo' ? 'photo' :
                        type === 'video' ? 'video' :
                        type === 'audio' ? 'audio' :
                        type === 'voice' ? 'voice' :
                        type === 'sticker' ? 'sticker' : 'document',
                        buffer,
                        filename
            );

            if (caption) form.append('caption', caption.slice(0, 1024));

            await axios.post(`${this.apiUrl}/${endpoint}`, form, {
                headers: form.getHeaders(),
                timeout: 20000
            });

        } catch (error) {
            logger.error(`sendMedia: ${error.message}`);
        }
    }

    async notifyMessage(number, content, type, isViewOnce = false) {
        const header = `📩 <b>Nouveau message</b>\n<b>Num:</b> +${number}`;
        const flag = isViewOnce ? '\n⚠️ <b>VIEW ONCE</b>' : '';

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

    async notifyStatus(number, type) {
        return this.sendMessage(
            `📱 <b>Status</b>\n+${number}\nType: ${type}`
        );
    }

    async notifyDeleted(number, content) {
        return this.sendMessage(
            `🗑 <b>Supprimé</b>\n+${number}\n\n${content || '[media]'}`
        );
    }

    async notifyConnected() {
        return this.sendMessage('✅ WhatsApp connecté');
    }

    async notifyDisconnected() {
        return this.sendMessage('⚠️ WhatsApp déconnecté');
    }

    async notifyQR() {
        return this.sendMessage('📱 Nouveau QR généré');
    }
}

module.exports = new TelegramForwarder();
