---
title: Migração para Python Twikit
status: Em Progresso
goal: Implementar postagem no Twitter/X usando script Python (Twikit) integrado ao bot Node.js para contornar limitações de API e bibliotecas JS deprecadas.
---

## 1. Contexto
As bibliotecas oficiais (`twitter-api-v2`) exigem pagamentos para escrita (postagem), e as alternativas em JS (`agent-twitter-client`) estão instáveis ou descontinuadas. A solução mais robusta identificada é a biblioteca Python `twikit`.

## 2. Arquitetura da Solução
- **Node.js (Bot Principal):**
  - Recebe comandos e mídias do WhatsApp.
  - Salva mídias em pasta temporária (`temp/`).
  - Executa script Python via `child_process`.
- **Python (Worker):**
  - Script `twitter_service.py`.
  - Gerencia autenticação via Cookies (gera `cookies.json`).
  - Realiza upload e postagem usando `twikit`.
  - Retorna JSON via STDOUT para o Node.js ler (sucesso/erro).

## 3. Passos de Implementação
1. [x] Verificar instalação do Python.
2. [ ] Criar script `twitter_service.py` com suporte a CLI arguments.
3. [ ] Criar arquivo `requirements.txt` com `twikit` e `python-dotenv`.
4. [ ] Modificar `bot.js` para integrar a chamada ao script Python.
5. [ ] Testar fluxo completo (Login -> Salvar Cookies -> Postar).

## 4. Variáveis de Ambiente Necessárias
- `TWITTER_USERNAME`
- `TWITTER_PASSWORD`
- `TWITTER_EMAIL`

## 5. Estratégia de Mídia
Como o Python roda em processo separado, não podemos passar Buffer de memória facilmente.
- Node salva Buffer -> `temp/nome_arquivo.ext`
- Node chama Python com path do arquivo.
- Python faz upload.
- Node deleta arquivo temporário após sucesso/falha.
