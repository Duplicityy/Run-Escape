package io.jere.runescapearchive;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

public final class GameUpdaterTest {
    private static final String RELEASE = "https://github.com/Dynrothe/Run-Escape/releases/download/";
    private static final GameUpdater.Progress QUIET = (message, percent) -> { };

    @Rule public TemporaryFolder temporary = new TemporaryFolder();

    @Test
    public void installsTheOfficialGameAndFindsItAfterRestart() throws Exception {
        File storage = temporary.newFolder();
        Fixture release = new Fixture("0.10.0");
        GameUpdater updater = new GameUpdater(storage, "0.9.9", release.transport());
        List<Integer> progress = new ArrayList<>();
        GameUpdater.Game game = updater.update(updater.selectCurrent(), (message, percent) -> progress.add(percent));

        assertEquals("0.10.0", game.version);
        assertNotNull(game.directory);
        assertArrayEquals("<html>game</html>".getBytes(StandardCharsets.UTF_8),
                Files.readAllBytes(new File(game.directory, "index.html").toPath()));
        assertTrue(progress.contains(100));
        assertEquals("0.10.0", new GameUpdater(storage, "0.9.9", new MemoryTransport()).selectCurrent().version);
        assertNoPending(storage);
    }

    @Test
    public void bundledGameWinsATieAndNeverDowngrades() throws Exception {
        File storage = temporary.newFolder();
        install(storage, "0.10.0");
        GameUpdater same = new GameUpdater(storage, "0.10.0", new Fixture("0.9.9").transport());
        GameUpdater.Game bundled = same.selectCurrent();
        assertNull(bundled.directory);
        assertSame(bundled, same.update(bundled, QUIET));
        assertNull(new GameUpdater(storage, "1.0.0", new MemoryTransport()).selectCurrent().directory);
        assertTrue(GameUpdater.compareVersions("0.10.0", "0.9.99") > 0);
        assertThrows(IllegalArgumentException.class, () -> GameUpdater.compareVersions("9999999999.0.0", "1.0.0"));
    }

    @Test
    public void checksumFailureLeavesCurrentVersionAndRemovesStaging() throws Exception {
        File storage = temporary.newFolder();
        install(storage, "0.10.0");
        Fixture broken = new Fixture("0.11.0");
        broken.sha256 = "0".repeat(64);
        GameUpdater updater = new GameUpdater(storage, "0.9.0", broken.transport());
        GameUpdater.Game current = updater.selectCurrent();
        assertThrows(IOException.class, () -> updater.update(current, QUIET));
        assertEquals("0.10.0", updater.selectCurrent().version);
        assertTrue(new File(current.directory, "index.html").isFile());
        assertNoPending(storage);
    }

    @Test
    public void inconsistentTagAndUnsupportedLauncherNeverDownloadTheGame() throws Exception {
        File storage = temporary.newFolder();
        Fixture wrongTag = new Fixture("0.11.0");
        wrongTag.tag = "v0.12.0";
        MemoryTransport wrongTransport = wrongTag.transport();
        GameUpdater wrong = new GameUpdater(storage, "0.10.0", wrongTransport);
        assertThrows(IOException.class, () -> wrong.update(wrong.selectCurrent(), QUIET));
        assertFalse(wrongTransport.requests.contains(wrongTag.zipUrl));

        Fixture newer = new Fixture("0.11.0");
        newer.minLauncher = "2.0.0";
        MemoryTransport newerTransport = newer.transport();
        GameUpdater unsupported = new GameUpdater(storage, "0.10.0", newerTransport);
        GameUpdater.UnsupportedGameException failure = assertThrows(GameUpdater.UnsupportedGameException.class,
                () -> unsupported.update(unsupported.selectCurrent(), QUIET));
        assertEquals("0.11.0", failure.version);
        assertFalse(newerTransport.requests.contains(newer.zipUrl));
        assertNull(unsupported.selectCurrent().directory);
    }

    @Test
    public void noReleaseDraftAndPrereleaseKeepTheExistingGame() throws Exception {
        File storage = temporary.newFolder();
        MemoryTransport missing = new MemoryTransport();
        missing.reply(GameUpdater.LATEST_URL, new byte[0], 404);
        GameUpdater noRelease = new GameUpdater(storage, "0.10.0", missing);
        GameUpdater.Game current = noRelease.selectCurrent();
        assertSame(current, noRelease.update(current, QUIET));
        for (String flag : Arrays.asList("draft", "prerelease")) {
            Fixture release = new Fixture("0.11.0");
            release.flag = flag;
            MemoryTransport transport = release.transport();
            GameUpdater updater = new GameUpdater(storage, "0.10.0", transport);
            assertEquals("0.10.0", updater.update(updater.selectCurrent(), QUIET).version);
            assertEquals(1, transport.requests.size());
        }
    }

