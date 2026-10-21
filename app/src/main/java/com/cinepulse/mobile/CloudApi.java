package com.cinepulse.mobile;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** HTTPS-only Cloudflare client. No automatic redirects, no credential in URLs/logs. */
final class CloudApi {
    private final SecureTokenStore store;
    CloudApi(SecureTokenStore store) { this.store=store; }
    private static String readBounded(InputStream input, int limit) throws IOException {
        try (InputStream in=input; ByteArrayOutputStream out=new ByteArrayOutputStream()) {
            byte[] bytes=new byte[8192];int total=0,n;
            while((n=in.read(bytes))!=-1) {
                total+=n;if(total>limit)throw new IOException("Server response exceeds size limit");
                out.write(bytes,0,n);
            }
            return out.toString(StandardCharsets.UTF_8.name());
        }
    }
    JSONObject call(String method,String route,JSONObject body) throws Exception {
        if(!route.startsWith("/v1/") || route.contains("..") || route.contains("?") && !route.startsWith("/v1/jobs?"))
            throw new SecurityException("Unexpected API route");
        URL url=new URL(SecurityRules.BASE + route);
        HttpURLConnection conn=(HttpURLConnection)url.openConnection();
        conn.setInstanceFollowRedirects(false);
        conn.setConnectTimeout(15000);conn.setReadTimeout(30000);
        conn.setRequestMethod(method);conn.setRequestProperty("Accept","application/json");
        conn.setRequestProperty("Cache-Control","no-store");
        String token=store.load();
        if(token==null)throw new SecurityException("Connect securely before making requests");
        conn.setRequestProperty("Authorization","Bearer "+token);
        try {
            if(body!=null){
                byte[] data=body.toString().getBytes(StandardCharsets.UTF_8);
                if(data.length>SecurityRules.MAX_SRT_BYTES+8192)throw new IOException("Submission exceeds size limit");
                conn.setRequestProperty("Content-Type","application/json; charset=utf-8");
                conn.setDoOutput(true);conn.setFixedLengthStreamingMode(data.length);
                try(OutputStream out=conn.getOutputStream()){out.write(data);}
            }
            int status=conn.getResponseCode();
            if(status>=300&&status<400)throw new IOException("Unexpected server redirect");
            String response=readBounded(status>=400?conn.getErrorStream():conn.getInputStream(),3*1024*1024);
            JSONObject json=new JSONObject(response);
            if(status>=400)throw new IOException("Cloudflare request failed ("+status+"): "+json.optString("error","Try again"));
            return json;
        }finally{conn.disconnect();}
    }
    JSONObject workers() throws Exception {return call("GET","/v1/workers",null);}
    JSONObject projects() throws Exception {return call("GET","/v1/projects",null);}
    JSONObject project(String id) throws Exception {return call("GET","/v1/projects/"+checked(id),null);}
    JSONObject downloads(String id) throws Exception {return call("GET","/v1/projects/"+checked(id)+"/downloads",null);}
    JSONObject jobs() throws Exception {return call("GET","/v1/jobs",null);}
    JSONObject nudge(String jobId) throws Exception {return call("POST","/v1/jobs/"+checked(jobId)+"/nudge",new JSONObject());}
    JSONObject recovery(String projectId) throws Exception {return call("GET","/v1/projects/"+checked(projectId)+"/recovery",null);}
    JSONObject repairStage(String projectId,String stepId) throws Exception {
        if(!stepId.matches("mp3_english|srt_english|mp3_urdu|srt_urdu|digest|narration_english|narration_urdu|viral_metadata|scene_matching|cut_plan"))
            throw new SecurityException("Unsupported stage to retry");
        return call("POST","/v1/projects/"+checked(projectId)+"/recovery",
            new JSONObject().put("stepId",stepId).put("confirm",true));
    }
    JSONObject toggleWorker(String id,boolean pause) throws Exception {
        return call("POST","/v1/workers/"+checked(id)+(pause?"/pause":"/resume"),new JSONObject());
    }
    JSONObject createWorker(String label) throws Exception {
        return call("POST","/v1/workers",new JSONObject().put("label",label));
    }
    JSONObject deleteProject(String projectId) throws Exception {
        return call("DELETE","/v1/projects/"+checked(projectId),null);
    }
    JSONObject createProject(String title,String workerId,String sourceSrt,int retentionHours,int targetMinutes) throws Exception {
        if(targetMinutes<3||targetMinutes>60)throw new IllegalArgumentException("Choose 3–60 minutes");
        return call("POST","/v1/projects",new JSONObject().put("title",title)
            .put("workerId",checked(workerId)).put("sourceSrt",sourceSrt)
            .put("retentionHours",retentionHours).put("targetMinutes",targetMinutes));
    }
    private String checked(String id){if(!SecurityRules.validUuid(id))throw new IllegalArgumentException("Invalid project or worker ID");return id;}
}
