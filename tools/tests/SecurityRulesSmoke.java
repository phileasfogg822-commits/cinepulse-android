import com.cinepulse.mobile.SecurityRules;

public final class SecurityRulesSmoke {
    public static void main(String[] args) {
        String id="bf18ce48-078f-4004-9248-6fe179d0b4ef";
        String ok=SecurityRules.BASE+"/dl/"+id+"/english_mp3?exp=1760000000&sig=deadbeef";
        if (!SecurityRules.validDownloadUrl(ok,id,"english_mp3")) throw new AssertionError("expected signed URL");
        if (SecurityRules.validDownloadUrl(ok.replace("https:","http:"),id,"english_mp3")) throw new AssertionError("accepted http");
        if (SecurityRules.validDownloadUrl(ok.replace("maryumblog.workers.dev","evil.com"),id,"english_mp3")) throw new AssertionError("accepted wrong host");
        if (SecurityRules.validDownloadUrl(ok,id,"urdu_mp3")) throw new AssertionError("accepted wrong asset");
        if (!SecurityRules.validUuid(id) || SecurityRules.validUuid("../../x")) throw new AssertionError("UUID check");
        if (SecurityRules.safeFolderName("Bad:/Folder*?|<> ").contains("/")) throw new AssertionError("folder unsafe");
        System.out.println("PASS: security-policy Java smoke checks");
    }
}
