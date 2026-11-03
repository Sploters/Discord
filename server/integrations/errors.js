// Falha ao consultar uma plataforma. status: código HTTP (0 = rede/tempo esgotado). 401/403 = credencial inválida (não adianta repetir).
export class PollError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; }
}
