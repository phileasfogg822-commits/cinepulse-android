package com.cinepulse.mobile;

import org.junit.Test;
import static org.junit.Assert.*;

/** Android is a passive downloader: Cloudflare produces the entire Windows package. */
public class CloudflareDownloadContractTest {
    private static final String ID="bf18ce48-078f-4004-9248-6fe179d0b4ef";
    @Test public void windowsDownloadRouteAcceptsTheExactCloudflareFormatQuery(){
        String endpoint="/v1/projects/"+ID+"/downloads?format=windows";
        assertTrue("Do not reject the eight-file Windows download before connecting",CloudApi.validApiRoute(endpoint));
        assertTrue("Existing project metadata route must still work",
                CloudApi.validApiRoute("/v1/projects/"+ID));
        assertTrue("Existing jobs route must still work",
                CloudApi.validApiRoute("/v1/jobs"));
        assertTrue("Existing jobs filter still permitted",
                CloudApi.validApiRoute("/v1/jobs?workerId="+ID));
    }
    @Test public void rejectsUnapprovedFormatAndApiRouteTampering(){
        String good="/v1/projects/"+ID+"/downloads?format=windows";
        assertFalse(CloudApi.validApiRoute(good+"&redirect=https://evil.example"));
        assertFalse(CloudApi.validApiRoute(good+"#extra"));
        assertFalse(CloudApi.validApiRoute(good.replace("format=windows","format=legacy")));
        assertFalse(CloudApi.validApiRoute(good.replace("/downloads?","/download?")));
        assertFalse(CloudApi.validApiRoute(good.replace(ID,"not-a-uuid")));
        assertFalse(CloudApi.validApiRoute(good.replace(ID,"../../admin")));
        assertFalse(CloudApi.validApiRoute(good.replace(ID,"%2e%2e")));
        assertFalse(CloudApi.validApiRoute(good.replace("format=windows","format=windows?other=1")));
        assertFalse(CloudApi.validApiRoute("/v1/jobs?workerId=../../admin"));
        assertFalse(CloudApi.validApiRoute("/v1/jobs?unexpected=1"));
        assertFalse(CloudApi.validApiRoute("https://evil.example/v1/projects/"+ID+"/downloads?format=windows"));
        assertFalse(CloudApi.validApiRoute(null));
    }
    @Test public void exactlyEightFilesAlreadyGeneratedByCloudflare(){
        String[] names=VerifiedDownloads.windowsBundleNames();
        assertArrayEquals(new String[]{
            "CinePulse_Project.json","CinePulse_Source.srt",
            "CinePulse_English.mp3","CinePulse_Urdu.mp3",
            "CinePulse_English.srt","CinePulse_Urdu.srt",
            "CinePulse_English_Narration.txt","CinePulse_Urdu_Narration.txt"
        },names);
    }
    @Test public void allSignedCloudflareAssetKindsHaveFixedDownloadNames(){
        for(String kind:new String[]{
            "windows_project_json","source_srt","english_mp3","urdu_mp3",
            "english_srt","urdu_srt","english_narration","urdu_narration"
        }){
            String name=SecurityRules.expectedName(kind);
            assertNotNull(name);
            assertFalse(name.contains("/"));
            assertFalse(name.contains("\\"));
            String url=SecurityRules.BASE+"/dl/"+ID+"/"+kind+"?exp=999&sig=abcd";
            assertTrue("Should permit "+kind,SecurityRules.validDownloadUrl(url,ID,kind));
            assertFalse(SecurityRules.validDownloadUrl(url.replace("https:","http:"),ID,kind));
            assertFalse(SecurityRules.validDownloadUrl(url.replace("maryumblog.workers.dev","evil.test"),ID,kind));
        }
    }
}
