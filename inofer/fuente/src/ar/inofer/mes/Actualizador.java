package ar.inofer.mes;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.Properties;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipFile;

/**
 * Actualización automática de INOFER.
 *
 * Las pantallas del sistema (index.html) y el propio programa (INOFER.jar) se publican en
 * GitHub Pages. Este módulo revisa el archivo version.json de esa dirección:
 *  - Si hay pantallas nuevas, las descarga y desde ese momento se usan (sin reinstalar).
 *  - Si hay un INOFER.jar nuevo, lo descarga, verifica su huella SHA-256 y se instala
 *    solo la próxima vez que se abre INOFER.
 * Sin internet, se sigue usando la última versión descargada (o la que trae el programa).
 *
 * La dirección se puede cambiar en %APPDATA%\INOFER_MES\config.properties:
 *     actualizaciones=https://usuario.github.io/inofer/
 */
public final class Actualizador {

    /** Dirección de publicación por defecto (se completa al compilar). */
    public static final String URL_POR_DEFECTO = "@@URL_ACTUALIZACIONES@@";

    private static final Pattern META_VERSION = Pattern.compile("<meta\\s+name=\"inofer-version\"\\s+content=\"([^\"]+)\"");

    private final Almacen almacen;
    private final Path carpetaWeb;
    private volatile String versionWebDisponible;
    private volatile boolean jarPendiente;
    private volatile String ultimoError = "";

    public Actualizador(Almacen almacen) {
        this.almacen = almacen;
        this.carpetaWeb = almacen.getCarpeta().resolve("web_actual");
        this.versionWebDisponible = versionDe(leerPaginaDescargada());
    }

    public String getUrlBase() {
        String url = URL_POR_DEFECTO;
        try {
            Path cfg = almacen.getCarpeta().resolve("config.properties");
            if (Files.exists(cfg)) {
                Properties p = new Properties();
                try (InputStream in = Files.newInputStream(cfg)) { p.load(in); }
                String v = p.getProperty("actualizaciones", "").trim();
                if (!v.isEmpty()) url = v;
            }
        } catch (IOException ignored) { }
        if (url.startsWith("@@") || url.isEmpty()) return null;
        return url.endsWith("/") ? url : url + "/";
    }

    public boolean isJarPendiente() { return jarPendiente || Files.exists(Instalador.jarNuevo()); }
    public String getUltimoError() { return ultimoError; }

    // ------------------------------------------------------------------ página

    /** Página a mostrar: la descargada si es igual o más nueva que la que trae el programa. */
    public byte[] paginaActual() throws IOException {
        byte[] embebida = ServidorLocal.recurso("/web/index.html");
        byte[] descargada = leerPaginaDescargada();
        if (descargada != null && compararVersiones(versionDe(descargada), versionDe(embebida)) >= 0) return descargada;
        return embebida;
    }

    public String versionPaginaActual() {
        try { return versionDe(paginaActual()); } catch (IOException e) { return "?"; }
    }

    private byte[] leerPaginaDescargada() {
        try {
            Path f = carpetaWeb.resolve("index.html");
            return Files.exists(f) ? Files.readAllBytes(f) : null;
        } catch (IOException e) {
            return null;
        }
    }

    public static String versionDe(byte[] html) {
        if (html == null) return "0";
        String inicio = new String(html, 0, Math.min(html.length, 4000), StandardCharsets.UTF_8);
        Matcher m = META_VERSION.matcher(inicio);
        return m.find() ? m.group(1) : "0";
    }

    // ------------------------------------------------------------------ búsqueda

