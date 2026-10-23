package com.cinepulse.mobile;

import android.app.Activity;
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

/** User-controlled subtitle browsing; never sends provider credentials to a web page. */
public final class SubtitleBrowserActivity extends Activity {
    private WebView browser;
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
                Uri uri=request.getUrl();
                if(!"https".equalsIgnoreCase(uri.getScheme()))return true;
                String host=uri.getHost()==null?"":uri.getHost().toLowerCase(Locale.ROOT);
                if(!allowed(host)){
                    new AlertDialog.Builder(SubtitleBrowserActivity.this)
                        .setTitle("External website blocked")
                        .setMessage("CinePulse only opens SubDL pages and its download host here.\n"+host)
                        .setPositiveButton("OK",null).show();
                    return true;
                }
                return false;
            }
            @Override public void onPageFinished(WebView view,String url){address.setText(url);}
        });
        browser.setDownloadListener((url,userAgent,disposition,mime,length)->{
            Uri uri=Uri.parse(url);
            String host=uri.getHost()==null?"":uri.getHost().toLowerCase(Locale.ROOT);
            if(!"https".equalsIgnoreCase(uri.getScheme())||!allowed(host)){
                Toast.makeText(this,"Untrusted download blocked",Toast.LENGTH_LONG).show();return;
            }
            new AlertDialog.Builder(this).setTitle("Download subtitle?")
                .setMessage("Save this file to Android Downloads, then tap Import SRT / ZIP. Only download subtitles you trust.")
                .setNegativeButton("Cancel",null)
                .setPositiveButton("Download",(dialog,which)->{
                    try{
                        DownloadManager.Request req=new DownloadManager.Request(uri);
                        req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                        req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS,"cinepulse-subtitle-"+System.currentTimeMillis()+".zip");
                        String cookies=CookieManager.getInstance().getCookie(url);
                        if(cookies!=null)req.addRequestHeader("Cookie",cookies);
                        if(userAgent!=null)req.addRequestHeader("User-Agent",userAgent);
                        req.addRequestHeader("Referer",browser.getUrl());
                        ((DownloadManager)getSystemService(Context.DOWNLOAD_SERVICE)).enqueue(req);
                        Toast.makeText(this,"Download started. Import after completion.",Toast.LENGTH_LONG).show();
                    }catch(Exception e){Toast.makeText(this,"Download failed: "+e.getClass().getSimpleName(),Toast.LENGTH_LONG).show();}
                }).show();
        });
        panel.addView(browser,new LinearLayout.LayoutParams(-1,0,1));
        setContentView(panel);
        go.setOnClickListener(v->{
            String target=address.getText().toString().trim();
            Uri uri=Uri.parse(target);
            if("https".equalsIgnoreCase(uri.getScheme())&&allowed(uri.getHost()==null?"":uri.getHost().toLowerCase(Locale.ROOT)))
                browser.loadUrl(target);
            else Toast.makeText(this,"Enter an HTTPS SubDL URL",Toast.LENGTH_SHORT).show();
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
    private static boolean allowed(String host){
        return "subdl.com".equals(host)||"www.subdl.com".equals(host)||"dl.subdl.com".equals(host);
    }
    @Override public void onBackPressed(){if(browser!=null&&browser.canGoBack())browser.goBack();else super.onBackPressed();}
    @Override protected void onDestroy(){
        if(browser!=null){browser.stopLoading();browser.destroy();browser=null;}
        super.onDestroy();
    }
}
