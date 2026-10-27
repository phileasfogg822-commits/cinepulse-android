package com.cinepulse.mobile;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import android.media.MediaMetadataRetriever;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** One-tap downloads. Files are verified in private cache before being published in Downloads/CinePulse. */
final class VerifiedDownloads {
    interface Progress { void update(String step); }
    private final ContentResolver resolver;
    private final File cache;
    VerifiedDownloads(ContentResolver resolver, File cache) { this.resolver=resolver; this.cache=cache; }

    private static String hex(byte[] bytes) {
        StringBuilder result=new StringBuilder();
        for(byte b:bytes) result.append(String.format(java.util.Locale.ROOT,"%02x",b & 0xff));
        return result.toString();
    }
    private static String sha256(File file) throws Exception {
        MessageDigest md=MessageDigest.getInstance("SHA-256");
        try(InputStream in=new FileInputStream(file)) {
            byte[] buf=new byte[32768];int count;
            while((count=in.read(buf))!=-1) md.update(buf,0,count);
        }
        return hex(md.digest());
    }
    private File receive(String link,String projectId,String kind,long length,String digest) throws Exception {
        if(!SecurityRules.validDownloadUrl(link,projectId,kind))
            throw new SecurityException("Cloudflare supplied an untrusted download link for "+kind);
        long max=(kind.equals("windows_project_json")||kind.equals("export_json"))?
            SecurityRules.MAX_JSON_BYTES:(kind.endsWith("_mp3")?SecurityRules.MAX_MP3_BYTES:SecurityRules.MAX_SRT_BYTES);
        if(length<=0||length>max||digest==null||!digest.matches("(?i)[0-9a-f]{64}"))
            throw new SecurityException("Missing/invalid file size or SHA-256 for "+kind);
        File temp=File.createTempFile("cp-", ".part",cache);
        try {
            HttpURLConnection conn=(HttpURLConnection)new URL(link).openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(90000);
            conn.setRequestProperty("Cache-Control","no-store");
            try {
                int status=conn.getResponseCode();
                if(status!=200)throw new IOException(kind+" download returned HTTP "+status+". Try Download again to renew its signed link.");
                long nbytes=0;
                try(InputStream in=conn.getInputStream();OutputStream out=new FileOutputStream(temp)) {
                    byte[] buf=new byte[32768];int n;
                    while((n=in.read(buf))!=-1) {
                        nbytes+=n;
                        if(nbytes>max||nbytes>length)throw new IOException(kind+" exceeds expected size");
                        out.write(buf,0,n);
                    }
                    out.flush();
                }
                if(nbytes!=length || !sha256(temp).equalsIgnoreCase(digest))
                    throw new SecurityException(kind+" failed byte-size/SHA-256 verification. Nothing was saved.");
                return temp;
            } finally {conn.disconnect();}
        } catch(Exception ex) { temp.delete();throw ex; }
    }
    private static Map<String,JSONObject> manifest(JSONObject project) {
        Map<String,JSONObject> found=new HashMap<>();
        JSONArray entries=project.optJSONArray("assets");
        if(entries!=null) for(int i=0;i<entries.length();i++) {
            JSONObject item=entries.optJSONObject(i);
            if(item!=null)found.put(item.optString("kind"),item);
        }
        return found;
    }
    private static void copy(File from,OutputStream out) throws IOException {
        try(InputStream in=new FileInputStream(from)) {
            byte[] buf=new byte[32768];int n;
            while((n=in.read(buf))!=-1)out.write(buf,0,n);
            out.flush();
        }
    }
    /**
     * On Android 10+ use MediaStore.Downloads with pending files, no storage permission.
     * Android 8/9 requires WRITE_EXTERNAL_STORAGE permission granted by the activity.
     * All four primary files are verified BEFORE any user-visible output is created.
     */
    private static final String[] BUNDLE_NAMES={
        "CinePulse_Project.json", "CinePulse_Source.srt",
        "CinePulse_English.mp3", "CinePulse_Urdu.mp3",
        "CinePulse_English.srt", "CinePulse_Urdu.srt",
        "CinePulse_English_Narration.txt", "CinePulse_Urdu_Narration.txt"
    };
    static String[] windowsBundleNames(){return BUNDLE_NAMES.clone();}
    private static final class RenderBundle {
        final File[] files;
        final List<File> derived;
        final String report;
        final String[] names;
        final boolean renderReady;
        RenderBundle(File[] files,List<File> derived,String report,String[] names,boolean renderReady){
            this.files=files;this.derived=derived;this.report=report;
            this.names=names;this.renderReady=renderReady;
        }
        void cleanup(){for(File file:derived)if(file!=null)file.delete();}
    }
    private static final String[] WINDOWS_ASSET_KINDS={
        "windows_project_json","source_srt","english_mp3","urdu_mp3",
        "english_srt","urdu_srt","english_narration","urdu_narration"
    };
    /**
     * The ONLY Android role: fetch eight FINAL assets which Cloudflare has
     * already created and validated. No Muse stage, edit decision, SRT synthesis,
     * source overlap correction or conversion runs on this device.
     */
    private RenderBundle downloadWindowsBundle(String projectId,JSONObject detail,
                                               JSONObject links,Progress progress) throws Exception {
        if(!"windows_eight_verified".equals(links.optString("format")))
            throw new IOException("Cloudflare did not return its eight-file Windows package. Reprocess this movie with the new Cloudflare/Muse backend.");
        Map<String,JSONObject> expected=manifest(detail);
        JSONObject urls=links.getJSONObject("files");
        File[] files=new File[WINDOWS_ASSET_KINDS.length];
        List<File> cleanup=new ArrayList<>();
        try{
            for(int i=0;i<WINDOWS_ASSET_KINDS.length;i++){
                String kind=WINDOWS_ASSET_KINDS[i];
                JSONObject meta=expected.get(kind);
                JSONObject link=urls.optJSONObject(kind);
                if(meta==null||link==null)
                    throw new IOException("Cloudflare has not prepared "+kind+"; no package generated on Android.");
                long bytes=meta.optLong("bytes",-1);
                String hash=meta.optString("sha256","");
                if(bytes<=0||bytes!=link.optLong("bytes",-1)||
                    !hash.equalsIgnoreCase(link.optString("sha256"))||
                    !BUNDLE_NAMES[i].equals(link.optString("filename")))
                    throw new SecurityException("Cloudflare package manifest mismatch for "+kind);
                progress.update("Verifying Cloudflare asset "+(i+1)+"/8: "+BUNDLE_NAMES[i]);
                files[i]=receive(link.getString("url"),projectId,kind,bytes,hash);
                cleanup.add(files[i]);
            }
            JSONObject windows=new JSONObject(new String(
                java.nio.file.Files.readAllBytes(files[0].toPath()),StandardCharsets.UTF_8));
            JSONObject provenance=windows.optJSONObject("cloudImport");
            if(provenance==null||
                !"cinepulse.windows-server.v3".equals(provenance.optString("schema"))||
                !projectId.equals(provenance.optString("cloudProjectId")))
                throw new SecurityException("Cloudflare Windows-native JSON identity/schema mismatch");
            JSONObject tracks=windows.optJSONObject("tracks");
            if(tracks==null||
                tracks.optJSONObject("english")==null||
                tracks.optJSONObject("hindiUrdu")==null||
                tracks.getJSONObject("english").optJSONArray("cuts")==null||
                tracks.getJSONObject("hindiUrdu").optJSONArray("cuts")==null||
                tracks.getJSONObject("english").getJSONArray("cuts").length()==0||
                tracks.getJSONObject("hindiUrdu").getJSONArray("cuts").length()==0)
                throw new SecurityException("Cloudflare sent incomplete English or Urdu final cuts");
            return new RenderBundle(files,cleanup,
                "SERVER VERIFIED: All 8 final assets already created by Cloudflare/Muse. "+
                "Downloaded byte-for-byte, with original SHA-256 and one Windows-native JSON. "+
                "The APK performs no cutting, timing allocation, transcription, or rewriting.",
                BUNDLE_NAMES,true);
        }catch(Exception error){
            for(File file:cleanup)file.delete();
            throw error;
        }
    }

