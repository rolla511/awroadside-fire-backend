import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URLConnection;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.stream.Collectors;
import java.util.stream.Stream;

public class Main {
    private static final int DEFAULT_PORT = 8080;
    private static final String DEFAULT_HOST = "127.0.0.1";
    private static final Path WEB_ROOT = Path.of("web").toAbsolutePath().normalize();
    private static final Path APP_ROOT = Path.of("app").toAbsolutePath().normalize();
    private static final Path RUNTIME_ROOT = APP_ROOT.resolve("runtime");
    private static final Path REPORTS_ROOT = RUNTIME_ROOT.resolve("reports");
    private static final Path LOGS_ROOT = RUNTIME_ROOT.resolve("logs");
    private static final DateTimeFormatter DISPLAY_TIME =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss").withZone(ZoneId.systemDefault());

    public static void main(String[] args) throws IOException {
        ensureDefaultFiles();

        String host = args.length > 0 ? args[0] : DEFAULT_HOST;
        int port = args.length > 1 ? Integer.parseInt(args[1]) : DEFAULT_PORT;
        Instant startedAt = Instant.now();
        writeRuntimeArtifacts(host, port, startedAt);

        HttpServer server = HttpServer.create(new InetSocketAddress(host, port), 0);
        server.createContext("/api/health", new JsonHandler(() -> """
                {
                  "status": "ok",
                  "service": "local-backend",
                  "timestamp": "%s"
                }
                """.formatted(Instant.now())));
        server.createContext("/api/frontend-config", new JsonHandler(() -> """
                {
                  "apiBaseUrl": "http://%s:%d/api",
                  "uiBaseUrl": "http://%s:%d",
                  "expectedHtmlIntegrationPath": "web/index.html",
                  "syncMode": "local",
                  "runtimeFolder": "app/runtime"
                }
                """.formatted(host, port, host, port)));
        server.createContext("/api/integration-target", new JsonHandler(() -> """
                {
                  "status": "awaiting-html-location",
                  "message": "Provide the frontend integration location and expected API fields.",
                  "expectedPayload": {
                    "htmlFile": "absolute-or-project-relative-path",
                    "mountSelector": "#app",
                    "apiConsumer": "fetch('%s/api/health')"
                  }
                }
                """.formatted("http://" + host + ":" + port)));
        server.createContext("/api/runtime/status", new JsonHandler(() -> runtimeStatusJson(host, port, startedAt)));
        server.createContext("/api/runtime/files", new JsonHandler(Main::runtimeFilesJson));
        server.createContext("/", new StaticFileHandler());
        server.setExecutor(Executors.newFixedThreadPool(4));
        server.start();

        System.out.println("Local backend running at http://" + host + ":" + port);
        System.out.println("Health endpoint: http://" + host + ":" + port + "/api/health");
        System.out.println("Frontend config: http://" + host + ":" + port + "/api/frontend-config");
        System.out.println("Runtime status: http://" + host + ":" + port + "/api/runtime/status");
        System.out.println("Serving static files from " + WEB_ROOT);
        System.out.println("Runtime artifacts in " + RUNTIME_ROOT);
        System.out.println("Press Ctrl+C to stop.");
    }

    private static void ensureDefaultFiles() throws IOException {
        Files.createDirectories(WEB_ROOT);
        Files.createDirectories(REPORTS_ROOT);
        Files.createDirectories(LOGS_ROOT);

        Path index = WEB_ROOT.resolve("index.html");
        if (Files.notExists(index)) {
            Files.writeString(index, defaultHtml(), StandardCharsets.UTF_8);
        }

        Path styles = WEB_ROOT.resolve("styles.css");
        if (Files.notExists(styles)) {
            Files.writeString(styles, defaultCss(), StandardCharsets.UTF_8);
        }
    }

