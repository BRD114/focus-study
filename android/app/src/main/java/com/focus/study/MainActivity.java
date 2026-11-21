package com.focus.study;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Locale;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/**
 * Focus · 专注 —— 原生外壳
 *
 * 设计原则：
 * 1. 零第三方依赖、零网络权限，纯 WebView + 本地资源，启动即用；
 * 2. 数据全部由前端 localStorage（DOM Storage）持久化，卸载才会清空；
 * 3. 只向页面暴露极少量原生能力：震动、常亮、全屏沉浸、状态栏深浅色、剪贴板。
 *
 * 加载策略（v1.0.2）：
 *   - 不再使用 file://（v1.0.0 因此白屏 ERR_FILE_NOT_FOUND，且各机型策略不一致）；
 *   - 把 assets 通过 shouldInterceptRequest 映射成虚拟站点
 *     https://appassets.androidplatform.net/...（等同官方 WebViewAssetLoader）；
 *   - 读资源有两条通道：AssetManager 失败时直接读 APK zip 里的条目，
 *     绕开个别机型 / WebView 上 AssetManager 读不到资源的怪问题；
 *   - 启动时用「原生」控件显示版本号，失败时用「原生」诊断页显示详细原因，
 *     不依赖 WebView —— 保证任何情况下屏幕上都有可用信息。
 */
public class MainActivity extends Activity {

    /* ---------- 虚拟站点：assets 就是站点根目录 ---------- */
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/www/index.html";
    private static final String ENTRY = "www/index.html";

    private static final int BG_LIGHT = 0xFFF5F6F3;
    private static final int INK = 0xFF20241F;
    private static final int INK_2 = 0xFF6B716A;
    private static final int BRAND = 0xFF3C6B53;
    private static final int LINE = 0xFFE3E5E0;

    private static final String COLOR_LIGHT = "#F5F6F3";
    private static final String COLOR_DARK = "#0D100F";

    private FrameLayout root;
    private FrameLayout splash;
    private WebView web;

    /** 0 = 虚拟站点加载中 / 1 = 已成功显示页面 / 2 = 诊断页 */
    private int stage = 0;
    private boolean committed = false;
    private boolean diagShown = false;
    private long lastBackAt = 0;

    private ZipFile apkZip;
    private final Handler ui = new Handler(Looper.getMainLooper());

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        root = new FrameLayout(this);
        root.setBackgroundColor(BG_LIGHT);
        setContentView(root);

        try {
            web = new WebView(this);
        } catch (Throwable t) {
            showNativeError("WebView 初始化失败", t.toString());
            return;
        }
        web.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // localStorage 必须开启，否则数据不落盘
        s.setDatabaseEnabled(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(false); // 结束提示音由代码触发，不需要手势
        s.setTextZoom(100);                    // 忽略系统字体缩放，避免布局被撑坏
        s.setAllowFileAccess(false);           // 本版本完全不依赖 file://
        s.setAllowContentAccess(false);
        s.setGeolocationEnabled(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);

        web.setBackgroundColor(BG_LIGHT);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.setLongClickable(false);
        web.setHapticFeedbackEnabled(false);

        web.addJavascriptInterface(new Bridge(), "AndroidBridge");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());

