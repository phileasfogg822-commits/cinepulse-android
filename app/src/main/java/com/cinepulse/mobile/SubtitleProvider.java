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
        c.setRequestProperty("User-Agent","CinePulseAndroid/0.2.1");
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
        SearchResult(JSONArray hits,int movieMatches,int subtitleRecords,int invalidUrls,
                     int wrongLanguage,int unsupportedFormat,String diagnostics){
            this.hits=hits;this.movieMatches=movieMatches;this.subtitleRecords=subtitleRecords;
            this.invalidUrls=invalidUrls;this.wrongLanguage=wrongLanguage;
            this.unsupportedFormat=unsupportedFormat;
            this.diagnostic=diagnostics.length()>1200?diagnostics.substring(0,1200):diagnostics;
        }
    }
    /** Normalize only documented relative or first-party absolute SubDL subtitle links. */
    /** SubDL returns a relative path on a fixed trusted CDN.
     * Support filename punctuation and international text; never accept hosts from API data.
     */
    static String normalizeDownloadPath(String raw){
        if(raw==null)return "";
        String p=raw.trim();
        if(p.startsWith("https://")){
            try{
                java.net.URI uri=new java.net.URI(p);
                if(!"https".equalsIgnoreCase(uri.getScheme()) ||
                    !"dl.subdl.com".equalsIgnoreCase(uri.getHost()) ||
                    uri.getPort()!=-1 || uri.getUserInfo()!=null ||
                    uri.getRawQuery()!=null || uri.getRawFragment()!=null)return "";
                p=uri.getRawPath();
            }catch(Exception ignored){return "";}
        }
        if(p!=null&&p.startsWith("subtitle/"))p="/"+p;
        return cleanTrustedPath(p);
    }
    private static String cleanTrustedPath(String raw){
        if(raw==null||raw.length()>2048||!raw.startsWith("/subtitle/")||
            raw.contains("..")||raw.contains("//")||raw.indexOf('\\')>=0||
            raw.indexOf('?')>=0||raw.indexOf('#')>=0)return "";
        for(int i=0;i<raw.length();i++){
            char c=raw.charAt(i);
            if(Character.isISOControl(c)||c=='<'||c=='>'||c=='"'||c==39 ||
                c=='{'||c=='}'||c=='|'||c=='^'||c==96)return "";
        }
        String safe=raw.replace(" ","%20");
        if(safe.contains("%")){
            if(!safe.matches("(?:[^%]|%[0-9A-Fa-f]{2})+"))return "";
            String lower=safe.toLowerCase(Locale.ROOT);
            for(String forbidden:new String[]{"%2e","%2f","%5c","%00","%3f","%23","%25"})
                if(lower.contains(forbidden))return "";
        }
        try{
            java.net.URI resolved=new java.net.URI("https://dl.subdl.com"+safe);
            if(!"dl.subdl.com".equals(resolved.getHost())||resolved.getRawQuery()!=null||
                resolved.getFragment()!=null)return "";
            return resolved.toASCIIString().substring("https://dl.subdl.com".length());
        }catch(Exception ignored){return "";}
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
        if(n.isEmpty())n=record.optString("subtitleId","");
        if(n.isEmpty())n=record.optString("id","");
        return safeId(n)?"v2:"+n:"";
    }
    private static String canonicalDownload(JSONObject record,JSONObject parent){
        String path=normalizeDownloadPath(record.optString("url",""));
        if(path.isEmpty())path=normalizeDownloadPath(record.optString("download_url",""));
        if(path.isEmpty())path=normalizeDownloadPath(record.optString("downloadUrl",""));
        if(!path.isEmpty())return path;
        // V1 unpack_files can identify exact raw file without a usable URL.
        if(parent!=null){
            String n=parent.optString("n_id",parent.optString("nId",parent.optString("subtitle_id",parent.optString("id",""))));
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
        if(response.has("status")&&!response.optBoolean("status"))
            throw new IOException("SubDL search failed: "+safeError(response.optString("error",response.optString("message","Provider declined search")),90));
        JSONObject wrapped=response.optJSONObject("data");
        if(wrapped!=null&&(wrapped.has("subtitles")||wrapped.has("items")||wrapped.has("results")))response=wrapped;
        JSONArray movies=response.optJSONArray("results");
        JSONArray subs=response.optJSONArray("subtitles");
        if(subs==null)subs=response.optJSONArray("items");
        if(subs==null){
            JSONArray maybe=response.optJSONArray("results");
            if(maybe!=null&&maybe.length()>0){
                JSONObject first=maybe.optJSONObject(0);
                if(first!=null&&(first.has("n_id")||first.has("nId")||first.has("release_name")||first.has("download_url"))){
                    subs=maybe;
                    movies=new JSONArray();
                }else if(first!=null&&first.optJSONArray("subtitles")!=null){
                    subs=first.optJSONArray("subtitles");
                }
            }
        }
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
                String subLanguage=file.optString("language",entry.optString("language",entry.optString("lang","")));
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
    /** API request errors never return credentials or full URLs to the UI. */
    private static String providerError(Exception problem){
        String msg=problem.getMessage();
        if(msg==null)return problem.getClass().getSimpleName();
        msg=msg.replaceAll("(?i)api_key=[^&\\s]+","api_key=[REDACTED]")
            .replaceAll("(?i)Bearer\\s+\\S+","Bearer [REDACTED]")
            .replaceAll("(?i)subdl_[A-Za-z0-9_-]{10,}","[REDACTED]");
        if(msg.length()>90)msg=msg.substring(0,90);
        return msg;
    }
    static final class Probe {
        final SearchResult result;
        final String phase,details;
        Probe(SearchResult r,String phase,String details){this.result=r;this.phase=phase;this.details=details;}
    }
    static Probe chooseProviderResponse(JSONObject v2,JSONObject v1,String title,String lang) throws Exception {
        SearchResult newer=v2==null?null:parseSearchResponse(v2,title,lang);
        if(newer!=null&&newer.hits.length()>0)return new Probe(newer,"API v2","Subtitle IDs/links recognized");
        SearchResult legacy=v1==null?null:parseSearchResponse(v1,title,lang);
        if(legacy!=null&&legacy.hits.length()>0)return new Probe(legacy,"API v1","Fallback subtitle links recognized");
        SearchResult best=newer!=null&&newer.subtitleRecords>0?newer:legacy!=null?legacy:newer;
        if(best==null)throw new IOException("SubDL returned no usable JSON subtitle response.");
        return new Probe(best,"No usable release",
            "v2="+(newer==null?"unavailable":newer.subtitleRecords+" records / "+newer.hits.length()+" links")+
            "; v1="+(legacy==null?"unavailable":legacy.subtitleRecords+" records / "+legacy.hits.length()+" links"));
    }
    private static JSONObject jsonRequest(String path,String key) throws Exception {
        byte[] data=fetch(new URL("https://api.subdl.com"+path),1024*1024,key,true);
        return new JSONObject(new String(data,StandardCharsets.UTF_8));
    }
    private static String firstImdb(JSONObject response){
        if(response==null)return "";
        JSONObject object=response.optJSONObject("data");
        if(object==null)object=response;
        JSONArray items=object.optJSONArray("results");
        if(items==null||items.length()==0)return "";
        JSONObject movie=items.optJSONObject(0);
        if(movie==null)return "";
        String imdb=movie.optString("imdb_id","");
        return imdb.matches("tt[0-9]{5,12}")?imdb:"";
    }
    private static String responseShape(JSONObject payload){
        if(payload==null)return "no response";
        JSONObject obj=payload.optJSONObject("data");
        if(obj==null)obj=payload;
        JSONArray subs=obj.optJSONArray("subtitles");
        if(subs==null)subs=obj.optJSONArray("items");
        if(subs==null)subs=obj.optJSONArray("results");
        JSONObject one=subs==null||subs.length()==0?null:subs.optJSONObject(0);
        if(one==null)return "keys "+safeKeys(obj)+"; sample absent";
        JSONArray unpack=one.optJSONArray("unpack_files");
        JSONObject first=unpack==null||unpack.length()==0?null:unpack.optJSONObject(0);
        return "keys "+safeKeys(obj)+"; sample fields "+safeKeys(one)+
            "; URL "+linkShape(one.optString("url",""))+
            "; first unpacked fields "+safeKeys(first)+
            "; unpack URL "+linkShape(first==null?"":first.optString("url",""));
    }
    private static String safeKeys(JSONObject obj){
        if(obj==null)return "(none)";
        java.util.ArrayList<String> keys=new java.util.ArrayList<>();
        java.util.Iterator<String> iter=obj.keys();
        while(iter.hasNext()){
            String key=iter.next();
            if(key.matches("[A-Za-z][A-Za-z0-9_]{0,32}") &&
                !key.toLowerCase(Locale.ROOT).contains("key") &&
                !key.toLowerCase(Locale.ROOT).contains("token") &&
                !key.toLowerCase(Locale.ROOT).contains("secret") &&
                keys.size()<16)keys.add(key);
        }
        java.util.Collections.sort(keys);
        return keys.toString();
    }
    private static String linkShape(String raw){
        if(raw==null||raw.isEmpty())return "absent";
        if(raw.startsWith("/subtitle/"))return "relative subtitle path";
        if(raw.startsWith("https://dl.subdl.com/subtitle/"))return "official CDN absolute";
        if(raw.startsWith("subtitle/"))return "relative without slash";
        if(raw.startsWith("https://"))return "other HTTPS host/path";
        if(raw.startsWith("/"))return "other relative path";
        return "other value format";
    }
    /** Runs on the user's phone, using ONLY the locally encrypted key.
     * Checks a real search AND actual SRT transfer/parse. Never includes keys,
     * downloadable URLs, unique subtitle IDs or captions in the report.
     */
    static final class LiveTest {
        final String report;
        final Srt srt;
        final JSONObject hit;
        LiveTest(String report,Srt srt,JSONObject hit){
            this.report=report;this.srt=srt;this.hit=hit;
        }
    }
    static LiveTest testRealDownload(String apiKey){
        StringBuilder report=new StringBuilder("CinePulse SubDL live download test v0.2.1\n"+
            "Movie: Inception (2010), IMDb tt1375666, English\n"+
            "All operations run on this phone. Credentials and download URLs are omitted.\n\n");
        if(apiKey==null||apiKey.trim().length()<8){
            return new LiveTest(report.append("FAIL: No saved SubDL API key.\n").toString(),null,null);
        }
        JSONArray possible=new JSONArray();
        java.util.HashSet<String> unique=new java.util.HashSet<>();
        final String[] modes={"v2 IMDb", "v1 IMDb (packed ZIP)"};
        for(int mode=0;mode<2;mode++){
            try{
                String route=mode==0?
                    "/api/v2/subtitles/search?imdb_id=tt1375666&type=movie&languages=en&subs_per_page=5&unpack=1":
                    "/api/v1/subtitles?api_key="+encode(apiKey.trim())+
                        "&imdb_id=tt1375666&type=movie&languages=EN&subs_per_page=5";
                JSONObject raw=jsonRequest(route,apiKey);
                SearchResult found=parseSearchResponse(raw,"Inception (2010)","EN");
                report.append(modes[mode]).append(": search succeeded; ")
                    .append(found.subtitleRecords).append(" subtitle records; ")
                    .append(found.hits.length()).append(" recognized download choices.\n");
                report.append("  Response schema: ").append(responseShape(raw)).append("\n");
                for(int i=0;i<found.hits.length()&&possible.length()<8;i++){
                    JSONObject item=found.hits.optJSONObject(i);
                    if(item!=null&&unique.add(item.optString("path")))possible.put(item);
                }
            }catch(Exception e){
                report.append(modes[mode]).append(": FAILED — ")
                    .append(providerError(e)).append("\n");
            }
        }
        report.append("\n");
        if(possible.length()==0){
            report.append("FAIL: SubDL returned no recognized download choices. No transfer attempted.\n")
                .append("Copy this report to identify the real API fields; the key is never included.\n");
            return new LiveTest(report.toString(),null,null);
        }
        for(int i=0;i<Math.min(3,possible.length());i++){
            JSONObject hit=possible.optJSONObject(i);
            if(hit==null)continue;
            String path=hit.optString("path");
            try{
                Srt result=download(path,apiKey);
                report.append("PASS: Downloaded and decoded a real SubDL subtitle.\n")
                    .append("Validated cues: ").append(result.cues).append("\n")
                    .append("Last cue: ").append(String.format(Locale.ROOT,"%.1f",result.duration))
                    .append(" seconds\n")
                    .append("SRT SHA-256 prefix: ").append(result.sha256.substring(0,12)).append("\n")
                    .append("The file can be saved locally in CinePulse.\n");
                return new LiveTest(report.toString(),result,hit);
            }catch(Exception e){
                report.append("Download attempt ").append(i+1).append(" failed: ")
                    .append(providerError(e)).append("\n");
            }
        }
        report.append("FAIL: Search returned choices, but the first ")
            .append(Math.min(3,possible.length()))
            .append(" downloads failed. No subtitle was saved.\n");
        return new LiveTest(report.toString(),null,null);
    }
    static SearchResult searchDetailed(String apiKey,String title,String language) throws Exception{
        if(apiKey==null||apiKey.trim().length()<8)
            throw new IOException("Set your SubDL API key in SRT Library first.");
        if(title==null||title.trim().length()<2||title.length()>130)
            throw new IOException("Movie search must contain 2–130 characters.");
        if(!("EN".equals(language)||"UR".equals(language)))
            throw new IOException("Unsupported language code.");
        String clean=title.trim().replaceFirst("\\s*\\(\\d{4}\\)$","");
        String lower=language.toLowerCase(Locale.ROOT);
        JSONObject v2=null,v1=null;
        StringBuilder errors=new StringBuilder();
        // v2 is now primary. The older implementation hid its errors and reused
        // the v1 "zero offered" diagnostic on every device.
        try{
            v2=jsonRequest("/api/v2/subtitles/search?film_name="+encode(clean)+
                "&type=movie&languages="+lower+"&unpack=1&subs_per_page=30",apiKey);
            SearchResult first=parseSearchResponse(v2,clean,language);
            if(first.hits.length()>0)return first;
        }catch(Exception e){errors.append("v2 subtitle title search: ").append(providerError(e)).append("; ");}

        // A stable IMDb lookup is more reliable than a fuzzy title for some v2 catalogs.
        try{
            JSONObject movies=jsonRequest("/api/v2/movies/search?q="+encode(clean)+"&type=movie&limit=5",apiKey);
            String imdb=firstImdb(movies);
            if(!imdb.isEmpty()){
                JSONObject idResponse=jsonRequest("/api/v2/subtitles/search?imdb_id="+encode(imdb)+
                    "&type=movie&languages="+lower+"&unpack=1&subs_per_page=30",apiKey);
                SearchResult byId=parseSearchResponse(idResponse,clean,language);
                if(byId.hits.length()>0)return byId;
                if(v2==null||byId.subtitleRecords>0)v2=idResponse;
            }else errors.append("v2 movie search had no IMDb ID; ");
        }catch(Exception e){errors.append("v2 IMDb lookup: ").append(providerError(e)).append("; ");}

        try{
            v1=jsonRequest("/api/v1/subtitles?api_key="+encode(apiKey.trim())+
                "&film_name="+encode(clean)+"&type=movie&languages="+language+
                "&unpack=1&subs_per_page=30&client=custom_integration",apiKey);
        }catch(Exception e){errors.append("v1 legacy search: ").append(providerError(e)).append("; ");}
        Probe selection=chooseProviderResponse(v2,v1,clean,language);
        if(selection.result.hits.length()>0)return selection.result;
        // Display precise evidence and the phases checked; do not silently swallow errors.
        SearchResult r=selection.result;
        String details=selection.details;
        String errorText=errors.toString();
        String summary="v0.2.0 | All SubDL search paths exhausted: "+details+
            "; rejected links="+r.invalidUrls+"; wrong-language files="+r.wrongLanguage+
            "; non-SRT files="+r.unsupportedFormat+"."+
            (errorText.isEmpty()?"":" API errors: "+errorText)+
            " [v2 shape: "+responseShape(v2)+"] [v1 shape: "+responseShape(v1)+"]";
        return new SearchResult(r.hits,r.movieMatches,r.subtitleRecords,
            r.invalidUrls,r.wrongLanguage,r.unsupportedFormat,summary);
    }
    static JSONArray search(String apiKey,String title,String language) throws Exception {
        return searchDetailed(apiKey,title,language).hits;
    }
    private static String safeError(String s,int max){
        String clean=s.replaceAll("[\\r\\n\\t]"," ");
        return clean.length()>max?clean.substring(0,max):clean;
    }
    static boolean validPath(String p){return p!=null && !cleanTrustedPath(p).isEmpty();}
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
