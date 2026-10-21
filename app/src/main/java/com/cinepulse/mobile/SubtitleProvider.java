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
        c.setRequestProperty("User-Agent","CinePulseAndroid/0.1.9");
        if(isApi && apiKey!=null && !apiKey.trim().isEmpty())c.setRequestProperty("Authorization","Bearer "+apiKey.trim());
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
    static final class SearchResult {
        final JSONArray hits;
        final int movieMatches, subtitleRecords, invalidUrls, wrongLanguage, unsupportedFormat;
        final String diagnostic;
        SearchResult(JSONArray hits,int movieMatches,int subtitleRecords,
                     int invalidUrls,int wrongLanguage,int unsupportedFormat){
            this.hits=hits;this.movieMatches=movieMatches;this.subtitleRecords=subtitleRecords;
            this.invalidUrls=invalidUrls;this.wrongLanguage=wrongLanguage;
            this.unsupportedFormat=unsupportedFormat;
            if(hits.length()>0){
                diagnostic=hits.length()+" downloadable SRT release(s) found across "+movieMatches+
                    " title match(es), "+subtitleRecords+" provider subtitle record(s).";
            }else if(movieMatches==0){
                diagnostic="SubDL returned no matching movie titles. Try the exact English title or remove the year.";
            }else if(subtitleRecords==0){
                diagnostic="SubDL found "+movieMatches+" movie title(s), but no subtitles for the chosen language. Try English/Urdu or another release.";
            }else{
                diagnostic="SubDL found "+subtitleRecords+" subtitle record(s), but none could be offered: "+
                    invalidUrls+" unavailable/unsupported links, "+wrongLanguage+
                    " different-language unpacked file(s), "+unsupportedFormat+
                    " non-SRT unpacked file(s). This can be an API format issue, not no subtitles.";
            }
        }
    }
    /** Normalize only documented relative or first-party absolute SubDL subtitle links. */
    static String normalizeDownloadPath(String raw){
        if(raw==null)return "";
        String p=raw.trim();
        if(p.startsWith("https://dl.subdl.com/")){
            try{
                java.net.URI uri=new java.net.URI(p);
                if(uri.getUserInfo()!=null||uri.getPort()!=-1||uri.getQuery()!=null||
                    uri.getFragment()!=null||!"dl.subdl.com".equalsIgnoreCase(uri.getHost()))return "";
                p=uri.getRawPath();
            }catch(Exception ignored){return "";}
        }
        if(p.startsWith("subtitle/"))p="/"+p;
        return validPath(p)?p:"";
    }
    private static boolean safeId(String candidate){
        return candidate!=null && candidate.length()>=2 && candidate.length()<=96 &&
            candidate.matches("[A-Za-z0-9_-]+");
    }
    /** Prefer the official v2 ID download route when a v1 path is unavailable.
     * No URL or host is ever accepted from the response for this route.
     */
    private static String fallbackId(JSONObject record){
        String n=record.optString("n_id","");
        if(n.isEmpty())n=record.optString("nId","");
        if(n.isEmpty())n=record.optString("subtitle_id","");
        return safeId(n)?"v2:"+n:"";
    }
    private static String canonicalDownload(JSONObject record,JSONObject parent){
        String path=normalizeDownloadPath(record.optString("url",""));
        if(!path.isEmpty())return path;
        // V1 unpack_files can identify exact raw file without a usable URL.
        if(parent!=null){
            String n=parent.optString("n_id",parent.optString("nId",""));
            String file=record.optString("file_n_id","");
            if(safeId(n)&&safeId(file))return "/subtitle/"+n+"/"+file;
            String backup=fallbackId(parent);
            if(!backup.isEmpty())return backup;
        }
        return fallbackId(record);
    }
    static boolean sameLanguage(String actual,String wanted){
        if(actual==null||actual.trim().isEmpty())return true; // Parent API search already filters language.
        String candidate=actual.trim().toUpperCase(Locale.ROOT);
        if("EN".equals(wanted))return "EN".equals(candidate)||"ENG".equals(candidate)||"ENGLISH".equals(candidate);
        if("UR".equals(wanted))return "UR".equals(candidate)||"URD".equals(candidate)||"URDU".equals(candidate);
        return false;
    }
    /** Deterministic response parser tested against packed, unpacked and absolute-URL fixtures. */
    static SearchResult parseSearchResponse(JSONObject response,String title,String language) throws IOException {
        if(!response.optBoolean("status"))
            throw new IOException("SubDL search failed: "+safeError(response.optString("error",response.optString("message","Provider declined search")),90));
        JSONArray movies=response.optJSONArray("results");
        JSONArray subs=response.optJSONArray("subtitles");
        int movieCount=movies==null?0:movies.length();
        int subtitleCount=subs==null?0:subs.length();
        String foundTitle=title.trim();
        if(movieCount>0){
            JSONObject first=movies.optJSONObject(0);
            if(first!=null){
                String name=first.optString("name",foundTitle);
                if(!name.trim().isEmpty())foundTitle=name.trim();
                if(first.optInt("year",0)>1900)foundTitle+=" ("+first.optInt("year")+")";
            }
        }
        JSONArray hits=new JSONArray();
        java.util.HashSet<String> included=new java.util.HashSet<>();
        int badLinks=0,badLanguages=0,badFormats=0;
        if(subs!=null)for(int i=0;i<Math.min(subs.length(),120);i++){
            JSONObject entry=subs.optJSONObject(i);
            if(entry==null)continue;
            String release=entry.optString("release_name",entry.optString("name","Unknown release"));
            if(release==null||release.trim().isEmpty())release="Unknown release";
            JSONArray unpack=entry.optJSONArray("unpack_files");
            boolean foundIndividual=false;
            if(unpack!=null)for(int j=0;j<Math.min(unpack.length(),80);j++){
                JSONObject file=unpack.optJSONObject(j);
                if(file==null)continue;
                String name=file.optString("name","");
                String format=file.optString("format","");
                boolean isSrt="srt".equalsIgnoreCase(format)||name.toLowerCase(Locale.ROOT).endsWith(".srt");
                if(!isSrt){badFormats++;continue;}
                String subLanguage=file.optString("language",entry.optString("language",""));
                if(!sameLanguage(subLanguage,language)){badLanguages++;continue;}
                String path=canonicalDownload(file,entry);
                if(path.isEmpty()){badLinks++;continue;}
                JSONObject hit=new JSONObject();
                try{
                    hit.put("title",foundTitle).put("release",file.optString("release_name",release))
                        .put("language",language).put("path",path)
                        .put("hi",file.optBoolean("hi",entry.optBoolean("hi",false)));
                }catch(org.json.JSONException ignored){continue;}
                if(included.add(path)){hits.put(hit);foundIndividual=true;}
            }
            // Most movie subtitles are ZIP records even with unpack=1; always keep a valid
            // parent pack fallback, even if an unpacked SRT is present. This avoids false zeros.
            String topLanguage=entry.optString("language",entry.optString("lang",""));
            if(!sameLanguage(topLanguage,language)){badLanguages++;continue;}
            String path=canonicalDownload(entry,null);
            if(!path.isEmpty()){
                if(included.add(path)){
                    try{
                        hits.put(new JSONObject().put("title",foundTitle).put("release",release)
                            .put("language",language).put("path",path).put("hi",entry.optBoolean("hi",false)));
                    }catch(org.json.JSONException ignored){}
                }
            }else if(!foundIndividual)badLinks++;
        }
        return new SearchResult(hits,movieCount,subtitleCount,badLinks,badLanguages,badFormats);
    }
    static SearchResult searchDetailed(String apiKey,String title,String language) throws Exception{
        if(apiKey==null||apiKey.trim().length()<8)
            throw new IOException("Set a new personal SubDL API key in the SRT Library.");
        if(title==null||title.trim().length()<2||title.length()>130)
            throw new IOException("Movie search must contain 2–130 characters.");
        if(!("EN".equals(language)||"UR".equals(language)))throw new IOException("Unsupported language code.");
        String clean=title.trim().replaceFirst("\\s*\\(\\d{4}\\)$","");
        String path="https://api.subdl.com/api/v1/subtitles?api_key="+encode(apiKey.trim())+
            "&film_name="+encode(clean)+"&type=movie&languages="+language+
            "&unpack=1&subs_per_page=30&client=custom_integration";
        JSONObject response=new JSONObject(new String(fetch(new URL(path),1024*1024,apiKey,true),StandardCharsets.UTF_8));
        return parseSearchResponse(response,clean,language);
    }
    static JSONArray search(String apiKey,String title,String language) throws Exception {
        return searchDetailed(apiKey,title,language).hits;
    }
    private static String safeError(String s,int max){
        String clean=s.replaceAll("[\\r\\n\\t]"," ");
        return clean.length()>max?clean.substring(0,max):clean;
    }
    static boolean validPath(String p){
        if(p==null||p.length()>1000||!p.startsWith("/subtitle/")||p.contains("..")||p.contains("?")
            ||p.contains("#")||p.contains("\\")||p.contains("//")||p.contains(" ")||
            p.indexOf('\r')>=0||p.indexOf('\n')>=0)return false;
        if(!p.matches("/subtitle/[A-Za-z0-9._~/%+-]+"))return false;
        // Permit URL-encoded filenames but reject malformed percent escapes and encoded traversal.
        if(p.contains("%")){
            if(!p.matches("(?:[^%]|%[0-9A-Fa-f]{2})+"))return false;
            String q=p.toLowerCase(Locale.ROOT);
            if(q.contains("%2f")||q.contains("%5c")||q.contains("%2e")||q.contains("%00")||q.contains("%3f")
                ||q.contains("%23"))return false;
        }
        return true;
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
        return download(path,null);
    }
    static Srt download(String path,String apiKey) throws Exception{
        byte[] data;
        if(path!=null && path.startsWith("v2:")){
            String id=path.substring(3);
            if(!safeId(id))throw new SecurityException("SubDL subtitle ID is invalid.");
            if(apiKey==null||apiKey.trim().length()<8)
                throw new IOException("SubDL ID downloads need your saved API key.");
            // Official v2 endpoint requests the complete archive; it may have multiple files.
            String endpoint="https://api.subdl.com/api/v2/subtitles/"+id+"/download?format=zip";
            data=fetchV2(new URL(endpoint),apiKey);
        }else{
            if(!validPath(path))throw new SecurityException("Untrusted subtitle download path.");
            data=fetch(new URL("https://dl.subdl.com"+path),MAX_WIRE,null,false);
        }
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
            throw new IOException("SubDL archive has no SRT (it may only contain ASS/SUB). Choose another subtitle release.");
        }
        return parseSrt(data);
    }
    private static byte[] fetchV2(URL endpoint,String key) throws Exception{
        URL current=endpoint;
        for(int turn=0;turn<3;turn++){
            String host=current.getHost().toLowerCase(Locale.ROOT);
            if(!"https".equalsIgnoreCase(current.getProtocol())||current.getPort()!=-1||
                !("api.subdl.com".equals(host)||"dl.subdl.com".equals(host)))
                throw new SecurityException("SubDL redirected to an untrusted download host.");
            HttpURLConnection conn=(HttpURLConnection)current.openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(12000);conn.setReadTimeout(30000);
            conn.setRequestProperty("Accept","application/zip,application/octet-stream,*/*");
            conn.setRequestProperty("User-Agent","CinePulseAndroid/0.1.9");
            if("api.subdl.com".equals(host))conn.setRequestProperty("Authorization","Bearer "+key);
            try{
                int status=conn.getResponseCode();
                if(status>=300&&status<400){
                    String location=conn.getHeaderField("Location");
                    if(location==null)throw new IOException("SubDL returned redirect without a target.");
                    current=new URL(current,location);
                    continue;
                }
                if(status==401||status==403)throw new IOException("SubDL denied subtitle ID download; check account quota.");
                if(status==429)throw new IOException("SubDL rate limit reached.");
                if(status!=200)throw new IOException("SubDL ID download returned HTTP "+status);
                try(InputStream in=conn.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){
                    byte[] buf=new byte[8192];int n,total=0;
                    while((n=in.read(buf))!=-1){
                        if((total+=n)>MAX_WIRE)throw new IOException("Subtitle response too large.");
                        out.write(buf,0,n);
                    }
                    return out.toByteArray();
                }
            }finally{conn.disconnect();}
        }
        throw new IOException("Too many SubDL download redirects.");
    }
}
