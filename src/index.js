require('dotenv').config();

const fs = require('fs');
const path = require('path');

const config = require('./config/config');
const WhatsAppClient = require('./core/whatsapp-client');
const WebServer = require('./web/server');
const Logger = require('./utils/logger');

const logger = new Logger('Main');

async function main() {
    let server = null;
    let whatsapp = null;

    try {
        logger.info('🚀 Starting bot...');

        // Création du dossier auth
        const authPath = path.resolve(config.auth.path);

        if (!fs.existsSync(authPath)) {
            fs.mkdirSync(authPath, { recursive: true });
        }

        logger.info(`📁 Auth path: ${authPath}`);

        // Affiche la version réelle de Baileys
        try {
            const baileysPkg =
                require('@whiskeysockets/baileys/package.json');

            logger.info(
                `📦 Baileys version: ${baileysPkg.version}`
            );
        } catch (e) {
            logger.warn(
                `Impossible de lire la version Baileys: ${e.message}`
            );
        }

        // Démarrage du serveur web
        server = new WebServer();
        await server.start();

        // Démarrage WhatsApp
        whatsapp = new WhatsAppClient(server.io);
        await whatsapp.initialize();

        const shutdown = async () => {
            logger.info('🛑 Shutting down...');

            try {
                if (whatsapp) {
                    await whatsapp.disconnect();
                }

                if (server) {
                    await server.stop();
                }
            } catch (e) {
                logger.error(
                    `Shutdown error: ${e.message}`
                );
            }

            process.exit(0);
        };

        process.once('SIGTERM', shutdown);
        process.once('SIGINT', shutdown);

        process.on('uncaughtException', (err) => {
            logger.error(
                `Uncaught Exception: ${err.stack || err.message}`
            );
        });

        process.on('unhandledRejection', (err) => {
            logger.error(
                `Unhandled Rejection: ${err?.stack || err}`
            );
        });

    } catch (error) {
        logger.error(
            `Fatal error: ${error.stack || error.message}`
        );

        process.exit(1);
    }
}

main();
