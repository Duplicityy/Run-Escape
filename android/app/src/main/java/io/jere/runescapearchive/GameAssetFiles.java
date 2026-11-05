package io.jere.runescapearchive;

import java.io.ByteArrayInputStream;
import java.io.Closeable;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URLConnection;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Serves an installed game beneath the same WebView address as the bundled game. */
public final class GameAssetFiles {
    private static final Pattern RANGE = Pattern.compile("bytes=(\\d*)-(\\d*)", Pattern.CASE_INSENSITIVE);

    private GameAssetFiles() { }

    public static final class Response implements Closeable {
        public final int status;
        public final String reason;
        public final String mime;
        public final Map<String, String> headers;
        public final InputStream body;

        private Response(int status, String reason, String mime, Map<String, String> headers,
                         InputStream body) {
            this.status = status;
            this.reason = reason;
            this.mime = mime;
            this.headers = Collections.unmodifiableMap(headers);
            this.body = body;
        }

        @Override
        public void close() throws IOException {
            body.close();
        }
    }

    // relativePath is already URL-decoded by Android's Uri.getPath().
    public static Response open(File root, String relativePath, String range) throws IOException {
        if (root == null || !safePath(relativePath) || !root.isDirectory()) return missing();
        Path directory = root.toPath().toRealPath();
        Path file = directory.resolve(relativePath).normalize();
        if (!file.startsWith(directory) || !Files.isRegularFile(file)) return missing();
        file = file.toRealPath();
        if (!file.startsWith(directory)) return missing();

        long length = Files.size(file);
        long first = 0;
        long last = length - 1;
        boolean partial = range != null;
        if (partial) {
            Matcher match = RANGE.matcher(range.trim());
            if (!match.matches() || length == 0) return unsatisfied(length);
            String start = match.group(1);
            String end = match.group(2);
            if (start.isEmpty() && end.isEmpty()) return unsatisfied(length);
            try {
                if (start.isEmpty()) {
                    long suffix = Long.parseLong(end);
                    if (suffix == 0) return unsatisfied(length);
                    first = suffix >= length ? 0 : length - suffix;
                } else {
                    first = Long.parseLong(start);
                    if (!end.isEmpty()) last = Math.min(Long.parseLong(end), last);
                    if (first >= length || first > last) return unsatisfied(length);
                }
            } catch (NumberFormatException exception) {
                return unsatisfied(length);
            }
        }

        long count = length == 0 ? 0 : last - first + 1;
        FileInputStream input = new FileInputStream(file.toFile());
        try {
            input.getChannel().position(first);
            Map<String, String> headers = headers(count);
            headers.put("Accept-Ranges", "bytes");
            if (partial) headers.put("Content-Range", "bytes " + first + "-" + last + "/" + length);
            return new Response(partial ? 206 : 200, partial ? "Partial Content" : "OK",
                    mime(relativePath), headers, new BoundedStream(input, count));
        } catch (IOException | RuntimeException exception) {
            input.close();
            throw exception;
        }
    }

    private static boolean safePath(String path) {
        if (path == null || path.isEmpty() || path.startsWith("/") || path.indexOf('\\') >= 0
                || path.indexOf('\0') >= 0 || path.indexOf(':') >= 0) return false;
        for (String part : path.split("/", -1)) {
            if (part.isEmpty() || part.equals(".") || part.equals("..")) return false;
        }
        return true;
    }

    private static Map<String, String> headers(long count) {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Content-Length", Long.toString(count));
        // The URL stays stable when the installed version changes.
        headers.put("Cache-Control", "no-store");
        return headers;
    }

    private static Response missing() {
        return new Response(404, "Not Found", "text/plain", headers(0),
                new ByteArrayInputStream(new byte[0]));
    }

    private static Response unsatisfied(long length) {
        Map<String, String> headers = headers(0);
        headers.put("Accept-Ranges", "bytes");
        headers.put("Content-Range", "bytes */" + length);
        return new Response(416, "Range Not Satisfiable", "text/plain", headers,
                new ByteArrayInputStream(new byte[0]));
    }

    private static String mime(String name) {
        String lower = name.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".wasm")) return "application/wasm";
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "text/javascript";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".webmanifest")) return "application/manifest+json";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
        String guessed = URLConnection.guessContentTypeFromName(name);
        return guessed == null ? "application/octet-stream" : guessed;
    }

    private static final class BoundedStream extends InputStream {
        private final InputStream input;
        private long remaining;
        private boolean closed;

        BoundedStream(InputStream input, long remaining) {
            this.input = input;
            this.remaining = remaining;
        }

        @Override
        public int read() throws IOException {
            checkOpen();
            if (remaining == 0) return -1;
            int value = input.read();
            if (value >= 0) remaining--;
            else remaining = 0;
            return value;
        }

        @Override
        public int read(byte[] bytes, int offset, int length) throws IOException {
            checkOpen();
            if (bytes == null) throw new NullPointerException();
            if (offset < 0 || length < 0 || offset > bytes.length - length) {
                throw new IndexOutOfBoundsException();
            }
            if (length == 0) return 0;
            if (remaining == 0) return -1;
            int count = input.read(bytes, offset, (int) Math.min(length, remaining));
            if (count >= 0) remaining -= count;
            else remaining = 0;
            return count;
        }

        @Override
        public long skip(long count) throws IOException {
            checkOpen();
            if (count <= 0) return 0;
            long skipped = input.skip(Math.min(count, remaining));
            remaining -= skipped;
            return skipped;
        }

        @Override
        public int available() throws IOException {
            checkOpen();
            return (int) Math.min(input.available(), remaining);
        }

        @Override
        public void close() throws IOException {
            if (closed) return;
            closed = true;
            input.close();
        }

        private void checkOpen() throws IOException {
            if (closed) throw new IOException("Stream is closed");
        }
    }
}
