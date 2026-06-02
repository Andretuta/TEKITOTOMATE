---
type: doc
name: development-workflow
description: Day-to-day engineering processes, branching, and contribution guidelines
category: workflow
generated: 2026-02-02
status: filled
scaffoldVersion: "2.0.0"
---

# Development Workflow

## Overview

Este documento descreve o fluxo de trabalho diário para desenvolver e manter o bot TEKITOTOMATE. O projeto segue um modelo simples e direto, ideal para uma equipe pequena ou desenvolvimento individual.

## Development Workflow

### Ciclo de Desenvolvimento

1. **Identificar mudança necessária** - Bug, feature ou melhoria
2. **Criar branch** (se aplicável) - Para mudanças significativas
3. **Desenvolver localmente** - Testar com `npm start`
4. **Testar funcionalidades** - Verificar comandos e envios
5. **Commit e push** - Com mensagens descritivas
6. **Deploy** - Executar `update.bat` no servidor

## Branching & Releases

### Modelo de Branch

- **main**: Branch principal, sempre estável
- **feature/***: Branches para novas funcionalidades
- **fix/***: Branches para correções de bugs

### Convenção de Commits

```
tipo(escopo): descrição curta

- feat: nova funcionalidade
- fix: correção de bug
- docs: documentação
- refactor: refatoração de código
- chore: tarefas de manutenção
```

### Release Flow

1. Desenvolver na branch apropriada
2. Testar exaustivamente
3. Merge para `main`
4. Tag de versão (semântica): `v1.0.0`, `v1.1.0`, etc.

## Local Development

### Instalação Inicial

```bash
# Clonar repositório
git clone <repo-url>
cd TEKITOTOMATE

# Instalar dependências
npm install
```

### Executar Localmente

```bash
# Iniciar o bot
npm start

# Ou diretamente
node bot.js
```

### Variáveis de Ambiente

Crie um arquivo `.env` na raiz:

```env
PORT=3000
TELEGRAM_TOKEN=seu_token_aqui
```

### Configurar Admins

Edite `bot_admins.json`:

```json
{
  "admins": ["5511999999999", "5511888888888"]
}
```

## Code Review Expectations

### Checklist de Review

- [ ] Código funciona sem erros
- [ ] Logs são informativos e não excessivos
- [ ] Tratamento de erros adequado
- [ ] Sem credenciais/tokens expostos
- [ ] Compatibilidade com Node.js >= 18

### Boas Práticas

1. Manter funções pequenas e focadas
2. Usar async/await consistentemente
3. Logar informações relevantes com a função `log()`
4. Não deixar `console.log` de debug
5. Testar envios antes de fazer commit

## Onboarding Tasks

### Primeiro Dia

1. Ler este documento e [Project Overview](./project-overview.md)
2. Configurar ambiente local
3. Executar o bot e escanear QR
4. Testar comando `status` via WhatsApp
5. Entender estrutura do `bot.js`

### Primeira Semana

1. Entender fluxo de mensagens
2. Conhecer sistema de batch/retry
3. Testar integração com Telegram
4. Revisar logs em `logs/bot.log`
