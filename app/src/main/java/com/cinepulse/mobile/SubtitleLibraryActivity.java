package com.cinepulse.mobile;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Callable;
import java.util.function.Consumer;

/**
 * A user-controlled local SRT shelf. Official provider search/download only.
 * Bulk network work runs while screen is open, not as an invisible background task.
 */
public final class SubtitleLibraryActivity extends Activity {
    private static final int BG=0xFF0B1021,CARD=0xFF151C32,STROKE=0xFF27314A,
        WHITE=0xFFF8FAFF,MUTED=0xFFA9B5D0,GREEN=0xFF39D3B2,PURPLE=0xFF8578FF;
    private static final String[] IDEAS={
        "Arrival","Inception","Interstellar","The Martian","Gravity","The Prestige",
        "The Truman Show","The Secret Life of Walter Mitty","The Grand Budapest Hotel",
        "The Imitation Game","Hidden Figures","The Social Network","Moneyball",
        "The Pursuit of Happyness","The Shawshank Redemption","The Green Mile",
        "Cast Away","Life of Pi","The Revenant","The Terminal","The Intern",
        "The King's Speech","The Artist","The Theory of Everything",
        "A Beautiful Mind","The Help","The Blind Side","The Intouchables",
        "The Curious Case of Benjamin Button","The Iron Giant",
        "How to Train Your Dragon","Ratatouille","Up","Coco","Inside Out",
        "WALL-E","Zootopia","Moana","Encanto","Frozen","Brave","Finding Nemo",
        "Toy Story","Monsters, Inc.","Kung Fu Panda","Megamind","The Croods",
        "The Lego Movie","Paddington","Paddington 2","Peter Rabbit",
        "The BFG","Hugo","Night at the Museum","Jumanji","Jumanji: Welcome to the Jungle",
        "The Goonies","The Princess Bride","The NeverEnding Story",
        "The Lord of the Rings: The Fellowship of the Ring","The Hobbit: An Unexpected Journey",
        "National Treasure","The Mummy","Pirates of the Caribbean: The Curse of the Black Pearl",
        "The Jungle Book","The Chronicles of Narnia: The Lion, the Witch and the Wardrobe",
        "A Quiet Place","A Simple Favor","A Working Man","A Minecraft Movie",
        "The Wild Robot","The Mitchells vs. the Machines","Big Hero 6","Soul",
        "The Book of Life","The Peanuts Movie","The Bad Guys","Sing",
        "The Karate Kid","The Greatest Showman","Wonder","The Sandlot","October Sky",
        "The School of Rock","The Princess Diaries","The Parent Trap","We Bought a Zoo",
        "The Hundred-Foot Journey","Julie & Julia","Chef","The Bucket List",
        "Little Miss Sunshine","Hunt for the Wilderpeople","The Secret Garden"
    };
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final ExecutorService io=Executors.newSingleThreadExecutor();
    private SubtitleShelf shelf;
    private SecureTokenStore providerKey;
    private CloudApi cloud;
    private LinearLayout root,container,resultsArea,libraryArea;
    private TextView status;
    private EditText query;
    private Spinner language;
    private JSONArray results=new JSONArray(),library=new JSONArray();
    private final Set<Integer> resultSelection=new HashSet<>();
    private final Set<String> librarySelection=new HashSet<>();
    private boolean running=false;
    private int ideaOffset=0;

