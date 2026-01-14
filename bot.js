require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const axios = require('axios');
const pino = require('pino');
const qrcode = require('qrcode');
const TelegramBot = require('node-telegram-bot-api');

// Baileys - usando @anubis-pro/baileys (fork sem autofollow)
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    Browsers
} = require('@anubis-pro/baileys');

// === CONFIGURAÇÕES E CAMINHOS ===
const LOG_FILE = path.join(__dirname, 'logs', 'bot.log');
const WHATSAPP_GROUPS_DB = path.join(__dirname, 'groups.json');
const TELEGRAM_CHATS_DB = path.join(__dirname, 'telegram_chats.json');
const ADMINS_FILE = path.join(__dirname, 'bot_admins.json');
const SESSION_PATH = path.join(__dirname, 'session_baileys');

// Criar diretórios se não existirem
if (!fs.existsSync(path.dirname(LOG_FILE))) {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
}
if (!fs.existsSync(SESSION_PATH)) {
    fs.mkdirSync(SESSION_PATH, { recursive: true });
}

// Logger silencioso para Baileys
const logger = pino({ level: 'silent' });

// === UTILITÁRIOS ===
const readJson = (file) => {
    try {
        return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
    } catch (error) {
        log('❌ Erro ao ler arquivo JSON:', file, error.message);
        return [];
    }
};

const writeJson = (file, data) => {
    try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch (error) {
        log('❌ Erro ao escrever arquivo JSON:', file, error.message);
    }
};

const log = (...msg) => {
    const line = `[${new Date().toISOString()}] ${msg.join(' ')}\n`;
    try {
        fs.appendFileSync(LOG_FILE, line);
    } catch (error) {
        console.error('Erro ao escrever log:', error.message);
    }
    console.log(`[${new Date().toLocaleTimeString()}]`, ...msg);
};

const getAdmins = () => {
    try {
        const data = JSON.parse(fs.readFileSync(ADMINS_FILE, 'utf8'));
        return Array.isArray(data.admins) ? data.admins : [];
    } catch {
        log('⚠️ Arquivo de admins não encontrado ou inválido');
        return [];
    }
};

// Função auxiliar de delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// === CONFIGURAÇÕES DE ENVIO PARALELO ===
const PARALLEL_CONFIG = {
    whatsapp: {
        batchSize: 4,
        batchDelay: 2500,
        maxRetries: 2
    },
    telegram: {
        batchSize: 5,
        batchDelay: 1500,
        maxRetries: 2
    }
};

// === VARIÁVEIS GLOBAIS ===
let sock = null;
let telegramBot = null;
let isConnected = false;

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

// === FUNÇÕES DE MÍDIA ===
async function getMediaFromUrl(url) {
    try {
        log('📥 Baixando mídia de:', url);
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 30000,
            maxContentLength: 50 * 1024 * 1024,
        });

        const mime = response.headers['content-type'];
        const buffer = Buffer.from(response.data);

        log('✅ Mídia baixada:', { mime, size: `${(buffer.length / 1024 / 1024).toFixed(2)}MB` });
        return { buffer, mimetype: mime };

    } catch (error) {
        log('❌ Erro ao baixar mídia:', error.message);
        return null;
    }
}

// Função de envio em lotes paralelos com retry
async function sendInBatches(items, sendFunction, config, platform) {
    const results = { success: 0, failed: 0, errors: [] };
    const totalItems = items.length;

    for (let i = 0; i < totalItems; i += config.batchSize) {
        const batch = items.slice(i, i + config.batchSize);
        const batchNum = Math.floor(i / config.batchSize) + 1;
        const totalBatches = Math.ceil(totalItems / config.batchSize);

        log(`📦 ${platform} Lote ${batchNum}/${totalBatches} (${batch.length} itens)`);

        const promises = batch.map(async (itemId) => {
            let lastError = null;

            for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
                try {
                    await sendFunction(itemId);
                    results.success++;
                    log(`✅ ${platform} [${results.success + results.failed}/${totalItems}]:`, itemId);
                    return;
                } catch (error) {
                    lastError = error;
                    if (attempt < config.maxRetries) {
                        log(`⚠️ ${platform} Retry ${attempt}/${config.maxRetries} para:`, itemId);
                        await delay(500 * attempt);
                    }
                }
            }

            results.failed++;
            results.errors.push({ id: itemId, error: lastError?.message || 'Erro desconhecido' });
            log(`❌ ${platform} Falha após ${config.maxRetries} tentativas:`, itemId, lastError?.message);
        });

        await Promise.all(promises);

        if (i + config.batchSize < totalItems) {
            await delay(config.batchDelay);
        }
    }

    return results;
}

