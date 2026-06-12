const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { exec } = require('child_process');

const {
    log,
    readJson,
    writeJson,
    delay,
    delayWithJitter,
    isConnectionError,
    trackGroupFailure,
    trackGroupSuccess,
    shuffleArray
} = require('./utils');

const {
    getSpeedConfig,
    getSpeedMode,
    PARALLEL_CONFIG,
    WHATSAPP_GROUPS_DB,
    TELEGRAM_CHATS_DB,
    BASE_DIR,
    checkRateLimit,
    registerBroadcast
} = require('./config');

// Verificar se o socket WebSocket está vivo
function isSocketAlive(sock) {
    try {
        if (!sock) return false;

        // Verificar via readyState se disponível
        if (sock.ws && typeof sock.ws.readyState === 'number') {
            return sock.ws.readyState === 1; // OPEN
        }

        // Fallback: se sock.user existe e _isConnected é true, considerar vivo
        // Baileys v7 nem sempre expõe ws.readyState imediatamente após reconexão
        if (sock.user && _isConnected()) {
            return true;
        }

        return false;
    } catch (e) {
        return false;
    }
}

// Referências injetadas
let _sock = null;
let _isConnected = () => false;
let _telegramBot = null;

function initSender(sock, isConnectedFn, telegramBot) {
    _sock = sock;
    _isConnected = isConnectedFn;
    _telegramBot = telegramBot;
}

function updateSenderSocket(sock) {
    _sock = sock;
}

// === CACHE DE MENSAGENS PARA REENVIO (RETRY) ===
const sentMessageStore = new Map();

function saveMessageToStore(sentMsg) {
    if (!sentMsg || !sentMsg.key || !sentMsg.key.id || !sentMsg.message) return;
    // Salvar o WebMessageInfo completo
    sentMessageStore.set(sentMsg.key.id, sentMsg);
    
    // Manter no máximo as últimas 2000 mensagens na memória
    if (sentMessageStore.size > 2000) {
        const firstKey = sentMessageStore.keys().next().value;
        sentMessageStore.delete(firstKey);
    }
}

function getMessageFromStore(key) {
    return sentMessageStore.get(key.id);
}

// === DOWNLOAD DE MÍDIA ===

async function getMediaFromUrl(url) {
    try {
        log('📥 Baixando mídia de:', url);

        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 30000,
            maxContentLength: 50 * 1024 * 1024
        });

        const mime = response.headers['content-type'];
        const buffer = Buffer.from(response.data);

        log('✅ Mídia baixada:', {
            mime,
            size: `${(buffer.length / 1024 / 1024).toFixed(2)}MB`
        });

        return { buffer, mimetype: mime };
    } catch (error) {
        log('❌ Erro ao baixar mídia:', error.message);
        return null;
    }
}

// === ENVIO EM LOTES ===

