import { GameClient } from "../client/GameClient";
import { SaveBlock } from "../client/GameStore";
import "./NoticePanel.css";
import { GAME_VERSION } from "./changelog";

// Over everything while nothing's being saved, until the player picks what to
// do about it
export function SaveBlockPanel({
    block,
    client,
}: {
    block: SaveBlock;
    client: GameClient;
}): JSX.Element {
    const newer = block.kind === "newerGame";
    // ui-fill for the UI's font, as it's not on a screen
    return (
        <div className="ui-fill ui-modal ui-save-block">
            <div className="ui-panel rs-border rs-background ui-notice">
                <h2>{newer ? "Your save is from a newer version" : "Open in another tab"}</h2>
                {newer ? (
                    <div className="ui-notice-body">
                        <p>
                            It was saved by
                            {block.gameVersion ? ` v${block.gameVersion} of` : " a newer"} Run
                            Escape, and this is v{GAME_VERSION}, which would undo what's new in it.
                            So this one won't save.
                        </p>
                        <p>Reload to get the new version.</p>
                    </div>
                ) : (
                    <div className="ui-notice-body">
                        <p>
                            Run Escape is open in another tab, and only one can save your progress.
                            Play here, and that one stops saving.
                        </p>
                        <p>Or close it, and this one carries on from where it left off.</p>
                    </div>
                )}
                <div className="ui-notice-close">
                    {newer ? (
                        <button className="ui-button" onClick={() => window.location.reload()}>
                            Reload
                        </button>
                    ) : (
                        <button className="ui-button" onClick={() => client.takeOverSave()}>
                            Play here
                        </button>
                    )}
                    <button className="ui-button" onClick={() => client.playWithoutSaving()}>
                        Play without saving
                    </button>
                </div>
            </div>
        </div>
    );
}

// Over the title screen when the save couldn't be read, and a fresh one's
// taken its place
export function UnreadableSavePanel({
    keptAs,
    client,
}: {
    keptAs: string;
    client: GameClient;
}): JSX.Element {
    return (
        <div className="ui-modal">
            <div className="ui-panel rs-border rs-background ui-notice">
                <h2>Your save couldn't be read</h2>
                <div className="ui-notice-body">
                    <p>
                        Something went wrong with the save in this browser, so you're starting
                        afresh. A copy of the old one has been kept.
                    </p>
                    <p>
                        Export it to ask for help on the Discord, or to mend by hand and import.
                        It's in Settings too.
                    </p>
                </div>
                <div className="ui-notice-close">
                    <button
                        className="ui-button"
                        onClick={() => client.exportUnreadableSave(keptAs)}
                    >
                        Export
                    </button>
                    <button className="ui-button" onClick={() => client.closeUnreadableNotice()}>
                        Got it
                    </button>
                </div>
            </div>
        </div>
    );
}
