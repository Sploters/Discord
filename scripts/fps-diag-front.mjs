import { execFileSync } from 'node:child_process';
import path from 'node:path';
// força a janela da animação a ficar no topo; lança erro se não achar
export function animToFront() {
  const out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('scripts/fps-diag-front.ps1')], { encoding: 'utf8' }).trim();
  if (!out.endsWith('OK')) throw new Error('janela da animação não encontrada: ' + out);
}
