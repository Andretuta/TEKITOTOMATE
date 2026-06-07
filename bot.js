require('dotenv').config();

// Corrigir warning de Deprecation do Telegram Bot API ao enviar Buffers
process.env.NTBA_FIX_350 = 1;

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pino = require('pino');
const qrcode = require('qrcode');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');

// Baileys
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    makeCacheableSignalKeyStore,
    Browsers
} = require('@whiskeysockets/baileys');

// === MÓDULOS INTERNOS ===
const { LOG_FILE, SESSION_PATH, WHATSAPP_GROUPS_DB, TELEGRAM_CHATS_DB, MEDIA_CACHE_DIR, MAX_RECONNECT_DELAY, MAX_RECONNECT_ATTEMPTS, getSpeedConfig } = require('./src/config');
const { log, readJson, writeJson, getAdmins } = require('./src/utils');
const { initSender, updateSenderSocket, syncGroups, sendToAll } = require('./src/sender');
const { initQueue, updateQueueSocket, addToQueue, isQueueProcessing } = require('./src/queue');
const { processCommand } = require('./src/commands');
const { createApi } = require('./src/api');

// Criar diretórios se não existirem
if (!fs.existsSync(path.dirname(LOG_FILE))) {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
}
if (!fs.existsSync(SESSION_PATH)) {
    fs.mkdirSync(SESSION_PATH, { recursive: true });
}

// Logger silencioso para Baileys
const logger = pino({ level: 'silent' });

// === VARIÁVEIS GLOBAIS ===
let sock = null;
let telegramBot = null;
let isConnected = false;
let reconnectAttempts = 0;

// Funções getter para injeção de dependência
const getSock = () => sock;
const getIsConnected = () => isConnected;
const getTelegramBot = () => telegramBot;

// === CONFIGURAÇÃO DO TELEGRAM ===
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

if (TELEGRAM_TOKEN) {
    try {
        telegramBot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
        log('✅ Telegram bot iniciado com sucesso');

        telegramBot.on('my_chat_member', (data) => {
            const chat = data.chat;
            const chats = readJson(TELEGRAM_CHATS_DB);

            if (['member', 'administrator'].includes(data.new_chat_member?.status)) {
                if (!chats.includes(chat.id)) {
                    chats.push(chat.id);
                    writeJson(TELEGRAM_CHATS_DB, chats);
                    log('🟢 Adicionado ao grupo/canal Telegram:', chat.id, chat.title || 'N/A');
                }
            }

            if (['left', 'kicked'].includes(data.new_chat_member?.status)) {
                const filtered = chats.filter(id => id !== chat.id);
                writeJson(TELEGRAM_CHATS_DB, filtered);
                log('🔴 Removido do grupo/canal Telegram:', chat.id);
            }
        });

        telegramBot.on('message', (msg) => {
            const chats = readJson(TELEGRAM_CHATS_DB);
            if (!chats.includes(msg.chat.id)) {
                chats.push(msg.chat.id);
                writeJson(TELEGRAM_CHATS_DB, chats);
                telegramBot.sendMessage(msg.chat.id, '✅ Chat registrado automaticamente!');
                log('📝 Novo chat Telegram registrado:', msg.chat.id);
            }
        });

        telegramBot.on('error', (error) => {
            log('❌ Erro no Telegram bot:', error.message);
        });

    } catch (error) {
        log('❌ Erro ao inicializar Telegram bot:', error.message);
    }
} else {
    log('⚠️ TELEGRAM_TOKEN não configurado - Telegram desabilitado');
}