    /** Export one Windows-native JSON and exactly seven companion assets (eight total). */
    String downloadToDownloads(String projectId,JSONObject detail,JSONObject links,Progress progress) throws Exception {
        if(!SecurityRules.validUuid(projectId))throw new SecurityException("Invalid project ID");
        JSONObject project=detail.getJSONObject("project");
        if(!projectId.equals(project.optString("id"))||!"ready".equals(project.optString("status")))
            throw new SecurityException("Cloud project is not ready");
        RenderBundle bundle=null;
        List<Uri> createdUris=new ArrayList<>();
        List<File> createdFiles=new ArrayList<>();
        File legacyFolder=null;
        String folder=SecurityRules.safeFolderName(project.optString("title"))+"-"+
            SecurityRules.shortId(projectId)+"-"+Long.toString(System.currentTimeMillis(),36);
        String relative=Environment.DIRECTORY_DOWNLOADS+"/CinePulse/"+folder+"/";
        try{
            bundle=downloadWindowsBundle(projectId,detail,links,progress);
            relative=Environment.DIRECTORY_DOWNLOADS+"/CinePulse/"+folder+"/";
            if(Build.VERSION.SDK_INT>=Build.VERSION_CODES.Q){
                for(int i=0;i<bundle.names.length;i++){
                    String name=bundle.names[i];
                    ContentValues values=new ContentValues();
                    values.put(MediaStore.MediaColumns.DISPLAY_NAME,name);
                    values.put(MediaStore.MediaColumns.MIME_TYPE,name.endsWith(".json")?"application/json":
                        name.endsWith(".srt")?"application/x-subrip":
                        name.endsWith(".mp3")?"audio/mpeg":"text/plain");
                    values.put(MediaStore.MediaColumns.RELATIVE_PATH,relative);
                    values.put(MediaStore.MediaColumns.IS_PENDING,1);
                    Uri uri=resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI,values);
                    if(uri==null)throw new IOException("Cannot publish "+name);
                    createdUris.add(uri);
                    try(OutputStream out=resolver.openOutputStream(uri,"w")){
                        if(out==null)throw new IOException("Cannot create "+name);
                        copy(bundle.files[i],out);
                    }
                    progress.update("Saving signed Cloudflare media "+(i+1)+"/"+bundle.names.length);
                }
                for(Uri uri:createdUris){
                    ContentValues values=new ContentValues();
                    values.put(MediaStore.MediaColumns.IS_PENDING,0);
                    if(resolver.update(uri,values,null,null)!=1)
                        throw new IOException("Could not publish all "+bundle.names.length+" files");
                }
            }else{
                File parent=new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),"CinePulse");
                if(!parent.isDirectory()&&!parent.mkdirs())throw new IOException("Cannot create Downloads/CinePulse");
                legacyFolder=new File(parent,folder);
                if(!legacyFolder.mkdirs())throw new IOException("Cannot create movie download folder");
                for(int i=0;i<bundle.names.length;i++){
                    File dest=new File(legacyFolder,bundle.names[i]);
                    if(!dest.createNewFile())throw new IOException("Cannot create "+bundle.names[i]);
                    createdFiles.add(dest);
                    try(OutputStream out=new FileOutputStream(dest)){copy(bundle.files[i],out);}
                    progress.update("Saving "+(bundle.renderReady?"Windows-ready":"recovery")+" file "+(i+1)+"/"+bundle.names.length);
                }
            }
            return "Saved the 8 original Cloudflare-created Windows files to Downloads/CinePulse/"+
                folder+"/. APK verified all eight signed downloads and did not modify any cut,"+
                " subtitle, narration, metadata or project JSON.";
        }catch(Exception e){
            for(Uri uri:createdUris)try{resolver.delete(uri,null,null);}catch(Exception ignored){}
            for(File file:createdFiles)file.delete();
            if(legacyFolder!=null)legacyFolder.delete();
            throw e;
        }finally{
            if(bundle!=null)bundle.cleanup();
        }
    }

    static final class ZipResult {
        final File file;
        final String name;
        final String report;
        ZipResult(File file,String name,String report){this.file=file;this.name=name;this.report=report;}
    }
    private static double measuredMp3Seconds(File f){
        MediaMetadataRetriever mmr=new MediaMetadataRetriever();
        try{
            mmr.setDataSource(f.getAbsolutePath());
            String s=mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            if(s==null)return -1;
            return Math.max(-1,Double.parseDouble(s)/1000d);
        }catch(Exception ignored){return -1;}
        finally{try{mmr.release();}catch(Exception ignored){}}
    }
    private static void zipFile(ZipOutputStream out,String name,File f) throws IOException{
        out.putNextEntry(new ZipEntry(name));
        copy(f,out);
        out.closeEntry();
    }
    /** Shared between Android export and JVM regression tests: rejects any missing entry. */
    static void writePackageZip(ZipOutputStream out,String[] names,File[] files) throws IOException {
        if(names==null||files==null||names.length!=files.length||names.length==0)
            throw new IOException("Bundle name/file count mismatch");
        if(!java.util.Arrays.equals(names,BUNDLE_NAMES))
            throw new IOException("Windows export must contain exactly eight Cloudflare files");
        java.util.HashSet<String> seen=new java.util.HashSet<>();
        for(int i=0;i<names.length;i++){
            String name=names[i];
            File file=files[i];
            if(name==null||name.isEmpty()||name.contains("/")||name.contains("\\")||
                !seen.add(name)||file==null||!file.isFile()||file.length()<=0)
                throw new IOException("Incomplete or unsafe export entry: "+name);
            zipFile(out,name,file);
        }
    }

    /** Create exactly eight Windows-native files from hash-verified source assets. */
    ZipResult createVerifiedZip(String projectId,JSONObject detail,JSONObject links,Progress progress) throws Exception {
        if(!SecurityRules.validUuid(projectId))throw new SecurityException("Invalid project ID");
        JSONObject project=detail.getJSONObject("project");
        if(!projectId.equals(project.optString("id"))||!"ready".equals(project.optString("status")))
            throw new SecurityException("Project not ready");
        RenderBundle bundle=null;File zip=null;
        try{
            bundle=downloadWindowsBundle(projectId,detail,links,progress);
            String name="CinePulse-"+SecurityRules.safeFolderName(project.optString("title"))+"-"+
                SecurityRules.shortId(projectId)+"-Cloudflare-Windows-ready.zip";
            zip=File.createTempFile("cinepulse-windows-", ".zip",cache);
            progress.update("Packaging eight original Cloudflare-generated Windows files");
            try(ZipOutputStream out=new ZipOutputStream(new FileOutputStream(zip))){
                writePackageZip(out,bundle.names,bundle.files);
            }
            if(zip.length()<=0)throw new IOException("Empty Windows export ZIP");
            return new ZipResult(zip,name,bundle.report);
        }catch(Exception e){if(zip!=null)zip.delete();throw e;}
        finally{
            if(bundle!=null)bundle.cleanup();
            if(originals!=null)for(File file:originals)if(file!=null)file.delete();
        }
    }

}
