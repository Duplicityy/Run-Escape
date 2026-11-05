package io.jere.runescapearchive;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

public final class GameAssetFilesTest {
    @Rule
    public TemporaryFolder temporary = new TemporaryFolder();

    @Test
    public void servesTheSelectedGameWithItsMimeTypeAndNoStaleCache() throws Exception {
        File root = game();
        try (GameAssetFiles.Response response = GameAssetFiles.open(root, "index.html", null)) {
            assertEquals(200, response.status);
            assertEquals("text/html", response.mime);
            assertEquals("10", response.headers.get("Content-Length"));
            assertEquals("bytes", response.headers.get("Accept-Ranges"));
            assertEquals("no-store", response.headers.get("Cache-Control"));
            assertEquals("0123456789", text(response));
        }
        Files.write(root.toPath().resolve("worker.mjs"), new byte[]{1});
        Files.write(root.toPath().resolve("game.wasm"), new byte[]{1});
        try (GameAssetFiles.Response response = GameAssetFiles.open(root, "worker.mjs", null)) {
            assertEquals("text/javascript", response.mime);
        }
        try (GameAssetFiles.Response response = GameAssetFiles.open(root, "game.wasm", null)) {
            assertEquals("application/wasm", response.mime);
        }
    }

    @Test
    public void streamsOnlyTheRequestedRangeAndClampsTheGamesLargeEnd() throws Exception {
        File root = game();
        try (GameAssetFiles.Response response = GameAssetFiles.open(root, "index.html", "bytes=2-5")) {
            assertEquals(206, response.status);
            assertEquals("Partial Content", response.reason);
            assertEquals("bytes 2-5/10", response.headers.get("Content-Range"));
            assertEquals("4", response.headers.get("Content-Length"));
            assertEquals("2345", text(response));
            assertEquals(-1, response.body.read());
        }
        try (GameAssetFiles.Response response = GameAssetFiles.open(root, "index.html",
                "bytes=7-9007199254740991")) {
            assertEquals("bytes 7-9/10", response.headers.get("Content-Range"));
            assertEquals("789", text(response));
        }
    }

    @Test
    public void handlesOpenEndedAndSuffixRanges() throws Exception {
        File root = game();
        for (String range : new String[]{"bytes=7-", "bytes=-3"}) {
            try (GameAssetFiles.Response response = GameAssetFiles.open(root, "index.html", range)) {
                assertEquals(206, response.status);
                assertEquals("789", text(response));
            }
        }
        try (GameAssetFiles.Response response = GameAssetFiles.open(root, "index.html", "bytes=-99")) {
            assertEquals("0123456789", text(response));
        }
    }

    @Test
    public void rejectsMalformedAndUnsatisfiableRanges() throws Exception {
        File root = game();
        for (String range : new String[]{"", "bytes=-", "bytes=10-", "bytes=4-2", "bytes=-0",
                "bytes=1-2,4-5", "items=1-2", "bytes=abc-5", "bytes=99999999999999999999999-"}) {
            try (GameAssetFiles.Response response = GameAssetFiles.open(root, "index.html", range)) {
                assertEquals(range, 416, response.status);
                assertEquals("bytes */10", response.headers.get("Content-Range"));
                assertEquals("0", response.headers.get("Content-Length"));
                assertEquals(-1, response.body.read());
            }
        }
    }

    @Test
    public void servesEmptyFilesButRejectsRangesAgainstThem() throws Exception {
        File root = game();
        Files.write(root.toPath().resolve("empty"), new byte[0]);
        try (GameAssetFiles.Response response = GameAssetFiles.open(root, "empty", null)) {
            assertEquals(200, response.status);
            assertEquals("0", response.headers.get("Content-Length"));
            assertEquals(-1, response.body.read());
        }
        try (GameAssetFiles.Response response = GameAssetFiles.open(root, "empty", "bytes=0-")) {
            assertEquals(416, response.status);
            assertEquals("bytes */0", response.headers.get("Content-Range"));
        }
    }

    @Test
    public void confinesDecodedPathsToThisGameAndDoesNotMixVersionsOnAMiss() throws Exception {
        File root = game();
        File outside = temporary.newFile("outside.txt");
        Files.write(outside.toPath(), "private".getBytes(StandardCharsets.UTF_8));
        Files.createSymbolicLink(root.toPath().resolve("escaped"), outside.toPath());
        for (String path : new String[]{"missing.js", "../outside.txt", "/outside.txt", "escaped",
                "sub/../../outside.txt", "sub\\outside.txt", "sub/./index.html", "C:/private",
                "bad\0name", "", null}) {
            try (GameAssetFiles.Response response = GameAssetFiles.open(root, path, null)) {
                assertEquals(String.valueOf(path), 404, response.status);
                assertEquals(-1, response.body.read());
            }
        }
        Files.createDirectory(root.toPath().resolve("assets"));
        try (GameAssetFiles.Response response = GameAssetFiles.open(root, "assets", null)) {
            assertEquals(404, response.status);
        }
    }

    @Test
    public void boundedStreamsCannotSkipPastTheirRangeAndCloseTheirFile() throws Exception {
        GameAssetFiles.Response response = GameAssetFiles.open(game(), "index.html", "bytes=2-5");
        assertEquals(4, response.body.available());
        assertEquals(0, response.body.skip(-1));
        assertEquals(2, response.body.skip(2));
        assertEquals('4', response.body.read());
        assertEquals(1, response.body.skip(Long.MAX_VALUE));
        assertEquals(0, response.body.read(new byte[0], 0, 0));
        assertEquals(-1, response.body.read());
        response.close();
        response.close();
        try {
            response.body.read();
            fail("A closed response must close its file stream");
        } catch (IOException expected) {
            assertTrue(expected.getMessage().contains("closed"));
        }
    }

    private File game() throws IOException {
        File root = temporary.newFolder();
        Files.write(root.toPath().resolve("index.html"), "0123456789".getBytes(StandardCharsets.UTF_8));
        return root;
    }

    private static String text(GameAssetFiles.Response response) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[3];
        int count;
        while ((count = response.body.read(buffer)) != -1) output.write(buffer, 0, count);
        return output.toString(StandardCharsets.UTF_8.name());
    }
}