    @Override public void onCreate(Bundle b){
        super.onCreate(b);
        getWindow().setStatusBarColor(BG);getWindow().setNavigationBarColor(BG);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        shelf=new SubtitleShelf(this);
        providerKey=new SecureTokenStore(this,true);
        cloud=new CloudApi(new SecureTokenStore(this));
        buildUi();
        reloadLibrary();
    }
    @Override protected void onDestroy(){io.shutdownNow();handler.removeCallbacksAndMessages(null);super.onDestroy();}
    private int dp(float n){return (int)(getResources().getDisplayMetrics().density*n+.5f);}
    private GradientDrawable bg(int c){GradientDrawable d=new GradientDrawable();d.setColor(c);d.setCornerRadius(dp(14));d.setStroke(dp(1),STROKE);return d;}
    private TextView label(String t,int size,int color,boolean bold){
        TextView v=new TextView(this);v.setText(t);v.setTextColor(color);v.setTextSize(size);
        if(bold)v.setTypeface(Typeface.DEFAULT,Typeface.BOLD);
        v.setPadding(0,dp(3),0,dp(3));return v;
    }
    private LinearLayout column(){
        LinearLayout c=new LinearLayout(this);c.setOrientation(LinearLayout.VERTICAL);return c;
    }
    private LinearLayout box(LinearLayout parent){
        LinearLayout c=column();c.setPadding(dp(15),dp(14),dp(15),dp(14));c.setBackground(bg(CARD));
        LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,-2);lp.bottomMargin=dp(13);
        parent.addView(c,lp);return c;
    }
    private void add(LinearLayout parent,View v){parent.addView(v,new LinearLayout.LayoutParams(-1,-2));}
    private Button button(LinearLayout parent,String caption,Runnable onTap){
        Button b=new Button(this);b.setText(caption);b.setAllCaps(false);b.setTextColor(WHITE);
        b.setTextSize(13);b.setBackground(bg(0xFF2A3150));b.setOnClickListener(v->onTap.run());
        LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,dp(46));lp.topMargin=dp(8);parent.addView(b,lp);return b;
    }
    private void info(String message){
        handler.post(()->{if(status!=null)status.setText(message);});
    }
    private void err(String error){
        String cleaned=error==null?"Subtitle operation failed":error.replaceAll("(?i)api_key=[^&\\s]+","api_key=[redacted]");
        if(cleaned.length()>250)cleaned=cleaned.substring(0,250);
        String shown=cleaned;
        new AlertDialog.Builder(this).setTitle("SRT Library").setMessage(shown)
            .setPositiveButton("OK",null).show();
    }
    private <T> void work(String name,Callable<T> work,Consumer<T> complete){
        if(running){Toast.makeText(this,"Finish the current SRT operation first",Toast.LENGTH_SHORT).show();return;}
        running=true;info(name);
        io.execute(()->{
            try{T result=work.call();handler.post(()->{running=false;complete.accept(result);});}
            catch(Exception e){handler.post(()->{running=false;err(e.getMessage());info("Operation stopped; saved SRTs are safe.");});}
        });
    }
    private void buildUi(){
        root=column();root.setBackgroundColor(BG);setContentView(root);
        TextView heading=label("SRT LIBRARY",22,WHITE,true);heading.setPadding(dp(18),dp(16),dp(18),0);add(root,heading);
        TextView sub=label("Search • collect hundreds locally • select a batch for Muse",12,MUTED,false);
        sub.setPadding(dp(18),0,dp(18),dp(12));add(root,sub);
        ScrollView scroll=new ScrollView(this);root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
        container=column();container.setPadding(dp(15),dp(8),dp(15),dp(24));scroll.addView(container);

        LinearLayout keyBox=box(container);
        add(keyBox,label("SubDL provider connection",16,WHITE,true));
        add(keyBox,label("Free personal API key required. Stored encrypted in Android Keystore; not sent to Cloudflare. Provider usage quotas apply.",12,MUTED,false));
        button(keyBox,"Set / replace SubDL API key",this::configureKey);
        button(keyBox,"Test SubDL search connection (Inception, English)",()->{
            work("Testing SubDL search",()->SubtitleProvider.searchDetailed(providerKey.load(),"Inception","EN"),result->{
                results=result.hits;
                resultSelection.clear();
                renderResults();
                info("Connection test: "+result.diagnostic);
                new AlertDialog.Builder(this).setTitle("SubDL connection diagnostic")
                    .setMessage(result.diagnostic+"\n\nNo API key is displayed. A successful response can still contain zero subtitles for a specific title or language.")
                    .setPositiveButton("OK",null).show();
            });
        });
        button(keyBox,"Provider documentation",()->startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(SubtitleProvider.DOCS))));

        LinearLayout finder=box(container);
        add(finder,label("Find movie subtitles",17,WHITE,true));
        query=new EditText(this);query.setSingleLine(true);query.setTextColor(WHITE);query.setHintTextColor(MUTED);
        query.setHint("Search movie title (e.g. Arrival)");
        add(finder,query);
        language=new Spinner(this);
        language.setAdapter(new ArrayAdapter<>(this,android.R.layout.simple_spinner_dropdown_item,
            new String[]{"English subtitles (EN)","Urdu subtitles (UR)"}));
        add(finder,language);
        button(finder,"Search SubDL",()->search(query.getText().toString()));
        button(finder,"Surprise me: movie ideas",this::showIdeas);
        button(finder,"Collect random SRTs in bulk (5 / 10 / 20)",this::bulkCollectDialog);
        add(finder,label("Ideas are a built-in rotating title list, not live ranked recommendations or guaranteed subtitle availability.",11,MUTED,false));
        status=label("Connect your provider key to search.",12,GREEN,false);
        add(finder,status);

        LinearLayout found=box(container);
        add(found,label("Search results",17,WHITE,true));
        resultsArea=column();add(found,resultsArea);
        button(found,"Download selected subtitles to library (max 20)",this::downloadSelection);

        LinearLayout saved=box(container);
        add(saved,label("My saved SRT files",17,WHITE,true));
        add(saved,label("Keep up to 1,000 subtitles on this device. Select 10 of 100 for example, then submit just those movies to Muse.",12,MUTED,false));
        libraryArea=column();add(saved,libraryArea);
        button(saved,"Queue selected SRTs to Cloudflare / Muse (max 10)",this::batchDialog);
        button(saved,"Remove selected SRTs from phone only",this::deleteSelection);
        add(saved,label("Cloud projects are created only when you press Queue. Downloads never upload automatically.",11,MUTED,false));
    }
    private void configureKey(){
        EditText input=new EditText(this);input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);
        input.setHint("Paste your personal SubDL API key");
        input.setTextColor(Color.BLACK);
        new AlertDialog.Builder(this).setTitle("Connect SubDL").setMessage(
            "Create a free key in your own SubDL account at subdl.com/api-doc. This is separate from your CinePulse Cloudflare token.")
            .setView(input).setNegativeButton("Cancel",null)
            .setNeutralButton("Clear key",(d,w)->{providerKey.clear();info("SubDL key cleared from phone.");})
            .setPositiveButton("Save",(d,w)->{
                String key=input.getText().toString().trim();input.setText("");
                work("Securing your SubDL key",()->{providerKey.save(key);return true;},
                    v->info("SubDL key saved securely. Search for a movie."));
            }).show();
    }
    private void showIdeas(){
        List<String> all=new ArrayList<>();Collections.addAll(all,IDEAS);
        Collections.shuffle(all);
        String[] candidates=all.subList(0,Math.min(16,all.size())).toArray(new String[0]);
        new AlertDialog.Builder(this).setTitle("Random movie-title ideas")
            .setItems(candidates,(d,w)->{query.setText(candidates[w]);search(candidates[w]);})
            .setNegativeButton("Cancel",null).show();
    }
    private void bulkCollectDialog(){
        final String[] sizes={"5 random movie subtitles","10 random movie subtitles","20 random movie subtitles"};
        final int[] count={10};
        new AlertDialog.Builder(this).setTitle("Bulk SRT collector")
            .setSingleChoiceItems(sizes,1,(d,which)->count[0]=new int[]{5,10,20}[which])
            .setMessage("Search official SubDL movie subtitles and download one valid SRT per available title. Titles are from the built-in rotating ideas list, not a live popularity ranking. Provider quotas apply. Requests run one at a time. Keep CinePulse open. No movies are submitted to Cloudflare.")
            .setNegativeButton("Cancel",null)
            .setPositiveButton("Collect",(d,w)->{
                final String lang=language.getSelectedItemPosition()==1?"UR":"EN";
                final int n=count[0];
                work("Collecting "+n+" subtitles",()->{
                    String key=providerKey.load();
                    if(key==null)throw new IllegalStateException("Set your SubDL API key first.");
                    JSONArray existing=shelf.entries();
                    Set<String> present=new HashSet<>();
                    for(int i=0;i<existing.length();i++){
                        JSONObject item=existing.optJSONObject(i);
                        if(item!=null)present.add(item.optString("title").toLowerCase(Locale.ROOT));
                    }
                    List<String> names=new ArrayList<>();Collections.addAll(names,IDEAS);
                    Collections.shuffle(names);
                    int saved=0,lookups=0;StringBuilder failures=new StringBuilder();
                    for(String name:names){
                        if(saved>=n||lookups>=Math.min(70,n*4))break;
                        if(present.contains(name.toLowerCase(Locale.ROOT)))continue;
                        lookups++;
                        final int completed=saved,attempt=lookups;
                        info("Subtitle search "+attempt+" • "+saved+"/"+n+" saved");
                        try{
                            SubtitleProvider.SearchResult response=SubtitleProvider.searchDetailed(key,name,lang);
                            JSONArray found=response.hits;
                            if(found.length()==0)continue;
                            JSONObject best=null;
                            // Only accept an exact title (with optional release year), not a loosely related search hit.
                            for(int i=0;i<found.length();i++){
                                JSONObject hit=found.optJSONObject(i);
                                if(hit==null)continue;
                                String candidate=hit.optString("title").replaceAll("\\s+\\(\\d{4}\\)$","").trim();
                                if(candidate.equalsIgnoreCase(name) && !hit.optBoolean("hi",false)){best=hit;break;}
                            }
                            if(best==null)continue;
                            SubtitleProvider.Srt subtitle=SubtitleProvider.download(best.getString("path"));
                            shelf.save(best,subtitle);saved++;
                            present.add(name.toLowerCase(Locale.ROOT));
                            // Deliberate provider pacing; never parallelize unsolicited batch downloads.
                            Thread.sleep(900);
                        }catch(Exception e){
                            String error=e.getMessage()==null?"provider error":e.getMessage();
                            if(error.contains("rate limit")||error.contains("quota")){failures.append("Stopped at provider quota / rate limit.");break;}
                            // Individual absent/invalid subtitles should not abort the entire collection.
                        }
                    }
                    return new String[]{String.valueOf(saved),String.valueOf(lookups),failures.toString()};
                },response->{
                    reloadLibrary();
                    new AlertDialog.Builder(this).setTitle("Bulk collection complete")
                        .setMessage(response[0]+" subtitle(s) saved locally after "+response[1]+" title searches."+
                            (response[2].isEmpty()?"":"\n"+response[2])+
                            "\n\nOpen My saved SRT files to select up to 10 for Muse. The provider does not guarantee every title or language.")
                        .setPositiveButton("OK",null).show();
                });
            }).show();
    }
    private void search(String title){
        final String lang=language.getSelectedItemPosition()==1?"UR":"EN";
        work("Searching SubDL for "+title,()->SubtitleProvider.searchDetailed(providerKey.load(),title,lang),found->{
            results=found.hits;resultSelection.clear();renderResults();
            info(found.diagnostic);
        });
    }
    private void renderResults(){
        resultsArea.removeAllViews();
        if(results.length()==0){add(resultsArea,label("No results yet. Search by title above.",12,MUTED,false));return;}
        add(resultsArea,label("Choose subtitle releases; matching the exact movie release improves timing.",12,MUTED,false));
        for(int i=0;i<results.length();i++){
            JSONObject item=results.optJSONObject(i);if(item==null)continue;
            final int index=i;
            CheckBox check=new CheckBox(this);check.setText(
                item.optString("title")+" • "+item.optString("language")+" • "+
                item.optString("release")+(item.optBoolean("hi")?" • SDH":""));
            check.setTextSize(12);check.setTextColor(WHITE);
            check.setButtonTintList(ColorStateList.valueOf(GREEN));
            check.setChecked(resultSelection.contains(i));
            check.setOnCheckedChangeListener((b,on)->{if(on)resultSelection.add(index);else resultSelection.remove(index);});
            add(resultsArea,check);
        }
    }
    private void downloadSelection(){
        List<Integer> indexes=new ArrayList<>(resultSelection);Collections.sort(indexes);
        if(indexes.isEmpty()){err("Select at least one search result.");return;}
        if(indexes.size()>20){err("Download at most 20 at a time. You can accumulate up to 1,000 over multiple batches.");return;}
        new AlertDialog.Builder(this).setTitle("Download "+indexes.size()+" subtitle(s)?")
          .setMessage("Fetches selected SRT files using your SubDL allowance, validates their timestamps, saves each in CinePulse on this phone. No Cloudflare jobs are started. Keep the app open during this batch.")
          .setNegativeButton("Cancel",null).setPositiveButton("Download",(d,w)->work(
              "Downloading selected SRTs",()->{
                  int saved=0;StringBuilder failures=new StringBuilder();
                  for(int n=0;n<indexes.size();n++){
                      int index=indexes.get(n);JSONObject hit=results.optJSONObject(index);
                      if(hit==null)continue;
                      final int done=n+1;info("Downloading "+done+"/"+indexes.size());
                      try{
                          SubtitleProvider.Srt subtitle=SubtitleProvider.download(hit.getString("path"));
                          shelf.save(hit,subtitle);saved++;
                      }catch(Exception e){
                          failures.append(hit.optString("release","Unknown")).append(": ")
                              .append(e.getMessage()==null?"download error":e.getMessage()).append("\n");
                          if(e.getMessage()!=null&&e.getMessage().contains("rate limit"))break;
                      }
                  }
                  return new String[]{String.valueOf(saved),failures.toString()};
              },report->{
                  resultSelection.clear();renderResults();reloadLibrary();
                  info("Saved "+report[0]+" SRT(s). "+(report[1].isEmpty()?"": "Some failed; review details."));
                  if(!report[1].isEmpty())err(report[1]);
              })).show();
    }
    private void reloadLibrary(){
        work("Loading saved SRTs",shelf::entries,items->{library=items;renderSaved();info(items.length()+" SRTs saved on this phone.");});
    }
    private void renderSaved(){
        libraryArea.removeAllViews();
        if(library.length()==0){add(libraryArea,label("Your library is empty. Search and download a subtitle first.",12,MUTED,false));return;}
        add(libraryArea,label(library.length()+" downloaded subtitles • "+
            librarySelection.size()+" selected for Cloudflare",12,GREEN,false));
        for(int i=library.length()-1;i>=0;i--){
            JSONObject e=library.optJSONObject(i);if(e==null)continue;
            String id=e.optString("id");
            CheckBox cb=new CheckBox(this);
            cb.setText(e.optString("title")+"  •  "+e.optString("language")+
                "\n"+e.optString("release")+"  •  "+e.optInt("cues")+" cues  •  "+
                String.format(Locale.ROOT,"%.0f min",e.optDouble("durationSeconds")/60d));
            cb.setTextColor(WHITE);cb.setTextSize(12);cb.setChecked(librarySelection.contains(id));
            cb.setButtonTintList(ColorStateList.valueOf(GREEN));
            cb.setOnCheckedChangeListener((v,selected)->{
                if(selected)librarySelection.add(id);else librarySelection.remove(id);
            });
            add(libraryArea,cb);
        }
    }
    private void deleteSelection(){
        List<String> chosen=new ArrayList<>(librarySelection);
        if(chosen.isEmpty()){err("Select stored subtitles before removing them.");return;}
        new AlertDialog.Builder(this).setTitle("Remove "+chosen.size()+" local SRTs?")
            .setMessage("Deletes only the downloaded SRT copies from this Android app. No Cloudflare project or Muse job will be touched.")
            .setNegativeButton("Cancel",null)
            .setPositiveButton("Remove",(d,w)->work("Deleting local subtitles",()->{
                for(String id:chosen)shelf.remove(id);return true;
            },x->{librarySelection.clear();reloadLibrary();})).show();
    }
    private void batchDialog(){
        List<String> selected=new ArrayList<>(librarySelection);
        if(selected.isEmpty()){err("Select downloaded SRTs to upload.");return;}
        if(selected.size()>10){err("Submit a maximum of 10 movies per batch. Keep the remaining SRTs in the library.");return;}
        EditText minutes=new EditText(this);minutes.setInputType(InputType.TYPE_CLASS_NUMBER);
        minutes.setSingleLine(true);minutes.setText("15");minutes.setHint("Target narration minutes");
        new AlertDialog.Builder(this).setTitle("Queue "+selected.size()+" movie project(s)")
            .setMessage("One Cloudflare project per selected SRT. Assigned to enabled Muse workers in rotation (each project keeps its own ID). Set the desired narration duration; Cloudflare must support that field. Keep this screen open until submission finishes. No movie videos will be uploaded.")
            .setView(minutes)
            .setNegativeButton("Cancel",null)
            .setPositiveButton("Queue",(d,w)->{
                int target;
                try{target=Integer.parseInt(minutes.getText().toString().trim());}
                catch(NumberFormatException e){err("Enter 3–60 narration minutes.");return;}
                if(target<3||target>60){err("Choose 3–60 minutes.");return;}
                work("Checking available Muse workers",()->{
                    JSONObject response=cloud.workers();
                    JSONArray ws=response.optJSONArray("workers");
                    List<String> active=new ArrayList<>();
                    if(ws!=null)for(int i=0;i<ws.length();i++){
                        JSONObject worker=ws.optJSONObject(i);
                        if(worker!=null&&worker.optBoolean("enabled",true)&&!worker.optBoolean("paused")
                            &&SecurityRules.validUuid(worker.optString("id")))
                            active.add(worker.optString("id"));
                    }
                    if(active.isEmpty())throw new IllegalStateException("No enabled/unpaused Muse workers available. Resume a worker first.");
                    int complete=0;int unconfirmed=0;StringBuilder failures=new StringBuilder();
                    for(int i=0;i<selected.size();i++){
                        String id=selected.get(i);
                        JSONObject entry=findEntry(id);
                        if(entry==null){failures.append("Missing local item\n");continue;}
                        final int done=i+1;info("Uploading movie "+done+"/"+selected.size());
                        try{
                            String name=entry.optString("title","Untitled").replaceAll("\\s+\\(\\d{4}\\)$","");
                            String srt=shelf.read(id);
                            JSONObject created=cloud.createProject(name,active.get(i%active.size()),srt,48,target);
                            if(!SecurityRules.validUuid(created.optJSONObject("project")!=null?
                                created.optJSONObject("project").optString("id"):created.optString("id")))
                                throw new IOExceptionWithMessage("Cloudflare response did not confirm the new project ID; refresh the project list before retrying.");
                            complete++;
                            if(created.optInt("targetMinutes",-1)!=target)unconfirmed++;
                        }catch(Exception error){
                            failures.append(entry.optString("title")).append(": ")
                                .append(error.getMessage()==null?"failed":error.getMessage()).append("\n");
                        }
                    }
                    return new String[]{String.valueOf(complete),String.valueOf(unconfirmed),failures.toString()};
                },report->{
                    librarySelection.clear();renderSaved();
                    String summary=report[0]+" project(s) submitted to Cloudflare/Muse. "+
                        ("0".equals(report[1])?"Narration target confirmed for each.":report[1]+" target duration(s) NOT acknowledged by backend.")+
                        "\n\nEach worker must be online and polling to process its jobs. The downloaded SRTs remain saved locally.";
                    if(!report[2].isEmpty())summary+="\n\nFailures:\n"+report[2];
                    new AlertDialog.Builder(this).setTitle("Batch submission result")
                        .setMessage(summary).setPositiveButton("OK",null).show();
                });
            }).show();
    }
    private JSONObject findEntry(String id){
        for(int i=0;i<library.length();i++){
            JSONObject e=library.optJSONObject(i);
            if(e!=null&&id.equals(e.optString("id")))return e;
        }
        return null;
    }
    static final class IOExceptionWithMessage extends Exception{
        IOExceptionWithMessage(String message){super(message);}
    }
}