async function sendInBatches(items, sendFunction, config, platform) {
    const results = {
        success: 0,
        failed: 0,
        errors: [],
        connectionDead: false
    };

    const totalItems = items.length;
    const profile = getSpeedConfig();

    let dynamicDelay = config.batchDelay || profile.whatsapp.batchDelay;
    let typingBase = profile.whatsapp.typingDelay[0];
    let typingJitter = profile.whatsapp.typingDelay[1];

    if (platform === 'WhatsApp') {
        if (getSpeedMode() === 'rapido' && totalItems > 1) {
            const targetTotalMs = 40000;
            dynamicDelay = Math.max(500, Math.floor(targetTotalMs / totalItems) - typingBase);
        } else if (getSpeedMode() === 'meiotermo' && totalItems > 1) {
            const targetTotalMs = 60000;
            dynamicDelay = Math.max(500, Math.floor(targetTotalMs / totalItems) - typingBase);
        } else {
            dynamicDelay = profile.whatsapp.batchDelay;
        }

        log(`⏱️ WhatsApp [${getSpeedMode()}]: delay=${dynamicDelay}ms, digitação=${typingBase}-${typingBase + typingJitter}ms (${totalItems} grupos)`);
    }

    for (let i = 0; i < totalItems; i += config.batchSize || 1) {
        // Verificar saúde do socket antes de cada lote (WhatsApp)
        if (platform === 'WhatsApp' && _sock && !isSocketAlive(_sock)) {
            log('⚠️ Socket WebSocket morto detectado! Abortando envios WhatsApp restantes.');

            const remaining = totalItems - i;

            results.failed += remaining;
            results.connectionDead = true;

            break;
        }

        const batch = items.slice(i, i + (config.batchSize || 1));
        const batchNum = Math.floor(i / (config.batchSize || 1)) + 1;
        const totalBatches = Math.ceil(totalItems / (config.batchSize || 1));

        log(`📦 ${platform} Lote ${batchNum}/${totalBatches} (${batch.length} itens)`);

        const promises = batch.map(async (itemId) => {
            let lastError = null;
            const retries = config.maxRetries || profile.whatsapp.maxRetries;

            for (let attempt = 1; attempt <= retries; attempt++) {
                try {
                    if (platform === 'WhatsApp' && _sock) {
                        try {
                            await _sock.sendPresenceUpdate('composing', itemId);
                            await delay(typingBase + Math.random() * typingJitter);
                            await _sock.sendPresenceUpdate('paused', itemId);
                        } catch (e) {
                            // Ignora erro de presença
                        }
                    }

                    await sendFunction(itemId);

                    results.success++;

                    if (platform === 'WhatsApp') {
                        trackGroupSuccess(itemId);
                    }

                    log(`✅ ${platform} [${results.success + results.failed}/${totalItems}]:`, itemId);

                    return;
                } catch (error) {
                    lastError = error;

                    // Se for erro de conexão, não fazer retry — abortar este item
                    if (isConnectionError(error?.message)) {
                        log(`⚠️ ${platform} Erro de conexão para ${itemId}: ${error.message}`);
                        break;
                    }

                    if (attempt < retries) {
                        log(`⚠️ ${platform} Retry ${attempt}/${retries} para:`, itemId);
                        await delay(2000 * attempt);
                    }
                }
            }

            results.failed++;
            results.errors.push({
                id: itemId,
                error: lastError?.message || 'Erro desconhecido'
            });

            log(`❌ ${platform} Falha após ${retries} tentativas:`, itemId, lastError?.message);

            if (platform === 'WhatsApp') {
                trackGroupFailure(itemId, lastError?.message);
            }
        });

        await Promise.all(promises);

        if (i + (config.batchSize || 1) < totalItems) {
            await delayWithJitter(dynamicDelay);
        }
    }

    return results;
}

// === SINCRONIZAR GRUPOS ===

async function syncGroups() {
    if (!_sock || !_isConnected()) {
        throw new Error('WhatsApp não está conectado');
    }

    log('🔄 Iniciando sincronização de grupos...');

    try {
        const groups = await _sock.groupFetchAllParticipating();
        const groupIds = Object.keys(groups);

        log(`📊 Encontrados ${groupIds.length} grupos no WhatsApp`);

        const oldGroups = readJson(WHATSAPP_GROUPS_DB);

        const added = groupIds.filter(groupId => !oldGroups.includes(groupId));
        const removed = oldGroups.filter(groupId => !groupIds.includes(groupId));

        // IMPORTANTE:
        // Substitui o groups.json pela lista REAL de grupos onde o bot está participando agora.
        // Isso remove grupos antigos/inválidos e evita "forbidden" repetido.
        writeJson(WHATSAPP_GROUPS_DB, groupIds);

        for (const groupId of added) {
            log(`➕ Grupo adicionado: ${groupId} (${groups[groupId]?.subject || 'Sem nome'})`);
        }

        for (const groupId of removed) {
            log(`🗑️ Grupo removido no sync: ${groupId}`);
        }

        const result = {
            found: groupIds.length,
            added: added.length,
            removed: removed.length,
            total: groupIds.length
        };

        log(`✅ Sincronização concluída: ${result.found} encontrados, ${result.added} novos, ${result.removed} removidos, ${result.total} total`);

        return result;
    } catch (error) {
        log('❌ Erro na sincronização de grupos:', error.message);
        throw error;
    }
}

