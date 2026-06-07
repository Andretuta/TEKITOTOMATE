require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const axios = require('axios');
const pino = require('pino');
const qrcode = require('qrcode');
const TelegramBot = require('node-telegram-bot-api');
const { exec } = require('child_process');

// Baileys - usando @whiskeysockets/baileys (oficial)
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    makeCacheableSignalKeyStore,
    Browsers
} = require('@whiskeysockets/baileys');

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
        // ANTI-BAN: Rotação de log para evitar arquivos gigantes (max 5MB)
        try {
            const stats = fs.statSync(LOG_FILE);
            if (stats.size > 5 * 1024 * 1024) {
                const backupFile = LOG_FILE.replace('.log', `.${Date.now()}.old.log`);
                fs.renameSync(LOG_FILE, backupFile);
                // Manter apenas os 2 últimos backups
                const logDir = path.dirname(LOG_FILE);
                const oldLogs = fs.readdirSync(logDir)
                    .filter(f => f.endsWith('.old.log'))
                    .sort()
                    .slice(0, -2);
                oldLogs.forEach(f => fs.unlinkSync(path.join(logDir, f)));
            }
        } catch (e) { /* arquivo ainda não existe, ok */ }
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

// Função de delay com jitter aleatório para humanizar os tempos
const delayWithJitter = (baseMs) => {
    const jitter = Math.floor(Math.random() * baseMs * 0.5); // ±50% de variação
    return delay(baseMs + jitter);
};

// === MODO DE VELOCIDADE (LENTO / RAPIDO) ===
let speedMode = 'rapido'; // Padrão: rápido (~40s para 13 grupos)

const SPEED_PROFILES = {
    rapido: {
        label: '🚀 RÁPIDO',
        description: '~40 segundos total',
        whatsapp: {
            batchSize: 1,
            batchDelay: 2000,      // 2s entre envios
            typingDelay: [500, 500], // 0.5-1s digitando
            maxRetries: 1
        },
        queueDelay: 5000           // 5s entre jobs da fila
    },
    lento: {
        label: '🐢 LENTO (SEGURO)',
        description: '~2 minutos total',
        whatsapp: {
            batchSize: 1,
            batchDelay: 8000,      // 8s entre envios
            typingDelay: [1500, 2000], // 1.5-3.5s digitando
            maxRetries: 1
        },
        queueDelay: 15000          // 15s entre jobs da fila
    }
};

function getSpeedConfig() {
    return SPEED_PROFILES[speedMode] || SPEED_PROFILES.rapido;
}

// === CONFIGURAÇÕES DE ENVIO ===
const PARALLEL_CONFIG = {
    telegram: {
        batchSize: 5,
        batchDelay: 1500,
        maxRetries: 2
    }
};

// === CONTROLE DE TAXA DE BROADCAST (AGORA NÃO TRAVA - APENAS AVISA) ===
const RATE_LIMIT = {
    maxBroadcastsPerHour: 8,  // 8 broadcasts por hora (referência)
    broadcastHistory: [],     // timestamps dos últimos broadcasts
    cooldownMs: 120000        // 2 minutos mínimo entre broadcasts (referência)
};

// Verifica rate limit mas NUNCA bloqueia - apenas retorna se está acima do limite
function checkRateLimit() {
    const now = Date.now();
    const oneHourAgo = now - 3600000;

    // Limpar broadcasts antigos (mais de 1 hora)
    RATE_LIMIT.broadcastHistory = RATE_LIMIT.broadcastHistory.filter(t => t > oneHourAgo);

    // Verificar limite por hora
    if (RATE_LIMIT.broadcastHistory.length >= RATE_LIMIT.maxBroadcastsPerHour) {
        return { exceeded: true, reason: 'hora', count: RATE_LIMIT.broadcastHistory.length };
    }

    // Verificar cooldown mínimo entre broadcasts
    const lastBroadcast = RATE_LIMIT.broadcastHistory[RATE_LIMIT.broadcastHistory.length - 1];
    if (lastBroadcast && (now - lastBroadcast) < RATE_LIMIT.cooldownMs) {
        const waitSeconds = Math.ceil((RATE_LIMIT.cooldownMs - (now - lastBroadcast)) / 1000);
        return { exceeded: true, reason: 'cooldown', waitSeconds };
    }

    return { exceeded: false };
}

function registerBroadcast() {
    RATE_LIMIT.broadcastHistory.push(Date.now());
}

