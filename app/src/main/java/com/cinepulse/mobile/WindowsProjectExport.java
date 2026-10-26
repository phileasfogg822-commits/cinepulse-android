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
    static Result fromCloud(JSONObject cloud,double enSeconds,double urSeconds) throws Exception{
        if(!"cinepulse.render-project.v1".equals(cloud.optString("schema")))
            throw new IOException("Expected verified cinepulse.render-project.v1 export");
        JSONObject origin=cloud.optJSONObject("project");
        if(origin==null||!SecurityRules.validUuid(origin.optString("id")))
            throw new IOException("Cloudflare project identity is missing");
        String source=cloud.optString("sourceSrt","");
        if(source.length()<20||!source.contains("-->"))throw new IOException("Original movie SRT missing");
        String title=origin.optString("title","Movie");
        JSONObject narr=cloud.optJSONObject("narrations"),srts=cloud.optJSONObject("narrationSrts");
        String english=narr==null?"":unwrap(narr.opt("english"),"text");
        String urdu=narr==null?"":unwrap(narr.opt("urdu"),"text");
        String enSrt=srts==null?"":unwrap(srts.opt("english"),"srt");
        String urSrt=srts==null?"":unwrap(srts.opt("urdu"),"srt");
        List<String> issues=new ArrayList<>();
        int sourceCues=PackageAudit.srtCueCount(source);
        double sourceEnd=PackageAudit.srtEnd(source);
        if(sourceCues<75||sourceEnd<3300)
            issues.add("Original movie SRT appears incomplete: "+sourceCues+" cues, last timestamp "+stamp(sourceEnd));
        JSONObject en=track(enSrt,enSeconds,issues,"English"),ur=track(urSrt,urSeconds,issues,"Urdu");
        double enRecall=PackageAudit.lexicalRecall(english,enSrt);
        double urRecall=PackageAudit.lexicalRecall(urdu,urSrt);
        if(enRecall>=0&&enRecall<0.70)
            issues.add("English narration/SRT text agreement below 70%: "+Math.round(100*enRecall)+"%");
        if(urRecall>=0&&urRecall<0.45)
            issues.add("Urdu narration/SRT text agreement below 45%: "+Math.round(100*urRecall)+"%");
        if(english.length()<25)issues.add("English narration missing");
        if(urdu.length()<25)issues.add("Urdu narration missing");
        JSONObject meta=cloud.optJSONObject("metadata");
        JSONArray keywords=meta==null?null:meta.optJSONArray("keywords");
        JSONArray hashtags=meta==null?null:meta.optJSONArray("hashtags");
        String description=meta==null?"":meta.optString("description","");
        boolean hasMetadata=description.length()>=20&&keywords!=null&&keywords.length()>0;
        if(!hasMetadata)issues.add("Publishing metadata missing");
        String digest=unwrap(cloud.opt("digest"),"text");
        JSONArray completed=new JSONArray();
        if(!digest.isEmpty()){completed.put("source-digest");completed.put("story-core");}
        else issues.add("Story digest missing");
        if(english.length()>25)completed.put("english-narration");
        if(urdu.length()>25)completed.put("hindi-narration");
        if(hasMetadata)completed.put("publishing-metadata");
        if(cloud.optJSONArray("viralScenes")!=null&&cloud.optJSONArray("viralScenes").length()>0)
            completed.put("viral-plan");
        JSONObject analysis=new JSONObject().put("narrations",new JSONObject()
            .put("english",english).put("hindiUrdu",urdu))
            .put("metadata",new JSONObject().put("english",new JSONObject()
                .put("title",title).put("description",description)
                .put("keywords",keywords==null?new JSONArray():keywords)
                .put("hashtags",hashtags==null?new JSONArray():hashtags)))
            .put("research",new JSONObject()).put("storyMap",new JSONArray())
            .put("viralMoments",new JSONArray()).put("hooks",new JSONArray())
            .put("longFormPlan",new JSONArray()).put("retentionBeats",new JSONArray())
            .put("scenePlan",new JSONArray()).put("audioPlan",new JSONArray())
            .put("shorts",new JSONArray()).put("viralClips",new JSONArray())
            .put("qa",new JSONObject()).put("clarifyingQuestions",new JSONArray())
            .put("agentSuggestions",new JSONArray());
        JSONArray enRaw=new JSONArray(),urRaw=new JSONArray(),plan=cloud.optJSONArray("cutPlan");
        if(plan!=null)for(int i=0;i<plan.length();i++){
            JSONObject record=plan.optJSONObject(i);if(record==null)continue;
            JSONObject candidate=rawCut(record);if(candidate==null)continue;
            if("english".equalsIgnoreCase(record.optString("language")))enRaw.put(candidate);
            else if("urdu".equalsIgnoreCase(record.optString("language")))urRaw.put(candidate);
        }
        for(int i=0;i<2;i++){
            JSONObject track=i==0?en:ur;
            JSONArray raw=i==0?enRaw:urRaw;
            int total=track.getJSONArray("segments").length();
            track.put("sceneMatch",new JSONObject().put("signature","cloud-import-unverified")
                .put("batchSize",5).put("totalBatches",Math.max(1,(total+4)/5))
                .put("completedBatches",0).put("completedSegments",0)
                .put("rawCuts",raw).put("anchors",new JSONArray())
                .put("localResolvedSegments",0).put("aiResolvedSegments",0)
                .put("status","paused").put("lastError",
                    "Cloud source matches preserved, not finalized. Match to attached Windows movie footage."));
        }
        if(enRaw.length()==0)issues.add("No English raw scene matches");
        if(urRaw.length()==0)issues.add("No Urdu raw scene matches");
        JSONObject audio=cloud.optJSONObject("audio");
        JSONObject portable=new JSONObject().put("schema","cinepulse.windows-portable.v1")
            .put("cloudProjectId",origin.optString("id"))
            .put("audio",audio==null?new JSONObject():audio)
            .put("sceneMatchesFinalized",false).put("issues",new JSONArray(issues));
        JSONObject config=new JSONObject().put("sourceType","movie")
            .put("durationMinutes",Math.max(3,Math.min(60,origin.optInt("targetMinutes",
                (int)Math.ceil(Math.max(enSeconds,urSeconds)/60d)))))
            .put("contentGoal","Story recap + review").put("tone","Cinematic")
            .put("sceneMatchBatchSize",5).put("maxMovieClipSeconds",6)
            .put("preferredGapSeconds",1).put("shortsCount",0)
            .put("transformativeCommentary",true);
        Matcher year=YEAR.matcher(title);
        JSONObject result=new JSONObject().put("title",title).put("releaseYear",year.find()?year.group(1):"")
            .put("videoPath","")
            .put("sourceFiles",new JSONArray().put(new JSONObject()
                .put("name","CinePulse_Source.srt").put("text",source).put("cues",new JSONArray())))
            .put("researchUrls",new JSONArray()).put("config",config)
            .put("analysis",analysis).put("answers",new JSONObject())
            .put("tracks",new JSONObject().put("english",en).put("hindiUrdu",ur))
            .put("pipeline",new JSONObject().put("completed",completed).put("skipped",new JSONArray())
                .put("currentStep","Cloud import — verify MP3s, SRTs and finalize movie matching")
                .put("progress",75).put("sourceDigest",digest).put("movieBible",digest)
                .put("digestParts",new JSONArray().put(digest))
                .put("englishParts",new JSONArray().put(english))
                .put("hindiParts",new JSONArray().put(urdu))
                .put("hindiRecovery",new JSONObject()).put("movieMap",new JSONArray())
                .put("canonicalBlocks",new JSONArray()).put("lastError",""))
            .put("shortAudioPaths",new JSONObject()).put("viralAudioPaths",new JSONObject())
            .put("cloudImport",portable);
        StringBuilder report=new StringBuilder("CinePulse portable Windows import verification\nMovie: ")
            .append(title).append("\nCloud ID: ").append(origin.optString("id"))
            .append("\nEnglish SRT blocks: ").append(en.getJSONArray("segments").length())
            .append("; MP3 seconds: ").append(enSeconds)
            .append("\nUrdu SRT blocks: ").append(ur.getJSONArray("segments").length())
            .append("; MP3 seconds: ").append(urSeconds)
            .append("\nRaw scene matches (not final cuts): EN ").append(enRaw.length())
            .append(", UR ").append(urRaw.length())
            .append("\nFinished cuts: 0 (never invent source footage)\n");
        for(String issue:issues)report.append("REVIEW: ").append(issue).append('\n');
        report.append("Run Prepare_For_Windows.bat to hash-link both MP3s, then import Windows_Ready.json. ")
            .append("Attach the original movie and finalize scene matching before rendering.\n");
        return new Result(result,report.toString());
    }
}
