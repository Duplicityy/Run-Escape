package io.jere.runescapearchive;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/** Downloads the original desktop release's web game, without replacing the Android shell. */
public final class GameUpdater {
    static final String REPOSITORY = "Dynrothe/Run-Escape";
    static final String LATEST_URL = "https://api.github.com/repos/" + REPOSITORY + "/releases/latest";
    private static final String ASSET_PREFIX = "/" + REPOSITORY + "/releases/download/";
    private static final String SUPPORTED_LAUNCHER = "1.0.0";
    private static final String MARKER = "verified.json";
    private static final int MAX_JSON_BYTES = 512 * 1024;
    private static final long MAX_ZIP_BYTES = 128L * 1024 * 1024;
    private static final long MAX_GAME_BYTES = 256L * 1024 * 1024;
    private static final int MAX_ENTRIES = 10000;
    private static final long DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
    private static final Object INSTALL_LOCK = new Object();

    public static final class Game {
        public final String version;
        // Null means the immutable game bundled in the APK.
        public final File directory;

        public Game(String version, File directory) {
            requireVersion(version);
            this.version = version;
            this.directory = directory;
        }
    }

    public interface Progress {
        void onProgress(String message, int percent);
    }

    public static final class UnsupportedGameException extends IOException {
        public final String version;

        UnsupportedGameException(String version) {
            super("Game " + version + " needs an updated Android app");
            this.version = version;
        }
    }

    // Tests substitute bytes, but still exercise the production URL restrictions.
    interface Transport {
        Response open(String url) throws IOException;
        default void cancel() { }
    }

    static final class Response implements Closeable {
        final int status;
        final InputStream body;
        final long length;
        final String location;
        final Closeable connection;

        Response(int status, InputStream body, long length, String location) {
            this(status, body, length, location, () -> { });
        }

        Response(int status, InputStream body, long length, String location, Closeable connection) {
            this.status = status;
            this.body = body;
            this.length = length;
            this.location = location;
            this.connection = connection;
        }

        @Override
        public void close() throws IOException {
            try {
                body.close();
            } finally {
                connection.close();
            }
        }
    }

    private static final class HttpTransport implements Transport {
        private volatile boolean cancelled;
        private volatile HttpURLConnection active;

        @Override
        public Response open(String url) throws IOException {
            if (cancelled) throw new IOException("Update cancelled");
            HttpURLConnection connection = (HttpURLConnection) URI.create(url).toURL().openConnection();
            active = connection;
            if (cancelled) {
                connection.disconnect();
                throw new IOException("Update cancelled");
            }
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(5000);
            connection.setReadTimeout(15000);
            connection.setRequestProperty("Accept", "application/vnd.github+json");
            connection.setRequestProperty("User-Agent", "Run-Escape-Android");
            try {
                int status = connection.getResponseCode();
                InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                if (stream == null) stream = new ByteArrayInputStream(new byte[0]);
                return new Response(status, stream, connection.getContentLengthLong(),
                        connection.getHeaderField("Location"), () -> {
                            connection.disconnect();
                            if (active == connection) active = null;
                        });
            } catch (IOException exception) {
                connection.disconnect();
                if (active == connection) active = null;
                throw exception;
            }
        }

        @Override
        public void cancel() {
            cancelled = true;
            HttpURLConnection connection = active;
            if (connection != null) connection.disconnect();
        }
    }

    private static final class Manifest {
        final String version;
        final String sha256;
        final String minLauncher;

        Manifest(String json) throws IOException {
            try {
                JSONObject object = new JSONObject(json);
                version = object.getString("version");
                sha256 = object.getString("sha256");
                minLauncher = object.getString("minLauncher");
                requireVersion(version);
                requireVersion(minLauncher);
                if (!sha256.matches("[a-f0-9]{64}")) throw new IllegalArgumentException("Invalid SHA-256");
            } catch (JSONException | IllegalArgumentException exception) {
                throw new IOException("Invalid game manifest", exception);
            }
        }

        String json() throws IOException {
            try {
                return new JSONObject().put("version", version).put("sha256", sha256)
                        .put("minLauncher", minLauncher).toString();
            } catch (JSONException exception) {
                throw new IOException(exception);
            }
        }
    }