// === MENSAGEM GIGANTE DE AVISO DE RATE LIMIT ===
function getRateLimitWarningMessage() {
    return `⚠️🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨⚠️

⛔⛔⛔ *RATE LIMIT ATINGIDO* ⛔⛔⛔

🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴

*ATENÇÃO CARALHO!!!*

O RATE LIMIT FOI ATINGIDO!!! 

SE CONTINUAR VOCÊ TOMA NO CU SEU CAOLHO DA PICA TORTA VAI PERDER O CHIP FDP!!!

🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴

O envio VAI continuar mas é POR SUA CONTA E RISCO!!!
O WhatsApp pode BANIR seu número a qualquer momento!!!

⚠️ VOCÊ FOI AVISADO SEU ARROMBADO ⚠️

🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨`;
}

function printRateLimitWarningCMD() {
    const separator = '!'.repeat(80);
    const warning = `
${separator}
${separator}
${'!'.repeat(20)}  RATE LIMIT ATINGIDO  ${'!'.repeat(20)}
${separator}
${separator}

    ██████╗  █████╗ ████████╗███████╗    ██╗     ██╗███╗   ███╗██╗████████╗
    ██╔══██╗██╔══██╗╚══██╔══╝██╔════╝    ██║     ██║████╗ ████║██║╚══██╔══╝
    ██████╔╝███████║   ██║   █████╗      ██║     ██║██╔████╔██║██║   ██║   
    ██╔══██╗██╔══██║   ██║   ██╔══╝      ██║     ██║██║╚██╔╝██║██║   ██║   
    ██║  ██║██║  ██║   ██║   ███████╗    ███████╗██║██║ ╚═╝ ██║██║   ██║   
    ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝   ╚══════╝    ╚══════╝╚═╝╚═╝     ╚═╝╚═╝   ╚═╝   

${separator}
    ⚠️⚠️⚠️  RATE LIMIT FOI ATINGIDO!!! CONTINUANDO POR CONTA E RISCO!!!  ⚠️⚠️⚠️
    
    SE CONTINUAR VOCÊ TOMA NO CU SEU CAOLHO DA PICA TORTA 
    VAI PERDER O CHIP FDP!!!
    
    O ENVIO VAI CONTINUAR MAS O WHATSAPP PODE BANIR A QUALQUER MOMENTO!!!
${separator}
${separator}
${separator}
`;
    console.log(warning);
}

// === CONTROLE DE GRUPOS MORTOS (auto-limpeza) ===
const DEAD_GROUPS = new Map(); // groupId -> contagem de falhas consecutivas
const MAX_CONSECUTIVE_FAILURES = 5; // remove grupo após 5 falhas seguidas

function trackGroupFailure(groupId) {
    const count = (DEAD_GROUPS.get(groupId) || 0) + 1;
    DEAD_GROUPS.set(groupId, count);
    if (count >= MAX_CONSECUTIVE_FAILURES) {
        log(`🗑️ Grupo ${groupId} removido automaticamente após ${count} falhas consecutivas`);
        const groups = readJson(WHATSAPP_GROUPS_DB).filter(g => g !== groupId);
        writeJson(WHATSAPP_GROUPS_DB, groups);
        DEAD_GROUPS.delete(groupId);
        return true; // removed
    }
    return false;
}

function trackGroupSuccess(groupId) {
    DEAD_GROUPS.delete(groupId); // reset counter on success
}

