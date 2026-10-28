package ar.inofer.mes;

import java.awt.Desktop;
import java.io.File;
import java.net.URI;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Abre la interfaz en una ventana propia (sin barras de navegador) usando el
 * motor de Microsoft Edge, que viene instalado en todas las PC con Windows 10/11.
 * Si no lo encuentra, prueba con Google Chrome y, como último recurso, con el
 * navegador predeterminado.
 */
public final class Navegador {

    private Navegador() { }

    public static String buscarMotor() {
        List<String> candidatos = new ArrayList<>();
        String pf86 = System.getenv("ProgramFiles(x86)");
        String pf = System.getenv("ProgramFiles");
        String local = System.getenv("LOCALAPPDATA");
        if (pf86 != null) candidatos.add(pf86 + "\\Microsoft\\Edge\\Application\\msedge.exe");
        if (pf != null) candidatos.add(pf + "\\Microsoft\\Edge\\Application\\msedge.exe");
        if (pf != null) candidatos.add(pf + "\\Google\\Chrome\\Application\\chrome.exe");
        if (pf86 != null) candidatos.add(pf86 + "\\Google\\Chrome\\Application\\chrome.exe");
        if (local != null) candidatos.add(local + "\\Google\\Chrome\\Application\\chrome.exe");
        // Linux / Mac (para pruebas)
        candidatos.addAll(Arrays.asList("/usr/bin/microsoft-edge", "/usr/bin/google-chrome", "/usr/bin/chromium",
                "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"));
        for (String c : candidatos) if (new File(c).isFile()) return c;
        return null;
    }

    /**
     * Abre la ventana de la aplicación. Devuelve el proceso del navegador
     * (o null si se usó el navegador predeterminado).
     */
    public static Process abrir(String url, Path perfil) throws Exception {
        String motor = buscarMotor();
        if (motor != null) {
            List<String> cmd = new ArrayList<>(Arrays.asList(
                    motor,
                    "--app=" + url,
                    "--user-data-dir=" + perfil.toAbsolutePath(),
                    "--window-size=1400,900",
                    "--no-first-run",
                    "--no-default-browser-check",
                    "--disable-features=msEdgeSidebarV2,msHubApps,msEdgeTranslate"));
            return new ProcessBuilder(cmd).start();
        }
        if (Desktop.isDesktopSupported() && Desktop.getDesktop().isSupported(Desktop.Action.BROWSE)) {
            Desktop.getDesktop().browse(new URI(url));
            return null;
        }
        throw new IllegalStateException("No se encontró ningún navegador (Edge o Chrome) en esta PC.");
    }
}