// === FUNÇÃO PARA SINCRONIZAR GRUPOS EXISTENTES ===
async function syncGroups() {
    if (!sock || !isConnected) {
        throw new Error('WhatsApp não está conectado');
    }

    log('🔄 Iniciando sincronização de grupos...');

    try {
        // Buscar todos os grupos onde o bot participa
        const groups = await sock.groupFetchAllParticipating();
        const groupIds = Object.keys(groups);

        log(`📊 Encontrados ${groupIds.length} grupos no WhatsApp`);

        // Ler grupos atuais do arquivo
        const currentGroups = readJson(WHATSAPP_GROUPS_DB);
        const currentSet = new Set(currentGroups);

        let added = 0;

        // Adicionar grupos que não estão no arquivo
        for (const groupId of groupIds) {
            if (!currentSet.has(groupId)) {
                currentGroups.push(groupId);
                added++;
                log(`➕ Grupo adicionado: ${groupId} (${groups[groupId].subject || 'Sem nome'})`);
            }
        }

        // Salvar arquivo atualizado
        if (added > 0) {
            writeJson(WHATSAPP_GROUPS_DB, currentGroups);
        }

        const result = {
            found: groupIds.length,
            added: added,
            total: currentGroups.length
        };

        log(`✅ Sincronização concluída: ${result.found} encontrados, ${result.added} novos, ${result.total} total`);

        return result;
    } catch (error) {
        log('❌ Erro na sincronização de grupos:', error.message);
        throw error;
    }
}

