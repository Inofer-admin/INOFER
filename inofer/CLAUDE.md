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
- Ingreso obligatorio. Áreas: partes, ordenes, catalogo, gantt, ia, indicadores. Niveles: none / view / edit. Rol admin = todo + usuarios + nube.
- Modo nube (Codigo.gs nuevo): login/token y permisos validados en el servidor (hoja BD_Usuarios, sesiones en Script Properties).
- Modo local (sin nube o Codigo.gs viejo): usuarios en localStorage `tablero_inyectoras_users_v1`, compartidos como módulo `users`.
- Interfaz: `INOFER_EDIT_CONTROLS` en index.html lista los controles que modifican datos por área. Si se agrega un botón/campo
  que modifica datos, sumarlo ahí.

## Papelera y portamolde
- Papelera (solo admin, solapa 🗑️): el servidor registra en BD_Papelera lo que desaparece al guardar (partes, órdenes,
  piezas, semanas/ítems del Gantt, cierres) comparando el estado anterior con el nuevo; acciones listPapelera/restaurarPapelera/vaciarPapelera.
- Catálogo: campo `portamolde` (molde base compartido). Piezas con el mismo portamolde no pueden estar en máquinas distintas el
  mismo día: el auto-armado los pone en la misma máquina y salta días ocupados; a mano se bloquea (inoferChoqueManual).
- `armada: true` marca la versión montada hoy en cada portamolde (panel en la base de datos); el Gantt avisa cambios de versión.
- `INOFER_MOLDES_BASE` (index.html) = listado oficial molde base → versión (MOLDES_BASE_Y_VERSIONES.xlsx). Se aplica solo una
  vez por equipo tras sincronizar (flag `tablero_inyectoras_moldesbase_v1`), completando solo portamoldes vacíos.
- Piezas `-R` (inoferEsPiezaR) no se inyectan: fuera del análisis/auto-armado, bloqueadas a mano, aviso para quitarlas.

## Pistones
- Pieza: `pistonMm` (diámetro de pistón; planta usa 40/45/50/55/65 mm = INOFER_DIAMETROS_PISTON, default de 200V/200N/180). Módulo `pistones` (área gantt): disponibles y montado por máquina + horasCambio.
- Auto-armado: inoferOrdenarPorPiston agrupa piezas del mismo pistón dentro de cada nivel de urgencia (ahorro de SET-UP);
  prefiere la máquina que lo tiene montado y suma CPIS al cambiar. Solo 200V/200N/180 cambian pistón (H50 y Z30: único).
- Gantt: panel "⚙️ Pistones por máquina", avisos de cambios y de pistón faltante; carga manual bloqueada si la máquina no lo tiene.

## Indicadores (KPI)
- Solapa 📊 Indicadores (área de permisos `indicadores`): rebabado, scrap (menor es mejor), recuento cíclico, inyección.
- Módulo `kpis`: { clave: { meta, datos:[{mes:'AAAA-MM', valor, nota}] } }. Gráfico estilo planilla (fondo #5b9bd5, línea negra),
  informe imprimible (iframe), PNG, importar pegando o desde Excel/CSV. Recuento arranca con los datos del gráfico de la planta.

## Quién cargó
- Partes: la nube guarda cargado_por / modificado_por / cargado_at (columnas O-Q de BD_Tiempo_Real, USUARIO_ACTUAL en servidor).
- Indicadores y filas de órdenes guardan `cargadoPor`/`cargadoAt` desde el cliente (inoferUsuarioEtiqueta).
- Papelera: el admin puede borrar elementos sueltos o vaciarla toda (vaciarPapelera con ids/soloIds o todo).

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

## Asistente del Gantt y Lista de órdenes (bloque "Asistente del Gantt (chat / voz) + Lista de órdenes")
- Panel `#inoferGanttChat` en viewGantt: `inoferGanttChat(texto)` interpreta frases en español (parser local; si no entiende y hay `geminiApiKey`, pide ops JSON a Gemini) y aplica ops: set, add, move_day, move_mach, swap, remove, aux, week, undo, show. Índices de día = columnas del Gantt (0=Dom,1=Lun…6=Sáb).
- Valida -R (`inoferEsPiezaR`), portamolde (`inoferChoqueManual`), pistón (`inoferMaquinaAdmitePiston`); avisa >24 h/día. Guarda con `saveGanttWeeks()`; historial local para "deshacer". Requiere permiso gantt edit (ver solo consulta).
- Micrófono con Web Speech API (es-AR) cuando el navegador lo permite.
- Sub-pestaña `list` (📂 Lista de órdenes, `#orderSubViewList`) por defecto en Órdenes: tarjetas con buscar/filtrar, Abrir (efficiency), Editar (front), Borrar (va a la papelera). `switchOrderSubTab` y `renderProductionOrdersView` quedan envueltos.
