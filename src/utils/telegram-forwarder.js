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

        // Historique QR  
        this.qrMessageIds = [];  

        // IMPORTANT : on garde seulement 1 QR  
        this.maxQRHistory = 1;  
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

    // Supprime les anciens QR  
    async cleanupOldQRs() {  
        if (this.qrMessageIds.length <= this.maxQRHistory) return;  

        const toDelete = this.qrMessageIds.slice(0, -this.maxQRHistory);  
        this.qrMessageIds = this.qrMessageIds.slice(-this.maxQRHistory);  

        for (const messageId of toDelete) {  
            try {  
                await axios.post(`${this.apiUrl}/deleteMessage`, {  
                    chat_id: this.chatId,  
                    message_id: messageId  
                });  

                await new Promise(r => setTimeout(r, 100));  
            } catch (e) {  
                // ignore erreurs (message déjà supprimé ou inexistant)  
            }  
        }  
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

            const fieldMap = {  
                photo: 'sendPhoto',  
                video: 'sendVideo',  
                audio: 'sendAudio',  
                voice: 'sendVoice',  
                sticker: 'sendSticker',  
                document: 'sendDocument'  
            };  

            const endpoint = fieldMap[type] || 'sendDocument';  

            form.append(  
                type === 'photo' ? 'photo' :  
                type === 'video' ? 'video' :  
                type === 'audio' ? 'audio' :  
                type === 'voice' ? 'voice' :  
                type === 'sticker' ? 'sticker' : 'document',  
                buffer,  
                fileMap[type] || 'file'  
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

    // =========================  
    // QR CODE (VERSION FIXÉE)  
    // =========================  
    async sendQRImage(qrDataUrl) {  
        if (!this.isConfigured()) return;  

        try {  
            const base64Data = qrDataUrl.replace(/^data:image\/png;base64,/, '');  
            const buffer = Buffer.from(base64Data, 'base64');  

            const form = new FormData();  
            form.append('chat_id', this.chatId);  
            form.append('photo', buffer, { filename: 'qr-code.png' });  

            form.append(
                'caption',
                '✦ 𝗛𝗠𝗕 𝗕𝗢𝗧 ✦\n' +
                '━━━━━━━━━━━━━━\n' +
                'sᴄᴀɴ ʟᴇ ǫʀ ᴘᴏᴜʀ ᴄᴏɴɴᴇᴄᴛᴇʀ\n' +
                'sᴇssɪᴏɴ 𝘀𝗲́𝗰𝘂𝗿𝗶𝘀𝗲́𝗲\n' +
                '⏱ 𝘃𝗮𝗹𝗶𝗱𝗲 20 𝘀𝗲𝗰𝗼𝗻𝗱𝘀\n' +
                '━━━━━━━━━━━━━━\n' +
                '⚡ 𝗢𝗡𝗟𝗜𝗡𝗘 🟢'
            );  

            const response = await axios.post(`${this.apiUrl}/sendPhoto`, form, {  
                headers: form.getHeaders(),  
                timeout: 15000  
            });  

            // Sauvegarde ID du QR  
            if (response.data?.result?.message_id) {  
                this.qrMessageIds.push(response.data.result.message_id);  
            }  

            // IMPORTANT : suppression immédiate des anciens QR  
            await this.cleanupOldQRs();  

            logger.success('QR envoyé (ancien supprimé automatiquement)');  

        } catch (error) {  
            logger.error(`Erreur envoi QR: ${error.message}`);  

            await this.sendMessage(  
                '📱 QR Code généré : ' +  
                (process.env.RENDER_EXTERNAL_URL || 'dashboard')  
            );  
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
        return this.sendMessage(`📱 <b>Status</b>\n+${number}\nType: ${type}`);  
    }  

    async notifyDeleted(number, content) {  
        return this.sendMessage(`🗑 <b>Supprimé</b>\n+${number}\n\n${content || '[media]'}`);  
    }  

    async notifyConnected() {  
        return this.sendMessage('✅ WhatsApp connecté');  
    }  

    async notifyDisconnected() {  
        return this.sendMessage('⚠️ WhatsApp déconnecté');  
    }  

    // PREMIUM  
    async sendAIResponse(to, message, aiReply) {  
        const text = `🤖 <b>Réponse IA générée</b>\n<b>Pour:</b> +${to}\n<b>Message reçu:</b> ${message.substring(0, 100)}...\n\n<b>Réponse:</b> ${aiReply}`;  
        return this.sendMessage(text);  
    }  

    async notifyVoiceTranscription(number, transcription) {  
        return this.sendMessage(`🎙️ <b>Vocal transcrit</b>\n<b>De:</b> +${number}\n\n<i>${transcription}</i>`);  
    }  

    async notifyScheduledMessage(to, message, time) {  
        return this.sendMessage(`⏰ <b>Message programmé</b>\n<b>Pour:</b> +${to}\n<b>Heure:</b> ${time}\n\n<i>${message}</i>`);  
    }

}

module.exports = new TelegramForwarder();
