// Lojas e launchers (Riot Client, Steam, Epic Games, Battle.net, EA app…) não são jogos: o app desktop não deve
// publicar "Jogando Riot Client". O app novo já não detecta; aqui o servidor barra o que vier de apps antigos e
// esconde o que ficou registrado antes.
// Compara pelo id (nome do executável) e pelo nome mostrado, sem acentos, maiúsculas, espaços e pontuação.
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// executáveis (sem .exe)
const EXES = [
  'riot client', 'riotclient', 'riotclientservices', 'riotclientux', 'riotclientuxrender', 'riotclientcrashhandler',
  'steam', 'steamwebhelper', 'steamservice', 'steamerrorreporter',
  'epicgameslauncher', 'epicwebhelper', 'epiconlineservices', 'epiconlineserviceshost', 'epiconlineservicesuserhelper',
  'battle.net', 'battle.net launcher', 'agent', 'blizzard', 'blizzard battle.net',
  'eadesktop', 'eabackgroundservice', 'ealauncher', 'ea app', 'origin', 'originwebhelperservice', 'originclientservice',
  'ubisoftconnect', 'upc', 'uplay', 'uplaywebcore', 'ubisoftgamelauncher', 'ubisoftgamelauncher64',
  'galaxyclient', 'galaxyclient helper', 'goggalaxy',
  'rockstarlauncher', 'rockstar games launcher', 'socialclubhelper', 'playgtav',
  'xboxpcapp', 'xboxapp', 'gamingservices', 'gamebar', 'xboxgamebar',
  'amazongames', 'amazon games', 'amazon games ui', 'itch', 'playnite.desktopapp', 'playnite.fullscreenapp',
  'overwolf', 'curseforge', 'minecraftlauncher', 'minecraft launcher', 'hoyoplay', 'launcher', 'bsglauncher',
  'heroic', 'legendary', 'parsecd', 'nvidia app', 'geforce experience', 'nvidia share',
];
// nomes que aparecem como título da janela
const TITLES = [
  'Riot Client', 'Steam', 'Epic Games Launcher', 'Epic Games', 'Battle.net', 'Blizzard Battle.net', 'EA', 'EA app', 'Origin',
  'Ubisoft Connect', 'Uplay', 'GOG Galaxy', 'GOG GALAXY', 'Rockstar Games Launcher', 'Xbox', 'Amazon Games', 'itch', 'Playnite',
  'Overwolf', 'CurseForge', 'Minecraft Launcher', 'HoYoPlay', 'Battlestate Games Launcher', 'Heroic Games Launcher',
  'NVIDIA App', 'GeForce Experience',
];
const BAD = new Set([...EXES, ...TITLES].map(norm));

// game = { id, title } (ou id e title soltos)
export const isLauncher = (game) => !!game && (BAD.has(norm(game.id)) || BAD.has(norm(game.title)));
