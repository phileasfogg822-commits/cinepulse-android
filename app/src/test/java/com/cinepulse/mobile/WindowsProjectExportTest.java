package com.cinepulse.mobile;

import org.junit.Test;
import org.json.JSONArray;
import org.json.JSONObject;
import static org.junit.Assert.*;

/** Regression tests for exported Windows-native import contract. */
public class WindowsProjectExportTest {
    private static final String PROJECT_ID="123e4567-e89b-42d3-a456-426614174001";
    private static String srt(String language){
        return "1\n00:00:00,000 --> 00:00:04,000\n"+language+" narration one\n\n"+
               "2\n00:00:04,000 --> 00:00:08,000\n"+language+" narration two\n\n"+
               "3\n00:00:08,000 --> 00:00:12,000\n"+language+" narration three\n";
    }
    private static JSONObject cloud() throws Exception {
        JSONObject narration=new JSONObject().put("text","A complete narration story with enough text to be a realistic summary.");
        JSONObject metadata=new JSONObject().put("description","A cinematic recap for a full feature movie.")
            .put("keywords",new JSONArray().put("film recap")).put("hashtags",new JSONArray().put("#Film"));
        JSONObject cut=new JSONObject().put("sourceStartSeconds",200)
            .put("sourceEndSeconds",2300).put("narrationStartSeconds",0)
            .put("narrationEndSeconds",8).put("language","english");
        JSONObject cloud=new JSONObject().put("schema","cinepulse.render-project.v1")
            .put("project",new JSONObject().put("id",PROJECT_ID)
                .put("title","A.Minecraft.Movie.2025.1080p").put("targetMinutes",8))
            .put("sourceSrt","1\n00:00:00,000 --> 00:00:05,000\nMovie dialogue\n")
            .put("digest",new JSONObject().put("text","The story begins with adventure and continues."))
            .put("narrations",new JSONObject().put("english",narration.toString())
                .put("urdu",new JSONObject().put("text","ایک مکمل فلم کی کہانی اور راوی کا بیان").toString()))
            .put("narrationSrts",new JSONObject().put("english",new JSONObject().put("srt",srt("English")).toString())
                .put("urdu",new JSONObject().put("srt",srt("Urdu")).toString()))
            .put("cutPlan",new JSONArray().put(cut))
            .put("metadata",metadata)
            .put("audio",new JSONObject().put("english",new JSONObject()
                 .put("filename","CinePulse_English.mp3").put("bytes",100)
                 .put("sha256","aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"))
                .put("urdu",new JSONObject().put("filename","CinePulse_Urdu.mp3").put("bytes",100)
                 .put("sha256","bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")));
        return cloud;
    }
    @Test public void convertsRawCloudJsonIntoNativeWindowsProject() throws Exception {
        WindowsProjectExport.Result result=WindowsProjectExport.fromCloud(cloud(),12,12);
        JSONObject nativeProject=result.project;
        assertEquals("A.Minecraft.Movie.2025.1080p",nativeProject.getString("title"));
        assertEquals("2025",nativeProject.getString("releaseYear"));
        assertEquals("",nativeProject.getString("videoPath"));
        assertEquals(1,nativeProject.getJSONArray("sourceFiles").length());
        assertEquals(3,nativeProject.getJSONObject("tracks").getJSONObject("english").getJSONArray("segments").length());
        assertEquals(3,nativeProject.getJSONObject("tracks").getJSONObject("hindiUrdu").getJSONArray("segments").length());
        assertEquals("A complete narration story with enough text to be a realistic summary.",
            nativeProject.getJSONObject("analysis").getJSONObject("narrations").getString("english"));
        assertEquals(PROJECT_ID,nativeProject.getJSONObject("cloudImport").getString("cloudProjectId"));
        assertEquals("cinepulse.windows-portable.v1",nativeProject.getJSONObject("cloudImport").getString("schema"));
        assertTrue(nativeProject.getJSONObject("pipeline").getJSONArray("completed").toString().contains("publishing-metadata"));
    }
    @Test public void doesNotPromoteTwoThousandSecondMovieCutToFinalVideo() throws Exception{
        JSONObject en=WindowsProjectExport.fromCloud(cloud(),12,12).project.getJSONObject("tracks").getJSONObject("english");
        assertEquals(0,en.getJSONArray("cuts").length());
        assertEquals(1,en.getJSONObject("sceneMatch").getJSONArray("rawCuts").length());
        assertEquals("paused",en.getJSONObject("sceneMatch").getString("status"));
        assertEquals(0,en.getJSONObject("sceneMatch").getInt("completedBatches"));
        assertEquals("cloud-import-unverified",en.getJSONObject("sceneMatch").getString("signature"));
    }
    @Test public void detectsAudioDurationMismatchAndPreservesSrtTimings() throws Exception{
        WindowsProjectExport.Result result=WindowsProjectExport.fromCloud(cloud(),35,12);
        assertTrue(result.report.contains("MP3/SRT duration mismatch"));
        JSONObject segment=result.project.getJSONObject("tracks").getJSONObject("english")
            .getJSONArray("segments").getJSONObject(2);
        assertEquals(12.0,segment.getDouble("end"),0.001);
        assertEquals("English narration three",segment.getString("text"));
    }
    @Test public void invalidSchemaOrProjectIdentityIsRejected() throws Exception{
        JSONObject c=cloud();
        c.put("schema","other");
        try {WindowsProjectExport.fromCloud(c,12,12);fail("Unsafe schema accepted");}
        catch(java.io.IOException expected){}
        c.put("schema","cinepulse.render-project.v1");
        c.getJSONObject("project").put("id","not-a-uuid");
        try {WindowsProjectExport.fromCloud(c,12,12);fail("Invalid cloud identity accepted");}
        catch(java.io.IOException expected){}
    }
    @Test public void localWindowsPreparationRequiresSha256ManifestAndDoesNotCallNetwork(){
        String js=WindowsPackageBootstrap.js();
        assertTrue(js.contains("sha256"));
        assertTrue(js.contains("CinePulse_Windows_Ready.json"));
        assertFalse(js.contains("https://"));
    }
    @Test public void emptySrtAndBadRangesNeverBecomeReady() throws Exception{
        JSONObject c=cloud();
        c.getJSONObject("narrationSrts").put("english",new JSONObject().put("srt","").toString());
        WindowsProjectExport.Result result=WindowsProjectExport.fromCloud(c,12,12);
        assertEquals(0,result.project.getJSONObject("tracks").getJSONObject("english").getJSONArray("segments").length());
        assertTrue(result.report.contains("English: narration SRT is missing"));
        try {WindowsProjectExport.segments("1\n00:00:09,000 --> 00:00:04,000\nBad");
            fail("Reversed timestamp accepted");
        }catch(java.io.IOException expected){}
    }
}
