import { BrowserWindow, Menu, app, dialog, session, shell } from "electron";
import { existsSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import path from "node:path";

import { GameFolder, pickGameFolder } from "./gameFiles";
import { GAME_ORIGIN, getRelayOrigin, serveGame } from "./gameServer";
import { checkForUpdate, installUpdate, readInstalledGames, removeOldGames } from "./gameUpdate";
import { GITHUB_SOURCE } from "./releaseSource";
import { LAUNCHER_VERSION } from "./version";

const isDev = !app.isPackaged;

// Saves and updates live here, not beside the exe, so they outlast the zip's folder being moved
// or deleted. The folder's name and the partition are part of where saves are, like GAME_ORIGIN:
// don't change them. A dev run gets its own, so it can't touch a real save.
app.setName("Run Escape");
app.setPath("userData", path.join(app.getPath("appData"), isDev ? "Run Escape Dev" : "Run Escape"));
const GAME_PARTITION = "persist:game";

// The game files bundled with this launcher. Their version is the app's, set by package.json.
const bundledGame: GameFolder = {
    version: app.getVersion(),
    path: isDev ? path.join(app.getAppPath(), "dist") : path.join(process.resourcesPath, "game"),
};

// The folder the game's served from. Nothing's loaded from it until the update's finished.
let gameRoot = bundledGame.path;
let gameWindow: BrowserWindow | undefined;

const log = (message: string) =>
    appendFile(
        path.join(app.getPath("userData"), "launcher.log"),
        `${new Date().toISOString()} ${message}\n`,
    ).catch(() => {});

// The relay, from the build (see build-main.ts). Empty for a build with none.
declare const __COOP_URL__: string;

function openExternally(url: string): void {
    if (/^https?:\/\//.test(url)) {
        void shell.openExternal(url);
    }
}

function lockDownContents(): void {
    app.on("web-contents-created", (_event, contents) => {
        contents.setWindowOpenHandler(({ url }) => {
            openExternally(url);
            return { action: "deny" };
        });
        const stayInGame = (event: Electron.Event, url: string) => {
            if (!url.startsWith(GAME_ORIGIN + "/")) {
                event.preventDefault();
                openExternally(url);
            }
        };
        contents.on("will-navigate", stayInGame);
        contents.on("will-redirect", stayInGame);
    });
}

function createSplash(): BrowserWindow {
    const splash = new BrowserWindow({
        width: 360,
        height: 130,
        frame: false,
        resizable: false,
        maximizable: false,
        fullscreenable: false,
        backgroundColor: "#2b2319",
        title: "Run Escape",
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    void splash.loadFile(path.join(__dirname, "..", "splash.html"));
    return splash;
}

function showSplashStatus(
    splash: BrowserWindow,
    text: string,
    fraction?: number,
    canSkip = false,
): void {
    if (!splash.isDestroyed()) {
        const args = [text, fraction, canSkip].map((arg) => JSON.stringify(arg) ?? "undefined");
        splash.webContents.executeJavaScript(`showStatus(${args.join(",")})`).catch(() => {});
    }
}

// Brings the game files up to date if it can. Whatever goes wrong here is only logged: the player
// gets to play what they have.
async function updateGame(splash: BrowserWindow, current: GameFolder): Promise<void> {
    const cancel = new AbortController();
    splash.once("closed", () => cancel.abort(new Error("Cancelled by the player")));
    showSplashStatus(splash, "Checking for updates...");
    try {
        const check = await checkForUpdate(
            GITHUB_SOURCE,
            current.version,
            LAUNCHER_VERSION,
            cancel.signal,
        );
        if (check.kind === "launcher") {
            const { response } = await dialog.showMessageBox(splash, {
                type: "info",
                title: "Run Escape",
                message: `Run Escape ${check.version} needs a new download`,
                detail: "Your saves are safe, and you can keep playing this version for now.",
                buttons: check.releasePage ? ["Open download page", "Play now"] : ["Play now"],
                defaultId: 0,
            });
            if (check.releasePage && response === 0) {
                openExternally(check.releasePage);
            }
        } else if (check.kind === "update") {
            const { version } = check.manifest;
            const text = `Updating to ${version}...`;
            showSplashStatus(splash, text, 0, true);
            await installUpdate(
                check.manifest,
                check.zipUrl,
                GITHUB_SOURCE,
                app.getPath("userData"),
                cancel.signal,
                (fraction) => showSplashStatus(splash, text, fraction ?? 0, true),
            );
            await log(`Updated to ${version}`);
        }
    } catch (e) {
        await log(`Update skipped: ${e}`);
    }
}

function openGame(): BrowserWindow {
    const window = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        show: false,
        autoHideMenuBar: true,
        backgroundColor: "#000000",
        title: "Run Escape",
        webPreferences: {
            partition: GAME_PARTITION,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            devTools: isDev,
        },
    });
    window.webContents.on("before-input-event", (event, input) => {
        if (input.type === "keyDown" && input.key === "F11") {
            event.preventDefault();
            window.setFullScreen(!window.isFullScreen());
        }
    });
    // Saves are in localStorage, which Chromium writes out a little later: don't leave that to
    // a shutdown going well
    window.on("close", () => session.fromPartition(GAME_PARTITION).flushStorageData());
    window.once("ready-to-show", () => window.show());
    void window.loadURL(GAME_ORIGIN + "/");
    return window;
}

async function start(): Promise<void> {
    Menu.setApplicationMenu(null);
    const gameSession = session.fromPartition(GAME_PARTITION);
    // Everything's the game's own but the relay, the one thing that's let out
    const relayOrigin = getRelayOrigin(__COOP_URL__);
    gameSession.protocol.handle("https", (request) =>
        new URL(request.url).origin === relayOrigin
            ? gameSession.fetch(request, { bypassCustomProtocolHandlers: true })
            : serveGame(gameRoot, request, relayOrigin),
    );
    // The game only ever asks for these two
    gameSession.setPermissionRequestHandler((_contents, permission, callback) => {
        callback(permission === "fullscreen" || permission === "pointerLock");
    });

    const dataDir = app.getPath("userData");
    const pick = async () =>
        pickGameFolder(bundledGame, await readInstalledGames(dataDir), LAUNCHER_VERSION);

    // No update check in dev: it plays the build it's pointed at
    let splash: BrowserWindow | undefined;
    if (!isDev) {
        splash = createSplash();
        await updateGame(splash, await pick());
    }

    const game = isDev ? bundledGame : await pick();
    if (!existsSync(path.join(game.path, "index.html"))) {
        dialog.showErrorBox("Run Escape", `The game files are missing from ${game.path}.`);
        app.quit();
        return;
    }
    gameRoot = game.path;
    gameWindow = openGame();
    gameWindow.once("show", () => {
        if (splash && !splash.isDestroyed()) {
            splash.destroy();
        }
    });
    if (!isDev) {
        await removeOldGames(dataDir, game);
    }
    await log(`Launcher ${LAUNCHER_VERSION}, playing ${game.version} from ${game.path}`);
}

// Two copies would fight over the update folder and localStorage's files
if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    lockDownContents();
    app.on("second-instance", () => {
        if (gameWindow) {
            gameWindow.restore();
            gameWindow.focus();
        }
    });
    // Closing the splash skips the update, so the app only ends with the game's window
    app.on("window-all-closed", () => {
        if (gameWindow) {
            app.quit();
        }
    });
    app.whenReady()
        .then(start)
        .catch(async (e) => {
            await log(`Failed to start: ${e}`);
            dialog.showErrorBox("Run Escape", String(e));
            app.quit();
        });
}
