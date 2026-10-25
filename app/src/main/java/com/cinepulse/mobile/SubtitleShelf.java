package com.cinepulse.mobile;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.HashSet;
import java.util.Set;

/** Private on-device subtitles: survives app restarts, not part of Android backup. */
final class SubtitleShelf {
    private final File dir,indexFile;
    SubtitleShelf(Context c){
        dir=new File(c.getFilesDir(),"srt-library");
        indexFile=new File(dir,"index.json");
    }
    private void ensure() throws IOException {
        if(!dir.isDirectory()&&!dir.mkdirs())throw new IOException("Cannot prepare local SRT library.");
    }
    private static byte[] limitedFile(File f,int max) throws IOException{
        if(f.length()<0||f.length()>max)throw new IOException("Stored SRT size invalid.");
        try(FileInputStream in=new FileInputStream(f)){
            byte[] data=new byte[(int)f.length()];int done=0,n;
            while(done<data.length&&(n=in.read(data,done,data.length-done))!=-1)done+=n;
            if(done!=data.length)throw new IOException("Incomplete SRT read.");
            return data;
        }
    }
    synchronized JSONArray entries() throws Exception{
        ensure();
        if(!indexFile.exists())return new JSONArray();
        return new JSONArray(new String(limitedFile(indexFile,1024*1024),StandardCharsets.UTF_8));
    }
    private synchronized void write(JSONArray all) throws Exception{
        ensure();
        File temp=new File(dir,"index.tmp");
        try(FileOutputStream out=new FileOutputStream(temp,false)){
            out.write(all.toString().getBytes(StandardCharsets.UTF_8));out.getFD().sync();
        }
        if(!temp.renameTo(indexFile)){
            // Atomic rename fallback for Android filesystems where overwrite is not allowed.
            if(indexFile.exists()&&!indexFile.delete())throw new IOException("Could not replace local subtitle index.");
            if(!temp.renameTo(indexFile))throw new IOException("Could not save subtitle index.");
        }
    }
    synchronized JSONObject save(JSONObject hit,SubtitleProvider.Srt srt) throws Exception{
        JSONArray all=entries();
        for(int i=0;i<all.length();i++){
            JSONObject previous=all.optJSONObject(i);
            if(previous!=null && (srt.sha256.equals(previous.optString("sha256")) ||
                (hit.optString("title").equalsIgnoreCase(previous.optString("title")) &&
                "EN".equalsIgnoreCase(previous.optString("language")))))return previous;
        }
        if(all.length()>=1000)throw new IOException("SRT library has reached its 1000-file storage cap.");
        String id=UUID.randomUUID().toString();
        File file=new File(dir,id+".srt");
        try(FileOutputStream out=new FileOutputStream(file)){
            out.write(srt.text.getBytes(StandardCharsets.UTF_8));out.getFD().sync();
        }
        JSONObject entry=new JSONObject().put("id",id)
            .put("title",hit.optString("title","Unknown movie"))
            .put("release",hit.optString("release","Unknown release"))
            .put("language",hit.optString("language","EN"))
            .put("provider",hit.optString("provider","SubDL"))
            .put("sourcePath",hit.optString("path",""))
            .put("sha256",srt.sha256)
            .put("durationSeconds",srt.duration)
            .put("cues",srt.cues)
            .put("downloadedAt",System.currentTimeMillis());
        all.put(entry);
        try{write(all);}catch(Exception e){file.delete();throw e;}
        return entry;
    }
    String storageLocation(){return dir.getAbsolutePath();}
    synchronized void markQueued(String id,String projectId) throws Exception{
        if(!SecurityRules.validUuid(id)||!SecurityRules.validUuid(projectId))throw new SecurityException("Invalid queue identity.");
        JSONArray all=entries();boolean found=false;
        for(int i=0;i<all.length();i++){
            JSONObject item=all.optJSONObject(i);
            if(item!=null&&id.equals(item.optString("id"))){
                item.put("state","QUEUED");item.put("projectId",projectId);found=true;break;
            }
        }
        if(!found)throw new IOException("Local subtitle not found.");
        write(all);
    }
    synchronized String read(String id) throws Exception{
        if(!SecurityRules.validUuid(id))throw new SecurityException("Untrusted subtitle ID.");
        File file=new File(dir,id+".srt");
        if(!file.isFile())throw new IOException("Subtitle is missing from device.");
        return new String(limitedFile(file,SecurityRules.MAX_SRT_BYTES),StandardCharsets.UTF_8);
    }
    synchronized void remove(String id) throws Exception{
        if(!SecurityRules.validUuid(id))throw new SecurityException("Invalid subtitle ID.");
        JSONArray current=entries(),remaining=new JSONArray();boolean found=false;
        for(int i=0;i<current.length();i++){
            JSONObject item=current.optJSONObject(i);
            if(item==null)continue;
            if(id.equals(item.optString("id"))){found=true;continue;}
            remaining.put(item);
        }
        if(!found)return;
        write(remaining);
        new File(dir,id+".srt").delete();
    }
}