    private final File root;
    private final String bundledVersion;
    private final Transport transport;
    private volatile boolean cancelled;

    public GameUpdater(File storageRoot, String bundledVersion) {
        this(storageRoot, bundledVersion, new HttpTransport());
    }

    GameUpdater(File storageRoot, String bundledVersion, Transport transport) {
        requireVersion(bundledVersion);
        this.root = storageRoot;
        this.bundledVersion = bundledVersion;
        this.transport = transport;
    }

    public Game selectCurrent() throws IOException {
        Game selected = new Game(bundledVersion, null);
        for (Game game : installedGames()) {
            if (compareVersions(game.version, selected.version) > 0) selected = game;
        }
        return selected;
    }

    public Game update(Game current, Progress progress) throws IOException {
        checkCancelled();
        progress.onProgress("Checking for game updates…", -1);
        try (Response response = openLatest()) {
            if (response.status == 404) return current;
            requireOk(response);
            JSONObject release = new JSONObject(readText(response, MAX_JSON_BYTES));
            if (release.optBoolean("draft") || release.optBoolean("prerelease")) return current;
            String manifestUrl = asset(release, "game-manifest.json");
            if (manifestUrl == null) return current;
            Manifest manifest;
            try (Response manifestResponse = openAsset(manifestUrl)) {
                requireOk(manifestResponse);
                manifest = new Manifest(readText(manifestResponse, 16 * 1024));
            }
            if (!release.getString("tag_name").equals("v" + manifest.version)) {
                throw new IOException("Release tag and game version do not match");
            }
            if (compareVersions(manifest.version, current.version) <= 0 || isRejected(manifest.version)) {
                return current;
            }
            if (compareVersions(manifest.minLauncher, SUPPORTED_LAUNCHER) > 0) {
                throw new UnsupportedGameException(manifest.version);
            }
            for (Game installed : installedGames()) {
                if (installed.version.equals(manifest.version)) return installed;
            }
            String zipUrl = asset(release, "game-" + manifest.version + ".zip");
            if (zipUrl == null) throw new IOException("The release has no matching game ZIP");
            return install(manifest, zipUrl, progress);
        } catch (JSONException exception) {
            throw new IOException("Invalid release information", exception);
        }
    }

    // Run after the game's title UI starts. Keep a previous update as well as the APK fallback.
    public void confirm(Game game) throws IOException {
        synchronized (INSTALL_LOCK) {
            List<Game> installed = installedGames();
            installed.sort((a, b) -> compareVersions(b.version, a.version));
            Game previous = null;
            for (Game candidate : installed) {
                if (compareVersions(candidate.version, game.version) < 0) {
                    previous = candidate;
                    break;
                }
            }
            for (Game candidate : installed) {
                // An older Activity must not prune an update a newer one has already selected.
                if (compareVersions(candidate.version, game.version) < 0 && candidate != previous) {
                    deleteTree(candidate.directory);
                }
            }
        }
    }

    public void reject(Game game) throws IOException {
        if (game.directory == null) return;
        synchronized (INSTALL_LOCK) {
            File rejected = new File(root, "rejected");
            Files.createDirectories(rejected.toPath());
            Files.write(new File(rejected, game.version).toPath(), new byte[]{1});
            // Only directories owned by this updater can be removed.
            File expected = new File(new File(root, "games"), game.version);
            if (expected.getCanonicalFile().equals(game.directory.getCanonicalFile())) deleteTree(expected);
        }
    }

    // An explicit check can retry a corrected release or a game rejected before a WebView update.
    public void retryRejectedUpdates() throws IOException {
        synchronized (INSTALL_LOCK) {
            deleteTree(new File(root, "rejected"));
        }
    }

    public void cancel() {
        cancelled = true;
        transport.cancel();
    }

    public static int compareVersions(String a, String b) {
        requireVersion(a);
        requireVersion(b);
        String[] left = a.split("\\.");
        String[] right = b.split("\\.");
        for (int i = 0; i < 3; i++) {
            int comparison = Integer.compare(Integer.parseInt(left[i]), Integer.parseInt(right[i]));
            if (comparison != 0) return comparison;
        }
        return 0;
    }

