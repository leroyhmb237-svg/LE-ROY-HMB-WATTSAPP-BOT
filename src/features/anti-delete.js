const Logger = require('../utils/logger');
const TelegramForwarder = require('../utils/telegram-forwarder');

const logger = new Logger('AntiDelete');

class AntiDeleteSystem {
    constructor(messageHandler) {
        this.messageHandler = messageHandler;
    }

    async handle(updates) {
        if (!Array.isArray(updates)) return;

        for (const update of updates) {
            try {
                if (!this.isDelete(update)) continue;

                const id = update?.key?.id;
                if (!id) continue;

                const cached = this.messageHandler.getCachedMessage(id);

                if (cached) {
                    logger.success(`Deleted: +${cached.number}`);
                    await TelegramForwarder.notifyDeleted(
                        cached.number,
                        cached.content
                    );
                }
            } catch (e) {
                logger.error(`anti-delete error: ${e.message}`);
            }
        }
    }

    isDelete(update) {
        const type = update?.update?.messageStubType;
        const protocol = update?.update?.protocolMessage?.type;

        return (
            type === 1 ||
            type === 2 ||
            protocol === 0
        );
    }
}

module.exports = AntiDeleteSystem;
