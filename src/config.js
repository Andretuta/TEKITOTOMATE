const path = require('path');
const fs = require('fs');

// === CAMINHOS ===
const LOG_FILE = path.join(__dirname, '..', 'logs', 'bot.log');
const WHATSAPP_GROUPS_DB = path.join(__dirname, '..', 'groups.json');
const TELEGRAM_CHATS_DB = path.join(__dirname, '..', 'telegram_chats.json');
const ADMINS_FILE = path.join(__dirname, '..', 'bot_admins.json');
const SESSION_PATH = path.join(__dirname, '..', 'session_baileys');
const BASE_DIR = path.join(__dirname, '..');
const MEDIA_CACHE_DIR = path.join(BASE_DIR, 'media_cache');

// Criar pasta de cache de mídia se não existir
if (!fs.existsSync(MEDIA_CACHE_DIR)) {
    fs.mkdirSync(MEDIA_CACHE_DIR, { recursive: true });
}

// === MODO DE VELOCIDADE (LENTO / RAPIDO) ===
let speedMode = 'rapido';

const SPEED_PROFILES = {
    rapido: {
        label: '🚀 RÁPIDO',
        description: '~40 segundos total',
        whatsapp: {
            batchSize: 1,
            batchDelay: 2000,
            typingDelay: [500, 500],
            maxRetries: 1
        },
        queueDelay: 5000
    },
    lento: {
        label: '🐢 LENTO (SEGURO)',
        description: '~2 minutos total',
        whatsapp: {
            batchSize: 1,
            batchDelay: 8000,
            typingDelay: [1500, 2000],
            maxRetries: 1
        },
        queueDelay: 15000
    },
    meiotermo: {
        label: '⚖️ MEIO TERMO',
        description: '~1 minuto total',
        whatsapp: {
            batchSize: 1,
            batchDelay: 4000,
            typingDelay: [1000, 1000],
            maxRetries: 1
        },
        queueDelay: 10000
    }
};

function getSpeedConfig() {
    return SPEED_PROFILES[speedMode] || SPEED_PROFILES.rapido;
}

function setSpeedMode(mode) {
    if (SPEED_PROFILES[mode]) {
        speedMode = mode;
        return true;
    }
    return false;
}

function getSpeedMode() {
    return speedMode;
}

// === CONFIGURAÇÕES TELEGRAM ===
const PARALLEL_CONFIG = {
    telegram: {
        batchSize: 5,
        batchDelay: 1500,
        maxRetries: 2
    }
};

// === CONTROLE DE TAXA DE BROADCAST ===
const RATE_LIMIT = {
    maxBroadcastsPerHour: 8,
    broadcastHistory: [],
    cooldownMs: 120000
};

function checkRateLimit() {
    const now = Date.now();
    const oneHourAgo = now - 3600000;

    RATE_LIMIT.broadcastHistory = RATE_LIMIT.broadcastHistory.filter(t => t > oneHourAgo);

    if (RATE_LIMIT.broadcastHistory.length >= RATE_LIMIT.maxBroadcastsPerHour) {
        return { exceeded: true, reason: 'hora', count: RATE_LIMIT.broadcastHistory.length };
    }

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

// === RECONEXÃO ===
const MAX_RECONNECT_DELAY = 300000;
const MAX_RECONNECT_ATTEMPTS = 10;

module.exports = {
    LOG_FILE,
    WHATSAPP_GROUPS_DB,
    TELEGRAM_CHATS_DB,
    ADMINS_FILE,
    SESSION_PATH,
    BASE_DIR,
    MEDIA_CACHE_DIR,
    SPEED_PROFILES,
    PARALLEL_CONFIG,
    RATE_LIMIT,
    MAX_RECONNECT_DELAY,
    MAX_RECONNECT_ATTEMPTS,
    getSpeedConfig,
    setSpeedMode,
    getSpeedMode,
    checkRateLimit,
    registerBroadcast
};
