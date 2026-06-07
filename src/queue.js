const fs = require('fs');
const path = require('path');
const { log, delay, readJson, writeJson } = require('./utils');
const { getSpeedConfig, getSpeedMode, MEDIA_CACHE_DIR, BASE_DIR } = require('./config');

// === PERSISTÊNCIA DA FILA ===
const QUEUE_STATE_FILE = path.join(BASE_DIR, 'media_cache', 'queue_state.json');

// === FILA DE BROADCASTS ===
let broadcastQueue = [];
let isProcessingQueue = false;

// Referências para o socket e estado (injetados pelo bot.js)
let _sock = null;
let _isConnected = () => false;
let _sendToAll = null;

function initQueue(sock, isConnectedFn, sendToAllFn) {
    _sock = sock;
    _isConnected = isConnectedFn;
    _sendToAll = sendToAllFn;
    
    // Restaurar fila salva do disco (sobrevive reinicializações)
    loadQueueState();
}

function updateQueueSocket(sock) {
    _sock = sock;
}

// === SALVAR / CARREGAR ESTADO DA FILA ===
function saveQueueState() {
    try {
        const state = broadcastQueue.map(job => ({
            id: job.id,
            content: job.content,
            imageUrl: job.imageUrl || null,
            mediaPath: job.mediaPath || null,
            mimetype: job.mimetype || null,
            chatId: job.chatId,
            senderNumber: job.senderNumber,
            addedAt: job.addedAt,
            status: job.status,
            useTwitter: job.useTwitter || false
        }));
        fs.writeFileSync(QUEUE_STATE_FILE, JSON.stringify(state, null, 2));
    } catch (e) {
        log('⚠️ Erro ao salvar estado da fila:', e.message);
    }
}

function loadQueueState() {
    try {
        if (fs.existsSync(QUEUE_STATE_FILE)) {
            const state = JSON.parse(fs.readFileSync(QUEUE_STATE_FILE, 'utf8'));
            if (Array.isArray(state) && state.length > 0) {
                // Filtrar jobs cujo arquivo de mídia ainda existe
                const validJobs = state.filter(job => {
                    if (job.mediaPath && !fs.existsSync(job.mediaPath)) {
                        log(`⚠️ Fila restaurada: arquivo não encontrado, descartando job: ${job.mediaPath}`);
                        return false;
                    }
                    return true;
                });
                
                if (validJobs.length > 0) {
                    broadcastQueue.push(...validJobs.map(job => ({ ...job, status: 'waiting' })));
                    log(`📂 Fila restaurada do disco: ${validJobs.length} jobs pendentes`);
                    
                    // Iniciar processamento da fila restaurada
                    if (!isProcessingQueue) {
                        setTimeout(() => processQueue(), 5000); // Esperar 5s para conexão estabilizar
                    }
                }
            }
            // Limpar o arquivo de estado após carregar
            fs.unlinkSync(QUEUE_STATE_FILE);
        }
        
        // Limpar arquivos órfãos do media_cache (que não estão na fila)
        cleanOrphanedCache();
    } catch (e) {
        log('⚠️ Erro ao restaurar fila do disco:', e.message);
    }
}

function cleanOrphanedCache() {
    try {
        if (!fs.existsSync(MEDIA_CACHE_DIR)) return;
        
        const filesInQueue = new Set(
            broadcastQueue
                .filter(j => j.mediaPath)
                .map(j => path.resolve(j.mediaPath))
        );
        
        const files = fs.readdirSync(MEDIA_CACHE_DIR)
            .filter(f => f !== 'queue_state.json');
        
        let cleaned = 0;
        for (const file of files) {
            const filePath = path.resolve(path.join(MEDIA_CACHE_DIR, file));
            if (!filesInQueue.has(filePath)) {
                fs.unlinkSync(filePath);
                cleaned++;
            }
        }
        
        if (cleaned > 0) {
            log(`🗑️ Cache limpo: ${cleaned} arquivo(s) órfão(s) removido(s)`);
        }
    } catch (e) {
        log('⚠️ Erro ao limpar cache órfão:', e.message);
    }
}

