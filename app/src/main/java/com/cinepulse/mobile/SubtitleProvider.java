package com.cinepulse.mobile;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Official SubDL API v1 client; no scraping, no provider keys logged or bundled. */
final class SubtitleProvider {
    private SubtitleProvider(){}
    static final String DOCS="https://subdl.com/api-doc";
    static final int MAX_SRT=SecurityRules.MAX_SRT_BYTES;
    private static final int MAX_WIRE=4*1024*1024;
    static final class Hit {
        final String title,release,language,downloadPath;
        final boolean hearingImpaired;
        Hit(String title,String release,String language,String path,boolean hi){
            this.title=title;this.release=release;this.language=language;this.downloadPath=path;this.hearingImpaired=hi;
        }
        String label(){return title+"  •  "+language+"  •  "+release+(hearingImpaired?" (SDH)":"");}
    }
    static final class Srt {
        final String text,sha256;
        final int cues;
        final double duration;
        Srt(String t,int n,double duration) throws Exception {
            this.text=t;this.cues=n;this.duration=duration;
            byte[] digest=MessageDigest.getInstance("SHA-256").digest(t.getBytes(StandardCharsets.UTF_8));
            StringBuilder b=new StringBuilder();
            for(byte a:digest)b.append(String.format(Locale.ROOT,"%02x",a&255));
            this.sha256=b.toString();
        }
    }
    private static String encode(String s) throws Exception{
        return URLEncoder.encode(s,StandardCharsets.UTF_8.name());
    }
    private static byte[] fetch(URL address,int max,String apiKey,boolean isApi) throws Exception{
        String host=address.getHost().toLowerCase(Locale.ROOT);
        if(!"https".equalsIgnoreCase(address.getProtocol())||address.getPort()!=-1||
            !(isApi?"api.subdl.com".equals(host):"dl.subdl.com".equals(host)))
            throw new SecurityException("Untrusted subtitle provider URL");
        HttpURLConnection c=(HttpURLConnection)address.openConnection();
        c.setInstanceFollowRedirects(false);
        c.setConnectTimeout(12000);c.setReadTimeout(30000);
        c.setRequestProperty("Accept",isApi?"application/json":"application/octet-stream");
        c.setRequestProperty("User-Agent","CinePulseAndroid/0.1.6");
        // SubDL free search requires api_key as documented. Never log or copy URL containing it.
        try {
            int code=c.getResponseCode();
            if(code==429)throw new IOException("SubDL rate limit reached. Try later; no automatic retry was performed.");
            if(code==401||code==403)throw new IOException("SubDL API key is invalid or its download quota is exhausted.");
            if(code!=200)throw new IOException("SubDL request failed (HTTP "+code+").");
            try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){
                byte[] buf=new byte[8192];int n,total=0;
                while((n=in.read(buf))!=-1){
                    total+=n;if(total>max)throw new IOException("Subtitle provider response exceeded safe size.");
                    out.write(buf,0,n);
                }
                return out.toByteArray();
            }
        }finally{c.disconnect();}
    }
    static JSONArray search(String apiKey,String title,String language) throws Exception{
        if(apiKey==null||apiKey.trim().length()<8)throw new IOException("Set your own SubDL API key in the SRT Library first.");
        if(title==null||title.trim().length()<2||title.length()>130)throw new IOException("Movie search must contain 2–130 characters.");
        if(!("EN".equals(language)||"UR".equals(language)))throw new IOException("Unsupported language code.");
        String path="https://api.subdl.com/api/v1/subtitles?api_key="+encode(apiKey.trim())+
           "&film_name="+encode(title.trim())+"&type=movie&languages="+language+"&unpack=1&subs_per_page=30&client=custom_integration";
        JSONObject response=new JSONObject(new String(fetch(new URL(path),1024*1024,apiKey,true),StandardCharsets.UTF_8));
        if(!response.optBoolean("status"))throw new IOException("Subtitle search: "+safeError(response.optString("error","No result"),80));
        JSONArray movies=response.optJSONArray("results"),subs=response.optJSONArray("subtitles");
        String foundTitle=title.trim();
        if(movies!=null&&movies.length()>0){
            JSONObject first=movies.optJSONObject(0);
            if(first!=null)foundTitle=first.optString("name",foundTitle)+
                (first.optInt("year",0)>1900?" ("+first.optInt("year")+")":"");
        }
        JSONArray hits=new JSONArray();
        if(subs==null)return hits;
        for(int i=0;i<Math.min(subs.length(),30);i++){
            JSONObject entry=subs.optJSONObject(i);if(entry==null)continue;
            String release=entry.optString("release_name",entry.optString("name","Unknown release"));
            JSONArray inner=entry.optJSONArray("unpack_files");
            boolean added=false;
            if(inner!=null)for(int j=0;j<Math.min(inner.length(),40);j++){
                JSONObject a=inner.optJSONObject(j);if(a==null)continue;
                String file=a.optString("name","");
                if(!file.toLowerCase(Locale.ROOT).endsWith(".srt"))continue;
                String subLang=a.optString("language",language).toUpperCase(Locale.ROOT);
                if(!subLang.equals(language))continue;
                String remote=a.optString("url","");
                if(!validPath(remote))continue;
                hits.put(new JSONObject().put("title",foundTitle).put("release",release)
                    .put("language",language).put("path",remote).put("hi",a.optBoolean("hi")));
                added=true;
            }
            if(added)continue;
            String remote=entry.optString("url","");
            if(!validPath(remote))continue;
            hits.put(new JSONObject().put("title",foundTitle).put("release",release)
                .put("language",language).put("path",remote).put("hi",entry.optBoolean("hi")));
        }
        return hits;
    }
    private static String safeError(String s,int max){
        String clean=s.replaceAll("[\\r\\n\\t]"," ");
        return clean.length()>max?clean.substring(0,max):clean;
    }
    static boolean validPath(String p){
        if(p==null||p.length()>200||!p.startsWith("/subtitle/")||p.contains("..")||p.contains("?")
            ||p.contains("#")||p.contains("\\")||p.contains("//"))return false;
        return p.matches("/subtitle/[A-Za-z0-9._/-]+");
    }
    private static Srt parseSrt(byte[] bytes) throws Exception{
        if(bytes.length<80||bytes.length>MAX_SRT)throw new IOException("SRT must be 80 bytes to 2 MiB.");
        String text=new String(bytes,StandardCharsets.UTF_8).replace("\uFEFF","").trim();
        Matcher m=Pattern.compile("(\\d{2}):(\\d{2}):(\\d{2})[,\\.](\\d{3})\\s*-->\\s*(\\d{2}):(\\d{2}):(\\d{2})[,\\.](\\d{3})").matcher(text);
        int count=0;double max=0;double last=-1;
        while(m.find()){
            double start=(((Integer.parseInt(m.group(1))*60+Integer.parseInt(m.group(2)))*60)+Integer.parseInt(m.group(3)))+Integer.parseInt(m.group(4))/1000d;
            double end=(((Integer.parseInt(m.group(5))*60+Integer.parseInt(m.group(6)))*60)+Integer.parseInt(m.group(7)))+Integer.parseInt(m.group(8))/1000d;
            if(end<=start||start+30<last)throw new IOException("Invalid or out-of-order subtitle timing.");
            count++;last=start;max=Math.max(max,end);
        }
        if(count<8||max<60)throw new IOException("Subtitle contains too few valid timed cues.");
        return new Srt(text+"\n",count,max);
    }
    static Srt parseBytes(byte[] bytes) throws Exception{return parseSrt(bytes);}
    static Srt download(String path) throws Exception{
        if(!validPath(path))throw new SecurityException("Untrusted subtitle download path.");
        byte[] data=fetch(new URL("https://dl.subdl.com"+path),MAX_WIRE,null,false);
        if(data.length>=4&&data[0]=='P'&&data[1]=='K'){
            try(ZipInputStream z=new ZipInputStream(new ByteArrayInputStream(data))){
                int entries=0;ZipEntry entry;
                while((entry=z.getNextEntry())!=null){
                    if(++entries>50)throw new IOException("Too many files in subtitle ZIP.");
                    if(entry.isDirectory()||!entry.getName().toLowerCase(Locale.ROOT).endsWith(".srt"))continue;
                    try(ByteArrayOutputStream out=new ByteArrayOutputStream()){
                        byte[] buf=new byte[8192];int n,total=0;
                        while((n=z.read(buf))!=-1){
                            total+=n;if(total>MAX_SRT)throw new IOException("Subtitle ZIP entry expands beyond 2 MiB.");
                            out.write(buf,0,n);
                        }
                        return parseSrt(out.toByteArray());
                    }
                }
            }
            throw new IOException("No valid .srt entry found in subtitle ZIP.");
        }
        return parseSrt(data);
    }
}
