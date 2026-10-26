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
        long max=kind.equals("export_json")?SecurityRules.MAX_JSON_BYTES:
            kind.equals("source_srt")?SecurityRules.MAX_SRT_BYTES:SecurityRules.MAX_MP3_BYTES;
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
    /** Backward-compatible fourth file for pre-v0.1.7 backends:
     * extract the source SRT only from SHA-256-verified export JSON, then independently
     * verify its exact byte length and SHA-256 against the original source_srt manifest.
     */
    private File sourceSrtFromVerifiedJson(File verifiedJson,String projectId,JSONObject sourceManifest) throws Exception {
        if(sourceManifest==null)throw new SecurityException("Original source SRT manifest unavailable");
        if(verifiedJson.length()<=0||verifiedJson.length()>SecurityRules.MAX_JSON_BYTES)
            throw new SecurityException("Verified project JSON size invalid");
        String payload=new String(java.nio.file.Files.readAllBytes(verifiedJson.toPath()),StandardCharsets.UTF_8);
        JSONObject export=new JSONObject(payload);
        JSONObject identity=export.optJSONObject("project");
        if(identity==null||!projectId.equals(identity.optString("id")))
            throw new SecurityException("Source SRT recovery rejected: project identity mismatch");
        String source=export.optString("sourceSrt","");
        if(!source.contains("-->")||source.length()<20)
            throw new SecurityException("Original SRT is missing from verified project JSON");
        byte[] bytes=source.getBytes(StandardCharsets.UTF_8);
        long expected=sourceManifest.optLong("bytes",-1);
        String digest=sourceManifest.optString("sha256","");
        if(expected!=bytes.length||!digest.matches("(?i)[a-f0-9]{64}"))
            throw new SecurityException("Original SRT manifest does not match exported source bytes");
        StringBuilder check=new StringBuilder();
        byte[] actual=MessageDigest.getInstance("SHA-256").digest(bytes);
        for(byte n:actual)check.append(String.format(java.util.Locale.ROOT,"%02x",n&255));
        if(!check.toString().equalsIgnoreCase(digest))
            throw new SecurityException("Original SRT hash mismatch; refused unverified fallback");
        File copy=File.createTempFile("cp-original-srt-", ".part",cache);
        try(FileOutputStream out=new FileOutputStream(copy)){out.write(bytes);}
        return copy;
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
    private File stagedText(String value) throws IOException {
        File target=File.createTempFile("cp-windows-", ".part",cache);
        try(FileOutputStream out=new FileOutputStream(target)){
            out.write(value.getBytes(StandardCharsets.UTF_8));
        }catch(Exception ex){target.delete();throw ex;}
        return target;
    }
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
        RenderBundle(File[] files,List<File> derived,String report){
            this.files=files;this.derived=derived;this.report=report;
        }
        void cleanup(){for(File file:derived)if(file!=null)file.delete();}
    }
    /** All eight outputs contain only the native Windows project and its required media.
     * Input assets are verified against Cloudflare signed manifests BEFORE this method.
     */
    private RenderBundle prepareBundle(String projectId,File[] verified) throws Exception {
        if(verified.length!=4)throw new IOException("Expected verified cloud JSON, 2 MP3s and source SRT");
        JSONObject original=new JSONObject(new String(
            java.nio.file.Files.readAllBytes(verified[0].toPath()),StandardCharsets.UTF_8));
        JSONObject origin=original.optJSONObject("project");
        if(origin==null||!projectId.equals(origin.optString("id")))
            throw new SecurityException("Cloud project ID differs from selected movie");
        String originalSrt=original.optString("sourceSrt","").trim();
        String actualSrt=new String(java.nio.file.Files.readAllBytes(verified[3].toPath()),StandardCharsets.UTF_8).trim();
        if(!originalSrt.equals(actualSrt))
            throw new SecurityException("Source subtitle does not match verified export");
        double en=measuredMp3Seconds(verified[1]),ur=measuredMp3Seconds(verified[2]);
        WindowsProjectExport.Result nativeProject=WindowsProjectExport.fromCloud(original,en,ur);
        JSONObject narration=original.getJSONObject("narrations");
        JSONObject srts=original.getJSONObject("narrationSrts");
        String enText=inner(narration.opt("english"),"text");
        String urText=inner(narration.opt("urdu"),"text");
        String enSrt=inner(srts.opt("english"),"srt");
        String urSrt=inner(srts.opt("urdu"),"srt");
        List<File> derived=new ArrayList<>();
        try{
            File[] output=new File[8];
            output[0]=stagedText(nativeProject.project.toString(2));
            derived.add(output[0]);
            output[1]=verified[3];
            output[2]=verified[1];output[3]=verified[2];
            output[4]=stagedText(enSrt);derived.add(output[4]);
            output[5]=stagedText(urSrt);derived.add(output[5]);
            output[6]=stagedText(enText);derived.add(output[6]);
            output[7]=stagedText(urText);derived.add(output[7]);
            return new RenderBundle(output,derived,nativeProject.report);
        }catch(Exception ex){for(File tmp:derived)tmp.delete();throw ex;}
    }
    private File[] downloadOriginals(String projectId,JSONObject detail,JSONObject links,Progress progress) throws Exception {
        String[] kinds={"export_json","english_mp3","urdu_mp3","source_srt"};
        File[] staged=new File[4];
        try{
            Map<String,JSONObject> assets=manifest(detail);
            JSONObject linksByKind=links.getJSONObject("files");
            for(int i=0;i<kinds.length;i++){
                String kind=kinds[i];JSONObject metadata=assets.get(kind);
                if(metadata==null)throw new SecurityException("Missing hash manifest for "+kind);
                progress.update("Verifying "+kind+" ("+(i+1)+"/4)");
                staged[i]="source_srt".equals(kind)&&!linksByKind.has(kind)
                    ?sourceSrtFromVerifiedJson(staged[0],projectId,metadata)
                    :receive(linksByKind.getJSONObject(kind).getString("url"),
                        projectId,kind,metadata.getLong("bytes"),metadata.getString("sha256"));
            }
            return staged;
        }catch(Exception e){for(File file:staged)if(file!=null)file.delete();throw e;}
    }
    /** Export one Windows-native JSON and exactly seven companion assets (eight total). */
    String downloadToDownloads(String projectId,JSONObject detail,JSONObject links,Progress progress) throws Exception {
        if(!SecurityRules.validUuid(projectId))throw new SecurityException("Invalid project ID");
        JSONObject project=detail.getJSONObject("project");
        if(!projectId.equals(project.optString("id"))||!"ready".equals(project.optString("status")))
            throw new SecurityException("Cloud project is not ready");
        File[] originals=null;
        RenderBundle bundle=null;
        List<Uri> createdUris=new ArrayList<>();
        List<File> createdFiles=new ArrayList<>();
        File legacyFolder=null;
        String folder=SecurityRules.safeFolderName(project.optString("title"))+"-"+
            SecurityRules.shortId(projectId)+"-"+Long.toString(System.currentTimeMillis(),36);
        String relative=Environment.DIRECTORY_DOWNLOADS+"/CinePulse/"+folder+"/";
        try{
            originals=downloadOriginals(projectId,detail,links,progress);
            bundle=prepareBundle(projectId,originals);
            if(Build.VERSION.SDK_INT>=Build.VERSION_CODES.Q){
                for(int i=0;i<BUNDLE_NAMES.length;i++){
                    String name=BUNDLE_NAMES[i];
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
                    progress.update("Saving Windows-ready file "+(i+1)+"/8");
                }
                for(Uri uri:createdUris){
                    ContentValues values=new ContentValues();
                    values.put(MediaStore.MediaColumns.IS_PENDING,0);
                    if(resolver.update(uri,values,null,null)!=1)
                        throw new IOException("Could not publish all eight files");
                }
            }else{
                File parent=new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),"CinePulse");
                if(!parent.isDirectory()&&!parent.mkdirs())throw new IOException("Cannot create Downloads/CinePulse");
                legacyFolder=new File(parent,folder);
                if(!legacyFolder.mkdirs())throw new IOException("Cannot create movie download folder");
                for(int i=0;i<BUNDLE_NAMES.length;i++){
                    File dest=new File(legacyFolder,BUNDLE_NAMES[i]);
                    if(!dest.createNewFile())throw new IOException("Cannot create "+BUNDLE_NAMES[i]);
                    createdFiles.add(dest);
                    try(OutputStream out=new FileOutputStream(dest)){copy(bundle.files[i],out);}
                    progress.update("Saving Windows-ready file "+(i+1)+"/8");
                }
            }
            return "Saved 8 files to Downloads/CinePulse/"+folder+
                ". The single JSON is a Windows-native project with subtitle-grounded short final cuts."+
                " Transfer the whole folder. Windows must resolve MP3 and source-video paths. Frame analysis is not required for timeline-only validation.";
        }catch(Exception e){
            for(Uri uri:createdUris)try{resolver.delete(uri,null,null);}catch(Exception ignored){}
            for(File file:createdFiles)file.delete();
            if(legacyFolder!=null)legacyFolder.delete();
            throw e;
        }finally{
            if(bundle!=null)bundle.cleanup();
            if(originals!=null)for(File file:originals)if(file!=null)file.delete();
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
    private static String inner(Object value,String field){
        if(value==null||value==JSONObject.NULL)return "";
        if(value instanceof JSONObject)return ((JSONObject)value).optString(field,"");
        String str=String.valueOf(value);
        if(str.trim().startsWith("{")){
            try{return new JSONObject(str).optString(field,"");}catch(Exception ignored){}
        }
        return str;
    }
    private static void zipText(ZipOutputStream out,String name,String text) throws IOException{
        out.putNextEntry(new ZipEntry(name));
        byte[] bytes=text.getBytes(StandardCharsets.UTF_8);
        out.write(bytes);out.closeEntry();
    }
    private static void zipFile(ZipOutputStream out,String name,File f) throws IOException{
        out.putNextEntry(new ZipEntry(name));
        copy(f,out);
        out.closeEntry();
    }
    /** Create exactly eight Windows-native files from hash-verified source assets. */
    ZipResult createVerifiedZip(String projectId,JSONObject detail,JSONObject links,Progress progress) throws Exception {
        if(!SecurityRules.validUuid(projectId))throw new SecurityException("Invalid project ID");
        JSONObject project=detail.getJSONObject("project");
        if(!projectId.equals(project.optString("id"))||!"ready".equals(project.optString("status")))
            throw new SecurityException("Project not ready");
        File[] originals=null;RenderBundle bundle=null;File zip=null;
        try{
            originals=downloadOriginals(projectId,detail,links,progress);
            bundle=prepareBundle(projectId,originals);
            String name="CinePulse-"+SecurityRules.safeFolderName(project.optString("title"))+"-"+
                SecurityRules.shortId(projectId)+"-Windows-ready.zip";
            zip=File.createTempFile("cinepulse-windows-", ".zip",cache);
            progress.update("Packaging eight Windows-compatible files");
            try(ZipOutputStream out=new ZipOutputStream(new FileOutputStream(zip))){
                for(int i=0;i<BUNDLE_NAMES.length;i++)zipFile(out,BUNDLE_NAMES[i],bundle.files[i]);
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
