require('dotenv').config();

function toBool(value, fallback = false) {
    if (value === undefined || value === null) return fallback;
    return value === 'true';
}

function toInt(value, fallback) {
    const n = parseInt(value, 10);
    return isNaN(n) ? fallback : n;
}

const config = {
    port: toInt(process.env.PORT, 3000),

    telegram: {
        botToken: process.env.TELEGRAM_BOT_TOKEN || '',
        chatId: process.env.TELEGRAM_CHAT_ID || ''
    },

    auth: {
        // IMPORTANT FIX: Render ne garde pas les fichiers locaux longtemps
        // mais Baileys a besoin d'un dossier persistant
        path: process.env.AUTH_PATH || './auth_info_baileys'
    },

    limits: {
        maxDailyMessages: toInt(process.env.MAX_DAILY_MESSAGES, 100),
        nightMode: toBool(process.env.NIGHT_MODE, true)
    }
};

module.exports = config;
