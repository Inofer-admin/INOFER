package ar.inofer.mes;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.text.SimpleDateFormat;
import java.util.*;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * Guarda todos los datos del sistema (registros de horas, órdenes, Gantt, catálogo,
 * configuración de nube, etc.) en un archivo JSON dentro de la PC:
 *   Windows:  %APPDATA%\INOFER_MES\datos.json
 * Cada día que se abre el programa se hace una copia en la carpeta "respaldos"
 * (se conservan las últimas 30).
 */
public final class Almacen {

    private static final int MAX_RESPALDOS = 30;
    private final Path carpeta;
    private final Path archivo;
    private final Path respaldos;

    public Almacen() throws IOException {
        String appData = System.getenv("APPDATA");
        Path base = (appData != null && !appData.isEmpty())
                ? Paths.get(appData, "INOFER_MES")
                : Paths.get(System.getProperty("user.home"), ".inofer_mes");
        this.carpeta = base;
        this.archivo = base.resolve("datos.json");
        this.respaldos = base.resolve("respaldos");
        Files.createDirectories(respaldos);
        respaldoDiario();
    }

    public Path getCarpeta() { return carpeta; }
    public Path getCarpetaRespaldos() { return respaldos; }

    /** Devuelve el contenido guardado (JSON) o "{}" si todavía no hay datos. */
    public synchronized String leer() {
        try {
            if (Files.exists(archivo)) {
                String s = new String(Files.readAllBytes(archivo), StandardCharsets.UTF_8).trim();
                if (s.startsWith("{")) return s;
            }
        } catch (IOException ignored) { }
        return "{}";
    }

    /** Guarda de forma segura: primero en un archivo temporal y después lo reemplaza. */
    public synchronized void guardar(String json) throws IOException {
        if (json == null) return;
        String limpio = json.trim();
        if (!limpio.startsWith("{") || !limpio.endsWith("}")) {
            throw new IOException("Datos inválidos");
        }
        Path tmp = carpeta.resolve("datos.json.tmp");
        Files.write(tmp, limpio.getBytes(StandardCharsets.UTF_8));
        try {
            Files.move(tmp, archivo, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException e) {
            Files.move(tmp, archivo, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    /** Copia manual inmediata. Devuelve el archivo creado. */
    public synchronized Path respaldoAhora() throws IOException {
        String sello = new SimpleDateFormat("yyyy-MM-dd_HH-mm-ss").format(new Date());
        Path destino = respaldos.resolve("datos_" + sello + ".json");
        Files.write(destino, leer().getBytes(StandardCharsets.UTF_8));
        return destino;
    }

    private void respaldoDiario() {
        try {
            if (!Files.exists(archivo)) return;
            String hoy = new SimpleDateFormat("yyyy-MM-dd").format(new Date());
            Path destino = respaldos.resolve("datos_" + hoy + ".json");
            if (!Files.exists(destino)) Files.copy(archivo, destino);
            List<Path> lista;
            try (Stream<Path> st = Files.list(respaldos)) {
                lista = st.filter(p -> p.getFileName().toString().startsWith("datos_"))
                          .sorted(Comparator.comparing(Path::toString))
                          .collect(Collectors.toList());
            }
            for (int i = 0; i < lista.size() - MAX_RESPALDOS; i++) Files.deleteIfExists(lista.get(i));
        } catch (IOException ignored) { }
    }
}
