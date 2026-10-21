package com.cinepulse.mobile;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.SharedPreferences;
import androidx.core.content.FileProvider;
import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.Gravity;
import android.view.WindowManager;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.ArrayAdapter;
import android.widget.TextView;
import android.widget.Toast;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.text.DateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

/** Single-activity, native Android Views shell; no WebView, analytics SDK, background service or polling. */
public final class MainActivity extends Activity {
    private static final int PICK_SRT=71, STORAGE_PERMISSION=73;
    private static final int BG=0xFF0B1021, CARD=0xFF151C32, STROKE=0xFF27314A;
    private static final int MUTED=0xFFA9B5D0, PURPLE=0xFF8578FF, GREEN=0xFF39D3B2;
    private static final int WHITE=0xFFF8FAFF;
    private final ExecutorService io=Executors.newSingleThreadExecutor();
    private final Handler handler=new Handler(Looper.getMainLooper());
    private SecureTokenStore tokens;
    private CloudApi api;
    private LinearLayout root, content;
    private JSONArray projects=new JSONArray(),workers=new JSONArray();
    private String openedProject=null;
    private String pendingDownloadProject=null;
    private boolean busy=false;
    private boolean viewingArchive=false;
    private static final String PREFS="cinepulse_project_list_v2";

    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        getWindow().setStatusBarColor(BG);getWindow().setNavigationBarColor(BG);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        tokens=new SecureTokenStore(this);api=new CloudApi(tokens);
        if(state!=null)openedProject=state.getString("openedProject");
        renderHome();
        io.execute(()->{
            try{String t=tokens.load();handler.post(()->{if(t==null)showConnect();else refresh();});}
            catch(Exception e){handler.post(()->showConnect());}
        });
    }
    @Override protected void onSaveInstanceState(Bundle out){out.putString("openedProject",openedProject);super.onSaveInstanceState(out);}
    @Override public void onBackPressed(){if(openedProject!=null){openedProject=null;renderHome();}else super.onBackPressed();}
    @Override protected void onDestroy(){io.shutdownNow();handler.removeCallbacksAndMessages(null);super.onDestroy();}
    private SharedPreferences archivePrefs(){return getSharedPreferences(PREFS,MODE_PRIVATE);}
    private String localState(String id){return archivePrefs().getString("state_"+id,"active");}
    private void setLocalState(String id,String state){
        archivePrefs().edit().putString("state_"+id,state).apply();
    }
    private static boolean terminalStatus(String status){return "ready".equals(status)||"needs_review".equals(status);}
    private void archiveDialog(String id,String status,boolean reviewed){
        if(!SecurityRules.validUuid(id))return;
        String title=reviewed?"Mark reviewed and archive?":"Hide from active movies?";
        String message=reviewed?
            "Marks this movie reviewed on this phone and hides it from the active list. This does not mark the Cloudflare pipeline complete, change Muse tasks, or delete files.":
            "This only hides the project on this device. Cloudflare and Muse will keep processing normally.";
        new AlertDialog.Builder(this).setTitle(title).setMessage(message).setNegativeButton("Cancel",null)
            .setPositiveButton("Archive",(d,w)->{
                setLocalState(id,reviewed?"reviewed":"archived");
                openedProject=null;renderHome();
            }).show();
    }
    private void permanentlyDelete(String id,String status){
        if(!terminalStatus(status)){showError("Only ready or needs_review projects may be deleted. Stop active work on the backend first.");return;}
        EditText confirmation=new EditText(this);confirmation.setSingleLine(true);
        confirmation.setHint("Type DELETE");
        new AlertDialog.Builder(this).setTitle("Permanently delete Cloudflare movie?")
            .setMessage("DANGER: all backend tasks, MP3s, JSON, SRT and audit history for this project will be removed permanently. Other movie projects are not affected. Export a ZIP first. Type DELETE to confirm.")
            .setView(confirmation).setNegativeButton("Cancel",null)
            .setPositiveButton("Delete",(d,w)->{
                if(!"DELETE".equals(confirmation.getText().toString().trim())){showError("Deletion cancelled: confirmation did not match DELETE.");return;}
                task("Permanently deleting one terminal project",()->api.deleteProject(id),result->{
                    archivePrefs().edit().remove("state_"+id).apply();
                    openedProject=null;
                    Toast.makeText(this,"Project deleted from Cloudflare",Toast.LENGTH_LONG).show();
                    refresh();
                });
            }).show();
    }
    private static String readableBytes(long bytes){
        if(bytes<0)return "unknown size";
        if(bytes<1024)return bytes+" bytes";
        return String.format(java.util.Locale.ROOT,"%.1f KiB",bytes/1024.0);
    }
    private int dp(float d){return (int)(d*getResources().getDisplayMetrics().density+0.5f);}
    private GradientDrawable shape(int color,int border,int radius){
        GradientDrawable d=new GradientDrawable();d.setColor(color);d.setCornerRadius(dp(radius));
        if(border!=0)d.setStroke(dp(1),border);
        return d;
    }
    private LinearLayout vertical(){LinearLayout l=new LinearLayout(this);l.setOrientation(LinearLayout.VERTICAL);return l;}
    private LinearLayout horizontal(){LinearLayout l=new LinearLayout(this);l.setOrientation(LinearLayout.HORIZONTAL);l.setGravity(Gravity.CENTER_VERTICAL);return l;}
    private TextView text(String value,int size,int color,boolean bold){
        TextView t=new TextView(this);t.setText(value);t.setTextColor(color);t.setTextSize(size);
        t.setFontFeatureSettings("kern");if(bold)t.setTypeface(Typeface.DEFAULT,Typeface.BOLD);
        t.setLineSpacing(dp(2),1.04f);return t;
    }
    private void space(LinearLayout l,int height){View v=new View(this);l.addView(v,new LinearLayout.LayoutParams(1,dp(height)));}
    private void pad(View v,int left,int top,int right,int bottom){v.setPadding(dp(left),dp(top),dp(right),dp(bottom));}
    private Button action(String label,Runnable click,boolean primary){
        Button b=new Button(this);b.setText(label);b.setAllCaps(false);b.setTextSize(13);
        b.setTypeface(Typeface.DEFAULT,Typeface.BOLD);b.setTextColor(primary?WHITE:0xFFD8DBFF);
        b.setBackground(shape(primary?0xFF6C59EA:0xFF242C47,primary?0:STROKE,12));
        b.setMinHeight(dp(45));b.setMinimumHeight(dp(45));
        b.setOnClickListener(v->click.run());return b;
    }
    private LinearLayout card(){LinearLayout c=vertical();pad(c,16,16,16,16);c.setBackground(shape(CARD,STROKE,18));return c;}
    private LinearLayout.LayoutParams fullWithBottom(int bottom){LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);p.bottomMargin=dp(bottom);return p;}
    private void begin(String eyebrow,String title,String summary){
        root=vertical();root.setBackgroundColor(BG);setContentView(root);
        LinearLayout header=vertical();pad(header,20,17,20,15);root.addView(header);
        header.addView(text("C I N E P U L S   •   M O B I L E",11,GREEN,true));space(header,8);
        header.addView(text(title,26,WHITE,true));space(header,7);
        header.addView(text(summary,13,MUTED,false));
        ScrollView scroll=new ScrollView(this);scroll.setFillViewport(false);scroll.setVerticalScrollBarEnabled(false);
        root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
        content=vertical();pad(content,18,12,18,40);scroll.addView(content);
    }
    private void showError(String message){
        String safe=message==null?"Unexpected error":message;
        // Never display untrusted token or signed URLs, even if server accidentally returns one.
        safe=safe.replaceAll("(?i)Bearer\\s+[^\\s]+","Bearer [redacted]")
                .replaceAll("(?i)([?&](sig|token)=)[^&\\s]+","$1[redacted]");
        if(safe.length()>260)safe=safe.substring(0,260)+"…";
        new AlertDialog.Builder(this).setTitle("CinePulse").setMessage(safe).setPositiveButton("OK",null).show();
    }
    private <T> void task(String status,Callable<T> work,Consumer<T> result){
        if(busy){Toast.makeText(this,"Another operation is running",Toast.LENGTH_SHORT).show();return;}
        busy=true;Toast.makeText(this,status,Toast.LENGTH_SHORT).show();
        io.execute(()->{
            try{T value=work.call();handler.post(()->{busy=false;result.accept(value);});}
            catch(Exception e){handler.post(()->{busy=false;showError(e.getMessage());});}
        });
    }
    private void showConnect(){
        begin("CONNECT","Secure connection","Your CinePulse worker and movie data stay in Cloudflare. This phone holds only an encrypted access token.");
        LinearLayout c=card();content.addView(c,fullWithBottom(14));
        c.addView(text("Connect your existing workspace",19,WHITE,true));space(c,9);
        c.addView(text("Cloudflare endpoint",12,MUTED,false));space(c,5);
        c.addView(text(SecurityRules.BASE,12,GREEN,false));space(c,16);
        c.addView(text("Administrator bearer token",13,WHITE,true));space(c,6);
        EditText input=new EditText(this);input.setSingleLine(true);input.setTextColor(WHITE);input.setHintTextColor(MUTED);
        input.setHint("Paste token privately");input.setTextSize(15);
        input.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);
        input.setAutofillHints();c.addView(input);space(c,12);
        c.addView(action("Connect securely",()->{
            String token=input.getText().toString().trim();input.setText("");
            task("Checking connection",()->{
                tokens.save(token);
                try{return api.workers();}
                catch(Exception e){tokens.clear();throw e;}
            },j->refresh());
        },true),fullWithBottom(10));
        c.addView(text("Security note: the current Cloudflare API grants this token administrator access. Use only on your own protected phone; a future backend update should issue limited mobile-session tokens.",12,MUTED,false));
    }
    private void refresh(){
        if(openedProject!=null){loadDetail(openedProject);return;}
        task("Refreshing CinePulse",()->{
            JSONObject p=api.projects();JSONObject w=api.workers();
            return new JSONArray[]{p.getJSONArray("projects"),w.getJSONArray("workers")};
        },values->{projects=values[0];workers=values[1];renderHome();});
    }
    private void renderHome(){
        begin("WORKSPACE","Your movies","A light control center for Muse and CinePulse Windows.");
        LinearLayout actions=horizontal();content.addView(actions,fullWithBottom(14));
        Button add=action("+ New movie",this::chooseSrt,true);
        actions.addView(add,new LinearLayout.LayoutParams(0,dp(48),1));
        Button sync=action("Refresh",this::refresh,false);LinearLayout.LayoutParams rp=new LinearLayout.LayoutParams(dp(110),dp(48));rp.leftMargin=dp(8);actions.addView(sync,rp);
        LinearLayout info=card();content.addView(info,fullWithBottom(14));
        info.addView(text("CLOUDFLARE PIPELINE",11,GREEN,true));space(info,6);
        info.addView(text(projects.length()+" movie projects  •  "+workers.length()+" workers",20,WHITE,true));space(info,4);
        info.addView(text("Movie AI production runs in Cloudflare/Muse. Video rendering remains on your Windows PC.",12,MUTED,false));
        LinearLayout bar=horizontal();content.addView(bar,fullWithBottom(12));
        int visible=0,hidden=0;
        for(int i=0;i<projects.length();i++){
            JSONObject item=projects.optJSONObject(i);
            if(item==null)continue;
            if("active".equals(localState(item.optString("id"))))visible++;else hidden++;
        }
        bar.addView(text((viewingArchive?"ARCHIVED":"ACTIVE")+" MOVIES ("+(viewingArchive?hidden:visible)+")",12,MUTED,true),new LinearLayout.LayoutParams(0,-2,1));
        TextView settings=text("Connection settings",12,PURPLE,true);settings.setOnClickListener(v->confirmDisconnect());bar.addView(settings);
        content.addView(action(viewingArchive?"← Show active movies":"Show archived / reviewed ("+hidden+")",
            ()->{viewingArchive=!viewingArchive;renderHome();},false),fullWithBottom(12));
        if(projects.length()==0){
            LinearLayout c=card();content.addView(c,fullWithBottom(12));
            c.addView(text("No projects listed yet",17,WHITE,true));space(c,8);
            c.addView(text("Choose an original movie SRT to start a new Muse project, or tap Refresh to retrieve an existing Cloudflare project.",13,MUTED,false));
        }
        for(int i=0;i<projects.length();i++){
            JSONObject p=projects.optJSONObject(i);if(p==null)continue;
            String id=p.optString("id"),name=p.optString("title","Untitled"),status=p.optString("status","unknown");
            boolean archived=!"active".equals(localState(id));
            if(viewingArchive!=archived)continue;
            LinearLayout c=card();content.addView(c,fullWithBottom(10));
            LinearLayout row=horizontal();c.addView(row);
            row.addView(text(name,17,WHITE,true),new LinearLayout.LayoutParams(0,-2,1));
            TextView state=text(status.toUpperCase(),10,status.equals("ready")?GREEN:PURPLE,true);pad(state,8,5,8,5);
            state.setBackground(shape(0xFF242C47,0,9));row.addView(state);
            space(c,8);c.addView(text("#"+SecurityRules.shortId(id)+"  •  Retention "+p.optInt("retentionHours",48)+"h",12,MUTED,false));
            long started=TimelineMetrics.time(p,"createdAt","created_at");
            long finished=TimelineMetrics.time(p,"readyAt","ready_at","completedAt","finishedAt");
            if(started>0){
                space(c,6);
                c.addView(text("Submitted "+TimelineMetrics.date(started),12,MUTED,false));
                c.addView(text((finished>0?"Total project time: ":"Elapsed since submission: ")
                    +TimelineMetrics.interval(started,finished,System.currentTimeMillis()),12,
                    finished>0?GREEN:MUTED,false));
            }
            space(c,12);Button open=action(status.equals("ready")?"View & download package →":"View timeline →",()->loadDetail(id),false);
            c.addView(open,new LinearLayout.LayoutParams(-1,dp(42)));
            space(c,6);
            if(archived)c.addView(action("Restore to active list",()->{setLocalState(id,"active");renderHome();},false));
            else if(terminalStatus(status))c.addView(action("Mark reviewed & archive",()->archiveDialog(id,status,true),false));
            if("reviewed".equals(localState(id)))c.addView(text("✓ Reviewed on this device",11,GREEN,false));
        }
        space(content,12);
        content.addView(text("WORKERS",12,MUTED,true),fullWithBottom(11));
        for(int i=0;i<workers.length();i++){
            JSONObject w=workers.optJSONObject(i);if(w==null)continue;
            LinearLayout c=card();content.addView(c,fullWithBottom(10));
            c.addView(text(w.optString("label","Worker"),15,WHITE,true));space(c,4);
            boolean paused=w.optBoolean("paused");
            c.addView(text(paused?"Paused":"Available" ,12,paused?MUTED:GREEN,false));space(c,9);
            String id=w.optString("id");c.addView(action(paused?"Resume worker":"Pause worker",()->toggleWorker(id,!paused),false));
        }
        content.addView(action("+ Create isolated Muse worker",this::createWorkerDialog,false),fullWithBottom(15));
        content.addView(text("Designed for Android 8+ including Galaxy S9+. No background video rendering, continuous sync service or phone-wide file permissions.",12,MUTED,false));
    }
    private void confirmDisconnect(){new AlertDialog.Builder(this).setTitle("Disconnect this device?")
        .setMessage("This deletes the encrypted token from this phone. Cloud projects and Windows data remain unchanged.")
        .setNegativeButton("Cancel",null).setPositiveButton("Disconnect",(d,w)->{tokens.clear();projects=new JSONArray();workers=new JSONArray();openedProject=null;showConnect();}).show();}
    private void toggleWorker(String id,boolean pause){
        new AlertDialog.Builder(this).setTitle(pause?"Pause this worker?":"Resume this worker?")
            .setMessage("This pauses/resumes the assigned Cloudflare worker, including any OTHER movie jobs assigned to that same worker. It does not pause or erase unrelated workers or completed outputs.")
            .setNegativeButton("Cancel",null)
            .setPositiveButton(pause?"Pause":"Resume",(d,w)->task("Updating worker",()->api.toggleWorker(id,pause),r->refresh())).show();
    }
    private void createWorkerDialog(){
        EditText name=new EditText(this);name.setSingleLine(true);name.setHint("Movie worker name");
        new AlertDialog.Builder(this).setTitle("New isolated worker")
            .setMessage("Each worker has a separate Cloudflare queue. The worker secret is displayed only once and is not stored by this app.")
            .setView(name).setNegativeButton("Cancel",null)
            .setPositiveButton("Create",(d,w)->{
                String label=name.getText().toString().trim();
                if(label.isEmpty()||label.length()>120){showError("Choose a name under 120 characters");return;}
                task("Creating worker",()->api.createWorker(label),r->{
                    String secret=r.optString("token","");
                    new AlertDialog.Builder(this).setTitle("Worker created")
                        .setMessage("Save the pairing secret through your private Muse setup now. It will not appear again here.\n\n"+secret)
                        .setPositiveButton("I saved it",(x,y)->refresh()).setCancelable(false).show();
                });
            }).show();
    }
    private void chooseSrt(){
        if(workers.length()==0){showError("Create a Muse worker first, then choose the original movie SRT.");return;}
        Intent pick=new Intent(Intent.ACTION_OPEN_DOCUMENT);
        pick.setType("*/*");pick.addCategory(Intent.CATEGORY_OPENABLE);
        pick.putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"application/x-subrip","text/plain","application/octet-stream"});
        startActivityForResult(pick,PICK_SRT);
    }
    private void submitSrt(Uri uri){
        EditText name=new EditText(this);name.setSingleLine(true);name.setHint("Movie title");
        String file=uri.getLastPathSegment();if(file!=null){String base=file.substring(file.lastIndexOf('/')+1);name.setText(base.replaceFirst("(?i)\\.srt$",""));}
        List<String> labels=new ArrayList<>(),ids=new ArrayList<>();
        for(int i=0;i<workers.length();i++){
            JSONObject w=workers.optJSONObject(i);
            if(w!=null && w.optBoolean("enabled",true) && !w.optBoolean("paused")){
                labels.add(w.optString("label")+"  (#"+SecurityRules.shortId(w.optString("id"))+")");
                ids.add(w.optString("id"));
            }
        }
        if(ids.isEmpty()){showError("There are no active workers. Resume or create a worker first.");return;}
        LinearLayout form=vertical();pad(form,24,0,24,0);
        form.addView(text("Project title",13,Color.DKGRAY,true));form.addView(name);
        EditText minutes=new EditText(this);
        minutes.setSingleLine(true);
        minutes.setInputType(InputType.TYPE_CLASS_NUMBER);
        minutes.setText("15");
        minutes.setHint("Narration minutes (3–60)");
        form.addView(text("Desired narration length (minutes; each language)",13,Color.DKGRAY,true));
        form.addView(minutes);
        form.addView(text("Muse will aim for this duration once the Cloudflare backend accepts targetMinutes. MP3/STT duration is verified after generation.",12,Color.DKGRAY,false));
        form.addView(text("Processing worker",13,Color.DKGRAY,true));
        Spinner spinner=new Spinner(this);
        ArrayAdapter<String> adapter=new ArrayAdapter<>(this,android.R.layout.simple_spinner_dropdown_item,labels);
        spinner.setAdapter(adapter);form.addView(spinner);
        new AlertDialog.Builder(this).setTitle("Send movie to Muse")
            .setMessage("Only the selected SRT text will be uploaded, never the source movie video. Worker queues stay isolated.")
            .setView(form).setNegativeButton("Cancel",null)
            .setPositiveButton("Submit",(d,w)->{
                String title=name.getText().toString().trim();
                if(title.isEmpty()||title.length()>160){showError("Enter a project title under 160 characters");return;}
                int target;
                try{target=Integer.parseInt(minutes.getText().toString().trim());}
                catch(NumberFormatException e){showError("Enter a narration duration from 3 to 60 minutes.");return;}
                if(target<3||target>60){showError("Narration duration must be 3–60 minutes.");return;}
                String worker=ids.get(spinner.getSelectedItemPosition());
                task("Uploading subtitle",()->{
                    String srt=readSrt(uri);return api.createProject(title,worker,srt,48,target);
                },r->{
                    int accepted=r.optInt("targetMinutes",-1);
                    new AlertDialog.Builder(this).setTitle("Movie queued")
                        .setMessage(accepted==target?
                            "Cloudflare accepted the "+target+"-minute narration target for each language.":
                            "Movie submitted, but the current backend did NOT confirm the "+target+"-minute narration target. Update Cloudflare before relying on narration length control.")
                        .setPositiveButton("View projects",(innerDialog,innerWhich)->refresh()).show();
                });
            }).show();
    }
    private String readSrt(Uri uri) throws Exception {
        try(InputStream in=getContentResolver().openInputStream(uri);ByteArrayOutputStream bytes=new ByteArrayOutputStream()){
            if(in==null)throw new IllegalArgumentException("Cannot read selected SRT");
            int n,total=0;byte[] buf=new byte[8192];while((n=in.read(buf))!=-1){
                total+=n;if(total>SecurityRules.MAX_SRT_BYTES)throw new IllegalArgumentException("SRT exceeds 2 MiB");
                bytes.write(buf,0,n);
            }
            String srt=bytes.toString(StandardCharsets.UTF_8.name()).replace("\uFEFF", "").trim();
            if(!srt.contains("-->")||srt.length()<15)throw new IllegalArgumentException("File does not appear to be an SRT subtitle");
            return srt;
        }
    }
    private void loadDetail(String projectId){
        if(!SecurityRules.validUuid(projectId)){showError("Invalid project ID");return;}
        openedProject=projectId;
        task("Loading movie progress",()->{
            JSONObject data=api.project(projectId);
            if(data.optJSONObject("worker")==null){
                try {
                    JSONObject list=api.workers();
                    JSONArray found=list.optJSONArray("workers");
                    String workerId=data.optJSONObject("project").optString("workerId");
                    if(found!=null)for(int i=0;i<found.length();i++){
                        JSONObject w=found.optJSONObject(i);
                        if(w!=null&&workerId.equals(w.optString("id"))){data.put("worker",w);break;}
                    }
                } catch(Exception ignored) {
                    // The project timeline remains available if worker status fails to refresh.
                }
            }
            if("needs_review".equals(data.optJSONObject("project").optString("status"))){
                try {data.put("recoveryCapabilities",api.recovery(projectId));}
                catch(Exception error) {
                    data.put("recoveryUnavailable",error.getMessage()!=null&&error.getMessage().contains("(404)")
                        ?"Retry endpoint not deployed on Cloudflare yet. Install the matching backend repair update."
                        :"Unable to load recovery options. Refresh or check the backend.");
                }
            }
            return data;
        },this::renderDetail);
    }
    private void renderDetail(JSONObject document){
        JSONObject project=document.optJSONObject("project");if(project==null){showError("Project response incomplete");return;}
        String id=project.optString("id"),status=project.optString("status");
        openedProject=id;
        begin("MOVIE",project.optString("title","Movie"),"Project #"+SecurityRules.shortId(id)+"  ·  "+status.toUpperCase());
        content.addView(action("← All movies",()->{openedProject=null;renderHome();},false),fullWithBottom(15));
        LinearLayout summary=card();content.addView(summary,fullWithBottom(14));
        summary.addView(text(status.equals("ready")?"Production package ready":"Muse workflow in progress",18,WHITE,true));space(summary,6);
        summary.addView(text(status.equals("ready")?"Original JSON and both MP3 files are ready. One tap downloads the verified package into Downloads/CinePulse.":
            "Muse/Cloudflare processing happens on the backend. You may close this app after successful submission, but a Muse worker must remain connected.",13,MUTED,false));
        space(summary,12);
        if(status.equals("ready")){
            summary.addView(action("Download JSON + English/Urdu MP3s",()->startPackageDownload(id),true));
            space(summary,7);
            summary.addView(action("Verify and share complete ZIP (WhatsApp)",()->shareProjectZip(id),false));
        }
        int target=project.optInt("targetMinutes",-1);
        space(summary,8);
        summary.addView(text(target>0?"Narration target: "+target+" minutes per language":"Narration target: not reported by Cloudflare",12,MUTED,false));
        if(terminalStatus(status)){
            space(summary,7);
            summary.addView(action("Mark reviewed & archive locally",()->archiveDialog(id,status,true),false));
            space(summary,7);
            summary.addView(action("Delete movie permanently from Cloudflare",()->permanentlyDelete(id,status),false));
        }else{
            space(summary,7);
            summary.addView(action("Hide movie from my active list",()->archiveDialog(id,status,false),false));
        }
        space(summary,7);
        summary.addView(action("Refresh production stages",()->loadDetail(id),false));
        JSONArray jobs=document.optJSONArray("jobs");
        renderProjectClock(project,jobs);
        renderRecoveryControls(id,document);
        JSONObject worker=document.optJSONObject("worker");
        JSONObject nudgePolicy=document.optJSONObject("nudgePolicy");
        renderWorkerHealth(worker,nudgePolicy);
        renderStageTimeline(jobs,document.optJSONArray("assets"),worker,nudgePolicy,id);

        int failures=0;
        if(jobs!=null)for(int i=0;i<jobs.length();i++){
            JSONObject j=jobs.optJSONObject(i);
            if(j!=null && ("error".equalsIgnoreCase(j.optString("status")) || "failed".equalsIgnoreCase(j.optString("status"))))failures++;
        }
        LinearLayout diagnostics=card();content.addView(diagnostics,fullWithBottom(15));
        diagnostics.addView(text("ERRORS & RETRIES",12,GREEN,true));space(diagnostics,7);
        diagnostics.addView(text(failures==0
            ?"No failed jobs reported by the project API. Background processing depends on your remote Muse worker, not this phone."
            :failures+" failed stage(s) reported above. Review the error and refresh to see backend-managed retry attempts.",13,MUTED,false));
        space(diagnostics,8);
        diagnostics.addView(action("Recheck jobs and retry status",()->loadDetail(id),false));
        content.addView(text("ASSETS",12,MUTED,true),fullWithBottom(12));
        JSONArray assets=document.optJSONArray("assets");
        if(assets!=null)for(int i=0;i<assets.length();i++){
            JSONObject a=assets.optJSONObject(i);if(a==null)continue;
            content.addView(text("✓  "+a.optString("kind")+"  ·  "+readableBytes(a.optLong("bytes", -1)),13,MUTED,false),fullWithBottom(7));
        }
        space(content,16);content.addView(text("Scene matching and final video rendering are completed on CinePulse Windows, using the original movie file.",12,MUTED,false));
    }
    private void renderRecoveryControls(String projectId,JSONObject document){
        LinearLayout c=card();content.addView(c,fullWithBottom(14));
        c.addView(text("RECOVER FAILED MOVIE",13,GREEN,true));space(c,7);
        c.addView(text("Only a terminal needs_review project can be retried. For defective audio, regenerate MP3 first; restarting only SRT reuses the bad file.",13,MUTED,false));
        space(c,8);
        JSONObject recovery=document.optJSONObject("recoveryCapabilities");
        if(recovery==null){
            c.addView(text("Retry status: unavailable until Cloudflare exposes /v1/projects/:id/recovery",12,0xFFFFC47E,true));
            c.addView(text(document.optString("recoveryUnavailable","Backend recovery capabilities not reported. The Android APK cannot create Muse jobs by itself."),12,MUTED,false));
            c.addView(text("Requested recovery options: Regenerate English MP3 → English SRT; Regenerate Urdu MP3 → Urdu SRT; Retry failed stage. These actions activate only after verified backend deployment.",12,MUTED,false));
            return;
        }
        JSONArray options=recovery.optJSONArray("options");
        if(!"needs_review".equals(document.optJSONObject("project").optString("status"))){
            c.addView(text("No failed project to repair. Retry is enabled only after a real terminal failure.",12,MUTED,false));
            return;
        }
        if(!recovery.optBoolean("canRetry")||options==null||options.length()==0){
            c.addView(text("No safe retry option currently available. "+TimelineMetrics.safeLabel(recovery.optString("notice"),180),12,MUTED,false));
            return;
        }
        c.addView(text("Failed stage: "+TimelineMetrics.stageLabel(recovery.optString("failedStage")),12,MUTED,false));
        if(recovery.optBoolean("workerPaused"))c.addView(text("Worker is paused; a recovered task will wait until you resume it.",12,0xFFFFC47E,false));
        for(int i=0;i<Math.min(4,options.length());i++){
            JSONObject option=options.optJSONObject(i);if(option==null)continue;
            String step=option.optString("stepId");
            if(step.isEmpty())continue;
            boolean recommended=option.optBoolean("recommended");
            space(c,8);
            c.addView(action((recommended?"Recommended: ":"")+option.optString("label",TimelineMetrics.stageLabel(step)),
                ()->confirmRecovery(projectId,step,option),recommended));
            if(!option.optString("warning").isEmpty())
                c.addView(text(TimelineMetrics.safeLabel(option.optString("warning"),240),11,MUTED,false));
        }
        space(c,9);
        c.addView(text("A request is not a job claim: the existing assigned Muse worker must be online and polling to execute it. No other movie is restarted.",11,MUTED,false));
    }
    private void confirmRecovery(String projectId,String step,JSONObject option){
        String description=option.optString("label",TimelineMetrics.stageLabel(step));
        String warning=option.optString("warning","");
        String message="Project stays the same. Recovery creates a NEW queued task under the same Muse worker. Successful earlier outputs remain intact. Historical failures remain visible.";
        if(!warning.isEmpty())message+="\n\n"+warning;
        if("mp3_english".equals(step)||"mp3_urdu".equals(step))
            message+="\n\nThe old audio is archived on Cloudflare before it is invalidated. Wait for Muse to generate and verify the replacement MP3.";
        new AlertDialog.Builder(this).setTitle("Confirm: "+description)
            .setMessage(message)
            .setNegativeButton("Cancel",null)
            .setPositiveButton("Queue recovery",(d,w)->task("Queuing recovery safely",()->api.repairStage(projectId,step),result->{
                String summary=result.optString("message","Recovery request accepted. Refresh the project.");
                new AlertDialog.Builder(this).setTitle("Recovery queued")
                    .setMessage(summary+"\n\nStage: "+TimelineMetrics.stageLabel(step))
                    .setPositiveButton("View timeline",(dialog,index)->loadDetail(projectId))
                    .show();
            })).show();
    }
    /** Display real server timestamps. Queue+execution is never called pure Muse execution time. */
    private void renderProjectClock(JSONObject p, JSONArray jobs){
        long created=TimelineMetrics.time(p,"createdAt","created_at");
        long finished=TimelineMetrics.time(p,"readyAt","ready_at","completedAt","finishedAt");
        if(finished<=0 && "ready".equals(p.optString("status")) && jobs!=null){
            for(int i=0;i<jobs.length();i++){
                JSONObject job=jobs.optJSONObject(i);
                if(job!=null && "done".equals(job.optString("status")))
                    finished=Math.max(finished,TimelineMetrics.time(job,"finishedAt","finished_at"));
            }
        }
        LinearLayout c=card();content.addView(c,fullWithBottom(14));
        c.addView(text("PROJECT TIMING",12,GREEN,true));space(c,8);
        c.addView(text("Submitted: "+TimelineMetrics.date(created),13,WHITE,false));
        c.addView(text("Completed: "+TimelineMetrics.date(finished),13,MUTED,false));
        if(created>0){
            space(c,6);
            c.addView(text((finished>0?"Total submission-to-completion: ":"Elapsed since submission: ")
                +TimelineMetrics.interval(created,finished,System.currentTimeMillis()),
                16,finished>0?GREEN:PURPLE,true));
        }else c.addView(text("Total duration: not reported by Cloudflare",13,MUTED,false));
        space(c,6);
        c.addView(text("Times shown in your phone's timezone. Running durations update on Refresh; completed times are retained only while Cloudflare retains the project.",11,MUTED,false));
    }
    private static String attemptsOf(JSONObject job){
        Object raw=job.opt("attemptCount");
        if(raw==null||raw==JSONObject.NULL)raw=job.opt("attempt");
        if(raw==null||raw==JSONObject.NULL)raw=job.opt("attempts");
        if(raw instanceof JSONArray)return String.valueOf(((JSONArray)raw).length());
        if(raw instanceof Number)return String.valueOf(((Number)raw).intValue());
        if(raw instanceof String && ((String)raw).matches("[0-9]{1,6}"))return (String)raw;
        return "Not reported by backend";
    }
    private void renderStageTimeline(JSONArray jobs,JSONArray assets,JSONObject worker,JSONObject nudgePolicy,String projectId){
        content.addView(text("PRODUCTION TIMELINE",12,MUTED,true),fullWithBottom(12));
        if(jobs==null||jobs.length()==0){
            LinearLayout c=card();content.addView(c,fullWithBottom(10));
            c.addView(text("No job records returned yet. Use Refresh to check the server.",13,MUTED,false));
            return;
        }
        for(int i=0;i<jobs.length();i++){
            JSONObject j=jobs.optJSONObject(i);if(j==null)continue;
            String name=j.optString("stepId","stage"),state=j.optString("status","unknown");
            long queued=TimelineMetrics.time(j,"createdAt","created_at","queuedAt");
            long claimed=TimelineMetrics.time(j,"startedAt","started_at","claimedAt","claimed_at");
            long ended=TimelineMetrics.time(j,"finishedAt","finished_at","completedAt");
            LinearLayout c=card();content.addView(c,fullWithBottom(9));
            LinearLayout heading=horizontal();c.addView(heading);
            heading.addView(text((i+1)+". "+TimelineMetrics.stageLabel(name),14,WHITE,true),
                new LinearLayout.LayoutParams(0,-2,1));
            boolean ok="done".equalsIgnoreCase(state);
            int color=ok?GREEN:("error".equalsIgnoreCase(state)||"failed".equalsIgnoreCase(state))?0xFFFF9B9B:PURPLE;
            heading.addView(text(state.toUpperCase(java.util.Locale.ROOT),10,color,true));
            space(c,7);
            c.addView(text("Queued: "+TimelineMetrics.date(queued),12,MUTED,false));
            c.addView(text("Muse started: "+TimelineMetrics.date(claimed),12,MUTED,false));
            c.addView(text("Finished: "+TimelineMetrics.date(ended),12,MUTED,false));
            space(c,5);
            String active=ok||"error".equals(state)||"failed".equals(state)?"":" (as of refresh)";
            if(claimed>0){
                c.addView(text("Muse execution time: "+TimelineMetrics.interval(claimed,ended,System.currentTimeMillis()),13,GREEN,false));
                if(queued>0 && claimed>=queued)c.addView(text("Time waiting in queue: "+
                    TimelineMetrics.duration(claimed-queued),12,MUTED,false));
            }else if(queued>0){
                c.addView(text("Since queued (waiting + processing): "+TimelineMetrics.interval(queued,ended,System.currentTimeMillis())+active,12,PURPLE,false));
                c.addView(text("Pure Muse execution time unavailable until backend reports startedAt.",11,MUTED,false));
            }
            c.addView(text("Muse attempts: "+attemptsOf(j),12,MUTED,false));
            if("queued".equalsIgnoreCase(state))renderQueuedNudge(c,j,worker,nudgePolicy,projectId);
            else showNudgeHistory(c,j);
            String problem=j.optString("error","");
            if(!problem.isEmpty()){
                space(c,6);
                c.addView(text("Failure: "+TimelineMetrics.safeLabel(problem,180),12,0xFFFF9B9B,false));
            }
            showBackendMilestones(c,j);
            if("digest".equals(name))renderDigestCheckpoints(c,j,assets);
        }
    }
    private static boolean workerRecentlyOnline(JSONObject worker,long now){
        if(worker==null||!worker.optBoolean("enabled",true)||worker.optBoolean("paused"))return false;
        long last=TimelineMetrics.time(worker,"lastSeen","last_seen");
        return last>0 && now>=last && now-last<=180000L;
    }
    private void renderWorkerHealth(JSONObject worker,JSONObject policy){
        LinearLayout c=card();content.addView(c,fullWithBottom(14));
        c.addView(text("MUSE WORKER & QUEUE CONTROL",12,GREEN,true));space(c,8);
        long now=System.currentTimeMillis();
        long last=TimelineMetrics.time(worker,"lastSeen","last_seen");
        String state=worker==null?"Worker status not available":
            worker.optBoolean("paused")?"Paused":
            !worker.optBoolean("enabled",true)?"Disabled":
            workerRecentlyOnline(worker,now)?"Recently connected":"Offline / no recent queue poll";
        c.addView(text("Worker: "+(worker==null?"Not reported":worker.optString("label","Muse worker")),14,WHITE,true));
        c.addView(text("Status: "+state,12,workerRecentlyOnline(worker,now)?GREEN:MUTED,false));
        c.addView(text("Last Cloudflare poll: "+TimelineMetrics.date(last),12,MUTED,false));
        space(c,9);
        if(policy!=null&&policy.optBoolean("enabled")){
            c.addView(text("Manual Nudge at 10 minutes · automatic queue check every 5 minutes",12,GREEN,false));
            c.addView(text("A nudge signals the connected worker; only a real Muse claim starts processing. Cooldown: 5 minutes.",11,MUTED,false));
        }else{
            c.addView(text("Muse nudge backend is not deployed or not reporting capability yet.",12,0xFFFFC47E,false));
            c.addView(text("Install the updated Cloudflare Worker before expecting the Nudge button to start a task. Existing Muse processing continues normally.",11,MUTED,false));
        }
        if(worker!=null && SecurityRules.validUuid(worker.optString("id"))){
            String wid=worker.optString("id");
            boolean paused=worker.optBoolean("paused");
            space(c,7);
            c.addView(action(paused?"Resume assigned Muse worker":"Pause assigned Muse worker",
                ()->toggleWorker(wid,!paused),false));
            c.addView(text("Affects all jobs assigned to this worker, never other workers. A currently leased task may finish before pause takes effect.",11,MUTED,false));
        }
        space(c,8);c.addView(action("Refresh worker & queued tasks",()->loadDetail(openedProject),false));
    }
    private void renderQueuedNudge(LinearLayout c,JSONObject job,JSONObject worker,JSONObject policy,String projectId){
        long queued=TimelineMetrics.time(job,"createdAt","created_at");
        long elapsed=queued>0?Math.max(0,System.currentTimeMillis()-queued):0;
        if(elapsed<600000L)return;
        space(c,9);
        boolean urgent=elapsed>=900000L;
        c.addView(text((urgent?"QUEUED OVER 15 MINUTES":"QUEUED OVER 10 MINUTES")+
            " · "+TimelineMetrics.duration(elapsed),12,urgent?0xFFFFC47E:PURPLE,true));
        boolean available=workerRecentlyOnline(worker,System.currentTimeMillis());
        if(worker!=null&&worker.optBoolean("paused"))c.addView(text("Muse worker paused. Resume from Workers, then refresh.",12,MUTED,false));
        else if(!available)c.addView(text("Muse has not checked the cloud queue recently. Open/reconnect the dedicated Muse worker first.",12,MUTED,false));
        else c.addView(text("Worker recently connected. Request a safe queue check without duplicating this job.",12,MUTED,false));
        if(policy==null||!policy.optBoolean("enabled")){
            c.addView(text("Backend update required for actual nudge requests.",11,0xFFFFC47E,false));
        }else if(available){
            space(c,7);
            final String jobId=job.optString("id","");
            if(SecurityRules.validUuid(jobId))
                c.addView(action("Nudge Muse — check queued task",()->confirmNudge(jobId,projectId),true));
        }
        showNudgeHistory(c,job);
    }
    private void showNudgeHistory(LinearLayout card,JSONObject job){
        JSONArray nudges=job.optJSONArray("nudges");
        if(nudges==null||nudges.length()==0)return;
        space(card,7);card.addView(text("NUDGE HISTORY",11,GREEN,true));
        for(int i=0;i<Math.min(8,nudges.length());i++){
            JSONObject n=nudges.optJSONObject(i);if(n==null)continue;
            String state=n.optString("state","pending"),source=n.optString("source","manual");
            long when=TimelineMetrics.time(n,"requestedAt");
            String detail="claimed".equals(state)?"Worker claimed the task":
                "observed".equals(state)?"Worker saw the signal (not claimed yet)":
                "pending".equals(state)?"Signal waiting for worker poll":state;
            card.addView(text(source+" · "+TimelineMetrics.date(when),11,MUTED,false));
            card.addView(text(detail,12,"claimed".equals(state)?GREEN:PURPLE,false));
        }
    }
    private void confirmNudge(String jobId,String projectId){
        new AlertDialog.Builder(this)
            .setTitle("Nudge this Muse task?")
            .setMessage("This asks the assigned worker to check its existing Cloudflare queue. It does not restart, duplicate, or forcibly claim a task. A closed Muse session cannot be awakened.")
            .setNegativeButton("Cancel",null)
            .setPositiveButton("Send nudge",(dialog,which)->task("Sending safe Muse nudge",()->{
                try{return api.nudge(jobId);}
                catch(Exception e){
                    String msg=e.getMessage()==null?"":e.getMessage();
                    if(msg.contains("(404)"))throw new IllegalStateException("The Cloudflare Nudge endpoint is not deployed yet. Install the backend patch before using this control.");
                    throw e;
                }
            },result->{
                boolean accepted=result.optBoolean("accepted",false);
                String message=result.optString("message","No server confirmation received");
                new AlertDialog.Builder(this)
                    .setTitle(accepted?"Nudge request recorded":"Muse nudge not accepted")
                    .setMessage(message+"\n\nOnly a later worker claim changes the job to Working.")
                    .setPositiveButton("Refresh status",(d,w)->loadDetail(projectId)).show();
            })).show();
    }
    private void showBackendMilestones(LinearLayout card,JSONObject job){
        JSONObject progress=job.optJSONObject("progress");
        if(progress==null)progress=job.optJSONObject("currentProgress");
        if(progress!=null){
            String label=progress.optString("label",progress.optString("stage",""));
            String message=progress.optString("message","");
            int done=progress.optInt("completedChunks",-1);
            int total=progress.optInt("totalChunks",-1);
            int percent=progress.optInt("percent",-1);
            if(!label.isEmpty()||!message.isEmpty()||(total>0&&done>=0)||percent>=0){
                space(card,9);
                card.addView(text("MUSE LIVE CHECKPOINT",11,GREEN,true));
                if(!label.isEmpty())card.addView(text(TimelineMetrics.safeLabel(label,100),12,WHITE,true));
                if(!message.isEmpty())card.addView(text(TimelineMetrics.safeLabel(message,180),12,MUTED,false));
                if(total>0&&done>=0)card.addView(text("Chunks: "+Math.min(done,total)+"/"+total,12,PURPLE,true));
                if(percent>=0&&percent<=100)card.addView(text("Backend-reported progress: "+percent+"%",12,PURPLE,true));
                long updated=TimelineMetrics.time(progress,"updatedAt","at","timestamp");
                if(updated>0)card.addView(text("Last Muse update: "+TimelineMetrics.date(updated),11,MUTED,false));
            }
        }
        JSONArray steps=job.optJSONArray("substeps");
        if(steps==null)steps=job.optJSONArray("milestones");
        if(steps==null)steps=job.optJSONArray("segments");
        if(steps==null && progress!=null)steps=progress.optJSONArray("steps");
        if(steps!=null && steps.length()>0){
            space(card,9);card.addView(text("DETAILED MUSE STEPS",11,GREEN,true));
            int count=Math.min(steps.length(),150);
            for(int i=0;i<count;i++){
                JSONObject step=steps.optJSONObject(i);
                if(step==null)continue;
                String label=step.optString("label",step.optString("name","Chunk "+(i+1)));
                String state=step.optString("status","recorded");
                card.addView(text((i+1)+". "+TimelineMetrics.safeLabel(label,100)+"  ·  "+TimelineMetrics.safeLabel(state,35),12,WHITE,false));
                long began=TimelineMetrics.time(step,"startedAt","startAt");
                long finished=TimelineMetrics.time(step,"finishedAt","endAt");
                if(began>0){
                    card.addView(text("   "+TimelineMetrics.date(began)+"  ·  "+TimelineMetrics.interval(began,finished,System.currentTimeMillis()),11,MUTED,false));
                }
                Object attempt=step.opt("attempt");
                if(attempt instanceof Number)card.addView(text("   Attempt "+attempt,11,MUTED,false));
            }
            if(steps.length()>count)card.addView(text("More steps recorded: "+(steps.length()-count)+".",11,MUTED,false));
        }
        JSONArray retries=job.optJSONArray("attemptHistory");
        if(retries!=null && retries.length()>0){
            space(card,8);card.addView(text("MUSE ATTEMPT HISTORY",11,GREEN,true));
            for(int a=0;a<Math.min(retries.length(),25);a++){
                JSONObject record=retries.optJSONObject(a);if(record==null)continue;
                long first=TimelineMetrics.time(record,"startedAt","claimedAt");
                long last=TimelineMetrics.time(record,"finishedAt","endedAt");
                card.addView(text("Attempt "+(a+1)+"  ·  "+record.optString("status","unknown")
                    +"  ·  "+TimelineMetrics.interval(first,last,System.currentTimeMillis()),12,MUTED,false));
            }
        }
    }
    private void renderDigestCheckpoints(LinearLayout card,JSONObject job,JSONArray assets){
        space(card,9);card.addView(text("DIGEST BREAKDOWN",11,GREEN,true));
        boolean received=false;
        if(assets!=null)for(int i=0;i<assets.length();i++){
            JSONObject item=assets.optJSONObject(i);
            if(item!=null&&"source_srt".equals(item.optString("kind")))received=true;
        }
        card.addView(text((received?"✓":"○")+" Source SRT stored in Cloudflare",12,received?GREEN:MUTED,false));
        long queued=TimelineMetrics.time(job,"createdAt");
        card.addView(text((queued>0?"✓":"○")+" Digest task queued",12,queued>0?GREEN:MUTED,false));
        String status=job.optString("status");
        boolean done="done".equals(status);
        boolean active="working".equals(status);
        card.addView(text((done?"✓":active?"◉":"○")+" Muse digest "+(done?"finished":active?"running":"not yet finished"),12,done?GREEN:MUTED,false));
        if(done)card.addView(text("✓ Digest output accepted by backend",12,GREEN,false));
        JSONObject progress=job.optJSONObject("progress");
        JSONArray sub=job.optJSONArray("substeps");
        if(sub==null)sub=job.optJSONArray("milestones");
        if(sub==null && progress!=null)sub=progress.optJSONArray("steps");
        if(sub==null || sub.length()==0){
            card.addView(text("Inside the digest (story chunks, character analysis, chronology, and scene groups): the current Cloudflare API has not recorded individual Muse checkpoints. They cannot be timed accurately yet.",11,MUTED,false));
        }
    }
    private void shareProjectZip(String id){
        if(!SecurityRules.validUuid(id)){showError("Invalid project ID");return;}
        task("Downloading and verifying complete ZIP",()->{
            JSONObject detail=api.project(id),links=api.downloads(id);
            return new VerifiedDownloads(getContentResolver(),getCacheDir()).createVerifiedZip(id,detail,links,
                step->handler.post(()->Toast.makeText(this,step,Toast.LENGTH_SHORT).show()));
        },result->{
            String excerpt=result.report.length()>1500?result.report.substring(0,1500)+"\n… full report is in ZIP":result.report;
            new AlertDialog.Builder(this).setTitle("Project QA and ZIP ready")
                .setMessage(excerpt+"\n\nThe ZIP includes verified JSON, both MP3s, both SRTs (if present), metadata and this QA report. It does not contain movie footage.")
                .setNegativeButton("Close",null)
                .setPositiveButton("Share ZIP",(d,w)->{
                    try{
                        Uri uri=FileProvider.getUriForFile(this,getPackageName()+".fileprovider",result.file,result.name);
                        Intent send=new Intent(Intent.ACTION_SEND);
                        send.setType("application/zip");
                        send.putExtra(Intent.EXTRA_STREAM,uri);
                        send.setClipData(android.content.ClipData.newRawUri("CinePulse project ZIP",uri));
                        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        startActivity(Intent.createChooser(send,"Share CinePulse ZIP (WhatsApp, Drive, etc.)"));
                    }catch(Exception e){showError("Cannot share ZIP: "+e.getMessage());}
                }).show();
        });
    }
    private void startPackageDownload(String id){
        if(!SecurityRules.validUuid(id)){showError("Invalid movie project");return;}
        if(Build.VERSION.SDK_INT<29 && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)!=PackageManager.PERMISSION_GRANTED){
            pendingDownloadProject=id;
            requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE},STORAGE_PERMISSION);
            return;
        }
        downloadProject(id);
    }
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] grants){
        super.onRequestPermissionsResult(request,permissions,grants);
        if(request==STORAGE_PERMISSION){
            String id=pendingDownloadProject;
            pendingDownloadProject=null;
            if(grants.length>0 && grants[0]==PackageManager.PERMISSION_GRANTED && id!=null)downloadProject(id);
            else showError("Android 8/9 requires storage permission to save files in Downloads. You may enable it in Settings → Apps → CinePulse → Permissions.");
        }
    }
    private void downloadProject(String id){
        task("Downloading 3 files to Downloads/CinePulse",()->{
            // Fresh signed links on every click; verify all files before publishing any.
            JSONObject detail=api.project(id),urls=api.downloads(id);
            return new VerifiedDownloads(getContentResolver(),getCacheDir()).downloadToDownloads(
                id,detail,urls,step->handler.post(()->Toast.makeText(this,step,Toast.LENGTH_SHORT).show()));
        },message->new AlertDialog.Builder(this).setTitle("Verified Windows package downloaded")
            .setMessage(message).setPositiveButton("Done",null).show());
    }
    @Override protected void onActivityResult(int request,int result,Intent data){
        super.onActivityResult(request,result,data);
        if(result!=RESULT_OK||data==null||data.getData()==null)return;
        Uri uri=data.getData();
        if(request==PICK_SRT)submitSrt(uri);

    }
}