    private static void requireVersion(String version) {
        if (version == null || !version.matches("[0-9]{1,9}\\.[0-9]{1,9}\\.[0-9]{1,9}")) {
            throw new IllegalArgumentException("Invalid game version");
        }
    }

    private List<Game> installedGames() throws IOException {
        List<Game> games = new ArrayList<>();
        File[] directories = new File(root, "games").listFiles();
        if (directories == null) return games;
        for (File directory : directories) {
            if (!Files.isDirectory(directory.toPath(), LinkOption.NOFOLLOW_LINKS)) continue;
            try {
                requireVersion(directory.getName());
                if (isRejected(directory.getName())) continue;
                Manifest marker = new Manifest(readLocalText(new File(directory, MARKER), 16 * 1024));
                if (!marker.version.equals(directory.getName())
                        || compareVersions(marker.minLauncher, SUPPORTED_LAUNCHER) > 0) continue;
                validateGame(directory);
                games.add(new Game(marker.version, directory));
            } catch (IOException | IllegalArgumentException ignored) {
                // An interrupted, incompatible or damaged install is never selected.
            }
        }
        return games;
    }

    private boolean isRejected(String version) {
        return new File(new File(root, "rejected"), version).exists();
    }

    private Game install(Manifest manifest, String url, Progress progress) throws IOException {
        Files.createDirectories(root.toPath());
        // A killed process cannot run finally. A live download has a ten-minute deadline, so
        // day-old staging folders cannot belong to another Activity's current operation.
        File[] abandoned = root.listFiles((parent, name) -> name.matches("pending-[a-f0-9-]{36}"));
        if (abandoned != null) {
            for (File directory : abandoned) {
                if (System.currentTimeMillis() - directory.lastModified() > 24L * 60 * 60 * 1000) {
                    deleteTree(directory);
                }
            }
        }
        File work = new File(root, "pending-" + UUID.randomUUID());
        Files.createDirectory(work.toPath());
        try {
            File zip = new File(work, "game.zip");
            MessageDigest hash = sha256();
            progress.onProgress("Downloading game " + manifest.version + "…", 0);
            long deadline = System.nanoTime() + DOWNLOAD_TIMEOUT_MS * 1000000;
            try (Response response = openAsset(url);
                 OutputStream output = Files.newOutputStream(zip.toPath())) {
                requireOk(response);
                if (response.length > MAX_ZIP_BYTES) throw new IOException("Game download is too large");
                byte[] buffer = new byte[32768];
                long total = 0;
                int read;
                int lastPercent = -2;
                while ((read = response.body.read(buffer)) != -1) {
                    checkCancelled();
                    if (System.nanoTime() > deadline) throw new IOException("Game download timed out");
                    total += read;
                    if (total > MAX_ZIP_BYTES) throw new IOException("Game download is too large");
                    hash.update(buffer, 0, read);
                    output.write(buffer, 0, read);
                    int percent = response.length > 0 ? (int) Math.min(100, total * 100 / response.length) : -1;
                    if (percent != lastPercent) {
                        progress.onProgress("Downloading game " + manifest.version + "…", percent);
                        lastPercent = percent;
                    }
                }
                if (response.length >= 0 && total != response.length) throw new IOException("Incomplete game download");
            }
            if (!hex(hash.digest()).equals(manifest.sha256)) throw new IOException("Game download failed its SHA-256 check");
            checkCancelled();
            progress.onProgress("Preparing game " + manifest.version + "…", -1);
            File extracted = new File(work, "game");
            extract(zip, extracted);
            validateGame(extracted);
            Files.write(new File(extracted, MARKER).toPath(), manifest.json().getBytes(StandardCharsets.UTF_8));
            checkCancelled();
            File games = new File(root, "games");
            Files.createDirectories(games.toPath());
            File destination = new File(games, manifest.version);
            synchronized (INSTALL_LOCK) {
                if (isRejected(manifest.version)) return selectCurrent();
                // A completed download is immutable, even if another Activity selected an older game.
                for (Game installed : installedGames()) {
                    if (installed.version.equals(manifest.version)) return installed;
                }
                deleteTree(destination);
                checkCancelled();
                Files.move(extracted.toPath(), destination.toPath(), StandardCopyOption.ATOMIC_MOVE);
            }
            return new Game(manifest.version, destination);
        } finally {
            deleteTree(work);
        }
    }

