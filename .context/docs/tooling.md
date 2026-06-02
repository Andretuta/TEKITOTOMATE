---
type: doc
name: tooling
description: Scripts, IDE settings, automation, and developer productivity tips
category: tooling
generated: 2026-02-02
status: filled
scaffoldVersion: "2.0.0"
---

# Tooling & Productivity Guide

## Overview

Este documento lista as ferramentas, scripts e configurações recomendadas para desenvolver e manter o bot TEKITOTOMATE de forma produtiva.

## Required Tooling

### Runtime e Dependências

| Ferramenta | Versão | Instalação | Uso |
|------------|--------|------------|-----|
| **Node.js** | >= 18.0.0 | [nodejs.org](https://nodejs.org) | Runtime |
| **npm** | >= 8.x | Incluído no Node | Gerenciador de pacotes |
| **Git** | Qualquer | [git-scm.com](https://git-scm.com) | Controle de versão |

### Dependências do Projeto

```bash
# Instalação completa
npm install
```

Principais pacotes:
- `@anubis-pro/baileys`: Cliente WhatsApp não-oficial
- `node-telegram-bot-api`: Cliente Telegram
- `express`: Servidor HTTP
- `axios`: Requisições HTTP
- `pino`: Logging performático
- `qrcode`: Geração de QR codes

## Recommended Automation

### Scripts NPM Disponíveis

```bash
# Iniciar o bot
npm start

# Atualizar do repositório remoto
npm run update

# Limpar sessão (requer novo QR)
npm run clear

# Reiniciar forcadamente (Windows)
npm run restart
```

### Script de Atualização (Windows)

O arquivo `update.bat` automatiza:
1. Pull do repositório
2. Instalação de dependências
3. Reinício do bot

```batch
# Executar atualização
.\update.bat
```

### Variáveis de Ambiente

Arquivo `.env` na raiz do projeto:

```env
# Porta da API (padrão: 3000)
PORT=3000

# Token do bot Telegram (opcional)
TELEGRAM_TOKEN=123456:ABC-DEF...
```

## IDE / Editor Setup

### VS Code Recomendado

**Extensões Sugeridas:**

- ESLint - Linting de JavaScript
- Prettier - Formatação de código
- GitLens - Git integrado avançado
- REST Client - Testar API diretamente

**Settings Recomendados (`.vscode/settings.json`):**

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "javascript.updateImportsOnFileMove.enabled": "always"
}
```

**Launch Config para Debug (`.vscode/launch.json`):**

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Run Bot",
      "program": "${workspaceFolder}/bot.js",
      "console": "integratedTerminal",
      "envFile": "${workspaceFolder}/.env"
    }
  ]
}
```

## Productivity Tips

### Aliases Úteis (PowerShell)

```powershell
# Adicionar ao seu profile do PowerShell
function bot { node bot.js }
function botlog { Get-Content logs/bot.log -Tail 50 -Wait }
function botreset { Remove-Item session_baileys -Recurse -Force; node bot.js }
```

### Testar API Rapidamente

```bash
# Verificar status
curl http://localhost:3000/status

# Health check
curl http://localhost:3000/health

# Enviar mensagem de teste
curl -X POST http://localhost:3000/send-to-all -H "Content-Type: application/json" -d "{\"message\": \"Teste\"}"
```

### Monitorar Logs em Tempo Real

```powershell
# Windows PowerShell
Get-Content logs\bot.log -Wait -Tail 100

# Git Bash / Linux
tail -f logs/bot.log
```

### Reset Rápido de Sessão

Quando precisar reconectar com novo QR:

```powershell
# Windows
Remove-Item session_baileys -Recurse -Force
npm start

# Linux/Mac
rm -rf session_baileys/
npm start
```

## Cross-References

- [Development Workflow](./development-workflow.md) - Fluxo de trabalho
- [Testing Strategy](./testing-strategy.md) - Testes e validação
