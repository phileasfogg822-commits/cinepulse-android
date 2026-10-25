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
    static String state(JSONObject entry){return entry.optString("state","READY");}
    synchronized void setState(String id,String state,String projectId,String reason) throws Exception{
        if(!SecurityRules.validUuid(id))throw new SecurityException("Invalid subtitle ID.");
        if(!("READY".equals(state)||"SUBMITTING".equals(state)||"UNKNOWN".equals(state)||
            "QUEUED".equals(state)||"FINISHED".equals(state)||"NEEDS_REVIEW".equals(state)))
            throw new SecurityException("Unsupported movie state.");
        JSONArray all=entries();boolean found=false;
        for(int i=0;i<all.length();i++){
            JSONObject item=all.optJSONObject(i);
            if(item==null||!id.equals(item.optString("id")))continue;
            String current=state(item);
            if("SUBMITTING".equals(state)&&!"READY".equals(current))
                throw new IOException("Already submitted or uncertain: "+current);
            if("READY".equals(state)&&!"NEEDS_REVIEW".equals(current))
                throw new IOException("A queued/unknown submission may not be reset automatically.");
            if("QUEUED".equals(state)&&!SecurityRules.validUuid(projectId))
                throw new SecurityException("No verified Cloudflare project ID.");
            item.put("state",state);
            if("QUEUED".equals(state))item.put("projectId",projectId);
            if(reason!=null&&!reason.isEmpty())item.put("stateReason",reason.length()>160?reason.substring(0,160):reason);
            found=true;break;
        }
        if(!found)throw new IOException("Movie not found in local library.");
        write(all);
    }
    synchronized void reviewExistingQuality() throws Exception{
        JSONArray all=entries();boolean changed=false;
        for(int i=0;i<all.length();i++){
            JSONObject item=all.optJSONObject(i);
            if(item==null||!"READY".equals(state(item)))continue;
            if(item.optInt("cues",0)<75||item.optDouble("durationSeconds",0)<3300){
                item.put("state","NEEDS_REVIEW");
                item.put("stateReason","Legacy SRT has insufficient cues or timeline. Collect a better release.");
                changed=true;
            }
        }
        if(changed)write(all);
    }
    synchronized JSONObject save(JSONObject hit,SubtitleProvider.Srt srt) throws Exception{
        JSONArray all=entries();
        for(int i=0;i<all.length();i++){
            JSONObject previous=all.optJSONObject(i);
            if(previous==null)continue;
            boolean same=srt.sha256.equals(previous.optString("sha256"))||
                ("EN".equalsIgnoreCase(hit.optString("language"))&&
                 "EN".equalsIgnoreCase(previous.optString("language"))&&
                 MovieIdentity.sameMovie(hit.optString("title"),previous.optString("title")));
            if(!same)continue;
            if("NEEDS_REVIEW".equals(state(previous))&&srt.cues>previous.optInt("cues")&&
                srt.duration>previous.optDouble("durationSeconds")&&
                SubtitleQuality.assess(srt,0).complete){
                String existingId=previous.optString("id");
                File existingFile=new File(dir,existingId+".srt");
                try(FileOutputStream out=new FileOutputStream(existingFile,false)){
                    out.write(srt.text.getBytes(StandardCharsets.UTF_8));out.getFD().sync();
                }
                previous.put("title",hit.optString("title")).put("release",hit.optString("release"))
                    .put("sha256",srt.sha256).put("cues",srt.cues)
                    .put("durationSeconds",srt.duration).put("state","READY")
                    .remove("stateReason");
                write(all);
                return previous;
            }
            return previous;
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
            .put("imdbId",hit.optString("imdbId",""))
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
    synchronized void markFinished(String id) throws Exception{
        if(!SecurityRules.validUuid(id))throw new SecurityException("Invalid subtitle ID.");
        JSONArray all=entries();boolean changed=false;
        for(int i=0;i<all.length();i++){
            JSONObject item=all.optJSONObject(i);
            if(item!=null&&id.equals(item.optString("id"))&&"QUEUED".equals(state(item))){
                item.put("state","FINISHED");
                item.put("stateReason","Cloudflare reports this movie ready or awaiting review.");
                changed=true;break;
            }
        }
        if(changed)write(all);
    }
    synchronized void markQueued(String id,String projectId) throws Exception{
        setState(id,"QUEUED",projectId,"Confirmed by Cloudflare");
    }
    synchronized void markSubmitting(String id) throws Exception{
        setState(id,"SUBMITTING","","Request being sent; reconfirm before any retry");
    }
    synchronized void markUnknown(String id,String reason) throws Exception{
        setState(id,"UNKNOWN","",reason);
    }
    synchronized void markNeedsReview(String id,String reason) throws Exception{
        setState(id,"NEEDS_REVIEW","",reason);
    }
    synchronized void allowRequeue(String id) throws Exception{
        if(!SecurityRules.validUuid(id))throw new SecurityException("Invalid subtitle ID.");
        JSONArray all=entries();boolean found=false;
        for(int i=0;i<all.length();i++){
            JSONObject item=all.optJSONObject(i);
            if(item==null||!id.equals(item.optString("id")))continue;
            if("READY".equals(state(item))||"NEEDS_REVIEW".equals(state(item)))
                throw new IOException("Movie is not in a submitted/uncertain state.");
            item.put("state","READY");
            item.put("requeueApprovedAt",System.currentTimeMillis());
            item.put("previousProjectId",item.optString("projectId"));
            item.remove("projectId");item.remove("stateReason");found=true;break;
        }
        if(!found)throw new IOException("Movie is absent from device.");
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
        for(int i=0;i<current.length();i++){
            JSONObject item=current.optJSONObject(i);
            if(item!=null&&id.equals(item.optString("id"))&&
                ("QUEUED".equals(state(item))||"FINISHED".equals(state(item))||"UNKNOWN".equals(state(item))||
                 "SUBMITTING".equals(state(item))))
                throw new IOException("Cannot remove a queued/uncertain movie. Its index prevents duplicate processing.");
        }
        write(remaining);
        new File(dir,id+".srt").delete();
    }
}