    @Test
    public void unsafeArchivePathsCannotEscapeOrReplaceTheCurrentGame() throws Exception {
        for (String unsafe : Arrays.asList("../outside", "/outside", "folder/../../outside", "folder\\outside",
                "C:outside", "./outside", "folder//outside", "verified.json")) {
            File storage = temporary.newFolder();
            Fixture release = new Fixture("0.11.0");
            release.entries.put(unsafe, new byte[]{1});
            GameUpdater updater = new GameUpdater(storage, "0.10.0", release.transport());
            assertThrows(unsafe, IOException.class, () -> updater.update(updater.selectCurrent(), QUIET));
            assertNull(updater.selectCurrent().directory);
            assertFalse(new File(storage, "outside").exists());
            assertFalse(new File(storage.getParentFile(), "outside").exists());
            assertNoPending(storage);
        }
    }

    @Test
    public void fileDirectoryCollisionsAndMissingCacheDataNeverActivate() throws Exception {
        File storage = temporary.newFolder();
        Fixture collision = new Fixture("0.11.0");
        collision.entries.put("assets", new byte[]{1});
        collision.entries.put("assets/code.js", new byte[]{2});
        GameUpdater colliding = new GameUpdater(storage, "0.10.0", collision.transport());
        assertThrows(IOException.class, () -> colliding.update(colliding.selectCurrent(), QUIET));
        assertNull(colliding.selectCurrent().directory);
        assertNoPending(storage);

        Fixture missingCache = new Fixture("0.11.0");
        missingCache.entries.remove("caches/test-cache/main_file_cache.idx255");
        GameUpdater incomplete = new GameUpdater(storage, "0.10.0", missingCache.transport());
        assertThrows(IOException.class, () -> incomplete.update(incomplete.selectCurrent(), QUIET));
        assertNull(incomplete.selectCurrent().directory);
        assertNoPending(storage);
    }

    @Test
    public void directoryEntriesCannotHideUnboundedFileData() throws Exception {
        File storage = temporary.newFolder();
        Fixture release = new Fixture("0.11.0");
        release.entries.put("assets/", new byte[]{1, 2, 3});
        GameUpdater updater = new GameUpdater(storage, "0.10.0", release.transport());
        assertThrows(IOException.class, () -> updater.update(updater.selectCurrent(), QUIET));
        assertNull(updater.selectCurrent().directory);
        assertNoPending(storage);
    }

    @Test
    public void clearsDayOldStagingWithoutTouchingUnrelatedFiles() throws Exception {
        File storage = temporary.newFolder();
        File abandoned = new File(storage, "pending-00000000-0000-0000-0000-000000000000");
        Files.createDirectories(abandoned.toPath());
        Files.write(new File(abandoned, "game.zip").toPath(), new byte[]{1});
        assertTrue(abandoned.setLastModified(System.currentTimeMillis() - 2L * 24 * 60 * 60 * 1000));
        File unrelated = new File(storage, "personal-data");
        Files.write(unrelated.toPath(), new byte[]{2});
        install(storage, "0.11.0");
        assertFalse(abandoned.exists());
        assertArrayEquals(new byte[]{2}, Files.readAllBytes(unrelated.toPath()));
        assertNoPending(storage);
    }

    @Test
    public void rejectsUntrustedInitialDownloadUrlsBeforeOpeningThem() throws Exception {
        for (String url : Arrays.asList(
                "http://github.com/Dynrothe/Run-Escape/releases/download/v0.11.0/game-0.11.0.zip",
                "https://github.com.evil.test/Dynrothe/Run-Escape/releases/download/v0.11.0/game-0.11.0.zip",
                "https://name@github.com/Dynrothe/Run-Escape/releases/download/v0.11.0/game-0.11.0.zip",
                "https://github.com/coltencleland-hub/Run-Escape/releases/download/v0.11.0/game-0.11.0.zip",
                "https://github.com/Dynrothe/Run-Escape/releases/download/v0.11.0/../game-0.11.0.zip",
                "https://github.com/Dynrothe/Run-Escape/releases/download/v0.11.0/%2e%2e/game-0.11.0.zip")) {
            File storage = temporary.newFolder();
            Fixture release = new Fixture("0.11.0");
            release.zipUrl = url;
            MemoryTransport transport = release.transport();
            GameUpdater updater = new GameUpdater(storage, "0.10.0", transport);
            assertThrows(url, IOException.class, () -> updater.update(updater.selectCurrent(), QUIET));
            assertFalse(transport.requests.contains(url));
            assertNoPending(storage);
        }
    }

