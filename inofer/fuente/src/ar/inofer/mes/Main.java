package ar.inofer.mes;

import javax.imageio.ImageIO;
import javax.swing.*;
import java.awt.*;
import java.awt.event.WindowAdapter;
import java.awt.event.WindowEvent;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;

/**
 * INOFER — Aplicación de escritorio en Java.
 *
 * Al hacer doble clic en INOFER.jar:
 *  1. Se inicia un servidor interno en esta PC (127.0.0.1) con el sistema completo.
 *  2. Se abre el sistema en su propia ventana.
 *  3. Todos los datos se guardan en %APPDATA%\INOFER_MES\datos.json (con respaldos diarios).
 *  4. Aparece un pequeño panel de control para volver a abrir la ventana, ver los datos o salir.
 *
 * Si el programa ya está abierto, un segundo doble clic solo trae la ventana al frente.
 */
public final class Main {

    public static final String VERSION = "2.5";
    private static final int PUERTO_BASE = 47821;

    private static ServidorLocal servidor;
    private static Almacen almacen;
    private static Actualizador actualizador;
    private static Process ventanaNavegador;
    private static JLabel estado;

    public static void main(String[] args) throws Exception {
        if (Arrays_contains(args, "--aplicar-actualizacion")) { // ejecutado desde INOFER-nuevo.jar
            Instalador.aplicarActualizacion();
            System.exit(0);
            return;
        }
        boolean sinVentana = GraphicsEnvironment.isHeadless() || Arrays_contains(args, "--sin-ventana");
        if (!sinVentana) {
            try { UIManager.setLookAndFeel(UIManager.getSystemLookAndFeelClassName()); } catch (Exception ignored) { }
        }

        almacen = new Almacen();
        actualizador = new Actualizador(almacen);
        servidor = new ServidorLocal(almacen, actualizador);

        // ¿Ya hay un INOFER abierto? -> solo abrir la ventana y salir
        for (int p = PUERTO_BASE; p < PUERTO_BASE + 10; p++) {
            if (esInoferAbierto(p)) {
                if (!sinVentana && Instalador.esWindows() && !Instalador.ejecutandoInstalado()
                        && Instalador.jarActual() != null && !Instalador.instaladoYAlDia()) {
                    JOptionPane.showMessageDialog(null,
                            "INOFER ya está abierto.\n\nPara instalar o actualizar con este archivo:\n"
                            + "1. Cerrá INOFER (botón Salir del panel INOFER).\n"
                            + "2. Volvé a hacer doble clic en este archivo.",
                            "INOFER", JOptionPane.INFORMATION_MESSAGE);
                }
                abrirVentana("http://127.0.0.1:" + p + "/");
                System.exit(0);
                return;
            }
            if (p == PUERTO_BASE && Instalador.lanzarReemplazoSiHay()) { // hay un INOFER.jar nuevo: se instala y se reabre
                System.exit(0);
                return;
            }
            if (servidor.iniciar(p)) break;
        }
        if (servidor.getPuerto() == 0) {
            error("No se pudo iniciar INOFER: los puertos " + PUERTO_BASE + "-" + (PUERTO_BASE + 9) + " están ocupados.");
            System.exit(1);
        }
        System.out.println("INOFER " + VERSION + " funcionando en " + servidor.getUrl());
        System.out.println("Datos: " + almacen.getCarpeta());

        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            servidor.detener();
            if (ventanaNavegador != null && ventanaNavegador.isAlive()) ventanaNavegador.destroy();
        }));

        // Actualizaciones: revisión rápida al abrir (máx. 4 s) y luego cada 15 minutos
        actualizador.buscar(4000, false);
        Thread revisor = new Thread(() -> {
            try { Thread.sleep(20000); } catch (InterruptedException e) { return; }
            while (true) {
                actualizador.buscar(15000, true);
                try { Thread.sleep(15 * 60 * 1000L); } catch (InterruptedException e) { return; }
            }
        }, "actualizaciones");
        revisor.setDaemon(true);
        revisor.start();

        if (sinVentana) {
            Thread.currentThread().join(); // modo servidor (pruebas)
            return;
        }

        if (Instalador.esWindows() && Instalador.jarActual() != null && !Instalador.ejecutandoInstalado()) {
            SwingUtilities.invokeAndWait(Main::ofrecerInstalacion);
        }
        SwingUtilities.invokeLater(Main::crearPanel);
        abrirVentana(servidor.getUrl());
        vigilarVentana();
    }

    // ------------------------------------------------------------------ instalación

    /** Primera vez (o versión nueva): ofrece instalar INOFER con su ícono. */
    private static void ofrecerInstalacion() {
        String msg;
        if (!Instalador.hayInstalacion()) {
            msg = "¿Instalar INOFER en esta PC?\n\n"
                + "Se crea el ícono \"INOFER\" en el Escritorio y en el menú Inicio,\n"
                + "para abrirlo siempre desde ahí. Tus datos no se modifican.";
        } else if (!Instalador.instaladoYAlDia()) {
            msg = "Este archivo es una versión distinta de INOFER que la instalada.\n\n"
                + "¿Actualizar INOFER con esta versión? Tus datos no se modifican.";
        } else {
            return;
        }
        int r = JOptionPane.showConfirmDialog(null, msg, "Instalar INOFER", JOptionPane.YES_NO_OPTION, JOptionPane.QUESTION_MESSAGE,
                cargarIcono() != null ? new ImageIcon(cargarIcono().getScaledInstance(64, 64, Image.SCALE_SMOOTH)) : null);
        if (r == JOptionPane.YES_OPTION) instalarConAviso(null);
    }

    private static void instalarConAviso(Component padre) {
        try {
            String res = Instalador.instalar();
            JOptionPane.showMessageDialog(padre, res, "INOFER", JOptionPane.INFORMATION_MESSAGE);
        } catch (Exception ex) {
            error("No se pudo instalar INOFER:\n" + ex.getMessage());
        }
    }

    // ------------------------------------------------------------------ panel de control

    private static void crearPanel() {
        JFrame f = new JFrame("INOFER");
        Image icono = cargarIcono();
        if (icono != null) f.setIconImage(icono);
        f.setDefaultCloseOperation(WindowConstants.DO_NOTHING_ON_CLOSE);
        f.addWindowListener(new WindowAdapter() {
            @Override public void windowClosing(WindowEvent e) { salir(f); }
        });

        Color fondo = new Color(15, 23, 42);
        JPanel p = new JPanel(new BorderLayout(12, 12));
        p.setBackground(fondo);
        p.setBorder(BorderFactory.createEmptyBorder(16, 18, 16, 18));

        JLabel titulo = new JLabel("<html><span style='font-size:15px;color:#38bdf8'><b>INOFER</b></span>"
                + "<br><span style='color:#cbd5e1'>Sistema de Inyección, Órdenes y Planificación</span></html>");
        if (icono != null) titulo.setIcon(new ImageIcon(icono.getScaledInstance(48, 48, Image.SCALE_SMOOTH)));
        titulo.setIconTextGap(12);
        p.add(titulo, BorderLayout.NORTH);

        estado = new JLabel("<html><span style='color:#34d399'>● Funcionando</span>"
                + "<br><span style='color:#94a3b8'>Los datos se guardan automáticamente en esta PC.</span></html>");
        p.add(estado, BorderLayout.CENTER);

        JPanel botones = new JPanel(new GridLayout(3, 2, 8, 8));
        botones.setOpaque(false);
        botones.add(boton("Abrir INOFER", () -> abrirVentana(servidor.getUrl())));
        botones.add(boton("Crear ícono en Escritorio", () -> instalarConAviso(f)));
        botones.add(boton("Copia de seguridad", () -> {
            try {
                Path r = almacen.respaldoAhora();
                JOptionPane.showMessageDialog(f, "Copia guardada en:\n" + r, "INOFER", JOptionPane.INFORMATION_MESSAGE);
            } catch (Exception ex) { error("No se pudo hacer la copia: " + ex.getMessage()); }
        }));
        botones.add(boton("Carpeta de datos", () -> {
            try { Desktop.getDesktop().open(almacen.getCarpeta().toFile()); }
            catch (Exception ex) { JOptionPane.showMessageDialog(f, almacen.getCarpeta().toString()); }
        }));
        botones.add(boton("Buscar actualizaciones", () -> {
            boolean web = actualizador.buscar(15000, true);
            String msg;
            if (actualizador.getUrlBase() == null) msg = "Las actualizaciones automáticas no están configuradas.";
            else if (!actualizador.getUltimoError().isEmpty()) msg = actualizador.getUltimoError() + ".\nSe reintenta solo cada 15 minutos.";
            else if (web) msg = "Se descargó una versión nueva de las pantallas.\nEn la ventana de INOFER tocá \"Actualizar ahora\".";
            else if (actualizador.isJarPendiente()) msg = "Hay una mejora del programa descargada.\nSe instala sola la próxima vez que abras INOFER.";
            else msg = "INOFER ya está actualizado.\nPantallas: " + actualizador.versionPaginaActual() + " · Programa: " + VERSION;
            JOptionPane.showMessageDialog(f, msg, "INOFER", JOptionPane.INFORMATION_MESSAGE);
        }));
        botones.add(boton("Salir", () -> salir(f)));
        p.add(botones, BorderLayout.SOUTH);

        f.setContentPane(p);
        f.pack();
        f.setResizable(false);
        f.setLocationByPlatform(true);
        f.setVisible(true);
        f.setState(Frame.ICONIFIED); // queda minimizado en la barra de tareas
    }

    private static JButton boton(String texto, Runnable accion) {
        JButton b = new JButton(texto);
        b.setFocusPainted(false);
        b.addActionListener(e -> accion.run());
        return b;
    }

    private static void salir(Component padre) {
        int r = JOptionPane.showConfirmDialog(padre,
                "¿Cerrar INOFER?\nLos datos ya están guardados.", "INOFER",
                JOptionPane.YES_NO_OPTION, JOptionPane.QUESTION_MESSAGE);
        if (r == JOptionPane.YES_OPTION) System.exit(0);
    }

    // ------------------------------------------------------------------ ventana del sistema

    private static synchronized void abrirVentana(String url) {
        try {
            Path perfil = almacen.getCarpeta().resolve("ventana");
            Process p = Navegador.abrir(url, perfil);
            if (p != null) ventanaNavegador = p;
        } catch (Exception e) {
            error("No se pudo abrir la ventana del sistema.\n" + e.getMessage()
                    + "\n\nPodés abrirlo manualmente en el navegador con:\n" + url);
        }
    }

    /** Cuando el usuario cierra la ventana del sistema, el programa también se cierra. */
    private static void vigilarVentana() {
        Thread t = new Thread(() -> {
            while (true) {
                try {
                    Process p = ventanaNavegador;
                    if (p != null) {
                        long inicio = System.currentTimeMillis();
                        p.waitFor();
                        boolean vivioSuficiente = System.currentTimeMillis() - inicio > 5000;
                        if (p == ventanaNavegador && vivioSuficiente) {
                            Thread.sleep(1500); // margen para que termine de guardar
                            System.exit(0);
                        }
                    }
                    Thread.sleep(1000);
                } catch (InterruptedException e) { return; }
            }
        }, "vigia-ventana");
        t.setDaemon(true);
        t.start();
    }

    // ------------------------------------------------------------------ utilidades

    private static boolean esInoferAbierto(int puerto) {
        try {
            HttpURLConnection c = (HttpURLConnection) new URL("http://127.0.0.1:" + puerto + "/api/ping").openConnection();
            c.setConnectTimeout(400);
            c.setReadTimeout(800);
            try (InputStream in = c.getInputStream()) {
                byte[] b = new byte[64];
                int n = in.read(b);
                return n > 0 && new String(b, 0, n, StandardCharsets.UTF_8).startsWith(ServidorLocal.FIRMA);
            }
        } catch (Exception e) {
            return false;
        }
    }

    private static Image cargarIcono() {
        try {
            byte[] b = ServidorLocal.recurso("/icon.png");
            if (b == null) return null;
            BufferedImage img = ImageIO.read(new ByteArrayInputStream(b));
            return img;
        } catch (Exception e) { return null; }
    }

    private static void error(String msg) {
        System.err.println(msg);
        if (!GraphicsEnvironment.isHeadless()) {
            JOptionPane.showMessageDialog(null, msg, "INOFER", JOptionPane.ERROR_MESSAGE);
        }
    }

    private static boolean Arrays_contains(String[] a, String v) {
        for (String s : a) if (v.equals(s)) return true;
        return false;
    }
}
