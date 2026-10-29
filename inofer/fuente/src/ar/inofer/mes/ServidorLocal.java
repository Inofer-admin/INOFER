package ar.inofer.mes;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.Executors;

/**
 * Servidor web interno (solo accesible desde esta PC, 127.0.0.1).
 * Entrega la interfaz del sistema INOFER y recibe/entrega los datos que
 * se guardan en disco a través de {@link Almacen}.
 *
 *   GET  /              -> interfaz (index.html)
 *   GET  /api/ping      -> identifica al programa (para no abrirlo dos veces)
 *   GET  /api/datos     -> datos guardados
 *   POST /api/datos     -> guarda los datos
 */
public final class ServidorLocal {

    public static final String FIRMA = "INOFER_MES_JAVA";

    /** Script que se inserta en la página: sincroniza el almacenamiento del navegador con el archivo de Java. */
    private static final String PUENTE_JS =
        "<script>/* Puente INOFER (Java) */window.__INOFER_JAVA=true;(function(){\n" +
        "  try{var x=new XMLHttpRequest();x.open('GET','/api/datos?t='+Date.now(),false);x.send();\n" +
        "    if(x.status===200){var d=JSON.parse(x.responseText||'{}');var ks=Object.keys(d);\n" +
        "      if(ks.length){localStorage.clear();ks.forEach(function(k){localStorage.setItem(k,d[k]);});}}\n" +
        "  }catch(e){}\n" +
        "  function foto(){var o={};for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);o[k]=localStorage.getItem(k);}return JSON.stringify(o);}\n" +
        "  var t=null,ultimo=null;\n" +
        "  function guardar(){t=null;try{var f=foto();if(f===ultimo)return;ultimo=f;var x=new XMLHttpRequest();x.open('POST','/api/datos',true);x.setRequestHeader('Content-Type','application/json');x.send(f);}catch(e){}}\n" +
        "  function prog(){if(t)clearTimeout(t);t=setTimeout(guardar,300);}\n" +
        "  var S=Storage.prototype,s=S.setItem,r=S.removeItem,c=S.clear;\n" +
        "  S.setItem=function(){s.apply(this,arguments);if(this===window.localStorage)prog();};\n" +
        "  S.removeItem=function(){r.apply(this,arguments);if(this===window.localStorage)prog();};\n" +
        "  S.clear=function(){c.apply(this,arguments);if(this===window.localStorage)prog();};\n" +
        "  ultimo=foto();\n" +
        "  window.addEventListener('pagehide',function(){try{var f=foto();if(f!==ultimo&&navigator.sendBeacon){navigator.sendBeacon('/api/datos',new Blob([f],{type:'application/json'}));}}catch(e){}});\n" +
        "})();</script>\n";

    private static final Map<String, String> TIPOS = new HashMap<>();
    static {
        TIPOS.put("html", "text/html; charset=utf-8");
        TIPOS.put("js", "text/javascript; charset=utf-8");
        TIPOS.put("webmanifest", "application/manifest+json");
        TIPOS.put("json", "application/json; charset=utf-8");
        TIPOS.put("png", "image/png");
        TIPOS.put("ico", "image/x-icon");
    }

    private final Almacen almacen;
    private final Actualizador actualizador;
    private HttpServer server;
    private int puerto;
    private byte[] paginaCache;
    private String versionCache;

    public ServidorLocal(Almacen almacen, Actualizador actualizador) {
        this.almacen = almacen;
        this.actualizador = actualizador;
    }

    public int getPuerto() { return puerto; }
    public String getUrl() { return "http://127.0.0.1:" + puerto + "/"; }