    private static void writeRuntimeArtifacts(String host, int port, Instant startedAt) throws IOException {
        Files.createDirectories(REPORTS_ROOT);
        Files.createDirectories(LOGS_ROOT);

        Path manifest = RUNTIME_ROOT.resolve("manifest.json");
        Files.writeString(manifest, """
                {
                  "app": "local-runtime-demo",
                  "host": "%s",
                  "port": %d,
                  "startedAt": "%s",
                  "uiUrl": "http://%s:%d/",
                  "apiUrl": "http://%s:%d/api/runtime/status"
                }
                """.formatted(host, port, startedAt, host, port, host, port), StandardCharsets.UTF_8);

        Path report = REPORTS_ROOT.resolve("startup-report.txt");
        Files.writeString(report, """
                Local Runtime Startup Report
                Started: %s
                UI: http://%s:%d/
                API: http://%s:%d/api/runtime/status
                Runtime Folder: %s
                """.formatted(DISPLAY_TIME.format(startedAt), host, port, host, port, RUNTIME_ROOT),
                StandardCharsets.UTF_8);

        Path log = LOGS_ROOT.resolve("session.log");
        Files.writeString(log, """
                [%s] Runtime initialized for %s:%d
                """.formatted(DISPLAY_TIME.format(startedAt), host, port), StandardCharsets.UTF_8);
    }

    private static String defaultHtml() {
        return """
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Runtime Viewer</title>
                    <link rel="stylesheet" href="/styles.css">
                </head>
                <body>
                    <div class="shell">
                        <section class="hero">
                            <p class="eyebrow">Runtime Build Visible</p>
                            <h1>Local app, backend, and generated folders are live.</h1>
                            <p class="copy">
                                This page reads the local API and shows the runtime files created in IntelliJ.
                            </p>
                            <div class="actions">
                                <a class="button" href="/api/runtime/status" target="_blank" rel="noreferrer">Open runtime API</a>
                                <a class="button ghost" href="/api/runtime/files" target="_blank" rel="noreferrer">Open file manifest</a>
                            </div>
                        </section>

                        <section class="panel">
                            <div class="panel-head">
                                <h2>Runtime Status</h2>
                                <button id="refreshButton" class="mini-button" type="button">Refresh</button>
                            </div>
                            <pre id="statusBox">Loading status...</pre>
                        </section>

                        <section class="panel">
                            <div class="panel-head">
                                <h2>Generated Files</h2>
                                <span class="badge">app/runtime</span>
                            </div>
                            <ul id="fileList" class="file-list">
                                <li>Loading files...</li>
                            </ul>
                        </section>
                    </div>
                    <script>
                        async function loadRuntime() {
                            const [statusResponse, filesResponse] = await Promise.all([
                                fetch('/api/runtime/status'),
                                fetch('/api/runtime/files')
                            ]);

                            const status = await statusResponse.json();
                            const files = await filesResponse.json();

                            document.getElementById('statusBox').textContent = JSON.stringify(status, null, 2);
                            document.getElementById('fileList').innerHTML = files.files
                                .map((file) => `<li><code>${file}</code></li>`)
                                .join('');
                        }

                        document.getElementById('refreshButton').addEventListener('click', loadRuntime);
                        loadRuntime().catch((error) => {
                            document.getElementById('statusBox').textContent = error.message;
                        });
                    </script>
                </body>
                </html>
                """;
    }

