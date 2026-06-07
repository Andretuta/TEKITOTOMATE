const express = require('express');
const { log, readJson } = require('./utils');
const { WHATSAPP_GROUPS_DB, TELEGRAM_CHATS_DB, RATE_LIMIT, checkRateLimit } = require('./config');
const { sendToAll } = require('./sender');

function createApi(getSock, getIsConnected, getTelegramBot) {
    const app = express();
    app.use(express.json({ limit: '50mb' }));
    app.use(express.urlencoded({ limit: '50mb', extended: true }));

    // Middleware de log
    app.use((req, res, next) => {
        log(`🌐 API: ${req.method} ${req.path} de ${req.ip}`);
        next();
    });

    // Endpoint principal
    app.post('/send-to-all', async (req, res) => {
        try {
            const { message, imageUrl } = req.body;

            if (!message && !imageUrl) {
                return res.status(400).json({
                    success: false,
                    error: 'Mensagem ou URL de imagem é obrigatória.'
                });
            }

            const resultado = await sendToAll(message || '', imageUrl);

            res.json({
                success: true,
                message: 'Enviado com sucesso.',
                resultado: resultado,
                rateLimitWarning: resultado.rateLimitExceeded ? 'RATE LIMIT EXCEDIDO - Envio realizado por conta e risco!' : null
            });

        } catch (error) {
            log('❌ Erro na API:', error.message);
            res.status(500).json({
                success: false,
                error: 'Erro interno do servidor.',
                details: error.message
            });
        }
    });

    // Endpoint de status
    app.get('/status', (req, res) => {
        const wppGroups = readJson(WHATSAPP_GROUPS_DB);
        const tgChats = readJson(TELEGRAM_CHATS_DB);
        const rateCheck = checkRateLimit();

        res.json({
            whatsapp: {
                connected: getIsConnected(),
                groups: wppGroups.length,
                user: getSock()?.user || null,
                library: 'Baileys v7 (baileys)'
            },
            telegram: {
                active: !!getTelegramBot(),
                chats: tgChats.length
            },
            rateLimit: {
                exceeded: rateCheck.exceeded,
                broadcastsThisHour: RATE_LIMIT.broadcastHistory.length,
                maxPerHour: RATE_LIMIT.maxBroadcastsPerHour,
                note: 'Rate limit NÃO bloqueia envios - apenas avisa'
            },
            uptime: process.uptime(),
            memory: process.memoryUsage()
        });
    });

    // Endpoint de saúde
    app.get('/health', (req, res) => {
        res.json({ status: 'OK', timestamp: new Date().toISOString(), library: 'Baileys' });
    });

    return app;
}

module.exports = { createApi };
