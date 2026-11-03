// Prepara desktop/native/lc-input.exe (programa nativo do controle remoto) antes do electron-builder.
// Com Rust instalado, compila native/lc-input; sem Rust, usa o executável já incluído no repositório
// (gerado por: cargo build --release --target x86_64-pc-windows-gnu, ver docs/FASE3-REMOTE.md).
import { execSync } from 'node:child_process';
import fs from 'node:fs';
const out = 'native/lc-input.exe';
let cargo = false; try { execSync('cargo --version', { stdio: 'ignore' }); cargo = true; } catch { }
if (cargo && process.platform === 'win32') {
  execSync('cargo build --release', { cwd: '../native/lc-input', stdio: 'inherit' });
  fs.mkdirSync('native', { recursive: true }); fs.copyFileSync('../native/lc-input/target/release/lc-input.exe', out);
  console.log('lc-input.exe compilado');
} else if (fs.existsSync(out)) console.log('usando o lc-input.exe incluído (Rust não encontrado)');
else { console.error('Falta desktop/native/lc-input.exe e não há Rust para compilar. Veja docs/FASE3-REMOTE.md.'); process.exit(1); }
