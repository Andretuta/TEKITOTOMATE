const { exec } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const { log, readJson, DEAD_GROUPS } = require('./utils');
const { WHATSAPP_GROUPS_DB, TELEGRAM_CHATS_DB, BASE_DIR, SESSION_PATH, MEDIA_CACHE_DIR, RATE_LIMIT, checkRateLimit, getSpeedConfig, getSpeedMode, setSpeedMode } = require('./config');
const { getQueueStatus } = require('./queue');
const { syncGroups } = require('./sender');
const fs = require('fs');

async function processCommand(sock, msg, senderNumber, isConnected, telegramBot) {
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
            setSpeedMode('rapido');
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
            setSpeedMode('lento');
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

        // === COMANDO MEIO TERMO ===
        if (comando === 'meio' || comando === 'meiotermo') {
            setSpeedMode('meiotermo');
            const profile = getSpeedConfig();
            await sock.sendMessage(chatId, {
                text: `⚖️ *MODO ALTERADO: ${profile.label}*\n\n` +
                    `🚨 MEIO TERMO POREM PODE SER PERIGOSO CAOLHO FUDIDO 🚨\n\n` +
                    `⏱️ Tempo total: ${profile.description}\n` +
                    `📊 Delay base: ${profile.whatsapp.batchDelay / 1000}s (ajustado dinamicamente)\n` +
                    `⌨️ Digitação: ${profile.whatsapp.typingDelay[0] / 1000}-${(profile.whatsapp.typingDelay[0] + profile.whatsapp.typingDelay[1]) / 1000}s\n` +
                    `📋 Pausa entre filas: ${profile.queueDelay / 1000}s`
            });
            log(`⚖️ Modo de velocidade alterado para MEIO TERMO por ${senderNumber}`);
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
                `• *meio* - Modo médio (~1min) ⚖️\n` +
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

            exec('git fetch origin && git status -uno', { cwd: BASE_DIR }, async (error, stdout) => {
                if (error) {
                    await sock.sendMessage(chatId, { text: `❌ Erro ao verificar: ${error.message}` });
                    return;
                }

                if (stdout.includes('behind')) {
                    await sock.sendMessage(chatId, {
                        text: `📦 *ATUALIZAÇÃO DISPONÍVEL!*\n\nPara atualizar, execute no servidor:\n\`\`\`\ncd ${BASE_DIR}\ngit pull origin main\nnpm install\nnode bot.js\n\`\`\`\n\nOu execute: *update.bat*`
                    });
                } else {
                    await sock.sendMessage(chatId, { text: '✅ Bot já está na versão mais recente!' });
                }
            });

            log('🔍 Verificação de atualização solicitada por:', senderNumber);
            return true;
        }

        // === COMANDO X (TWITTER + BROADCAST) ===
        if (comando.startsWith('/x')) {
            const { downloadMediaMessage } = require('./baileys-loader').getBaileys();
            const { addToQueue, isQueueProcessing } = require('./queue');

            let textToPost = messageText.slice(2).trim();

            log(`🐦 Comando /x detectado: "${textToPost}"`);
            await sock.sendMessage(chatId, { text: '🐦 Processando post para o Twitter...' });

            let mediaBuffer = null;
            let mimeType = null;

            if (msg.message?.imageMessage) {
                try {
                    mediaBuffer = await downloadMediaMessage(msg, 'buffer', {});
                    mimeType = msg.message.imageMessage.mimetype || 'image/jpeg';
                } catch (e) {
                    log('❌ Erro ao baixar imagem direta:', e.message);
                }
            } else {
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

            // Salvar mídia no cache em disco (mesmo padrão do fluxo normal)
            let mediaObj = null;
            let mediaPath = null;
            let mimetype = null;
            if (mediaBuffer) {
                const ext = mimeType ? mimeType.split('/')[1] : 'jpg';
                const fileName = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
                mediaPath = path.join(MEDIA_CACHE_DIR, fileName);
                mimetype = mimeType;
                try {
                    fs.writeFileSync(mediaPath, mediaBuffer);
                    log(`✅ Mídia /x salva em cache: ${mediaPath}`);
                } catch (e) {
                    log(`⚠️ Falha ao salvar cache /x, usando buffer direto: ${e.message}`);
                    mediaObj = { buffer: mediaBuffer, mimetype: mimeType };
                }
            }

            // Usar a fila para enviar (evita envios paralelos e rate limit explosivo)
            const altJid = msg.key.remoteJidAlt || '';
            const queueInfo = addToQueue({
                content: textToPost || '',
                imageUrl: null,
                media: mediaObj,
                mediaPath: mediaPath,
                mimetype: mimetype,
                chatId,
                senderNumber,
                altJid,
                useTwitter: true
            });

            if (queueInfo.position === 1 && !isQueueProcessing()) {
                await sock.sendMessage(chatId, { text: '📤 Enviando broadcast global (WPP + Telegram + X)...' });
            } else {
                await sock.sendMessage(chatId, {
                    text: `📋 Adicionado à fila! Posição: #${queueInfo.position}\n⏳ Há ${queueInfo.position - 1} envio(s) antes deste.\nInclui post no Twitter/X. 🐦`
                });
            }

            return true;
        }

        return false;
    } catch (error) {
        log('❌ Erro ao processar comando:', error.message);
        await sock.sendMessage(chatId, { text: `❌ Erro: ${error.message}` });
        return true;
    }
}

module.exports = { processCommand };
