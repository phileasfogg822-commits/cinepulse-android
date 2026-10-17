package com.cinepulse.mobile;

import org.junit.Test;
import static org.junit.Assert.*;

public class SecurityRulesTest {
    private final String id="bf18ce48-078f-4004-9248-6fe179d0b4ef";
    @Test public void rejectsFakeId(){assertFalse(SecurityRules.validUuid("../../admin"));assertTrue(SecurityRules.validUuid(id));}
    @Test public void acceptsOnlyExactCloudflareSignedDownloads(){
        String good=SecurityRules.BASE+"/dl/"+id+"/english_mp3?exp=123&sig=123abc";
        assertTrue(SecurityRules.validDownloadUrl(good,id,"english_mp3"));
        assertFalse(SecurityRules.validDownloadUrl(good.replace("https:","http:"),id,"english_mp3"));
        assertFalse(SecurityRules.validDownloadUrl(good.replace("maryumblog.workers.dev","evil.test"),id,"english_mp3"));
        assertFalse(SecurityRules.validDownloadUrl(good,id,"urdu_mp3"));
        assertFalse(SecurityRules.validDownloadUrl(good.replace("/dl/","/redirect/"),id,"english_mp3"));
        assertFalse(SecurityRules.validDownloadUrl("https://attacker.test/dl/"+id+"/english_mp3?exp=1&sig=1",id,"english_mp3"));
    }
    @Test public void stripsTraversalAndReservedFilenameCharacters(){
        String v=SecurityRules.safeFolderName("../bad:<movie>|?*");
        assertFalse(v.contains("/"));assertFalse(v.contains("\\"));assertFalse(v.contains("<"));
        assertTrue(v.length()<=45);
    }
    @Test public void fixedAssetNamesPreventPathInjection(){
        assertEquals("CinePulse_Project.json",SecurityRules.expectedName("export_json"));
        assertEquals("CinePulse_English.mp3",SecurityRules.expectedName("english_mp3"));
        assertEquals("CinePulse_Urdu.mp3",SecurityRules.expectedName("urdu_mp3"));
    }
}
