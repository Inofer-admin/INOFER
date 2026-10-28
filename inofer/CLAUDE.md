# INOFER — instrucciones para Claude

Este repositorio ES la app publicada en GitHub Pages (https://inofer-admin.github.io/INOFER/).
Todas las PC (programa Java) y celulares (web/PWA) se actualizan solos desde acá.

## Estructura
- `fuente/res/web/index.html` → interfaz completa (fuente de verdad). NO editar `index.html` de la raíz a mano.
- `fuente/src/ar/inofer/mes/*.java` → programa de escritorio (Java 11+, sin dependencias):
  servidor local 127.0.0.1:47821, guardado en %APPDATA%\INOFER_MES, instalador de accesos directos,
  y `Actualizador` (lee `version.json` de Pages, baja index.html e INOFER.jar con SHA-256).
- `fuente/publicar.sh` → sube la versión de pantallas (meta `inofer-version`, AAAA.MM.DD.NN), compila
  `INOFER.jar` con la URL de Pages y regenera en la raíz: index.html, sw.js, manifest, icons/, INOFER.jar, version.json.
- `Codigo.gs` → Apps Script de la nube (Google Sheets). Si se cambia, el usuario debe pegarlo y publicar nueva versión.

## Cómo aplicar un pedido del usuario
1. Editar `fuente/res/web/index.html` (y/o los .java).
2. Si se tocó Java: subir `VERSION` en `Main.java` (ej. 2.3 → 2.4). Si solo cambia la web, no hace falta.
3. Si se cambió `sw.js`, subir el nombre de `CACHE`.
4. Verificar sintaxis JS (extraer los <script> y `node --check`) y probar con Playwright si es posible.
5. Ejecutar `fuente/publicar.sh`, hacer commit en `main` y push. En ~1–2 minutos todos los dispositivos se actualizan.

## No romper
- Claves de localStorage `tablero_inyectoras_*` y carpeta de datos `%APPDATA%\INOFER_MES` (datos de la planta).
- Puerto 47821 y la firma `INOFER_MES_JAVA` (/api/ping) — los usa la detección de instancia abierta.
- El usuario escribe en español rioplatense y no es programador: explicar en pasos simples.
