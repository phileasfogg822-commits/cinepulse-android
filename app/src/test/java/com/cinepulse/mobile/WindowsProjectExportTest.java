package com.cinepulse.mobile;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import java.io.IOException;
import java.util.Locale;
import static org.junit.Assert.*;

/** Checks complete dual-language Windows output and strict failure on missing footage. */
public class WindowsProjectExportTest {
    private static final String ID="123e4567-e89b-42d3-a456-426614174001";
    private static String stamp(double sec){
        long ms=Math.round(sec*1000);
        return String.format(Locale.ROOT,"%02d:%02d:%02d,%03d",ms/3600000,
            (ms/60000)%60,(ms/1000)%60,ms%1000);
    }
    private static String srt(int count,double seconds){
        StringBuilder b=new StringBuilder();
        for(int i=0;i<count;i++){
            double start=i*seconds/count,end=(i+1)*seconds/count;
            b.append(i+1).append('\n').append(stamp(start)).append(" --> ")
                .append(stamp(end)).append("\nHero begins the story narration about the movie\n\n");
        }
        return b.toString();
    }
    private static JSONObject cloud() throws Exception{
        JSONArray plans=new JSONArray();
        for(String language:new String[]{"english","urdu"}){
            for(int i=0;i<4;i++)plans.put(new JSONObject()
                .put("language",language).put("narrationStartSeconds",i*22.5)
                .put("narrationEndSeconds",(i+1)*22.5)
                .put("sourceStartSeconds",150+i*450).put("sourceEndSeconds",550+i*450));
        }
        String narration="Hero begins the story narration about the movie. ".repeat(30);
        return new JSONObject().put("schema","cinepulse.render-project.v1")
            .put("project",new JSONObject().put("id",ID).put("title","A.Minecraft.Movie.2025")
                .put("targetMinutes",5))
            .put("sourceSrt",srt(700,6800))
            .put("digest",new JSONObject().put("text","This film follows the story of a hero on a substantial adventure."))
            .put("narrations",new JSONObject().put("english",new JSONObject().put("text",narration).toString())
                .put("urdu",new JSONObject().put("text",narration).toString()))
            .put("narrationSrts",new JSONObject().put("english",new JSONObject().put("srt",srt(30,90)).toString())
                .put("urdu",new JSONObject().put("srt",srt(30,90)).toString()))
            .put("cutPlan",plans)
            .put("metadata",new JSONObject().put("description",
                "An adventurous tale of a hero and a fantastic world.")
                .put("keywords",new JSONArray().put("cinematic movie recap"))
                .put("hashtags",new JSONArray().put("#Cinema")))
            .put("audio",new JSONObject()
                .put("english",new JSONObject().put("filename","CinePulse_English.mp3")
                    .put("bytes",100).put("sha256","a".repeat(64)))
                .put("urdu",new JSONObject().put("filename","CinePulse_Urdu.mp3")
                    .put("bytes",100).put("sha256","b".repeat(64))))
            .put("viralScenes",new JSONArray().put(new JSONObject().put("title","ignore me")));
    }
    @Test public void makesWindowsNativeProjectWithFinalCutsInBothTracks() throws Exception{
        WindowsProjectExport.Result result=WindowsProjectExport.fromCloud(cloud(),90,90);
        JSONObject p=result.project;
        assertEquals("A.Minecraft.Movie.2025",p.getString("title"));
        assertEquals("2025",p.getString("releaseYear"));
        assertEquals("",p.getString("videoPath"));
        JSONObject tracks=p.getJSONObject("tracks");
        for(String lang:new String[]{"english","hindiUrdu"}){
            JSONObject track=tracks.getJSONObject(lang);
            JSONArray cuts=track.getJSONArray("cuts");
            assertTrue(cuts.length()>=15);
            FinalCutPlanner.validate(cuts,90,6800);
            assertEquals("complete",track.getJSONObject("sceneMatch").getString("status"));
            assertEquals(track.getJSONArray("segments").length(),
                track.getJSONObject("sceneMatch").getInt("completedSegments"));
        }
        assertEquals(ID,p.getJSONObject("cloudImport").getString("cloudProjectId"));
        assertTrue(p.getJSONObject("cloudImport").getBoolean("sceneMatchesFinalized"));
        assertFalse(p.getJSONObject("cloudImport").getBoolean("sourceVideoFrameVerified"));
        assertEquals(0,p.getJSONObject("analysis").getJSONArray("shorts").length());
        assertEquals(0,p.getJSONObject("analysis").getJSONArray("viralClips").length());
        assertTrue(p.getJSONObject("pipeline").getJSONArray("completed").toString().contains("publishing-metadata"));
        assertEquals("CinePulse_English.mp3",tracks.getJSONObject("english").getString("mp3Path"));
    }
    @Test public void noOverlapAndExactMp3RuntimeEvenWhenSourceRangesAreLong() throws Exception{
        JSONObject p=cloud();
        WindowsProjectExport.Result result=WindowsProjectExport.fromCloud(p,90,90);
        JSONArray cuts=result.project.getJSONObject("tracks").getJSONObject("english").getJSONArray("cuts");
        double sum=0;
        for(int i=0;i<cuts.length();i++){
            JSONObject cut=cuts.getJSONObject(i);
            double size=FinalCutPlanner.secs(cut.getString("movieEnd"))-
                FinalCutPlanner.secs(cut.getString("movieStart"));
            sum+=size;assertTrue("clip >6s",size<=6.003);
            assertTrue("broad scene window must carry downgraded confidence",cut.getDouble("confidence")<=0.65);
        }
        assertEquals(90,sum,.02);
    }
    @Test public void refusesToFinalizeWhenUrduAnchorsAreMissing() throws Exception{
        JSONObject c=cloud();JSONArray onlyEnglish=new JSONArray();
        for(int i=0;i<c.getJSONArray("cutPlan").length();i++){
            JSONObject v=c.getJSONArray("cutPlan").getJSONObject(i);
            if("english".equals(v.getString("language")))onlyEnglish.put(v);
        }
        c.put("cutPlan",onlyEnglish);
        try{WindowsProjectExport.fromCloud(c,90,90);fail("Created missing Urdu cuts");}
        catch(IOException expected){assertTrue(expected.getMessage().contains("urdu"));}
    }
    @Test public void refusesIncompleteSrtAndAudioMismatch() throws Exception{
        JSONObject c=cloud();
        c.put("sourceSrt",srt(8,4000));
        try{WindowsProjectExport.fromCloud(c,90,90);fail("Incomplete source SRT accepted");}
        catch(IOException expected){assertTrue(expected.getMessage().contains("incomplete"));}
        c=cloud();
        try{WindowsProjectExport.fromCloud(c,40,90);fail("Audio mismatch accepted");}
        catch(IOException expected){assertTrue(expected.getMessage().contains("English"));}
    }
    @Test public void refusesMalformedProjectMetadataOrIdentity() throws Exception{
        JSONObject c=cloud();c.put("schema","unsafe");
        try{WindowsProjectExport.fromCloud(c,90,90);fail();}
        catch(IOException expected){}
        c=cloud();c.getJSONObject("project").put("id","bad");
        try{WindowsProjectExport.fromCloud(c,90,90);fail();}
        catch(IOException expected){}
        c=cloud();c.getJSONObject("metadata").put("keywords",new JSONArray());
        try{WindowsProjectExport.fromCloud(c,90,90);fail();}
        catch(IOException expected){assertTrue(expected.getMessage().contains("metadata"));}
    }
    @Test public void hasExactlyEightFilesWithOneNativeJson(){
        String[] names=VerifiedDownloads.windowsBundleNames();
        assertEquals(8,names.length);
        assertEquals("CinePulse_Project.json",names[0]);
        assertEquals("CinePulse_English.mp3",names[2]);
        assertEquals("CinePulse_Urdu.mp3",names[3]);
        assertEquals("CinePulse_English_Narration.txt",names[6]);
        assertEquals("CinePulse_Urdu_Narration.txt",names[7]);
    }
}
