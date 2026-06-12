const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { log, delay } = require('./utils');
const { getSpeedConfig, getSpeedMode, MEDIA_CACHE_DIR, BASE_DIR } = require('./config');

// === PERSISTÊNCIA DA FILA ===
const QUEUE_STATE_FILE = path.join(BASE_DIR, 'media_cache', 'queue_state.json');

// === FILA DE BROADCASTS ===
let broadcastQueue = [];
let isProcessingQueue = false;
let queueStateLoaded = false;

// Controle simples contra duplicidade em memória
const recentFingerprints = new Map();
const DUPLICATE_WINDOW_MS = 5 * 60 * 1000; // 5 minutos

// Referências para o socket e estado (injetados pelo bot.js)
let _sock = null;
let _isConnected = () => false;
let _sendToAll = null;

function initQueue(sock, isConnectedFn, sendToAllFn) {
    _sock = sock;
    _isConnected = isConnectedFn;
    _sendToAll = sendToAllFn;

    // IMPORTANTE:
    // Carregar fila do disco apenas uma vez por processo.
    // Em reconexões do WhatsApp, initQueue pode ser chamado novamente.
    // Se carregar de novo, pode duplicar jobs já existentes na fila.
    if (!queueStateLoaded) {
        queueStateLoaded = true;
        loadQueueState();
    }
}

function updateQueueSocket(sock) {
    _sock = sock;
}

// === FINGERPRINT / ANTI-DUPLICIDADE ===

function cleanupRecentFingerprints() {
    const now = Date.now();

    for (const [fingerprint, timestamp] of recentFingerprints.entries()) {
        if (now - timestamp > DUPLICATE_WINDOW_MS) {
            recentFingerprints.delete(fingerprint);
        }
    }
}

function getFileHash(filePath) {
    try {
        if (!filePath || !fs.existsSync(filePath)) return '';

        const buffer = fs.readFileSync(filePath);
        return crypto.createHash('sha256').update(buffer).digest('hex');
    } catch (error) {
        log('⚠️ Erro ao gerar hash da mídia:', error.message);
        return '';
    }
}

function getJobFingerprint(job) {
    const content = job.content || '';
    const imageUrl = job.imageUrl || '';
    const mimetype = job.mimetype || '';
    const senderNumber = job.senderNumber || '';
    const altJid = job.altJid || '';
    const useTwitter = job.useTwitter ? 'twitter' : 'no-twitter';

    // Para mídia salva em cache, usa hash real do arquivo.
    // Isso evita que a mesma imagem com nomes diferentes passe como job diferente.
    const mediaHash = job.mediaPath
        ? getFileHash(job.mediaPath)
        : job.media?.buffer
            ? crypto.createHash('sha256').update(job.media.buffer).digest('hex')
            : '';

    return crypto
        .createHash('sha256')
        .update([content, imageUrl, mimetype, senderNumber, altJid, useTwitter, mediaHash].join('|'))
        .digest('hex');
}

function isDuplicateJob(job) {
    cleanupRecentFingerprints();

    const fingerprint = job.fingerprint || getJobFingerprint(job);
    const now = Date.now();

    // Verifica jobs recentes já processados/adicionados
    if (recentFingerprints.has(fingerprint)) {
        const lastTime = recentFingerprints.get(fingerprint);

        if (now - lastTime <= DUPLICATE_WINDOW_MS) {
            return true;
        }
    }

    // Verifica jobs ainda na fila
    return broadcastQueue.some(existingJob => {
        const existingFingerprint = existingJob.fingerprint || getJobFingerprint(existingJob);
        return existingFingerprint === fingerprint;
    });
}

// === SALVAR / CARREGAR ESTADO DA FILA ===

function saveQueueState() {
    try {
        // IMPORTANTE:
        // Não salvar job com status "sending".
        // Se o bot reiniciar no meio do envio, restaurar esse job pode reenviar para grupos
        // que já receberam a postagem.
        const state = broadcastQueue
            .filter(job => job.status !== 'sending')
            .map(job => ({
                id: job.id,
                fingerprint: job.fingerprint || null,
                content: job.content,
                imageUrl: job.imageUrl || null,
                mediaPath: job.mediaPath || null,
                mimetype: job.mimetype || null,
                chatId: job.chatId,
                senderNumber: job.senderNumber,
                altJid: job.altJid,
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
                const validJobs = state.filter(job => {
                    // Nunca restaurar job que estava enviando.
                    // Isso evita reenvio duplicado depois de reinicialização/reconexão.
                    if (job.status === 'sending') {
                        log(`⚠️ Fila restaurada: descartando job que estava em envio para evitar duplicidade: ${job.id}`);
                        return false;
                    }

                    if (job.mediaPath && !fs.existsSync(job.mediaPath)) {
                        log(`⚠️ Fila restaurada: arquivo não encontrado, descartando job: ${job.mediaPath}`);
                        return false;
                    }

                    return true;
                });

                const jobsToRestore = [];

                for (const job of validJobs) {
                    const restoredJob = {
                        ...job,
                        status: 'waiting',
                        fingerprint: job.fingerprint || getJobFingerprint(job)
                    };

                    if (isDuplicateJob(restoredJob)) {
                        log(`⚠️ Fila restaurada: job duplicado ignorado: ${restoredJob.id}`);
                        continue;
                    }

                    recentFingerprints.set(restoredJob.fingerprint, Date.now());
                    jobsToRestore.push(restoredJob);
                }

                if (jobsToRestore.length > 0) {
                    broadcastQueue.push(...jobsToRestore);
                    log(`📂 Fila restaurada do disco: ${jobsToRestore.length} job(s) pendente(s)`);

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
    const fingerprint = getJobFingerprint(job);

    const queueItem = {
        id: Date.now(),
        fingerprint,
        ...job,
        addedAt: new Date().toLocaleTimeString(),
        status: 'waiting'
    };

    if (isDuplicateJob(queueItem)) {
        const existingIndex = broadcastQueue.findIndex(existingJob => {
            const existingFingerprint = existingJob.fingerprint || getJobFingerprint(existingJob);
            return existingFingerprint === fingerprint;
        });

        log('⚠️ Fila: job duplicado ignorado para evitar reenvio');

        return {
            position: existingIndex >= 0 ? existingIndex + 1 : broadcastQueue.length,
            id: queueItem.id,
            duplicate: true
        };
    }

    recentFingerprints.set(fingerprint, Date.now());

    broadcastQueue.push(queueItem);

    log(`📋 Fila: novo job #${broadcastQueue.length} adicionado (total: ${broadcastQueue.length})`);

    // Salvar estado da fila em disco
    saveQueueState();

    if (!isProcessingQueue) {
        processQueue();
    }

    return {
        position: broadcastQueue.length,
        id: queueItem.id,
        duplicate: false
    };
}

async function processQueue() {
    if (isProcessingQueue) return;

    isProcessingQueue = true;

    while (broadcastQueue.length > 0) {
        const job = broadcastQueue[0];
        job.status = 'sending';

        // Atualiza o estado assim que o job começa a enviar.
        // Como saveQueueState ignora "sending", esse job não será restaurado
        // caso o bot reinicie no meio do envio.
        saveQueueState();

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

                const rateLimitTag = rateCheck.exceeded
                    ? '\n🚨 *RATE LIMIT ATINGIDO - ENVIANDO POR SUA CONTA E RISCO!*'
                    : '';

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
        const mediaInfo = (job.media || job.mediaPath)
            ? '📎 com mídia'
            : job.imageUrl
                ? '🔗 com URL'
                : '💬 texto';

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