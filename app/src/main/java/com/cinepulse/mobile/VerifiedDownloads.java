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
    private File stagedText(String value) throws IOException{
        File file=File.createTempFile("cp-portable-", ".part",cache);
        try(FileOutputStream out=new FileOutputStream(file)){
            out.write(value.getBytes(StandardCharsets.UTF_8));
        }catch(Exception e){file.delete();throw e;}
        return file;
    }
    /**
     * Publishes verified originals plus a separate Windows-native ProjectState, an offline
     * SHA-256 MP3 relinker, and SRT files. Never alters the signed Cloudflare original.
     */
    String downloadToDownloads(String projectId,JSONObject detail,JSONObject links,Progress progress) throws Exception{
        if(!SecurityRules.validUuid(projectId))throw new SecurityException("Invalid project ID");
        JSONObject project=detail.getJSONObject("project");
        if(!projectId.equals(project.optString("id"))||!"ready".equals(project.optString("status")))
            throw new SecurityException("Project identity/status mismatch");
        Map<String,JSONObject> known=manifest(detail);
        JSONObject files=links.getJSONObject("files");
        String[] kinds={"export_json","english_mp3","urdu_mp3","source_srt"};
        File[] originals=new File[kinds.length];
        List<File> extras=new ArrayList<>(),outputs=new ArrayList<>(),createdFiles=new ArrayList<>();
        List<String> names=new ArrayList<>();
        List<Uri> createdUris=new ArrayList<>();
        File legacyFolder=null;
        String folder=SecurityRules.safeFolderName(project.optString("title"))+"-"+SecurityRules.shortId(projectId)+"-"+Long.toString(System.currentTimeMillis(),36);
        String relative=Environment.DIRECTORY_DOWNLOADS+"/CinePulse/"+folder+"/";
        try{
            for(int i=0;i<kinds.length;i++){
                String kind=kinds[i];
                JSONObject meta=known.get(kind);
                if(meta==null)throw new SecurityException("Missing Cloudflare "+kind+" manifest");
                progress.update("Verifying signed "+kind+" ("+(i+1)+"/4)");
                originals[i]="source_srt".equals(kind)&&!files.has(kind)
                    ?sourceSrtFromVerifiedJson(originals[0],projectId,meta)
                    :receive(files.getJSONObject(kind).getString("url"),projectId,kind,
                        meta.getLong("bytes"),meta.getString("sha256"));
                outputs.add(originals[i]);names.add(SecurityRules.expectedName(kind));
            }
            JSONObject original=new JSONObject(new String(
                java.nio.file.Files.readAllBytes(originals[0].toPath()),StandardCharsets.UTF_8));
            if(!projectId.equals(original.getJSONObject("project").optString("id")))
                throw new SecurityException("Downloaded JSON does not match selected Cloudflare project");
            String originSrt=new String(java.nio.file.Files.readAllBytes(originals[3].toPath()),StandardCharsets.UTF_8);
            if(!original.optString("sourceSrt").trim().equals(originSrt.trim()))
                throw new SecurityException("Downloaded source SRT does not match signed project JSON");
            double enSeconds=measuredMp3Seconds(originals[1]),urSeconds=measuredMp3Seconds(originals[2]);
            WindowsProjectExport.Result nativeProject=WindowsProjectExport.fromCloud(original,enSeconds,urSeconds);
            PackageAudit.Result qa=PackageAudit.inspect(original,enSeconds,urSeconds);
            JSONObject srts=original.optJSONObject("narrationSrts");
            String en=srts==null?"":inner(srts.opt("english"),"srt");
            String ur=srts==null?"":inner(srts.opt("urdu"),"srt");
            String[] extraNames={
                "CinePulse_Windows_Project.json","CinePulse_English.srt","CinePulse_Urdu.srt",
                "Prepare_For_Windows.bat","CinePulse_Prepare_Windows.js","CinePulse_Quality_Report.txt"
            };
            String[] contents={nativeProject.project.toString(2),en,ur,
                WindowsPackageBootstrap.bat(),WindowsPackageBootstrap.js(),
                nativeProject.report+"\n"+qa.report};
            for(int i=0;i<extraNames.length;i++){
                File extra=stagedText(contents[i]);extras.add(extra);
                outputs.add(extra);names.add(extraNames[i]);
            }
            if(Build.VERSION.SDK_INT>=Build.VERSION_CODES.Q){
                for(int i=0;i<outputs.size();i++){
                    String name=names.get(i);
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
                        if(out==null)throw new IOException("Cannot open download "+name);
                        copy(outputs.get(i),out);
                    }
                    progress.update("Saved "+name+" ("+(i+1)+"/"+outputs.size()+")");
                }
                for(Uri uri:createdUris){
                    ContentValues values=new ContentValues();
                    values.put(MediaStore.MediaColumns.IS_PENDING,0);
                    if(resolver.update(uri,values,null,null)!=1)throw new IOException("Publishing package failed");
                }
            }else{
                File parent=new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),"CinePulse");
                if(!parent.isDirectory()&&!parent.mkdirs())throw new IOException("Cannot create Downloads/CinePulse");
                legacyFolder=new File(parent,folder);
                for(int suffix=2;legacyFolder.exists()&&suffix<=999;suffix++)
                    legacyFolder=new File(parent,folder+"-"+suffix);
                if(legacyFolder.exists()||!legacyFolder.mkdirs())throw new IOException("Cannot create movie Downloads folder");
                for(int i=0;i<outputs.size();i++){
                    File destination=new File(legacyFolder,names.get(i));
                    if(!destination.createNewFile())throw new IOException("Download file already exists: "+names.get(i));
                    createdFiles.add(destination);
                    try(OutputStream out=new FileOutputStream(destination)){copy(outputs.get(i),out);}
                    progress.update("Saved "+names.get(i)+" ("+(i+1)+"/"+outputs.size()+")");
                }
            }
            return "Verified "+outputs.size()+" files in Downloads/CinePulse/"+folder+
                "/. Transfer the entire folder to Windows, run Prepare_For_Windows.bat,"+
                " then import CinePulse_Windows_Ready.json using Windows CinePulse > Import team project."+
                " Original Cloudflare JSON remains in CinePulse_Project.json. Final scene/video coverage still needs Windows review.";
        }catch(Exception error){
            for(Uri uri:createdUris)try{resolver.delete(uri,null,null);}catch(Exception ignored){}
            for(File file:createdFiles)file.delete();
            if(legacyFolder!=null)legacyFolder.delete();
            throw error;
        }finally{
            for(File file:originals)if(file!=null)file.delete();
            for(File extra:extras)extra.delete();
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
    /** Archives verified original files, extracted SRTs, metadata and a truthful QA audit. */
    ZipResult createVerifiedZip(String projectId,JSONObject detail,JSONObject links,Progress progress) throws Exception{
        if(!SecurityRules.validUuid(projectId))throw new SecurityException("Invalid project ID");
        JSONObject p=detail.getJSONObject("project");
        if(!projectId.equals(p.optString("id"))||!"ready".equals(p.optString("status")))
            throw new SecurityException("Project must be ready and match downloaded manifest");
        String[] kinds={"export_json","english_mp3","urdu_mp3","source_srt"};
        String[] names={"CinePulse_Project.json","CinePulse_English.mp3","CinePulse_Urdu.mp3","CinePulse_Source.srt"};
        File[] temp=new File[kinds.length];
        File zip=null;
        try{
            Map<String,JSONObject> assets=manifest(detail);
            JSONObject linksByKind=links.getJSONObject("files");
            for(int i=0;i<kinds.length;i++){
                JSONObject meta=assets.get(kinds[i]);
                if(meta==null)throw new IOException("Missing Cloudflare "+kinds[i]+" manifest");
                progress.update("Verifying "+names[i]+" ("+(i+1)+"/4)");
                if("source_srt".equals(kinds[i])&&!linksByKind.has(kinds[i])){
                    temp[i]=sourceSrtFromVerifiedJson(temp[0],projectId,meta);
                }else{
                    temp[i]=receive(linksByKind.getJSONObject(kinds[i]).getString("url"),
                        projectId,kinds[i],meta.getLong("bytes"),meta.getString("sha256"));
                }
            }
            byte[] jsonBytes=new byte[(int)Math.min(SecurityRules.MAX_JSON_BYTES,temp[0].length())];
            try(InputStream in=new FileInputStream(temp[0])){
                int total=0,n;while(total<jsonBytes.length&&(n=in.read(jsonBytes,total,jsonBytes.length-total))!=-1){total+=n;}
                if(total!=jsonBytes.length)throw new IOException("Project JSON read incomplete");
            }
            JSONObject exported=new JSONObject(new String(jsonBytes,StandardCharsets.UTF_8));
            JSONObject identity=exported.optJSONObject("project");
            if(identity==null || !projectId.equals(identity.optString("id")))
                throw new SecurityException("Exported JSON project ID does not match requested movie");
            String exportedSource=exported.optString("sourceSrt","");
            String downloadedSource=new String(java.nio.file.Files.readAllBytes(temp[3].toPath()),StandardCharsets.UTF_8).trim();
            if(exportedSource.trim().length()>0&&!exportedSource.trim().equals(downloadedSource))
                throw new SecurityException("Source SRT differs from the exported JSON; package cannot be shared safely.");
            double enSeconds=measuredMp3Seconds(temp[1]),urSeconds=measuredMp3Seconds(temp[2]);
            PackageAudit.Result audit=PackageAudit.inspect(exported,enSeconds,urSeconds);
            WindowsProjectExport.Result nativeProject=WindowsProjectExport.fromCloud(exported,enSeconds,urSeconds);
            String title=SecurityRules.safeFolderName(p.optString("title"));
            String name="CinePulse-"+title+"-"+SecurityRules.shortId(projectId)+".zip";
            zip=File.createTempFile("cinepulse-share-", ".zip",cache);
            progress.update("Creating shareable ZIP and QA report");
            try(ZipOutputStream out=new ZipOutputStream(new FileOutputStream(zip))){
                for(int i=0;i<kinds.length;i++)zipFile(out,names[i],temp[i]);
                zipText(out,"CinePulse_Windows_Project.json",nativeProject.project.toString(2));
                zipText(out,"Prepare_For_Windows.bat",WindowsPackageBootstrap.bat());
                zipText(out,"CinePulse_Prepare_Windows.js",WindowsPackageBootstrap.js());
                JSONObject subtitles=exported.optJSONObject("narrationSrts");
                if(subtitles!=null){
                    String en=inner(subtitles.opt("english"),"srt");
                    String ur=inner(subtitles.opt("urdu"),"srt");
                    if(!en.isEmpty())zipText(out,"CinePulse_English.srt",en);
                    if(!ur.isEmpty())zipText(out,"CinePulse_Urdu.srt",ur);
                }
                JSONObject metadata=exported.optJSONObject("metadata");
                if(metadata!=null)zipText(out,"CinePulse_Metadata.json",metadata.toString(2));
                zipText(out,"CinePulse_Quality_Report.txt",nativeProject.report+"\n"+audit.report);
            }
            if(zip.length()<=0)throw new IOException("Cannot generate project ZIP");
            progress.update("ZIP created, audit complete. Share with WhatsApp or transfer to Windows.");
            return new ZipResult(zip,name,audit.report);
        }catch(Exception error){
            if(zip!=null)zip.delete();
            throw error;
        }finally{
            for(File file:temp)if(file!=null)file.delete();
        }
    }
}
