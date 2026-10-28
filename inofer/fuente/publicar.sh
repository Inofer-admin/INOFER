#!/bin/bash
# Arma el sitio publicable de INOFER (GitHub Pages) y el INOFER.jar con auto-actualización.
# Uso: fuente/publicar.sh            (publica en la raiz del repositorio)
set -e
URL="${1:-https://inofer-admin.github.io/INOFER/}"; OUT="${2:-$(cd "$(dirname "$0")/.." && pwd)}"; VWEB="$3"
SRC="$(cd "$(dirname "$0")" && pwd)"


# Versión de las pantallas: AAAA.MM.DD.NN (si no se indica, sube el número del día)
ACT=$(grep -o 'name="inofer-version" content="[^"]*"' $SRC/res/web/index.html | sed 's/.*content="//; s/"//')
if [ -z "$VWEB" ]; then
  HOY=$(TZ=America/Buenos_Aires date +%Y.%m.%d)
  if [[ "$ACT" == "$HOY".* ]]; then N=$((10#${ACT##*.} + 1)); else N=1; fi
  VWEB="$HOY.$(printf %02d $N)"
fi
sed -i "s/name=\"inofer-version\" content=\"[^\"]*\"/name=\"inofer-version\" content=\"$VWEB\"/" $SRC/res/web/index.html

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
touch "$OUT/.nojekyll"
rm -rf "$B"
echo "web=$VWEB jar=$VJAR sha=$SHA"
