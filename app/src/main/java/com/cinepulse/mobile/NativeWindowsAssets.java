package com.cinepulse.mobile;

import org.json.JSONObject;
import java.io.IOException;
import java.util.regex.Pattern;

/**
 * Server-owned Windows package contract. Android verifies signed original bytes,
 * then unpacks only legacy JSON-envelope SRT wrappers, never authors cut plans.
 * No Android runtime dependencies; enforced by local JVM regression tests.
 */
final class NativeWindowsAssets {
    private NativeWindowsAssets() {}
    static final String[] KINDS={
        "windows_project_json","source_srt","english_mp3","urdu_mp3",
        "english_srt","urdu_srt","english_narration","urdu_narration"
    };
    static final String[] NAMES={
        "CinePulse_Project.json","CinePulse_Source.srt","CinePulse_English.mp3","CinePulse_Urdu.mp3",
        "CinePulse_English.srt","CinePulse_Urdu.srt",
        "CinePulse_English_Narration.txt","CinePulse_Urdu_Narration.txt"
    };
    private static final Pattern TIMECODE=Pattern.compile(
        "(?m)\\b\\d{2}:\\d{2}:\\d{2}[,.]\\d{3}\\s*-->\\s*\\d{2}:\\d{2}:\\d{2}[,.]\\d{3}"
    );
    static void validateServerManifest(JSONObject links) throws IOException {
        if(!"windows_eight_verified".equals(links.optString("format")))
            throw new IOException("Cloudflare has not confirmed a complete eight-file Windows package. Wait for windows_project export to finish.");
        JSONObject files=links.optJSONObject("files");
        if(files==null||files.length()!=KINDS.length)
            throw new IOException("Cloudflare provided an incomplete Windows file manifest; expected eight signed assets.");
        for(int i=0;i<KINDS.length;i++){
            JSONObject file=files.optJSONObject(KINDS[i]);
            if(file==null||!NAMES[i].equals(file.optString("filename"))||
               file.optLong("bytes",-1)<1||!file.optString("sha256").matches("(?i)[a-f0-9]{64}"))
               throw new IOException("Missing or invalid signed Windows file: "+NAMES[i]);
        }
    }
    static String measuredSrt(String raw,String language) throws IOException {
        if(raw==null||raw.isEmpty()||raw.length()>2_500_000)
            throw new IOException(language+" measured narration SRT is missing or too large");
        String text=raw;
        if(raw.trim().startsWith("{")){
            try{
                JSONObject data=new JSONObject(raw);
                if(!"srt".equals(data.optString("format"))||data.optString("text").trim().isEmpty())
                    throw new IOException(language+" SRT JSON envelope is missing the measured SRT text");
                text=data.getString("text");
            }catch(IOException e){throw e;}
            catch(Exception e){throw new IOException(language+" stored SRT envelope is malformed",e);}
        }
        if(!TIMECODE.matcher(text).find())
            throw new IOException(language+" narration SRT has no timed cues: request a corrected measured subtitle asset, not regenerated audio");
        return text;
    }
    private static String normalized(String x){return x==null?"":x.replace("\r\n","\n").replace('\r','\n').trim();}
    static void verifyWindowsProject(JSONObject project,String projectId,String englishSrt,String urduSrt) throws IOException{
        JSONObject cloudImport=project.optJSONObject("cloudImport");
        if(cloudImport==null||!projectId.equals(cloudImport.optString("cloudProjectId"))||
           !"cinepulse.windows-muse.v4".equals(cloudImport.optString("schema")))
            throw new IOException("Native Muse v4 Windows JSON does not match this verified movie");
        JSONObject tracks=project.optJSONObject("tracks");
        JSONObject en=tracks==null?null:tracks.optJSONObject("english");
        JSONObject ur=tracks==null?null:tracks.optJSONObject("hindiUrdu");
        if(en==null||ur==null)
            throw new IOException("Native Windows JSON is missing English or Urdu scene tracks");
        if(!normalized(englishSrt).equals(normalized(en.optString("narrationSrt")))||
           !normalized(urduSrt).equals(normalized(ur.optString("narrationSrt"))))
            throw new IOException("Downloaded measured SRT differs from the verified native Windows project; do not render until repaired");
        if(en.optJSONArray("cuts")==null||en.optJSONArray("cuts").length()<1||
           ur.optJSONArray("cuts")==null||ur.optJSONArray("cuts").length()<1)
            throw new IOException("Windows package has no verified final cut plans");
    }
}