    private void extract(File zip, File target) throws IOException {
        Files.createDirectory(target.toPath());
        Set<String> names = new HashSet<>();
        int entries = 0;
        long total = 0;
        try (ZipInputStream input = new ZipInputStream(Files.newInputStream(zip.toPath()))) {
            ZipEntry entry;
            byte[] buffer = new byte[32768];
            while ((entry = input.getNextEntry()) != null) {
                checkCancelled();
                if (++entries > MAX_ENTRIES) throw new IOException("Too many game files");
                String name = entry.getName();
                File file = zipPath(target, name);
                if (!names.add(file.getCanonicalPath())) throw new IOException("Duplicate game file");
                if (entry.getSize() > MAX_GAME_BYTES) throw new IOException("Game file is too large");
                if (entry.isDirectory()) {
                    Files.createDirectories(file.toPath());
                    if (input.read() != -1) throw new IOException("Game directory contains file data");
                } else {
                    Files.createDirectories(file.getParentFile().toPath());
                    // ZipInputStream does not restore Unix symlinks: every entry becomes a plain file.
                    try (OutputStream output = Files.newOutputStream(file.toPath())) {
                        int read;
                        while ((read = input.read(buffer)) != -1) {
                            checkCancelled();
                            total += read;
                            if (total > MAX_GAME_BYTES) throw new IOException("Expanded game is too large");
                            output.write(buffer, 0, read);
                        }
                    }
                }
                input.closeEntry();
            }
        }
        if (entries == 0) throw new IOException("The game ZIP is empty");
    }

    static File zipPath(File target, String name) throws IOException {
        if (name == null || name.isEmpty() || name.length() > 1024 || name.startsWith("/")
                || name.indexOf('\\') >= 0 || name.indexOf(':') >= 0 || name.indexOf('\0') >= 0) {
            throw new IOException("Unsafe game file path");
        }
        String[] parts = name.split("/", -1);
        for (int i = 0; i < parts.length; i++) {
            String part = parts[i];
            if (i == parts.length - 1 && part.isEmpty()) continue;
            if (part.isEmpty() || part.equals(".") || part.equals("..")) throw new IOException("Unsafe game file path");
        }
        if (name.equals(MARKER)) throw new IOException("Reserved game file path");
        File file = new File(target, name);
        if (!file.getCanonicalPath().startsWith(target.getCanonicalPath() + File.separator)) {
            throw new IOException("Game file escapes the update directory");
        }
        return file;
    }

    private static void validateGame(File directory) throws IOException {
        requireFile(new File(directory, "index.html"));
        try {
            JSONArray caches = new JSONArray(readLocalText(new File(directory, "caches/caches.json"), 64 * 1024));
            if (caches.length() == 0 || caches.length() > 100) throw new IOException("Invalid game cache");
            for (int i = 0; i < caches.length(); i++) {
                JSONObject cache = caches.getJSONObject(i);
                String name = cache.getString("name");
                if (!(cache.opt("slimOf") instanceof String) || cache.getString("slimOf").isEmpty()
                        || !name.matches("[A-Za-z0-9_.-]+") || name.equals(".") || name.equals("..")) {
                    throw new IOException("The game needs a slim cache");
                }
                requireFile(new File(directory, "caches/" + name + "/main_file_cache.dat2"));
                requireFile(new File(directory, "caches/" + name + "/main_file_cache.idx255"));
            }
        } catch (JSONException exception) {
            throw new IOException("Invalid game cache", exception);
        }
    }

    private static void requireFile(File file) throws IOException {
        if (!Files.isRegularFile(file.toPath(), LinkOption.NOFOLLOW_LINKS) || file.length() == 0) {
            throw new IOException("Missing game file " + file.getName());
        }
    }

