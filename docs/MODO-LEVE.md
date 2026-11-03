# Modo leve

Data: 2026-11-03. Um botão em **Configurações → Modo leve** (primeiro item de "Configurações do aplicativo"; também aparece buscando "desempenho", "fps", "jogo", "otimizar") para o LocalCord pesar o mínimo possível no computador, pensado para quem joga com o app aberto e não entende de otimização.

## O que o botão muda
| Item | Valor leve | Por quê |
|---|---|---|
| `animations` | desligado | sem transições de canal, janelas e mensagens |
| `animMode` | `never` | GIFs/WebP animados de avatar e banner ficam parados (decodificação contínua) |
| `noiseMode` | `standard` (só se estiver em `rnnoise`/`gtcrn`) | troca a redução de ruído por IA (WASM) pela do navegador. Eco e ganho automático ficam: são nativos, quase sem custo, e evitam eco na chamada |
| `clipsOn` | `false` | para o buffer de 60 s que gravava em segundo plano as transmissões assistidas |
| `screen` | 720p • 30 fps (só se estiver acima) | valor inicial ao transmitir; pode ser mudado na hora |
| economia em segundo plano (desktop ≥ 1.0.14) | ligada fora de chamada | `webContents.setBackgroundThrottling(true)` com a janela escondida |

Itens que já estavam no valor leve não são tocados (a página mostra "já estava assim").

Do procedimento original do Discord, ficaram de fora de propósito: **sobreposição no jogo, telemetria e prioridade do processo** (o LocalCord não tem nada disso; a página diz isso em "O que já vem leve no LocalCord") e **aceleração de hardware**, que fica como opção separada com aviso: no LocalCord ela joga interface e vídeo para a CPU e costuma pesar mais.

## Regras de estado
- **Local à máquina.** `lightMode` e `lightPrev` estão em `DEVICE_KEYS` (não vão para a conta). Ao sincronizar, `unlite` envia para a conta os valores de antes no lugar dos valores leves, então o celular e outros PCs não herdam o modo leve.
- **Persiste ao recarregar.** Fica em `localStorage`; ao puxar a conta, `relite` atualiza o "antes" com o valor da conta e reaplica o valor leve.
- **Desfazer exato.** `lightPrev = { prev, applied }`. Ao desligar, só volta o que continua igual ao que o modo leve aplicou; o que a pessoa mudou à mão fica como ela deixou (também depois de recarregar: item mudado à mão sai do controle do modo leve).
- **Microfone.** Se estiver em chamada e o modo de ruído mudar, usa `voice.rebuildMic()` (mesmo caminho do menu de ruído): mantém dispositivo, volume, eco, ganho e porta de ruído; troca a faixa sem reconectar.
- **Clipes.** `stopAllBuffers()` para só o gravador e a cópia (clone) da faixa de vídeo; a transmissão e a reprodução continuam.
- **Economia do desktop.** O renderer decide (`syncThrottle`): ligada só com modo leve **e** fora de chamada; reavaliada a cada atualização de voz e na inicialização. Em chamada (o que inclui transmitir, assistir e tocar o soundboard) fica sempre suspensa. O gateway não cai com a página desacelerada: o servidor usa ping/pong do protocolo WebSocket, respondido pelo navegador sem timers de JS. Reconexões e o relógio da chamada podem atrasar enquanto a janela está escondida; voltam ao normal ao mostrar a janela.

## Desktop 1.0.14
A economia em segundo plano precisa do app desktop **1.0.14** (`desktop/main.js` ganhou o IPC `set-throttle`, `preload.js` expõe `lcDesktop.setThrottle`). Em versões anteriores do app o resto do modo leve funciona normalmente; só a economia em segundo plano não existe (o renderer verifica `desktop.setThrottle` antes de usar).

Build: `cd desktop && npm ci && npm run dist` gera `dist/LocalCord-Setup-1.0.14.exe` e `dist/LocalCord-Portable-1.0.14.exe`. O 7-Zip do electron-builder falha em caminhos com acento (ex.: `JoãoSantos`): rode o build a partir de uma cópia da pasta `desktop` num caminho só com ASCII. **A versão não foi publicada**: a atualização automática só a oferece depois de criada a release `v1.0.14` no GitHub com o instalador anexado.

### Como testar a economia (manual)
1. Instale o 1.0.14 e entre no servidor. Ligue o **Modo leve**.
2. Abra o Gerenciador de Tarefas → aba Detalhes e deixe visível a coluna CPU dos processos `LocalCord.exe`.
3. Fora de chamada, minimize o LocalCord para a bandeja e espere ~1 min: a CPU do processo do renderer deve cair (timers da página passam a rodar no máximo 1×/s, depois de 5 min 1×/min). Mensagens e notificações continuam chegando (são eventos do WebSocket, não timers).
4. Entre numa sala de voz e minimize de novo: voz, indicador de quem fala e push-to-talk global continuam normais (a economia é suspensa em chamada).
5. Saia da chamada com a janela minimizada: a economia volta sozinha.
6. Desligue o Modo leve: a página volta a rodar sem desaceleração mesmo escondida (comportamento anterior).

## Testes
`node scripts/lite-test.mjs` (Edge headless, servidor próprio na porta 3224): aplicar e desfazer, alteração manual preservada (inclusive após recarregar), conta guardando valores normais, persistência ao recarregar, economia do desktop (ponte `lcDesktop` simulada) ligada fora de chamada, suspensa em chamada, religada ao sair e na inicialização, microfone da chamada com redução leve e sem erro, e clipes desligados sem encerrar a faixa da transmissão.

Falhas preexistentes, iguais com e sem o modo leve (não corrigidas nesta tarefa): `ui-test.mjs` 4 falhas (vídeo da tela no bob, resolução da transmissão, soundboard para a outra pessoa e exceção `reading 'click'` no fim) e `extras-test.mjs` 2 falhas (volume por pessoa no menu de saída; botões do topo da sala de voz). `features-test.mjs` passa (precisa de servidor em `BASE`, padrão porta 3000).

## Futuro (não feito)
Uma indicação discreta de que o modo leve está ativo (em Configurações ou no menu do app), sem notificações constantes nem painel de métricas.