    /** Intenta abrir el servidor en el puerto indicado. Devuelve false si está ocupado. */
    public boolean iniciar(int puertoDeseado) {
        try {
            server = HttpServer.create(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), puertoDeseado), 0);
        } catch (IOException e) {
            return false;
        }
        this.puerto = puertoDeseado;
        server.setExecutor(Executors.newFixedThreadPool(4, r -> { Thread t = new Thread(r, "inofer-http"); t.setDaemon(true); return t; }));
        server.createContext("/", this::atender);
        server.start();
        return true;
    }

    public void detener() { if (server != null) server.stop(0); }

    private void atender(HttpExchange ex) throws IOException {
        try {
            String ruta = ex.getRequestURI().getPath();
            String metodo = ex.getRequestMethod();

            // Protección: solo se aceptan pedidos dirigidos a esta misma PC
            String host = ex.getRequestHeaders().getFirst("Host");
            if (host == null || !(host.startsWith("127.0.0.1") || host.startsWith("localhost"))) {
                responder(ex, 403, "text/plain", "Prohibido".getBytes(StandardCharsets.UTF_8));
                return;
            }

            if (ruta.equals("/api/actualizar")) {
                // la pantalla pide revisar GitHub ya mismo (descarga la versión nueva si la hay)
                actualizador.buscar(15000, false);
                String v = actualizador.versionPaginaActual();
                String json = "{\"web\":\"" + v + "\",\"programa\":\"" + Main.VERSION + "\",\"programaPendiente\":" + actualizador.isJarPendiente() + "}";
                responder(ex, 200, TIPOS.get("json"), json.getBytes(StandardCharsets.UTF_8));
            } else if (ruta.equals("/api/version")) {
                String v = actualizador.versionPaginaActual();
                String json = "{\"web\":\"" + v + "\",\"programa\":\"" + Main.VERSION + "\",\"programaPendiente\":" + actualizador.isJarPendiente() + "}";
                responder(ex, 200, TIPOS.get("json"), json.getBytes(StandardCharsets.UTF_8));
            } else if (ruta.equals("/api/ping")) {
                responder(ex, 200, "text/plain", FIRMA.getBytes(StandardCharsets.UTF_8));
            } else if (ruta.equals("/api/datos")) {
                if ("POST".equalsIgnoreCase(metodo)) {
                    String cuerpo = new String(leerTodo(ex.getRequestBody()), StandardCharsets.UTF_8);
                    try {
                        almacen.guardar(cuerpo);
                        responder(ex, 200, TIPOS.get("json"), "{\"ok\":true}".getBytes(StandardCharsets.UTF_8));
                    } catch (IOException e) {
                        responder(ex, 400, TIPOS.get("json"), "{\"ok\":false}".getBytes(StandardCharsets.UTF_8));
                    }
                } else {
                    responder(ex, 200, TIPOS.get("json"), almacen.leer().getBytes(StandardCharsets.UTF_8));
                }
            } else if (ruta.equals("/") || ruta.equals("/index.html")) {
                responder(ex, 200, TIPOS.get("html"), pagina());
            } else {
                String recurso = ruta.replace("..", "");
                byte[] datos = recurso("/web" + recurso);
                if (datos == null) {
                    responder(ex, 404, "text/plain", "No encontrado".getBytes(StandardCharsets.UTF_8));
                } else {
                    String ext = recurso.contains(".") ? recurso.substring(recurso.lastIndexOf('.') + 1) : "";
                    responder(ex, 200, TIPOS.getOrDefault(ext, "application/octet-stream"), datos);
                }
            }
        } finally {
            ex.close();
        }
    }

    private synchronized byte[] pagina() throws IOException {
        String v = actualizador.versionPaginaActual();
        if (paginaCache == null || !v.equals(versionCache)) {
            byte[] b = actualizador.paginaActual();
            if (b == null) throw new IOException("Falta index.html dentro del programa");
            versionCache = v;
            String html = new String(b, StandardCharsets.UTF_8);
            int i = html.indexOf("<head>");
            html = (i >= 0)
                    ? html.substring(0, i + 6) + "\n" + PUENTE_JS + html.substring(i + 6)
                    : PUENTE_JS + html;
            paginaCache = html.getBytes(StandardCharsets.UTF_8);
        }
        return paginaCache;
    }

    static byte[] recurso(String ruta) throws IOException {
        try (InputStream in = ServidorLocal.class.getResourceAsStream(ruta)) {
            return in == null ? null : leerTodo(in);
        }
    }

    private static byte[] leerTodo(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return out.toByteArray();
    }

    private static void responder(HttpExchange ex, int codigo, String tipo, byte[] cuerpo) throws IOException {
        ex.getResponseHeaders().set("Content-Type", tipo);
        ex.getResponseHeaders().set("Cache-Control", "no-store");
        ex.sendResponseHeaders(codigo, cuerpo.length);
        try (OutputStream os = ex.getResponseBody()) { os.write(cuerpo); }
    }
}