// === FUNÇÃO DE ENVIO PRINCIPAL ===
async function sendToAll(message, imageUrl = null, directMedia = null) {
    const wppGroups = readJson(WHATSAPP_GROUPS_DB);
    const tgChats = readJson(TELEGRAM_CHATS_DB);
    let media = directMedia;
    const startTime = Date.now();

    if (!isConnected) {
        log('⚠️ WhatsApp não está conectado - Pulando envios do WhatsApp');
    }

    if (!media && imageUrl) {
        media = await getMediaFromUrl(imageUrl);
    }

    log('📤 Iniciando envio PARALELO:', {
        hasMedia: !!media,
        hasUrl: !!imageUrl,
        wppGroups: wppGroups.length,
        tgChats: tgChats.length,
        whatsappReady: isConnected
    });

    let wppResults = { success: 0, failed: 0, errors: [] };
    let tgResults = { success: 0, failed: 0, errors: [] };

    // Envios WhatsApp em paralelo
    if (isConnected && sock && wppGroups.length > 0) {
        log(`📱 Iniciando envio WhatsApp para ${wppGroups.length} grupos...`);

        wppResults = await sendInBatches(
            wppGroups,
            async (groupId) => {
                if (media && media.buffer) {
                    const isVideo = media.mimetype?.includes('video');
                    const isDocument = !media.mimetype?.includes('image') && !isVideo;

                    if (isVideo) {
                        await sock.sendMessage(groupId, { video: media.buffer, caption: message || '' });
                    } else if (isDocument) {
                        await sock.sendMessage(groupId, { document: media.buffer, caption: message || '', mimetype: media.mimetype });
                    } else {
                        await sock.sendMessage(groupId, { image: media.buffer, caption: message || '' });
                    }
                } else {
                    await sock.sendMessage(groupId, { text: message || '📣 Nova mensagem!' });
                }
            },
            PARALLEL_CONFIG.whatsapp,
            'WhatsApp'
        );
    }

    // Envios Telegram em paralelo
    if (telegramBot && tgChats.length > 0) {
        log(`📨 Iniciando envio Telegram para ${tgChats.length} chats...`);

        tgResults = await sendInBatches(
            tgChats,
            async (chatId) => {
                if (media && imageUrl) {
                    await telegramBot.sendPhoto(chatId, imageUrl, { caption: message || '' });
                } else if (media && media.buffer) {
                    await telegramBot.sendPhoto(chatId, media.buffer, { caption: message || '' });
                } else {
                    await telegramBot.sendMessage(chatId, message || '📣 Nova mensagem!');
                }
            },
            PARALLEL_CONFIG.telegram,
            'Telegram'
        );
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const resumo = `📊 Envio concluído em ${elapsed}s: WPP(${wppResults.success}✅/${wppResults.failed}❌) TG(${tgResults.success}✅/${tgResults.failed}❌)`;
    log(resumo);

    return {
        whatsapp: { sucessos: wppResults.success, falhas: wppResults.failed, erros: wppResults.errors },
        telegram: { sucessos: tgResults.success, falhas: tgResults.failed, erros: tgResults.errors },
        tempoTotal: elapsed + 's',
        resumo
    };
}

// === FUNÇÃO PARA PROCESSAR COMANDOS ===
async function processCommand(msg, senderNumber) {
    const messageText = msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption || '';

    const comando = messageText.trim().toLowerCase();
    const chatId = msg.key.remoteJid;

    try {
        // === COMANDO STATUS ===
        if (comando === 'status') {
            const wppGroups = readJson(WHATSAPP_GROUPS_DB);
            const tgChats = readJson(TELEGRAM_CHATS_DB);
            const isWppReady = isConnected ? '✅ Conectado' : '❌ Desconectado';
            const isTgReady = telegramBot ? '✅ Ativo' : '❌ Inativo';

            const statusMsg =
                `📊 *STATUS DO BOT*\n\n` +
                `🔸 WhatsApp: ${isWppReady}\n` +
                `🔸 Grupos WPP: ${wppGroups.length}\n` +
                `🔸 Telegram: ${isTgReady}\n` +
                `🔸 Chats TG: ${tgChats.length}\n` +
                `🔸 Uptime: ${Math.floor(process.uptime() / 60)}min\n` +
                `🔸 Memória: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB\n` +
                `🔸 Biblioteca: Baileys`;

            await sock.sendMessage(chatId, { text: statusMsg });
            return true;
        }

        // === COMANDO TESTE ===
        if (comando === 'test' || comando === 'teste') {
            const inicio = Date.now();
            await sock.sendMessage(chatId, { text: '🤖 Bot funcionando perfeitamente!\n⏱️ Teste de resposta realizado.' });
            const tempo = Date.now() - inicio;
            log(`✅ Teste realizado em ${tempo}ms para`, senderNumber);
            return true;
        }

        // === COMANDO RESET ===
        if (comando === 'reset') {
            await sock.sendMessage(chatId, { text: '🔄 Resetando sessão do WhatsApp...\nO bot será reiniciado.' });
            log('🔄 Sessão resetada por', senderNumber);

            // Limpar sessão
            if (fs.existsSync(SESSION_PATH)) {
                fs.rmSync(SESSION_PATH, { recursive: true, force: true });
            }

            setTimeout(() => process.exit(0), 2000);
            return true;
        }

        // === COMANDO HELP ===
        if (comando === 'help' || comando === 'ajuda') {
            const helpMsg =
                `🤖 *COMANDOS DISPONÍVEIS:*\n\n` +
                `• *status* - Ver status do bot\n` +
                `• *test* - Testar funcionamento\n` +
                `• *sync* - Sincronizar grupos\n` +
                `• *update* - Verificar atualizações\n` +
                `• *reset* - Resetar sessão\n` +
                `• *help* - Esta ajuda\n\n` +
                `📝 *Para enviar mensagens:*\n` +
                `• Digite a mensagem normalmente\n` +
                `• Envie uma imagem com legenda\n` +
                `• Envie apenas uma URL de imagem`;

            await sock.sendMessage(chatId, { text: helpMsg });
            return true;
        }

        // === COMANDO SYNC ===
        if (comando === 'sync' || comando === 'sincronizar') {
            await sock.sendMessage(chatId, { text: '🔄 Sincronizando grupos...' });

            try {
                const result = await syncGroups();
                await sock.sendMessage(chatId, {
                    text: `✅ *Sincronização concluída!*\n\n` +
                        `📊 Grupos encontrados: ${result.found}\n` +
                        `➕ Novos adicionados: ${result.added}\n` +
                        `📁 Total registrado: ${result.total}`
                });
            } catch (error) {
                await sock.sendMessage(chatId, { text: `❌ Erro ao sincronizar: ${error.message}` });
            }

            log('🔄 Sincronização de grupos solicitada por:', senderNumber);
            return true;
        }

        // === COMANDO UPDATE ===
        if (comando === 'update' || comando === 'atualizar') {
            await sock.sendMessage(chatId, { text: '🔍 Verificando atualizações...' });

            const { exec } = require('child_process');

            exec('git fetch origin && git status -uno', { cwd: __dirname }, async (error, stdout) => {
                if (error) {
                    await sock.sendMessage(chatId, { text: `❌ Erro ao verificar: ${error.message}` });
                    return;
                }

                if (stdout.includes('behind')) {
                    await sock.sendMessage(chatId, {
                        text: `📦 *ATUALIZAÇÃO DISPONÍVEL!*\n\nPara atualizar, execute no servidor:\n\`\`\`\ncd ${__dirname}\ngit pull origin main\nnpm install\nnode bot.js\n\`\`\`\n\nOu execute: *update.bat*`
                    });
                } else {
                    await sock.sendMessage(chatId, { text: '✅ Bot já está na versão mais recente!' });
                }
            });

            log('🔍 Verificação de atualização solicitada por:', senderNumber);
            return true;
        }

        return false; // Não era um comando conhecido
    } catch (error) {
        log('❌ Erro ao processar comando:', error.message);
        await sock.sendMessage(chatId, { text: `❌ Erro: ${error.message}` });
        return true;
    }
}

// === CONEXÃO WHATSAPP COM BAILEYS ===
async function startWhatsApp() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
        const { version } = await fetchLatestBaileysVersion();

        log(`🚀 Iniciando WhatsApp com Baileys v${version.join('.')}`);
        console.log(`🚀 Iniciando WhatsApp com Baileys v${version.join('.')}`);

        sock = makeWASocket({
            version,
            logger,
            printQRInTerminal: false,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            browser: Browsers.ubuntu('Chrome'),
            generateHighQualityLinkPreview: false,
            syncFullHistory: false,
            markOnlineOnConnect: true,
        });

        // Salvar credenciais
        sock.ev.on('creds.update', saveCreds);

        // Handler de conexão
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log('\n' + '='.repeat(50));
                console.log('📱 QR CODE GERADO - ESCANEIE COM SEU WHATSAPP');
                console.log('='.repeat(50));

                // Gerar QR no terminal
                const qrString = await qrcode.toString(qr, { type: 'terminal', small: true });
                console.log(qrString);
                console.log('='.repeat(50) + '\n');

                log('🔲 QR Code gerado - Aguardando leitura pelo WhatsApp');
            }

            if (connection === 'open') {
                isConnected = true;
                const user = sock.user;
                log('🎉 WhatsApp conectado e pronto para uso!');
                console.log('🎉 WhatsApp conectado e pronto para uso!');
                console.log(`📱 Conectado como: ${user?.name || 'N/A'}`);
                console.log(`📞 Número: ${user?.id?.split(':')[0] || 'N/A'}`);
                console.log(`🤖 Bot operacional às ${new Date().toLocaleTimeString()}`);

                // Sincronizar grupos existentes ao conectar
                console.log('🔄 Sincronizando grupos existentes...');
                setTimeout(async () => {
                    try {
                        const result = await syncGroups();
                        console.log(`✅ Grupos sincronizados: ${result.found} encontrados, ${result.added} novos`);
                        log(`✅ Grupos sincronizados: ${result.found} encontrados, ${result.added} novos adicionados`);
                    } catch (error) {
                        log('⚠️ Erro ao sincronizar grupos:', error.message);
                    }
                }, 3000); // Aguarda 3s para garantir que a conexão está estável
            }

            if (connection === 'close') {
                isConnected = false;
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

                log('❌ WhatsApp desconectado:', lastDisconnect?.error?.message || 'Motivo desconhecido');
                console.log('❌ WhatsApp desconectado');

                if (shouldReconnect) {
                    console.log('🔄 Tentando reconectar em 5 segundos...');
                    setTimeout(startWhatsApp, 5000);
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
                    // Ignorar mensagens do próprio bot
                    if (msg.key.fromMe) continue;

                    // Pegar ID do remetente
                    const chatId = msg.key.remoteJid;
                    if (!chatId) continue;

                    // Verificar se é mensagem privada (não grupo)
                    const isGroup = chatId.endsWith('@g.us');
                    if (isGroup) continue; // Ignorar mensagens de grupos

                    // Pegar número do remetente
                    const senderNumber = chatId.replace('@s.whatsapp.net', '');
                    const admins = getAdmins();

                    if (!admins.includes(senderNumber)) {
                        log('⛔ Comando não autorizado de:', senderNumber);
                        continue;
                    }

                    // Verificar se é um comando
                    const isCommand = await processCommand(msg, senderNumber);
                    if (isCommand) continue;

                    // === PROCESSAMENTO DE MENSAGENS E MÍDIAS ===
                    const messageText = msg.message?.conversation ||
                        msg.message?.extendedTextMessage?.text ||
                        msg.message?.imageMessage?.caption || '';

                    let content = messageText;
                    let media = null;
                    let imageUrl = null;

                    // Verificar se há grupos cadastrados
                    const wppGroups = readJson(WHATSAPP_GROUPS_DB);
                    const tgChats = readJson(TELEGRAM_CHATS_DB);

                    if (wppGroups.length === 0 && tgChats.length === 0) {
                        await sock.sendMessage(chatId, { text: '❌ Nenhum grupo ou canal registrado ainda.' });
                        continue;
                    }

                    // Processar mídia enviada
                    if (msg.message?.imageMessage || msg.message?.videoMessage || msg.message?.documentMessage) {
                        log('📥 Processando mídia enviada...');
                        await sock.sendMessage(chatId, { text: '📥 Baixando mídia, aguarde...' });

                        const { downloadMediaMessage } = require('@anubis-pro/baileys');
                        const buffer = await downloadMediaMessage(msg, 'buffer', {});

                        if (buffer) {
                            const mimetype = msg.message?.imageMessage?.mimetype ||
                                msg.message?.videoMessage?.mimetype ||
                                msg.message?.documentMessage?.mimetype || 'application/octet-stream';

                            media = { buffer, mimetype };
                            content = msg.message?.imageMessage?.caption ||
                                msg.message?.videoMessage?.caption || '';

                            log('✅ Mídia processada:', { tipo: mimetype, tamanho: `${(buffer.length / 1024 / 1024).toFixed(2)}MB` });
                        }
                    }
                    // Verificar se é URL de mídia
                    else if (/https?:\/\/.+\.(jpg|jpeg|png|gif|webp|mp4|mov|avi)/i.test(content)) {
                        imageUrl = content.trim();
                        content = '';
                        log('🔗 URL de mídia detectada:', imageUrl);
                    }

                    // Enviar para todos os grupos
                    if (content || media || imageUrl) {
                        await sock.sendMessage(chatId, { text: '📤 Enviando para todos os grupos...' });

                        const resultado = await sendToAll(
                            content || '📣 Nova mensagem do admin!',
                            imageUrl,
                            media
                        );

                        await sock.sendMessage(chatId, { text: `✅ ${resultado.resumo}` });
                        log('📤 Envio solicitado por admin:', senderNumber);
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

        // Handler de participantes (detectar quando bot sai do grupo)
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
        log('❌ Erro na inicialização do WhatsApp:', error.message);
        console.error('❌ Erro na inicialização:', error);
        console.log('🔄 Tentando novamente em 10 segundos...');
        setTimeout(startWhatsApp, 10000);
    }
}

// === API EXPRESS ===
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
            resultado: resultado
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

    res.json({
        whatsapp: {
            connected: isConnected,
            groups: wppGroups.length,
            user: sock?.user || null,
            library: 'Baileys (@anubis-pro/baileys)'
        },
        telegram: {
            active: !!telegramBot,
            chats: tgChats.length
        },
        uptime: process.uptime(),
        memory: process.memoryUsage()
    });
});

// Endpoint de saúde
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString(), library: 'Baileys' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    log(`🚀 API rodando na porta ${PORT}`);
    console.log(`🌐 Endpoints disponíveis:`);
    console.log(`   POST http://localhost:${PORT}/send-to-all`);
    console.log(`   GET  http://localhost:${PORT}/status`);
    console.log(`   GET  http://localhost:${PORT}/health`);
});

// === TRATAMENTO DE SINAIS E LIMPEZA ===
process.on('SIGINT', async () => {
    log('🛑 Encerrando bot...');
    console.log('\n🛑 Encerrando bot graciosamente...');

    try {
        if (sock) {
            await sock.end();
        }
        if (telegramBot) {
            await telegramBot.stopPolling();
        }
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
console.log('📦 Usando biblioteca: @anubis-pro/baileys');
console.log('-'.repeat(60));

log('🤖 Bot iniciado com Baileys');
startWhatsApp();
