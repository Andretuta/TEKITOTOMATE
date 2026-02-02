---
type: doc
name: project-overview
description: High-level overview of the project, its purpose, and key components
category: overview
generated: 2026-02-02
status: filled
scaffoldVersion: "2.0.0"
---

# TEKITOTOMATE - WhatsApp & Telegram Broadcast Bot

## Project Summary

**TEKITOTOMATE** é um bot de broadcast multiplataforma que permite enviar mensagens simultâneas para grupos do WhatsApp e canais/grupos do Telegram. O bot foi projetado para administradores que precisam distribuir conteúdo (texto, imagens, vídeos) para múltiplos grupos de forma eficiente e paralela.

### Principais Características

- 📱 **WhatsApp Integration**: Conexão via Baileys (@anubis-pro/baileys) para envio de mensagens
- 📨 **Telegram Bot**: Suporte nativo a canais e grupos do Telegram
- 🚀 **Envio Paralelo**: Sistema de batch processing para envios eficientes
- 🔄 **Auto-sync**: Sincronização automática de grupos ao conectar
- 🌐 **REST API**: Endpoints para integração externa
- 📊 **Logging Completo**: Sistema de logs detalhado para debug

## Problem Statement

Administradores de comunidades frequentemente precisam enviar o mesmo conteúdo para dezenas ou centenas de grupos simultaneamente. Fazer isso manualmente é:
- Tedioso e demorado
- Propenso a erros
- Ineficiente para conteúdo multimídia

Este bot resolve esses problemas automatizando o processo de broadcast.

## Target Users

- Administradores de comunidades
- Gerentes de marketing digital
- Proprietários de negócios com múltiplos grupos de clientes

## Technical Stack & Runtime

| Componente | Tecnologia |
|------------|-----------|
| **Runtime** | Node.js >= 18.0.0 |
| **WhatsApp** | @anubis-pro/baileys (fork sem autofollow) |
| **Telegram** | node-telegram-bot-api |
| **HTTP Server** | Express.js 5.x |
| **HTTP Client** | Axios |
| **Logging** | Pino |
| **QR Code** | qrcode |

## Repository Structure

```
TEKITOTOMATE/
├── bot.js                 # Arquivo principal do bot (799 linhas)
├── package.json           # Dependências e scripts
├── bot_admins.json        # Lista de admins autorizados
├── groups.json            # Grupos WhatsApp cadastrados
├── telegram_chats.json    # Chats Telegram cadastrados
├── session_baileys/       # Sessão persistente do WhatsApp
├── logs/                  # Arquivos de log
│   └── bot.log           # Log principal
└── update.bat            # Script de atualização Windows
```

## Key Modules

1. **WhatsApp Connection** (`startWhatsApp()`): Gerencia conexão, QR code, reconexão automática
2. **Telegram Bot**: Auto-registro de chats, envio de mensagens
3. **Parallel Sender** (`sendInBatches()`): Sistema de envio em lotes com retry
4. **Command Processor** (`processCommand()`): Comandos do admin via WhatsApp
5. **REST API**: Endpoints `/send-to-all`, `/status`, `/health`

## Getting Started Checklist

1. Clone o repositório
2. Instale as dependências com `npm install`
3. Configure o arquivo `.env` com `TELEGRAM_TOKEN` (opcional)
4. Configure `bot_admins.json` com os números autorizados
5. Execute o bot com `npm start`
6. Escaneie o QR Code exibido no terminal
7. Envie `status` para o bot via WhatsApp para testar

## Next Steps

Consulte os seguintes documentos para mais detalhes:
- [Development Workflow](./development-workflow.md) - Fluxo de desenvolvimento
- [Tooling](./tooling.md) - Ferramentas e configurações
- [Testing Strategy](./testing-strategy.md) - Estratégia de testes
