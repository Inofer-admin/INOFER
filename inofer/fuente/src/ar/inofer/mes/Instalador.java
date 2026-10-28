package ar.inofer.mes;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;

/**
 * Instala INOFER en la PC sin necesidad de archivos .bat ni permisos de administrador:
 *  - Copia el programa a  %LOCALAPPDATA%\INOFER\INOFER.jar  (+ ícono INOFER.ico)
 *  - Crea el acceso directo "INOFER" con ícono en el Escritorio y en el menú Inicio
 *  - Borra los accesos directos viejos ("INOFER MES")
 * Los datos NO se tocan: siguen en %APPDATA%\INOFER_MES.
 */
public final class Instalador {

    private Instalador() { }

    public static boolean esWindows() {
        return System.getProperty("os.name", "").toLowerCase().contains("win");
    }

    public static Path carpetaInstalacion() {
        String local = System.getenv("LOCALAPPDATA");
        return (local != null && !local.isEmpty())
                ? Paths.get(local, "INOFER")
                : Paths.get(System.getProperty("user.home"), ".inofer", "app");
    }

    public static Path jarInstalado() { return carpetaInstalacion().resolve("INOFER.jar"); }

    /** Archivo .jar desde el que se está ejecutando este programa (null si no es un .jar). */
    public static Path jarActual() {
        try {
            Path p = Paths.get(Main.class.getProtectionDomain().getCodeSource().getLocation().toURI());
            return (Files.isRegularFile(p) && p.toString().toLowerCase().endsWith(".jar")) ? p : null;
        } catch (Exception e) {
            return null;
        }
    }

    /** true si se está ejecutando la copia instalada. */
    public static boolean ejecutandoInstalado() {
        Path actual = jarActual();
        try {
            return actual != null && Files.exists(jarInstalado()) && Files.isSameFile(actual, jarInstalado());
        } catch (IOException e) {
            return false;
        }
    }

    /** true si la copia instalada existe y es idéntica a la que se está ejecutando. */
    public static boolean instaladoYAlDia() {
        Path actual = jarActual();
        if (actual == null || !Files.exists(jarInstalado())) return false;
        if (ejecutandoInstalado()) return true;
        return huella(actual).equals(huella(jarInstalado()));
    }

    public static boolean hayInstalacion() { return Files.exists(jarInstalado()); }

    /** INOFER.jar nuevo descargado por el actualizador, pendiente de aplicar. */
    public static Path jarNuevo() { return carpetaInstalacion().resolve("INOFER-nuevo.jar"); }

    private static Path marcaFallo() { return carpetaInstalacion().resolve("actualizacion_fallida.txt"); }

    static String javaw() {
        Path w = Paths.get(System.getProperty("java.home"), "bin", esWindows() ? "javaw.exe" : "java");
        return Files.isRegularFile(w) ? w.toString() : (esWindows() ? "javaw.exe" : "java");
    }

