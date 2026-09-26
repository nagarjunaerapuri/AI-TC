import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class Demo {

    private static final int PORT = 8080;

    private static final String API_KEY =
            System.getenv("GEMINI_API_KEY");

    private static final String MODEL =
            "gemini-3.1-flash-image";

    private static final HttpClient CLIENT =
            HttpClient.newHttpClient();

    public static void main(String[] args) throws Exception {

        if (API_KEY == null || API_KEY.isBlank()) {
            System.out.println(
                    "ERROR: GEMINI_API_KEY is not set."
            );
            System.out.println(
                    "Set your Google AI Studio API key as the GEMINI_API_KEY environment variable."
            );
            return;
        }

        HttpServer server = HttpServer.create(
                new InetSocketAddress(PORT), 0
        );

        server.createContext(
                "/api/generate-image",
                Demo::generateImage
        );

        server.createContext(
                "/",
                Demo::serveWebsite
        );

        server.setExecutor(null);
        server.start();

        System.out.println(
                "AI TC is running at http://localhost:" + PORT
        );
    }

    private static void generateImage(
            HttpExchange exchange
    ) throws IOException {

        addCors(exchange);

        if ("OPTIONS".equalsIgnoreCase(
                exchange.getRequestMethod()
        )) {
            send(exchange, 204, "");
            return;
        }

        if (!"POST".equalsIgnoreCase(
                exchange.getRequestMethod()
        )) {
            sendJson(
                    exchange,
                    405,
                    "{\"error\":\"POST method required\"}"
            );
            return;
        }

        try {

            String body = readBody(exchange);

            String prompt =
                    extractJsonString(body, "prompt");

            String aspectRatio =
                    extractJsonString(body, "aspectRatio");

            if (prompt == null || prompt.isBlank()) {
                sendJson(
                        exchange,
                        400,
                        "{\"error\":\"Prompt is required\"}"
                );
                return;
            }

            if (aspectRatio == null ||
                    aspectRatio.isBlank()) {
                aspectRatio = "1:1";
            }

            aspectRatio =
                    cleanAspectRatio(aspectRatio);

            String geminiResponse =
                    callGemini(prompt, aspectRatio);

            String image =
                    extractImageBase64(geminiResponse);

            if (image == null) {
                sendJson(
                        exchange,
                        500,
                        "{\"error\":\"No image was returned by Gemini.\"}"
                );
                return;
            }

            String result =
                    "{"
                    + "\"success\":true,"
                    + "\"image\":\""
                    + escapeJson(image)
                    + "\""
                    + "}";

            sendJson(
                    exchange,
                    200,
                    result
            );

        } catch (Exception e) {

            e.printStackTrace();

            String message =
                    e.getMessage() == null
                            ? "Image generation failed."
                            : e.getMessage();

            sendJson(
                    exchange,
                    500,
                    "{"
                    + "\"success\":false,"
                    + "\"error\":\""
                    + escapeJson(message)
                    + "\""
                    + "}"
            );
        }
    }

    private static String callGemini(
            String prompt,
            String aspectRatio
    ) throws Exception {

        String url =
                "https://generativelanguage.googleapis.com/v1beta/models/"
                + MODEL
                + ":generateContent";

        String requestBody =
                "{"
                + "\"contents\":["
                + "{"
                + "\"parts\":["
                + "{"
                + "\"text\":\""
                + escapeJson(prompt)
                + "\""
                + "}"
                + "]"
                + "}"
                + "],"
                + "\"generationConfig\":{"
                + "\"responseModalities\":[\"IMAGE\"],"
                + "\"imageConfig\":{"
                + "\"aspectRatio\":\""
                + aspectRatio
                + "\","
                + "\"imageSize\":\"1K\""
                + "}"
                + "}"
                + "}";

        HttpRequest request =
                HttpRequest.newBuilder()
                        .uri(URI.create(url))
                        .header(
                                "Content-Type",
                                "application/json"
                        )
                        .header(
                                "x-goog-api-key",
                                API_KEY
                        )
                        .POST(
                                HttpRequest.BodyPublishers
                                        .ofString(requestBody)
                        )
                        .build();

        HttpResponse<String> response =
                CLIENT.send(
                        request,
                        HttpResponse.BodyHandlers.ofString()
                );

        if (response.statusCode() < 200 ||
                response.statusCode() >= 300) {

            throw new Exception(
                    "Gemini API Error "
                    + response.statusCode()
                    + ": "
                    + response.body()
            );
        }

        return response.body();
    }

    private static String extractImageBase64(
            String json
    ) {

        Pattern pattern =
                Pattern.compile(
                        "\"data\"\\s*:\\s*\"([^\"]+)\""
                );

        Matcher matcher =
                pattern.matcher(json);

        if (matcher.find()) {
            return "data:image/png;base64,"
                    + matcher.group(1);
        }

        return null;
    }

    private static void serveWebsite(
            HttpExchange exchange
    ) throws IOException {

        addCors(exchange);

        String requestPath =
                exchange.getRequestURI()
                        .getPath();

        if (!requestPath.equals("/") &&
                !requestPath.equals("/index.html")) {

            send(
                    exchange,
                    404,
                    "Not Found"
            );
            return;
        }

        Path file =
                Paths.get("index.html");

        if (!Files.exists(file)) {

            send(
                    exchange,
                    404,
                    "index.html not found"
            );
            return;
        }

        byte[] data =
                Files.readAllBytes(file);

        exchange.getResponseHeaders()
                .set(
                        "Content-Type",
                        "text/html; charset=UTF-8"
                );

        exchange.sendResponseHeaders(
                200,
                data.length
        );

        try (OutputStream output =
                     exchange.getResponseBody()) {

            output.write(data);
        }
    }

    private static String readBody(
            HttpExchange exchange
    ) throws IOException {

        try (InputStream input =
                     exchange.getRequestBody()) {

            return new String(
                    input.readAllBytes(),
                    StandardCharsets.UTF_8
            );
        }
    }

    private static String extractJsonString(
            String json,
            String key
    ) {

        String regex =
                "\"" + Pattern.quote(key)
                + "\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"";

        Matcher matcher =
                Pattern.compile(regex)
                        .matcher(json);

        if (!matcher.find()) {
            return null;
        }

        return matcher.group(1)
                .replace("\\\"", "\"")
                .replace("\\\\", "\\")
                .replace("\\n", "\n")
                .replace("\\r", "\r")
                .replace("\\t", "\t");
    }

    private static String cleanAspectRatio(
            String ratio
    ) {

        String[] allowed = {
                "1:1",
                "16:9",
                "9:16",
                "4:3",
                "3:4",
                "4:5",
                "5:4",
                "3:2",
                "2:3",
                "21:9"
        };

        for (String value : allowed) {
            if (value.equals(ratio)) {
                return value;
            }
        }

        return "1:1";
    }

    private static String escapeJson(
            String value
    ) {

        if (value == null) {
            return "";
        }

        return value
                .replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                .replace("\t", "\\t");
    }

    private static void addCors(
            HttpExchange exchange
    ) {

        exchange.getResponseHeaders()
                .set(
                        "Access-Control-Allow-Origin",
                        "*"
                );

        exchange.getResponseHeaders()
                .set(
                        "Access-Control-Allow-Headers",
                        "Content-Type"
                );

        exchange.getResponseHeaders()
                .set(
                        "Access-Control-Allow-Methods",
                        "GET,POST,OPTIONS"
                );
    }

    private static void send(
            HttpExchange exchange,
            int status,
            String text
    ) throws IOException {

        byte[] data =
                text.getBytes(
                        StandardCharsets.UTF_8
                );

        exchange.getResponseHeaders()
                .set(
                        "Content-Type",
                        "text/plain; charset=UTF-8"
                );

        exchange.sendResponseHeaders(
                status,
                data.length
        );

        try (OutputStream output =
                     exchange.getResponseBody()) {

            output.write(data);
        }
    }

    private static void sendJson(
            HttpExchange exchange,
            int status,
            String json
    ) throws IOException {

        byte[] data =
                json.getBytes(
                        StandardCharsets.UTF_8
                );

        exchange.getResponseHeaders()
                .set(
                        "Content-Type",
                        "application/json; charset=UTF-8"
                );

        exchange.sendResponseHeaders(
                status,
                data.length
        );

        try (OutputStream output =
                     exchange.getResponseBody()) {

            output.write(data);
        }
    }
  }.,