    private Response openLatest() throws IOException {
        checkCancelled();
        // The API URL is compiled in. API redirects cannot point this app at a different repository.
        return transport.open(LATEST_URL);
    }

    private Response openAsset(String url) throws IOException {
        if (!isAssetUrl(url)) throw new IOException("Unexpected game download URL");
        String current = url;
        for (int redirects = 0; redirects <= 5; redirects++) {
            checkCancelled();
            Response response = transport.open(current);
            if (response.status < 300 || response.status >= 400) return response;
            try (Response ignored = response) {
                if (response.location == null) throw new IOException("Game redirect has no destination");
                try {
                    current = URI.create(current).resolve(response.location).toString();
                } catch (IllegalArgumentException exception) {
                    throw new IOException("Invalid game redirect", exception);
                }
                if (!isRedirectUrl(current)) throw new IOException("Unexpected game redirect");
            }
        }
        throw new IOException("Too many game download redirects");
    }

    static boolean isAssetUrl(String url) {
        URI uri = https(url);
        return uri != null && "github.com".equals(uri.getHost())
                && uri.getRawQuery() == null && uri.getRawPath().startsWith(ASSET_PREFIX)
                && uri.getRawPath().equals(uri.getPath()) && !uri.getPath().contains("/../");
    }

    static boolean isRedirectUrl(String url) {
        URI uri = https(url);
        if (uri == null || uri.getHost() == null) return false;
        String host = uri.getHost();
        return ("github.com".equals(host) && isAssetUrl(url))
                || host.equals("release-assets.githubusercontent.com")
                || host.equals("objects.githubusercontent.com");
    }

    private static URI https(String url) {
        try {
            URI uri = URI.create(url);
            return "https".equals(uri.getScheme()) && uri.getRawUserInfo() == null
                    && uri.getRawFragment() == null && (uri.getPort() == -1 || uri.getPort() == 443) ? uri : null;
        } catch (IllegalArgumentException | NullPointerException exception) {
            return null;
        }
    }

    private static String asset(JSONObject release, String name) throws JSONException {
        JSONArray assets = release.optJSONArray("assets");
        if (assets == null) return null;
        for (int i = 0; i < assets.length(); i++) {
            JSONObject candidate = assets.getJSONObject(i);
            if (name.equals(candidate.optString("name"))) return candidate.getString("browser_download_url");
        }
        return null;
    }

    private String readText(Response response, int maximum) throws IOException {
        if (response.length > maximum) throw new IOException("Update information is too large");
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        long deadline = System.nanoTime() + 20000L * 1000000;
        int read;
        while ((read = response.body.read(buffer)) != -1) {
            checkCancelled();
            if (System.nanoTime() > deadline) throw new IOException("Update check timed out");
            if (output.size() + read > maximum) throw new IOException("Update information is too large");
            output.write(buffer, 0, read);
        }
        return output.toString(StandardCharsets.UTF_8.name());
    }

    private static String readLocalText(File file, int maximum) throws IOException {
        if (!Files.isRegularFile(file.toPath(), LinkOption.NOFOLLOW_LINKS) || file.length() > maximum) {
            throw new IOException("Invalid update information");
        }
        return new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8);
    }

    private static void requireOk(Response response) throws IOException {
        if (response.status != 200) throw new IOException("Update server answered " + response.status);
    }

    private void checkCancelled() throws IOException {
        if (cancelled || Thread.currentThread().isInterrupted()) throw new IOException("Update cancelled");
    }

    private static MessageDigest sha256() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException exception) {
            throw new AssertionError(exception);
        }
    }

    private static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) result.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
        return result.toString();
    }

    private static void deleteTree(File file) throws IOException {
        if (!Files.exists(file.toPath(), LinkOption.NOFOLLOW_LINKS)) return;
        // Never recurse through a local symlink, including while cleaning failed updates.
        if (Files.isDirectory(file.toPath(), LinkOption.NOFOLLOW_LINKS)) {
            File[] children = file.listFiles();
            if (children == null) throw new IOException("Cannot read update directory");
            for (File child : children) deleteTree(child);
        }
        Files.delete(file.toPath());
    }
}
