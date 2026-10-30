#!/bin/bash
# Arma el sitio publicable de INOFER (GitHub Pages) y el INOFER.jar con auto-actualización.
# Uso: fuente/publicar.sh            (publica en la raiz del repositorio)
set -e
URL="${1:-https://inofer-admin.github.io/INOFER/inofer/}"; OUT="${2:-$(cd "$(dirname "$0")/.." && pwd)}"; VWEB="$3"
SRC="$(cd "$(dirname "$0")" && pwd)"


# Versión de las pantallas: AAAA.MM.DD.NN (si no se indica, sube el número del día)
PAG="$SRC/web/00_pagina.html"
ACT=$(grep -o 'name="inofer-version" content="[^"]*"' $PAG | sed 's/.*content="//; s/"//')
if [ -z "$VWEB" ]; then
  HOY=$(TZ=America/Buenos_Aires date +%Y.%m.%d)
  if [[ "$ACT" == "$HOY".* ]]; then N=$((10#${ACT##*.} + 1)); else N=1; fi
  VWEB="$HOY.$(printf %02d $N)"
fi
sed -i "s/name=\"inofer-version\" content=\"[^\"]*\"/name=\"inofer-version\" content=\"$VWEB\"/" $PAG

# Armar la pantalla desde las partes de fuente/web (con estilos y gráficos incluidos) y probarla
node "$SRC/herramientas/armar_web.js"
if [ "$SIN_PRUEBAS" != "1" ]; then
  node "$SRC/pruebas/suite.js" || { echo "Las pruebas fallaron: no se publica nada."; exit 1; }
fi

VJAR=$(grep -o 'VERSION = "[^"]*"' $SRC/src/ar/inofer/mes/Main.java | sed 's/VERSION = "//; s/"//')

# Compilar con la URL de actualizaciones
B=$(mktemp -d); mkdir -p $B/src $B/classes
cp -r $SRC/src/* $B/src/
sed -i "s#@@URL_ACTUALIZACIONES@@#$URL#" $B/src/ar/inofer/mes/Actualizador.java
javac -encoding UTF-8 --release 11 -d $B/classes $(find $B/src -name '*.java') 2>&1 | grep -v JAVA_TOOL || true
cp -r $SRC/res/* $B/classes/
printf "Main-Class: ar.inofer.mes.Main\nImplementation-Title: INOFER\nImplementation-Version: $VJAR\n" > $B/MF
# Fechas fijas dentro del jar para que la huella sólo cambie si cambia el contenido
find $B/classes -exec touch -d "2026-01-01 00:00:00" {} +
(cd $B/classes && find . -type f | LC_ALL=C sort > ../lista.txt)
rm -f $B/INOFER.jar; (cd $B/classes && jar cfm ../INOFER.jar ../MF @../lista.txt 2>&1 | grep -v JAVA_TOOL || true)

mkdir -p "$OUT"
cp $SRC/res/web/index.html $SRC/res/web/manifest.webmanifest $SRC/res/web/sw.js "$OUT/"
rm -rf "$OUT/icons"; cp -r $SRC/res/web/icons "$OUT/"
cp $B/INOFER.jar "$OUT/INOFER.jar"
SHA=$(sha256sum "$OUT/INOFER.jar" | cut -d' ' -f1)
cat > "$OUT/version.json" <<EOF
{
  "web": "$VWEB",
  "jar": "$VJAR",
  "jarSha256": "$SHA"
}
EOF
# Paquete para PC en .zip (los navegadores suelen bloquear la descarga directa de .jar)
Z=$(mktemp -d)
cp "$OUT/INOFER.jar" "$Z/INOFER.jar"
printf 'INOFER para PC\r\n==============\r\n1. Doble clic en INOFER.jar\r\n2. Toca SI en "Instalar INOFER".\r\n3. Queda el icono INOFER en el Escritorio y en el menu Inicio.\r\n\r\nSi se abre WinRAR o 7-Zip: clic derecho en INOFER.jar -> Abrir con -> OpenJDK Platform binary.\r\nSi pide Java: https://adoptium.net/temurin/releases/ (Windows, x64, JRE, 21, .msi).\r\n' > "$Z/LEEME.txt"
rm -f "$OUT/INOFER-PC.zip"; (cd "$Z" && zip -q -X "$OUT/INOFER-PC.zip" INOFER.jar LEEME.txt); rm -rf "$Z"

# Servidor de Apps Script: el cargador (Codigo.gs) descarga este archivo
{ cat "$SRC/servidor/servidor.gs"; printf '\nreturn { doGet: doGet, doPost: doPost, restablecerClaveAdmin: restablecerClaveAdmin, enviarInformeSemanal: enviarInformeSemanal, copiaDeSeguridad: copiaDeSeguridad };\n'; } > "$OUT/servidor.js"
touch "$OUT/.nojekyll"

# Compatibilidad: los INOFER.jar viejos (2.3) buscaban actualizaciones en la raíz del sitio.
# Se les deja ahí el programa nuevo (solo programa, sin pantallas) para que se actualicen solos.
RAIZ="$(cd "$OUT/.." && pwd)"
cp "$OUT/INOFER.jar" "$RAIZ/INOFER.jar"
printf '{\n  "jar": "%s",\n  "jarSha256": "%s"\n}\n' "$VJAR" "$SHA" > "$RAIZ/version.json"
rm -rf "$B"
# Instalador de Windows (.exe con Java incluido): se rearma solo cuando cambia la versión del programa
if [ "$(cat "$OUT/instalador.version" 2>/dev/null)" != "$VJAR" ] || [ ! -f "$OUT/INOFER-Setup.exe" ]; then
  bash "$SRC/armar_instalador.sh" >/dev/null && echo "instalador=$VJAR"
fi
echo "web=$VWEB jar=$VJAR sha=$SHA"