    @Test
    public void followsGitHubStorageRedirectButRejectsAHostOrSchemeChange() throws Exception {
        File storage = temporary.newFolder();
        Fixture release = new Fixture("0.11.0");
        MemoryTransport transport = release.transport();
        String signed = "https://release-assets.githubusercontent.com/asset?signature=test";
        transport.redirect(release.zipUrl, signed);
        transport.reply(signed, release.zip(), 200);
        GameUpdater updater = new GameUpdater(storage, "0.10.0", transport);
        assertEquals("0.11.0", updater.update(updater.selectCurrent(), QUIET).version);
        assertTrue(transport.requests.contains(signed));

        for (String redirect : Arrays.asList("http://release-assets.githubusercontent.com/asset",
                "https://release-assets.githubusercontent.com.evil.test/asset", "https://evil.test/asset",
                "https://name@release-assets.githubusercontent.com/asset")) {
            File failedStorage = temporary.newFolder();
            MemoryTransport blocked = release.transport();
            blocked.redirect(release.zipUrl, redirect);
            GameUpdater rejected = new GameUpdater(failedStorage, "0.10.0", blocked);
            assertThrows(redirect, IOException.class, () -> rejected.update(rejected.selectCurrent(), QUIET));
            assertFalse(blocked.requests.contains(redirect));
            assertNull(rejected.selectCurrent().directory);
            assertNoPending(failedStorage);
        }
    }

    @Test
    public void cancellationDuringDownloadPreservesTheWorkingInstall() throws Exception {
        File storage = temporary.newFolder();
        install(storage, "0.10.0");
        Fixture release = new Fixture("0.11.0");
        MemoryTransport transport = release.transport();
        GameUpdater updater = new GameUpdater(storage, "0.9.0", transport);
        GameUpdater.Game current = updater.selectCurrent();
        assertThrows(IOException.class, () -> updater.update(current, (message, percent) -> {
            if (message.startsWith("Downloading") && percent > 0) updater.cancel();
        }));
        assertTrue(transport.cancelled);
        assertEquals("0.10.0", updater.selectCurrent().version);
        assertTrue(new File(current.directory, "index.html").isFile());
        assertNoPending(storage);
    }

    @Test
    public void incompleteAndOversizedDownloadsCannotActivate() throws Exception {
        for (boolean truncated : Arrays.asList(true, false)) {
            File storage = temporary.newFolder();
            Fixture release = new Fixture("0.11.0");
            MemoryTransport transport = release.transport();
            byte[] bytes = release.zip();
            long length = truncated ? bytes.length + 1 : 129L * 1024 * 1024;
            transport.routes.put(release.zipUrl, () -> new GameUpdater.Response(200,
                    new ByteArrayInputStream(bytes), length, null));
            GameUpdater updater = new GameUpdater(storage, "0.10.0", transport);
            assertThrows(IOException.class, () -> updater.update(updater.selectCurrent(), QUIET));
            assertNull(updater.selectCurrent().directory);
            assertNoPending(storage);
        }
    }

    @Test
    public void rejectedUpdateStaysRejectedAcrossRestartsAndFallsBack() throws Exception {
        File storage = temporary.newFolder();
        install(storage, "0.10.0");
        GameUpdater.Game bad = install(storage, "0.11.0");
        GameUpdater updater = new GameUpdater(storage, "0.9.0", new MemoryTransport());
        updater.reject(bad);
        assertEquals("0.10.0", updater.selectCurrent().version);
        assertFalse(bad.directory.exists());

        Fixture release = new Fixture("0.11.0");
        MemoryTransport transport = release.transport();
        GameUpdater restarted = new GameUpdater(storage, "0.9.0", transport);
        assertEquals("0.10.0", restarted.update(restarted.selectCurrent(), QUIET).version);
        assertFalse(transport.requests.contains(release.zipUrl));
        restarted.retryRejectedUpdates();
        assertEquals("0.11.0", restarted.update(restarted.selectCurrent(), QUIET).version);
        assertTrue(transport.requests.contains(release.zipUrl));
    }

