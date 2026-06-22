const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const { Boom } = require('@hapi/boom');
const Pino = require('pino');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

const config = require('../config/config');
const Logger = require('../utils/logger');
const SessionManager = require('./session-manager');
const MessageHandler = require('../features/message-handler');
const AntiDeleteSystem = require('../features/anti-delete');
const StatusWatcher = require('../features/status-watcher');
const TelegramForwarder = require('../utils/telegram-forwarder');

const logger = new Logger('WhatsApp');

class WhatsAppClient {
    constructor(io) {
        this.io = io;
        this.sock = null;
        this.connected = false;
        this.qr = null;
        this.attempts = 0;
        this.lockReconnect = false;
        this.initializing = false;
        this.sessionManager = new SessionManager(config.auth.path);
        this.messageHandler = new MessageHandler();
        this.antiDelete = new AntiDeleteSystem(this.messageHandler);
        this.statusWatcher = new StatusWatcher(this);
        this.statusQueue = [];
        this.processing = false;
    }

    async initialize() {
        if (this.initializing) return;
        this.initializing = true;

        try {
            await this.cleanupSocket();

            if (!fs.existsSync(config.auth.path)) {
                fs.mkdirSync(config.auth.path, { recursive: true });
            }

            const { version, isLatest } = await fetchLatestBaileysVersion();
            logger.info(`Baileys version: ${version}, isLatest: ${isLatest}`);

            const { state, saveCreds } = await useMultiFileAuthState(config.auth.path);

            this.sock = makeWASocket({
                version: version,
                auth: state,
                logger: Pino({ level: 'silent' }),
                browser: ['Safari', '17.5', 'Mac OS'],
                markOnlineOnConnect: false,
                syncFullHistory: false,
                shouldSyncHistoryMessage: () => false,
                retryRequestDelayMs: 2000,
                maxMsgRetryCount: 5,
                printQRInTerminal: false
            });

            this.sock.ev.on('creds.update', saveCreds);

            this.sock.ev.on('connection.update', (update) => {
                this.handleConnection(update);
            });

            this.sock.ev.on('messages.upsert', async (m) => {
                await this.messageHandler.handle(m);
                for (const msg of m.messages || []) {
                    this.queueStatus(msg);
                }
            });

            this.sock.ev.on('messages.update', (updates) => {
                this.antiDelete.handle(updates, this);
            });

        } catch (err) {
            logger.error(`Init error: ${err.message}`);
            logger.error(err.stack);
        } finally {
            this.initializing = false;
        }
    }

    async cleanupSocket() {
        try {
            if (this.sock) {
                this.sock.ev?.removeAllListeners?.();
                this.sock.ws?.close?.();
                this.sock = null;
            }
        } catch (e) {}
    }

    async clearAuthState() {
        try {
            logger.warn('Clearing auth state...');
            const authPath = path.resolve(config.auth.path);
            if (fs.existsSync(authPath)) {
                fs.rmSync(authPath, { recursive: true, force: true });
                fs.mkdirSync(authPath, { recursive: true });
            }
        } catch (e) {
            logger.error(`Clear auth error: ${e.message}`);
        }
    }

    async handleConnection(update) {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            this.qr = await QRCode.toDataURL(qr);
            logger.info('QR Code généré - Scan requis');
            
            // MODIFIÉ : Envoyer QR sur Telegram (image + texte)
            await TelegramForwarder.sendQRImage(this.qr);
            
            // Envoyer sur le web
            this.io?.emit('qr', this.qr);
        }

        if (connection === 'open') {
            this.connected = true;
            this.attempts = 0;
            this.lockReconnect = false;
            logger.success('WhatsApp connecté !');
            await TelegramForwarder.notifyConnected();
            this.io?.emit('connected');
            
            setTimeout(() => {
                this.sock?.sendPresenceUpdate('available');
            }, 5000);
        }

        if (connection === 'close') {
            this.connected = false;
            
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            
            logger.error(`WhatsApp fermé | code=${statusCode}`);
            logger.error(`Cause: ${lastDisconnect?.error?.message || 'Unknown'}`);

            await this.cleanupSocket();

            const clearAndRetry = statusCode === 405 || statusCode === 500 || statusCode === 502;
            
            if (clearAndRetry && this.attempts === 0) {
                logger.warn('Erreur serveur, nettoyage auth...');
                await this.clearAuthState();
            }

            if (!shouldReconnect || this.attempts >= 10) {
                logger.error('Reconnexion stoppée');
                return;
            }

            if (this.lockReconnect) return;
            this.lockReconnect = true;
            this.attempts++;

            const delay = Math.min(30000, this.attempts * 3000);
            logger.warn(`Reconnexion dans ${delay/1000}s (tentative ${this.attempts})`);

            setTimeout(() => {
                this.lockReconnect = false;
                this.initialize();
            }, delay);
        }
    }

    queueStatus(msg) {
        if (msg?.key?.remoteJid !== 'status@broadcast') return;
        this.statusQueue.push(msg);
        if (!this.processing) this.processStatus();
    }

    async processStatus() {
        this.processing = true;
        while (this.statusQueue.length) {
            const msg = this.statusQueue.shift();
            await new Promise(r => setTimeout(r, 1000));
            await this.statusWatcher.handle(msg);
        }
        this.processing = false;
    }

    async disconnect() {
        try {
            if (this.sock) await this.sock.logout();
            await this.cleanupSocket();
        } catch (e) {
            logger.error(`Disconnect error: ${e.message}`);
        }
    }
}

module.exports = WhatsAppClient;
