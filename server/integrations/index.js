// Registro de integrações com plataformas de jogos. O resto do LocalCord só enxerga este contrato e snapshots normalizados;
// cada plataforma vive em seu próprio arquivo (hoje só a Steam).
//
// Adaptador: {
//   id, name, capabilities: ['link','presence', ...],
//   configured(): boolean                       // tem o que precisa (ex.: chave) para consultar a API?
//   startLink({ returnTo, realm }): string      // URL oficial de login da plataforma
//   finishLink(query, { returnTo }): Promise<{ external_id }>   // valida o retorno; lança Error se inválido
//   poll(externalIds): Promise<Map<external_id, Snapshot>>      // lote; lança PollError(status) em falha
// }
// Snapshot: { name, avatar, profileUrl, state: 'online'|'offline'|'away'|'busy'|'unknown', visibility: 'public'|'private', game: { id, title } | null }
import steam from './steam.js';

const adapters = new Map([steam].map(a => [a.id, a]));
export const getAdapter = (id) => adapters.get(id) || null;
export const listAdapters = () => [...adapters.values()];

export { PollError } from './errors.js';
