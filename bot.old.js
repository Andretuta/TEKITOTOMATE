require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const axios = require('axios');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const TelegramBot = require('node-telegram-bot-api');

// === Caminhos ===
const LOG_FILE = path.join(__dirname, 'logs', 'bot.log');
const WHATSAPP_GROUPS_DB = path.join(__dirname, 'groups.json');
const TELEGRAM_CHATS_DB = path.join(__dirname, 'telegram_chats.json');
const ADMINS_FILE = path.join(__dirname, 'bot_admins.json');
if (!fs.existsSync(path.dirname(LOG_FILE))) fs.mkdirSync(path.dirname(LOG_FILE));

// === Utils ===
const readJson = (file) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
const writeJson = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));
const log = (...msg) => {
  const line = `[${new Date().toISOString()}] ${msg.join(' ')}\n`;
  fs.appendFileSync(LOG_FILE, line);
  console.log(...msg);
};
const getAdmins = () => {
  try {
    const data = JSON.parse(fs.readFileSync(ADMINS_FILE, 'utf8'));
    return Array.isArray(data.admins) ? data.admins : [];
  } catch { return []; }
};

// === WHATSAPP ===
const wpp = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});
wpp.on('qr', qr => qrcode.generate(qr, { small: true }));
wpp.on('ready', () => log('✅ WhatsApp pronto!'));
wpp.on('auth_failure', msg => log('❌ Auth WhatsApp:', msg));
wpp.on('disconnected', reason => log('❌ WhatsApp desconectado:', reason));

// Auto cadastro/remocao de grupos
wpp.on('group_join', notif => {
  const groups = readJson(WHATSAPP_GROUPS_DB);
  if (!groups.includes(notif.chatId)) {
    groups.push(notif.chatId);
    writeJson(WHATSAPP_GROUPS_DB, groups);
    log('🟢 Entrou em grupo WhatsApp:', notif.chatId);
  }
});
wpp.on('group_leave', notif => {
  const updated = readJson(WHATSAPP_GROUPS_DB).filter(id => id !== notif.chatId);
  writeJson(WHATSAPP_GROUPS_DB, updated);
  log('🔴 Saiu de grupo WhatsApp:', notif.chatId);
});

// === TELEGRAM ===
let telegramBot = null;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

if (TELEGRAM_TOKEN) {
  telegramBot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
  log('✅ Telegram bot iniciado');

  telegramBot.on('my_chat_member', (data) => {
    const chat = data.chat;
    const chats = readJson(TELEGRAM_CHATS_DB);

    if (['member', 'administrator'].includes(data.new_chat_member?.status)) {
      if (!chats.includes(chat.id)) {
        chats.push(chat.id);
        writeJson(TELEGRAM_CHATS_DB, chats);
        log('🟢 Adicionado a grupo/canal Telegram:', chat.id);
      }
    }

    if (['left', 'kicked'].includes(data.new_chat_member?.status)) {
      const filtered = chats.filter(id => id !== chat.id);
      writeJson(TELEGRAM_CHATS_DB, filtered);
      log('🔴 Removido de grupo/canal Telegram:', chat.id);
    }
  });

  telegramBot.on('message', (msg) => {
    const chats = readJson(TELEGRAM_CHATS_DB);
    if (!chats.includes(msg.chat.id)) {
      chats.push(msg.chat.id);
      writeJson(TELEGRAM_CHATS_DB, chats);
      telegramBot.sendMessage(msg.chat.id, '✅ Chat registrado com sucesso!');
    }
  });
} else {
  log('⚠️ TELEGRAM_TOKEN não configurado.');
}

// === MIDIA ===
async function getMediaFromUrl(url) {
  try {
    const res = await axios.get(url, { responseType: 'arraybuffer' });
    const mime = res.headers['content-type'];
    const base64 = Buffer.from(res.data, 'binary').toString('base64');
    return new MessageMedia(mime, base64, 'image');
  } catch (err) {
    log('❌ Erro ao baixar imagem:', err.message);
    return null;
  }
}

// === ENVIO ===
async function sendToAll(message, imageUrl = null) {
  const wppGroups = readJson(WHATSAPP_GROUPS_DB);
  const tgChats = readJson(TELEGRAM_CHATS_DB);
  let media = null;

  if (imageUrl) media = await getMediaFromUrl(imageUrl);

  for (const id of wppGroups) {
    try {
      await wpp.sendMessage(id, media || message, { caption: media ? message : undefined });
      log('✅ Enviado WhatsApp:', id);
    } catch (e) {
      log('❌ Falha WhatsApp:', id, e.message);
    }
  }

  if (telegramBot) {
    for (const id of tgChats) {
      try {
        if (imageUrl) {
          await telegramBot.sendPhoto(id, imageUrl, { caption: message });
        } else {
          await telegramBot.sendMessage(id, message);
        }
        log('✅ Enviado Telegram:', id);
      } catch (e) {
        log('❌ Falha Telegram:', id, e.message);
      }
    }
  }
}

// === WHATSAPP COMANDOS PRIVADOS (ADM) ===
wpp.on('message', async (msg) => {
  const sender = msg.from;
  if (!sender.endsWith('@c.us')) return;
  const senderNumber = sender.replace('@c.us', '');
  const admins = getAdmins();
  if (!admins.includes(senderNumber)) {
    log('⛔ Tentativa de comando não autorizada:', senderNumber);
    return; // silencioso
  }

  if (msg.body.trim().toLowerCase() === 'status') {
    const wppGroups = readJson(WHATSAPP_GROUPS_DB);
    const tgChats = readJson(TELEGRAM_CHATS_DB);
    await msg.reply(`📊 *Status do Bot:*\nWhatsApp: ${wppGroups.length} grupos\nTelegram: ${tgChats.length} chats`);
    return;
  }

  // Lógica de envio
  let content = msg.body;
  let media = null;
  let imageUrl = null;

  if (msg.hasMedia) {
    media = await msg.downloadMedia();
  } else if (/https?:\/\/.+\.(jpg|jpeg|png|gif)/i.test(content)) {
    imageUrl = content.trim();
    media = await getMediaFromUrl(imageUrl);
    content = '';
  }

  const wppGroups = readJson(WHATSAPP_GROUPS_DB);
  const tgChats = readJson(TELEGRAM_CHATS_DB);
  if (wppGroups.length === 0 && tgChats.length === 0) {
    await msg.reply('❌ Nenhum grupo ou canal registrado.');
    return;
  }

  await sendToAll(content || '📣 Nova mensagem!', imageUrl);
  await msg.reply('✅ Enviado para todos!');
});

// === API EXPRESS ===
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

app.post('/send-to-all', async (req, res) => {
  const { message, imageUrl } = req.body;
  if (!message && !imageUrl) {
    return res.status(400).json({ success: false, error: 'Mensagem ou imagem obrigatória.' });
  }

  await sendToAll(message || '', imageUrl);
  res.json({ success: true, message: 'Enviado com sucesso.' });
});

app.listen(PORT, () => log(`🚀 API rodando na porta ${PORT}`));
wpp.initialize();
