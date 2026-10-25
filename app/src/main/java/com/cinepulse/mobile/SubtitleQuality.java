package com.cinepulse.mobile;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Checks feature-length SubRip plausibility before an automatic movie is declared downloaded. */
final class SubtitleQuality {
    private SubtitleQuality(){}
    static final class Result {
        final boolean complete;
        final int score;
        final String reason;
        Result(boolean good,int score,String reason){complete=good;this.score=score;this.reason=reason;}
    }
    private static final Pattern TIMES=Pattern.compile(
        "(?m)^(\\d{2}):(\\d{2}):(\\d{2})[,\\.](\\d{3})\\s*-->\\s*(\\d{2}):(\\d{2}):(\\d{2})[,\\.](\\d{3})");
    private static double seconds(Matcher m,int offset){
        return Integer.parseInt(m.group(offset))*3600.0+
            Integer.parseInt(m.group(offset+1))*60.0+
            Integer.parseInt(m.group(offset+2))+
            Integer.parseInt(m.group(offset+3))/1000.0;
    }
    static Result assess(SubtitleProvider.Srt srt,int runtimeMinutes){
        if(srt==null||srt.text==null)return new Result(false,0,"No subtitle content");
        if(srt.cues<75)return new Result(false,0,"Only "+srt.cues+" cues (likely incomplete)");
        if(srt.duration<3300)return new Result(false,0,"Subtitle ends after "+Math.round(srt.duration/60)+" minutes");
        int[] quarters=new int[4];
        int counted=0;double first=Double.POSITIVE_INFINITY,latest=0,previous=-1;
        int reversals=0;
        Matcher m=TIMES.matcher(srt.text);
        while(m.find()&&counted<15000){
            double start=seconds(m,1),end=seconds(m,5);
            if(end<=start||end>24*3600)continue;
            if(previous>start+5)reversals++;
            previous=start;
            first=Math.min(first,start);latest=Math.max(latest,end);
            quarters[Math.min(3,(int)(4*start/Math.max(srt.duration,1)))%4]++;
            counted++;
        }
        if(counted<Math.max(70,(int)(srt.cues*.75)))return new Result(false,0,"Malformed or missing SubRip timestamps");
        if(reversals>Math.max(6,counted/20))return new Result(false,0,"Timestamps are out of order");
        if(first>900)return new Result(false,0,"Subtitles start over 15 minutes into the movie");
        if(latest-first<3000)return new Result(false,0,"Subtitle timeline covers less than 50 minutes");
        int occupied=0;
        for(int n:quarters)if(n>=3)occupied++;
        if(occupied<3)return new Result(false,0,"Subtitle cues are clustered into only part of the movie");
        if(runtimeMinutes>=45&&runtimeMinutes<=240){
            double expected=runtimeMinutes*60d;
            if(latest<expected*.72)return new Result(false,0,"Subtitle ends too early for expected runtime of "+runtimeMinutes+" minutes");
            if(latest>expected*1.30)return new Result(false,0,"Subtitle timing exceeds expected movie runtime");
        }
        int score=(int)Math.min(100,40+Math.min(30,counted/24)+Math.min(20,(latest-first)/360)+occupied*2);
        return new Result(true,score,"Quality verified: "+counted+" timed cues across "+occupied+" timeline quarters");
    }
}
