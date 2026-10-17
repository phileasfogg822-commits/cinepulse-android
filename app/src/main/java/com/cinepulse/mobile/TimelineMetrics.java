package com.cinepulse.mobile;

import org.json.JSONArray;
import org.json.JSONObject;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.Date;
import java.util.Locale;
import java.text.DateFormat;

/** Converts backend epoch seconds, epoch milliseconds or ISO-8601 timestamps safely. */
final class TimelineMetrics {
    private TimelineMetrics(){}

    static long millis(Object raw) {
        if(raw == null || raw == JSONObject.NULL)return 0L;
        if(raw instanceof Number)return epoch(((Number)raw).doubleValue());
        String s=String.valueOf(raw).trim();
        if(s.isEmpty() || "null".equalsIgnoreCase(s))return 0L;
        try {return epoch(Double.parseDouble(s));}catch(NumberFormatException ignored){}
        try{return Instant.parse(s).toEpochMilli();}catch(DateTimeParseException ignored){}
        return 0L;
    }
    private static long epoch(double n) {
        if(Double.isNaN(n)||Double.isInfinite(n)||n<=0||n>9.99e15)return 0;
        return (long)(n < 100000000000d ? n * 1000d : n);
    }
    static long time(JSONObject object,String...keys) {
        if(object==null)return 0;
        for(String key:keys) {
            long result=millis(object.opt(key));
            if(result>0)return result;
        }
        return 0;
    }
    static String date(long ts) {
        if(ts<=0)return "Not reported";
        return DateFormat.getDateTimeInstance(DateFormat.MEDIUM,DateFormat.MEDIUM).format(new Date(ts));
    }
    static String duration(long delta) {
        if(delta < 0)return "Not available";
        long seconds=delta/1000L;
        long days=seconds/86400L;
        long hours=(seconds%86400L)/3600L;
        long minutes=(seconds%3600L)/60L;
        long rest=seconds%60L;
        if(days>0)return String.format(Locale.ROOT,"%dd %02dh %02dm",days,hours,minutes);
        if(hours>0)return String.format(Locale.ROOT,"%dh %02dm %02ds",hours,minutes,rest);
        if(minutes>0)return String.format(Locale.ROOT,"%dm %02ds",minutes,rest);
        if(delta<1000)return delta+" ms";
        return seconds+"s";
    }
    static String interval(long start,long end,long now) {
        if(start<=0)return "Not reported";
        long stop=end>0?end:now;
        if(stop<start)return "Not available";
        return duration(stop-start)+(end>0?"":" (ongoing)");
    }
    static String safeLabel(String message,int limit) {
        if(message==null)return "";
        String cleaned=message.replaceAll("(?i)Bearer\\s+[^\\s]+","Bearer [redacted]")
           .replaceAll("(?i)([?&](?:sig|token|key|secret)=)[^&\\s]+","$1[redacted]")
           .replaceAll("(?i)https?://[^\\s]+","[link hidden]")
           .replaceAll("[\\p{Cntrl}]+"," ").trim();
        return cleaned.length()>limit?cleaned.substring(0,limit)+"…":cleaned;
    }
    static String stageLabel(String id) {
        if(id==null||id.trim().isEmpty())return "Stage";
        switch(id) {
            case "digest": return "Story digest / movie understanding";
            case "narration_english": return "English narration writing";
            case "narration_urdu": return "Urdu narration writing";
            case "viral_metadata": return "Viral scenes and social metadata";
            case "mp3_english": return "English voice / MP3";
            case "srt_english": return "English timed SRT";
            case "mp3_urdu": return "Urdu voice / MP3";
            case "srt_urdu": return "Urdu timed SRT";
            case "scene_matching": return "Scene matching";
            case "cut_plan": return "Video cut plan";
            default: return id.replace('_',' ');
        }
    }
}
