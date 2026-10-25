package com.cinepulse.mobile;

import android.app.Activity;
import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.webkit.URLUtil;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.Button;
import android.widget.EditText;
import android.widget.Toast;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** User-controlled subtitle browsing; never sends provider credentials to a web page. */
public final class SubtitleBrowserActivity extends Activity {
    private WebView browser;
    private Runnable pendingDownload;
    private static final int STORAGE_PERMISSION=731;
    private static final Pattern ZIP=Pattern.compile("https://dl\\.subdl\\.com/subtitle/[A-Za-z0-9_-]+\\.zip",Pattern.CASE_INSENSITIVE);
    private static String zipFrom(String raw){
        if(raw==null)return null;
        Matcher m=ZIP.matcher(raw);
        return m.find()?m.group():null;
    }
    private static final String HOME="https://subdl.com/subtitle/sd2922/inception/english";
    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        LinearLayout panel=new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setBackgroundColor(0xFF0B1021);
        EditText address=new EditText(this);
        address.setSingleLine(true);
        address.setTextColor(0xFFFFFFFF);
        address.setHintTextColor(0xFFB0BBD0);
        address.setHint("HTTPS subtitle page");
        panel.addView(address,new LinearLayout.LayoutParams(-1,-2));
        LinearLayout controls=new LinearLayout(this);
        Button go=new Button(this);go.setText("Go");
        Button back=new Button(this);back.setText("Back");
        Button importFile=new Button(this);importFile.setText("Import SRT / ZIP");
        controls.addView(go,new LinearLayout.LayoutParams(0,-2,1));
        controls.addView(back,new LinearLayout.LayoutParams(0,-2,1));
        controls.addView(importFile,new LinearLayout.LayoutParams(0,-2,2));
        panel.addView(controls);
        browser=new WebView(this);
        browser.getSettings().setJavaScriptEnabled(true);
        browser.getSettings().setDomStorageEnabled(true);
        browser.getSettings().setAllowFileAccess(false);
        browser.getSettings().setAllowContentAccess(false);
        browser.getSettings().setJavaScriptCanOpenWindowsAutomatically(false);
        browser.getSettings().setSupportMultipleWindows(false);
        browser.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        browser.getSettings().setSafeBrowsingEnabled(true);
        browser.setWebChromeClient(new WebChromeClient());
        browser.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
                String zip=zipFrom(request.getUrl().toString());
                if(zip!=null){downloadZip(zip);return true;}
                Uri uri=request.getUrl();
                if(!"https".equalsIgnoreCase(uri.getScheme()))return true;
                String host=uri.getHost()==null?"":uri.getHost().toLowerCase(Locale.ROOT);
                if(!allowed(host)){
                    new AlertDialog.Builder(SubtitleBrowserActivity.this)
                        .setTitle("External website blocked")
                        .setMessage("CinePulse only opens supported subtitle sites here.\n"+host)
                        .setPositiveButton("OK",null).show();
                    return true;
                }
                return false;
            }
            @Override public void onPageFinished(WebView view,String url){address.setText(url);}
        });
        browser.setOnLongClickListener(v->{
            WebView.HitTestResult hit=browser.getHitTestResult();
            String zip=zipFrom(hit==null?null:hit.getExtra());
            if(zip==null)return false;
            downloadZip(zip);return true;
        });
        browser.setDownloadListener((url,userAgent,disposition,mime,length)->{
            String zip=zipFrom(url);
            if(zip!=null){downloadZip(zip);return;}
            Uri uri=Uri.parse(url);
            String host=uri.getHost()==null?"":uri.getHost().toLowerCase(Locale.ROOT);
            if(!"https".equalsIgnoreCase(uri.getScheme())||host.isEmpty()){
                Toast.makeText(this,"Untrusted download blocked",Toast.LENGTH_LONG).show();return;
            }
            String proposed=URLUtil.guessFileName(url,disposition,mime);
            String ext=proposed.toLowerCase(Locale.ROOT);
            if(ext.endsWith(".apk")||ext.endsWith(".exe")||ext.endsWith(".html")||ext.endsWith(".htm")||ext.endsWith(".js")){
                Toast.makeText(this,"Only subtitle downloads are supported",Toast.LENGTH_LONG).show();return;
            }
            new AlertDialog.Builder(this).setTitle("Download subtitle?")
                .setMessage("Save "+proposed+" from "+host+" to Downloads? Some websites may serve ads instead of subtitles.")
                .setNegativeButton("Cancel",null)
                .setPositiveButton("Download",(dialog,which)->{
                    Runnable action=()->{try{
                        DownloadManager.Request req=new DownloadManager.Request(uri);
                        req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                        String extension=ext.endsWith(".srt")?".srt":ext.endsWith(".zip")?".zip":".download";
                        req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS,"cinepulse-subtitle-"+System.currentTimeMillis()+extension);
                        String cookies=CookieManager.getInstance().getCookie(url);
                        if(cookies!=null)req.addRequestHeader("Cookie",cookies);
                        if(userAgent!=null)req.addRequestHeader("User-Agent",userAgent);
                        if(browser.getUrl()!=null&&browser.getUrl().startsWith("https://"))req.addRequestHeader("Referer",browser.getUrl());
                        ((DownloadManager)getSystemService(Context.DOWNLOAD_SERVICE)).enqueue(req);
                        Toast.makeText(this,"Download started. Import after completion.",Toast.LENGTH_LONG).show();
                    }catch(Exception e){Toast.makeText(this,"Download failed: "+e.getClass().getSimpleName(),Toast.LENGTH_LONG).show();}
                    };
                    if(Build.VERSION.SDK_INT<=28&&checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)!=PackageManager.PERMISSION_GRANTED){
                        pendingDownload=action;
                        requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE},STORAGE_PERMISSION);
                    }else action.run();
                }).show();
        });
        panel.addView(browser,new LinearLayout.LayoutParams(-1,0,1));
        setContentView(panel);
        go.setOnClickListener(v->{
            String target=address.getText().toString().trim();
            String zip=zipFrom(target);
            if(zip!=null){downloadZip(zip);return;}
            Uri uri=Uri.parse(target);
            if("https".equalsIgnoreCase(uri.getScheme())&&allowed(uri.getHost()==null?"":uri.getHost().toLowerCase(Locale.ROOT)))
                browser.loadUrl(target);
            else Toast.makeText(this,"Enter an HTTPS URL for a supported subtitle site",Toast.LENGTH_SHORT).show();
        });
        back.setOnClickListener(v->{if(browser.canGoBack())browser.goBack();else finish();});
        importFile.setOnClickListener(v->{
            Intent result=new Intent();
            result.putExtra("open_import",true);
            setResult(RESULT_OK,result);
            finish();
        });
        String initial=getIntent().getStringExtra("url");
        Uri initialUri=Uri.parse(initial==null?HOME:initial);
        browser.loadUrl("https".equalsIgnoreCase(initialUri.getScheme())&&allowed(initialUri.getHost()==null?"":initialUri.getHost().toLowerCase(Locale.ROOT))?initialUri.toString():HOME);
    }
    private void downloadZip(String url){
        new AlertDialog.Builder(this).setTitle("Save SubDL subtitle ZIP?")
            .setMessage(url).setNegativeButton("Cancel",null)
            .setPositiveButton("Download",(d,w)->{
                Runnable action=()->{
                    try{
                        DownloadManager.Request req=new DownloadManager.Request(Uri.parse(url));
                        req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                        req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS,"cinepulse-subtitle-"+System.currentTimeMillis()+".zip");
                        String cookies=CookieManager.getInstance().getCookie(url);
                        if(cookies!=null)req.addRequestHeader("Cookie",cookies);
                        String ref=browser.getUrl();
                        if(ref!=null&&ref.startsWith("https://"))req.addRequestHeader("Referer",ref);
                        ((DownloadManager)getSystemService(Context.DOWNLOAD_SERVICE)).enqueue(req);
                        Toast.makeText(this,"Download queued in Downloads",Toast.LENGTH_LONG).show();
                    }catch(Exception e){Toast.makeText(this,"Download failed: "+e.getClass().getSimpleName(),Toast.LENGTH_LONG).show();}
                };
                if(Build.VERSION.SDK_INT<=28&&checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)!=PackageManager.PERMISSION_GRANTED){
                    pendingDownload=action;
                    requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE},STORAGE_PERMISSION);
                }else action.run();
            }).show();
    }
    private static boolean allowed(String host){
        return "subdl.com".equals(host)||"www.subdl.com".equals(host)||"dl.subdl.com".equals(host)||"opensubtitles.com".equals(host)||"www.opensubtitles.com".equals(host)||"subsource.net".equals(host)||"www.subsource.net".equals(host);
    }
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] grants){
        super.onRequestPermissionsResult(request,permissions,grants);
        if(request==STORAGE_PERMISSION){
            Runnable action=pendingDownload;pendingDownload=null;
            if(grants.length>0&&grants[0]==PackageManager.PERMISSION_GRANTED&&action!=null)action.run();
            else Toast.makeText(this,"Storage permission is needed to save into Downloads",Toast.LENGTH_LONG).show();
        }
    }
    @Override public void onBackPressed(){if(browser!=null&&browser.canGoBack())browser.goBack();else super.onBackPressed();}
    @Override protected void onDestroy(){
        if(browser!=null){browser.stopLoading();browser.destroy();browser=null;}
        super.onDestroy();
    }
}
