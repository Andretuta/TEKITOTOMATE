# 🤖 Guia do Usuário - Bot de Broadcast Multiplataforma

Este bot foi projetado para realizar transmissões simultâneas de mensagens (textos, links e mídias) para múltiplos destinos, integrando WhatsApp, Telegram e Twitter/X de forma eficiente, segura e automatizada.

---

## 📋 Índice
- [Visão Geral e Arquitetura](#-visão-geral-e-arquitetura)
  - [O que faz cada arquivo na pasta src](#o-que-faz-cada-arquivo-na-pasta-src)
- [Instalação e Inicialização](#-instalação-e-inicialização)
- [Configuração de Arquivos](#%EF%B8%F0-configuração-de-arquivos)
- [Comandos do WhatsApp](#-comandos-do-whatsapp)
- [Modos de Velocidade (Rápido vs Lento)](#%EF%B8%8F-modos-de-velocidade-rápido-vs-lento)
- [Controle de Rate Limit (Limite de Taxa)](#-controle-de-rate-limit-limite-de-taxa)
- [Armazenamento de Mídia e Fila Persistente](#-armazenamento-de-mídia-e-fila-persistente)
- [Segurança e Prevenção de Ban (Anti-Ban)](#-segurança-e-prevenção-de-ban-anti-ban)
- [Solução de Problemas (FAQ & Workarounds)](#-solução-de-problemas-faq--workarounds)

---

## 🎯 Visão Geral e Arquitetura

O bot permite centralizar suas comunicações enviando uma única mensagem no privado para:
- 📱 **WhatsApp** - Envio para múltiplos grupos cadastrados.
- 📨 **Telegram** - Canais e grupos onde o bot está adicionado.
- 🐦 **Twitter/X** - Postagem direta em sua conta através de automação Puppeteer.

O projeto foi totalmente modularizado para melhorar a organização, escalabilidade e manutenção do código. Abaixo está a explicação detalhada de cada parte do sistema.

### O que faz cada arquivo na pasta `src/`

#### 1. [bot.js](file:///d:/PROBLEMA/Whatsapp-Telegram-bot/Whatsapp-Telegram-bot/Whatsapp-Telegram-Bot/bot.js) (Raiz)
É o ponto de entrada principal (Orquestrador) do sistema.
- **Função:** Lê as variáveis de ambiente, cria os diretórios de sessão e logs se necessário, e inicializa o servidor da API Express.
- **WhatsApp:** Estabelece a conexão socket com o WhatsApp usando a biblioteca oficial `@whiskeysockets/baileys`. Gerencia o ciclo de vida da conexão, escuta eventos de recebimento de mensagens e mídias, gerencia novos grupos em que o bot é inserido e executa a geração de QR Code no terminal.
- **Telegram:** Inicializa o polling do Telegram e gerencia o registro automático de novos chats.
- **Resiliência:** Trata erros globais (`uncaughtException` e `unhandledRejection`) e implementa o algoritmo de reconexão gradual.

#### 2. [src/config.js](file:///d:/PROBLEMA/Whatsapp-Telegram-bot/Whatsapp-Telegram-bot/Whatsapp-Telegram-Bot/src/config.js)
Repositório central de definições e parâmetros globais de funcionamento.
- **Função:** Armazena caminhos físicos de bancos de dados JSON (`groups.json`, `telegram_chats.json`, `bot_admins.json`, etc.) e do diretório de sessão.
- **Perfis de Velocidade:** Define as tabelas de tempos de delay, digitação simulada e atraso na fila de envios para os modos `rapido` e `lento`.
- **Configurações de Concurência:** Define os limites de lotes e retentativas para o Telegram.
- **Regras de Rate Limit:** Contém as regras de limite por hora (8 broadcasts/hora) e do intervalo mínimo (120 segundos de cooldown), monitorando o histórico de envios ativos.

#### 3. [src/utils.js](file:///d:/PROBLEMA/Whatsapp-Telegram-bot/Whatsapp-Telegram-bot/Whatsapp-Telegram-Bot/src/utils.js)
Ferramentas e funções auxiliares genéricas reutilizadas por múltiplos arquivos.
- **Logger com Rotação:** Escreve registros detalhados em `logs/bot.log`. Se o arquivo de log passar de 5MB, ele é renomeado automaticamente para uma versão antiga e os arquivos mais velhos (mantendo apenas os dois últimos) são excluídos.
- **Leitor/Escritor JSON:** Funções para carregar e salvar dados locais sem travar a execução síncrona.
- **Delays com Jitter:** Controla as pausas necessárias no código, adicionando opcionalmente uma variação aleatória de até 50% no tempo para simular comportamento humano.
- **Filtro de Grupos Mortos:** Rastreia falhas consecutivas de envio para grupos de WhatsApp. Se um grupo falhar 5 vezes seguidas (ex: se o bot foi expulso ou o grupo foi deletado), ele é excluído automaticamente de `groups.json`.
- **Embaralhador (Shuffle):** Função para embaralhar aleatoriamente a ordem de envio dos grupos de WhatsApp a cada transmissão.

#### 4. [src/rateLimit.js](file:///d:/PROBLEMA/Whatsapp-Telegram-bot/Whatsapp-Telegram-bot/Whatsapp-Telegram-Bot/src/rateLimit.js)
Contém exclusivamente os modelos de avisos de alta visibilidade.
- **Mensagem do WhatsApp:** Um texto visualmente chamativo com emojis de perigo e um tom informal direto, alertando o administrador que o limite de taxa de envio seguro foi quebrado.
- **Aviso do Terminal:** Gera um grande banner de caracteres ASCII com a inscrição `RATE LIMIT` e divisores de console destacados, impedindo que o operador do bot ignore o estouro da cota.

#### 5. [src/queue.js](file:///d:/PROBLEMA/Whatsapp-Telegram-bot/Whatsapp-Telegram-bot/Whatsapp-Telegram-Bot/src/queue.js)
Implementa e gerencia a fila sequencial de broadcasts com persistência física.
- **Função:** Garante que se você enviar várias mensagens rapidamente para o bot, elas não se encavalarão nem serão enviadas simultaneamente (evitando banimento do chip).
- **Processamento:** Executa uma tarefa por vez. Antes de iniciar, verifica se o Rate Limit foi estourado. Após a conclusão de um envio, aplica a pausa configurada no perfil de velocidade ativo (`queueDelay`) antes do próximo item.
- **Persistência da Fila:** Salva o status da fila no arquivo `media_cache/queue_state.json`. Em caso de quedas ou reinicialização do bot, os envios pendentes são carregados automaticamente e retomados após uma pausa segura de 5 segundos.

#### 6. [src/sender.js](file:///d:/PROBLEMA/Whatsapp-Telegram-bot/Whatsapp-Telegram-bot/Whatsapp-Telegram-Bot/src/sender.js)
O motor de processamento e envio de mensagens para as redes com alta resiliência.
- **Função:** Controla os envios em lotes (`sendInBatches`) com delays variáveis e simulação de status de digitação ativa (`composing`) no WhatsApp.
- **Mídia:** Carrega arquivos do cache de mídia físico (`media_cache/`). No Telegram, detecta automaticamente arquivos de vídeo e realiza a postagem usando a API nativa de vídeo (`sendVideo`).
- **Resiliência a Quedas:** Detecta se o socket do WhatsApp caiu e aborta o lote no meio para poupar dados. Distingue erros de conexão reais de falhas internas do grupo, prevenindo que grupos sejam deletados erroneamente por instabilidade de internet.
- **Integração Twitter/X:** Cria comandos CLI e inicia em segundo plano o navegador headless Puppeteer executando `twitter_browser.js`.
- **Sincronização:** Implementa a lógica que varre o WhatsApp em busca de grupos onde o bot está presente.

#### 7. [src/commands.js](file:///d:/PROBLEMA/Whatsapp-Telegram-bot/Whatsapp-Telegram-bot/Whatsapp-Telegram-Bot/src/commands.js)
Interpretador de comandos recebidos no chat privado do WhatsApp.
- **Função:** Filtra mensagens de texto que correspondam aos comandos cadastrados e executa as ações devidas (ex: checar status, mudar velocidade, iniciar sincronização, resetar, etc.). Apenas administradores autorizados têm suas mensagens processadas por este arquivo.

#### 8. [src/api.js](file:///d:/PROBLEMA/Whatsapp-Telegram-bot/Whatsapp-Telegram-bot/Whatsapp-Telegram-Bot/src/api.js)
Exposição de recursos do bot para sistemas externos.
- **Função:** Configura rotas no Express.js que permitem a automações ou painéis web enviar mensagens de broadcast (`POST /send-to-all`), ler as estatísticas de uso em JSON (`GET /status`), e realizar checagens de saúde da aplicação (`GET /health`).

---

## 🚀 Instalação e Inicialização

### Pré-requisitos
1. Ter o **Node.js** instalado (versão 18 ou superior recomendada).
2. Ter o **Git** instalado (opcional, para atualizações fáceis).

### Passo a Passo
1. Abra o terminal na pasta do projeto.
2. Instale as dependências:
   ```bash
   npm install
   ```
3. Inicialize o bot:
   ```bash
   node bot.js
   ```
4. No primeiro início, um **QR Code** será exibido no terminal. Abra o WhatsApp no seu celular, vá em **Aparelhos Conectados** > **Conectar um Aparelho** e escaneie o código.

---

## ⚙️ Configuração de Arquivos

### 1. Arquivo `.env` (Variáveis de Ambiente)
Crie um arquivo chamado `.env` na pasta raiz do projeto com a seguinte estrutura:

```env
# Token do bot do Telegram (crie com o @BotFather no Telegram)
TELEGRAM_TOKEN=123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ

# Credenciais do Twitter/X (Opcional - necessário apenas se for usar o comando /x)
TWITTER_USERNAME=usuario_twitter
TWITTER_EMAIL=email_twitter@provedor.com
TWITTER_PASSWORD=senha_twitter

# Porta onde o servidor da API irá rodar (padrão 3000)
PORT=3000
```

### 2. Arquivo `bot_admins.json` (Administradores do Bot)
Define quais números de WhatsApp podem enviar comandos ou mensagens de broadcast para o bot. O bot aceita tanto o formato de número tradicional quanto o formato **LID** (novo padrão do WhatsApp).

> [!IMPORTANT]
> Cadastre apenas números contendo DDI (país), DDD e o número de telefone, sem espaços, hifens ou o símbolo de +.

```json
{
  "admins": [
    "5511999998888",
    "5521977776666"
  ]
}
```

### 3. Banco de Dados Locais (Gerenciados Automaticamente)
Estes arquivos são atualizados de forma autônoma pelo robô, mas podem ser editados manualmente se o bot estiver desligado:
- **`groups.json`**: Lista de IDs internos de grupos do WhatsApp (`123456789-98765@g.us`) registrados para receber broadcasts.
- **`telegram_chats.json`**: Lista de IDs de canais ou grupos do Telegram registrados.
- **`session_baileys/`**: Pasta que armazena os arquivos de autenticação do WhatsApp Web (criptografia e chaves de sessão).

---

## 💬 Comandos do WhatsApp

> [!TIP]
> Todos os comandos listados abaixo funcionam apenas se forem enviados no **chat privado** com o bot. Comandos enviados dentro de grupos são ignorados por questões de segurança.

| Comando | Descrição | Exemplo de Uso |
| :--- | :--- | :--- |
| **`status`** | Mostra dados operacionais, conexões, estatísticas e o modo de velocidade ativo. | `status` |
| **`test`** ou **`teste`** | Testa a comunicação e exibe o tempo de resposta do bot em milissegundos. | `test` |
| **`fila`** ou **`queue`** | Exibe a lista de broadcasts atualmente aguardando envio na fila. | `fila` |
| **`rapido`** / **`fast`** | Altera a velocidade do bot para o modo rápido (envio em ~40 segundos). | `rapido` |
| **`meio`** / **`meiotermo`** | Altera a velocidade do bot para o modo médio (envio em ~1 minuto total). 🚨 | `meio` |
| **`lento`** / **`seguro`** | Altera a velocidade para o modo lento (envio em ~2 minutos). | `lento` |
| **`sync`** ou **`sincronizar`** | Varre o WhatsApp, localiza todos os grupos participantes e adiciona novos ao banco de dados. | `sync` |
| **`update`** ou **`atualizar`** | Verifica se existem novos commits e atualizações pendentes no Git. | `update` |
| **`/x <texto>`** | Envia a mensagem e/ou imagem para WhatsApp, Telegram e publica também no Twitter/X. | `/x Promoção do dia!` |
| **`reset`** | Deleta a pasta de sessão local e reinicia o robô para forçar uma nova leitura de QR Code. | `reset` |
| **`help`** ou **`ajuda`** | Exibe uma lista de instruções de ajuda direto no WhatsApp. | `help` |

---

## ⚡ Modos de Velocidade (Rápido vs Lento)

Você pode alternar dinamicamente entre duas velocidades de envio do WhatsApp dependendo do teor do seu anúncio e urgência.

### Comparativo Técnico de Perfis

| Característica | 🚀 Modo Rápido (`rapido`) | ⚖️ Modo Meio Termo (`meio`) | 🐢 Modo Lento (`lento`) |
| :--- | :--- | :--- | :--- |
| **Tempo total estimado** | **~40 segundos** (para 13 grupos) | **~1 minuto** (para 13 grupos) | **~2 minutos** (para 13 grupos) |
| **Delay entre envios** | **Dinâmico** (mínimo de 0.5s) | **Dinâmico** (mínimo de 0.5s) | **Fixo** de 8 segundos |
| **Simulação de digitação** | Curta e ágil (0.5s) | Moderada (1.0s a 2.0s) | Humana e variada (1.5s a 3.5s) |
| **Intervalo na fila (Queue)** | 5 segundos | 10 segundos | 15 segundos |
| **Jitter (Variação aleatória)**| Não aplicável (prioridade tempo de 40s)| Não aplicável (prioridade tempo de 60s)| Ativo (adiciona até +50% de delay aleatório) |
| **Nível de segurança** | Moderado (focado em velocidade) | Intermediário (⚠️ "PERIGOSO CAOLHO") | Máximo (altamente seguro contra bloqueios) |

### Entendendo a Matemática do Modo Rápido e Meio Termo
No modo rápido e no meio termo, caso você tenha mais de 1 grupo cadastrado, o bot recalcula automaticamente o delay de lote para tentar aproximar o tempo total de transmissão a exatamente **40 segundos** (modo rápido) ou **60 segundos** (modo meio termo), independentemente da quantidade de grupos. A fórmula inteligente utilizada é:

$$\text{Delay Dinâmico} = \max\left(500\text{ms},\ \frac{40000\text{ms}}{\text{Total de Grupos}} - \text{Tempo de Digitação}\right)$$

Isso significa que se você tiver 13 grupos, o delay dinâmico de lote se ajustará para aproximadamente **2.5 segundos** por grupo, garantindo rapidez com uma pequena margem de respiro seguro.

---

## 🚨 Controle de Rate Limit (Limite de Taxa)

Para evitar que a conta do WhatsApp seja classificada como spammer pelos servidores do aplicativo, o sistema implementa políticas estritas de Rate Limit.

- **Limite por Hora:** Máximo de **8 transmissões (broadcasts) completas por hora**.
- **Cooldown entre Envios:** Intervalo mínimo obrigatório de **120 segundos (2 minutos)** entre o término de um envio e o início do próximo.

> [!WARNING]
> **COMPORTAMENTO DE EXCEÇÃO:** Se os limites descritos forem ultrapassados, **o bot NÃO travará os envios**. Ele continuará a transmissão para garantir a entrega das suas campanhas. 
> No entanto, ele disparará um **alerta severo de alta visibilidade** no terminal do console (via banner ASCII) e enviará uma mensagem de aviso explícita no WhatsApp do administrador.
> **O envio prosseguirá por sua inteira conta e risco! O perigo de banimento do chip do WhatsApp é extremamente alto nesses casos.**

---

## 💾 Armazenamento de Mídia e Fila Persistente

Para lidar com transmissões massivas de mídias de forma leve e segura, o sistema adota um gerenciamento baseado em disco.

### 1. Sistema de Cache de Mídias (`media_cache/`)
Em vez de reter grandes buffers de imagem ou vídeo na memória RAM durante o tempo de espera na fila:
- **Download Instantâneo:** Ao receber uma imagem ou vídeo para broadcast do administrador, o bot baixa a mídia **no ato** e a salva na pasta física `./media_cache/`.
- **Nomes com Hash:** Os arquivos são gravados de forma segura usando nomes contendo UUIDs/hashes gerados com a biblioteca `crypto` para evitar sobreposições.
- **Limpeza de Arquivos Órfãos:** Durante o arranque, o bot executa a função de limpeza interna (`cleanOrphanedCache`), removendo automaticamente qualquer arquivo de cache órfão na pasta `./media_cache/` que não pertença a um trabalho ativo da fila.

### 2. Persistência de Fila em Disco
Toda a fila de envios pendentes é escrita no arquivo `./media_cache/queue_state.json`.
- **Resistência a Quedas:** Caso o bot seja desligado, encerre de forma abrupta ou o servidor reinicie, nenhuma mensagem agendada será perdida.
- **Carregamento Automático:** Ao religar o bot, ele verifica a integridade dos itens na fila salvos no JSON, valida se os arquivos de mídia correspondentes continuam existindo no disco e retoma a rotina de disparos após um atraso seguro de 5 segundos.
- **Capacidade Ilimitada:** Como as mensagens estão apenas indexadas em formato texto leve na fila do JSON e suas mídias pesadas salvas fisicamente em disco, o bot suporta filas de tamanho virtualmente infinito sem esgotamento de memória.

---

## 🛡️ Segurança e Prevenção de Ban (Anti-Ban)

O WhatsApp possui algoritmos robustos de detecção de automação. Este bot implementa várias técnicas para camuflar o disparo e proteger seu chip:

1. **Embaralhamento de Grupos:** Antes de cada envio, a lista de grupos cadastrados é embaralhada de forma aleatória. Os envios nunca seguem a mesma sequência, quebrando padrões previsíveis de robôs.
2. **Simulação Realista de Digitação:** O bot envia o evento `composing` (exibindo a frase *"Digitando..."* no topo do chat do grupo) por alguns segundos antes de efetivamente disparar a mensagem.
3. **Pausas com Jitter:** Os atrasos contam com um fator de variação aleatório de até 50% para cima. Um delay configurado para 8s pode durar 8.4s, 9.8s ou 11.5s na prática, imitando a irregularidade humana.
4. **Sem Status Online na Conexão (`markOnlineOnConnect: false`):** O bot não se autodeclara explicitamente "Online" toda vez que se conecta ao socket.
5. **Autopurga de Grupos Mortos Inteligente:** Tentar enviar repetidamente para grupos de onde o bot foi removido gera erros suspeitos nos servidores do WhatsApp. O bot autodeleta o grupo da lista `groups.json` após 5 falhas consecutivas.
6. **Detecção e Resiliência de Rede:** Falhas temporárias de conexão (erros como `Connection Closed`, timeout ou `Stream Errored`) **não são** computadas como falhas de grupo. Isso impede o esvaziamento acidental do banco de dados `groups.json` quando houver oscilações ou quedas na internet do servidor.
7. **Verificação de Saúde da Conexão:** Antes de cada lote de envios no WhatsApp, o bot checa se o socket da conexão ainda está ativo. Caso detecte uma desconexão no meio do broadcast, ele aborta a execução do lote de forma limpa sem perder dados, preservando a fila para envio posterior.

---

## 🔧 Solução de Problemas (FAQ & Workarounds)

Aqui está a lista dos problemas mais comuns que você pode encontrar ao rodar o bot e como resolvê-los de forma prática.

### 1. Erro: `Cannot find module ...` ou `MODULE_NOT_FOUND`
- **Sintoma:** O bot fecha imediatamente após tentar iniciar pelo terminal, exibindo um erro de dependência ausente.
- **Causa:** O código foi atualizado via git/painel, mas novos pacotes npm foram adicionados à arquitetura e ainda não foram baixados.
- **Workaround:**
  1. Feche a janela atual do terminal.
  2. Abra o terminal na pasta raiz do bot.
  3. Execute o comando:
     ```bash
     npm install
     ```
  4. Inicie o bot novamente: `node bot.js`.

### 2. Mensagem de erro `403` ou `Conta Restringida` no terminal
- **Sintoma:** A conexão cai e o terminal exibe o erro status `403` em loop.
- **Causa:** O número de telefone foi marcado temporariamente pelos servidores do WhatsApp ou sofreu restrições.
- **Workaround:**
  - O bot possui um mecanismo automático de **backoff exponencial** para erros 403. Ele tentará reconectar de forma espaçada (dobrando o tempo de espera a cada falha, até o limite de 5 minutos) por até 10 vezes. 
  - Se a reconexão automática falhar após as 10 tentativas, é muito provável que seu chip tenha sido banido permanentemente. Nesse caso, você precisará limpar a sessão (`reset`) e escanear o QR Code de um novo chip.

### 3. QR Code não carrega, falha ao escanear ou erros frequentes de criptografia (`Bad MAC` / `Decryption Failed`)
- **Sintoma:** O terminal gera um QR Code desconfigurado, ou exibe repetidamente erros de descriptografia de mensagens em loop (`Bad MAC`, `Decryption failed` ou similar), impossibilitando o envio.
- **Causa:** Travamento na sessão local temporária, expiração das chaves de pareamento ou corrupção na criptografia da pasta de autenticação do Baileys.
- **Workaround:**
  1. Pressione `Ctrl + C` no terminal para parar a execução do bot.
  2. Envie o comando `reset` no privado do bot (se ele ainda estiver respondendo).
  3. Se não responder, delete manualmente a pasta `session_baileys` localizada na raiz do bot.
  4. Rode o comando `node bot.js` no terminal para iniciar uma sessão totalmente limpa.
  5. Escaneie o novo QR Code gerado no terminal com o WhatsApp do seu celular.

### 4. O bot não responde aos meus comandos no WhatsApp
- **Sintoma:** Você digita `status` ou `help` e o bot visualiza mas não responde nada.
- **Causa:** O número de telefone do qual você está enviando os comandos não está cadastrado ou está no formato incorreto em `bot_admins.json`, ou você está tentando enviar em um grupo.
- **Workaround:**
  1. Abra o arquivo `bot_admins.json` na pasta do bot.
  2. Verifique se o seu número está inserido com o DDI (55 para Brasil) e DDD corretos. Exemplo: `"5511999998888"`. Não coloque hifens, parênteses ou o sinal de mais `+`.
  3. Se seu número foi migrado para o protocolo **LID** pelo WhatsApp, o terminal exibirá a mensagem `⛔ Comando não autorizado de: [número_lid]`. Copie esse ID mostrado no terminal do servidor e adicione-o diretamente à lista de admins em `bot_admins.json`.
  4. Lembre-se de enviar comandos sempre em **conversa privada** com o bot.

### 5. Falhas ou travamentos ao enviar posts para o Twitter/X
- **Sintoma:** O envio via `/x` gera erro ou trava no terminal exibindo logs relacionados ao Puppeteer.
- **Causa:** Credenciais erradas no `.env`, a conta do Twitter ativou autenticação de dois fatores (2FA), ou o navegador oculto foi bloqueado por testes de robôs.
- **Workaround:**
  1. Abra o arquivo `.env` e confirme se `TWITTER_USERNAME`, `TWITTER_EMAIL` e `TWITTER_PASSWORD` estão corretos.
  2. Desative temporariamente a autenticação de dois fatores da sua conta do Twitter, pois o script automatizado não consegue ler códigos SMS ou de aplicativos autenticadores sem interação manual.
  3. Tente rodar manualmente o teste do Twitter no terminal para ver onde ele falha:
     ```bash
     node twitter_browser.js --text "Teste de conexao"
     ```

### 6. Grupos do WhatsApp cadastrados não recebem as mensagens
- **Sintoma:** O bot envia o broadcast, diz que concluiu com sucesso, mas o conteúdo não aparece em determinados grupos.
- **Causa:** O bot pode ter sido removido dos grupos ou a lista local `groups.json` está desatualizada.
- **Workaround:**
  1. Envie o comando privado `sync` (ou `sincronizar`) para forçar o bot a mapear todos os grupos ativos atuais e salvar no banco de dados.
  2. Se o bot foi banido de um grupo específico e você não percebeu, o sistema de **Autopurga** removerá o ID desse grupo automaticamente de `groups.json` após 5 tentativas falhas seguidas, garantindo que o bot não trave nos próximos broadcasts.

### 7. O bot do Telegram não envia as mensagens
- **Sintoma:** O broadcast funciona no WhatsApp, mas não chega nos chats do Telegram.
- **Causa:** Token do Telegram inválido no `.env`, chat ID não registrado ou bot sem permissões de escrita no canal/grupo do Telegram.
- **Workaround:**
  1. Certifique-se de que a variável `TELEGRAM_TOKEN` no `.env` está configurada corretamente.
  2. Certifique-se de que o bot do Telegram foi adicionado ao canal ou grupo como **Administrador** e que possui permissão para enviar mensagens de texto e mídia.
  3. Mande qualquer mensagem no privado do bot do Telegram ou adicione-o ao grupo e envie algo para que ele registre o ID do chat automaticamente no banco `telegram_chats.json`.

---

## 📞 Suporte e Documentação Complementar

- **Histórico e Logs:** Verifique logs detalhados de erros em tempo real no arquivo [bot.log](file:///d:/PROBLEMA/Whatsapp-Telegram-bot/Whatsapp-Telegram-bot/Whatsapp-Telegram-Bot/logs/bot.log).
- **Guia do Desenvolvedor:** Consulte o arquivo [AGENTS.md](file:///d:/PROBLEMA/Whatsapp-Telegram-bot/Whatsapp-Telegram-bot/Whatsapp-Telegram-Bot/AGENTS.md) para diretrizes de desenvolvimento, testes Jest e padrões de Pull Request.

**Versão da Biblioteca:** Baileys Oficial (`@whiskeysockets/baileys`)  
**Última Atualização:** Junho de 2026
