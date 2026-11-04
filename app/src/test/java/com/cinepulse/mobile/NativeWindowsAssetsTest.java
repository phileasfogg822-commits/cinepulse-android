package com.cinepulse.mobile;

import org.junit.Test;
import org.json.JSONObject;
import static org.junit.Assert.*;

public class NativeWindowsAssetsTest {
    private static final String ID="eb1333b8-ecbf-4b8a-b1f0-1a9ba75b79d6";
    private static final String EN="1\n00:00:00,000 --> 00:00:05,000\nEnglish timed narration\n\n2\n00:00:05,000 --> 00:00:10,000\nNext scene\n";
    private static final String UR="1\n00:00:00,000 --> 00:00:06,000\nاردو میں کہانی\n\n2\n00:00:06,000 --> 00:00:10,000\nمزید باتیں\n";
    private JSONObject manifest() throws Exception {
        JSONObject files=new JSONObject();
        for(int i=0;i<NativeWindowsAssets.KINDS.length;i++)
            files.put(NativeWindowsAssets.KINDS[i],new JSONObject()
                .put("filename",NativeWindowsAssets.NAMES[i]).put("bytes",120)
                .put("sha256","a".repeat(64)));
        return new JSONObject().put("format","windows_eight_verified").put("files",files);
    }
    @Test public void exactEightNativeAssetsAreMandatory() throws Exception{
        NativeWindowsAssets.validateServerManifest(manifest());
        JSONObject old=new JSONObject().put("format","legacy_three").put("files",manifest().getJSONObject("files"));
        try{NativeWindowsAssets.validateServerManifest(old);fail("Old four-file format must fail");}
        catch(java.io.IOException ok){assertTrue(ok.getMessage().contains("eight-file"));}
        JSONObject missing=manifest();
        missing.getJSONObject("files").remove("urdu_srt");
        try{NativeWindowsAssets.validateServerManifest(missing);fail("Missing Urdu SRT accepted");}
        catch(java.io.IOException ok){assertTrue(ok.getMessage().contains("incomplete"));}
        JSONObject extra=manifest();
        extra.getJSONObject("files").put("other_movie",new JSONObject());
        try{NativeWindowsAssets.validateServerManifest(extra);fail("Unexpected ninth file");}
        catch(java.io.IOException ok){assertTrue(ok.getMessage().contains("incomplete"));}
    }
    @Test public void plainAndJsonEnvelopeTimedSrtsAreHandledIdentically() throws Exception {
        assertEquals(EN,NativeWindowsAssets.measuredSrt(EN,"English"));
        assertEquals(EN,NativeWindowsAssets.measuredSrt(new JSONObject().put("format","srt").put("text",EN).toString(),"English"));
        assertEquals(UR,NativeWindowsAssets.measuredSrt(new JSONObject().put("format","srt").put("text",UR).toString(),"Urdu"));
        try{NativeWindowsAssets.measuredSrt("{\"format\":\"srt\",\"text\":\"wrong transcript\"}","English");
            fail("No timed SRT cues accepted");}
        catch(java.io.IOException ok){assertTrue(ok.getMessage().contains("no timed cues"));}
    }
    private JSONObject nativeProject() throws Exception{
        return new JSONObject().put("cloudImport",new JSONObject()
           .put("cloudProjectId",ID).put("schema","cinepulse.windows-muse.v4"))
           .put("tracks",new JSONObject()
             .put("english",new JSONObject().put("narrationSrt",EN)
               .put("cuts",new org.json.JSONArray().put(new JSONObject())))
             .put("hindiUrdu",new JSONObject().put("narrationSrt",UR)
               .put("cuts",new org.json.JSONArray().put(new JSONObject()))));
    }
    @Test public void nativeJsonMustMatchBothMeasuredSrtAssets() throws Exception {
        NativeWindowsAssets.verifyWindowsProject(nativeProject(),ID,EN,UR);
        try{NativeWindowsAssets.verifyWindowsProject(nativeProject(),ID,EN,EN);
          fail("Wrong language subtitle accepted");}
        catch(java.io.IOException ok){assertTrue(ok.getMessage().contains("differs"));}
        try{NativeWindowsAssets.verifyWindowsProject(nativeProject(),"123e4567-e89b-42d3-a456-426614174001",EN,UR);
          fail("Different movie JSON accepted");}
        catch(java.io.IOException ok){assertTrue(ok.getMessage().contains("does not match"));}
    }
    @Test public void fourOldAssetsCanNeverBeMisreportedAsEight() throws Exception {
        assertEquals(8,NativeWindowsAssets.KINDS.length);
        assertEquals(8,NativeWindowsAssets.NAMES.length);
        assertEquals("windows_project_json",NativeWindowsAssets.KINDS[0]);
        assertEquals("urdu_srt",NativeWindowsAssets.KINDS[5]);
        assertEquals("CinePulse_Urdu.srt",NativeWindowsAssets.NAMES[5]);
    }
}
