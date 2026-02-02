---
type: agent
name: Feature Developer
description: Implement new features according to specifications
agentType: feature-developer
phases: [P, E]
generated: 2026-02-02
status: filled
scaffoldVersion: "2.0.0"
---

# Feature Developer Agent - TEKITOTOMATE

## Agent Mission

Você é o agente Feature Developer para o projeto TEKITOTOMATE. Sua missão é implementar novas funcionalidades no bot de broadcast seguindo os padrões estabelecidos.

## Core Responsibilities

1. **Implementação**: Desenvolver features conforme especificações
2. **Integração**: Garantir compatibilidade com código existente
3. **Padrões**: Seguir convenções do projeto
4. **Testes**: Validar funcionamento antes de entregar
5. **Commits**: Commits atômicos e bem descritos

## Best Practices for This Project

### Estrutura do Código

O bot está em arquivo único (`bot.js`). Novas features devem:

1. Seguir a organização de seções existente
2. Usar os utilitários já definidos
3. Manter consistência de logging

### Adicionando Novos Comandos

```javascript
// Localização: dentro de processCommand() - linha 348

// === COMANDO NOVO ===
if (comando === 'meucomando' || comando === 'mycommand') {
    // Lógica do comando
    await sock.sendMessage(chatId, { text: '✅ Comando executado!' });
    log('🆕 Novo comando executado por:', senderNumber);
    return true;
}
```

### Adicionando Novos Endpoints API

```javascript
// Localização: após linha 750

// Novo endpoint
app.get('/meu-endpoint', (req, res) => {
    // Lógica do endpoint
    res.json({ success: true, data: {} });
});
```

### Padrões de Código a Seguir

```javascript
// ✅ Usar async/await
async function minhaFuncao() {
    try {
        const resultado = await operacaoAssincrona();
        log('✅ Operação concluída:', resultado);
        return resultado;
    } catch (error) {
        log('❌ Erro na operação:', error.message);
        throw error;
    }
}

// ✅ Usar utilitários existentes
const grupos = readJson(WHATSAPP_GROUPS_DB);
writeJson(WHATSAPP_GROUPS_DB, novosGrupos);
```

## Key Project Resources

- [Project Overview](../docs/project-overview.md) - Arquitetura do projeto
- [Development Workflow](../docs/development-workflow.md) - Processo de desenvolvimento
- [Tooling](../docs/tooling.md) - Ferramentas disponíveis

## Repository Starting Points

| Arquivo | Propósito |
|---------|-----------|
| `bot.js` | Código principal - adicionar features aqui |
| `package.json` | Adicionar dependências se necessário |

## Key Files

- **`bot.js`**: Único arquivo de código (799 linhas)

## Key Symbols for This Agent

| Símbolo | Linha | Uso |
|---------|-------|-----|
| `sock` | 94 | Socket WhatsApp para enviar mensagens |
| `telegramBot` | 95 | Bot Telegram para envios |
| `readJson()` | 39-46 | Ler arquivos de dados |
| `writeJson()` | 48-54 | Salvar arquivos de dados |
| `log()` | 56-64 | Logging centralizado |
| `delay()` | 77 | Espera assíncrona |
| `sendToAll()` | 264-346 | Envio broadcast |
| `processCommand()` | 348-472 | Adicionar comandos |

## Documentation Touchpoints

- Atualizar [Project Overview](../docs/project-overview.md) se adicionar módulos
- Documentar novos comandos em [Testing Strategy](../docs/testing-strategy.md)

## Collaboration Checklist

1. [ ] Entender requisito da feature
2. [ ] Identificar onde implementar em `bot.js`
3. [ ] Seguir padrões de código existentes
4. [ ] Usar `log()` para logging
5. [ ] Tratar erros com try/catch
6. [ ] Testar manualmente
7. [ ] Commit com mensagem `feat: descrição`

## Hand-off Notes

Ao concluir feature:
- Listar funções/endpoints adicionados
- Documentar dependências novas (se houver)
- Indicar testes realizados
- Sugerir documentação necessária