// === CONEXÃO WHATSAPP COM BAILEYS ===
async function startWhatsApp() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);

        // Buscar versão mais recente do WhatsApp Web
        let version;
        try {
            const response = await axios.get(
                'https://raw.githubusercontent.com/WhiskeySockets/Baileys/master/src/Defaults/baileys-version.json',
                { timeout: 10000 }
            );
            version = response.data.version;
            log(`📱 Versão WhatsApp Web (GitHub): ${version.join('.')}`);
        } catch (e) {
            version = [2, 3000, 1033105955];
            log(`⚠️ Falha ao buscar versão do GitHub, usando fallback: ${version.join('.')}`);
        }

        log('🚀 Iniciando WhatsApp com Baileys v7...');
        console.log(`🚀 Iniciando WhatsApp com Baileys v7 (WA Web v${version.join('.')})`);

        sock = makeWASocket({
            version,
            logger,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            browser: Browsers.macOS('Chrome'),
            generateHighQualityLinkPreview: false,
            syncFullHistory: false,
            markOnlineOnConnect: false,
        });

        // Inicializar referências nos módulos (primeira vez)
        initSender(sock, getIsConnected, telegramBot);
        initQueue(sock, getIsConnected, sendToAll);

        // Salvar credenciais
        sock.ev.on('creds.update', saveCreds);

        // Handler de conexão
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log('\n' + '='.repeat(50));
                console.log('📱 QR CODE GERADO - ESCANEIE COM SEU WHATSAPP');
                console.log('='.repeat(50));

                const qrString = await qrcode.toString(qr, { type: 'terminal', small: true });
                console.log(qrString);
                console.log('='.repeat(50) + '\n');

                log('🔲 QR Code gerado - Aguardando leitura pelo WhatsApp');
            }

            if (connection === 'open') {
                isConnected = true;
                reconnectAttempts = 0;

                // Atualizar referência do socket nos módulos (essencial após reconexão)
                updateSenderSocket(sock);
                updateQueueSocket(sock);

                const user = sock.user;
                log('🎉 WhatsApp conectado e pronto para uso!');
                console.log('🎉 WhatsApp conectado e pronto para uso!');
                console.log(`📱 Conectado como: ${user?.name || 'N/A'}`);
                console.log(`📞 Número: ${user?.id?.split(':')[0] || 'N/A'}`);
                console.log(`🤖 Bot operacional às ${new Date().toLocaleTimeString()}`);
                const startProfile = getSpeedConfig();
                console.log(`⚡ Modo de velocidade: ${startProfile.label} (${startProfile.description})`);
                console.log(`⚠️ Rate Limit: NÃO trava - apenas avisa e continua`);
                console.log(`💡 Comandos: 'rapido', 'meio' ou 'lento' para trocar modo`);

                // Sincronizar grupos
                console.log('🔄 Sincronizando grupos existentes...');
                setTimeout(async () => {
                    try {
                        const result = await syncGroups();
                        console.log(`✅ Grupos sincronizados: ${result.found} encontrados, ${result.added} novos`);
                        log(`✅ Grupos sincronizados: ${result.found} encontrados, ${result.added} novos adicionados`);
                    } catch (error) {
                        log('⚠️ Erro ao sincronizar grupos:', error.message);
                    }
                }, 10000);
            }

            if (connection === 'close') {
                isConnected = false;
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                console.log('❌ WhatsApp desconectado - DETALHES:');
                console.log('   Status Code:', statusCode);
                console.log('   Erro completo:', JSON.stringify(lastDisconnect?.error, null, 2));
                log('❌ WhatsApp desconectado:', lastDisconnect?.error?.message || 'Motivo desconhecido', '| StatusCode:', statusCode);

                if (statusCode === 403) {
                    reconnectAttempts++;
                    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
                        console.log('🛑 CONTA RESTRINGIDA! Parando reconexão após', MAX_RECONNECT_ATTEMPTS, 'tentativas.');
                        log('🛑 CONTA RESTRINGIDA - Reconexão interrompida');
                        return;
                    }
                    const backoffDelay = Math.min(10000 * Math.pow(2, reconnectAttempts - 1), MAX_RECONNECT_DELAY);
                    const delaySec = Math.round(backoffDelay / 1000);
                    console.log(`⏳ Conta restringida (403). Tentativa ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}. Próxima em ${delaySec}s...`);
                    log(`⏳ Reconexão com backoff: tentativa ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}, delay ${delaySec}s`);
                    setTimeout(startWhatsApp, backoffDelay);
                } else if (shouldReconnect) {
                    reconnectAttempts++;
                    const backoffDelay = Math.min(5000 * Math.pow(1.5, reconnectAttempts - 1), 60000);
                    const delaySec = Math.round(backoffDelay / 1000);
                    console.log(`🔄 Tentando reconectar em ${delaySec}s... (tentativa ${reconnectAttempts})`);
                    log(`🔄 Reconexão: tentativa ${reconnectAttempts}, delay ${delaySec}s`);
                    setTimeout(startWhatsApp, backoffDelay);
                } else {
                    console.log('🚫 Sessão encerrada (logout). Execute novamente para novo QR Code.');
                    log('🚫 Sessão encerrada por logout');
                }
            }
        });

        // Handler de mensagens
        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;

            for (const msg of messages) {
                try {
                    if (msg.key.fromMe) continue;

                    const chatId = msg.key.remoteJid;
                    if (!chatId) continue;

                    const isGroup = chatId.endsWith('@g.us');
                    if (isGroup) continue;

                    const isLid = chatId.endsWith('@lid');
                    const senderNumber = isLid
                        ? chatId.replace('@lid', '')
                        : chatId.replace('@s.whatsapp.net', '');
                    const admins = getAdmins();

                    const isAdmin = admins.includes(senderNumber);
                    if (!isAdmin) {
                        log(`⛔ Comando não autorizado de: ${senderNumber} (formato: ${isLid ? 'LID' : 'número'}, chatId: ${chatId})`);
                        continue;
                    }

                    // Processar comandos
                    const isCommand = await processCommand(sock, msg, senderNumber, isConnected, telegramBot);
                    if (isCommand) continue;

                    // === PROCESSAMENTO DE MENSAGENS E MÍDIAS ===
                    const messageText = msg.message?.conversation ||
                        msg.message?.extendedTextMessage?.text ||
                        msg.message?.imageMessage?.caption || '';

                    let content = messageText;
                    let media = null;
                    let imageUrl = null;

                    const wppGroups = readJson(WHATSAPP_GROUPS_DB);
                    const tgChats = readJson(TELEGRAM_CHATS_DB);

                    if (wppGroups.length === 0 && tgChats.length === 0) {
                        await sock.sendMessage(chatId, { text: '❌ Nenhum grupo ou canal registrado ainda.' });
                        continue;
                    }

                    // Processar mídia
                    if (msg.message?.imageMessage || msg.message?.videoMessage || msg.message?.documentMessage) {
                        log('📥 Processando mídia enviada...');
                        await sock.sendMessage(chatId, { text: '📥 Baixando mídia, aguarde...' });

                        const { downloadMediaMessage } = require('@whiskeysockets/baileys');
                        const buffer = await downloadMediaMessage(msg, 'buffer', {});

                        if (buffer) {
                            const mimetype = msg.message?.imageMessage?.mimetype ||
                                msg.message?.videoMessage?.mimetype ||
                                msg.message?.documentMessage?.mimetype || 'application/octet-stream';

                            // Salvar mídia em disco (cache local) em vez de manter buffer na RAM
                            const ext = mimetype.split('/')[1] || 'bin';
                            const fileName = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
                            const mediaPath = path.join(MEDIA_CACHE_DIR, fileName);
                            
                            try {
                                fs.writeFileSync(mediaPath, buffer);
                                media = { mediaPath, mimetype };
                                log(`✅ Mídia salva em cache: ${mediaPath} (${(buffer.length / 1024 / 1024).toFixed(2)}MB)`);
                            } catch (cacheErr) {
                                log(`⚠️ Falha ao salvar cache, usando buffer direto: ${cacheErr.message}`);
                                media = { buffer, mimetype };
                            }
                            
                            content = msg.message?.imageMessage?.caption ||
                                msg.message?.videoMessage?.caption || '';
                        }
                    } else if (/https?:\/\/.+\.(jpg|jpeg|png|gif|webp|mp4|mov|avi)/i.test(content)) {
                        imageUrl = content.trim();
                        content = '';
                        log('🔗 URL de mídia detectada:', imageUrl);
                    }

                    // Adicionar à fila
                    if (content || media || imageUrl) {
                        const queueInfo = addToQueue({
                            content: content || '📣 Nova mensagem do admin!',
                            imageUrl,
                            media: media?.buffer ? media : null,
                            mediaPath: media?.mediaPath || null,
                            mimetype: media?.mimetype || null,
                            chatId,
                            senderNumber
                        });

                        if (queueInfo.position === 1 && !isQueueProcessing()) {
                            // Primeira da fila, vai iniciar agora
                        } else if (queueInfo.position === 1) {
                            await sock.sendMessage(chatId, {
                                text: `📋 Adicionado à fila! Posição: #${queueInfo.position}\n⏳ Será enviado assim que o envio atual terminar.`
                            });
                        } else {
                            await sock.sendMessage(chatId, {
                                text: `📋 Adicionado à fila! Posição: #${queueInfo.position}\n⏳ Há ${queueInfo.position - 1} envio(s) antes deste.\n\nDigite *fila* para ver o status.`
                            });
                        }

                        log('📋 Envio enfileirado por admin:', senderNumber, '| Posição:', queueInfo.position);
                    } else {
                        await sock.sendMessage(chatId, { text: '❌ Envie uma mensagem, imagem ou URL válida.' });
                    }

                } catch (error) {
                    log('⚠️ Erro ao processar mensagem:', error.message);
                }
            }
        });

        // Handler de grupos (auto-cadastro)
        sock.ev.on('groups.upsert', async (groups) => {
            for (const group of groups) {
                const groupList = readJson(WHATSAPP_GROUPS_DB);
                if (!groupList.includes(group.id)) {
                    groupList.push(group.id);
                    writeJson(WHATSAPP_GROUPS_DB, groupList);
                    log('🟢 Entrou em novo grupo WhatsApp:', group.id, group.subject || 'N/A');
                }
            }
        });

        // Handler de participantes
        sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
            if (action === 'remove') {
                const myId = sock.user?.id?.split(':')[0] + '@s.whatsapp.net';
                if (participants.includes(myId)) {
                    const updated = readJson(WHATSAPP_GROUPS_DB).filter(gid => gid !== id);
                    writeJson(WHATSAPP_GROUPS_DB, updated);
                    log('🔴 Bot removido do grupo WhatsApp:', id);
                }
            }
        });

    } catch (error) {
        reconnectAttempts++;
        log('❌ Erro na inicialização do WhatsApp:', error.message);
        console.error('❌ Erro na inicialização:', error);
        const backoffDelay = Math.min(10000 * Math.pow(1.5, reconnectAttempts - 1), 120000);
        const delaySec = Math.round(backoffDelay / 1000);
        console.log(`🔄 Tentando novamente em ${delaySec}s...`);
        log(`🔄 Reconexão após erro de inicialização: tentativa ${reconnectAttempts}, delay ${delaySec}s`);
        setTimeout(startWhatsApp, backoffDelay);
    }
}

