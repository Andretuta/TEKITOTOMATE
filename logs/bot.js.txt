require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const axios = require('axios');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const TelegramBot = require('node-telegram-bot-api');

// === CONFIGURAÇÕES E CAMINHOS ===
const LOG_FILE = path.join(__dirname, 'logs', 'bot.log');
const WHATSAPP_GROUPS_DB = path.join(__dirname, 'groups.json');
const TELEGRAM_CHATS_DB = path.join(__dirname, 'telegram_chats.json');
const ADMINS_FILE = path.join(__dirname, 'bot_admins.json');
const SESSION_PATH = './session_data';

// Criar diretório de logs se não existir
if (!fs.existsSync(path.dirname(LOG_FILE))) {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
}

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

// Função para limpar sessão corrompida
function clearSession() {
    if (fs.existsSync(SESSION_PATH)) {
        try {
            fs.rmSync(SESSION_PATH, { recursive: true, force: true });
            log('🗑️ Sessão anterior removida com sucesso');
        } catch (error) {
            log('❌ Erro ao remover sessão:', error.message);
        }
    }
}

// Limpar sessão se necessário
if (process.argv.includes('--clear-session')) {
    clearSession();
}

// === CONFIGURAÇÃO DO WHATSAPP ===
const wpp = new Client({
    authStrategy: new LocalAuth({
        dataPath: SESSION_PATH
    }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor'
        ],
        executablePath: undefined,
    },
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    }
});

// === EVENTOS WHATSAPP COM LOGS DETALHADOS ===
wpp.on('loading_screen', (percent, message) => {
    log(`⏳ Carregando WhatsApp: ${percent}% - ${message}`);
});

wpp.on('qr', qr => {
    console.log('\n' + '='.repeat(50));
    console.log('📱 QR CODE GERADO - ESCANEIE COM SEU WHATSAPP');
    console.log('='.repeat(50));
    qrcode.generate(qr, { small: true });
    console.log('='.repeat(50) + '\n');
    log('🔲 QR Code gerado - Aguardando leitura pelo WhatsApp');
});

wpp.on('authenticated', () => {
    log('✅ WhatsApp autenticado com sucesso!');
});

wpp.on('auth_failure', msg => {
    log('❌ FALHA DE AUTENTICAÇÃO WhatsApp:', msg);
    console.log('❌ FALHA DE AUTENTICAÇÃO - Sessão pode estar corrompida');
    console.log('💡 Tente executar: node bot.js --clear-session');
});

wpp.on('ready', () => {
    log('🎉 WhatsApp conectado e pronto para uso!');
    console.log('🎉 WhatsApp conectado e pronto para uso!');
    console.log(`📱 Conectado como: ${wpp.info?.pushname || 'N/A'}`);
    console.log(`📞 Número: ${wpp.info?.wid?.user || 'N/A'}`);
    console.log(`🤖 Bot operacional às ${new Date().toLocaleTimeString()}`);
});

wpp.on('disconnected', reason => {
    log('❌ WhatsApp desconectado:', reason);
    console.log('❌ WhatsApp desconectado:', reason);
    console.log('🔄 Tentando reconectar em 10 segundos...');
    setTimeout(() => {
        initializeWhatsApp();
    }, 10000);
});

// Auto cadastro de grupos
wpp.on('group_join', notif => {
    const groups = readJson(WHATSAPP_GROUPS_DB);
    if (!groups.includes(notif.chatId)) {
        groups.push(notif.chatId);
        writeJson(WHATSAPP_GROUPS_DB, groups);
        log('🟢 Entrou em novo grupo WhatsApp:', notif.chatId);
    }
});

wpp.on('group_leave', notif => {
    const updated = readJson(WHATSAPP_GROUPS_DB).filter(id => id !== notif.chatId);
    writeJson(WHATSAPP_GROUPS_DB, updated);
    log('🔴 Saiu do grupo WhatsApp:', notif.chatId);
});

// === CONFIGURAÇÃO DO TELEGRAM ===
let telegramBot = null;
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
            maxContentLength: 50 * 1024 * 1024, // 50MB max
        });
        
        const mime = response.headers['content-type'];
        const base64 = Buffer.from(response.data, 'binary').toString('base64');
        
        log('✅ Mídia baixada:', { mime, size: `${(base64.length * 0.75 / 1024 / 1024).toFixed(2)}MB` });
        return new MessageMedia(mime, base64, 'media');
        
    } catch (error) {
        log('❌ Erro ao baixar mídia:', error.message);
        return null;
    }
}

