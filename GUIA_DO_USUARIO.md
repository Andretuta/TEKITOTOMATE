# 🤖 Guia do Usuário - Bot de Broadcast Multiplataforma

## 📋 Índice
- [Visão Geral](#visão-geral)
- [Comandos do WhatsApp](#comandos-do-whatsapp)
- [Funcionalidades de Broadcast](#funcionalidades-de-broadcast)
- [API REST](#api-rest)
- [Configuração](#configuração)
- [Solução de Problemas](#solução-de-problemas)

---

## 🎯 Visão Geral

Este bot permite enviar mensagens simultaneamente para múltiplas plataformas:
- 📱 **WhatsApp** - Grupos onde o bot participa
- 📨 **Telegram** - Canais e grupos cadastrados
- 🐦 **Twitter/X** - Postagens na sua timeline

### Pré-requisitos
- Seu número deve estar cadastrado no arquivo `bot_admins.json`
- O bot deve estar conectado ao WhatsApp
- Para usar o Twitter, configure as credenciais no arquivo `.env`

---

## 💬 Comandos do WhatsApp

Todos os comandos devem ser enviados em **conversa privada** com o bot (não em grupos).

### 📊 `status`
Mostra o status atual do bot, incluindo conexões, grupos cadastrados e uso de recursos.

**Exemplo:**
```
status
```

**Resposta:**
```
📊 STATUS DO BOT

🔸 WhatsApp: ✅ Conectado
🔸 Grupos WPP: 12
🔸 Telegram: ✅ Ativo
🔸 Chats TG: 3
🔸 Twitter: ✅ Configurado
🔸 Uptime: 45min
🔸 Memória: 85MB
🔸 Biblioteca: Baileys
```

---

### 🧪 `test` ou `teste`
Testa se o bot está funcionando corretamente.

**Exemplo:**
```
test
```

**Resposta:**
```
🤖 Bot funcionando perfeitamente!
⏱️ Teste de resposta realizado.
```

---

### 🔄 `sync` ou `sincronizar`
Sincroniza todos os grupos do WhatsApp onde o bot participa, adicionando novos grupos automaticamente.

**Exemplo:**
```
sync
```

**Resposta:**
```
✅ Sincronização concluída!

📊 Grupos encontrados: 15
➕ Novos adicionados: 2
📁 Total registrado: 17
```

---

### 🔄 `reset`
Reseta a sessão do WhatsApp e reinicia o bot. Útil quando há problemas de conexão.

**Exemplo:**
```
reset
```

**Resposta:**
```
🔄 Resetando sessão do WhatsApp...
O bot será reiniciado.
```

⚠️ **Atenção:** Após usar este comando, você precisará escanear o QR Code novamente.

---

### 📦 `update` ou `atualizar`
Verifica se há atualizações disponíveis no repositório Git.

**Exemplo:**
```
update
```

**Resposta (se houver atualização):**
```
📦 ATUALIZAÇÃO DISPONÍVEL!

Para atualizar, execute no servidor:
```
cd d:/TEKITOTOMATE
git pull origin main
npm install
node bot.js
```

Ou execute: *update.bat*
```

---

### 🐦 `/x` - Broadcast com Twitter
Envia conteúdo para **TODAS as plataformas** (WhatsApp, Telegram E Twitter/X).

**Sintaxe:**
```
/x Seu texto aqui
```

**Com imagem:**
- Envie uma foto com a legenda `/x` - enviará a foto para todos
- Envie uma foto com a legenda `/x Seu texto` - enviará foto + texto para todos
- Responda a uma foto com `/x` - reenviará a foto citada para todos

**Exemplos:**
```
/x Nova atualização do projeto disponível!
```

```
/x
(legenda em uma foto)
```

---

### ❓ `help` ou `ajuda`
Exibe a lista de comandos disponíveis.

**Exemplo:**
```
help
```

---

## 📤 Funcionalidades de Broadcast

### Enviar Mensagem de Texto

Basta enviar uma mensagem de texto normal para o bot em conversa privada. A mensagem será enviada para todos os grupos WhatsApp e canais Telegram cadastrados.

**Exemplo:**
```
Olá a todos! Nova atualização disponível no projeto.
```

---

### Enviar Imagem com Legenda

Envie uma imagem com uma legenda (caption). A imagem e a legenda serão enviadas para todos os destinos.

**Passos:**
1. Selecione ou tire uma foto
2. Adicione uma legenda (opcional)
3. Envie para o bot

---

### Enviar URL de Imagem

Envie apenas a URL de uma imagem. O bot baixará e enviará a imagem para todos os destinos.

**Exemplo:**
```
https://exemplo.com/imagem.jpg
```

---

### Diferença: Broadcast Normal vs `/x`

| Comando | WhatsApp | Telegram | Twitter |
|---------|-----------|----------|---------|
| Mensagem normal | ✅ | ✅ | ❌ |
| `/x texto` | ✅ | ✅ | ✅ |

**Resumo:**
- **Mensagem normal:** Envia apenas para WhatsApp e Telegram
- **`/x`:** Envia para WhatsApp, Telegram E Twitter

Use `/x` quando quiser que o conteúdo seja publicado também no Twitter/X.

---

## 🌐 API REST

O bot também expõe uma API REST para integração com outras aplicações.

### Endpoint: Enviar Broadcast

**URL:** `POST http://localhost:3000/send-to-all`

**Headers:**
```
Content-Type: application/json
```

**Body:**
```json
{
  "message": "Mensagem a ser enviada",
  "imageUrl": "https://exemplo.com/imagem.jpg"
}
```

**Resposta de Sucesso:**
```json
{
  "success": true,
  "message": "Enviado com sucesso.",
  "resultado": {
    "whatsapp": {
      "sucessos": 12,
      "falhas": 0,
      "erros": []
    },
    "telegram": {
      "sucessos": 3,
      "falhas": 0,
      "erros": []
    },
    "twitter": {
      "success": false,
      "skipped": true
    },
    "tempoTotal": "3.2s",
    "resumo": "📊 Envio concluído em 3.2s: WPP(12✅/0❌) TG(3✅/0❌)"
  }
}
```

---

### Endpoint: Status

**URL:** `GET http://localhost:3000/status`

**Resposta:**
```json
{
  "whatsapp": {
    "connected": true,
    "groups": 12,
    "user": {
      "id": "5511999999999:s.whatsapp.net",
      "name": "Bot"
    },
    "library": "Baileys (@anubis-pro/baileys)"
  },
  "telegram": {
    "active": true,
    "chats": 3
  },
  "uptime": 2700.5,
  "memory": {
    "rss": 120455168,
    "heapTotal": 20971520,
    "heapUsed": 17892344
  }
}
```

---

### Endpoint: Health Check

**URL:** `GET http://localhost:3000/health`

**Resposta:**
```json
{
  "status": "OK",
  "timestamp": "2026-02-07T16:45:00.000Z",
  "library": "Baileys"
}
```

---

## ⚙️ Configuração

### Arquivo `.env`

Configure as variáveis de ambiente no arquivo `.env`:

```env
# Telegram (obtido com @BotFather)
TELEGRAM_TOKEN=seu_token_aqui

# Twitter (opcional)
TWITTER_USERNAME=seu_usuario
TWITTER_EMAIL=seu_email
TWITTER_PASSWORD=sua_senha

# Porta da API (opcional, padrão: 3000)
PORT=3000
```

---

### Arquivo `bot_admins.json`

Adicione seu número WhatsApp (apenas números, com código do país e DDD):

```json
{
  "admins": [
    "5511999999999",
    "5521988888888"
  ]
}
```

---

### Arquivo `telegram_chats.json`

Os chats do Telegram são adicionados automaticamente quando o bot é adicionado a um grupo/canal ou recebe uma mensagem.

```json
[
  -1001234567890,
  -1009876543210
]
```

---

### Arquivo `groups.json`

Os grupos do WhatsApp são gerenciados automaticamente, mas você pode editar manualmente:

```json
[
  "5511999999999-1234567890@g.us",
  "5521988888888-0987654321@g.us"
]
```

---

## 🔧 Solução de Problemas

### Bot não responde aos comandos

**Possíveis causas:**
1. Seu número não está em `bot_admins.json`
2. O bot está desconectado do WhatsApp
3. Você está enviando comandos de um grupo (deve ser em privado)

**Solução:**
1. Verifique se seu número está cadastrado como admin
2. Use o comando `status` para verificar a conexão
3. Sempre envie comandos em conversa privada com o bot

---

### WhatsApp desconectado

**Sintomas:**
- Bot não envia mensagens
- Comando `status` mostra "❌ Desconectado"

**Solução:**
1. Execute o comando `reset` em conversa privada
2. Escaneie o QR Code que aparecerá no terminal
3. Aguarde a conexão ser estabelecida

---

### Erro ao postar no Twitter

**Possíveis causas:**
1. Credenciais incorretas no `.env`
2. Conta suspensa ou com autenticação de 2 fatores
3. Puppeteer não instalado

**Solução:**
1. Verifique as credenciais no arquivo `.env`
2. Desative a autenticação de 2 fatores temporariamente
3. Execute `npm install` para garantir que todas dependências estão instaladas

---

### Grupos não estão recebendo mensagens

**Solução:**
1. Execute o comando `sync` para sincronizar os grupos
2. Verifique se o bot ainda participa dos grupos
3. Use o comando `status` para ver quantos grupos estão cadastrados

---

### Telegram não funciona

**Solução:**
1. Verifique se `TELEGRAM_TOKEN` está configurado no `.env`
2. Adicione o bot a um grupo/canal
3. Envie uma mensagem para o bot para registrar o chat automaticamente

---

## 📝 Notas Importantes

1. **Autenticação:** Apenas administradores cadastrados podem usar os comandos
2. **Privacidade:** Comandos só funcionam em conversa privada, não em grupos
3. **Limites:** O bot usa envio em lotes para evitar bloqueios
4. **Logs:** Todas as ações são registradas em `logs/bot.log`
5. **Twitter:** O uso do Twitter é opcional e requer configuração adicional

---

## 🚀 Inicialização

Para iniciar o bot:

```bash
# Instalar dependências (primeira vez)
npm install

# Iniciar o bot
node bot.js
```

No Windows, você também pode usar o arquivo `update.bat` para atualizar e reiniciar.

---

## 📞 Suporte

Para mais informações, consulte:
- `TWITTER_GUIDE.md` - Guia específico do Twitter
- `AGENTS.md` - Documentação para desenvolvedores
- Logs em `logs/bot.log`

---

**Versão do Bot:** Baseada em @anubis-pro/baileys  
**Última atualização:** 2026-02-07
