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
        long max=kind.equals("export_json")?SecurityRules.MAX_JSON_BYTES:SecurityRules.MAX_MP3_BYTES;
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
     * All three files are verified BEFORE any user-visible output is created.
     */
    String downloadToDownloads(String projectId,JSONObject project,JSONObject links,Progress progress) throws Exception {
        if(!SecurityRules.validUuid(projectId))throw new SecurityException("Invalid project ID");
        JSONObject p=project.getJSONObject("project");
        if(!projectId.equals(p.optString("id")))throw new SecurityException("Project ID mismatch");
        if(!"ready".equals(p.optString("status")))throw new IllegalStateException("Project is not ready for download");
        Map<String,JSONObject> known=manifest(project);
        JSONObject files=links.getJSONObject("files");
        String[] kinds={"export_json","english_mp3","urdu_mp3"};
        File[] staged=new File[kinds.length];
        String folder=SecurityRules.safeFolderName(p.optString("title"))+"-"+SecurityRules.shortId(projectId);
        String relative=Environment.DIRECTORY_DOWNLOADS+"/CinePulse/"+folder+"/";
        List<Uri> createdUris=new ArrayList<>();
        List<File> createdFiles=new ArrayList<>();
        File legacyFolder=null;
        try {
            for(int i=0;i<kinds.length;i++) {
                String kind=kinds[i];
                progress.update("Downloading and verifying "+SecurityRules.expectedName(kind)+" ("+(i+1)+"/3)");
                JSONObject url=files.getJSONObject(kind), metadata=known.get(kind);
                if(metadata==null)throw new SecurityException("Cloudflare has no "+kind+" file manifest");
                staged[i]=receive(url.getString("url"),projectId,kind,metadata.getLong("bytes"),metadata.getString("sha256"));
            }
            if(Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                for(int i=0;i<kinds.length;i++) {
                    String kind=kinds[i],name=SecurityRules.expectedName(kind);
                    ContentValues values=new ContentValues();
                    values.put(MediaStore.MediaColumns.DISPLAY_NAME,name);
                    values.put(MediaStore.MediaColumns.MIME_TYPE,kind.equals("export_json")?"application/json":"audio/mpeg");
                    values.put(MediaStore.MediaColumns.RELATIVE_PATH,relative);
                    values.put(MediaStore.MediaColumns.IS_PENDING,1);
                    Uri destination=resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI,values);
                    if(destination==null)throw new IOException("Android Downloads rejected "+name);
                    createdUris.add(destination);
                    try(OutputStream out=resolver.openOutputStream(destination,"w")) {
                        if(out==null)throw new IOException("Cannot open "+name+" for saving");
                        copy(staged[i],out);
                    }
                    progress.update("Saved "+name+" ("+(i+1)+"/3)");
                }
                // Publish only after the entire package has been saved successfully.
                for(Uri uri:createdUris) {
                    ContentValues values=new ContentValues();
                    values.put(MediaStore.MediaColumns.IS_PENDING,0);
                    if(resolver.update(uri,values,null,null)!=1)
                        throw new IOException("Could not publish a verified file in Downloads");
                }
            } else {
                File downloads=Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                File parent=new File(downloads,"CinePulse");
                if(!parent.exists()&&!parent.mkdirs())throw new IOException("Cannot create Downloads/CinePulse");
                legacyFolder=new File(parent,folder);
                for(int suffix=2; legacyFolder.exists()&&suffix<=999; suffix++)
                    legacyFolder=new File(parent,folder+"-"+suffix);
                if(legacyFolder.exists()||!legacyFolder.mkdirs())
                    throw new IOException("Cannot create the movie folder in Downloads");
                for(int i=0;i<kinds.length;i++) {
                    File destination=new File(legacyFolder,SecurityRules.expectedName(kinds[i]));
                    if(!destination.createNewFile())throw new IOException("Could not create "+destination.getName());
                    createdFiles.add(destination);
                    try(OutputStream out=new FileOutputStream(destination)) {copy(staged[i],out);}
                    progress.update("Saved "+destination.getName()+" ("+(i+1)+"/3)");
                }
            }
            return "Downloaded and verified 3 files in Downloads/CinePulse/"+folder+"/. Open My Files → Internal storage → Download → CinePulse to view or transfer the folder to Windows.";
        }catch(Exception ex) {
            for(Uri uri:createdUris)try{resolver.delete(uri,null,null);}catch(Exception ignored){}
            for(File file:createdFiles)file.delete();
            if(legacyFolder!=null)legacyFolder.delete();
            throw ex;
        }finally {
            for(File file:staged)if(file!=null)file.delete();
        }
    }
}