    private static String defaultCss() {
        return """
                :root {
                    color-scheme: light;
                    --bg: #ebe6dc;
                    --panel: rgba(255, 250, 245, 0.82);
                    --text: #182126;
                    --accent: #c5541b;
                    --accent-dark: #8a3310;
                    --line: rgba(24, 33, 38, 0.12);
                    --shadow: 0 24px 60px rgba(82, 49, 26, 0.16);
                }

                * {
                    box-sizing: border-box;
                }

                body {
                    margin: 0;
                    min-height: 100vh;
                    font-family: Georgia, "Times New Roman", serif;
                    background:
                        radial-gradient(circle at top, rgba(197, 84, 27, 0.22), transparent 30%),
                        linear-gradient(135deg, #f6f1e8, #e7dbc9 50%, #d7c5af);
                    color: var(--text);
                }

                .shell {
                    width: min(1100px, calc(100vw - 32px));
                    margin: 0 auto;
                    padding: 40px 0 56px;
                }

                .hero {
                    padding: 48px;
                    border-radius: 28px;
                    background: var(--panel);
                    backdrop-filter: blur(10px);
                    box-shadow: var(--shadow);
                }

                .eyebrow {
                    margin: 0 0 12px;
                    text-transform: uppercase;
                    letter-spacing: 0.18em;
                    font-size: 0.8rem;
                    color: var(--accent-dark);
                }

                h1 {
                    margin: 0;
                    font-size: clamp(2.4rem, 7vw, 4.8rem);
                    line-height: 0.95;
                }

                .copy {
                    margin: 24px 0 0;
                    max-width: 50ch;
                    font-size: 1.1rem;
                    line-height: 1.6;
                }

                .actions {
                    display: flex;
                    gap: 12px;
                    flex-wrap: wrap;
                    margin-top: 24px;
                }

                code {
                    padding: 0.15rem 0.45rem;
                    border-radius: 999px;
                    background: rgba(31, 42, 44, 0.08);
                    font-family: "SFMono-Regular", Consolas, monospace;
                }

                .button {
                    display: inline-block;
                    margin-top: 24px;
                    padding: 14px 18px;
                    border-radius: 999px;
                    background: var(--accent);
                    color: #fffaf4;
                    text-decoration: none;
                    font-weight: 700;
                    border: 0;
                    cursor: pointer;
                }

                .button:hover {
                    background: var(--accent-dark);
                }

                .ghost {
                    background: rgba(24, 33, 38, 0.08);
                    color: var(--text);
                }

                .ghost:hover {
                    background: rgba(24, 33, 38, 0.14);
                }

                .panel {
                    margin-top: 20px;
                    padding: 28px;
                    border-radius: 24px;
                    background: var(--panel);
                    box-shadow: var(--shadow);
                }

                .panel-head {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 12px;
                }

                h2 {
                    margin: 0;
                    font-size: 1.4rem;
                }

                .mini-button,
                .badge {
                    padding: 10px 14px;
                    border-radius: 999px;
                    background: rgba(24, 33, 38, 0.08);
                    border: 1px solid var(--line);
                    font: inherit;
                }

                .mini-button {
                    cursor: pointer;
                }

                pre {
                    margin: 20px 0 0;
                    padding: 18px;
                    overflow: auto;
                    border-radius: 18px;
                    background: #201a17;
                    color: #f5ebde;
                    font-family: "SFMono-Regular", Consolas, monospace;
                    line-height: 1.5;
                }

                .file-list {
                    margin: 20px 0 0;
                    padding: 0;
                    list-style: none;
                }

                .file-list li {
                    padding: 12px 0;
                    border-top: 1px solid var(--line);
                }

                .file-list li:first-child {
                    border-top: 0;
                    padding-top: 0;
                }

                @media (max-width: 640px) {
                    .shell {
                        width: min(100vw - 20px, 1100px);
                        padding-top: 20px;
                    }

                    .hero {
                        padding: 28px;
                    }

                    .panel {
                        padding: 20px;
                    }

                    .panel-head {
                        flex-direction: column;
                        align-items: flex-start;
                    }
                }
                """;
    }

    private static String runtimeStatusJson(String host, int port, Instant startedAt) {
        return """
                {
                  "status": "running",
                  "host": "%s",
                  "port": %d,
                  "startedAt": "%s",
                  "startedAtDisplay": "%s",
                  "uiUrl": "http://%s:%d/",
                  "apiBaseUrl": "http://%s:%d/api",
                  "projectFolders": [
                    "src",
                    "web",
                    "app/runtime",
                    "app/runtime/reports",
                    "app/runtime/logs"
                  ]
                }
                """.formatted(host, port, startedAt, DISPLAY_TIME.format(startedAt), host, port, host, port);
    }