// === FUNÇÃO DE ENVIO MELHORADA ===
async function sendToAll(message, imageUrl = null, directMedia = null) {
    const wppGroups = readJson(WHATSAPP_GROUPS_DB);
    const tgChats = readJson(TELEGRAM_CHATS_DB);
    let media = directMedia;
    
    // Verificar se WhatsApp está pronto
    if (!wpp.info) {
        log('⚠️ WhatsApp não está conectado - Pulando envios do WhatsApp');
    }

    // Baixar mídia se necessário
    if (!media && imageUrl) {
        media = await getMediaFromUrl(imageUrl);
    }

    log('📤 Iniciando envio:', { 
        hasMedia: !!media, 
        hasUrl: !!imageUrl, 
        wppGroups: wppGroups.length, 
        tgChats: tgChats.length,
        whatsappReady: !!wpp.info
    });

    let sucessosWpp = 0;
    let falhasWpp = 0;
    let sucessosTg = 0;
    let falhasTg = 0;

    // Envios WhatsApp
    if (wpp.info) {
        for (let i = 0; i < wppGroups.length; i++) {
            const id = wppGroups[i];
            try {
                if (media) {
                    await wpp.sendMessage(id, media, { caption: message || '' });
                } else {
                    await wpp.sendMessage(id, message || '📣 Nova mensagem!');
                }
                
                sucessosWpp++;
                log(`✅ WhatsApp [${i+1}/${wppGroups.length}]:`, id);
                
                // Delay entre envios para evitar spam
                if (i < wppGroups.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1500));
                }
                
            } catch (error) {
                falhasWpp++;
                log(`❌ Falha WhatsApp [${i+1}/${wppGroups.length}]:`, id, error.message);
            }
        }
    }

    // Envios Telegram
    if (telegramBot) {
        for (let i = 0; i < tgChats.length; i++) {
            const id = tgChats[i];
            try {
                if (media && imageUrl) {
                    await telegramBot.sendPhoto(id, imageUrl, { caption: message || '' });
                } else if (media && media.data) {
                    const buffer = Buffer.from(media.data, 'base64');
                    await telegramBot.sendPhoto(id, buffer, { caption: message || '' });
                } else {
                    await telegramBot.sendMessage(id, message || '📣 Nova mensagem!');
                }
                
                sucessosTg++;
                log(`✅ Telegram [${i+1}/${tgChats.length}]:`, id);
                
                // Delay entre envios
                if (i < tgChats.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
                
            } catch (error) {
                falhasTg++;
                log(`❌ Falha Telegram [${i+1}/${tgChats.length}]:`, id, error.message);
            }
        }
    }

    const resumo = `📊 Envio concluído: WPP(${sucessosWpp}✅/${falhasWpp}❌) TG(${sucessosTg}✅/${falhasTg}❌)`;
    log(resumo);
    
    return {
        whatsapp: { sucessos: sucessosWpp, falhas: falhasWpp },
        telegram: { sucessos: sucessosTg, falhas: falhasTg },
        resumo
    };
}

// === COMANDOS WHATSAPP MELHORADOS ===
wpp.on('message', async (msg) => {
    // Apenas mensagens privadas de admins
    if (!msg.from.endsWith('@c.us')) return;
    
    const senderNumber = msg.from.replace('@c.us', '');
    const admins = getAdmins();
    
    if (!admins.includes(senderNumber)) {
        log('⛔ Comando não autorizado de:', senderNumber);
        return;
    }

    const comando = msg.body.trim().toLowerCase();
    
    try {
        // === COMANDO STATUS ===
        if (comando === 'status') {
            const wppGroups = readJson(WHATSAPP_GROUPS_DB);
            const tgChats = readJson(TELEGRAM_CHATS_DB);
            const isWppReady = wpp.info ? '✅ Conectado' : '❌ Desconectado';
            const isTgReady = telegramBot ? '✅ Ativo' : '❌ Inativo';
            
            const statusMsg = 
                `📊 *STATUS DO BOT*\n\n` +
                `🔸 WhatsApp: ${isWppReady}\n` +
                `🔸 Grupos WPP: ${wppGroups.length}\n` +
                `🔸 Telegram: ${isTgReady}\n` +
                `🔸 Chats TG: ${tgChats.length}\n` +
                `🔸 Uptime: ${Math.floor(process.uptime() / 60)}min\n` +
                `🔸 Memória: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`;
            
            await msg.reply(statusMsg);
            return;
        }

        // === COMANDO TESTE ===
        if (comando === 'test' || comando === 'teste') {
            const inicio = Date.now();
            await msg.reply('🤖 Bot funcionando perfeitamente!\n⏱️ Teste de resposta realizado.');
            const tempo = Date.now() - inicio;
            log(`✅ Teste realizado em ${tempo}ms para`, senderNumber);
            return;
        }

        // === COMANDO RESET ===
        if (comando === 'reset') {
            try {
                await msg.reply('🔄 Resetando sessão do WhatsApp...');
                await wpp.logout();
                log('🔄 Sessão resetada por', senderNumber);
            } catch (error) {
                await msg.reply('❌ Erro ao resetar sessão: ' + error.message);
            }
            return;
        }

        // === COMANDO HELP ===
        if (comando === 'help' || comando === 'ajuda') {
            const helpMsg = 
                `🤖 *COMANDOS DISPONÍVEIS:*\n\n` +
                `• *status* - Ver status do bot\n` +
                `• *test* - Testar funcionamento\n` +
                `• *reset* - Resetar sessão\n` +
                `• *help* - Esta ajuda\n\n` +
                `📝 *Para enviar mensagens:*\n` +
                `• Digite a mensagem normalmente\n` +
                `• Envie uma imagem com legenda\n` +
                `• Envie apenas uma URL de imagem`;
            
            await msg.reply(helpMsg);
            return;
        }

        // === PROCESSAMENTO DE MENSAGENS E MÍDIAS ===
        let content = msg.body;
        let media = null;
        let imageUrl = null;

        // Verificar se há grupos cadastrados
        const wppGroups = readJson(WHATSAPP_GROUPS_DB);
        const tgChats = readJson(TELEGRAM_CHATS_DB);
        
        if (wppGroups.length === 0 && tgChats.length === 0) {
            await msg.reply('❌ Nenhum grupo ou canal registrado ainda.');
            return;
        }

        // Processar mídia enviada diretamente
        if (msg.hasMedia) {
            log('📥 Processando mídia enviada...');
            await msg.reply('📥 Baixando mídia, aguarde...');
            
            media = await msg.downloadMedia();
            if (media) {
                log('✅ Mídia processada:', { 
                    tipo: media.mimetype, 
                    tamanho: `${(media.data.length * 0.75 / 1024 / 1024).toFixed(2)}MB` 
                });
            }
        } 
        // Verificar se é URL de mídia
        else if (/https?:\/\/.+\.(jpg|jpeg|png|gif|webp|mp4|mov|avi)/i.test(content)) {
            imageUrl = content.trim();
            content = ''; // Limpar texto pois é apenas URL
            log('🔗 URL de mídia detectada:', imageUrl);
        }

        // Enviar para todos os grupos
        if (content || media || imageUrl) {
            await msg.reply('📤 Enviando para todos os grupos...');
            
            const resultado = await sendToAll(
                content || '📣 Nova mensagem do admin!', 
                imageUrl, 
                media
            );
            
            await msg.reply(`✅ ${resultado.resumo}`);
            log('📤 Envio solicitado por admin:', senderNumber);
        } else {
            await msg.reply('❌ Envie uma mensagem, imagem ou URL válida.');
        }

    } catch (error) {
        log('❌ Erro ao processar comando:', error.message);
        await msg.reply(`❌ Erro: ${error.message}`);
    }
});

