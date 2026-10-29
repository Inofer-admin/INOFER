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

## Carga rápida de órdenes (bloque "Carga rápida de órdenes para el operario en máquina")
- Sub-pestaña `rapida` (⚡ Carga rápida, `#orderSubViewRapida` / `#inoferCR`): asistente de 3 pasos para el operario: máquina (se recuerda por equipo en `tablero_inyectoras_operario_v1`) → orden abierta de esa máquina o nueva (pieza con autocompletado desde catálogo + sugeridas del Gantt, cantidad sugerida del Gantt, N° autonumerado) → turno (Mañana/Tarde/Noche), piezas buenas, scrap, arranque en baja, parada sí/no con código y minutos, operario.
- El log guarda turno, stopMinutes, cargadoPor. Si llega al 100% la orden pasa a Completada.
- Usuarios no admin con permiso ordenes edit entran directo a esta pestaña; el admin entra a la Lista.
- Se quitaron los valores de ejemplo (350/10/8) del formulario viejo de avance. En celular el header deja de ser sticky y la barra de sub-pestañas hace wrap.
- Turnos configurables: módulo de nube `turnos` = {activo, esquemas:[{id,nombre,turnos:[{nombre,ini,fin}]}]} (local `tablero_inyectoras_turnos_v1`). Por defecto "3 turnos de 8 h" y "2 turnos de 12 h". Solo el admin lo edita (botón ⚙️ Horarios de turnos en Carga rápida; servidor MODULO_AREA turnos:'admin'), todos los usuarios lo reciben. El turno sugerido es el que contiene la hora actual.
- Paradas: varias por turno (`.cr-prow`: motivo + h + min, botones +15/+30/+1h acumulan, sin tope). Log guarda `paradas:[{codigo,min}]`, `stopMinutes` total, `stopCode` = primera, y obs "Cód N · X; …". Avisa si suman más que el turno.

## Precios y facturación (bloque "Precios (sin IVA), facturación del Gantt y plan por objetivo")
- Campo `precio` (unitario sin IVA, $) + `precioAt` en cada pieza del catálogo (viaja en el módulo de nube `catalog`; NUNCA poner precios en el repo, es público). Editable en el formulario (`#cat_precio`), en la tabla (`.inline-precio-input`) e importando Excel/CSV (`#inoferPreciosFile`, detecta columnas código/precio, formato 1.234,56).
- `inoferFacturacion(week)` suma dailyQty × precio (incluye piezas compañeras). Badge `#inoferGanttFactBadge` en el asistente.
- Asistente: "cuánto factura" → op facturacion; "necesito facturar X / aumentá en X / subí un N%" → op meta → `inoferPlanMeta(week, objetivo, {dias, maquinas, sinLimite})`: greedy por $/h (precio×u/h, bonus si ya está en la máquina, prioriza menor alcance), capacidad = horas del esquema de turnos activo, tope por pieza = pedidos de este mes+próximo del listado de demanda menos lo programado (sin listado: hasta duplicar lo programado), respeta -R, pistón y portamolde, reserva 0,87 h CMO al sumar pieza nueva. Días por defecto lun–vie (sábado/domingo si se nombran).