// === API EXPRESS ===
const app = createApi(getSock, getIsConnected, getTelegramBot);
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    log(`🚀 API rodando na porta ${PORT}`);
    console.log(`🌐 Endpoints disponíveis:`);
    console.log(`   POST http://localhost:${PORT}/send-to-all`);
    console.log(`   GET  http://localhost:${PORT}/status`);
    console.log(`   GET  http://localhost:${PORT}/health`);
});

// === TRATAMENTO DE SINAIS ===
process.on('SIGINT', async () => {
    log('🛑 Encerrando bot...');
    console.log('\n🛑 Encerrando bot graciosamente...');

    try {
        if (sock) await sock.end();
        if (telegramBot) await telegramBot.stopPolling();
    } catch (error) {
        log('❌ Erro ao encerrar:', error.message);
    }

    log('👋 Bot encerrado');
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    log('❌ Exceção não capturada:', error.message);
    console.error('❌ Exceção não capturada:', error);
});

process.on('unhandledRejection', (reason) => {
    log('❌ Promise rejeitada:', reason);
    console.error('❌ Promise rejeitada:', reason);
});

// === INICIALIZAR BOT ===
console.log('🤖 Iniciando Bot de Broadcast (Baileys)...');
console.log('📝 Logs salvos em:', LOG_FILE);
console.log('📦 Usando biblioteca: @whiskeysockets/baileys (oficial)');
console.log('⚠️ Rate Limit: NÃO trava - continua e avisa');
console.log('-'.repeat(60));

log('🤖 Bot iniciado com Baileys');
startWhatsApp();
