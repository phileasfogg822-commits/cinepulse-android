package com.cinepulse.mobile;

import java.net.URI;
import java.util.Locale;
import java.util.UUID;

/** Security-critical validation independent of the Android UI and network implementation. */
public final class SecurityRules {
    private SecurityRules() {}
    public static final String BASE = "https://cinepulse-android-bridge.maryumblog.workers.dev";
    public static final int MAX_SRT_BYTES = 2 * 1024 * 1024;
    public static final long MAX_JSON_BYTES = 10L * 1024 * 1024;
    public static final long MAX_MP3_BYTES = 40L * 1024 * 1024;

    public static boolean validUuid(String candidate) {
        if (candidate == null || !candidate.matches("(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")) return false;
        try { UUID.fromString(candidate); return true; } catch (IllegalArgumentException e) { return false; }
    }
    public static String safeFolderName(String title) {
        if (title == null) title = "Movie";
        String s = title.replaceAll("[\\p{Cntrl}<>:\"/\\\\|?*]", " ").trim()
                .replaceAll("[ .]+$", "").replaceAll("\\s+", " ");
        if (s.isEmpty()) s = "Movie";
        return s.length() > 45 ? s.substring(0,45).trim() : s;
    }
    public static boolean validDownloadUrl(String url, String projectId, String kind) {
        if (!validUuid(projectId) || !kind.matches("export_json|english_mp3|urdu_mp3") || url == null) return false;
        try {
            URI uri = URI.create(url);
            URI base = URI.create(BASE);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || !base.getHost().equalsIgnoreCase(uri.getHost())) return false;
            if (uri.getUserInfo() != null || uri.getPort() != -1 || uri.getFragment() != null) return false;
            if (!uri.getRawPath().equals("/dl/" + projectId + "/" + kind)) return false;
            String q=uri.getRawQuery();
            return q != null && q.matches("(?:[A-Za-z0-9_=%-]+&)*[A-Za-z0-9_=%-]+") && q.contains("exp=") && q.contains("sig=");
        } catch (IllegalArgumentException e) { return false; }
    }
    public static String expectedName(String kind) {
        switch(kind) {
            case "export_json": return "CinePulse_Project.json";
            case "english_mp3": return "CinePulse_English.mp3";
            case "urdu_mp3": return "CinePulse_Urdu.mp3";
            default: throw new IllegalArgumentException("Unexpected asset type");
        }
    }
    public static String shortId(String id) { return id != null && id.length() >= 8 ? id.substring(0, 8).toLowerCase(Locale.ROOT) : "unknown"; }
}
