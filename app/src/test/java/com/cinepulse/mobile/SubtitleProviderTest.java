package com.cinepulse.mobile;
import org.junit.Test;
import org.json.JSONObject;
import static org.junit.Assert.*;
import java.nio.charset.StandardCharsets;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import java.io.ByteArrayOutputStream;
public class SubtitleProviderTest {
    private static String demo(){
        StringBuilder b=new StringBuilder();
        for(int i=1;i<=12;i++){
            int start=(i-1)*20,end=i*20;
            b.append(i).append("\n00:").append(String.format("%02d",start/60)).append(":")
            .append(String.format("%02d",start%60)).append(",000 --> 00:")
            .append(String.format("%02d",end/60)).append(":")
            .append(String.format("%02d",end%60)).append(",000\n")
            .append("Caption line number ").append(i).append("\n\n");
        }
        return b.toString();
    }
    @Test public void strictProviderUrls(){
        assertTrue(SubtitleProvider.validPath("/subtitle/3197651-3213944.zip"));
        assertTrue(SubtitleProvider.validPath("/subtitle/a/b"));
        assertFalse(SubtitleProvider.validPath("https://evil.example/subtitle/foo"));
        assertFalse(SubtitleProvider.validPath("/subtitle/../admin"));
        assertFalse(SubtitleProvider.validPath("/subtitle/a?token=bad"));
        assertFalse(SubtitleProvider.validPath("//evil.example/subtitle/x"));
    }
    @Test public void knownGoodSrtValidates() throws Exception {
        SubtitleProvider.Srt s=SubtitleProvider.parseBytes(demo().getBytes(StandardCharsets.UTF_8));
        assertEquals(12,s.cues);assertEquals(240,s.duration,.001);
        assertEquals(64,s.sha256.length());
    }
    @Test public void rejectSubtitleWithoutRealTimeline(){
        try {
            SubtitleProvider.parseBytes("This is not an SRT".getBytes(StandardCharsets.UTF_8));
            fail("no timeline should fail");
        }catch(Exception expected){assertNotNull(expected);}
    }
    @Test public void rejectTooManyBytes() {
        try{
            SubtitleProvider.parseBytes(new byte[SecurityRules.MAX_SRT_BYTES+1]);
            fail("oversize");}catch(Exception expected){assertNotNull(expected);}
    }
    @Test public void packedReleaseIsVisibleEvenWithoutUnpackedFiles() throws Exception {
        JSONObject response=new JSONObject().put("status",true)
          .put("results",new org.json.JSONArray().put(new JSONObject().put("name","Inception").put("year",2010)))
          .put("subtitles",new org.json.JSONArray().put(new JSONObject()
            .put("release_name","WEB-DL English")
            .put("url","/subtitle/3197651-3213944.zip")
            .put("unpack_files",new org.json.JSONArray())));
        SubtitleProvider.SearchResult result=SubtitleProvider.parseSearchResponse(response,"Inception","EN");
        assertEquals(1,result.hits.length());
        assertEquals("/subtitle/3197651-3213944.zip",result.hits.getJSONObject(0).getString("path"));
        assertEquals(1,result.subtitleRecords);
    }
    @Test public void absoluteSubdlDownloadLinksAreSafelyNormalized() throws Exception {
        assertEquals("/subtitle/3197651-3213944.zip",
            SubtitleProvider.normalizeDownloadPath("https://dl.subdl.com/subtitle/3197651-3213944.zip"));
        assertEquals("",SubtitleProvider.normalizeDownloadPath("https://evil.test/subtitle/3197651.zip"));
        assertEquals("",SubtitleProvider.normalizeDownloadPath("https://dl.subdl.com.evil.test/subtitle/3197651.zip"));
        assertEquals("",SubtitleProvider.normalizeDownloadPath("https://dl.subdl.com/subtitle/3197651.zip?token=unsafe"));
    }
    @Test public void documentedUnpackedSubtitleFileIsVisible() throws Exception {
        JSONObject file=new JSONObject().put("file_n_id","file123").put("name","Inception.English.srt")
            .put("release_name","BluRay 1080p").put("language","EN").put("hi",false)
            .put("format","srt").put("url","/subtitle/parent_n_id/file123");
        JSONObject response=new JSONObject().put("status",true)
            .put("results",new org.json.JSONArray().put(new JSONObject().put("name","Inception").put("year",2010)))
            .put("subtitles",new org.json.JSONArray().put(new JSONObject()
                .put("name","Pack.zip").put("url","/subtitle/parent_n_id.zip")
                .put("unpack_files",new org.json.JSONArray().put(file))));
        SubtitleProvider.SearchResult result=SubtitleProvider.parseSearchResponse(response,"Inception","EN");
        assertEquals(2,result.hits.length()); // Individual SRT plus original fallback ZIP
        assertEquals("/subtitle/parent_n_id/file123",result.hits.getJSONObject(0).getString("path"));
    }
    @Test public void diagnosticDistinguishesUnavailableLanguageVsFormat() throws Exception{
        JSONObject noSubtitle=new JSONObject().put("status",true)
            .put("results",new org.json.JSONArray().put(new JSONObject().put("name","Inception")))
            .put("subtitles",new org.json.JSONArray());
        SubtitleProvider.SearchResult empty=SubtitleProvider.parseSearchResponse(noSubtitle,"Inception","UR");
        assertEquals(0,empty.hits.length());
        assertTrue(empty.diagnostic.contains("no subtitles"));
        JSONObject unsupported=new JSONObject().put("status",true)
            .put("results",new org.json.JSONArray().put(new JSONObject().put("name","Inception")))
            .put("subtitles",new org.json.JSONArray().put(new JSONObject().put("language","EN")
                .put("url","/unsupported/1")));
        SubtitleProvider.SearchResult result=SubtitleProvider.parseSearchResponse(unsupported,"Inception","EN");
        assertEquals(0,result.hits.length());
        assertTrue(result.diagnostic.contains("1 subtitle record"));
        assertEquals(1,result.invalidUrls);
    }
    @Test public void parentLanguageLabelsAreTolerant() {
        assertTrue(SubtitleProvider.sameLanguage("English","EN"));
        assertTrue(SubtitleProvider.sameLanguage("eng","EN"));
        assertTrue(SubtitleProvider.sameLanguage("Urdu","UR"));
        assertFalse(SubtitleProvider.sameLanguage("Arabic","UR"));
    }