    private static String runtimeFilesJson() throws IOException {
        List<String> files;
        try (Stream<Path> stream = Files.walk(APP_ROOT)) {
            files = stream
                    .filter(Files::isRegularFile)
                    .map(APP_ROOT::relativize)
                    .map(Path::toString)
                    .sorted()
                    .collect(Collectors.toList());
        }

        String jsonFiles = files.stream()
                .map(path -> "    \"" + path.replace("\\", "/") + "\"")
                .collect(Collectors.joining(",\n"));

        return """
                {
                  "root": "app",
                  "files": [
                %s
                  ]
                }
                """.formatted(jsonFiles);
    }

    private static class StaticFileHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if ("OPTIONS".equalsIgnoreCase(exchange.getRequestMethod())) {
                sendNoContent(exchange);
                return;
            }

            String requestPath = exchange.getRequestURI().getPath();
            Path filePath = resolvePath(requestPath);

            if (filePath == null || Files.isDirectory(filePath) || Files.notExists(filePath)) {
                send(exchange, 404, "Not Found", "text/plain; charset=UTF-8");
                return;
            }

            byte[] body = Files.readAllBytes(filePath);
            Headers headers = exchange.getResponseHeaders();
            headers.set("Content-Type", contentType(filePath));
            send(exchange, 200, body);
        }

        private Path resolvePath(String requestPath) {
            String sanitized = "/".equals(requestPath) ? "/index.html" : requestPath;
            Path candidate = WEB_ROOT.resolve(sanitized.substring(1)).normalize();
            return candidate.startsWith(WEB_ROOT) ? candidate : null;
        }

        private String contentType(Path filePath) {
            String detected = URLConnection.guessContentTypeFromName(filePath.getFileName().toString());
            return detected != null ? detected : "application/octet-stream";
        }

        private void send(HttpExchange exchange, int statusCode, String body, String contentType) throws IOException {
            Headers headers = exchange.getResponseHeaders();
            applyDefaultHeaders(headers);
            headers.set("Content-Type", contentType);
            send(exchange, statusCode, body.getBytes(StandardCharsets.UTF_8));
        }

        private void send(HttpExchange exchange, int statusCode, byte[] body) throws IOException {
            applyDefaultHeaders(exchange.getResponseHeaders());
            exchange.sendResponseHeaders(statusCode, body.length);
            try (OutputStream outputStream = exchange.getResponseBody()) {
                outputStream.write(body);
            }
        }

        private void sendNoContent(HttpExchange exchange) throws IOException {
            Headers headers = exchange.getResponseHeaders();
            applyDefaultHeaders(headers);
            exchange.sendResponseHeaders(204, -1);
            exchange.close();
        }
    }

    private static class JsonHandler implements HttpHandler {
        private final JsonSupplier supplier;

        private JsonHandler(JsonSupplier supplier) {
            this.supplier = supplier;
        }

        @Override
        public void handle(HttpExchange exchange) throws IOException {
            Headers headers = exchange.getResponseHeaders();
            applyDefaultHeaders(headers);
            headers.set("Content-Type", "application/json; charset=UTF-8");

            if ("OPTIONS".equalsIgnoreCase(exchange.getRequestMethod())) {
                exchange.sendResponseHeaders(204, -1);
                exchange.close();
                return;
            }

            if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
                byte[] body = """
                        {
                          "error": "method-not-allowed"
                        }
                        """.getBytes(StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(405, body.length);
                try (OutputStream outputStream = exchange.getResponseBody()) {
                    outputStream.write(body);
                }
                return;
            }

            byte[] body = supplier.get().getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, body.length);
            try (OutputStream outputStream = exchange.getResponseBody()) {
                outputStream.write(body);
            }
        }
    }

    @FunctionalInterface
    private interface JsonSupplier {
        String get() throws IOException;
    }

    private static void applyDefaultHeaders(Headers headers) {
        headers.set("Access-Control-Allow-Origin", "*");
        headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
        headers.set("Access-Control-Allow-Headers", "Content-Type");
    }
}
