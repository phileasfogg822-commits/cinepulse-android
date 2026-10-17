package com.cinepulse.mobile;

import android.content.ContentResolver;
import android.net.Uri;
import android.provider.DocumentsContract;
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
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;

/** Stream to private cache, verify each file's known R2 SHA-256, then write to SAF folder. */
final class VerifiedDownloads {
    interface Progress { void update(String step); }
    private final ContentResolver resolver;
    private final File cache;
    VerifiedDownloads(ContentResolver resolver,File cache){this.resolver=resolver;this.cache=cache;}
    private static String hex(byte[] b){StringBuilder s=new StringBuilder();for(byte v:b)s.append(String.format("%02x",v&0xff));return s.toString();}
    private static String sha256(File file) throws Exception {
        MessageDigest md=MessageDigest.getInstance("SHA-256");
        try(InputStream in=new FileInputStream(file)){
            byte[] buf=new byte[32768];int n;while((n=in.read(buf))!=-1)md.update(buf,0,n);
        }
        return hex(md.digest());
    }
    private File receive(String link,String id,String kind,long length,String digest) throws Exception {
        if(!SecurityRules.validDownloadUrl(link,id,kind))throw new SecurityException("Download URL is not trusted");
        long max=kind.equals("export_json")?SecurityRules.MAX_JSON_BYTES:SecurityRules.MAX_MP3_BYTES;
        if(length<=0||length>max||!digest.matches("(?i)[0-9a-f]{64}"))throw new SecurityException("Missing or invalid asset manifest");
        File temp=File.createTempFile("cp-", ".part",cache);
        try {
            HttpURLConnection conn=(HttpURLConnection)new URL(link).openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(15000);conn.setReadTimeout(90000);
            conn.setRequestProperty("Cache-Control","no-store");
            try {
                if(conn.getResponseCode()!=200)throw new IOException("Download failed: HTTP "+conn.getResponseCode());
                long nbytes=0;
                try(InputStream in=conn.getInputStream();OutputStream out=new FileOutputStream(temp)){
                    byte[] buffer=new byte[32768];int n;
                    while((n=in.read(buffer))!=-1) {
                        nbytes+=n;if(nbytes>max||nbytes>length)throw new IOException("Download exceeds declared size");
                        out.write(buffer,0,n);
                    }
                }
                if(nbytes!=length||!sha256(temp).equalsIgnoreCase(digest))throw new SecurityException("Downloaded file failed size/SHA-256 verification");
                return temp;
            } finally {conn.disconnect();}
        }catch(Exception e){temp.delete();throw e;}
    }
    private static Uri createChild(ContentResolver resolver,Uri tree,Uri parent,String mime,String name) throws Exception {
        Uri created=DocumentsContract.createDocument(resolver,parent,mime,name);
        if(created==null)throw new IOException("Cannot create "+name+" in selected folder");
        return created;
    }
    private static Map<String,JSONObject> manifest(JSONObject project) {
        Map<String,JSONObject> result=new HashMap<>();
        JSONArray assets=project.optJSONArray("assets");
        if(assets!=null)for(int i=0;i<assets.length();i++){
            JSONObject item=assets.optJSONObject(i);
            if(item!=null)result.put(item.optString("kind"),item);
        }
        return result;
    }
    void download(String projectId,JSONObject project,JSONObject links,Uri targetTree,Progress progress) throws Exception {
        if(!SecurityRules.validUuid(projectId))throw new SecurityException("Invalid project ID");
        JSONObject p=project.getJSONObject("project");
        if(!"ready".equals(p.optString("status")))throw new IllegalStateException("Project is not ready for download");
        Map<String,JSONObject> known=manifest(project);
        JSONObject files=links.getJSONObject("files");
        String[] kinds={"export_json","english_mp3","urdu_mp3"};
        File[] staged=new File[kinds.length];
        try {
            // Stage and authenticate *all* downloads before creating the destination folder.
            for(int i=0;i<kinds.length;i++){
                String kind=kinds[i];
                progress.update("Verifying "+SecurityRules.expectedName(kind)+" ("+(i+1)+"/3)");
                JSONObject url=files.getJSONObject(kind), meta=known.get(kind);
                if(meta==null)throw new SecurityException("Cloudflare manifest missing "+kind);
                staged[i]=receive(url.getString("url"),projectId,kind,meta.getLong("bytes"),meta.getString("sha256"));
            }
            String folder=SecurityRules.safeFolderName(p.optString("title"))+"-"+SecurityRules.shortId(projectId);
            Uri base=DocumentsContract.buildDocumentUriUsingTree(targetTree,DocumentsContract.getTreeDocumentId(targetTree));
            Uri dir=createChild(resolver,targetTree,base,DocumentsContract.Document.MIME_TYPE_DIR,folder);
            for(int i=0;i<kinds.length;i++){
                String kind=kinds[i];
                Uri dest=createChild(resolver,targetTree,dir,kind.equals("export_json")?"application/json":"audio/mpeg",SecurityRules.expectedName(kind));
                try(InputStream in=new FileInputStream(staged[i]);OutputStream out=resolver.openOutputStream(dest,"w")) {
                    if(out==null)throw new IOException("Cannot open selected folder for writing");
                    byte[] buf=new byte[32768];int n;while((n=in.read(buf))!=-1)out.write(buf,0,n);
                }
                progress.update("Saved "+SecurityRules.expectedName(kind));
            }
        } finally {for(File f:staged)if(f!=null)f.delete();}
    }
}
