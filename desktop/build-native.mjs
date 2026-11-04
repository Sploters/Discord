// Prepara desktop/native/lc-input.exe (controle remoto) e desktop/native/lc-stream.exe (transmissão a 120 FPS) antes do electron-builder.
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
const out2 = 'native/lc-stream.exe';
if (cargo && process.platform === 'win32') {
  execSync('cargo build --release', { cwd: '../native/lc-stream', stdio: 'inherit' });
  fs.copyFileSync('../native/lc-stream/target/release/lc-stream.exe', out2);
  console.log('lc-stream.exe compilado');
} else if (fs.existsSync(out2)) console.log('usando o lc-stream.exe incluído (Rust não encontrado)');
else { console.error('Falta desktop/native/lc-stream.exe e não há Rust para compilar (cargo build --release --target x86_64-pc-windows-gnu em native/lc-stream).'); process.exit(1); }
