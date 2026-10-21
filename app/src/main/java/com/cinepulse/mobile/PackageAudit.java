package com.cinepulse.mobile;

import org.json.JSONArray;
import org.json.JSONObject;
import java.util.Locale;
import java.util.Map;
import java.util.HashMap;
import java.util.List;
import java.util.ArrayList;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Offline, deterministic package structure/timing audit. Not a substitute for STT audio content validation. */
final class PackageAudit {
    private PackageAudit(){}
    private static final Pattern TIME=Pattern.compile("(\\d{2}):(\\d{2}):(\\d{2})[,\\.](\\d{3})");
    private static final Pattern RANGE=Pattern.compile("(\\d{2}:\\d{2}:\\d{2}[,\\.]\\d{3})\\s*-->\\s*(\\d{2}:\\d{2}:\\d{2}[,\\.]\\d{3})");
    static final class Result {
        final String report;
        final boolean structuralPass;
        final int englishCuts,urduCuts;
        Result(String report,boolean pass,int englishCuts,int urduCuts) {
            this.report=report;this.structuralPass=pass;this.englishCuts=englishCuts;this.urduCuts=urduCuts;
        }
    }
    private static String unwrap(Object value,String key){
        if(value==null||value==JSONObject.NULL)return "";
        if(value instanceof JSONObject)return ((JSONObject)value).optString(key,"");
        String s=String.valueOf(value);
        if(s.trim().startsWith("{")) {
            try {JSONObject obj=new JSONObject(s);if(obj.has(key))return obj.optString(key,"");}catch(Exception ignored){}
        }
        return s;
    }
    private static double seconds(String time) {
        Matcher m=TIME.matcher(time==null?"":time);
        if(!m.matches())return -1;
        return Integer.parseInt(m.group(1))*3600+Integer.parseInt(m.group(2))*60+
            Integer.parseInt(m.group(3))+Integer.parseInt(m.group(4))/1000d;
    }
    static double srtEnd(String raw){
        String s=unwrap(raw,"srt");
        Matcher m=RANGE.matcher(s);double end=-1;
        while(m.find())end=Math.max(end,seconds(m.group(2)));
        return end;
    }
    static int srtCueCount(String raw){
        Matcher m=RANGE.matcher(unwrap(raw,"srt"));int count=0;
        while(m.find())count++;
        return count;
    }
    private static void line(StringBuilder sb,String label,String detail){sb.append(label).append(" — ").append(detail).append('\n');}
    private static String fmt(double sec){
        if(sec<0)return "not available";
        return String.format(Locale.ROOT,"%.2fs",sec);
    }
    private static String audioTiming(double measured,double expected){
        if(measured<=0)return "Audio duration not measured on this device";
        if(expected<=0)return "No valid timed SRT";
        double diff=Math.abs(measured-expected);
        double tolerance=Math.max(8d,expected*0.04d);
        return "MP3 "+fmt(measured)+" vs SRT "+fmt(expected)+" (difference "+
            fmt(diff)+", tolerance "+fmt(tolerance)+") — "+(diff<=tolerance?"PASS duration":"WARNING duration mismatch");
    }
    /** Approximate script↔SRT textual overlap, never audio transcription verification. */
    static double lexicalRecall(String narration,String timedSrt){
        String cleaned=(timedSrt==null?"":timedSrt)
            .replaceAll("\\d{2}:\\d{2}:\\d{2}[,.]\\d{3}\\s*-->\\s*\\d{2}:\\d{2}:\\d{2}[,.]\\d{3}"," ")
            .replaceAll("(?m)^\\s*\\d{1,6}\\s*$"," ")
            .replaceAll("<[^>]*>"," ");
        Map<String,Integer> seen=new HashMap<>();
        Matcher m=Pattern.compile("[\\p{L}\\p{N}]+").matcher(cleaned.toLowerCase(Locale.ROOT));
        while(m.find()){String word=m.group();seen.put(word,seen.getOrDefault(word,0)+1);}
        Matcher original=Pattern.compile("[\\p{L}\\p{N}]+").matcher((narration==null?"":narration).toLowerCase(Locale.ROOT));
        int count=0,matched=0;
        while(original.find()){
            String word=original.group();count++;
            int n=seen.getOrDefault(word,0);
            if(n>0){matched++;seen.put(word,n-1);}
        }
        return count<10?-1:matched/(double)count;
    }
    private static boolean hasText(Object o,String key){
        return unwrap(o,key).trim().length()>25;
    }
    static Result inspect(JSONObject data,double englishMp3Seconds,double urduMp3Seconds){
        StringBuilder report=new StringBuilder("CinePulse package verification report\n");
        report.append("Verification is structural/timing only. Audio speech-content and visual scene correctness require STT/visual QA.\n\n");
        boolean pass=true;
        String schema=data.optString("schema","");
        boolean validSchema="cinepulse.render-project.v1".equals(schema);
        line(report,"JSON schema",validSchema?"PASS "+schema:"FAIL unexpected "+schema);pass&=validSchema;
        JSONObject project=data.optJSONObject("project");
        line(report,"Project",project==null?"FAIL no project identity":project.optString("title","Untitled"));
        if(project==null)pass=false;
        JSONObject meta=data.optJSONObject("metadata");
        boolean hasMeta=meta!=null&&meta.optString("description").trim().length()>=20
            &&meta.optJSONArray("keywords")!=null&&meta.optJSONArray("keywords").length()>0
            &&meta.optJSONArray("hashtags")!=null&&meta.optJSONArray("hashtags").length()>0;
        line(report,"Viral metadata",hasMeta?"PASS description, keywords and hashtags":"WARNING missing description/keywords/hashtags");
        JSONObject narratives=data.optJSONObject("narrations"),srts=data.optJSONObject("narrationSrts"),audio=data.optJSONObject("audio");
        JSONArray cuts=data.optJSONArray("cutPlan"),matches=data.optJSONArray("sceneMatches");
        line(report,"Scene matches",matches==null||matches.length()==0?"WARNING no scene matches":matches.length()+" source match records");
        if(cuts==null)cuts=new JSONArray();
        int enCuts=0,urCuts=0;boolean invalid=false, longSource=false;
        for(String lang:new String[]{"english","urdu"}){
            boolean eng="english".equals(lang);
            String text=narratives==null?"":unwrap(narratives.opt(lang),"text");
            String rawSrt=srts==null?"":unwrap(srts.opt(lang),"srt");
            double srtDuration=srtEnd(rawSrt);
            int cues=srtCueCount(rawSrt);
            line(report,lang+" narration",text.trim().length()>25?"PASS text present ("+text.length()+" characters)":"FAIL missing narration text");
            if(text.trim().length()<=25)pass=false;
            line(report,lang+" SRT",cues>0?"PASS "+cues+" timed cues, end "+fmt(srtDuration):"FAIL no valid timed SRT");
            if(cues==0)pass=false;
            double recall=lexicalRecall(text,rawSrt);
            if(recall>=0){
                double threshold=eng?0.70:0.45;
                line(report,lang+" narration↔SRT lexical coverage",
                    String.format(Locale.ROOT,"%.1f%% script words appear in SRT (",recall*100d)+
                    (recall>=threshold?"PASS approximate text agreement":"WARNING script/SRT text mismatch")+
                    "). This compares written words only, not actual audio speech.");
                if(recall<threshold)pass=false;
            }else line(report,lang+" narration↔SRT lexical coverage","NOT VERIFIED (missing or insufficient text)");
            double measured=eng?englishMp3Seconds:urduMp3Seconds;
            line(report,lang+" MP3/SRT",audioTiming(measured,srtDuration));
            if(measured>0 && srtDuration>0 && Math.abs(measured-srtDuration)>Math.max(8d,srtDuration*.04d))pass=false;
            JSONObject manifest=audio==null?null:audio.optJSONObject(lang);
            line(report,lang+" MP3 manifest",manifest!=null&&manifest.optLong("bytes")>0
                 &&manifest.optString("sha256").matches("(?i)[0-9a-f]{64}")?"PASS bytes and SHA-256 declared":"FAIL manifest missing/invalid");
            if(manifest==null||manifest.optLong("bytes")<=0||!manifest.optString("sha256").matches("(?i)[0-9a-f]{64}"))pass=false;
            List<double[]> spans=new ArrayList<>();
            double sourceSum=0;
            for(int i=0;i<cuts.length();i++){
                JSONObject item=cuts.optJSONObject(i);
                if(item==null||!lang.equals(item.optString("language")))continue;
                if(eng)enCuts++;else urCuts++;
                double sourceStart=item.optDouble("sourceStartSeconds",-1);
                double sourceEnd=item.optDouble("sourceEndSeconds",-1);
                double start=item.optDouble("narrationStartSeconds",-1);
                double end=item.optDouble("narrationEndSeconds",-1);
                if(sourceStart<0||sourceEnd<=sourceStart||start<0||end<=start){invalid=true;continue;}
                spans.add(new double[]{start,end});
                sourceSum+=sourceEnd-sourceStart;
                if(sourceEnd-sourceStart>Math.max(25d,(end-start)*1.5d))longSource=true;
            }
            spans.sort((a,b)->Double.compare(a[0],b[0]));
            double cover=0,finish=0,gap=0,overlap=0;
            for(double[] span:spans){
                gap+=Math.max(0,span[0]-finish);
                overlap+=Math.max(0,Math.min(finish,span[1])-span[0]);
                cover+=Math.max(0,span[1]-Math.max(finish,span[0]));
                finish=Math.max(finish,span[1]);
            }
            double tail=srtDuration>0?Math.max(0,srtDuration-finish):0;
            line(report,lang+" cut plan",spans.size()+" timecoded ranges; narration coverage "+
                fmt(cover)+"; gaps "+fmt(gap+tail)+"; overlaps "+fmt(overlap)+"; source footage "+fmt(sourceSum));
            if(spans.size()==0){line(report,lang+" cut readiness","FAIL no timecoded cut ranges");pass=false;}
            else if(srtDuration>0 && (gap+tail)>Math.max(10d,srtDuration*.05d)){
                line(report,lang+" cut coverage","WARNING coverage gaps exceed tolerance. Re-match before rendering.");pass=false;
            }
        }
        line(report,"Cut source-range validity",invalid?"FAIL invalid start/end":"PASS valid source/narration ranges");
        if(invalid)pass=false;
        if(longSource)line(report,"Render readiness","SOURCE MATCHES ONLY: some raw movie ranges are longer than narration slots; shorten/re-match clips on Windows before rendering.");
        else line(report,"Render readiness",enCuts>0&&urCuts>0?"Timing ranges structurally present; video/audio alignment still unverified":"Cut plan is incomplete");
        line(report,"Narration content matching","NOT VERIFIED: timing agreement alone does not prove the spoken words match SRT or narration. Run remote STT for semantic verification.");
        line(report,"Actual movie scene accuracy","NOT VERIFIED: matching video frames requires access to the original movie and scene matching on Windows.");
        line(report,"Overall",pass?"PASS structural checks (not final production approval)":"NEEDS REVIEW: fix failures/warnings before final rendering");
        return new Result(report.toString(),pass,enCuts,urCuts);
    }
}