// === FUNÇÃO PARA EMBARALHAR ARRAY (Fisher-Yates) ===
function shuffleArray(arr) {
    const shuffled = [...arr];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

// === SISTEMA DE FILA DE BROADCASTS ===
const broadcastQueue = [];
let isProcessingQueue = false;

function addToQueue(job) {
    const queueItem = {
        id: Date.now(),
        ...job,
        addedAt: new Date().toLocaleTimeString(),
        status: 'waiting'
    };
    broadcastQueue.push(queueItem);
    log(`📋 Fila: novo job #${broadcastQueue.length} adicionado (total: ${broadcastQueue.length})`);
    
    // Iniciar processamento se não está rodando
    if (!isProcessingQueue) {
        processQueue();
    }
    
    return { position: broadcastQueue.length, id: queueItem.id };
}

async function processQueue() {
    if (isProcessingQueue) return;
    isProcessingQueue = true;
    
    while (broadcastQueue.length > 0) {
        const job = broadcastQueue[0];
        job.status = 'sending';
        const profile = getSpeedConfig();
        
        log(`📤 Fila: processando job (restam ${broadcastQueue.length} na fila) [modo: ${speedMode}]`);
        
        // Verificar rate limit - NÃO BLOQUEIA, apenas avisa
        let rateCheck = checkRateLimit();
        if (rateCheck.exceeded) {
            printRateLimitWarningCMD();
            log('🚨🚨🚨 RATE LIMIT ATINGIDO - CONTINUANDO POR CONTA E RISCO!!! 🚨🚨🚨');
            
            if (sock && isConnected && job.chatId) {
                try {
                    await sock.sendMessage(job.chatId, {
                        text: getRateLimitWarningMessage()
                    });
                } catch (e) {
                    log('❌ Erro ao enviar aviso de rate limit:', e.message);
                }
            }
        }
        
        try {
            // Notificar admin que o envio começou
            if (sock && isConnected && job.chatId) {
                const remainingMsg = broadcastQueue.length > 1
                    ? `\n📋 Restam ${broadcastQueue.length - 1} na fila depois desta.`
                    : '';
                const rateLimitTag = rateCheck.exceeded ? '\n🚨 *RATE LIMIT ATINGIDO - ENVIANDO POR SUA CONTA E RISCO!*' : '';
                const modeTag = `\n⚡ Modo: ${profile.label}`;
                await sock.sendMessage(job.chatId, {
                    text: `📤 Iniciando envio...${modeTag}${remainingMsg}${rateLimitTag}`
                });
            }
            
            const resultado = await sendToAll(job.content, job.imageUrl, job.media);
            
            // Notificar admin do resultado
            if (sock && isConnected && job.chatId) {
                const nextMsg = broadcastQueue.length > 1
                    ? `\n\n📋 Próximo envio da fila iniciando automaticamente... (${broadcastQueue.length - 1} restantes)`
                    : '';
                await sock.sendMessage(job.chatId, {
                    text: `✅ ${resultado.resumo}${nextMsg}`
                });
            }
            
            log('✅ Fila: job concluído com sucesso');
        } catch (error) {
            log('❌ Fila: erro no job:', error.message);
            if (sock && isConnected && job.chatId) {
                await sock.sendMessage(job.chatId, {
                    text: `❌ Erro no envio: ${error.message}`
                });
            }
        }
        
        // Remover job processado
        broadcastQueue.shift();
        
        // Pausa entre jobs da fila (baseada no modo)
        if (broadcastQueue.length > 0) {
            const qDelay = profile.queueDelay;
            log(`⏳ Fila: aguardando ${qDelay / 1000}s antes do próximo envio... [modo: ${speedMode}]`);
            await delay(qDelay);
        }
    }
    
    isProcessingQueue = false;
    log('📋 Fila: todas as postagens foram enviadas');
}


function getQueueStatus() {
    const profile = getSpeedConfig();
    if (broadcastQueue.length === 0) {
        return `📋 *FILA VAZIA*\nNenhum envio pendente.\n⚡ Modo atual: ${profile.label}`;
    }
    
    let status = `📋 *FILA DE ENVIOS* (${broadcastQueue.length} pendentes)\n⚡ Modo: ${profile.label}\n\n`;
    broadcastQueue.forEach((job, i) => {
        const icon = job.status === 'sending' ? '🔄' : '⏳';
        const mediaInfo = job.media ? '📎 com mídia' : job.imageUrl ? '🔗 com URL' : '💬 texto';
        const preview = (job.content || '').substring(0, 40);
        status += `${icon} #${i + 1} - ${mediaInfo} - "${preview}${preview.length >= 40 ? '...' : ''}" (${job.addedAt})\n`;
    });
    
    return status;
}

// === VARIÁVEIS GLOBAIS ===
let sock = null;
let telegramBot = null;
let isConnected = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 300000; // 5 minutos máximo entre reconexões
const MAX_RECONNECT_ATTEMPTS = 10;  // Máximo de tentativas antes de parar

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

// Função de envio em lotes com retry e tracking de grupos mortos
async function sendInBatches(items, sendFunction, config, platform) {
    const results = { success: 0, failed: 0, errors: [] };
    const totalItems = items.length;
    const profile = getSpeedConfig();

    // Calcular delay baseado no modo de velocidade
    let dynamicDelay = config.batchDelay || profile.whatsapp.batchDelay;
    let typingBase = profile.whatsapp.typingDelay[0];
    let typingJitter = profile.whatsapp.typingDelay[1];

    if (platform === 'WhatsApp') {
        if (speedMode === 'rapido' && totalItems > 1) {
            // Modo rápido: calcula delay dinâmico para ~40s total
            const targetTotalMs = 40000;
            dynamicDelay = Math.max(500, Math.floor(targetTotalMs / totalItems) - typingBase);
        } else {
            // Modo lento: usa o delay fixo do perfil
            dynamicDelay = profile.whatsapp.batchDelay;
        }
        log(`⏱️ WhatsApp [${speedMode}]: delay=${dynamicDelay}ms, digitação=${typingBase}-${typingBase + typingJitter}ms (${totalItems} grupos)`);
    }

    for (let i = 0; i < totalItems; i += config.batchSize || 1) {
        const batch = items.slice(i, i + (config.batchSize || 1));
        const batchNum = Math.floor(i / (config.batchSize || 1)) + 1;
        const totalBatches = Math.ceil(totalItems / (config.batchSize || 1));

        log(`📦 ${platform} Lote ${batchNum}/${totalBatches} (${batch.length} itens)`);

        const promises = batch.map(async (itemId) => {
            let lastError = null;
            const retries = config.maxRetries || profile.whatsapp.maxRetries;

            for (let attempt = 1; attempt <= retries; attempt++) {
                try {
                    // Simular digitação antes de enviar (apenas WhatsApp)
                    if (platform === 'WhatsApp' && sock) {
                        try {
                            await sock.sendPresenceUpdate('composing', itemId);
                            await delay(typingBase + Math.random() * typingJitter);
                            await sock.sendPresenceUpdate('paused', itemId);
                        } catch (e) { /* ignore presence errors */ }
                    }

                    await sendFunction(itemId);
                    results.success++;
                    trackGroupSuccess(itemId);
                    log(`✅ ${platform} [${results.success + results.failed}/${totalItems}]:`, itemId);
                    return;
                } catch (error) {
                    lastError = error;
                    if (attempt < retries) {
                        log(`⚠️ ${platform} Retry ${attempt}/${retries} para:`, itemId);
                        await delay(2000 * attempt);
                    }
                }
            }

            results.failed++;
            results.errors.push({ id: itemId, error: lastError?.message || 'Erro desconhecido' });
            log(`❌ ${platform} Falha após ${retries} tentativas:`, itemId, lastError?.message);

            // Rastrear falhas consecutivas de grupos
            if (platform === 'WhatsApp') {
                trackGroupFailure(itemId);
            }
        });

        await Promise.all(promises);

        if (i + (config.batchSize || 1) < totalItems) {
            await delayWithJitter(dynamicDelay);
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

// === FUNÇÃO DE ENVIO PARA TWITTER (PUPPETEER) ===
async function sendToTwitter(message, media) {
    if (!process.env.TWITTER_USERNAME) return { success: false, error: 'Usuário não configurado' };

    return new Promise((resolve) => {
        let cmd = 'node twitter_browser.js';
        let tempFile = null;

        // Tratar Mensagem (escapar aspas para linha de comando)
        if (message) {
            const safeMessage = message.replace(/"/g, '\\"');
            cmd += ` --text "${safeMessage}"`;
        }

        // Tratar Mídia
        if (media && media.buffer) {
            try {
                // Criar diretório temp se não existir
                const tempDir = path.join(__dirname, 'temp');
                if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

                // Determinar extensão
                const ext = media.mimetype ? media.mimetype.split('/')[1] : 'jpg';
                const filename = `upload_${Date.now()}.${ext}`;
                tempFile = path.join(tempDir, filename);

                // Salvar arquivo
                fs.writeFileSync(tempFile, media.buffer);
                cmd += ` --media "${tempFile}"`;
            } catch (err) {
                log('❌ Erro ao salvar mídia temporária:', err.message);
                return resolve({ success: false, error: 'Erro ao processar arquivo de mídia' });
            }
        }

        if (!message && !tempFile) {
            return resolve({ success: false, error: 'Nada para enviar' });
        }

        log('🐦 Executando automação Puppeteer...');

        exec(cmd, (error, stdout, stderr) => {
            // Limpar arquivo temporário
            if (tempFile && fs.existsSync(tempFile)) {
                try { fs.unlinkSync(tempFile); } catch (e) { }
            }

            if (error) {
                log(`❌ Erro no script Puppeteer: ${error.message}`);
                return resolve({ success: false, error: error.message });
            }

            try {
                // Tentar encontrar json valido no output (pode ter logs extras)
                const jsonMatch = stdout.match(/\{.*\}/);
                const jsonStr = jsonMatch ? jsonMatch[0] : stdout;
                const result = JSON.parse(jsonStr);

                if (result.success) {
                    log(`✅ Twitter: Postado com sucesso via Puppeteer!`);
                    resolve({ success: true, id: 'puppeteer-action' });
                } else {
                    log(`❌ Twitter: Puppeteer retornou erro: ${result.error}`);
                    resolve({ success: false, error: result.error });
                }
            } catch (parseError) {
                log(`❌ Twitter: Erro ao ler resposta do Puppeteer: ${stdout}`);
                resolve({ success: false, error: 'Resposta inválida do script de automação' });
            }
        });
    });
}

// === FUNÇÃO DE ENVIO PRINCIPAL ===
async function sendToAll(message, imageUrl = null, directMedia = null, useTwitter = false) {
    // RATE LIMIT: Verificar mas NÃO BLOQUEAR - apenas avisar
    const rateCheck = checkRateLimit();
    if (rateCheck.exceeded) {
        // AVISO GIGANTE NO CMD
        printRateLimitWarningCMD();
        log('🚨🚨🚨 RATE LIMIT ATINGIDO NA FUNÇÃO sendToAll - CONTINUANDO MESMO ASSIM!!! 🚨🚨🚨');
    }

    // Registrar este broadcast independente do rate limit
    registerBroadcast();

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
        whatsappReady: isConnected,
        twitter: useTwitter,
        rateLimitExceeded: rateCheck.exceeded
    });

    let wppResults = { success: 0, failed: 0, errors: [] };
    let tgResults = { success: 0, failed: 0, errors: [] };
    let twitterResult = { success: false, error: null };

    // Envio para Twitter
    const twitterPromise = (async () => {
        if (useTwitter && process.env.TWITTER_USERNAME) {
            log('🐦 Iniciando envio para Twitter...');
            return await sendToTwitter(message, media);
        }
        return { success: false, skipped: true };
    })();

    // Envios WhatsApp (sequencial com jitter)
    if (isConnected && sock && wppGroups.length > 0) {
        const profile = getSpeedConfig();
        const shuffledGroups = shuffleArray(wppGroups);
        log(`📱 Enviando para ${shuffledGroups.length} grupos [modo: ${speedMode} - ${profile.description}]`);

        wppResults = await sendInBatches(
            shuffledGroups,
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
            profile.whatsapp,
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

    // Aguardar Twitter
    twitterResult = await twitterPromise;
    if (twitterResult.success) {
        log('✅ Twitter: Tweet postado com sucesso');
    } else if (!twitterResult.skipped) {
        log('❌ Twitter: Falha ao postar:', twitterResult.error);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const rateLimitTag = rateCheck.exceeded ? ' ⚠️[RATE LIMIT EXCEDIDO]' : '';
    const resumo = `📊 Envio concluído em ${elapsed}s: WPP(${wppResults.success}✅/${wppResults.failed}❌) TG(${tgResults.success}✅/${tgResults.failed}❌)${rateLimitTag}`;
    log(resumo);

    return {
        whatsapp: { sucessos: wppResults.success, falhas: wppResults.failed, erros: wppResults.errors },
        telegram: { sucessos: tgResults.success, falhas: tgResults.failed, erros: tgResults.errors },
        twitter: twitterResult,
        tempoTotal: elapsed + 's',
        resumo,
        rateLimitExceeded: rateCheck.exceeded
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

            const rateCheck = checkRateLimit();
            const rateLimitStatus = rateCheck.exceeded 
                ? '🚨 EXCEDIDO (enviando por conta e risco!)' 
                : `✅ OK (${RATE_LIMIT.broadcastHistory.length}/${RATE_LIMIT.maxBroadcastsPerHour})`;

            const profile = getSpeedConfig();
            const statusMsg =
                `📊 *STATUS DO BOT*\n\n` +
                `🔸 WhatsApp: ${isWppReady}\n` +
                `🔸 Grupos WPP: ${wppGroups.length}\n` +
                `🔸 Telegram: ${isTgReady}\n` +
                `🔸 Chats TG: ${tgChats.length}\n` +
                `🔸 Twitter: ${process.env.TWITTER_USERNAME ? '✅ Configurado' : '❌ Não configurado'}\n` +
                `🔸 Uptime: ${Math.floor(process.uptime() / 60)}min\n` +
                `🔸 Memória: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB\n` +
                `🔸 Biblioteca: Baileys\n` +
                `🔸 Rate Limit: ${rateLimitStatus}\n` +
                `🔸 Grupos c/ falha: ${DEAD_GROUPS.size}\n` +
                `🔸 Velocidade: ${profile.label} (${profile.description})`;

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

        // === COMANDO FILA ===
        if (comando === 'fila' || comando === 'queue') {
            await sock.sendMessage(chatId, { text: getQueueStatus() });
            return true;
        }

        // === COMANDO RAPIDO ===
        if (comando === 'rapido' || comando === 'rápido' || comando === 'fast') {
            speedMode = 'rapido';
            const profile = getSpeedConfig();
            await sock.sendMessage(chatId, {
                text: `⚡ *MODO ALTERADO: ${profile.label}*\n\n` +
                    `⏱️ Tempo total: ${profile.description}\n` +
                    `📊 Delay entre envios: ${profile.whatsapp.batchDelay / 1000}s\n` +
                    `⌨️ Digitação: ${profile.whatsapp.typingDelay[0] / 1000}-${(profile.whatsapp.typingDelay[0] + profile.whatsapp.typingDelay[1]) / 1000}s\n` +
                    `📋 Pausa entre filas: ${profile.queueDelay / 1000}s\n\n` +
                    `⚠️ Mais rápido, porém menos seguro contra ban.`
            });
            log(`⚡ Modo de velocidade alterado para RÁPIDO por ${senderNumber}`);
            return true;
        }

        // === COMANDO LENTO ===
        if (comando === 'lento' || comando === 'slow' || comando === 'seguro') {
            speedMode = 'lento';
            const profile = getSpeedConfig();
            await sock.sendMessage(chatId, {
                text: `🐢 *MODO ALTERADO: ${profile.label}*\n\n` +
                    `⏱️ Tempo total: ${profile.description}\n` +
                    `📊 Delay entre envios: ${profile.whatsapp.batchDelay / 1000}s\n` +
                    `⌨️ Digitação: ${profile.whatsapp.typingDelay[0] / 1000}-${(profile.whatsapp.typingDelay[0] + profile.whatsapp.typingDelay[1]) / 1000}s\n` +
                    `📋 Pausa entre filas: ${profile.queueDelay / 1000}s\n\n` +
                    `✅ Mais seguro contra ban do WhatsApp.`
            });
            log(`🐢 Modo de velocidade alterado para LENTO por ${senderNumber}`);
            return true;
        }

        // === COMANDO HELP ===
        if (comando === 'help' || comando === 'ajuda') {
            const profile = getSpeedConfig();
            const helpMsg =
                `🤖 *COMANDOS DISPONÍVEIS:*\n\n` +
                `• *status* - Ver status do bot\n` +
                `• *test* - Testar funcionamento\n` +
                `• *fila* - Ver fila de envios\n` +
                `• *rapido* - Modo rápido (~40s) ⚡\n` +
                `• *lento* - Modo lento/seguro (~2min) 🐢\n` +
                `• *sync* - Sincronizar grupos\n` +
                `• *update* - Verificar atualizações\n` +
                `• */x* - Postar no Twitter + Broadcast\n` +
                `• *reset* - Resetar sessão\n` +
                `• *help* - Esta ajuda\n\n` +
                `📝 *Para enviar mensagens para TODOS:*\n` +
                `• Digite a mensagem normalmente\n` +
                `• Envie uma imagem com legenda\n` +
                `• Envie apenas uma URL de imagem\n\n` +
                `📋 *Fila:* Envie várias mensagens seguidas!\n` +
                `Elas entram na fila e são enviadas uma após a outra.\n\n` +
                `⚡ *Modo atual:* ${profile.label} (${profile.description})\n` +
                `⚠️ *Rate Limit:* O bot NÃO trava, apenas avisa!`;

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

        // === COMANDO X (TWITTER ONLY) ===
        if (comando.startsWith('/x')) {
            const { downloadMediaMessage } = require('@whiskeysockets/baileys');

            // Extrair texto (remove o /x e espaços iniciais)
            let textToPost = messageText.slice(2).trim();

            log(`🐦 Comando /x detectado: "${textToPost}"`);
            await sock.sendMessage(chatId, { text: '🐦 Processando post para o Twitter...' });

            let mediaBuffer = null;
            let mimeType = null;

            // 1. Verificar se mensagem atual tem imagem direta
            if (msg.message?.imageMessage) {
                try {
                    mediaBuffer = await downloadMediaMessage(msg, 'buffer', {});
                    mimeType = msg.message.imageMessage.mimetype || 'image/jpeg';
                } catch (e) {
                    log('❌ Erro ao baixar imagem direta:', e.message);
                }
            }
            // 2. Verificar se é uma resposta (Reply) a uma imagem
            else {
                const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                if (quoted && (quoted.imageMessage || quoted.videoMessage)) {
                    try {
                        const fakeMsg = { message: quoted };
                        mediaBuffer = await downloadMediaMessage(fakeMsg, 'buffer', {});

                        if (quoted.imageMessage) mimeType = quoted.imageMessage.mimetype || 'image/jpeg';
                        if (quoted.videoMessage) mimeType = quoted.videoMessage.mimetype || 'video/mp4';
                    } catch (e) {
                        log('❌ Erro ao baixar imagem citada:', e.message);
                    }
                }
            }

            if (!textToPost && !mediaBuffer) {
                await sock.sendMessage(chatId, { text: '❌ Conteúdo vazio.\nUse: */x Seu Texto*\nOu envie uma foto com a legenda */x*\nOu responda a uma foto com */x*' });
                return true;
            }

            // Enviar para TODOS (Grupos + Twitter ativado)
            const mediaObj = mediaBuffer ? { buffer: mediaBuffer, mimetype: mimeType } : null;

            await sock.sendMessage(chatId, { text: '📤 Enviando broadcast global (WPP + Telegram + X)...' });

            const result = await sendToAll(textToPost, null, mediaObj, true); // true = USE TWITTER

            await sock.sendMessage(chatId, { text: `✅ ${result.resumo}` });
            if (result.twitter.success) {
                await sock.sendMessage(chatId, { text: '✅ Tweet postado!' });
            } else if (!result.twitter.skipped) {
                await sock.sendMessage(chatId, { text: `❌ Erro no Twitter: ${result.twitter.error}` });
            }

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

        // Buscar versão mais recente do WhatsApp Web direto do repositório oficial
        let version;
        try {
            const response = await axios.get(
                'https://raw.githubusercontent.com/WhiskeySockets/Baileys/master/src/Defaults/baileys-version.json',
                { timeout: 10000 }
            );
            version = response.data.version;
            log(`📱 Versão WhatsApp Web (GitHub): ${version.join('.')}`);
        } catch (e) {
            version = [2, 3000, 1033105955]; // fallback atualizado
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
                reconnectAttempts = 0; // Reset ao conectar com sucesso
                const user = sock.user;
                log('🎉 WhatsApp conectado e pronto para uso!');
                console.log('🎉 WhatsApp conectado e pronto para uso!');
                console.log(`📱 Conectado como: ${user?.name || 'N/A'}`);
                console.log(`📞 Número: ${user?.id?.split(':')[0] || 'N/A'}`);
                console.log(`🤖 Bot operacional às ${new Date().toLocaleTimeString()}`);
                const startProfile = getSpeedConfig();
                console.log(`⚡ Modo de velocidade: ${startProfile.label} (${startProfile.description})`);
                console.log(`⚠️ Rate Limit: NÃO trava - apenas avisa e continua`);
                console.log(`💡 Comandos: 'rapido' ou 'lento' para trocar modo`);

                // Sincronizar grupos existentes ao conectar (com delay maior)
                console.log('🔄 Sincronizando grupos existentes...');
                setTimeout(async () => {
                    try {
                        const result = await syncGroups();
                        console.log(`✅ Grupos sincronizados: ${result.found} encontrados, ${result.added} novos`);
                        log(`✅ Grupos sincronizados: ${result.found} encontrados, ${result.added} novos adicionados`);
                    } catch (error) {
                        log('⚠️ Erro ao sincronizar grupos:', error.message);
                    }
                }, 10000); // Aguarda 10s para garantir que a conexão está estável
            }

            if (connection === 'close') {
                isConnected = false;
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                // Log detalhado do erro
                console.log('❌ WhatsApp desconectado - DETALHES:');
                console.log('   Status Code:', statusCode);
                console.log('   DisconnectReason.loggedOut:', DisconnectReason.loggedOut);
                console.log('   Erro completo:', JSON.stringify(lastDisconnect?.error, null, 2));
                console.log('   Stack:', lastDisconnect?.error?.stack);
                log('❌ WhatsApp desconectado:', lastDisconnect?.error?.message || 'Motivo desconhecido', '| StatusCode:', statusCode);

                // StatusCode 403 = conta bloqueada/restringida
                if (statusCode === 403) {
                    reconnectAttempts++;
                    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
                        console.log('🛑 CONTA RESTRINGIDA! Parando reconexão após', MAX_RECONNECT_ATTEMPTS, 'tentativas.');
                        console.log('🛑 Aguarde a restrição expirar e reinicie o bot manualmente.');
                        log('🛑 CONTA RESTRINGIDA - Reconexão interrompida após', MAX_RECONNECT_ATTEMPTS, 'tentativas. Aguarde a restrição expirar.');
                        return; // NÃO tenta reconectar mais
                    }
                    // Backoff exponencial: 10s, 20s, 40s, 80s, 160s, 300s(max)...
                    const backoffDelay = Math.min(10000 * Math.pow(2, reconnectAttempts - 1), MAX_RECONNECT_DELAY);
                    const delaySec = Math.round(backoffDelay / 1000);
                    console.log(`⏳ Conta possivelmente restringida (403). Tentativa ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}. Próxima tentativa em ${delaySec}s...`);
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
                    // Ignorar mensagens do próprio bot
                    if (msg.key.fromMe) continue;

                    // Pegar ID do remetente
                    const chatId = msg.key.remoteJid;
                    if (!chatId) continue;

                    // Verificar se é mensagem privada (não grupo)
                    const isGroup = chatId.endsWith('@g.us');
                    if (isGroup) continue; // Ignorar mensagens de grupos

                    // Pegar número do remetente (suporta formato LID e número normal)
                    const isLid = chatId.endsWith('@lid');
                    const senderNumber = isLid
                        ? chatId.replace('@lid', '')
                        : chatId.replace('@s.whatsapp.net', '');
                    const admins = getAdmins();

                    // Verificar se o remetente é admin (por número OU por LID)
                    const isAdmin = admins.includes(senderNumber);
                    if (!isAdmin) {
                        log(`⛔ Comando não autorizado de: ${senderNumber} (formato: ${isLid ? 'LID' : 'número'}, chatId: ${chatId})`);
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

                        const { downloadMediaMessage } = require('@whiskeysockets/baileys');
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

                    // Adicionar à fila de envios
                    if (content || media || imageUrl) {
                        const queueInfo = addToQueue({
                            content: content || '📣 Nova mensagem do admin!',
                            imageUrl,
                            media,
                            chatId,
                            senderNumber
                        });

                        if (queueInfo.position === 1 && !isProcessingQueue) {
                            // Primeira da fila, vai iniciar agora (mensagem enviada pelo processQueue)
                        } else if (queueInfo.position === 1) {
                            // processQueue já está rodando, esta é a próxima
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

        // Se rate limit excedido, avisar mas NÃO bloquear (status 200 com warning)
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
            connected: isConnected,
            groups: wppGroups.length,
            user: sock?.user || null,
            library: 'Baileys (@whiskeysockets/baileys)'
        },
        telegram: {
            active: !!telegramBot,
            chats: tgChats.length
        },
        rateLimit: {
            exceeded: rateCheck.exceeded,
            broadcastsThisHour: RATE_LIMIT.broadcastHistory.length,
            maxPerHour: RATE_LIMIT.maxBroadcastsPerHour,
            note: 'Rate limit NÃO bloqueia envios - apenas avisa'
        },
        sendTime: '~40 segundos total',
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
console.log('📦 Usando biblioteca: @whiskeysockets/baileys (oficial)');
console.log('⏱️ Tempo de envio: ~40 segundos total');
console.log('⚠️ Rate Limit: NÃO trava - continua e avisa com mensagem GIGANTE');
console.log('-'.repeat(60));

log('🤖 Bot iniciado com Baileys');
startWhatsApp();