    /**
     * Revisa si hay actualizaciones. Devuelve true si se descargaron pantallas nuevas.
     * @param conJar también descargar un INOFER.jar nuevo si lo hay
     */
    public synchronized boolean buscar(int timeoutMs, boolean conJar) {
        String base = getUrlBase();
        if (base == null) return false;
        boolean cambioWeb = false;
        try {
            String json = new String(descargar(base + "version.json?t=" + System.currentTimeMillis(), timeoutMs), StandardCharsets.UTF_8);
            String web = campo(json, "web");
            String jar = campo(json, "jar");
            String sha = campo(json, "jarSha256");

            if (web != null && compararVersiones(web, versionPaginaActual()) > 0) {
                byte[] html = descargar(base + "index.html?v=" + web, Math.max(timeoutMs, 20000));
                String texto = new String(html, StandardCharsets.UTF_8);
                if (html.length > 50_000 && texto.contains("</html>") && web.equals(versionDe(html))) {
                    Files.createDirectories(carpetaWeb);
                    Path tmp = carpetaWeb.resolve("index.html.tmp");
                    Files.write(tmp, html);
                    Files.move(tmp, carpetaWeb.resolve("index.html"), StandardCopyOption.REPLACE_EXISTING);
                    versionWebDisponible = web;
                    cambioWeb = true;
                }
            }

            if (conJar && jar != null && sha != null && Instalador.ejecutandoInstalado()
                    && compararVersiones(jar, Main.VERSION) > 0 && !Files.exists(Instalador.jarNuevo())) {
                byte[] bin = descargar(base + "INOFER.jar?v=" + jar, 60000);
                if (sha.equalsIgnoreCase(sha256(bin))) {
                    Path tmp = Instalador.carpetaInstalacion().resolve("INOFER.jar.descarga");
                    Files.write(tmp, bin);
                    if (esJarValido(tmp)) {
                        Files.move(tmp, Instalador.jarNuevo(), StandardCopyOption.REPLACE_EXISTING);
                        jarPendiente = true;
                    } else {
                        Files.deleteIfExists(tmp);
                    }
                }
            }
            ultimoError = "";
        } catch (Exception e) {
            ultimoError = "Sin conexión con el servidor de actualizaciones";
        }
        return cambioWeb;
    }

    // ------------------------------------------------------------------ utilidades

    static boolean esJarValido(Path p) {
        try (ZipFile z = new ZipFile(p.toFile())) {
            return z.getEntry("ar/inofer/mes/Main.class") != null && z.getEntry("web/index.html") != null;
        } catch (IOException e) {
            return false;
        }
    }

    /** Compara versiones tipo "2.3" o "2026.10.28.01" número por número. */
    public static int compararVersiones(String a, String b) {
        if (a == null) a = "0";
        if (b == null) b = "0";
        String[] x = a.replaceAll("[^0-9.]", "").split("\\.");
        String[] y = b.replaceAll("[^0-9.]", "").split("\\.");
        for (int i = 0; i < Math.max(x.length, y.length); i++) {
            long u = i < x.length && !x[i].isEmpty() ? Long.parseLong(x[i]) : 0;
            long v = i < y.length && !y[i].isEmpty() ? Long.parseLong(y[i]) : 0;
            if (u != v) return u < v ? -1 : 1;
        }
        return 0;
    }

    private static String campo(String json, String nombre) {
        Matcher m = Pattern.compile("\"" + nombre + "\"\\s*:\\s*\"([^\"]*)\"").matcher(json);
        return m.find() ? m.group(1) : null;
    }

    private static byte[] descargar(String url, int timeoutMs) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(timeoutMs);
        c.setReadTimeout(timeoutMs);
        c.setInstanceFollowRedirects(true);
        c.setRequestProperty("User-Agent", "INOFER/" + Main.VERSION);
        c.setRequestProperty("Cache-Control", "no-cache");
        if (c.getResponseCode() != 200) throw new IOException("HTTP " + c.getResponseCode());
        try (InputStream in = c.getInputStream()) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] b = new byte[16384];
            int n;
            while ((n = in.read(b)) > 0) out.write(b, 0, n);
            return out.toByteArray();
        }
    }

    static String sha256(byte[] datos) {
        try {
            byte[] h = MessageDigest.getInstance("SHA-256").digest(datos);
            StringBuilder sb = new StringBuilder();
            for (byte x : h) sb.append(String.format("%02x", x));
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }
}
