package cn.evolution.studyboard;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.webkit.*;
import android.widget.*;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

public class MainActivity extends Activity {
    private final ExecutorService network = Executors.newFixedThreadPool(2);
    private SharedPreferences prefs;
    private LinearLayout root;
    private FrameLayout content;
    private TextView heading, status;
    private WebView boardView;
    private EditText linkInput;
    private ConnectionInfo connection;
    private String boardId = "", boardTitle = "共享白板";
    private volatile int generation = 0;
    private ValueCallback<Uri[]> fileSelection;
    private byte[] exportData;
    private static final int FILE_PICK = 20, SAVE_FILE = 21;
    private static final int INK = Color.rgb(25, 45, 39), GREEN = Color.rgb(23, 104, 90), BG = Color.rgb(247, 248, 245);

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences("classroom", MODE_PRIVATE);
        root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setBackgroundColor(BG); root.setFitsSystemWindows(true);
        LinearLayout bar = new LinearLayout(this); bar.setGravity(Gravity.CENTER_VERTICAL); bar.setPadding(dp(14), dp(5), dp(8), dp(5));
        LinearLayout labels = new LinearLayout(this); labels.setOrientation(LinearLayout.VERTICAL);
        heading = text("进化课堂", 18); heading.setTypeface(null, Typeface.BOLD);
        status = text("你的随身白板", 11); status.setTextColor(Color.rgb(90, 105, 99));
        labels.addView(heading); labels.addView(status);
        bar.addView(labels, new LinearLayout.LayoutParams(0, dp(48), 1));
        bar.addView(button("重连", v -> connect()), new LinearLayout.LayoutParams(dp(64), dp(48)));
        bar.addView(button("菜单", v -> menu()), new LinearLayout.LayoutParams(dp(64), dp(48)));
        root.addView(bar); content = new FrameLayout(this); root.addView(content, new LinearLayout.LayoutParams(-1, 0, 1)); setContentView(root);
        try {
            String origin = prefs.getString("origin", ""), token = prefs.getString("token", "");
            if (!origin.isEmpty() && !token.isEmpty()) {
                boardId = prefs.getString("board", ""); connection = new ConnectionInfo(origin, token, boardId);
            }
        } catch (Exception ignored) { }
        if (Intent.ACTION_SEND.equals(getIntent().getAction())) {
            showSetup(getIntent().getStringExtra(Intent.EXTRA_TEXT));
        } else if (connection != null) { connect(); } else { showSetup(""); }
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private TextView text(String value, int size) {
        TextView t = new TextView(this); t.setText(value); t.setTextSize(size); t.setTextColor(INK); t.setLineSpacing(dp(3), 1); return t;
    }
    private Button button(String label, View.OnClickListener click) {
        Button b = new Button(this); b.setText(label); b.setAllCaps(false); b.setTextColor(GREEN); b.setTextSize(14); b.setOnClickListener(click); return b;
    }
    private void status(String value) { runOnUiThread(() -> status.setText(value)); }
    private void toast(String value) { Toast.makeText(this, value, Toast.LENGTH_SHORT).show(); }
    private LinearLayout panel() {
        LinearLayout box = new LinearLayout(this); box.setOrientation(LinearLayout.VERTICAL); box.setPadding(dp(26), dp(28), dp(26), dp(20)); return box;
    }
    private void showPanel(LinearLayout box) {
        content.removeAllViews(); ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true); scroll.addView(box); content.addView(scroll);
    }
    private void showSetup(String proposed) {
        generation++;
        heading.setText("进化课堂"); status.setText("连接你的共享课堂");
        LinearLayout box = panel();
        TextView title = text("手机打开，接着学。", 28); title.setTypeface(null, Typeface.BOLD); box.addView(title);
        TextView intro = text("把老师给你的接入链接粘贴到这里。白板与字体已随 App 安装，板书和学习进度继续保存在电脑。", 16);
        intro.setPadding(0, dp(18), 0, dp(20)); box.addView(intro);
        linkInput = new EditText(this); linkInput.setHint("粘贴接入说明或白板的完整链接"); linkInput.setTextSize(14); linkInput.setMinLines(2); linkInput.setMaxLines(4); linkInput.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE | android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        if (proposed != null) linkInput.setText(proposed);
        box.addView(linkInput, new LinearLayout.LayoutParams(-1, -2));
        box.addView(button("粘贴接入链接", v -> {
            ClipboardManager clipboard = (ClipboardManager)getSystemService(CLIPBOARD_SERVICE);
            if (clipboard.hasPrimaryClip() && clipboard.getPrimaryClip().getItemCount() > 0) linkInput.setText(clipboard.getPrimaryClip().getItemAt(0).coerceToText(this));
            else toast("请先复制接入链接。");
        }));
        box.addView(button("连接课堂", v -> {
            try {
                connection = ConnectionInfo.parse(linkInput.getText().toString()); boardId = connection.board;
                prefs.edit().putString("origin", connection.origin).putString("token", connection.token).putString("board", boardId).apply();
                connect();
            } catch (Exception e) { new AlertDialog.Builder(this).setMessage(e.getMessage()).setPositiveButton("知道了", null).show(); }
        }));
        box.addView(button("打开 Tailscale", v -> openTailscale()));
        TextView foot = text("点白板上的“问老师”，消息会进入已接课 Agent 的原对话。电脑需在线，手机只需连接 Tailscale。", 14); foot.setPadding(0, dp(22), 0, 0); box.addView(foot);
        showPanel(box);
    }

    private void connect() {
        if (connection == null) { showSetup(""); return; }
        final int request = ++generation;
        status("正在检查连接…");
        network.execute(() -> {
            try {
                JSONObject health = (JSONObject)api("GET", "/health", null);
                if (!health.optBoolean("ok") || !"study-whiteboard-gateway".equals(health.optString("app"))) throw new IOException("电脑的课堂服务还没有准备好。");
                JSONArray boards = (JSONArray)api("GET", "/api/canvases", null);
                JSONObject chosen = null;
                for (int i=0;i<boards.length();i++) {
                    JSONObject candidate = boards.getJSONObject(i);
                    if (candidate.optString("id").equals(boardId)) { chosen=candidate; break; }
                    if (boardId.isEmpty() && "study-tools-demo-20261107".equals(candidate.optString("chat"))) chosen=candidate;
                }
                final JSONObject picked = chosen;
                runOnUiThread(() -> {
                    if (isDestroyed() || request != generation) return;
                    if (picked != null) openBoard(picked.optString("id"), picked.optString("title", "共享白板"));
                    else chooseBoards(boards);
                });
            } catch (Exception e) { runOnUiThread(() -> { if (!isDestroyed() && request == generation) connectionError(e); }); }
        });
    }
    private void connectionError(Exception error) {
        status("暂未连通，板书仍保存在电脑");
        LinearLayout box = panel(); box.addView(text("还差一步连接", 26));
        String message = "电脑与手机暂时没有连通。确认两边 Tailscale 在线，并在电脑运行“启动手机入口.cmd”。";
        if (error instanceof UnknownHostException) message = "手机暂时无法解析电脑的 Tailscale 地址。请确认 Tailscale 已连接，然后重试。";
        else if (error instanceof SocketTimeoutException || error instanceof ConnectException) message = "连接超时。请检查手机 Tailscale，以及电脑是否已启动课堂入口。";
        else if (error.getMessage() != null && (error.getMessage().startsWith("HTTP 401") || error.getMessage().startsWith("HTTP 403"))) message = "接入信息已失效或不被允许。请重新复制电脑给你的完整接入链接。";
        TextView info = text(message, 16); info.setPadding(0, dp(16), 0, dp(20)); box.addView(info);
        box.addView(button("重新连接", v -> connect())); box.addView(button("打开 Tailscale", v -> openTailscale())); box.addView(button("更换接入信息", v -> showSetup("")));
        showPanel(box);
    }
    private void chooseBoards(JSONArray boards) {
        if (boards.length()==0) { new AlertDialog.Builder(this).setMessage("还没有板书。请先让老师创建一块白板，再点重连。").setPositiveButton("知道了", null).show(); return; }
        String[] titles = new String[boards.length()];
        for (int i=0;i<boards.length();i++) titles[i]=boards.optJSONObject(i).optString("title", "未命名白板");
        new AlertDialog.Builder(this).setTitle("选择共享白板").setItems(titles, (d, which) -> {
            JSONObject b=boards.optJSONObject(which); openBoard(b.optString("id"),b.optString("title", "共享白板"));
        }).setNegativeButton("取消", null).show();
    }
    private void openBoard(String id, String title) {
        if (!id.matches("[a-z0-9][a-z0-9-]{0,63}")) { toast("白板编号无效"); return; }
        boardId=id; boardTitle=title; prefs.edit().putString("board", id).apply();
        heading.setText("进化课堂"); status.setText(title);
        if (boardView == null) createWebView();
        content.removeAllViews(); content.addView(boardView, new FrameLayout.LayoutParams(-1,-1));
        boardView.loadUrl(connection.classroomUrl(id));
    }
    private void createWebView() {
        boardView = new WebView(this); boardView.setBackgroundColor(Color.WHITE);
        WebSettings settings=boardView.getSettings(); settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(true); settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false); settings.setJavaScriptCanOpenWindowsAutomatically(false);
        boardView.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return localAsset(request.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri=request.getUrl();
                return connection == null || !connection.origin.equals(uri.getScheme()+"://"+uri.getAuthority());
            }
            @Override public void onPageFinished(WebView view, String url) { status(boardTitle); }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) status("连接中断，点“重连”重试");
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) { handler.cancel(); status("证书校验失败，请检查手机时间和连接地址"); }
        });
        boardView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileSelection!=null) fileSelection.onReceiveValue(null);
                fileSelection=callback;
                try { startActivityForResult(params.createIntent(), FILE_PICK); return true; }
                catch (Exception e) { fileSelection=null; callback.onReceiveValue(null); return false; }
            }
        });
        boardView.setDownloadListener((url, agent, disposition, mime, length) -> toast("请在应用菜单选择“保存板书”或“保存图片”。"));
    }
    private WebResourceResponse localAsset(Uri uri) {
        try {
            ConnectionInfo current=connection;
            if (current == null || !current.origin.equals(uri.getScheme()+"://"+uri.getAuthority())) return null;
            List<String> parts=uri.getPathSegments();
            if (parts.size()<3 || !"c".equals(parts.get(0)) || !parts.get(1).matches("[a-z0-9][a-z0-9-]{0,63}") || !current.token.equals(parts.get(2))) return null;
            String relative=parts.size()==3 ? "index.html" : String.join("/",parts.subList(3,parts.size()));
            if (relative.contains("..") || relative.contains("\\") || relative.indexOf('\0')>=0) return null;
            if (!(relative.equals("index.html") || relative.startsWith("assets/") || relative.startsWith("fonts/"))) return null;
            InputStream data=getAssets().open("whiteboard/"+relative);
            String mime="application/octet-stream", encoding=null;
            if(relative.endsWith(".html")) {
                String html=new String(bytes(data, 1024*1024),StandardCharsets.UTF_8).replace("<head>","<head><meta name=\"whiteboard-canvas\" content=\""+parts.get(1)+"\">");
                data=new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8)); mime="text/html"; encoding="UTF-8";
            } else if(relative.endsWith(".js")) {mime="application/javascript";encoding="UTF-8";}
            else if(relative.endsWith(".css")) {mime="text/css";encoding="UTF-8";}
            else if(relative.endsWith(".woff2")) mime="font/woff2";
            else if(relative.endsWith(".svg")) mime="image/svg+xml";
            else if(relative.endsWith(".png")) mime="image/png";
            Map<String,String> headers=new HashMap<>(); headers.put("Cache-Control","no-store"); headers.put("X-Content-Type-Options","nosniff");
            return new WebResourceResponse(mime,encoding,200,"OK",headers,data);
        } catch (IOException ignored) { return null; }
    }
    private Object api(String method, String path, JSONObject payload) throws Exception {
        ConnectionInfo current=connection;
        if(current==null)throw new IOException("请先设置接入信息。");
        HttpURLConnection request=(HttpURLConnection)new URL(current.origin+path).openConnection(Proxy.NO_PROXY);
        request.setRequestMethod(method); request.setConnectTimeout(8000); request.setReadTimeout(path.endsWith("/request")?22000:12000);
        request.setRequestProperty("Authorization","Bearer "+current.token); request.setRequestProperty("Accept","application/json");
        try {
            if(payload!=null){byte[] body=payload.toString().getBytes(StandardCharsets.UTF_8);request.setDoOutput(true);request.setRequestProperty("Content-Type","application/json; charset=utf-8");request.setFixedLengthStreamingMode(body.length);try(OutputStream out=request.getOutputStream()){out.write(body);}}
            int code=request.getResponseCode();
            if(code<200||code>=300)throw new IOException("HTTP "+code);
            String response=new String(bytes(request.getInputStream(),32*1024*1024),StandardCharsets.UTF_8);
            return response.trim().startsWith("[")?new JSONArray(response):new JSONObject(response);
        } finally {request.disconnect();}
    }
    private static byte[] bytes(InputStream input, int limit) throws IOException {
        try(InputStream in=input;ByteArrayOutputStream out=new ByteArrayOutputStream()){
            byte[] buffer=new byte[8192];int n;while((n=in.read(buffer))!=-1){if(out.size()+n>limit)throw new IOException("响应过大");out.write(buffer,0,n);}return out.toByteArray();
        }
    }
    private void menu() {
        String[] items={"选择白板","复制课堂信息给老师","查看共同学习进度","保存板书到手机","保存图片到手机","打开 Operit","配置 Operit 的连接","更换接入信息","开源说明"};
        new AlertDialog.Builder(this).setTitle("课堂工具").setItems(items,(dialog,which)->{
            if(which==0){if(connection==null){showSetup("");return;}network.execute(()->{try{JSONArray all=(JSONArray)api("GET","/api/canvases",null);runOnUiThread(()->chooseBoards(all));}catch(Exception e){runOnUiThread(()->connectionError(e));}});}
            else if(which==1){if(boardId.isEmpty()){toast("先打开一块白板");return;}copy("请先读取 study_context。当前白板 ID 是 "+boardId+"，请用 canvas_open 的 board 打开这块板，再读取板书。按我的真实作答记录学习进度。","课堂信息已复制");}
            else if(which==2)progress();
            else if(which==3)export(false);
            else if(which==4)export(true);
            else if(which==5){Intent launch=getPackageManager().getLaunchIntentForPackage("com.ai.assistance.operit");if(launch!=null)startActivity(launch);else toast("请从手机桌面打开 Operit，再使用多开或分屏。");}
            else if(which==6)operitHelp();
            else if(which==7)showSetup("");
            else new AlertDialog.Builder(this).setTitle("关于进化课堂 0.2.1").setMessage("原生安卓连接、菜单与文件保存；应用内使用 WebView 承载随 APK 安装的 Whiteboard MCP 0.3.5 / Excalidraw 绘图引擎。支持选中对象后添加文字批注，批注随板书共享与保存。板书和学习记录由电脑提供。\n\nWhiteboard MCP：Ansuman Shukla，MIT。源码与许可随工作区项目保留。\n\nhttps://github.com/ansuman-shukla/whiteboard-mcp").setPositiveButton("知道了",null).show();
        }).show();
    }
    private void copy(String text,String note){((ClipboardManager)getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("进化课堂",text));toast(note);}
    private void operitHelp(){
        if(connection==null){showSetup("");return;}
        new AlertDialog.Builder(this).setTitle("Operit 远程 MCP")
            .setMessage("在 Operit 的 MCP 管理中连接远程服务，传输选 httpStream。连接后应有 15 个工具。\n\n服务地址：\n"+connection.origin+"/mcp\n\n下面可以分别复制地址与 Bearer Token。")
            .setPositiveButton("复制地址",(d,w)->copy(connection.origin+"/mcp","服务地址已复制"))
            .setNeutralButton("复制 Token",(d,w)->copy(connection.token,"Token 已复制，请只粘贴到自己的 Operit 配置"))
            .setNegativeButton("返回",null).show();
    }
    private void progress(){
        if(connection==null){showSetup("");return;}
        String[] labels={"高数","英语","政治","信息技术"},keys={"math","english","politics","it"};
        new AlertDialog.Builder(this).setTitle("查看哪一科？").setItems(labels,(d,index)->network.execute(()->{
            try{
                JSONObject args=new JSONObject().put("subject",keys[index]);
                JSONObject result=(JSONObject)api("POST","/agent/call",new JSONObject().put("name","study_context").put("arguments",args));
                if(result.optBoolean("isError"))throw new IOException("无法读取学习记录");
                JSONObject subject=result.getJSONObject("structuredContent").getJSONObject("subjects").getJSONObject(keys[index]);
                String display=subject.getJSONObject("current").getString("content")+"\n\n最近学习记录\n"+subject.getJSONObject("records").getString("content");
                runOnUiThread(()->{TextView t=text(display,15);t.setTextIsSelectable(true);t.setPadding(dp(20),dp(12),dp(20),dp(16));ScrollView s=new ScrollView(this);s.addView(t);new AlertDialog.Builder(this).setTitle(labels[index]+" · 与电脑共用").setView(s).setPositiveButton("返回课堂",null).show();});
            }catch(Exception e){runOnUiThread(()->toast("读取未完成，请检查连接后重试。"));}
        })).show();
    }
    private void export(boolean png){
        if(boardId.isEmpty()||connection==null){toast("先打开一块白板");return;}
        status("正在准备保存…");
        final String selected=boardId;
        network.execute(()->{
            try{
                byte[] output;
                if(png){JSONObject request=new JSONObject().put("type","screenshot").put("payload",new JSONObject()).put("timeoutMs",15000);JSONObject result=(JSONObject)api("POST","/api/canvases/"+selected+"/request",request);output=android.util.Base64.decode(result.getJSONObject("result").getString("base64"),android.util.Base64.DEFAULT);}
                else{JSONObject scene=(JSONObject)api("GET","/api/canvases/"+selected,null);JSONObject doc=new JSONObject().put("type","excalidraw").put("version",2).put("source","进化课堂").put("elements",scene.getJSONArray("elements")).put("appState",new JSONObject().put("viewBackgroundColor","#ffffff")).put("files",scene.optJSONObject("files")==null?new JSONObject():scene.getJSONObject("files"));output=doc.toString().getBytes(StandardCharsets.UTF_8);}
                runOnUiThread(()->{exportData=output;status(boardTitle);Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(png?"image/png":"application/json").putExtra(Intent.EXTRA_TITLE,"课堂-"+selected+(png?".png":".excalidraw"));startActivityForResult(intent,SAVE_FILE);});
            }catch(Exception e){runOnUiThread(()->{status(boardTitle);toast("准备保存失败，请保持白板可见并检查连接。");});}
        });
    }
    private void openTailscale(){Intent launch=getPackageManager().getLaunchIntentForPackage("com.tailscale.ipn");if(launch!=null)startActivity(launch);else startActivity(new Intent(Settings.ACTION_VPN_SETTINGS));}
    @Override protected void onActivityResult(int request,int result,Intent data){
        super.onActivityResult(request,result,data);
        if(request==FILE_PICK&&fileSelection!=null){fileSelection.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result,data));fileSelection=null;}
        if(request==SAVE_FILE){byte[] toSave=exportData;exportData=null;if(result==RESULT_OK&&data!=null&&toSave!=null){Uri target=data.getData();network.execute(()->{try(OutputStream out=getContentResolver().openOutputStream(target)){if(out==null)throw new IOException();out.write(toSave);runOnUiThread(()->toast("已保存到手机"));}catch(Exception e){runOnUiThread(()->toast("保存失败，请重新选择位置。"));}});}}
    }
    @Override protected void onStart(){super.onStart();if(boardView!=null)boardView.onResume();}
    @Override protected void onStop(){if(boardView!=null)boardView.onPause();super.onStop();}
    @Override protected void onDestroy(){generation++;if(fileSelection!=null)fileSelection.onReceiveValue(null);if(boardView!=null){content.removeView(boardView);boardView.destroy();}network.shutdownNow();super.onDestroy();}
    @Override public void onBackPressed(){if(boardView!=null&&boardView.getParent()!=null){new AlertDialog.Builder(this).setMessage("退出课堂窗口？已同步的板书会继续保留在电脑。").setPositiveButton("退出",(d,w)->finish()).setNegativeButton("留在课堂",null).show();}else super.onBackPressed();}
}