    @Test
    public void confirmKeepsOnePreviousInstallAndIgnoresIncompleteFolders() throws Exception {
        File storage = temporary.newFolder();
        GameUpdater.Game old = install(storage, "0.10.0");
        GameUpdater.Game previous = install(storage, "0.11.0");
        GameUpdater.Game active = install(storage, "0.12.0");
        Files.createDirectories(new File(storage, "games/99.0.0").toPath());
        Files.write(new File(storage, "games/99.0.0/index.html").toPath(), new byte[]{1});
        GameUpdater updater = new GameUpdater(storage, "0.9.0", new MemoryTransport());
        assertEquals("0.12.0", updater.selectCurrent().version);
        // An older Activity finishing late cannot remove the newly installed version.
        updater.confirm(previous);
        assertTrue(active.directory.isDirectory());
        updater.confirm(active);
        assertTrue(active.directory.isDirectory());
        assertTrue(previous.directory.isDirectory());
        assertFalse(old.directory.exists());
        updater.reject(active);
        assertEquals("0.11.0", updater.selectCurrent().version);
    }

    private GameUpdater.Game install(File storage, String version) throws Exception {
        GameUpdater updater = new GameUpdater(storage, "0.9.0", new Fixture(version).transport());
        return updater.update(updater.selectCurrent(), QUIET);
    }

    private static void assertNoPending(File storage) {
        File[] files = storage.listFiles();
        if (files != null) for (File file : files) assertFalse(file.getName(), file.getName().startsWith("pending-"));
    }

    private interface Reply {
        GameUpdater.Response create();
    }

    private static final class MemoryTransport implements GameUpdater.Transport {
        final Map<String, Reply> routes = new LinkedHashMap<>();
        final List<String> requests = new ArrayList<>();
        boolean cancelled;

        void reply(String url, byte[] body, int status) {
            routes.put(url, () -> new GameUpdater.Response(status, new ByteArrayInputStream(body), body.length, null));
        }

        void redirect(String url, String location) {
            routes.put(url, () -> new GameUpdater.Response(302, new ByteArrayInputStream(new byte[0]), 0, location));
        }

        @Override
        public GameUpdater.Response open(String url) throws IOException {
            requests.add(url);
            Reply reply = routes.get(url);
            if (reply == null) throw new IOException("Unexpected URL: " + url);
            return reply.create();
        }

        @Override
        public void cancel() { cancelled = true; }
    }

    private static final class Fixture {
        final String version;
        final Map<String, byte[]> entries = new LinkedHashMap<>();
        String minLauncher = "1.0.0";
        String tag;
        String sha256;
        String zipUrl;
        String flag;

        Fixture(String version) {
            this.version = version;
            tag = "v" + version;
            zipUrl = RELEASE + tag + "/game-" + version + ".zip";
            entries.put("index.html", "<html>game</html>".getBytes(StandardCharsets.UTF_8));
            entries.put("caches/caches.json", "[{\"name\":\"test-cache\",\"slimOf\":\"test\"}]".getBytes(StandardCharsets.UTF_8));
            entries.put("caches/test-cache/main_file_cache.dat2", new byte[]{1, 2, 3});
            entries.put("caches/test-cache/main_file_cache.idx255", new byte[]{4, 5, 6});
        }

        byte[] zip() throws Exception {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (ZipOutputStream output = new ZipOutputStream(bytes)) {
                for (Map.Entry<String, byte[]> entry : entries.entrySet()) {
                    ZipEntry file = new ZipEntry(entry.getKey());
                    file.setTime(0);
                    output.putNextEntry(file);
                    output.write(entry.getValue());
                    output.closeEntry();
                }
            }
            return bytes.toByteArray();
        }

        MemoryTransport transport() throws Exception {
            MemoryTransport transport = new MemoryTransport();
            byte[] zip = zip();
            String manifestUrl = RELEASE + "v" + version + "/game-manifest.json";
            JSONObject manifest = new JSONObject().put("version", version).put("minLauncher", minLauncher)
                    .put("sha256", sha256 == null ? hex(MessageDigest.getInstance("SHA-256").digest(zip)) : sha256);
            JSONObject release = new JSONObject().put("tag_name", tag).put("assets", new JSONArray()
                    .put(new JSONObject().put("name", "game-manifest.json").put("browser_download_url", manifestUrl))
                    .put(new JSONObject().put("name", "game-" + version + ".zip").put("browser_download_url", zipUrl)));
            if (flag != null) release.put(flag, true);
            transport.reply(GameUpdater.LATEST_URL, release.toString().getBytes(StandardCharsets.UTF_8), 200);
            transport.reply(manifestUrl, manifest.toString().getBytes(StandardCharsets.UTF_8), 200);
            transport.reply(zipUrl, zip, 200);
            return transport;
        }
    }

    private static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder();
        for (byte value : bytes) result.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
        return result.toString();
    }
}
