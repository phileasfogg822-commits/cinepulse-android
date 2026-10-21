package com.cinepulse.mobile;
import org.junit.Test;
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
}
