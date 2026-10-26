package com.cinepulse.mobile;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Verified Cloudflare render-project.v1 -> Windows CinePulse native ProjectState.
 * Never certifies raw cloud scene ranges as finished video cuts.
 */
final class WindowsProjectExport {
    private WindowsProjectExport(){}
    static final class Result {
        final JSONObject project;
        final String report;
        Result(JSONObject project,String report){this.project=project;this.report=report;}
    }
    private static final Pattern RANGE=Pattern.compile(
        "(?m)^(\\d{2}:\\d{2}:\\d{2}[,.]\\d{3})\\s*-->\\s*(\\d{2}:\\d{2}:\\d{2}[,.]\\d{3})\\s*$");
    private static final Pattern YEAR=Pattern.compile("(?:^|[^0-9])((?:19|20)\\d{2})(?:[^0-9]|$)");
    private static String unwrap(Object value,String field){
        if(value==null||value==JSONObject.NULL)return "";
        if(value instanceof JSONObject)return ((JSONObject)value).optString(field,"");
        String text=String.valueOf(value).trim();
        if(text.startsWith("{"))try {
            JSONObject v=new JSONObject(text);
            if(v.has(field))return v.optString(field,"");
        }catch(Exception ignored){}
        return text;
    }
    private static double seconds(String value){
        String x=value==null?"":value.replace(',','.');
        if(!x.matches("\\d{2}:\\d{2}:\\d{2}\\.\\d{3}"))return -1;
        String[] v=x.split(":");
        return Integer.parseInt(v[0])*3600d+Integer.parseInt(v[1])*60d+Double.parseDouble(v[2]);
    }
    private static String stamp(double s){
        long ms=Math.round(Math.max(0,s)*1000);
        return String.format(Locale.ROOT,"%02d:%02d:%02d.%03d",ms/3600000,(ms/60000)%60,(ms/1000)%60,ms%1000);
    }
    private static String year(String title){Matcher m=YEAR.matcher(title);return m.find()?m.group(1):"";}
    static JSONArray segments(String raw) throws Exception{
        String text=raw==null?"":raw.replace("\r\n","\n");
        Matcher matcher=RANGE.matcher(text);
        List<double[]> times=new ArrayList<>();
        List<Integer> starts=new ArrayList<>(),ends=new ArrayList<>();
        double previous=-1;
        while(matcher.find()){
            double start=seconds(matcher.group(1)),end=seconds(matcher.group(2));
            if(start<0||end<=start||start+0.2<previous)throw new IOException("Invalid/reversed narration SRT timestamps");
            times.add(new double[]{start,end});starts.add(matcher.start());ends.add(matcher.end());
            previous=end;
            if(times.size()>15000)throw new IOException("Narration SRT has too many timed cues");
        }
        if(times.isEmpty())throw new IOException("No timed narration SRT cues");
        JSONArray result=new JSONArray();
        for(int i=0;i<times.size();i++){
            String body=text.substring(ends.get(i),i+1<times.size()?starts.get(i+1):text.length())
                .replaceAll("(?m)^\\s*\\d{1,6}\\s*$","").trim();
            if(body.isEmpty())throw new IOException("Empty timed narration cue");
            result.put(new JSONObject().put("index",i+1).put("start",times.get(i)[0])
                .put("end",times.get(i)[1]).put("text",body));
        }
        return result;
    }
    private static JSONObject track(String srt,double mp3,List<String> issues,String language) throws Exception {
        JSONObject out=new JSONObject().put("mp3Path","").put("audioDurationSeconds",Math.max(0,mp3))
            .put("narrationSrt",srt).put("segments",new JSONArray()).put("cuts",new JSONArray())
            .put("status","pending").put("message","Cloud audio must be linked and verified on Windows.");
        if(srt.trim().isEmpty()){issues.add(language+": narration SRT is missing");return out;}
        try{
            JSONArray parsed=segments(srt);
            out.put("segments",parsed);
            double end=parsed.getJSONObject(parsed.length()-1).optDouble("end");
            if(mp3<=0)issues.add(language+": audio duration not measurable on Android");
            else if(Math.abs(mp3-end)>Math.max(8d,mp3*.04d))
                issues.add(language+": MP3/SRT duration mismatch: "+stamp(mp3)+" vs "+stamp(end));
        }catch(Exception ex){issues.add(language+": "+ex.getMessage());}
        return out;
    }
    private static JSONObject rawCut(JSONObject entry) throws Exception {
        double ss=entry.optDouble("sourceStartSeconds",-1),se=entry.optDouble("sourceEndSeconds",-1);
        double as=entry.optDouble("narrationStartSeconds",-1),ae=entry.optDouble("narrationEndSeconds",-1);
        if(ss<0||se<=ss||as<0||ae<=as)return null;
        return new JSONObject().put("movieStart",stamp(ss)).put("movieEnd",stamp(se))
            .put("audioStart",stamp(as)).put("audioEnd",stamp(ae))
            .put("movieFile","CinePulse_Source.srt").put("confidence",0)
            .put("narrationExcerpt","");
    }
    /** Windows native ProjectState; export only after both audio timelines and cuts pass. */
    static Result fromCloud(JSONObject cloud,double enSeconds,double urSeconds) throws Exception{
        if(!"cinepulse.render-project.v1".equals(cloud.optString("schema")))
            throw new IOException("Expected hash-verified Cloudflare movie export");
        JSONObject origin=cloud.optJSONObject("project");
        if(origin==null||!SecurityRules.validUuid(origin.optString("id")))
            throw new IOException("Cloudflare movie ID is missing or invalid");
        String title=origin.optString("title","Movie");
        String source=cloud.optString("sourceSrt","");
        if(PackageAudit.srtCueCount(source)<75||PackageAudit.srtEnd(source)<3300)
            throw new IOException("Original source SRT is incomplete. Export stopped for "+title);
        JSONObject narr=cloud.optJSONObject("narrations");
        JSONObject srts=cloud.optJSONObject("narrationSrts");
        String english=narr==null?"":unwrap(narr.opt("english"),"text");
        String urdu=narr==null?"":unwrap(narr.opt("urdu"),"text");
        String enSrt=srts==null?"":unwrap(srts.opt("english"),"srt");
        String urSrt=srts==null?"":unwrap(srts.opt("urdu"),"srt");
        if(english.length()<25||urdu.length()<25)
            throw new IOException("English and Urdu narration must both be complete before exporting");
        if(enSrt.trim().isEmpty()||urSrt.trim().isEmpty())
            throw new IOException("Both measured narration SRTs are required");
        String digest=unwrap(cloud.opt("digest"),"text");
        if(digest.length()<25)throw new IOException("Movie digest is missing or incomplete");
        JSONObject meta=cloud.optJSONObject("metadata");
        JSONArray keywords=meta==null?null:meta.optJSONArray("keywords");
        JSONArray hashtags=meta==null?null:meta.optJSONArray("hashtags");
        String description=meta==null?"":meta.optString("description","");
        if(description.trim().length()<20||keywords==null||keywords.length()==0||
            hashtags==null||hashtags.length()==0)
            throw new IOException("Publishing metadata needs a description, keywords and hashtags");
        double enRecall=PackageAudit.lexicalRecall(english,enSrt);
        double urRecall=PackageAudit.lexicalRecall(urdu,urSrt);
        if(enRecall>=0&&enRecall<.70)
            throw new IOException("English narration SRT text coverage too low ("+
                Math.round(enRecall*100)+"%); regenerate SRT before exporting");
        if(urRecall>=0&&urRecall<.45)
            throw new IOException("Urdu narration SRT text coverage too low ("+
                Math.round(urRecall*100)+"%); regenerate SRT before exporting");
        if(!(enSeconds>30)||!(urSeconds>30))
            throw new IOException("Both MP3 lengths must be measured on this phone to finalize cuts");
        List<String> issues=new ArrayList<>();
        JSONObject en=track(enSrt,enSeconds,issues,"English");
        JSONObject ur=track(urSrt,urSeconds,issues,"Urdu");
        if(!issues.isEmpty())throw new IOException("Narration timing check failed: "+String.join("; ",issues));
        FinalCutPlanner.Result enPlan=FinalCutPlanner.finalizePlan(cloud,"english",enSeconds);
        FinalCutPlanner.Result urPlan=FinalCutPlanner.finalizePlan(cloud,"urdu",urSeconds);
        en.put("cuts",enPlan.cuts).put("status","ready")
            .put("message","Narration-length, non-overlapping, subtitle-anchored cuts finalized on Android.");
        ur.put("cuts",urPlan.cuts).put("status","ready")
            .put("message","Narration-length, non-overlapping, subtitle-anchored cuts finalized on Android.");
        for(int i=0;i<2;i++){
            JSONObject lane=i==0?en:ur;
            JSONArray finalized=i==0?enPlan.cuts:urPlan.cuts;
            int total=lane.getJSONArray("segments").length();
            lane.put("sceneMatch",new JSONObject().put("signature","apk-subtitle-aligned-v1")
                .put("batchSize",5).put("totalBatches",Math.max(1,(total+4)/5))
                .put("completedBatches",Math.max(1,(total+4)/5)).put("completedSegments",total)
                .put("rawCuts",finalized).put("anchors",new JSONArray())
                .put("localResolvedSegments",total).put("aiResolvedSegments",0)
                .put("status","complete").put("lastError",""));
            // Portable sibling media names. Windows must resolve them against the imported JSON folder.
            lane.put("mp3Path",i==0?"CinePulse_English.mp3":"CinePulse_Urdu.mp3");
        }
        JSONObject analysis=new JSONObject().put("narrations",new JSONObject()
            .put("english",english).put("hindiUrdu",urdu))
            .put("metadata",new JSONObject().put("english",new JSONObject()
                .put("titles",new JSONArray().put(title)).put("description",description)
                .put("shortDescription",description.length()>150?description.substring(0,150):description)
                .put("keywords",keywords).put("hashtags",hashtags)
                .put("thumbnailIdeas",new JSONArray()).put("pinnedComment","")
                .put("categoryTags",new JSONArray())))
            .put("research",new JSONObject()
                .put("verifiedSynopsis",digest).put("characters",new JSONArray())
                .put("themes",new JSONArray()).put("contentWarnings",new JSONArray())
                .put("sources",new JSONArray()))
            .put("storyMap",new JSONArray()).put("viralMoments",new JSONArray())
            .put("hooks",new JSONArray()).put("longFormPlan",new JSONArray())
            .put("retentionBeats",new JSONArray()).put("scenePlan",new JSONArray())
            .put("audioPlan",new JSONArray()).put("shorts",new JSONArray())
            .put("viralClips",new JSONArray())
            .put("qa",new JSONObject().put("storyAccuracy",0).put("retention",0)
                .put("clarity",0).put("transformative",0).put("notes",new JSONArray()))
            .put("clarifyingQuestions",new JSONArray()).put("agentSuggestions",new JSONArray());
        JSONArray completed=new JSONArray()
            .put("source-digest").put("story-core").put("english-narration")
            .put("hindi-narration").put("publishing-metadata")
            .put("publishing-clips").put("publishing");
        JSONObject pipeline=new JSONObject().put("completed",completed)
            .put("skipped",new JSONArray().put("shorts").put("viral-clips"))
            .put("currentStep","Narration and SRT complete; subtitle-anchored long cuts finalized. Attach video to render.")
            .put("progress",95).put("sourceDigest",digest).put("movieBible",digest)
            .put("digestParts",new JSONArray().put(digest))
            .put("englishParts",new JSONArray().put(english))
            .put("hindiParts",new JSONArray().put(urdu))
            .put("hindiRecovery",new JSONObject()).put("movieMap",new JSONArray())
            .put("canonicalBlocks",new JSONArray()).put("lastError","");
        JSONObject manifest=cloud.optJSONObject("audio");
        if(manifest==null)throw new IOException("Cloud audio hash manifests missing");
        for(String lang:new String[]{"english","urdu"}){
            JSONObject mp3=manifest.optJSONObject(lang);
            if(mp3==null||mp3.optLong("bytes")<=0||
                !mp3.optString("sha256").matches("(?i)[0-9a-f]{64}"))
                throw new IOException(lang+" MP3 hash manifest missing");
        }
        JSONObject receipt=new JSONObject().put("schema","cinepulse.windows-portable.v2")
            .put("cloudProjectId",origin.optString("id"))
            .put("audio",manifest)
            .put("sceneMatchesFinalized",true).put("sourceVideoFrameVerified",false)
            .put("method","subtitle-and-cloud-scene-anchors; actual movie frames not supplied")
            .put("englishCutCount",enPlan.cuts.length())
            .put("urduCutCount",urPlan.cuts.length())
            .put("englishRuntimeSeconds",enSeconds).put("urduRuntimeSeconds",urSeconds)
            .put("sourceSrtLastTimestamp",PackageAudit.srtEnd(source))
            .put("requiredWindowsAction","Resolve MP3 sibling paths; attach original video; render");
        Matcher year=YEAR.matcher(title);
        JSONObject config=new JSONObject().put("sourceType","movie")
            .put("durationMinutes",Math.max(3,Math.min(60,origin.optInt("targetMinutes",
                (int)Math.ceil(Math.max(enSeconds,urSeconds)/60d)))))
            .put("contentGoal","Story recap").put("tone","Cinematic")
            .put("audience","General audience").put("spoilerMode","Full story")
            .put("pacing","Cinematic").put("researchDepth","Subtitle-grounded")
            .put("sceneMatchBatchSize",5).put("maxMovieClipSeconds",6)
            .put("preferredGapSeconds",0).put("shortsCount",0)
            .put("platforms",new JSONArray()).put("includeMusic",false)
            .put("includeSuspense",false).put("includeVoiceDirection",false)
            .put("includeOnScreenText",false).put("transformativeCommentary",true);
        JSONObject result=new JSONObject()
            .put("title",title).put("releaseYear",year.find()?year.group(1):"")
            .put("videoPath","")
            .put("sourceFiles",new JSONArray().put(new JSONObject()
                .put("name","CinePulse_Source.srt").put("text",source)
                .put("cues",new JSONArray())))
            .put("researchUrls",new JSONArray()).put("config",config)
            .put("analysis",analysis).put("answers",new JSONObject())
            .put("tracks",new JSONObject().put("english",en).put("hindiUrdu",ur))
            .put("pipeline",pipeline).put("shortAudioPaths",new JSONObject())
            .put("viralAudioPaths",new JSONObject()).put("cloudImport",receipt);
        String report="Windows native project created: "+title+"\n"+
            enPlan.report+"\n"+urPlan.report+"\n"+
            "Digest, narrations, SRT, and metadata present. Shorts/viral processing excluded.\n"+
            "No source ranges overlap within a language. Video frames and local Windows paths "+
            "must still be checked on the receiving computer.";
        return new Result(result,report);
    }
}
