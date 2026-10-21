package com.cinepulse.mobile;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;
public class PackageAuditTest {
    private JSONObject fixture() throws Exception {
        return new JSONObject().put("schema","cinepulse.render-project.v1")
          .put("project",new JSONObject().put("id","b6d64b7d-36d6-4f3c-aba7-b99ab9c2b118").put("title","Test"))
          .put("metadata",new JSONObject().put("description","A carefully written sample movie description.")
             .put("keywords",new org.json.JSONArray("[\"movie\"]"))
             .put("hashtags",new org.json.JSONArray("[\"#movie\"]")))
          .put("narrations",new JSONObject().put("english",new JSONObject().put("text","Hello wonderful world, this is a long narrated English movie script with accurate captions."))
             .put("urdu",new JSONObject().put("text","ایک بہت لمبی اردو فلم کی کہانی یہاں مکمل ہے اور اس کے الفاظ درست ہیں")))
          .put("narrationSrts",new JSONObject().put("english",new JSONObject().put("srt","1\n00:00:00,000 --> 00:00:10,000\nHello wonderful world, this is a long narrated English movie script with accurate captions.\n"))
             .put("urdu",new JSONObject().put("srt","1\n00:00:00,000 --> 00:00:10,000\nایک بہت لمبی اردو فلم کی کہانی یہاں مکمل ہے اور اس کے الفاظ درست ہیں\n")))
          .put("audio",new JSONObject().put("english",new JSONObject().put("bytes",65536L).put("sha256",repeat("a",64)))
             .put("urdu",new JSONObject().put("bytes",65536L).put("sha256",repeat("b",64))))
          .put("cutPlan",new org.json.JSONArray().put(new JSONObject().put("language","english")
             .put("sourceStartSeconds",1).put("sourceEndSeconds",11)
             .put("narrationStartSeconds",0).put("narrationEndSeconds",10))
             .put(new JSONObject().put("language","urdu")
             .put("sourceStartSeconds",1).put("sourceEndSeconds",11)
             .put("narrationStartSeconds",0).put("narrationEndSeconds",10)));
    }
    private static String repeat(String s,int count){StringBuilder b=new StringBuilder();for(int i=0;i<count;i++)b.append(s);return b.toString();}
    @Test public void healthyTimingsPassStructure() throws Exception {
        PackageAudit.Result r=PackageAudit.inspect(fixture(),10.1,9.9);
        assertTrue(r.structuralPass);assertEquals(1,r.englishCuts);assertEquals(1,r.urduCuts);
        assertTrue(r.report.contains("Audio speech-content"));
    }
    @Test public void longRawMovieCutsNeedRematching() throws Exception{
        JSONObject p=fixture();
        p.getJSONArray("cutPlan").getJSONObject(0).put("sourceEndSeconds",180.0);
        PackageAudit.Result r=PackageAudit.inspect(p,10,10);
        assertTrue(r.report.contains("SOURCE MATCHES ONLY"));
    }
    @Test public void emptyCutPlanIsFailure() throws Exception {
        JSONObject p=fixture();p.put("cutPlan",new org.json.JSONArray());
        assertFalse(PackageAudit.inspect(p,10,10).structuralPass);
    }
    @Test public void detectMp3Mismatch() throws Exception{
        PackageAudit.Result r=PackageAudit.inspect(fixture(),40,10);
        assertFalse(r.structuralPass);
        assertTrue(r.report.contains("WARNING duration mismatch"));
    }
    @Test public void encodedSubtitleObjectParses() {
        assertEquals(10.0,PackageAudit.srtEnd("{\"srt\":\"1\\n00:00:00,000 --> 00:00:10,000\\nHi\n\"}"),0.01);
    }
}
