---
type: doc
name: testing-strategy
description: Test frameworks, patterns, coverage requirements, and quality gates
category: testing
generated: 2026-02-02
status: filled
scaffoldVersion: "2.0.0"
---

# Testing Strategy

## Overview

O projeto TEKITOTOMATE atualmente utiliza testes manuais para validação das funcionalidades. Este documento descreve a estratégia de testes e práticas recomendadas.

## Testing Strategy

Dado o escopo do projeto (bot de broadcast), a estratégia foca em:

1. **Testes Manuais Funcionais**: Validação de comandos e envios
2. **Testes de Integração**: Verificar conexão com WhatsApp e Telegram
3. **Monitoramento**: Logs detalhados para debug pós-execução

## Test Types

### Testes Manuais (Atuais)

| Tipo | Descrição | Como Testar |
|------|-----------|-------------|
| **Conexão WhatsApp** | Verificar QR e login | Iniciar bot e escanear QR |
| **Comandos** | Testar `status`, `test`, `sync` | Enviar via WhatsApp |
| **Envio Texto** | Broadcast de texto | Enviar mensagem para admin |
| **Envio Mídia** | Broadcast de imagem/vídeo | Enviar mídia para admin |
| **API REST** | Endpoints funcionais | `curl http://localhost:3000/health` |

### Testes Automatizados (Futuro)

```
- **Unit**: Jest, arquivos `*.test.js`
- **Integration**: Mocks de Baileys/Telegram
- **E2E**: Ambiente de staging com bots de teste
```

## Running Tests

### Testes Manuais

```bash
# Iniciar bot
npm start

# Testar saúde da API (terminal separado)
curl http://localhost:3000/health

# Testar status da API
curl http://localhost:3000/status

# Testar envio via API
curl -X POST http://localhost:3000/send-to-all \
  -H "Content-Type: application/json" \
  -d '{"message": "Teste de broadcast"}'
```

### Comandos WhatsApp para Teste

Envie via chat privado para o número do bot:

- `test` ou `teste` - Verifica resposta do bot
- `status` - Exibe status completo
- `sync` - Sincroniza lista de grupos
- `help` - Lista comandos disponíveis

## Quality Gates

### Antes de Merge/Deploy

- [ ] Bot inicia sem erros
- [ ] QR Code é gerado corretamente
- [ ] Comandos respondem adequadamente
- [ ] Envio de texto funciona
- [ ] Envio de mídia funciona
- [ ] API `/health` retorna `OK`
- [ ] Reconexão automática funciona
- [ ] Logs são gravados corretamente

### Métricas de Qualidade

| Métrica | Requisito |
|---------|-----------|
| Tempo de resposta do bot | < 5s |
| Taxa de sucesso de envio | > 95% |
| Reconexão após queda | < 10s |
| Uso de memória | < 150MB |

## Troubleshooting

### Problemas Comuns

1. **QR Code não aparece**
   - Verificar versão do Node.js (>= 18)
   - Deletar pasta `session_baileys/` e reiniciar

2. **Desconexão frequente**
   - Verificar conexão de internet
   - Não usar o WhatsApp Web simultaneamente

3. **Envios falhando**
   - Conferir `logs/bot.log` para erros
   - Verificar se grupos ainda existem
   - Executar comando `sync`

4. **Telegram não funciona**
   - Verificar `TELEGRAM_TOKEN` no `.env`
   - Confirmar token com @BotFather
