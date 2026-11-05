#!/bin/sh
# Monta o pacote "teste-fps-resenha.zip" para quem não tem Rust: compila o Spike A para Windows a partir do Linux
# (precisa de: rustup target add x86_64-pc-windows-gnu e o gcc-mingw-w64-x86-64) e junta exe + animação + script.
set -e
cd "$(dirname "$0")/.."
cargo build --release --target x86_64-pc-windows-gnu
OUT=${1:-/tmp/teste-fps-resenha}; rm -rf "$OUT"; mkdir -p "$OUT"
cp target/x86_64-pc-windows-gnu/release/wgc-capture-spike.exe "$OUT/captura.exe"
cp ../../scripts/fps-diag-anim.html "$OUT/animacao.html"
cp pacote/testar.ps1 pacote/LEIA-ME.txt "pacote/TESTAR (clique duas vezes).bat" "$OUT/"
(cd "$(dirname "$OUT")" && rm -f "$(basename "$OUT").zip" && python3 -c "import shutil,sys; shutil.make_archive(sys.argv[1],'zip','.',sys.argv[1])" "$(basename "$OUT")")
echo "pacote: $OUT.zip"
