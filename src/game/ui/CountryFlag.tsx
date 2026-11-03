import { useEffect, useState } from "react";

import { FLAG_FRAMES, FLAG_SPRITE } from "../content/flags";
import { iconCache } from "./ItemIcon";

let regionNames: Intl.DisplayNames | undefined;

// A country's name ("Finland"), or its letters where the browser doesn't know it
export function countryName(code: string): string {
    try {
        regionNames ??= new Intl.DisplayNames(["en"], { type: "region" });
        return regionNames.of(code) ?? code;
    } catch {
        return code;
    }
}

type Props = {
    // ISO 3166's two letters, as the relay sends them. Nothing's shown without.
    country?: string;
    // Before the country's name, for the tooltip: "Hosted from"
    label: string;
    // An empty space the flag's size without a country, to keep rows in line
    keepSpace?: boolean;
};

// Where a co-op player's playing from: their country's flag from the world list,
// or its letters for a country without one
export function CountryFlag({ country, label, keepSpace }: Props): JSX.Element | null {
    const frame = country !== undefined ? FLAG_FRAMES[country] : undefined;
    const cached = () => (frame !== undefined ? iconCache.getFrame(FLAG_SPRITE, frame) : undefined);
    const [loaded, setLoaded] = useState(() => ({ frame, url: cached() }));
    // Never the last country's flag while a new one's drawn
    const url = loaded.frame === frame ? loaded.url : cached();
    useEffect(() => {
        if (frame === undefined) {
            return;
        }
        let cancelled = false;
        iconCache.requestFrame(FLAG_SPRITE, frame, (url) => {
            if (!cancelled) {
                setLoaded({ frame, url });
            }
        });
        return () => {
            cancelled = true;
        };
    }, [frame]);
    if (!country) {
        return keepSpace ? <span className="ui-flag" /> : null;
    }
    const text = `${label} ${countryName(country)}`;
    // No flag for it (or not in this cache): its letters
    if (frame === undefined || url === "") {
        return (
            <span className="ui-flag ui-flag-code" role="img" aria-label={text} title={text}>
                {country}
            </span>
        );
    }
    return url ? (
        <img className="ui-flag" src={url} alt={text} title={text} draggable={false} />
    ) : (
        <span className="ui-flag" />
    );
}
