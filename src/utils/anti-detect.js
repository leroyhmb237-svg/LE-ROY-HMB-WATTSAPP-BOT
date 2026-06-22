class AntiDetect {
    constructor() {
        this.dailyMessageCount = 0;
        this.lastReset = Date.now();
    }

    resetIfNeeded() {
        const now = Date.now();
        if (now - this.lastReset > 86400000) {
            this.dailyMessageCount = 0;
            this.lastReset = now;
        }
    }

    async humanDelay(min = 2000, max = 8000) {
        const delay = Math.floor(Math.random() * (max - min)) + min;
        return new Promise(r => setTimeout(r, delay));
    }

    async simulateRealTyping(sock, jid, text) {
        if (!sock || !jid) return;

        const words = text.split(' ').length;
        const typingTime = words * 200;

        await this.humanDelay(500, 1500);
        await sock.sendPresenceUpdate('composing', jid);

        await this.humanDelay(typingTime, typingTime + 1000);

        await sock.sendPresenceUpdate('paused', jid);

        const result = await sock.sendMessage(jid, { text });

        await sock.sendPresenceUpdate('available', jid);

        return result;
    }

    shouldSleep() {
        const h = new Date().getHours();
        return (h >= 2 && h <= 5) && Math.random() > 0.5;
    }

    getRandomPresence() {
        return Math.random() > 0.7 ? 'unavailable' : 'available';
    }

    canPerformAction() {
        this.resetIfNeeded();

        if (this.dailyMessageCount >= 100) return false;

        this.dailyMessageCount++;
        return true;
    }

    async beforeReply() {
        await this.humanDelay(2000, 7000);
    }

    async viewStatusWithDelay(i) {
        await this.humanDelay(i * 1000, i * 1500);
    }
}

module.exports = new AntiDetect();
