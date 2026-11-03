package io.jere.runescapearchive;

import java.net.URI;
import java.util.Locale;

/** The one remote origin the bundled game may reach, matching the desktop app. */
public final class RelayPolicy {
    private final String host;
    private final int port;
    private final String httpsOrigin;
    private final String websocketOrigin;

    public RelayPolicy(String coopUrl) {
        URI relay = parse(coopUrl);
        boolean valid = relay != null && "wss".equals(relay.getScheme())
                && relay.getHost() != null && relay.getRawUserInfo() == null
                && relay.getRawQuery() == null && relay.getRawFragment() == null
                && validPort(relay.getPort());
        host = valid ? relay.getHost().toLowerCase(Locale.ROOT) : null;
        port = valid ? effectivePort(relay) : -1;
        String authority = host == null ? null : host + (port == 443 ? "" : ":" + port);
        httpsOrigin = authority == null ? null : "https://" + authority;
        websocketOrigin = authority == null ? null : "wss://" + authority;
    }

    public boolean allowsNetworkRequest(String url) {
        URI request = parse(url);
        return host != null && request != null && "https".equals(request.getScheme())
                && request.getHost() != null && request.getRawUserInfo() == null
                && request.getRawFragment() == null && validPort(request.getPort())
                && host.equals(request.getHost().toLowerCase(Locale.ROOT))
                && port == effectivePort(request);
    }

    // WebSockets bypass WebViewClient, so documents and workers also need this policy.
    public String contentSecurityPolicy() {
        // The native save picker reads the game's local exported Blob through fetch().
        return "connect-src 'self' blob:" + (httpsOrigin == null ? "" : " " + httpsOrigin + " " + websocketOrigin);
    }

    private static URI parse(String url) {
        if (url == null || url.trim().isEmpty()) return null;
        try {
            return new URI(url.trim());
        } catch (Exception exception) {
            return null;
        }
    }

    private static boolean validPort(int port) {
        return port == -1 || (port > 0 && port <= 65535);
    }

    private static int effectivePort(URI uri) {
        return uri.getPort() == -1 ? 443 : uri.getPort();
    }
}
