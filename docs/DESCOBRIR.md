# Aba Descobrir (Home → Descobrir)

Notícias de jogos, promoções, próximos lançamentos e torneios abertos, mais um feed **Para você** com o que combina com os interesses de
cada pessoa (jogos e assuntos que ela escolhe; salvos na conta).

- **O servidor busca as fontes** (`server/discover.js`) e guarda por um tempo (notícias 20 min, Steam 30 min, Epic 1 h,
  detalhes de lançamento 12 h). Se uma fonte cair, continua mostrando o último resultado bom e avisa qual falhou.
- **Notícias:** só título, um resumo curto, imagem e o link para ler no site original.
- **Promoções:** jogos grátis da Epic (da semana e os próximos) e promoções da Steam, em reais.
- **Lançamentos:** "Em breve" da Steam, com data e gêneros.
- **Torneios:** os próximos torneios abertos do **Challengermode** (feed público oficial,
  `challengermode.com/xml/feed/tournaments`, atualizado a cada 15 min), separados em Hoje / Próximos 7 dias / Mais
  adiante, com filtro por jogo e "Com prêmio". A imagem de cada torneio vem da página dele (só o começo da página, 3
  por vez, guardada por 1 dia). Torneios que já passaram e os de teste ficam de fora.
  **GamersClub** e **Battlefy** aparecem como atalhos: não oferecem a lista de torneios para outros apps (a Battlefy
  responde "Direct API access is not permitted" e a GamersClub só tem a API interna do próprio site), então o LocalCord
  não puxa dados deles. No "Para você", torneios dos jogos escolhidos aparecem em "Torneios dos seus jogos".

## Configurar as fontes
Arquivo `discover.json` na pasta de dados do servidor (no Umbrel: `~/localcord-data/discover.json`). Vale na hora.
```json
{
  "news": [
    { "name": "Meu site de jogos", "url": "https://exemplo.com/feed/", "lang": "pt" }
  ],
  "steam": true,
  "epic": true,
  "country": "BR",
  "tournaments": true
}
```
- `news`: qualquer feed RSS ou Atom. Sem o arquivo, valem as fontes padrão do `server/discover.js` (Adrenaline,
  MeuPlayStation, GameBlast, PC Gamer, GameSpot, Polygon). Confira se elas respondem do seu servidor: as que
  falharem aparecem no log ("Descobrir: … falhou") e no aviso da aba.
- `steam` / `epic`: `false` desliga cada loja. `country`: país das lojas (preços e disponibilidade).
- `tournaments`: `false` desliga os torneios do Challengermode (os atalhos continuam). `cmImages: false` não busca
  as imagens dos torneios.
- `DISCOVER_OFF=1` desliga a aba inteira no servidor.

Teste: `node scripts/discover-test.mjs` (fontes falsas locais, com jogos e notícias fictícios).