    /**
     * Al abrir la copia instalada: si hay un INOFER.jar nuevo ya descargado, arranca el
     * reemplazo (desde la copia nueva) y devuelve true para que este proceso se cierre.
     */
    public static boolean lanzarReemplazoSiHay() {
        if (!ejecutandoInstalado()) return false;
        Path nuevo = jarNuevo();
        if (!Files.exists(nuevo)) return false;
        try {
            if (Files.exists(marcaFallo()) || huella(nuevo).equals(huella(jarInstalado())) || !Actualizador.esJarValido(nuevo)) {
                Files.deleteIfExists(marcaFallo());
                Files.deleteIfExists(nuevo);
                return false;
            }
            new ProcessBuilder(javaw(), "-jar", nuevo.toString(), "--aplicar-actualizacion").start();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** Se ejecuta desde INOFER-nuevo.jar: reemplaza INOFER.jar y lo vuelve a abrir. */
    public static void aplicarActualizacion() {
        Path origen = jarActual();
        Path destino = jarInstalado();
        boolean ok = false;
        for (int i = 0; i < 40 && origen != null && !ok; i++) {
            try {
                Files.copy(origen, destino, StandardCopyOption.REPLACE_EXISTING);
                ok = true;
            } catch (IOException e) {
                try { Thread.sleep(500); } catch (InterruptedException ie) { break; }
            }
        }
        if (!ok) {
            try { Files.write(marcaFallo(), "No se pudo reemplazar INOFER.jar".getBytes(StandardCharsets.UTF_8)); } catch (IOException ignored) { }
        }
        try { new ProcessBuilder(javaw(), "-jar", destino.toString()).start(); } catch (IOException ignored) { }
    }

    /**
     * Instala o actualiza. Devuelve un texto con el resultado para mostrar al usuario.
     * Si se ejecuta desde la copia instalada, solo vuelve a crear los accesos directos.
     */
    public static String instalar() throws Exception {
        Path dir = carpetaInstalacion();
        Files.createDirectories(dir);
        Path actual = jarActual();
        if (actual != null && !ejecutandoInstalado()) {
            Path tmp = dir.resolve("INOFER.jar.copiando");
            Files.copy(actual, tmp, StandardCopyOption.REPLACE_EXISTING);
            Files.move(tmp, jarInstalado(), StandardCopyOption.REPLACE_EXISTING);
        }
        Path ico = dir.resolve("INOFER.ico");
        try (InputStream in = Instalador.class.getResourceAsStream("/INOFER.ico")) {
            if (in != null) Files.copy(in, ico, StandardCopyOption.REPLACE_EXISTING);
        }
        if (!esWindows()) return "Programa copiado en " + dir;

        crearAccesosDirectos(ico);
        return "INOFER quedó instalado.\n\n"
                + "• Ícono \"INOFER\" en el Escritorio\n"
                + "• Ícono \"INOFER\" en el menú Inicio (podés anclarlo a la barra de tareas)\n\n"
                + "Desde ahora abrilo siempre con ese ícono.";
    }

    private static void crearAccesosDirectos(Path ico) throws Exception {
        String javaw = javaw();
        String jar = jarInstalado().toString();
        String dir = carpetaInstalacion().toString();

        String ps = ""
            + "$ErrorActionPreference = 'Stop'\r\n"
            + "$ws = New-Object -ComObject WScript.Shell\r\n"
            + "$desk = [Environment]::GetFolderPath('Desktop')\r\n"
            + "$prog = [Environment]::GetFolderPath('Programs')\r\n"
            + "foreach ($d in @($desk, $prog)) {\r\n"
            + "  foreach ($old in @('INOFER MES.lnk', 'INOFER_MES.lnk', 'INOFER_MES.jar - Acceso directo.lnk', 'INOFER_MES - Acceso directo.lnk')) {\r\n"
            + "    $o = Join-Path $d $old; if (Test-Path -LiteralPath $o) { Remove-Item -LiteralPath $o -Force }\r\n"
            + "  }\r\n"
            + "  $s = $ws.CreateShortcut((Join-Path $d 'INOFER.lnk'))\r\n"
            + "  $s.TargetPath = " + q(javaw) + "\r\n"
            + "  $s.Arguments = '-jar \"' + " + q(jar) + " + '\"'\r\n"
            + "  $s.WorkingDirectory = " + q(dir) + "\r\n"
            + "  $s.IconLocation = " + q(ico.toString()) + " + ',0'\r\n"
            + "  $s.Description = 'INOFER'\r\n"
            + "  $s.Save()\r\n"
            + "}\r\n";

        Path script = Files.createTempFile("inofer_instalar_", ".ps1");
        // UTF-8 con BOM para que PowerShell lea bien tildes y ñ en las rutas
        byte[] bom = {(byte) 0xEF, (byte) 0xBB, (byte) 0xBF};
        byte[] cuerpo = ps.getBytes(StandardCharsets.UTF_8);
        byte[] todo = new byte[bom.length + cuerpo.length];
        System.arraycopy(bom, 0, todo, 0, bom.length);
        System.arraycopy(cuerpo, 0, todo, bom.length, cuerpo.length);
        Files.write(script, todo);
        try {
            Process p = new ProcessBuilder("powershell.exe", "-NoProfile", "-NonInteractive",
                    "-ExecutionPolicy", "Bypass", "-File", script.toString())
                    .redirectErrorStream(true).start();
            String salida = new String(leer(p.getInputStream()), StandardCharsets.UTF_8);
            if (p.waitFor() != 0) throw new IOException("No se pudieron crear los accesos directos:\n" + salida);
        } finally {
            Files.deleteIfExists(script);
        }
    }

    /** Texto entre comillas simples para PowerShell (duplica las comillas internas). */
    private static String q(String s) { return "'" + s.replace("'", "''") + "'"; }

    private static byte[] leer(InputStream in) throws IOException {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] b = new byte[4096];
        int n;
        while ((n = in.read(b)) > 0) out.write(b, 0, n);
        return out.toByteArray();
    }

    private static String huella(Path p) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] h = md.digest(Files.readAllBytes(p));
            StringBuilder sb = new StringBuilder();
            for (byte x : h) sb.append(String.format("%02x", x));
            return sb.toString();
        } catch (Exception e) {
            return "?" + p;
        }
    }
}
