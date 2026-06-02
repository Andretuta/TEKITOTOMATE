# 🤖 TEKITOTOMATE - Agentes IA

Esta pasta contém os playbooks para agentes de IA que auxiliam no desenvolvimento do projeto TEKITOTOMATE.

## Agentes Disponíveis

| Agente | Descrição | Fases PREVC |
|--------|-----------|-------------|
| [bug-fixer.md](./bug-fixer.md) | Diagnóstico e correção de bugs | E, V |
| [code-reviewer.md](./code-reviewer.md) | Revisão de código e qualidade | R, V |
| [documentation-writer.md](./documentation-writer.md) | Criação de documentação | P, C |
| [feature-developer.md](./feature-developer.md) | Implementação de novas features | P, E |
| [performance-optimizer.md](./performance-optimizer.md) | Otimização de performance | E, V |
| [refactoring-specialist.md](./refactoring-specialist.md) | Refatoração de código | E |
| [test-writer.md](./test-writer.md) | Criação de testes | E, V |

## Fases PREVC

O workflow PREVC organiza o desenvolvimento em fases:

- **P** (Plan): Planejamento e documentação inicial
- **R** (Review): Revisão de design e código
- **E** (Execute): Implementação e desenvolvimento
- **V** (Verify): Verificação e testes
- **C** (Complete): Documentação final e entrega

## Como Usar

1. **Identifique a tarefa**: Qual tipo de trabalho você precisa fazer?
2. **Escolha o agente**: Selecione o agente apropriado para a tarefa
3. **Siga o playbook**: Use o checklist e guidelines do agente
4. **Colabore**: Agentes podem fazer handoff entre si

## Símbolos-Chave do Projeto

Os agentes referem funções importantes do `bot.js`:

| Símbolo | Descrição |
|---------|-----------|
| `startWhatsApp()` | Conexão WhatsApp |
| `sendToAll()` | Broadcast de mensagens |
| `processCommand()` | Processador de comandos |
| `sendInBatches()` | Envio paralelo |

---

*Playbooks gerados em 02/02/2026 para o projeto TEKITOTOMATE*
