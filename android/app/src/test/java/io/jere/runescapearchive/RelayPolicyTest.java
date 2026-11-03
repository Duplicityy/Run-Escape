package io.jere.runescapearchive;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public final class RelayPolicyTest {
    @Test
    public void soloNeedsNoRemoteOrigin() {
        RelayPolicy policy = new RelayPolicy("");
        assertEquals("connect-src 'self' blob:", policy.contentSecurityPolicy());
        assertFalse(policy.allowsNetworkRequest("https://relay.example/coop"));
    }

    @Test
    public void allowsTheRelaysHttpsAvailabilityAndRoomEndpoints() {
        RelayPolicy policy = new RelayPolicy("wss://relay.example/coop");
        assertTrue(policy.allowsNetworkRequest("https://relay.example/coop"));
        assertTrue(policy.allowsNetworkRequest("https://relay.example/coop/room/ABC?player=1"));
        assertEquals("connect-src 'self' blob: https://relay.example wss://relay.example", policy.contentSecurityPolicy());
    }

    @Test
    public void normalizesDefaultPortsAndHostCase() {
        RelayPolicy policy = new RelayPolicy("wss://Relay.Example:443/coop");
        assertTrue(policy.allowsNetworkRequest("https://relay.example/coop"));
        assertTrue(policy.allowsNetworkRequest("https://RELAY.EXAMPLE:443/coop"));
        assertFalse(policy.allowsNetworkRequest("https://relay.example:444/coop"));
        assertEquals("connect-src 'self' blob: https://relay.example wss://relay.example", policy.contentSecurityPolicy());
    }

    @Test
    public void keepsAnExplicitRelayPort() {
        RelayPolicy policy = new RelayPolicy("wss://relay.example:8443/coop");
        assertTrue(policy.allowsNetworkRequest("https://relay.example:8443/coop"));
        assertFalse(policy.allowsNetworkRequest("https://relay.example/coop"));
        assertEquals("connect-src 'self' blob: https://relay.example:8443 wss://relay.example:8443", policy.contentSecurityPolicy());
    }

    @Test
    public void rejectsOtherHostsCredentialsAndInsecureSchemes() {
        RelayPolicy policy = new RelayPolicy("wss://relay.example/coop");
        for (String url : new String[]{
                "https://relay.example.evil.test/coop", "https://evil.test/coop",
                "https://relay.example@evil.test/coop", "https://name@relay.example/coop",
                "http://relay.example/coop", "wss://relay.example/coop",
                "file:///coop", "javascript:alert(1)", "https://relay.example:0/coop",
                "https://relay.example:65536/coop", "https://relay.example/coop#fragment",
                "not a URL", "", null
        }) assertFalse(url, policy.allowsNetworkRequest(url));
    }

    @Test
    public void invalidConfigurationFailsClosed() {
        for (String url : new String[]{
                "ws://relay.example/coop", "https://relay.example/coop", "wss:///coop",
                "wss://name@relay.example/coop", "wss://relay.example/coop?key=1",
                "wss://relay.example/coop#fragment", "wss://relay.example:0/coop",
                "wss://relay.example:65536/coop", "garbage", null
        }) {
            RelayPolicy policy = new RelayPolicy(url);
            assertEquals("connect-src 'self' blob:", policy.contentSecurityPolicy());
            assertFalse(policy.allowsNetworkRequest("https://relay.example/coop"));
        }
    }

    @Test
    public void supportsIpv6RelayOrigins() {
        RelayPolicy policy = new RelayPolicy("wss://[::1]:8443/coop");
        assertTrue(policy.allowsNetworkRequest("https://[::1]:8443/coop"));
        assertFalse(policy.allowsNetworkRequest("https://[::1]:443/coop"));
        assertEquals("connect-src 'self' blob: https://[::1]:8443 wss://[::1]:8443", policy.contentSecurityPolicy());
    }
}