        buildSplash();
        loadStart();
        applyDark(false);
    }

    /* ------------------------------------------------------------------
     * 启动页：原生控件，顺便把「装的是哪一版」摆在屏幕上
     * ------------------------------------------------------------------ */
    private void buildSplash() {
        splash = new FrameLayout(this);
        splash.setBackgroundColor(BG_LIGHT);
        splash.setClickable(true);
        splash.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER_HORIZONTAL);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.gravity = Gravity.CENTER;
        box.setLayoutParams(lp);

        TextView name = new TextView(this);
        name.setText("Focus");
        name.setTextColor(INK);
        name.setTextSize(TypedValue.COMPLEX_UNIT_SP, 26);
        name.setTypeface(Typeface.create("sans-serif-light", Typeface.NORMAL));
        name.setLetterSpacing(0.06f);
        name.setGravity(Gravity.CENTER);
        box.addView(name);

        TextView ver = new TextView(this);
        ver.setText("v" + versionName() + " · 本地资源加载中…");
        ver.setTextColor(INK_2);
        ver.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        ver.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams vlp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        vlp.topMargin = dp(10);
        ver.setLayoutParams(vlp);
        box.addView(ver);

        splash.addView(box);
        root.addView(splash);
    }

    private void hideSplash() {
        if (splash != null && splash.getParent() != null) {
            splash.animate().alpha(0f).setDuration(160).withEndAction(new Runnable() {
                @Override
                public void run() {
                    if (splash != null && splash.getParent() != null) {
                        root.removeView(splash);
                    }
                }
            }).start();
        }
    }

    private void loadStart() {
        stage = 0;
        committed = false;
        diagShown = false;
        if (splash != null && splash.getParent() == null) {
            buildSplash();
        }
        ui.removeCallbacks(watchdog);
        ui.postDelayed(watchdog, 7000);
        web.loadUrl(START_URL);
    }

    private final Runnable watchdog = new Runnable() {
        @Override
        public void run() {
            if (stage == 0 && !committed) {
                showDiagnostics("加载超时：7 秒内既没有渲染完成，也没有回调错误");
            }
        }
    };

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) {
            web.onResume();
            web.evaluateJavascript(
                    "(function(){try{if(window.FocusApp&&FocusApp.onResume)FocusApp.onResume();}catch(e){}})()",
                    null);
        }
    }

    @Override
    protected void onPause() {
        if (web != null) {
            // 让前端先把计时状态落盘（切后台/锁屏前）
            web.evaluateJavascript(
                    "(function(){try{window.dispatchEvent(new Event('pagehide'));}catch(e){}})()",
                    null);
            web.onPause();
        }
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        ui.removeCallbacksAndMessages(null);
        if (web != null) {
            web.loadUrl("about:blank");
            web.destroy();
            web = null;
        }
        closeZip();
        super.onDestroy();
    }

    /* ------------------------------------------------------------------
     * 返回键：先交给前端处理（关面板 / 退深度专注 / 回首页），
     * 前端不消费时再走「再按一次退出」。
     * ------------------------------------------------------------------ */
    @Override
    public void onBackPressed() {
        if (web == null || diagShown) {
            finish();
            return;
        }
        web.evaluateJavascript(
                "(function(){try{return window.onAndroidBack?window.onAndroidBack():'0';}catch(e){return '0';}})()",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        if (value != null && (value.equals("1") || value.equals("\"1\""))) return;
                        long now = System.currentTimeMillis();
                        if (now - lastBackAt < 2000) {
                            finish();
                        } else {
                            lastBackAt = now;
                            Toast.makeText(MainActivity.this, "再按一次退出", Toast.LENGTH_SHORT).show();
                        }
                    }
                });
    }

    /* ------------------------------------------------------------------
     * 系统栏样式
     * ------------------------------------------------------------------ */
    private void applyDark(boolean isDark) {
        Window w = getWindow();
        View decor = w.getDecorView();
        int barColor = Color.parseColor(isDark ? COLOR_DARK : COLOR_LIGHT);

        w.setStatusBarColor(barColor);
        w.setNavigationBarColor(barColor);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController c = decor.getWindowInsetsController();
            if (c != null) {
                int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                        | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                c.setSystemBarsAppearance(isDark ? 0 : mask, mask);
            }
        } else {
            int flags = decor.getSystemUiVisibility();
            if (isDark) {
                flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                flags &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            } else {
                flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            }
            decor.setSystemUiVisibility(flags);
        }
        if (web != null) web.setBackgroundColor(barColor);
    }

    private void applyImmersive(boolean on) {
        Window w = getWindow();
        View decor = w.getDecorView();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController c = decor.getWindowInsetsController();
            if (c == null) return;
            if (on) {
                c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            } else {
                c.show(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
            }
        } else {
            int flags = on
                    ? View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    : View.SYSTEM_UI_FLAG_VISIBLE;
            decor.setSystemUiVisibility(flags);
        }
    }

    /* ------------------------------------------------------------------
     * 资源读取：AssetManager 优先，失败则直接读 APK zip（绕开资源管理器）
     * ------------------------------------------------------------------ */

    private InputStream openAsset(String rel) throws IOException {
        try {
            return getAssets().open(rel);
        } catch (IOException first) {
            ZipFile z = apkZip();
            if (z != null) {
                // 顺带兼容被写成反斜杠的条目名（aapt2 在 Windows 上的老毛病）
                String[] candidates = {"assets/" + rel, "assets/" + rel.replace('/', (char) 92)};
                for (int i = 0; i < candidates.length; i++) {
                    ZipEntry e = z.getEntry(candidates[i]);
                    if (e != null) {
                        try {
                            return z.getInputStream(e);
                        } catch (IOException ignored) { }
                    }
                }
            }
            throw first;
        }
    }

    private synchronized ZipFile apkZip() {
        if (apkZip == null) {
            try {
                apkZip = new ZipFile(getPackageCodePath());
            } catch (Throwable ignored) {
                apkZip = null;
            }
        }
        return apkZip;
    }

    private synchronized void closeZip() {
        if (apkZip != null) {
            try { apkZip.close(); } catch (Exception ignored) { }
            apkZip = null;
        }
    }

    /** 把 /www/css/style.css 这样的请求路径映射到 assets/www/css/style.css */
    private WebResourceResponse serveAsset(String path) {
        String rel = (path == null || path.length() == 0) ? ("/" + ENTRY) : path;
        if (rel.startsWith("/")) rel = rel.substring(1);
        if (rel.length() == 0) rel = ENTRY;
        if (rel.contains("..")) return notFound();
        try {
            InputStream in = openAsset(rel);
            return new WebResourceResponse(mimeOf(rel), isText(rel) ? "utf-8" : null, in);
        } catch (Throwable e) {
            // 返回 404 响应而不是 null：null 会让 WebView 真的去联网（本应用无网络权限）
            return notFound();
        }
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8",
                new ByteArrayInputStream("not found".getBytes()));
    }

    private static boolean isText(String p) {
        String s = p.toLowerCase(Locale.US);
        return s.endsWith(".html") || s.endsWith(".htm") || s.endsWith(".css")
                || s.endsWith(".js") || s.endsWith(".json") || s.endsWith(".svg")
                || s.endsWith(".webmanifest");
    }

    private static String mimeOf(String p) {
        String s = p.toLowerCase(Locale.US);
        if (s.endsWith(".html") || s.endsWith(".htm")) return "text/html";
        if (s.endsWith(".css")) return "text/css";
        if (s.endsWith(".js")) return "application/javascript";
        if (s.endsWith(".json")) return "application/json";
        if (s.endsWith(".webmanifest")) return "application/manifest+json";
        if (s.endsWith(".png")) return "image/png";
        if (s.endsWith(".svg")) return "image/svg+xml";
        if (s.endsWith(".ico")) return "image/x-icon";
        return "application/octet-stream";
    }

    /* ------------------------------------------------------------------
     * 启动失败 → 原生诊断页（不依赖 WebView，一定能显示出来）
     * ------------------------------------------------------------------ */
    private void onMainFrameFail(int code) {
        if (stage >= 2 || diagShown) return;
        showDiagnostics("页面加载失败（错误码 " + code + "）");
    }

    private void showNativeError(String title, String detail) {
        String report = title + "\n\n" + detail;
        showNativePanel(title, report, false);
    }

    private void showDiagnostics(String reason) {
        if (diagShown) return;
        stage = 2;
        ui.removeCallbacks(watchdog);

        showNativePanel("应用没能加载页面", buildReport(reason), true);
    }

    /**
     * 原生诊断面板。刻意不使用 WebView：
     * 无论资源、协议、WebView 出现什么问题，这段信息都一定能显示并被截图。
     */
    private void showNativePanel(String title, String report, boolean retryable) {
        diagShown = true;
        if (web != null) web.setVisibility(View.GONE);

        hideSplash();

        final ScrollView sc = new ScrollView(this);
        sc.setBackgroundColor(BG_LIGHT);
        FrameLayout.LayoutParams slp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        sc.setLayoutParams(slp);
        sc.setPadding(dp(22), dp(38), dp(22), dp(22));

        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);

        TextView h = new TextView(this);
        h.setText(title);
        h.setTextColor(INK);
        h.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        h.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        col.addView(h);

        TextView sub = new TextView(this);
        sub.setText("把这一页截图发给开发者即可定位（信息全部来自本机，不联网）");
        sub.setTextColor(INK_2);
        sub.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        LinearLayout.LayoutParams subLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        subLp.topMargin = dp(6);
        sub.setLayoutParams(subLp);
        col.addView(sub);

        TextView body = new TextView(this);
        body.setText(report);
        body.setTextColor(0xFF454B44);
        body.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        body.setTypeface(Typeface.MONOSPACE);
        body.setLineSpacing(dp(3), 1f);
        body.setTextIsSelectable(true);
        LinearLayout.LayoutParams blp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        blp.topMargin = dp(16);
        body.setLayoutParams(blp);
        col.addView(body);

        if (retryable) {
            Button again = new Button(this);
            again.setText("重新加载");
            again.setAllCaps(false);
            again.setTextColor(Color.WHITE);
            again.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
            again.setBackgroundColor(BRAND);
            LinearLayout.LayoutParams alp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, dp(46));
            alp.topMargin = dp(20);
            again.setLayoutParams(alp);
            again.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    root.removeView(sc);
                    diagShown = false;
                    if (web != null) web.setVisibility(View.VISIBLE);
                    loadStart();
                }
            });
            col.addView(again);
        }

        Button copy = new Button(this);
        copy.setText("复制诊断信息");
        copy.setAllCaps(false);
        copy.setTextColor(BRAND);
        copy.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        copy.setBackgroundColor(0x00000000);
        LinearLayout.LayoutParams clp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(46));
        copy.setLayoutParams(clp);
        copy.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                copyToClipboard("Focus 诊断信息", report);
            }
        });
        col.addView(copy);

        sc.addView(col);
        root.addView(sc);
    }

    private String buildReport(String reason) {
        StringBuilder b = new StringBuilder();
        b.append("版本: ").append(versionName()).append(" (code ").append(versionCode()).append(")\n");
        b.append("原因: ").append(reason).append('\n');
        b.append("目标: ").append(START_URL).append("\n\n");

        b.append("— 资源探测 —\n");
        b.append("asset open: ").append(probeAsset()).append('\n');
        b.append("apk zip   : ").append(probeZip()).append('\n');
        b.append("apk path  : ").append(getPackageCodePath()).append('\n');
        b.append("assets/   : ").append(listDir("")).append('\n');
        b.append("assets/www: ").append(listDir("www")).append('\n');
        b.append("www/js    : ").append(listDir("www/js")).append('\n');
        b.append("www/css   : ").append(listDir("www/css")).append('\n');

        b.append("\n— 设备 —\n");
        b.append("Android: ").append(Build.VERSION.RELEASE)
                .append(" (API ").append(Build.VERSION.SDK_INT).append(")\n");
        b.append("机型: ").append(Build.MANUFACTURER).append(' ').append(Build.MODEL).append('\n');
        if (web != null) {
            String ua = "?";
            try { ua = web.getSettings().getUserAgentString(); } catch (Throwable ignored) { }
            b.append("WebView: ").append(ua).append('\n');
        }
        return b.toString();
    }

    private String probeAsset() {
        InputStream in = null;
        try {
            in = getAssets().open(ENTRY);
            int n = 0;
            byte[] buf = new byte[8192];
            int r;
            while ((r = in.read(buf)) > 0) n += r;
            return "OK " + n + " bytes";
        } catch (Throwable e) {
            return "失败 " + e.getClass().getSimpleName() + ": " + safeMsg(e.getMessage());
        } finally {
            if (in != null) try { in.close(); } catch (Exception ignored) { }
        }
    }

    private String probeZip() {
        try {
            ZipFile z = apkZip();
            if (z == null) return "无法打开 APK";
            ZipEntry e = z.getEntry("assets/" + ENTRY);
            if (e == null) {
                StringBuilder all = new StringBuilder("没有 assets/" + ENTRY + "；条目样例: ");
                int i = 0;
                java.util.Enumeration<? extends ZipEntry> en = z.entries();
                while (en.hasMoreElements() && i < 12) {
                    all.append(en.nextElement().getName()).append(i == 11 ? "" : ", ");
                    i++;
                }
                return all.toString();
            }
            InputStream in = z.getInputStream(e);
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int r;
            int total = 0;
            while ((r = in.read(buf)) > 0) { bo.write(buf, 0, r); total += r; }
            in.close();
            return "OK " + total + " bytes";
        } catch (Throwable e) {
            return "失败 " + e.getClass().getSimpleName() + ": " + safeMsg(e.getMessage());
        }
    }

    private static String safeMsg(String m) {
        if (m == null) return "(null)";
        return m.length() > 120 ? m.substring(0, 120) + "…" : m;
    }

    private String listDir(String dir) {
        try {
            String[] items = getAssets().list(dir);
            if (items == null || items.length == 0) return "(空)";
            StringBuilder b = new StringBuilder();
            for (int i = 0; i < items.length; i++) {
                if (i > 0) b.append(", ");
                b.append(items[i]);
            }
            return b.toString();
        } catch (Throwable e) {
            return "(失败 " + e.getClass().getSimpleName() + ")";
        }
    }

    private String versionName() {
        try {
            PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
            return pi.versionName == null ? "?" : pi.versionName;
        } catch (Throwable e) {
            return "?";
        }
    }

    private int versionCode() {
        try {
            PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
            return pi.versionCode;
        } catch (Throwable e) {
            return -1;
        }
    }

    private int dp(int v) {
        return Math.round(TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private void copyToClipboard(String label, String text) {
        try {
            ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm == null) return;
            cm.setPrimaryClip(ClipData.newPlainText(label, text));
            Toast.makeText(this, "已复制", Toast.LENGTH_SHORT).show();
        } catch (Throwable ignored) { }
    }

    /* ------------------------------------------------------------------
     * 暴露给 JS 的原生能力（方法均在子线程被调用，UI 操作切回主线程）
     * ------------------------------------------------------------------ */
    public class Bridge {

        @JavascriptInterface
        public void vibrate(int ms) {
            try {
                Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
                if (v == null || !v.hasVibrator()) return;
                int dur = Math.max(8, Math.min(ms, 800));
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    v.vibrate(VibrationEffect.createOneShot(dur, VibrationEffect.DEFAULT_AMPLITUDE));
                } else {
                    v.vibrate(dur);
                }
            } catch (Throwable ignored) {
                // 没有震动马达或权限不足时静默跳过
            }
        }

        @JavascriptInterface
        public void keepScreenOn(final boolean on) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (on) {
                        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    } else {
                        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    }
                }
            });
        }

        @JavascriptInterface
        public void immersive(final boolean on) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    applyImmersive(on);
                }
            });
        }

        @JavascriptInterface
        public void setDark(final boolean isDark) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    applyDark(isDark);
                }
            });
        }

        /** 备份导出：写入系统剪贴板（WebView 里前端 Clipboard API 往往拿不到权限） */
        @JavascriptInterface
        public void copyText(final String text) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                        if (cm == null) return;
                        cm.setPrimaryClip(ClipData.newPlainText("Focus 数据备份", text));
                        Toast.makeText(MainActivity.this, "备份已复制，粘贴到便签或文件即可保存", Toast.LENGTH_LONG).show();
                    } catch (Throwable ignored) {
                        Toast.makeText(MainActivity.this, "复制失败，请重试", Toast.LENGTH_SHORT).show();
                    }
                }
            });
        }

        /** 备份分享：走系统分享面板，可存到文件 / 发给自己的微信或邮箱 */
        @JavascriptInterface
        public void shareText(final String title, final String text) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        Intent i = new Intent(Intent.ACTION_SEND);
                        i.setType("text/plain");
                        i.putExtra(Intent.EXTRA_SUBJECT, title);
                        i.putExtra(Intent.EXTRA_TEXT, text);
                        startActivity(Intent.createChooser(i, "导出专注数据"));
                    } catch (Throwable ignored) {
                        Toast.makeText(MainActivity.this, "没有可用的分享应用", Toast.LENGTH_SHORT).show();
                    }
                }
            });
        }

        /** 页面里需要重载时（目前仅诊断用） */
        @JavascriptInterface
        public void retry() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    loadStart();
                }
            });
        }

        /** 预留扩展点：番茄/深度专注结束时回调原生，可用于以后接「本地通知」 */
        @JavascriptInterface
        public void onTimerEnd(String mode) {
            // v1 保持静音：不推送、不弹系统通知，只在应用内温和提示。
        }
    }

    /* ------------------------------------------------------------------
     * 资源拦截 + 页面内跳转全部拦下（不跳出外部浏览器）
     * ------------------------------------------------------------------ */
    private class Client extends WebViewClient {

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri u = request == null ? null : request.getUrl();
            return u == null || !HOST.equals(u.getHost());
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri u = request == null ? null : request.getUrl();
            if (u == null) return null;
            if (!"https".equals(u.getScheme()) || !HOST.equals(u.getHost())) return null;
            return serveAsset(u.getPath());
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
            if (url == null) return null;
            Uri u = Uri.parse(url);
            if (!"https".equals(u.getScheme()) || !HOST.equals(u.getHost())) return null;
            return serveAsset(u.getPath());
        }

        @Override
        public void onPageCommitVisible(WebView view, String url) {
            if (diagShown) return;
            committed = true;
            stage = 1;
            ui.removeCallbacks(watchdog);
            hideSplash();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request == null || !request.isForMainFrame()) return;
            int code = -1;
            try {
                code = error == null ? -1 : error.getErrorCode();
            } catch (Throwable ignored) { }
            onMainFrameFail(code);
        }
    }

    /* ------------------------------------------------------------------
     * 支持 alert / confirm / prompt（编辑面板、删除确认、导入备份要用）
     * ------------------------------------------------------------------ */
    private static class Chrome extends WebChromeClient {

        @Override
        public boolean onJsAlert(WebView view, String url, String message, final JsResult result) {
            new AlertDialog.Builder(view.getContext())
                    .setMessage(message)
                    .setCancelable(false)
                    .setPositiveButton("好", new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface d, int w) { result.confirm(); }
                    })
                    .show();
            return true;
        }

        @Override
        public boolean onJsConfirm(WebView view, String url, String message, final JsResult result) {
            new AlertDialog.Builder(view.getContext())
                    .setMessage(message)
                    .setPositiveButton("确定", new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface d, int w) { result.confirm(); }
                    })
                    .setNegativeButton("取消", new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface d, int w) { result.cancel(); }
                    })
                    .setOnCancelListener(new DialogInterface.OnCancelListener() {
                        @Override
                        public void onCancel(DialogInterface d) { result.cancel(); }
                    })
                    .show();
            return true;
        }

        @Override
        public boolean onJsPrompt(WebView view, String url, String message, String defaultValue,
                                  final JsPromptResult result) {
            final EditText input = new EditText(view.getContext());
            input.setText(defaultValue == null ? "" : defaultValue);
            input.setTextSize(12f);
            input.setPadding(40, 24, 40, 24);
            new AlertDialog.Builder(view.getContext())
                    .setTitle(message)
                    .setView(input)
                    .setPositiveButton("确定", new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface d, int w) {
                            result.confirm(input.getText().toString());
                        }
                    })
                    .setNegativeButton("取消", new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface d, int w) { result.cancel(); }
                    })
                    .setOnCancelListener(new DialogInterface.OnCancelListener() {
                        @Override
                        public void onCancel(DialogInterface d) { result.cancel(); }
                    })
                    .show();
            return true;
        }
    }
}
