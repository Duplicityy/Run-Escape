package io.jere.runescapearchive;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

/** Runs the bundled game on a private, intercepted HTTPS origin. */
public final class MainActivity extends Activity {
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final String GAME_ROOT = "/assets/game/";
    private static final String GAME_URL = ORIGIN + GAME_ROOT + "index.html";
    private static final String CHECK_URL = ORIGIN + GAME_ROOT + "offline-check.html";
    private static final String WORKER_URL = ORIGIN + GAME_ROOT + "offline-check-worker.js";
    private static final int WEB_FILE_PICKER = 100;
    private static final int EXPORT_SAVE = 102;
    private static final int MAX_SAVE_BYTES = 2 * 1024 * 1024;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final RelayPolicy relayPolicy = new RelayPolicy(BuildConfig.COOP_URL);
    private WebView webView;
    private FrameLayout root;
    private TextView loading;
    private Button menuButton;
    private ValueCallback<Uri[]> webFileCallback;
    private String pendingExport;
    private String downloadToken;
    private boolean gameReady;
    private boolean destroyed;
    private int diagnosticGeneration;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED);
        hideSystemBars();

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        setContentView(root);
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }

        try {
            webView = new WebView(this);
            WebView.setWebContentsDebuggingEnabled(false);
            WebSettings settings = webView.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setAllowFileAccess(false);
            settings.setAllowContentAccess(true);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setSupportZoom(false);
            settings.setBuiltInZoomControls(false);
            settings.setDisplayZoomControls(false);
            settings.setUseWideViewPort(true);
            settings.setLoadWithOverviewMode(true);
            webView.setBackgroundColor(Color.BLACK);
            webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
            root.addView(webView, new FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

            WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                    .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                    .build();
            webView.setWebViewClient(new OfflineClient(assetLoader));
            webView.setWebChromeClient(new OfflineChromeClient());
            webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, length) ->
                    downloadSave(url));

            loading = new TextView(this);
            loading.setText("Preparing your game…");
            loading.setTextColor(Color.WHITE);
            loading.setBackgroundColor(Color.BLACK);
            loading.setTextSize(18);
            loading.setGravity(Gravity.CENTER);
            root.addView(loading, new FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

            menuButton = new Button(this);
            menuButton.setText("⋮");
            menuButton.setTextSize(24);
            menuButton.setTextColor(Color.WHITE);
            menuButton.setBackgroundColor(0x66000000);
            menuButton.setContentDescription("Game menu");
            menuButton.setPadding(0, 0, 0, 0);
            menuButton.setVisibility(View.GONE);
            menuButton.setOnClickListener(v -> showGameMenu());
            FrameLayout.LayoutParams buttonParams = new FrameLayout.LayoutParams(
                    dp(40), dp(40), Gravity.TOP | Gravity.RIGHT);
            buttonParams.setMargins(dp(6), dp(6), dp(6), dp(6));
            root.addView(menuButton, buttonParams);

            if (!WebViewFeature.isFeatureSupported(WebViewFeature.CROSS_ORIGIN_ISOLATED_ALLOWLIST)
                    || !WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)
                    || !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                showCompatibilityScreen(false);
                return;
            }
            WebViewCompat.addWebMessageListener(webView, "NativeDownloads", Collections.singleton(ORIGIN),
                    (view, message, sourceOrigin, isMainFrame, replyProxy) -> {
                        if (isMainFrame && ORIGIN.equals(sourceOrigin.toString())) {
                            receiveDownload(message.getData());
                        }
                    });
            WebViewCompat.getProfile(webView).setCrossOriginIsolatedAllowlist(
                    Collections.singleton(ORIGIN));
            try (InputStream ignored = getAssets().open("game/index.html")) {
                // All game files are packaged before making an installable release.
            } catch (Exception exception) {
                showMissingGameScreen();
                return;
            }
            startDiagnostic();
        } catch (RuntimeException exception) {
            showCompatibilityScreen(false);
        }
    }

    private void showMissingGameScreen() {
        loading.setText("The game files are missing from this copy.\nInstall the complete Run Escape release.");
        loading.setPadding(dp(24), dp(16), dp(24), dp(16));
    }

    private void startDiagnostic() {
        if (destroyed || webView == null) return;
        gameReady = false;
        diagnosticGeneration++;
        if (loading != null) loading.setVisibility(View.VISIBLE);
        if (menuButton != null) menuButton.setVisibility(View.GONE);
        webView.loadUrl(CHECK_URL);
    }

    private void pollDiagnostic(int generation, int attempts) {
        if (destroyed || generation != diagnosticGeneration || webView == null) return;
        webView.evaluateJavascript("JSON.stringify(window.__offlineCheck || {state:'pending'})", value -> {
            if (destroyed || generation != diagnosticGeneration) return;
            try {
                Object decoded = new JSONTokener(value).nextValue();
                JSONObject result = new JSONObject((String) decoded);
                String state = result.optString("state");
                if ("passed".equals(state)) {
                    diagnosticGeneration++;
                    webView.loadUrl(GAME_URL);
                    return;
                }
                if ("failed".equals(state) || attempts >= 100) {
                    showCompatibilityScreen(true);
                    return;
                }
            } catch (Exception ignored) {
                if (attempts >= 100) {
                    showCompatibilityScreen(true);
                    return;
                }
            }
            handler.postDelayed(() -> pollDiagnostic(generation, attempts + 1), 100);
        });
    }

    private void showCompatibilityScreen(boolean retryAvailable) {
        diagnosticGeneration++;
        gameReady = false;
        if (destroyed || root == null) return;
        if (webView != null) webView.stopLoading();
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER);
        panel.setPadding(dp(28), dp(16), dp(28), dp(16));
        panel.setBackgroundColor(Color.BLACK);
        TextView title = new TextView(this);
        title.setText("Your game needs an updated WebView");
        title.setTextColor(Color.WHITE);
        title.setTextSize(22);
        title.setGravity(Gravity.CENTER);
        panel.addView(title);
        TextView message = new TextView(this);
        message.setText("Update Android System WebView and Chrome to version 152 or newer, "
                + "then reopen Run Escape. Solo play works in airplane mode. "
                + "Co-op needs an internet connection.");
        message.setTextColor(0xffcccccc);
        message.setTextSize(16);
        message.setGravity(Gravity.CENTER);
        message.setPadding(0, dp(12), 0, dp(12));
        panel.addView(message);
        Button update = new Button(this);
        update.setText("Update Android System WebView");
        update.setOnClickListener(v -> openWebViewUpdate());
        panel.addView(update);
        if (retryAvailable) {
            Button retry = new Button(this);
            retry.setText("Try again");
            retry.setOnClickListener(v -> recreate());
            panel.addView(retry);
        }
        Button close = new Button(this);
        close.setText("Close");
        close.setOnClickListener(v -> finish());
        panel.addView(close);
        root.addView(panel, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
    }

    private void openWebViewUpdate() {
        String packageName = "com.google.android.webview";
        try {
            android.content.pm.PackageInfo info = WebView.getCurrentWebViewPackage();
            if (info != null) packageName = info.packageName;
        } catch (RuntimeException ignored) { }
        try {
            startActivity(new Intent(Intent.ACTION_VIEW,
                    Uri.parse("market://details?id=" + packageName)));
        } catch (ActivityNotFoundException exception) {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW,
                        Uri.parse("https://play.google.com/store/apps/details?id=" + packageName)));
            } catch (ActivityNotFoundException ignored) {
                toast("Update Android System WebView using your app store.");
            }
        }
    }

    private void showGameMenu() {
        if (!gameReady || destroyed) return;
        String[] options = {"Close menu", "Save help", "Restart game", "About", "Exit"};
        new AlertDialog.Builder(this).setTitle("Run Escape")
                .setItems(options, (dialog, which) -> {
                    switch (which) {
                        case 1:
                            new AlertDialog.Builder(this).setTitle("Your progress")
                                    .setMessage("From the title screen, open Settings, then use Export "
                                            + "to save a copy or Import to restore one.\n\n"
                                            + "Progress is kept on this device. Export a copy before "
                                            + "uninstalling or clearing the app's data.")
                                    .setPositiveButton("Close", null).show();
                            break;
                        case 2: webView.reload(); break;
                        case 3:
                            new AlertDialog.Builder(this).setTitle("Run Escape " + BuildConfig.VERSION_NAME)
                                    .setMessage("Solo play works offline, including in airplane mode. "
                                            + "Co-op needs an internet connection and an available server.\n\nGame by Dynrothe.\n"
                                            + "Source: github.com/Dynrothe/Run-Escape\n\n"
                                            + "A fan project, not affiliated with Jagex. "
                                            + "Old School RuneScape assets belong to Jagex.\n\n"
                                            + "Use Android's Back action to reopen this menu.")
                                    .setNeutralButton("Licenses", (about, action) -> showLicenses())
                                    .setPositiveButton("Close", null).show();
                            break;
                        case 4: finish(); break;
                        default: break;
                    }
                    hideSystemBars();
                }).setOnDismissListener(dialog -> hideSystemBars()).show();
    }

    private void showLicenses() {
        String license;
        try (InputStream input = getAssets().open("archive/LICENSE-game.txt");
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int read;
            while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
            license = output.toString(StandardCharsets.UTF_8.name());
        } catch (Exception exception) {
            toast("The license text could not be opened.");
            return;
        }
        TextView text = new TextView(this);
        text.setText("Run Escape by Dynrothe\n"
                + "Source: github.com/Dynrothe/Run-Escape\n\n"
                + "Old School RuneScape assets belong to Jagex. "
                + "This fan project is not affiliated with or endorsed by Jagex.\n\n"
                + license);
        text.setTextSize(14);
        text.setTextIsSelectable(true);
        text.setPadding(dp(20), dp(12), dp(20), dp(12));
        ScrollView scroll = new ScrollView(this);
        scroll.addView(text);
        new AlertDialog.Builder(this).setTitle("Licenses and credits")
                .setView(scroll).setPositiveButton("Close", null)
                .setOnDismissListener(dialog -> hideSystemBars()).show();
    }

    // Export exactly the game's Blob, including protected newer or unreadable saves.
    // Imports stay in the game so its migration and save-lock checks remain in force.
    private void downloadSave(String url) {
        if (!gameReady || webView == null || destroyed || pendingExport != null || downloadToken != null
                || url == null || !url.startsWith("blob:" + ORIGIN + "/")) return;
        String token = java.util.UUID.randomUUID().toString();
        downloadToken = token;
        String script = "(async()=>{try{const r=await fetch(" + JSONObject.quote(url) + ");"
                + "const b=await r.blob();if(b.size>" + MAX_SAVE_BYTES + ")throw Error('size');"
                + "NativeDownloads.postMessage(JSON.stringify({token:" + JSONObject.quote(token)
                + ",text:await b.text()}));}catch(e){NativeDownloads.postMessage(JSON.stringify({token:"
                + JSONObject.quote(token) + ",error:true}));}})();";
        webView.evaluateJavascript(script, null);
        handler.postDelayed(() -> {
            if (token.equals(downloadToken)) {
                downloadToken = null;
                toast("The save could not be exported. Please try again.");
            }
        }, 10000);
    }

    private void receiveDownload(String message) {
        if (destroyed || !gameReady || isFinishing() || downloadToken == null) return;
        try {
            JSONObject result = new JSONObject(message);
            if (!downloadToken.equals(result.optString("token"))) return;
            downloadToken = null;
            if (result.optBoolean("error") || !result.has("text")) throw new IllegalArgumentException();
            String text = result.getString("text");
            if (text.getBytes(StandardCharsets.UTF_8).length > MAX_SAVE_BYTES) {
                throw new IllegalArgumentException();
            }
            pendingExport = text;
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("application/json");
            intent.putExtra(Intent.EXTRA_TITLE, "run-escape-save.json");
            startActivityForResult(intent, EXPORT_SAVE);
        } catch (Exception exception) {
            pendingExport = null;
            toast("The save could not be exported. Please try again.");
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == WEB_FILE_PICKER) {
            if (webFileCallback != null) {
                webFileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                webFileCallback = null;
            }
            return;
        }
        if (requestCode == EXPORT_SAVE) {
            try {
                if (resultCode == RESULT_OK && data != null && data.getData() != null && pendingExport != null) {
                    try (OutputStream stream = getContentResolver().openOutputStream(data.getData(), "wt")) {
                        if (stream == null) throw new IllegalStateException("No output stream");
                        stream.write(pendingExport.getBytes(StandardCharsets.UTF_8));
                    }
                    toast("Save exported.");
                }
            } catch (Exception exception) {
                toast("The save could not be written. Please try again.");
            } finally {
                pendingExport = null;
            }
            return;
        }
    }

    private static boolean isLocal(Uri uri) {
        return "https".equals(uri.getScheme())
                && "appassets.androidplatform.net".equals(uri.getHost())
                && (uri.getPort() == -1 || uri.getPort() == 443)
                && uri.getPath() != null && uri.getPath().startsWith(GAME_ROOT);
    }

    private Map<String, String> isolationHeaders() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Document-Isolation-Policy", "isolate-and-credentialless");
        headers.put("Cross-Origin-Opener-Policy", "same-origin");
        headers.put("Cross-Origin-Embedder-Policy", "require-corp");
        headers.put("Cross-Origin-Resource-Policy", "same-origin");
        headers.put("Content-Security-Policy", relayPolicy.contentSecurityPolicy());
        return headers;
    }

    private WebResourceResponse textResponse(String mime, String text, int status) {
        return new WebResourceResponse(mime, "UTF-8", status, status == 200 ? "OK" : "Not Found",
                isolationHeaders(), new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8)));
    }

    private final class OfflineClient extends WebViewClient {
        private final WebViewAssetLoader loader;

        OfflineClient(WebViewAssetLoader loader) { this.loader = loader; }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (!isLocal(uri)) {
                if ("GET".equals(request.getMethod()) && relayPolicy.allowsNetworkRequest(uri.toString())) {
                    return null;
                }
                return textResponse("text/plain", "Not available", 404);
            }
            if (CHECK_URL.equals(uri.toString())) return textResponse("text/html", diagnosticHtml(), 200);
            if (WORKER_URL.equals(uri.toString())) {
                return textResponse("text/javascript", "self.onmessage=async e=>{try{"
                        + "const r=await fetch('caches/caches.json');if(!r.ok)throw Error('cache');"
                        + "const c=await r.json();if(!Array.isArray(c)||!c.length)throw Error('cache');"
                        + "const v=new Int32Array(e.data);v[0]+=1;self.postMessage(v[0]);"
                        + "}catch(e){self.postMessage(-1)}};", 200);
            }
            WebResourceResponse response = loader.shouldInterceptRequest(uri);
            if (response == null) return textResponse("text/plain", "Not found", 404);
            String path = uri.getPath();
            if (path != null) {
                if (path.endsWith(".wasm")) response.setMimeType("application/wasm");
                else if (path.endsWith(".js") || path.endsWith(".mjs")) response.setMimeType("text/javascript");
                else if (path.endsWith(".webmanifest")) response.setMimeType("application/manifest+json");
            }
            Map<String, String> headers = new HashMap<>();
            if (response.getResponseHeaders() != null) headers.putAll(response.getResponseHeaders());
            headers.putAll(isolationHeaders());
            response.setResponseHeaders(headers);
            return response;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (isLocal(uri)) return false;
            if (request.isForMainFrame() && request.hasGesture() && "https".equals(uri.getScheme())
                    && ("github.com".equals(uri.getHost()) || "discord.gg".equals(uri.getHost())
                    || "discord.com".equals(uri.getHost()))) {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (ActivityNotFoundException ignored) {
                    toast("No browser is available to open this link.");
                }
            }
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (destroyed) return;
            if (CHECK_URL.equals(url)) {
                pollDiagnostic(diagnosticGeneration, 0);
            } else if (GAME_URL.equals(url)) {
                gameReady = true;
                loading.setVisibility(View.GONE);
                menuButton.setVisibility(View.VISIBLE);
                handler.postDelayed(() -> {
                    if (!destroyed && menuButton != null) menuButton.setVisibility(View.GONE);
                }, 6000);
                if (!getPreferences(MODE_PRIVATE).getBoolean("save-menu-hint", false)) {
                    toast("Use Back to open the game menu.");
                    getPreferences(MODE_PRIVATE).edit().putBoolean("save-menu-hint", true).apply();
                }
            }
        }

        @Override
        public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
            if (!destroyed) {
                gameReady = false;
                diagnosticGeneration++;
                root.removeView(view);
                view.destroy();
                webView = null;
                new AlertDialog.Builder(MainActivity.this).setTitle("The game stopped")
                        .setMessage("Reopen the game to continue. Your saved progress is kept.")
                        .setPositiveButton("Reopen", (dialog, which) -> recreate())
                        .setNegativeButton("Close", (dialog, which) -> finish()).show();
            }
            return true;
        }
    }

    private final class OfflineChromeClient extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                         FileChooserParams parameters) {
            if (webFileCallback != null) webFileCallback.onReceiveValue(null);
            webFileCallback = callback;
            try {
                Intent intent = parameters.createIntent();
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                startActivityForResult(intent, WEB_FILE_PICKER);
            } catch (ActivityNotFoundException exception) {
                webFileCallback.onReceiveValue(null);
                webFileCallback = null;
                toast("No file picker is available on this device.");
            }
            return true;
        }
    }

    private static String diagnosticHtml() {
        return "<!doctype html><meta name='viewport' content='width=device-width,initial-scale=1'>"
                + "<style>html,body{background:#000}</style><script>"
                + "window.__offlineCheck={state:'pending'};let worker;"
                + "try{if(!window.crossOriginIsolated||typeof SharedArrayBuffer!=='function')throw Error('isolation');"
                + "let canvas=document.createElement('canvas');let gl=canvas.getContext('webgl2');"
                + "if(!gl)throw Error('graphics');let lose=gl.getExtension('WEBGL_lose_context');"
                + "if(lose)lose.loseContext();canvas=null;gl=null;"
                + "const buffer=new SharedArrayBuffer(4),view=new Int32Array(buffer);view[0]=42;"
                + "worker=new Worker('offline-check-worker.js');"
                + "worker.onmessage=e=>{window.__offlineCheck={state:e.data===43&&view[0]===43?'passed':'failed'};worker.terminate()};"
                + "worker.onerror=()=>{window.__offlineCheck={state:'failed'};worker.terminate()};"
                + "worker.postMessage(buffer);"
                + "setTimeout(()=>{if(window.__offlineCheck.state==='pending'){window.__offlineCheck={state:'failed'};worker.terminate()}},8000);"
                + "}catch(e){window.__offlineCheck={state:'failed'}}"
                + "</script>";
    }

    private void handleBack() {
        if (gameReady) showGameMenu(); else finish();
    }

    @Override
    public void onBackPressed() { handleBack(); }

    private void hideSystemBars() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onDestroy() {
        destroyed = true;
        diagnosticGeneration++;
        handler.removeCallbacksAndMessages(null);
        if (webFileCallback != null) {
            webFileCallback.onReceiveValue(null);
            webFileCallback = null;
        }
        if (webView != null) {
            root.removeView(webView);
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private void toast(String message) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
