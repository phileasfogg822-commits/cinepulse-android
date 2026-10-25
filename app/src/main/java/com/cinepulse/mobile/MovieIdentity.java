package com.cinepulse.mobile;

import java.util.Locale;

/** Stable local identity for one movie; different releases of the same film are not different movies. */
final class MovieIdentity {
    private MovieIdentity(){}
    static String baseTitle(String title){
        if(title==null)return "";
        return title.trim().replaceFirst("\\s*\\((?:19|20)\\d{2}\\)\\s*$","")
            .toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}]+"," ").trim()
            .replaceAll("\\s+"," ");
    }
    static String year(String title){
        if(title==null)return "";
        java.util.regex.Matcher m=java.util.regex.Pattern.compile("\\(((?:19|20)\\d{2})\\)\\s*$").matcher(title.trim());
        return m.find()?m.group(1):"";
    }
    static String key(String title){return baseTitle(title)+"|"+year(title);}
    /** Conservative: an unknown-year entry conflicts with a known-year title. */
    static boolean sameMovie(String first,String second){
        if(!baseTitle(first).equals(baseTitle(second)))return false;
        String a=year(first),b=year(second);
        return a.isEmpty()||b.isEmpty()||a.equals(b);
    }
}
