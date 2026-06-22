const fs = require('fs');

class SessionManager {
    constructor(authPath) {
        this.authDir = authPath || './auth';

        fs.mkdirSync(this.authDir, { recursive: true });
    }

    exists() {
        try {
            return fs.existsSync(this.authDir) &&
                   fs.readdirSync(this.authDir).length > 0;
        } catch {
            return false;
        }
    }

    clear() {
        try {
            fs.rmSync(this.authDir, { recursive: true, force: true });
            fs.mkdirSync(this.authDir, { recursive: true });
        } catch (e) {
            console.error('Session clear error:', e.message);
        }
    }
}

module.exports = SessionManager;