## Set-up por máquina y lotes mínimos (bloque "Tiempos de set-up por máquina y lotes mínimos")
- Módulo nube `setup` (servidor setup:'gantt'), local `tablero_inyectoras_setup_v1`: {maquinas:{id:{cmo, alis, loteMin}}}. Defaults: 200V/200N/180 CMO 5 h + puesta a punto (ALIS) 1 h; H50/Z30 CMO 3 h, ALIS 0. Panel `#inoferPanelSetup` en el Gantt.
- `inoferSetupDe(m)`, `inoferLoteMinDe(part, m)` (pieza.loteMin o el default de la máquina), `inoferAgregarSetup(week,m,d)`, `inoferStdAux(m,code)` (columna Std del Gantt).
- Gantt automático: sube la cantidad al lote mínimo, carga CMO+ALIS de la máquina por cada pieza/máquina (si no entra el set-up ese día, lo carga y arranca al día siguiente), solo reparte a otra máquina si el resto ≥ lote mínimo y > horas de set-up.
- Asistente: pieza nueva → carga set-up; avisa si queda bajo el lote mínimo. Plan por facturación: pieza nueva solo si entra el lote mínimo completo.
- Campo `loteMin` en catálogo (form `#cat_lote_min`, tabla `.inline-lote-input`, importador detecta columna "lote").
- Lote mínimo: PRIORIDAD planilla de demanda (`inoferLotePlanilla`: menor valor > 0 de M1..M12 de la pieza en #autoGanttPasteArea) > catalogo.loteMin > default de la máquina. En la tabla del catálogo se muestra "📦 N planilla" cuando viene de ahí.
- Asistente conciso: por defecto responde "✓ Listo." + avisos ⚠️ y errores; el detalle se guarda en `ultimoDetalle` y se muestra con "qué hiciste"/"detalle" o si el pedido incluye "detalle/explicá/por máquina". Facturación corta = total; "con detalle" = desglose.
- Filas auxiliares del Gantt en UNIDADES: internamente `aux[code][d]` sigue guardando HORAS; la celda Unid. muestra horas/std y al editar guarda unidades×std (std = `inoferStdAux(m, code)`, CPIS = horasCambio de pistones). Celda Hs = horas. Si std=0 la celda queda deshabilitada. Asistente: "poné 1 cambio de molde en la 200V el lunes" = unidades; "2 horas de limpieza" = horas.
- CMA (cambio de material) = 24 h por unidad. Lote mínimo obligatorio en lo automático: el Gantt automático no sube un molde si en la máquina no entra el lote completo (cuenta `lotesSinLugar`, aviso en el banner); el plan por facturación no agrega piezas nuevas sin lote conocido. Lo manual (carga a mano y pedidos puntuales al asistente) se permite con aviso.

## Permisos detallados, tablero desde OP y edición de turnos (bloque "Permisos detallados por pestaña + Tablero…")
- `permisos.detalle = {clave: bool}` (servidor `normalizarPermisos` lo conserva; cliente `inoferNormPerms` envuelto). `inoferPuede(k)`: admin siempre; requiere el nivel del área (edit, o view para precios_ver) y detalle[k] !== false. Claves: ord_turnos, ord_editar_turnos, ord_crear, ord_editar, ord_borrar, gantt_manual, gantt_asistente, gantt_auto, gantt_setup, cat_piezas, precios_ver, precios_editar. CONTROLES (bloqueo en captura) y OCULTAR (MutationObserver). Editor: checkboxes `.inofer-sub-perm` bajo cada área en Usuarios y permisos; atajo "Solo cargar producción" (`#inoferPresetCarga`).
- Tablero/velocímetros: `getFilteredRecords` envuelto suma `inoferRegistrosDeOrdenes()` (cada log de OP = registro: available = horas del turno, paradas → categorías vía `INOFER_CODIGO_CATEGORIA`). Se ocultan `#openNewEntryModalBtn` y `#simSaveToRecordsBtn`. En el Historial las filas de OP muestran "OP N · pieza" + ✏️ Editar.
- Edición de turnos: `inoferEditarTurno(ordId, logId)` abre Carga rápida con el turno precargado (st.editLogId); guarda modificadoPor/modificadoAt; lista "Turnos cargados en esta orden" con ✏️/🗑️; botón ✏️ Editar también en la tabla de seguimiento. `obsUsuario` guarda la observación libre. `autoCompletada` permite volver a En Proceso si al corregir baja del 100%.
- Parte de horas manual de nuevo visible; sus paradas se cargan por CÓDIGO (bloque "Parte de horas manual con las mismas paradas"): `#ppBox` con filas código+h+min, se vuelcan a los inputs ocultos modal_<categoría> vía INOFER_CODIGO_CATEGORIA; `entry.paradas` viaja a la nube (columna 18 'paradas' JSON en BD_Tiempo_Real). Partes viejos sin paradas se editan por categoría (`#ppLegacy`).
- Código 29 "Carga de nitrógeno" (categoría mant_preventivo).
- Tablero: filtro `#filterFuente` (ALL / MANUAL / OP). Se excluyen siempre los datos de ejemplo (`inoferEsDemo`: ids de INITIAL_RECORDS y logs de INITIAL_ORDERS). El filtro de turno suma los nombres de turnos configurados.
- Actualización automática (v2.6): la pantalla revisa a los 4 s, cada 3 min y al volver a la ventana; si hay versión nueva y nadie tocó nada en 45 s (ni modal abierto ni turno a medio cargar) recarga sola; guarda en sessionStorage `inoferUpdTry` para no recargar en bucle. En Java usa `/api/actualizar` (nuevo: fuerza la descarga desde GitHub) y el revisor del jar corre cada 5 min. La versión se ve en el encabezado (`#inoferVersionTag`).
