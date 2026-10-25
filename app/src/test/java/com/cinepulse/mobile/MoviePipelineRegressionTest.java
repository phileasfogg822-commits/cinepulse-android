package com.cinepulse.mobile;

import org.junit.Test;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import static org.junit.Assert.*;

public class MoviePipelineRegressionTest {
    private static String srt(int cues,int minutes){
        StringBuilder s=new StringBuilder();
        for(int i=0;i<cues;i++){
            int begin=(i*minutes*60)/cues;
            int end=begin+3;
            s.append(i+1).append("\n")
                .append(String.format(java.util.Locale.ROOT,"%02d:%02d:%02d,000",begin/3600,(begin/60)%60,begin%60))
                .append(" --> ")
                .append(String.format(java.util.Locale.ROOT,"%02d:%02d:%02d,000",end/3600,(end/60)%60,end%60))
                .append("\nAn English subtitle dialogue cue ").append(i+1).append("\n\n");
        }
        return s.toString();
    }
    @Test public void eightCueArrivalIsRejected() throws Exception {
        SubtitleProvider.Srt bad=SubtitleProvider.parseBytes(srt(8,90).getBytes(StandardCharsets.UTF_8));
        assertFalse(SubtitleQuality.assess(bad,0).complete);
    }
    @Test public void fullLengthSubtitleIsAccepted() throws Exception {
        SubtitleProvider.Srt good=SubtitleProvider.parseBytes(srt(950,105).getBytes(StandardCharsets.UTF_8));
        assertTrue(SubtitleQuality.assess(good,108).complete);
    }
    @Test public void truncatedSubtitleRejectedForKnownMovieRuntime() throws Exception {
        SubtitleProvider.Srt shortRelease=SubtitleProvider.parseBytes(srt(700,65).getBytes(StandardCharsets.UTF_8));
        assertFalse(SubtitleQuality.assess(shortRelease,120).complete);
    }
    @Test public void lowDialogueFeatureCanPassIfTimelineIsComplete() throws Exception {
        SubtitleProvider.Srt quiet=SubtitleProvider.parseBytes(srt(85,95).getBytes(StandardCharsets.UTF_8));
        assertTrue(SubtitleQuality.assess(quiet,95).complete);
    }
    @Test public void yearAndTitleIdentityPreventsDuplicateReleaseButAllowsRemake() {
        assertTrue(MovieIdentity.sameMovie("The Terminal (2004)","The.Terminal"));
        assertTrue(MovieIdentity.sameMovie("Inside Out (2015)","INSIDE OUT (2015)"));
        assertFalse(MovieIdentity.sameMovie("The Secret Garden (1993)","The Secret Garden (2020)"));
        assertFalse(MovieIdentity.sameMovie("The Terminal","Arrival"));
    }
    private static final String ID_A="123e4567-e89b-42d3-a456-426614174001";
    private static final String ID_B="123e4567-e89b-42d3-a456-426614174002";
    @Test public void acceptsNestedCloudflareCreationReceipts() throws Exception{
        JSONObject nested=new JSONObject().put("data",new JSONObject().put("project",new JSONObject().put("id",ID_A)));
        assertEquals(ID_A,CloudProjectReceipt.confirmedId(nested));
        assertEquals(ID_B,CloudProjectReceipt.confirmedId(new JSONObject().put("project_id",ID_B)));
        assertEquals("",CloudProjectReceipt.confirmedId(new JSONObject().put("success",false).put("id",ID_A)));
        assertEquals("",CloudProjectReceipt.confirmedId(new JSONObject().put("id","not-a-uuid")));
    }
    @Test public void onlyUniqueServerMovieMatchesCanBeReconciled() throws Exception{
        JSONArray list=new JSONArray().put(new JSONObject().put("title","Arrival (2016)").put("id",ID_A));
        assertEquals(ID_A,CloudProjectReceipt.matchingProjectId(list,"Arrival (2016)"));
        assertEquals("",CloudProjectReceipt.matchingProjectId(list,"The Terminal (2004)"));
        list.put(new JSONObject().put("title","Arrival (2016)").put("id",ID_B));
        assertEquals("",CloudProjectReceipt.matchingProjectId(list,"Arrival (2016)"));
        assertEquals(2,CloudProjectReceipt.matchingCount(list,"Arrival (2016)"));
    }
    @Test public void bestZipSubtitleIgnoresWrongLanguageFirst() throws Exception{
        ByteArrayOutputStream bytes=new ByteArrayOutputStream();
        try(ZipOutputStream z=new ZipOutputStream(bytes)){
            z.putNextEntry(new ZipEntry("release.urdu.srt"));
            z.write(srt(850,95).getBytes(StandardCharsets.UTF_8));z.closeEntry();
            z.putNextEntry(new ZipEntry("release.english.srt"));
            z.write(srt(900,100).getBytes(StandardCharsets.UTF_8));z.closeEntry();
        }
        SubtitleProvider.Srt result=SubtitleProvider.bestSrtFromZip(bytes.toByteArray(),"EN");
        assertEquals(900,result.cues);
        assertTrue(SubtitleQuality.assess(result,105).complete);
    }
}