// === API EXPRESS MELHORADA ===
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
            connected: !!wpp.info,
            groups: wppGroups.length,
            info: wpp.info || null
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
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    log(`🚀 API rodando na porta ${PORT}`);
    console.log(`🌐 Endpoints disponíveis:`);
    console.log(`   POST http://localhost:${PORT}/send-to-all`);
    console.log(`   GET  http://localhost:${PORT}/status`);
    console.log(`   GET  http://localhost:${PORT}/health`);
});

// === INICIALIZAÇÃO ROBUSTA DO WHATSAPP ===
let initAttempts = 0;
const maxAttempts = 3;

async function initializeWhatsApp() {
    try {
        initAttempts++;
        log(`🚀 Tentativa ${initAttempts}/${maxAttempts} de conectar WhatsApp...`);
        console.log(`🚀 Tentativa ${initAttempts}/${maxAttempts} de conectar WhatsApp...`);
        
        await wpp.initialize();
        
        // Timeout para verificar conexão
        setTimeout(() => {
            if (!wpp.info && initAttempts <= maxAttempts) {
                log('⏰ Timeout de conexão WhatsApp - Tentando novamente...');
                console.log('⏰ WhatsApp não conectou em 90 segundos');
                
                if (initAttempts < maxAttempts) {
                    setTimeout(() => initializeWhatsApp(), 5000);
                } else {
                    console.log('❌ Máximo de tentativas atingido');
                    console.log('💡 Tente: node bot.js --clear-session');
                }
            }
        }, 90000);
        
    } catch (error) {
        log('❌ Erro na inicialização do WhatsApp:', error.message);
        
        if (initAttempts < maxAttempts) {
            log('🔄 Tentando novamente em 10 segundos...');
            setTimeout(() => initializeWhatsApp(), 10000);
        } else {
            log('❌ Falha total na inicialização do WhatsApp');
        }
    }
}

// === TRATAMENTO DE SINAIS E LIMPEZA ===
process.on('SIGINT', async () => {
    log('🛑 Encerrando bot...');
    console.log('\n🛑 Encerrando bot graciosamente...');
    
    try {
        if (wpp.info) {
            await wpp.destroy();
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

process.on('unhandledRejection', (reason, promise) => {
    log('❌ Promise rejeitada:', reason);
    console.error('❌ Promise rejeitada:', reason);
});

// === INICIALIZAR BOT ===
console.log('🤖 Iniciando Bot de Broadcast...');
console.log('📝 Logs salvos em:', LOG_FILE);
console.log('⚙️ Para limpar sessão: node bot.js --clear-session');
console.log('-'.repeat(60));

log('🤖 Bot iniciado');
initializeWhatsApp();
