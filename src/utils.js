const fs = require('fs');
const path = require('path');
const { LOG_FILE, ADMINS_FILE, WHATSAPP_GROUPS_DB, TELEGRAM_CHATS_DB } = require('./config');

// === LOGGER ===
const log = (...msg) => {
    const line = `[${new Date().toISOString()}] ${msg.join(' ')}\n`;
    try {
        try {
            const stats = fs.statSync(LOG_FILE);
            if (stats.size > 5 * 1024 * 1024) {
                const backupFile = LOG_FILE.replace('.log', `.${Date.now()}.old.log`);
                fs.renameSync(LOG_FILE, backupFile);
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

const logToFileOnly = (...msg) => {
    const line = `[${new Date().toISOString()}] ${msg.join(' ')}\n`;
    try {
        fs.appendFileSync(LOG_FILE, line);
    } catch (error) {}
};

// === LEITURA/ESCRITA JSON ===
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

// === ADMINS ===
const getAdmins = () => {
    try {
        const data = JSON.parse(fs.readFileSync(ADMINS_FILE, 'utf8'));
        return Array.isArray(data.admins) ? data.admins.map(String) : [];
    } catch {
        log('⚠️ Arquivo de admins não encontrado ou inválido');
        return [];
    }
};

// === DELAY ===
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const delayWithJitter = (baseMs) => {
    const jitter = Math.floor(Math.random() * baseMs * 0.5);
    return delay(baseMs + jitter);
};

// === GRUPOS MORTOS ===
const DEAD_GROUPS = new Map();
const MAX_CONSECUTIVE_FAILURES = 5;

// Erros que indicam problema de CONEXÃO (não do grupo)
function isConnectionError(errorMsg) {
    if (!errorMsg) return false;
    const connectionErrors = [
        'connection closed',
        'timed out',
        'connection lost',
        'stream errored',
        'socket closed',
        'econnreset',
        'econnrefused',
        'epipe',
        'not connected',
        'bad mac',
        'failed to decrypt'
    ];
    const lower = errorMsg.toLowerCase();
    return connectionErrors.some(e => lower.includes(e));
}

function trackGroupFailure(groupId, errorMsg) {
    // Se for erro de conexão, NÃO contar como falha do grupo
    if (isConnectionError(errorMsg)) {
        log(`⚠️ Falha de CONEXÃO (não do grupo): ${groupId} - ${errorMsg}`);
        return false;
    }
    
    const count = (DEAD_GROUPS.get(groupId) || 0) + 1;
    DEAD_GROUPS.set(groupId, count);
    if (count >= MAX_CONSECUTIVE_FAILURES) {
        log(`🗑️ Grupo ${groupId} removido automaticamente após ${count} falhas consecutivas`);
        const groups = readJson(WHATSAPP_GROUPS_DB).filter(g => g !== groupId);
        writeJson(WHATSAPP_GROUPS_DB, groups);
        DEAD_GROUPS.delete(groupId);
        return true;
    }
    return false;
}

function trackGroupSuccess(groupId) {
    DEAD_GROUPS.delete(groupId);
}

// === SHUFFLE ===
function shuffleArray(arr) {
    const shuffled = [...arr];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

module.exports = {
    log,
    readJson,
    writeJson,
    getAdmins,
    delay,
    delayWithJitter,
    DEAD_GROUPS,
    isConnectionError,
    trackGroupFailure,
    trackGroupSuccess,
    shuffleArray,
    logToFileOnly
};
