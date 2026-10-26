package com.cinepulse.mobile;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Subtitle-grounded short-clip finalization. Frame semantics require actual video. */
final class FinalCutPlanner {
    private FinalCutPlanner(){}
    private static final double CLIP_MAX=6d, EPS=.003;
    private static final Pattern TIMES=Pattern.compile(
        "(?m)^(\\d{2}:\\d{2}:\\d{2}[,.]\\d{3})\\s*-->\\s*(\\d{2}:\\d{2}:\\d{2}[,.]\\d{3})");
    static final class Result {
        final JSONArray cuts;
        final double audioSeconds, footageSeconds;
        final int anchors;
        final String report;
        Result(JSONArray cuts,double audioSeconds,double footageSeconds,int anchors,String report){
            this.cuts=cuts;this.audioSeconds=audioSeconds;this.footageSeconds=footageSeconds;
            this.anchors=anchors;this.report=report;
        }
    }
    private static final class Range {
        double sourceStart,sourceEnd,audioStart,audioEnd,quality;
        Range(double ss,double se,double as,double ae,double q) {
            sourceStart=ss;sourceEnd=se;audioStart=as;audioEnd=ae;quality=q;
        }
        double distance(double t){return Math.max(0,Math.max(audioStart-t,t-audioEnd));}
    }
    static double secs(String str){
        if(str==null)return -1;
        String val=str.trim().replace(',','.');
        if(!val.matches("\\d{2}:\\d{2}:\\d{2}\\.\\d{3}"))return -1;
        String[] parts=val.split(":");
        return Integer.parseInt(parts[0])*3600d+Integer.parseInt(parts[1])*60+Double.parseDouble(parts[2]);
    }
    static String stamp(double s){
        long ms=Math.round(Math.max(0,s)*1000);
        return String.format(Locale.ROOT,"%02d:%02d:%02d.%03d",ms/3600000L,
            (ms/60000L)%60,(ms/1000L)%60,ms%1000L);
    }
    private static List<Double> sourceCues(String srt){
        Matcher m=TIMES.matcher(srt);
        List<Double> all=new ArrayList<>();
        while(m.find()){
            double s=secs(m.group(1)),e=secs(m.group(2));
            if(s>=0&&e>s)all.add(s);
            if(all.size()>10000)break;
        }
        return all;
    }
    private static double confidence(JSONObject match){
        Object value=match.opt("confidence");
        if(value instanceof Number)return ((Number)value).doubleValue();
        String str=value==null?"":String.valueOf(value).toLowerCase(Locale.ROOT);
        if("high".equals(str))return .9;
        if("medium".equals(str))return .65;
        if("low".equals(str))return .25;
        return .50;
    }
    private static void add(List<Range> all,double ss,double se,double as,double ae,double quality,double maxMovie){
        if(!Double.isFinite(ss)||!Double.isFinite(se)||!Double.isFinite(as)||!Double.isFinite(ae))return;
        if(ss<0||as<0||se<=ss||ae<=as||ss>=maxMovie-1||se>maxMovie+90)return;
        // A full-film or multi-reel raw window is NOT a verified scene anchor.
        if(se-ss>Math.max(300d,(ae-as)*12d))return;
        all.add(new Range(ss,Math.min(se,maxMovie),as,ae,quality));
    }
    private static List<Range> anchors(JSONObject original,String language,double maxMovie){
        List<Range> all=new ArrayList<>();
        JSONArray plans=original.optJSONArray("cutPlan");
        if(plans!=null)for(int i=0;i<plans.length();i++){
            JSONObject item=plans.optJSONObject(i);if(item==null)continue;
            if(!language.equalsIgnoreCase(item.optString("language")))continue;
            add(all,item.optDouble("sourceStartSeconds",-1),item.optDouble("sourceEndSeconds",-1),
                item.optDouble("narrationStartSeconds",-1),item.optDouble("narrationEndSeconds",-1),
                .65,maxMovie);
        }
        JSONArray matches=original.optJSONArray("sceneMatches");
        if(matches!=null)for(int i=0;i<matches.length();i++){
            JSONObject item=matches.optJSONObject(i);if(item==null||
                item.optBoolean("insufficientEvidence")||item.optBoolean("subtitleEvidenceInsufficient")||
                item.optBoolean("matched",true)==false||confidence(item)<.55)continue;
            double ss=secs(item.optString("sourceStart")),se=secs(item.optString("sourceEnd"));
            String as,ae;
            if("urdu".equals(language)){
                as=item.optString("narrationUrduStart",item.optString("narrationStartUr",""));
                ae=item.optString("narrationUrduEnd",item.optString("narrationEndUr",""));
            }else{
                as=item.optString("narrationStartEn",item.optString("narrationStart",""));
                ae=item.optString("narrationEndEn",item.optString("narrationEnd",""));
            }
            add(all,ss,se,secs(as),secs(ae),confidence(item),maxMovie);
        }
        return all;
    }
    private static boolean occupied(List<double[]> used,double s,double e){
        for(double[] r:used)if(s<r[1]-.001&&e>r[0]+.001)return true;
        return false;
    }
    private static double chooseSource(double desired,double clip,Range anchor,
        double maxMovie,List<Double> cues,List<double[]> used){
        // An anchor may need a few seconds of adjacent footage for a hook/voiceover.
        double margin=Math.min(12,Math.max(4,clip*2));
        double lo=Math.max(0,anchor.sourceStart-margin);
        double hi=Math.min(maxMovie-clip,anchor.sourceEnd+margin-clip);
        if(hi<lo)return -1;
        List<Double> candidates=new ArrayList<>();
        double preferred=Math.max(lo,Math.min(hi,desired));
        candidates.add(preferred);
        for(double cue:cues)if(cue>=lo-1&&cue<=hi+1)
            candidates.add(Math.max(lo,Math.min(hi,cue)));
        for(double delta=.5;delta<=Math.max(20,hi-lo);delta+=.5){
            if(preferred-delta>=lo)candidates.add(preferred-delta);
            if(preferred+delta<=hi)candidates.add(preferred+delta);
            if(candidates.size()>12000)break;
        }
        candidates.sort(Comparator.comparingDouble(x->Math.abs(x-preferred)));
        for(double candidate:candidates){
            candidate=Math.round(candidate*1000)/1000d;
            if(candidate<lo-EPS||candidate+clip>maxMovie+EPS||
                candidate+clip>anchor.sourceEnd+margin+EPS||occupied(used,candidate,candidate+clip))continue;
            // Require evidence that this shot is near at least one actual source subtitle.
            boolean close=false;
            for(double cue:cues)if(cue>=candidate-18&&cue<=candidate+clip+18){close=true;break;}
            if(close)return candidate;
        }
        return -1;
    }
    static Result finalizePlan(JSONObject original,String language,double audioSeconds) throws Exception {
        if(!"english".equals(language)&&!"urdu".equals(language))
            throw new IllegalArgumentException("Unsupported render language");
        if(!(audioSeconds>30)||!Double.isFinite(audioSeconds))
            throw new IOException(language+": MP3 duration is unavailable");
        String source=original.optString("sourceSrt","");
        List<Double> cues=sourceCues(source);
        double maxMovie=PackageAudit.srtEnd(source);
        if(cues.size()<75||maxMovie<3300)
            throw new IOException(language+": original movie SRT is incomplete ("+cues.size()+" cues)");
        JSONObject srts=original.optJSONObject("narrationSrts");
        String timed=srts==null?"":srts.optString(language,"");
        if(timed.trim().startsWith("{"))timed=new JSONObject(timed).optString("srt",timed);
        JSONArray segments=WindowsProjectExport.segments(timed);
        double srtEnd=segments.getJSONObject(segments.length()-1).getDouble("end");
        if(Math.abs(audioSeconds-srtEnd)>Math.max(3, audioSeconds*.015))
            throw new IOException(language+": narration SRT differs from MP3 by "+
                String.format(Locale.ROOT,"%.2fs",Math.abs(audioSeconds-srtEnd))+
                "; remeasure SRT instead of stretching footage");
        List<Range> ranges=anchors(original,language,maxMovie);
        if(ranges.isEmpty())throw new IOException(language+": no supported scene anchors in Cloudflare export");
        // Output is exactly the MP3 duration, with no duplicated or overlapping audio time.
        int pieces=(int)Math.ceil(audioSeconds/5d);
        double nominal=audioSeconds/pieces;
        List<double[]> used=new ArrayList<>();
        JSONArray finished=new JSONArray();
        double footage=0,weak=0;
        for(int index=0;index<pieces;index++){
            double a=Math.round((index*nominal)*1000)/1000d;
            double b=index==pieces-1?Math.round(audioSeconds*1000)/1000d:
                Math.round(((index+1)*nominal)*1000)/1000d;
            double clip=b-a,mid=(a+b)/2;
            if(clip<=0||clip>CLIP_MAX+EPS)throw new IOException(language+": invalid output clip length");
            // Prefer anchors that truly cover the narration time, then scene quality.
            Range choice=null;double score=Double.POSITIVE_INFINITY;
            for(Range r:ranges){
                double distance=r.distance(mid);
                double x=distance*10 + (1-r.quality)*20;
                if(x<score){score=x;choice=r;}
            }
            if(choice==null||choice.distance(mid)>Math.max(15,audioSeconds*.055))
                throw new IOException(language+": no scene evidence around narration "+stamp(mid));
            double pos=(mid-choice.audioStart)/(choice.audioEnd-choice.audioStart);
            pos=Math.max(0,Math.min(1,pos));
            double desired=choice.sourceStart+pos*Math.max(0,choice.sourceEnd-choice.sourceStart-clip);
            double start=chooseSource(desired,clip,choice,maxMovie,cues,used);
            if(start<0)throw new IOException(language+
                ": source footage cannot be allocated without overlap near narration "+stamp(mid));
            double end=start+clip;
            used.add(new double[]{start,end});
            footage+=clip;
            if(choice.quality<.7)weak++;
            String excerpt="";
            for(int j=0;j<segments.length();j++){
                JSONObject seg=segments.getJSONObject(j);
                if(seg.getDouble("start")<=mid+EPS&&seg.getDouble("end")>=mid-EPS){
                    excerpt=seg.optString("text","");break;
                }
            }
            if(excerpt.isEmpty()){
                // A narration SRT may contain a tiny pause. Preserve continuous visuals.
                JSONObject seg=segments.getJSONObject(Math.min(segments.length()-1,
                    (int)Math.floor((double)index/pieces*segments.length())));
                excerpt=seg.optString("text","");
            }
            finished.put(new JSONObject().put("audioStart",stamp(a)).put("audioEnd",stamp(b))
                .put("movieStart",stamp(start)).put("movieEnd",stamp(end))
                .put("movieFile","CinePulse_Source.srt")
                .put("narrationExcerpt",excerpt)
                .put("confidence",choice.quality));
        }
        validate(finished,audioSeconds,maxMovie);
        String message=language+": "+finished.length()+" final timing cuts; MP3 "+
            stamp(audioSeconds)+"; source intervals non-overlapping; "+
            ranges.size()+" scene anchors; video frames NOT inspected.";
        return new Result(finished,audioSeconds,footage,ranges.size(),message);
    }
    static void validate(JSONArray cuts,double duration,double sourceEnd) throws Exception{
        if(cuts==null||cuts.length()==0)throw new IOException("No final video cuts");
        double last=0,sum=0;
        List<double[]> used=new ArrayList<>();
        for(int i=0;i<cuts.length();i++){
            JSONObject cut=cuts.getJSONObject(i);
            double a=secs(cut.optString("audioStart")),b=secs(cut.optString("audioEnd"));
            double s=secs(cut.optString("movieStart")),e=secs(cut.optString("movieEnd"));
            if(Math.abs(a-last)>EPS||b<=a||b-a>CLIP_MAX+EPS||s<0||e<=s||e>sourceEnd+EPS)
                throw new IOException("Invalid final cut chronology or source boundaries at cut "+(i+1));
            if(Math.abs((b-a)-(e-s))>EPS)
                throw new IOException("Source clip must be the same length as its narration slot");
            if(occupied(used,s,e))throw new IOException("Overlapping source footage at cut "+(i+1));
            used.add(new double[]{s,e});sum+=e-s;last=b;
        }
        if(Math.abs(last-duration)>.003||Math.abs(sum-duration)>.01)
            throw new IOException("Final cuts do not cover exactly the MP3 duration");
    }
}