function addToQueue(job) {
    const queueItem = {
        id: Date.now(),
        ...job,
        addedAt: new Date().toLocaleTimeString(),
        status: 'waiting'
    };
    broadcastQueue.push(queueItem);
    log(`📋 Fila: novo job #${broadcastQueue.length} adicionado (total: ${broadcastQueue.length})`);
    
    // Salvar estado da fila em disco
    saveQueueState();
    
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
        const { checkRateLimit } = require('./config');
        const { getRateLimitWarningMessage, printRateLimitWarningCMD } = require('./rateLimit');
        
        log(`📤 Fila: processando job (restam ${broadcastQueue.length} na fila) [modo: ${getSpeedMode()}]`);
        
        let rateCheck = checkRateLimit();
        if (rateCheck.exceeded) {
            printRateLimitWarningCMD();
            log('🚨🚨🚨 RATE LIMIT ATINGIDO - CONTINUANDO POR CONTA E RISCO!!! 🚨🚨🚨');
            
            if (_sock && _isConnected() && job.chatId) {
                try {
                    await _sock.sendMessage(job.chatId, {
                        text: getRateLimitWarningMessage()
                    });
                } catch (e) {
                    log('❌ Erro ao enviar aviso de rate limit:', e.message);
                }
            }
        }
        
        try {
            if (_sock && _isConnected() && job.chatId) {
                const remainingMsg = broadcastQueue.length > 1
                    ? `\n📋 Restam ${broadcastQueue.length - 1} na fila depois desta.`
                    : '';
                const rateLimitTag = rateCheck.exceeded ? '\n🚨 *RATE LIMIT ATINGIDO - ENVIANDO POR SUA CONTA E RISCO!*' : '';
                const modeTag = `\n⚡ Modo: ${profile.label}`;
                await _sock.sendMessage(job.chatId, {
                    text: `📤 Iniciando envio...${modeTag}${remainingMsg}${rateLimitTag}`
                });
            }
            
            const resultado = await _sendToAll(
                job.content, 
                job.imageUrl, 
                // Passar objeto com mediaPath para o sendToAll carregar do disco
                job.mediaPath ? { mediaPath: job.mediaPath, mimetype: job.mimetype } : job.media,
                // Flag para postar no Twitter (vem do comando /x)
                job.useTwitter || false
            );
            
            if (_sock && _isConnected() && job.chatId) {
                const nextMsg = broadcastQueue.length > 1
                    ? `\n\n📋 Próximo envio da fila iniciando automaticamente... (${broadcastQueue.length - 1} restantes)`
                    : '';
                await _sock.sendMessage(job.chatId, {
                    text: `✅ ${resultado.resumo}${nextMsg}`
                });
            }
            
            log('✅ Fila: job concluído com sucesso');
        } catch (error) {
            log('❌ Fila: erro no job:', error.message);
            if (_sock && _isConnected() && job.chatId) {
                try {
                    await _sock.sendMessage(job.chatId, {
                        text: `❌ Erro no envio: ${error.message}`
                    });
                } catch (e) {
                    log('⚠️ Erro ao enviar notificação de falha:', e.message);
                }
            }
        }
        
        // Limpar arquivo de cache de mídia após processamento
        if (job.mediaPath) {
            try {
                if (fs.existsSync(job.mediaPath)) {
                    fs.unlinkSync(job.mediaPath);
                    log(`🗑️ Cache de mídia limpo: ${job.mediaPath}`);
                }
            } catch (e) {
                log('⚠️ Erro ao limpar cache de mídia:', e.message);
            }
        }
        
        broadcastQueue.shift();
        
        // Atualizar estado salvo no disco
        saveQueueState();
        
        if (broadcastQueue.length > 0) {
            const qDelay = profile.queueDelay;
            log(`⏳ Fila: aguardando ${qDelay / 1000}s antes do próximo envio... [modo: ${getSpeedMode()}]`);
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
        const mediaInfo = (job.media || job.mediaPath) ? '📎 com mídia' : job.imageUrl ? '🔗 com URL' : '💬 texto';
        const preview = (job.content || '').substring(0, 40);
        status += `${icon} #${i + 1} - ${mediaInfo} - "${preview}${preview.length >= 40 ? '...' : ''}" (${job.addedAt})\n`;
    });
    
    return status;
}

function isQueueProcessing() {
    return isProcessingQueue;
}

module.exports = {
    initQueue,
    updateQueueSocket,
    addToQueue,
    processQueue,
    getQueueStatus,
    isQueueProcessing,
    broadcastQueue
};
