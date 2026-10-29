# INOFER — instrucciones para Claude

La carpeta `inofer/` de este repositorio ES la app publicada en GitHub Pages (https://inofer-admin.github.io/INOFER/inofer/).
Todas las PC (programa Java) y celulares (web/PWA) se actualizan solos desde acá.

## Estructura
- `fuente/res/web/index.html` → interfaz completa (fuente de verdad). NO editar `index.html` de la raíz a mano.
- `fuente/src/ar/inofer/mes/*.java` → programa de escritorio (Java 11+, sin dependencias):
  servidor local 127.0.0.1:47821, guardado en %APPDATA%\INOFER_MES, instalador de accesos directos,
  y `Actualizador` (lee `version.json` de Pages, baja index.html e INOFER.jar con SHA-256).
- `fuente/publicar.sh` → sube la versión de pantallas (meta `inofer-version`, AAAA.MM.DD.NN), compila
  `INOFER.jar` con la URL de Pages y regenera en la raíz: index.html, sw.js, manifest, icons/, INOFER.jar, version.json.
- `Codigo.gs` → CARGADOR fijo pegado una sola vez en Apps Script. NO cambiarlo (el usuario no quiere volver a pegar nada).
- `fuente/servidor/servidor.gs` → lógica real del servidor (usuarios, permisos, datos). `publicar.sh` la publica como
  `servidor.js`; el cargador la descarga (caché 2 min, copia de respaldo en la hoja BD_Servidor). Debe exponer
  doGet, doPost y restablecerClaveAdmin y contener el texto INOFER_SERVIDOR_OK.

## Nube
- `INOFER_NUBE_PREDETERMINADA` (index.html) = URL /exec de la planta; tiene prioridad sobre la guardada en cada equipo.
- Raíz del repo: `version.json` + `INOFER.jar` solo para que los programas viejos (2.3, URL de la raíz) se actualicen solos.

## Usuarios y permisos
- Ingreso obligatorio. Áreas: partes, ordenes, catalogo, gantt, ia. Niveles: none / view / edit. Rol admin = todo + usuarios + nube.
- Modo nube (Codigo.gs nuevo): login/token y permisos validados en el servidor (hoja BD_Usuarios, sesiones en Script Properties).
- Modo local (sin nube o Codigo.gs viejo): usuarios en localStorage `tablero_inyectoras_users_v1`, compartidos como módulo `users`.
- Interfaz: `INOFER_EDIT_CONTROLS` en index.html lista los controles que modifican datos por área. Si se agrega un botón/campo
  que modifica datos, sumarlo ahí.

## Cómo aplicar un pedido del usuario
1. Editar `fuente/res/web/index.html` (y/o los .java, y/o `fuente/servidor/servidor.gs`).
2. Si se tocó Java: subir `VERSION` en `Main.java` (ej. 2.3 → 2.4). Si solo cambia la web, no hace falta.
3. Si se cambió `sw.js`, subir el nombre de `CACHE`.
4. Verificar sintaxis JS (extraer los <script> y `node --check`) y probar con Playwright si es posible.
5. Ejecutar `inofer/fuente/publicar.sh` (publica en `inofer/`), hacer commit en `main` y push. En ~1–2 minutos todos los dispositivos se actualizan.

## No romper
- El usuario NO quiere tocar nada: todo cambio se publica con push (Pages + servidor.js).
- Claves de localStorage `tablero_inyectoras_*` y carpeta de datos `%APPDATA%\INOFER_MES` (datos de la planta).
- Puerto 47821 y la firma `INOFER_MES_JAVA` (/api/ping) — los usa la detección de instancia abierta.
- El usuario escribe en español rioplatense y no es programador: explicar en pasos simples.