// === ENVIO PARA TWITTER ===

async function sendToTwitter(message, media) {
    if (!process.env.TWITTER_USERNAME) {
        return {
            success: false,
            error: 'Usuário não configurado'
        };
    }

    return new Promise((resolve) => {
        let cmd = 'node twitter_browser.js';
        let tempFile = null;

        if (message) {
            const safeMessage = message.replace(/"/g, '\\"');
            cmd += ` --text "${safeMessage}"`;
        }

        if (media && media.buffer) {
            try {
                const tempDir = path.join(BASE_DIR, 'temp');

                if (!fs.existsSync(tempDir)) {
                    fs.mkdirSync(tempDir);
                }

                const ext = media.mimetype ? media.mimetype.split('/')[1] : 'jpg';
                const filename = `upload_${Date.now()}.${ext}`;

                tempFile = path.join(tempDir, filename);

                fs.writeFileSync(tempFile, media.buffer);

                cmd += ` --media "${tempFile}"`;
            } catch (err) {
                log('❌ Erro ao salvar mídia temporária:', err.message);

                return resolve({
                    success: false,
                    error: 'Erro ao processar arquivo de mídia'
                });
            }
        }

        if (!message && !tempFile) {
            return resolve({
                success: false,
                error: 'Nada para enviar'
            });
        }

        log('🐦 Executando automação Puppeteer...');

        exec(cmd, { cwd: BASE_DIR }, (error, stdout, stderr) => {
            if (tempFile && fs.existsSync(tempFile)) {
                try {
                    fs.unlinkSync(tempFile);
                } catch (e) {
                    // Ignora erro ao apagar temporário
                }
            }

            if (error) {
                log(`❌ Erro no script Puppeteer: ${error.message}`);

                return resolve({
                    success: false,
                    error: error.message
                });
            }

            try {
                const jsonMatch = stdout.match(/\{.*\}/);
                const jsonStr = jsonMatch ? jsonMatch[0] : stdout;
                const result = JSON.parse(jsonStr);

                if (result.success) {
                    log('✅ Twitter: Postado com sucesso via Puppeteer!');

                    resolve({
                        success: true,
                        id: 'puppeteer-action'
                    });
                } else {
                    log(`❌ Twitter: Puppeteer retornou erro: ${result.error}`);

                    resolve({
                        success: false,
                        error: result.error
                    });
                }
            } catch (parseError) {
                log(`❌ Twitter: Erro ao ler resposta do Puppeteer: ${stdout}`);

                resolve({
                    success: false,
                    error: 'Resposta inválida do script de automação'
                });
            }
        });
    });
}

// === FUNÇÃO DE ENVIO PRINCIPAL ===

async function sendToAll(message, imageUrl = null, directMedia = null, useTwitter = false) {
    const rateCheck = checkRateLimit();

    // Mantido propositalmente:
    // Mesmo com rate limit excedido, o envio continua.
    registerBroadcast();

    const wppGroups = readJson(WHATSAPP_GROUPS_DB);
    const tgChats = readJson(TELEGRAM_CHATS_DB);

    let media = directMedia;

    const startTime = Date.now();

    if (!_isConnected()) {
        log('⚠️ WhatsApp não está conectado - Pulando envios do WhatsApp');
    }

    // Carregar mídia: do URL, do cache em disco, ou buffer direto
    if (!media && imageUrl) {
        media = await getMediaFromUrl(imageUrl);
    } else if (media && media.mediaPath && !media.buffer) {
        try {
            const buf = fs.readFileSync(media.mediaPath);

            media = {
                buffer: buf,
                mimetype: media.mimetype,
                mediaPath: media.mediaPath
            };

            log('📂 Mídia carregada do cache:', media.mediaPath, `(${(buf.length / 1024 / 1024).toFixed(2)}MB)`);
        } catch (e) {
            log('❌ Erro ao ler mídia do cache:', e.message);
            media = null;
        }
    }

    log('📤 Iniciando envio:', {
        hasMedia: !!media,
        hasUrl: !!imageUrl,
        wppGroups: wppGroups.length,
        tgChats: tgChats.length,
        whatsappReady: _isConnected(),
        twitter: useTwitter,
        rateLimitExceeded: rateCheck.exceeded,
        mode: getSpeedMode()
    });

    let wppResults = {
        success: 0,
        failed: 0,
        errors: []
    };

    let tgResults = {
        success: 0,
        failed: 0,
        errors: []
    };

    let twitterResult = {
        success: false,
        error: null
    };

    // Twitter em paralelo
    const twitterPromise = (async () => {
        if (useTwitter && process.env.TWITTER_USERNAME) {
            log('🐦 Iniciando envio para Twitter...');
            return await sendToTwitter(message, media);
        }

        return {
            success: false,
            skipped: true
        };
    })();

    // WhatsApp
    if (_isConnected() && _sock && wppGroups.length > 0) {
        if (!isSocketAlive(_sock)) {
            log('⚠️ Socket WebSocket não está vivo! Pulando envios WhatsApp.');

            wppResults = {
                success: 0,
                failed: wppGroups.length,
                errors: [
                    {
                        id: 'all',
                        error: 'Socket morto'
                    }
                ],
                connectionDead: true
            };
        } else {
            const profile = getSpeedConfig();
            const shuffledGroups = shuffleArray(wppGroups);

            log(`📱 Enviando para ${shuffledGroups.length} grupos [modo: ${getSpeedMode()} - ${profile.description}]`);

            wppResults = await sendInBatches(
                shuffledGroups,
                async (groupId) => {
                    let sentMsg;
                    if (media && media.buffer) {
                        const isVideo = media.mimetype?.includes('video');
                        const isDocument = !media.mimetype?.includes('image') && !isVideo;

                        if (isVideo) {
                            sentMsg = await _sock.sendMessage(groupId, {
                                video: media.buffer,
                                caption: message || ''
                            });
                        } else if (isDocument) {
                            sentMsg = await _sock.sendMessage(groupId, {
                                document: media.buffer,
                                caption: message || '',
                                mimetype: media.mimetype
                            });
                        } else {
                            sentMsg = await _sock.sendMessage(groupId, {
                                image: media.buffer,
                                caption: message || ''
                            });
                        }
                    } else {
                        sentMsg = await _sock.sendMessage(groupId, {
                            text: message || '📣 Nova mensagem!'
                        });
                    }
                    
                    // Salvar no cache para eventual retry receipt
                    saveMessageToStore(sentMsg);
                },
                profile.whatsapp,
                'WhatsApp'
            );
        }
    }

    // Telegram
    if (_telegramBot && tgChats.length > 0) {
        log(`📨 Iniciando envio Telegram para ${tgChats.length} chats...`);

        tgResults = await sendInBatches(
            tgChats,
            async (chatId) => {
                if (media && media.buffer) {
                    const isVideo = media.mimetype?.includes('video');

                    if (isVideo) {
                        await _telegramBot.sendVideo(chatId, media.buffer, {
                            caption: message || ''
                        });
                    } else {
                        await _telegramBot.sendPhoto(chatId, media.buffer, {
                            caption: message || ''
                        });
                    }
                } else if (imageUrl) {
                    await _telegramBot.sendPhoto(chatId, imageUrl, {
                        caption: message || ''
                    });
                } else {
                    await _telegramBot.sendMessage(chatId, message || '📣 Nova mensagem!');
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
        whatsapp: {
            sucessos: wppResults.success,
            falhas: wppResults.failed,
            erros: wppResults.errors
        },
        telegram: {
            sucessos: tgResults.success,
            falhas: tgResults.failed,
            erros: tgResults.errors
        },
        twitter: twitterResult,
        tempoTotal: elapsed + 's',
        resumo,
        rateLimitExceeded: rateCheck.exceeded
    };
}

module.exports = {
    initSender,
    updateSenderSocket,
    getMediaFromUrl,
    sendInBatches,
    syncGroups,
    sendToTwitter,
    sendToAll,
    getMessageFromStore
};