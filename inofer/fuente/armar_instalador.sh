#!/bin/bash
# Arma inofer/INOFER-Setup.exe (instalador de Windows con Java incluido) usando NSIS para Linux.
# Las herramientas se bajan de GitHub la primera vez y quedan en /tmp/inofer_build.
set -e
RAIZ=$(cd "$(dirname "$0")/.." && pwd)        # carpeta inofer/
SRC=$RAIZ/fuente
B=/tmp/inofer_build
JRE_URL="https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.8%2B9/OpenJDK21U-jre_x64_windows_hotspot_21.0.8_9.zip"
mkdir -p $B
if [ ! -x $B/7z/7zz ]; then
  curl -sL -o $B/7z.tar.xz https://github.com/ip7z/7zip/releases/download/24.09/7z2409-linux-x64.tar.xz
  mkdir -p $B/7z && tar -xf $B/7z.tar.xz -C $B/7z
fi
if [ ! -x $B/nsis/linux/makensis ]; then
  curl -sL -o $B/nsis.7z https://github.com/electron-userland/electron-builder-binaries/releases/download/nsis-3.0.4.1/nsis-3.0.4.1.7z
  $B/7z/7zz x -y -o$B/nsis $B/nsis.7z >/dev/null && chmod +x $B/nsis/linux/makensis
fi
if [ ! -d $B/jre/jdk-21.0.8+9-jre ]; then
  curl -sL -o $B/jre.zip "$JRE_URL" && rm -rf $B/jre && unzip -q $B/jre.zip -d $B/jre
fi
VJAR=$(grep -o 'VERSION = "[^"]*"' $SRC/src/ar/inofer/mes/Main.java | sed 's/VERSION = "//; s/"//')
rm -rf $B/src && mkdir -p $B/src && cp $RAIZ/INOFER.jar $SRC/res/INOFER.ico $B/src/
NSISDIR=$B/nsis $B/nsis/linux/makensis -V2 -DSRC=$B/src -DJRE="$B/jre/jdk-21.0.8+9-jre" -DOUTFILE=$RAIZ/INOFER-Setup.exe -DVERSION=$VJAR $SRC/instalador/INOFER.nsi
echo "$VJAR" > $RAIZ/instalador.version
ls -la $RAIZ/INOFER-Setup.exe
