# Aba Descobrir (Home → Descobrir)

Notícias de jogos, promoções e próximos lançamentos, mais um feed **Para você** com o que combina com os interesses de
cada pessoa (jogos e assuntos que ela escolhe; salvos na conta).

- **O servidor busca as fontes** (`server/discover.js`) e guarda por um tempo (notícias 20 min, Steam 30 min, Epic 1 h,
  detalhes de lançamento 12 h). Se uma fonte cair, continua mostrando o último resultado bom e avisa qual falhou.
- **Notícias:** só título, um resumo curto, imagem e o link para ler no site original.
- **Promoções:** jogos grátis da Epic (da semana e os próximos) e promoções da Steam, em reais.
- **Lançamentos:** "Em breve" da Steam, com data e gêneros.

## Configurar as fontes
Arquivo `discover.json` na pasta de dados do servidor (no Umbrel: `~/localcord-data/discover.json`). Vale na hora.
```json
{
  "news": [
    { "name": "Meu site de jogos", "url": "https://exemplo.com/feed/", "lang": "pt" }
  ],
  "steam": true,
  "epic": true,
  "country": "BR"
}
```
- `news`: qualquer feed RSS ou Atom. Sem o arquivo, valem as fontes padrão do `server/discover.js` (Adrenaline,
  MeuPlayStation, GameBlast, PC Gamer, GameSpot, Polygon). Confira se elas respondem do seu servidor: as que
  falharem aparecem no log ("Descobrir: … falhou") e no aviso da aba.
- `steam` / `epic`: `false` desliga cada loja. `country`: país das lojas (preços e disponibilidade).
- `DISCOVER_OFF=1` desliga a aba inteira no servidor.

Teste: `node scripts/discover-test.mjs` (fontes falsas locais, com jogos e notícias fictícios).