    @Test public void recoveredThirtyInceptionRecordsViaVerifiedSubtitleIds() throws Exception {
        org.json.JSONArray entries=new org.json.JSONArray();
        for(int i=0;i<30;i++){
            org.json.JSONArray inner=new org.json.JSONArray();
            inner.put(new JSONObject().put("name","Inception.Release."+i+".srt")
                .put("format","srt").put("language","EN")
                .put("url","/new-link-format/not-recognized"));
            entries.put(new JSONObject().put("n_id","SubtitleKey"+i)
                .put("release_name","Inception.WEB-DL."+i)
                .put("url","https://thirdparty.example/not-trusted.zip")
                .put("unpack_files",inner));
        }
        JSONObject response=new JSONObject().put("status",true)
            .put("results",new org.json.JSONArray().put(new JSONObject().put("name","Inception").put("year",2010)))
            .put("subtitles",entries);
        SubtitleProvider.SearchResult result=SubtitleProvider.parseSearchResponse(response,"Inception","EN");
        assertEquals(30,result.subtitleRecords);
        assertEquals(30,result.hits.length());
        assertTrue(result.hits.getJSONObject(0).getString("path").startsWith("v2:SubtitleKey"));
        assertTrue(result.diagnostic.contains("30 downloadable"));
    }
    @Test public void fallbackDoesNotTrustArbitrarySubtitleIdentifiers() throws Exception {
        JSONObject response=new JSONObject().put("status",true)
            .put("results",new org.json.JSONArray().put(new JSONObject().put("name","Inception")))
            .put("subtitles",new org.json.JSONArray().put(new JSONObject().put("n_id","../../evil")
                .put("url","https://evil.test/payload")));
        SubtitleProvider.SearchResult result=SubtitleProvider.parseSearchResponse(response,"Inception","EN");
        assertEquals(0,result.hits.length());
    }
    @Test public void allowSafelyEncodedUnicodeFilenameButDenyEncodedTraversal(){
        assertTrue(SubtitleProvider.validPath("/subtitle/film.2024.%D8%A7%D8%B1%D8%AF%D9%88.zip"));
        assertFalse(SubtitleProvider.validPath("/subtitle/%2e%2e/admin"));
        assertFalse(SubtitleProvider.validPath("/subtitle/example%2fadmin.zip"));
        assertFalse(SubtitleProvider.validPath("/subtitle/example%ZZ.zip"));
    }

}
