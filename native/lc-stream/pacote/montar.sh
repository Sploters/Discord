#!/bin/sh
# Monta "teste-120fps-resenha.zip": compila para Windows a partir do Linux
# (precisa de: rustup target add x86_64-pc-windows-gnu e o gcc-mingw-w64-x86-64) e junta exe + animação + script.
set -e
cd "$(dirname "$0")/.."
cargo build --release --target x86_64-pc-windows-gnu
OUT=${1:-/tmp/teste-120fps-resenha}; rm -rf "$OUT"; mkdir -p "$OUT"
cp target/x86_64-pc-windows-gnu/release/lc-stream.exe "$OUT/transmitir.exe"
cp ../../scripts/fps-diag-anim.html "$OUT/animacao.html"
for f in testar.ps1 LEIA-ME.txt "TESTAR (clique duas vezes).bat"; do sed 's/\r*$/\r/' "pacote/$f" > "$OUT/$f"; done
(cd "$(dirname "$OUT")" && rm -f "$(basename "$OUT").zip" && python3 -c "import shutil,sys; shutil.make_archive(sys.argv[1],'zip','.',sys.argv[1])" "$(basename "$OUT")")
echo "pacote: $OUT.zip"
