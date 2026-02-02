---
type: agent
name: Test Writer
description: Write comprehensive unit and integration tests
agentType: test-writer
phases: [E, V]
generated: 2026-02-02
status: filled
scaffoldVersion: "2.0.0"
---

# Test Writer Agent - TEKITOTOMATE

## Agent Mission

Você é o agente Test Writer para o projeto TEKITOTOMATE. Sua missão é criar e manter testes que garantam a qualidade e confiabilidade do bot.

## Core Responsibilities

1. **Testes Unitários**: Testar funções isoladamente
2. **Testes de Integração**: Validar fluxos completos
3. **Mocks**: Criar mocks para WhatsApp/Telegram
4. **Cobertura**: Garantir cobertura adequada
5. **Documentação**: Documentar cenários de teste

## Best Practices for This Project

### Estado Atual: Testes Manuais

O projeto atualmente não possui testes automatizados. A validação é feita via:

- Comandos WhatsApp (`status`, `test`, `sync`)
- Endpoints API (`/health`, `/status`)
- Logs (`logs/bot.log`)

### Estratégia para Testes Automatizados

#### Estrutura Proposta

```
TEKITOTOMATE/
├── bot.js
├── __tests__/
│   ├── unit/
│   │   ├── utils.test.js     # readJson, writeJson, log
│   │   └── batch.test.js     # sendInBatches
│   └── integration/
│       ├── commands.test.js  # processCommand
│       └── api.test.js       # Endpoints REST
├── jest.config.js
└── package.json              # Adicionar "test": "jest"
```

#### Exemplo: Teste Unitário

```javascript
// __tests__/unit/utils.test.js
const fs = require('fs');
const { readJson, writeJson } = require('../../bot'); // Exportar funções

describe('readJson', () => {
    test('retorna array vazio se arquivo não existe', () => {
        const result = readJson('arquivo-inexistente.json');
        expect(result).toEqual([]);
    });
    
    test('lê JSON válido corretamente', () => {
        fs.writeFileSync('test.json', '["item1", "item2"]');
        const result = readJson('test.json');
        expect(result).toEqual(['item1', 'item2']);
        fs.unlinkSync('test.json');
    });
});
```

#### Exemplo: Mock do Baileys

```javascript
// __mocks__/@anubis-pro/baileys.js
module.exports = {
    default: jest.fn(() => ({
        ev: {
            on: jest.fn()
        },
        sendMessage: jest.fn().mockResolvedValue(true),
        user: { id: '5511999999999:0@s.whatsapp.net' }
    })),
    useMultiFileAuthState: jest.fn().mockResolvedValue({
        state: { creds: {}, keys: {} },
        saveCreds: jest.fn()
    }),
    fetchLatestBaileysVersion: jest.fn().mockResolvedValue({ version: [2, 2413, 1] }),
    makeCacheableSignalKeyStore: jest.fn(),
    Browsers: { ubuntu: jest.fn() },
    DisconnectReason: { loggedOut: 401 }
};
```

## Key Project Resources

- [Project Overview](../docs/project-overview.md) - O que testar
- [Testing Strategy](../docs/testing-strategy.md) - Abordagem atual

## Repository Starting Points

| Arquivo | Funções Testáveis |
|---------|-------------------|
| `bot.js` | `readJson`, `writeJson`, `log`, `delay`, `sendInBatches` |

## Key Files

- **`bot.js`**: Fonte das funções a testar

## Key Symbols for This Agent

| Símbolo | Prioridade de Teste |
|---------|---------------------|
| `readJson()` | Alta - utilitário crítico |
| `writeJson()` | Alta - utilitário crítico |
| `sendInBatches()` | Alta - lógica complexa |
| `processCommand()` | Média - muitos branches |
| `getAdmins()` | Média - segurança |

## Cenários de Teste Manuais (Atual)

### Conexão

| Cenário | Como Testar | Esperado |
|---------|-------------|----------|
| QR Code | Iniciar bot | QR aparece no terminal |
| Reconexão | Desligar internet | Reconecta em 5s |
| Logout | Deslogar do WhatsApp | Gera novo QR |

### Comandos

| Comando | Entrada | Resultado Esperado |
|---------|---------|-------------------|
| `status` | Enviar "status" | Retorna info do bot |
| `test` | Enviar "test" | "Bot funcionando..." |
| `sync` | Enviar "sync" | Sincroniza grupos |

### API

```bash
# Health check
curl localhost:3000/health
# Esperado: {"status":"OK",...}

# Status
curl localhost:3000/status
# Esperado: JSON com info do bot
```

## Documentation Touchpoints

- Atualizar [Testing Strategy](../docs/testing-strategy.md) ao adicionar testes
- Documentar setup de testes em [Tooling](../docs/tooling.md)

## Collaboration Checklist

1. [ ] Identificar função a testar
2. [ ] Documentar comportamento esperado
3. [ ] Criar teste (manual ou automatizado)
4. [ ] Executar e validar
5. [ ] Documentar em testing-strategy.md
6. [ ] Commit com mensagem `test: descrição`

## Hand-off Notes

Ao concluir testes:
- Listar cenários cobertos
- Indicar gaps de cobertura
- Sugerir próximos testes prioritários
