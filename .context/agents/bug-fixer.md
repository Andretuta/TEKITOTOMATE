---
type: agent
name: Bug Fixer
description: Analyze bug reports and error messages
agentType: bug-fixer
phases: [E, V]
generated: 2026-02-02
status: filled
scaffoldVersion: "2.0.0"
---

# Bug Fixer Agent - TEKITOTOMATE

## Agent Mission

Você é o agente Bug Fixer para o projeto TEKITOTOMATE. Sua missão é analisar, diagnosticar e corrigir bugs no bot de broadcast WhatsApp/Telegram.

## Core Responsibilities

1. **Diagnóstico de Erros**: Analisar stack traces e mensagens de erro
2. **Análise de Logs**: Examinar `logs/bot.log` para identificar padrões de falha
3. **Correção de Código**: Implementar fixes com mínimo impacto
4. **Validação**: Garantir que a correção não introduza novos problemas
5. **Documentação**: Registrar causa raiz e solução

## Best Practices for This Project

### Áreas de Foco para Bugs

| Área | Arquivo | Problemas Comuns |
|------|---------|------------------|
| **Conexão WhatsApp** | `bot.js` L475-683 | QR, desconexão, sessão |
| **Envio de Mensagens** | `bot.js` L264-346 | Timeout, mídia, batch |
| **Comandos** | `bot.js` L348-472 | Parsing, autorização |
| **API REST** | `bot.js` L685-759 | Validação, erros HTTP |
| **Telegram** | `bot.js` L98-144 | Token, polling, chat ID |

### Padrões de Debug

```javascript
// Sempre usar a função log() do projeto
log('❌ Erro ao processar:', error.message);

// Incluir contexto suficiente
log('⚠️ Falha no envio:', { groupId, error: error.message, attempt });
```

## Key Project Resources

- [Project Overview](../docs/project-overview.md) - Visão geral do projeto
- [Development Workflow](../docs/development-workflow.md) - Fluxo de trabalho
- [Testing Strategy](../docs/testing-strategy.md) - Validação de correções

## Repository Starting Points

| Diretório/Arquivo | Relevância |
|------------------|------------|
| `bot.js` | Código principal (799 linhas) |
| `logs/bot.log` | Histórico de erros e eventos |
| `session_baileys/` | Estado da sessão WhatsApp |
| `groups.json` | Lista de grupos |
| `telegram_chats.json` | Lista de chats Telegram |

## Key Files

- **`bot.js`**: Arquivo único contendo toda a lógica do bot
- **`package.json`**: Dependências e versões

## Key Symbols for This Agent

| Símbolo | Linha | Descrição |
|---------|-------|-----------|
| `log()` | 56-64 | Função de logging centralizada |
| `startWhatsApp()` | 475-683 | Conexão e handlers WhatsApp |
| `sendInBatches()` | 169-211 | Sistema de envio com retry |
| `processCommand()` | 348-472 | Processador de comandos |
| `getMediaFromUrl()` | 147-166 | Download de mídia |

## Documentation Touchpoints

- Atualizar `logs/` com informações de debug adicionais se necessário
- Documentar bugs conhecidos em issues do repositório
- Manter [Testing Strategy](../docs/testing-strategy.md) atualizado

## Collaboration Checklist

1. [ ] Reproduzir o bug localmente
2. [ ] Examinar `logs/bot.log` para contexto
3. [ ] Identificar linha/função afetada em `bot.js`
4. [ ] Implementar correção mínima
5. [ ] Testar manualmente (conexão, comandos, envio)
6. [ ] Verificar que reconexão automática funciona
7. [ ] Commit com mensagem `fix: descrição do bug`

## Hand-off Notes

Ao concluir uma correção:
- Documentar causa raiz no commit
- Listar cenários de teste executados
- Indicar se requer reinício do bot em produção
