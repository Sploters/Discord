# Auditoria de desempenho (2026-11-04)

Medido com `node scripts/perf-audit.mjs <rótulo>` (Chromium sem placa de vídeo, 3 rodadas, mediana; abertura com a rede
de uma VPN simulada: 40 ms de ida e volta, 20 Mbps). CPU = tempo de tarefas na thread principal da página por segundo.

| Medida | Antes | Depois |
|---|---|---|
| Abrir o app (primeira vez) | 752 ms, 764 KB | **572 ms, 244 KB** |
| Abrir de novo (com cache) | 520 ms (47 consultas ao servidor) | **144 ms** (nenhuma consulta de módulo) |
| Processamento na abertura | 135 ms | 121 ms |
| Parado no chat (150 mensagens) | 0,1% CPU | 0,1% |
| Call com 3 pessoas | 4,6% CPU, 29 mudanças na página/s | 4,2%, **15 mudanças/s** |
| Assistindo transmissão | 8,0% | 9,2% (dentro da variação entre rodadas: 6–11%) |
| Transmitindo | 5,7% | 3,5% |
| Servidor (call / transmissão) | 1,9% / 2,6% CPU, ~117 MB | igual |

## O que foi corrigido
1. **Entrega da interface** (`server/static.js`): arquivos comprimidos (brotli/gzip, guardados em memória), endereço
   com a versão do servidor (`?v=<hash de todos os arquivos>`) e cache "imutável" de 1 ano para módulos e CSS; a página
   já lista todos os módulos (`modulepreload`) para o navegador baixar em paralelo. A página em si sempre revalida, então
   um deploy troca a versão e todo mundo baixa a nova. `STATIC_OFF=1` volta ao modo antigo (emergência).
2. **Vazamentos de memória** — telas fechadas que continuavam presas na memória por ouvintes de eventos globais:
   configurações (cada abertura deixava ~430 elementos e ~90 ouvintes), soundboard (painel e páginas das configurações),
   player da galeria de clipes e gráfico de ping. Novo `whenGone(el, fn)` (`util.js`) solta os ouvintes quando a tela sai.
   Abrir e fechar 20x agora não acumula nada.
3. **Microfones "zumbis" ao trocar o filtro de ruído** (relatado em uso): trocas rápidas deixavam montagens antigas do
   microfone ligadas — cada uma com a IA de ruído processando — o que acumulava atraso no áudio; uma delas ficava ligada até
   depois de sair da call. Agora as trocas são uma de cada vez (cliques seguidos se juntam), a montagem que ficou velha é
   desligada, e clicar no filtro já ativo não faz nada. Vale para o painel da call, o menu do botão de microfone e o teste
   das configurações (`scripts/mic-rebuild-test.mjs`).
4. **Ping medido a cada fala**: cada vez que alguém começava/parava de falar, o app fazia uma medição de ping extra
   (mensagem ao servidor + estatísticas). Agora só a medição normal de 1 s. O selo de ping/qualidade só é redesenhado quando
   o valor muda (antes 5x por segundo).
5. **Índice `messages(created_at)`**: "GIFs do grupo" com 200 mil mensagens: 15 ms -> 7 ms.

## O que foi verificado e está bem
- Sem vazamento numa call de 60 s nem trocando de canal 40x (elementos, ouvintes e memória estáveis).
- Parado no chat o app praticamente não usa CPU; o servidor ocioso usa ~0,5%.
- Timers fixos: poucos e leves (ping 1 s, qualidade da voz 3 s, relógios da call 1 s).
- Não valeu a pena carregar módulos sob demanda: com compressão e cache, o ganho seria de poucos ms.
