// Verificação rápida de sintaxe (node --check) de todo o JS do servidor, cliente, desktop e scripts. Uso: npm run check
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const roots = ['server', 'public', 'desktop', 'scripts'], skip = /node_modules|vendor|dist/;
const files = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (skip.test(p)) continue; if (e.isDirectory()) walk(p); else if (/\.(m?js)$/.test(e.name)) files.push(p); } };
roots.forEach(walk);
let bad = 0;
for (const f of files) {
  // public/ e .mjs são módulos ES; o resto do desktop é CommonJS
  const esm = f.endsWith('.mjs') || f.startsWith('public') || f.startsWith('server');
  try { execFileSync(process.execPath, [...(esm ? ['--input-type=module'] : []), '--check', ...(esm ? [] : [f])], esm ? { input: fs.readFileSync(f), stdio: ['pipe', 'pipe', 'pipe'] } : { stdio: 'pipe' }); }
  catch (e) { bad++; console.log('ERRO', f, '\n' + String(e.stderr || e.message).trim().split('\n').slice(0, 6).join('\n')); }
}
console.log(bad ? `\n${bad} arquivo(s) com erro de sintaxe` : `${files.length} arquivos ok`);
process.exit(bad ? 1 : 0);
