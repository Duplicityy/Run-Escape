import JSZip from "jszip";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { prepareGame } from "./prepare-game.mjs";

const temporary: string[] = [];

afterEach(async () => {
    await Promise.all(
        temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    );
});

async function fixture() {
    const root = await mkdtemp(path.join(os.tmpdir(), "run-escape-android-"));
    temporary.push(root);
    const source = path.join(root, "release");
    const destination = path.join(root, "assets/game");
    await mkdir(source);
    const zip = new JSZip();
    zip.file("index.html", "<script src='./assets/game.js'></script>");
    zip.file("assets/game.js", "window.build='same-as-desktop'");
    zip.file("assets/game.js.map", "source map");
    zip.file(
        "caches/caches.json",
        JSON.stringify([{ name: "slim-cache", slimOf: "original-cache" }]),
    );
    zip.file("caches/slim-cache/main_file_cache.dat2", "game data");
    zip.file("caches/slim-cache/main_file_cache.idx255", "index");
    async function save() {
        const bytes = await zip.generateAsync({ type: "nodebuffer" });
        await writeFile(path.join(source, "game-1.2.3.zip"), bytes);
        await writeFile(
            path.join(source, "game-manifest.json"),
            JSON.stringify({
                version: "1.2.3",
                sha256: createHash("sha256").update(bytes).digest("hex"),
            }),
        );
    }
    await save();
    return { root, source, destination, zip, save };
}

describe("Android game staging", () => {
    it("uses the verified desktop build and ships its cache for offline play", async () => {
        const { source, destination } = await fixture();
        await prepareGame(source, destination, { version: "1.2.3" });
        expect(await readFile(path.join(destination, "assets/game.js"), "utf8")).toBe(
            "window.build='same-as-desktop'",
        );
        expect(
            await readFile(
                path.join(destination, "caches/slim-cache/main_file_cache.dat2"),
                "utf8",
            ),
        ).toBe("game data");
        await expect(readFile(path.join(destination, "assets/game.js.map"))).rejects.toThrow();
    });

    it("leaves a staged game intact when a release checksum or version is wrong", async () => {
        const { source, destination } = await fixture();
        await prepareGame(source, destination, { version: "1.2.3" });
        await writeFile(path.join(source, "game-1.2.3.zip"), "broken ZIP");
        await expect(prepareGame(source, destination, { version: "1.2.3" })).rejects.toThrow(
            "SHA-256",
        );
        await expect(prepareGame(source, destination, { version: "9.9.9" })).rejects.toThrow(
            "does not match",
        );
        expect(await readFile(path.join(destination, "index.html"), "utf8")).toContain("game.js");
    });

    it("rejects a full cache and a slim cache without its data", async () => {
        const f = await fixture();
        f.zip.file("caches/caches.json", JSON.stringify([{ name: "full-cache" }]));
        await f.save();
        await expect(prepareGame(f.source, f.destination, { version: "1.2.3" })).rejects.toThrow(
            "slim cache",
        );
        f.zip.file(
            "caches/caches.json",
            JSON.stringify([{ name: "slim-cache", slimOf: "original-cache" }]),
        );
        f.zip.remove("caches/slim-cache/main_file_cache.idx255");
        await f.save();
        await expect(prepareGame(f.source, f.destination, { version: "1.2.3" })).rejects.toThrow();
    });

    it("rejects a ZIP path that escapes the bundled game", async () => {
        const f = await fixture();
        f.zip.file("../outside.txt", "outside");
        await f.save();
        await expect(prepareGame(f.source, f.destination, { version: "1.2.3" })).rejects.toThrow(
            "unsafe path",
        );
        await expect(readFile(path.join(f.root, "outside.txt"))).rejects.toThrow();
    });

    it("also stages a local build, with the same slim cache requirement", async () => {
        const f = await fixture();
        await prepareGame(f.source, f.destination, { version: "1.2.3" });
        const destination = path.join(f.root, "local/game");
        await prepareGame(f.destination, destination, { dist: true });
        expect(await readFile(path.join(destination, "assets/game.js"), "utf8")).toContain(
            "same-as-desktop",
        );
    });
});
