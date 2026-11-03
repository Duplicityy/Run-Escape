import { GameClient } from "../client/GameClient";
import { EventView } from "../client/GameStore";
import { Coins } from "./Coins";
import { ItemIcon } from "./ItemIcon";
import { KeyHint } from "./PadHint";

type Props = { event: EventView; coins: number; client: GameClient };

// A random event's visitor with something on offer: the Mysterious Old Man's
// power-ups, or the Quiz Master's question. A raid's supply chest too, for raid points.
export function EventModal({ event, coins, client }: Props): JSX.Element {
    const forSale = event.options.some((option) => option.price !== undefined);
    return (
        <div className="ui-modal">
            <div className="ui-panel rs-border rs-background ui-levelup">
                <h2>{event.name}</h2>
                <p className="ui-subtle ui-event-speech">{event.speech}</p>
                <div className="ui-choices">
                    {event.options.map((option, i) => (
                        <button
                            key={i}
                            className="ui-card ui-choice"
                            disabled={!option.enabled}
                            onClick={() => client.chooseEvent(i)}
                        >
                            <KeyHint keyLabel={String(i + 1)} />
                            <ItemIcon objId={option.iconObjId} size={44} />
                            <div className="ui-card-body">
                                <div className="ui-card-title">{option.title}</div>
                                {option.text && <div className="ui-card-text">{option.text}</div>}
                            </div>
                            {option.price !== undefined && (
                                <div className="ui-card-cost">
                                    {option.sold ? (
                                        "Sold"
                                    ) : event.points !== undefined ? (
                                        <span className="ui-raid-price">{option.price} pts</span>
                                    ) : (
                                        <Coins amount={option.price} />
                                    )}
                                </div>
                            )}
                        </button>
                    ))}
                </div>
                <div className="ui-levelup-actions ui-event-actions">
                    {forSale &&
                        (event.points !== undefined ? (
                            <span className="ui-raid-price">{event.points} raid points</span>
                        ) : (
                            <Coins amount={coins} />
                        ))}
                    <button className="ui-button" onClick={() => client.leaveEvent()}>
                        {event.leaveLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
