package com.cinepulse.mobile;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.ClipboardManager;
import android.content.ClipData;
import android.database.Cursor;
import android.provider.OpenableColumns;
import android.provider.DocumentsContract;
import android.content.SharedPreferences;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
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
    private static final int PICK_LIBRARY_SRT=717;
    private static final int OPEN_SUBTITLE_BROWSER=718;
    private static final int PICK_EXPORT_FOLDER=719;
    private final List<String> pendingExportIds=new ArrayList<>();
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
        "The Matrix",
        "The Matrix Reloaded",
        "The Matrix Revolutions",
        "Back to the Future",
        "Back to the Future Part II",
        "Back to the Future Part III",
        "Jurassic Park",
        "The Lost World: Jurassic Park",
        "Jurassic World",
        "E.T. the Extra-Terrestrial",
        "Close Encounters of the Third Kind",
        "Contact",
        "The Fifth Element",
        "Minority Report",
        "Edge of Tomorrow",
        "Source Code",
        "Looper",
        "Ex Machina",
        "Her",
        "The Shape of Water",
        "Eternal Sunshine of the Spotless Mind",
        "The Adjustment Bureau",
        "The Time Traveler's Wife",
        "About Time",
        "The Notebook",
        "La La Land",
        "Whiplash",
        "The Pursuit of Happyness",
        "The Founder",
        "Ford v Ferrari",
        "Rush",
        "The Big Short",
        "The Wolf of Wall Street",
        "Catch Me If You Can",
        "The Aviator",
        "The Curious Case of Benjamin Button",
        "The Boy in the Striped Pajamas",
        "Schindler's List",
        "The Pianist",
        "1917",
        "Dunkirk",
        "Hacksaw Ridge",
        "Saving Private Ryan",
        "Bridge of Spies",
        "The Post",
        "Argo",
        "Spotlight",
        "Darkest Hour",
        "The Dig",
        "The Courier",
        "The Peanut Butter Falcon",
        "Wonder",
        "The Fault in Our Stars",
        "The Perks of Being a Wallflower",
        "The Hate U Give",
        "Good Will Hunting",
        "Dead Poets Society",
        "The Holdovers",
        "The Family Man",
        "The Holiday",
        "The Proposal",
        "Notting Hill",
        "Love Actually",
        "The Devil Wears Prada",
        "The Last Holiday",
        "The Princess Bride",
        "The Nice Guys",
        "The Other Guys",
        "The Secret Life of Pets",
        "Despicable Me",
        "Despicable Me 2",
        "Minions",
        "Puss in Boots",
        "Puss in Boots: The Last Wish",
        "Shrek",
        "Shrek 2",
        "Madagascar",
        "Madagascar: Escape 2 Africa",
        "The Incredibles",
        "Incredibles 2",
        "Cars",
        "Cars 2",
        "A Bug's Life",
        "Luca",
        "Turning Red",
        "Elemental",
        "Onward",
        "Tangled",
        "The Princess and the Frog",
        "The Emperor's New Groove",
        "The Road to El Dorado",
        "Spirited Away",
        "Howl's Moving Castle",
        "Kiki's Delivery Service",
        "My Neighbor Totoro",
        "The Boy and the Heron",
        "The Wind Rises",
        "Ponyo",
        "Coraline",
        "ParaNorman",
        "Kubo and the Two Strings",
        "The Boxtrolls",
        "Chicken Run",
        "Fantastic Mr. Fox",
        "Isle of Dogs",
        "The Fantastic Four",
        "The Greatest Showman",
        "The Impossible",
        "The Walk",
        "The Finest Hours",
        "Everest",
        "The Way Back",
        "The Lost City",
        "The Jungle Cruise",
        "Free Guy",
        "Ready Player One",
        "The Adam Project",
        "The Tomorrow War",
        "Oblivion",
        "The Maze Runner",
        "The Hunger Games",
        "The Hunger Games: Catching Fire",
        "Divergent",
        "The Giver",
        "The Book Thief",
        "The Sound of Music",
        "Mary Poppins",
        "Mary Poppins Returns",
        "The Little Prince",
        "The Little Mermaid",
        "Beauty and the Beast",
        "Aladdin",
        "Mulan",
        "Tarzan",
        "Hercules",
        "Bolt",
        "Rio",
        "Rio 2",
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
        // SRT Library diagnostics are screenshot-friendly; the credential dialog alone is protected.
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
        TextView heading=label("SRT DOWNLOADER  •  v0.3.2",22,WHITE,true);heading.setPadding(dp(18),dp(16),dp(18),0);add(root,heading);
        TextView sub=label("Browse subtitle websites • save to Downloads • import SRT/ZIP",12,MUTED,false);
        sub.setPadding(dp(18),0,dp(18),dp(12));add(root,sub);
        ScrollView scroll=new ScrollView(this);root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
        container=column();container.setPadding(dp(15),dp(8),dp(15),dp(24));scroll.addView(container);

        LinearLayout browserBox=box(container);
        add(browserBox,label("SUBDL WEBSITE — MANUAL DOWNLOAD",16,WHITE,true));
        add(browserBox,label("Open the verified Inception English subtitle listing inside CinePulse. Tap a subtitle, download it, then import the SRT/ZIP from Android Downloads. No API key needed.",12,MUTED,false));
        button(browserBox,"Browse Inception (2010) English SRTs",()->openSubtitleBrowser("https://subdl.com/subtitle/sd2922/inception/english"));
        button(browserBox,"Open verified individual Inception subtitle",()->openSubtitleBrowser("https://subdl.com/s/info/e7iE3R6nMC"));
        button(browserBox,"Try OpenSubtitles",()->openSubtitleBrowser("https://www.opensubtitles.com/"));
        button(browserBox,"Try SubSource",()->openSubtitleBrowser("https://subsource.net/"));
        button(browserBox,"Fetch new SRTs from selected Downloads folder",this::fetchNewDownloads);
        button(browserBox,"Choose Downloads folder (remember location)",this::chooseDownloadsFolder);
        button(browserBox,"Import selected SRT / ZIP files",this::chooseLocalSubtitles);

        LinearLayout automatic=box(container);
        add(automatic,label("AUTOMATIC SUBTITLE COLLECTOR",17,WHITE,true));
        add(automatic,label("Separate from manual browsing. Configure your own SubDL API key, then collect English subtitles for 5, 10 or 20 different randomly selected movie titles. Saves locally; does not start Muse.",12,MUTED,false));
        button(automatic,"1. Enter / update SubDL API key",this::configureKey);
        button(automatic,"2. Test API connection",this::testSubdlConnection);
        button(automatic,"Inspect API URLs (original vs cleaned)",this::inspectSubdlUrls);
        button(automatic,"3. Collect 5 random movie SRTs",()->collectRandom(5));
        button(automatic,"4. Collect 10 random movie SRTs",()->collectRandom(10));
        button(automatic,"5. Collect 20 random movie SRTs",()->collectRandom(20));
        LinearLayout saved=box(container);
        add(saved,label("My saved SRT files",17,WHITE,true));
        add(saved,label("Keep up to 1,000 subtitles on this device. Select 10 of 100 for example, then submit just those movies to Muse.",12,MUTED,false));
        button(saved,"▶ Queue SELECTED movies • set narration duration",this::batchDialog);
        button(saved,"↻ Recheck uncertain submissions against Cloudflare",this::reconcileUnknownSubmissions);
        button(saved,"⬇ Export SELECTED SRTs to a visible phone folder",this::chooseExportFolder);
        libraryArea=column();add(saved,libraryArea);
        add(saved,label("Check multiple READY movies, then use Queue SELECTED. Queued movies remain indexed and cannot be started accidentally. Use each movie card for pause/resume when Cloudflare supports it.",12,MUTED,false));



    }
    private void copyDiagnostic(String value){
        String copy=value.replaceAll("(?i)subdl_[A-Za-z0-9_-]{12,}","[REDACTED]")
            .replaceAll("(?i)api_key=[^&\\s]+","api_key=[REDACTED]")
            .replaceAll("(?i)Bearer\\s+\\S+","Bearer [REDACTED]");
        ClipboardManager clipboard=(ClipboardManager)getSystemService(CLIPBOARD_SERVICE);
        if(clipboard==null){err("Clipboard unavailable");return;}
        clipboard.setPrimaryClip(ClipData.newPlainText("CinePulse SubDL diagnostic",copy));
        Toast.makeText(this,"Diagnostic copied — no API key included",Toast.LENGTH_LONG).show();
    }
    private void showCopyableReport(String title,String text){
        String readable=text.replace("\\n","\n");
        new AlertDialog.Builder(this).setTitle(title).setMessage(readable)
            .setNegativeButton("Close",null)
            .setPositiveButton("Copy diagnostic",(dialog,which)->copyDiagnostic(readable))
            .show();
    }
    private void openSubtitleBrowser(String url){
        Intent intent=new Intent(this,SubtitleBrowserActivity.class);
        intent.putExtra("url",url);
        startActivityForResult(intent,OPEN_SUBTITLE_BROWSER);
    }
    private static final int PICK_DOWNLOADS_FOLDER=8721;
    private SharedPreferences downloadPrefs(){return getSharedPreferences("subtitle_downloads",MODE_PRIVATE);}
    private void chooseDownloadsFolder(){
        Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(intent,PICK_DOWNLOADS_FOLDER);
    }
    private void fetchNewDownloads(){
        String saved=downloadPrefs().getString("tree","");
        if(saved.isEmpty()){chooseDownloadsFolder();return;}
        Uri tree=Uri.parse(saved);
        work("Scanning authorized Downloads folder",()->{
            Uri children=DocumentsContract.buildChildDocumentsUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree));
            int files=0,imported=0;StringBuilder failures=new StringBuilder();
            try(Cursor cursor=getContentResolver().query(children,
                new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_MIME_TYPE},null,null,null)){
                if(cursor==null)throw new IOException("Downloads folder is not accessible");
                while(cursor.moveToNext()&&files<200){
                    String docId=cursor.getString(0),name=cursor.getString(1),type=cursor.getString(2);
                    if(name==null||DocumentsContract.Document.MIME_TYPE_DIR.equals(type))continue;
                    String lower=name.toLowerCase(Locale.ROOT);
                    if(!lower.endsWith(".zip")&&!lower.endsWith(".srt"))continue;
                    files++;
                    Uri file=DocumentsContract.buildDocumentUriUsingTree(tree,docId);
                    try{imported+=importFile(file);}
                    catch(Exception e){failures.append(name).append(": ").append(e.getMessage()).append("\\n");}
                }
            }
            return new String[]{String.valueOf(files),String.valueOf(imported),failures.toString()};
        },result->{
            reloadLibrary();
            new AlertDialog.Builder(this).setTitle("Downloads scan complete")
                .setMessage("Checked "+result[0]+" SRT/ZIP files; "+result[1]+" valid SRT entries processed. Duplicate subtitle content is ignored.\\n"+result[2])
                .setPositiveButton("OK",null).show();
        });
    }
    private void chooseExportFolder(){
        if(librarySelection.isEmpty()){err("Select one or more READY movies before exporting SRTs.");return;}
        openExportFolder(new ArrayList<>(librarySelection));
    }
    private void openExportFolder(List<String> ids){
        pendingExportIds.clear();pendingExportIds.addAll(ids);
        Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|
            Intent.FLAG_GRANT_WRITE_URI_PERMISSION|
            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        try{startActivityForResult(intent,PICK_EXPORT_FOLDER);}
        catch(Exception e){err("Android folder picker is unavailable: "+e.getMessage());}
    }
    private void exportToFolder(Uri tree,List<String> ids){
        work("Exporting "+ids.size()+" SRT(s) to selected folder",()->{
            int exported=0;StringBuilder failed=new StringBuilder();
            Uri folder=DocumentsContract.buildDocumentUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree));
            for(String id:ids){
                JSONObject entry=findEntry(id);
                if(entry==null)continue;
                String name=SecurityRules.safeFolderName(entry.optString("title","Movie"))+
                    "-"+id.substring(0,8)+".srt";
                Uri created=null;
                try{
                    created=DocumentsContract.createDocument(getContentResolver(),folder,
                        "application/x-subrip",name);
                    if(created==null)throw new IOException("Android document provider refused creation.");
                    byte[] data=shelf.read(id).getBytes(StandardCharsets.UTF_8);
                    try(OutputStream out=getContentResolver().openOutputStream(created,"w")){
                        if(out==null)throw new IOException("Cannot write to chosen folder.");
                        out.write(data);out.flush();
                    }
                    exported++;
                }catch(Exception error){
                    if(created!=null)try{DocumentsContract.deleteDocument(getContentResolver(),created);}
                        catch(Exception ignored){}
                    failed.append(name).append(": ")
                        .append(error.getMessage()==null?"Export failed":error.getMessage()).append("\n");
                }
            }
            return new String[]{String.valueOf(exported),failed.toString()};
        },report->showCopyableReport("SRT files exported",
            report[0]+" SRT file(s) exported to the folder you picked in Android Files. "+
            "The original CinePulse library remains unchanged.\n"+report[1]));
    }
    private void chooseLocalSubtitles(){
        Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true);
        try{startActivityForResult(intent,PICK_LIBRARY_SRT);}
        catch(Exception e){err("Android document picker unavailable: "+e.getMessage());}
    }
    private static byte[] readLimited(InputStream in,int max) throws Exception{
        try(ByteArrayOutputStream out=new ByteArrayOutputStream()){
            byte[] buffer=new byte[8192];int n,total=0;
            while((n=in.read(buffer))!=-1){
                total+=n;
                if(total>max)throw new IOException("Subtitle file exceeds maximum safe size");
                out.write(buffer,0,n);
            }
            return out.toByteArray();
        }
    }
    private String displayName(Uri uri){
        String fallback=uri.getLastPathSegment();
        if(fallback==null)fallback="Imported subtitle";
        try(Cursor cursor=getContentResolver().query(uri,new String[]{OpenableColumns.DISPLAY_NAME},null,null,null)){
            if(cursor!=null&&cursor.moveToFirst()){
                int col=cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if(col>=0&&!cursor.isNull(col))fallback=cursor.getString(col);
            }
        }catch(Exception ignored){}
        return fallback.length()>150?fallback.substring(0,150):fallback;
    }
    private int importEntry(String movieTitle,String filename,byte[] raw) throws Exception{
        SubtitleProvider.Srt subtitle=SubtitleProvider.parseBytes(raw);
        SubtitleQuality.Result check=SubtitleQuality.assess(subtitle,0);
        if(!check.complete)throw new IOException("SRT quality rejected: "+check.reason);
        String title=movieTitle.replaceFirst("(?i)\\.srt$","")
            .replaceFirst("(?i)\\.zip$","")
            .replace('.', ' ').replace('_',' ').trim();
        if(title.isEmpty())title="Imported subtitle";
        JSONObject meta=new JSONObject()
            .put("title",title)
            .put("release",filename)
            .put("language","EN")
            .put("path","")
            .put("provider","OpenSubtitles / local import");
        shelf.save(meta,subtitle);
        return 1;
    }
    private int importFile(Uri uri) throws Exception{
        String filename=displayName(uri);
        byte[] bytes;
        try(InputStream in=getContentResolver().openInputStream(uri)){
            if(in==null)throw new IOException("Android could not open chosen file");
            bytes=readLimited(in,5*1024*1024);
        }
        boolean zipped=bytes.length>3&&bytes[0]=='P'&&bytes[1]=='K';
        if(zipped){
            int saved=0,entries=0;
            try(ZipInputStream archive=new ZipInputStream(new ByteArrayInputStream(bytes))){
                ZipEntry z;
                while((z=archive.getNextEntry())!=null){
                    if(++entries>50)throw new IOException("Subtitle archive has too many entries");
                    if(z.isDirectory()||!z.getName().toLowerCase(Locale.ROOT).endsWith(".srt"))continue;
                    String entryName=z.getName();
                    // Read directly from ZIP stream; never trust archive paths or extract them onto disk.
                    String simple=entryName.substring(entryName.lastIndexOf('/')+1);
                    byte[] subtitle=readLimited(archive,SecurityRules.MAX_SRT_BYTES);
                    try{saved+=importEntry(simple,simple,subtitle);}
                    catch(Exception ignored){/* archive may contain nonstandard/invalid language files */}
                    if(saved>=20)break;
                }
            }
            if(saved==0)throw new IOException("ZIP contains no valid timed SRT subtitles");
            return saved;
        }
        if(!filename.toLowerCase(Locale.ROOT).endsWith(".srt") &&
            bytes.length>0 && !new String(bytes,StandardCharsets.UTF_8).contains("-->"))
            throw new IOException("Choose an SRT or ZIP containing SRT files");
        return importEntry(filename,filename,bytes);
    }
    @Override protected void onActivityResult(int request,int result,Intent data){
        super.onActivityResult(request,result,data);
        if(request==PICK_EXPORT_FOLDER){
            if(result==RESULT_OK&&data!=null&&data.getData()!=null){
                Uri folder=data.getData();
                List<String> chosen=new ArrayList<>(pendingExportIds);
                pendingExportIds.clear();
                try{
                    getContentResolver().takePersistableUriPermission(folder,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                    exportToFolder(folder,chosen);
                }catch(Exception e){err("Unable to write to selected SRT folder: "+e.getMessage());}
            }else pendingExportIds.clear();
            return;
        }
        if(request==PICK_DOWNLOADS_FOLDER){
            if(result==RESULT_OK&&data!=null&&data.getData()!=null){
                Uri folder=data.getData();
                try{
                    getContentResolver().takePersistableUriPermission(folder,Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    downloadPrefs().edit().putString("tree",folder.toString()).apply();
                    fetchNewDownloads();
                }catch(Exception e){err("Cannot remember Downloads folder: "+e.getMessage());}
            }
            return;
        }
        if(request==OPEN_SUBTITLE_BROWSER){
            if(result==RESULT_OK&&data!=null&&data.getBooleanExtra("open_import",false))chooseLocalSubtitles();
            return;
        }
        if(request!=PICK_LIBRARY_SRT||result!=RESULT_OK||data==null)return;
        ArrayList<Uri> selected=new ArrayList<>();
        ClipData clips=data.getClipData();
        if(clips!=null)for(int i=0;i<Math.min(clips.getItemCount(),20);i++){
            Uri uri=clips.getItemAt(i).getUri();
            if(uri!=null)selected.add(uri);
        }
        else if(data.getData()!=null)selected.add(data.getData());
        if(selected.isEmpty())return;
        work("Importing and validating local subtitles",()->{
            int succeeded=0;StringBuilder errors=new StringBuilder();
            for(Uri uri:selected){
                try{succeeded+=importFile(uri);}
                catch(Exception failure){
                    errors.append(displayName(uri)).append(": ")
                        .append(failure.getMessage()==null?"Invalid SRT":failure.getMessage()).append("\n");
                }
            }
            return new String[]{Integer.toString(succeeded),errors.toString()};
        },summary->{
            // reloadLibrary() schedules work; finish this completion callback first.
            new AlertDialog.Builder(this).setTitle("Subtitle import finished")
                .setMessage(summary[0]+" validated SRT(s) saved in CinePulse."+
                    (summary[1].isEmpty()?"":"\n\nSkipped:\n"+summary[1])+
                    "\n\nOpen My saved SRT files to select titles for Muse.")
                .setPositiveButton("OK",null).show();
            reloadLibrary();
        });
    }
    private void configureKey(){
        EditText input=new EditText(this);input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);
        input.setHint("Paste your personal SubDL API key");
        input.setTextColor(Color.BLACK);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        AlertDialog dialog=new AlertDialog.Builder(this).setTitle("Connect SubDL").setMessage(
            "Create a free key in your own SubDL account at subdl.com/api-doc. This is separate from your CinePulse Cloudflare token.")
            .setView(input).setNegativeButton("Cancel",null)
            .setNeutralButton("Clear key",(d,w)->{providerKey.clear();info("SubDL key cleared from phone.");})
            .setPositiveButton("Save",(d,w)->{
                String key=input.getText().toString().trim();input.setText("");
                work("Securing your SubDL key",()->{providerKey.save(key);return true;},
                    v->info("SubDL key saved securely. Search for a movie."));
            }).create();
        dialog.setOnDismissListener(d->getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE));
        dialog.show();
    }
    private void showIdeas(){
        List<String> all=new ArrayList<>();Collections.addAll(all,IDEAS);
        Collections.shuffle(all);
        String[] candidates=all.subList(0,Math.min(16,all.size())).toArray(new String[0]);
        new AlertDialog.Builder(this).setTitle("Random movie-title ideas")
            .setItems(candidates,(d,w)->{query.setText(candidates[w]);search(candidates[w]);})
            .setNegativeButton("Cancel",null).show();
    }
    private void inspectSubdlUrls(){
        EditText title=new EditText(this);title.setSingleLine(true);title.setText("Inception");
        title.setHint("Movie title");title.setTextColor(Color.BLACK);
        new AlertDialog.Builder(this).setTitle("Inspect SubDL download links")
            .setMessage("Displays original API link fields, cleaned URLs and rejection status. Credentials are excluded.")
            .setView(title).setNegativeButton("Cancel",null)
            .setPositiveButton("Inspect",(d,w)->work("Inspecting SubDL API URL fields",
                ()->SubtitleProvider.inspectLinks(providerKey.load(),title.getText().toString()),
                report->{
                    TextView view=new TextView(this);view.setText(report.replace("\\n","\n"));view.setTextIsSelectable(true);
                    view.setTextSize(12);view.setPadding(dp(14),dp(10),dp(14),dp(10));
                    android.widget.HorizontalScrollView horizontal=new android.widget.HorizontalScrollView(this);
                    horizontal.addView(view);
                    ScrollView scroll=new ScrollView(this);scroll.addView(horizontal);
                    new AlertDialog.Builder(this).setTitle("SubDL URL inspection table")
                        .setView(scroll).setNegativeButton("Close",null)
                        .setPositiveButton("Copy report",(dialog,which)->copyDiagnostic(report.replace("\\n","\n"))).show();
                })).show();
    }
    private void testSubdlConnection(){
        work("Checking SubDL API key",()->{
            String key=providerKey.load();
            if(key==null||key.trim().isEmpty())throw new IOException("Enter your SubDL API key first.");
            SubtitleProvider.SearchResult result=SubtitleProvider.searchDetailed(key,"Inception","EN");
            return result.diagnostic;
        },message->showCopyableReport("SubDL connection test",message));
    }
    private void collectRandom(int count){
        new AlertDialog.Builder(this).setTitle("Collect "+count+" complete English SRTs")
            .setMessage("CinePulse skips movies already stored or queued, checks title and timeline coverage, and tries alternate releases when necessary. It saves to this phone only; Muse never starts automatically. Keep this screen open.")
            .setNegativeButton("Cancel",null)
            .setPositiveButton("Collect",(d,w)->work("Collecting "+count+" verified English SRTs",()->{
                String key=providerKey.load();
                if(key==null||key.trim().isEmpty())throw new IOException("Enter your SubDL API key first.");
                shelf.reviewExistingQuality();
                JSONArray existing=shelf.entries();
                List<String> present=new ArrayList<>();
                for(int i=0;i<existing.length();i++){
                    JSONObject item=existing.optJSONObject(i);
                    if(item!=null&&!"NEEDS_REVIEW".equals(SubtitleShelf.state(item)))
                        present.add(item.optString("title"));
                }
                List<String> names=new ArrayList<>();Collections.addAll(names,IDEAS);
                Collections.shuffle(names);
                int saved=0,lookups=0,rejected=0;
                StringBuilder report=new StringBuilder();
                boolean quotaStop=false;
                for(String name:names){
                    if(saved>=count||lookups>=Math.min(names.size(),Math.max(70,count*5))||quotaStop)break;
                    boolean already=false;
                    for(String item:present)if(MovieIdentity.sameMovie(item,name)){already=true;break;}
                    if(already)continue;
                    lookups++;
                    info("SubDL: searching "+lookups+" | complete "+saved+"/"+count+" | "+name);
                    try{
                        SubtitleProvider.SearchResult response=SubtitleProvider.searchDetailed(key,name,"EN");
                        SubtitleProvider.Srt bestSrt=null;
                        JSONObject bestHit=null;
                        int bestScore=-1,attempts=0;
                        StringBuilder reasons=new StringBuilder();
                        for(int i=0;i<response.hits.length()&&attempts<10;i++){
                            JSONObject hit=response.hits.optJSONObject(i);
                            if(hit==null||hit.optBoolean("hi",false)||
                                !MovieIdentity.baseTitle(hit.optString("title")).equals(MovieIdentity.baseTitle(name)))continue;
                            attempts++;
                            try{
                                SubtitleProvider.Srt candidate=SubtitleProvider.download(hit.getString("path"),key,"EN");
                                SubtitleQuality.Result check=SubtitleQuality.assess(candidate,hit.optInt("runtimeMinutes",0));
                                if(!check.complete){
                                    reasons.append("release ").append(attempts).append(": ").append(check.reason).append("; ");
                                    continue;
                                }
                                if(check.score>bestScore){bestSrt=candidate;bestHit=hit;bestScore=check.score;}
                                // High-quality complete subtitles avoid unnecessary quota consumption.
                                if(bestScore>=90&&attempts>=2)break;
                            }catch(Exception invalid){
                                String reason=invalid.getMessage()==null?"download error":invalid.getMessage();
                                reasons.append("release ").append(attempts).append(": ").append(reason).append("; ");
                                if(reason.toLowerCase(Locale.ROOT).contains("rate limit")||
                                   reason.toLowerCase(Locale.ROOT).contains("quota")||
                                   reason.contains("401")||reason.contains("403")){quotaStop=true;break;}
                            }
                        }
                        if(bestSrt==null){
                            rejected++;
                            report.append(name).append(": no sufficiently complete English SRT after ")
                                .append(attempts).append(" release attempts. ").append(reasons).append("\n");
                            continue;
                        }
                        JSONObject stored=shelf.save(bestHit,bestSrt);
                        if(!bestSrt.sha256.equals(stored.optString("sha256"))){
                            report.append(name).append(": already indexed; duplicate skipped.\n");
                            present.add(name);
                            continue;
                        }
                        saved++;present.add(name);
                        report.append(name).append(": saved ").append(bestSrt.cues).append(" cues • ")
                            .append(Math.round(bestSrt.duration/60)).append(" min • quality ")
                            .append(bestScore).append("/100\n");
                        Thread.sleep(650);
                    }catch(Exception e){
                        String reason=e.getMessage()==null?"download failed":e.getMessage();
                        report.append(name).append(": ").append(reason).append("\n");
                        String lower=reason.toLowerCase(Locale.ROOT);
                        if(lower.contains("rate limit")||lower.contains("quota")||
                           lower.contains("401")||lower.contains("403"))quotaStop=true;
                    }
                }
                if(saved<count)report.append("\nOnly ").append(saved).append(" valid SRTs available from ")
                    .append(lookups).append(" searches. Incomplete movies were not counted.");
                return new String[]{String.valueOf(saved),String.valueOf(lookups),String.valueOf(rejected),report.toString()};
            },result->{
                reloadLibrary();
                showCopyableReport("Automatic subtitle quality report",
                    "Saved "+result[0]+"/"+count+" complete English SRTs after "+result[1]+
                    " searches. Rejected incomplete titles: "+result[2]+".\n\n"+result[3]);
            })).show();
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
                          SubtitleProvider.Srt subtitle=SubtitleProvider.download(hit.getString("path"),providerKey.load(),hit.optString("language","EN"));
                          SubtitleQuality.Result quality=SubtitleQuality.assess(subtitle,hit.optInt("runtimeMinutes",0));
                          if(!quality.complete)throw new IOException("Incomplete SRT: "+quality.reason);
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
        work("Loading and checking saved SRTs",()->{shelf.reviewExistingQuality();return shelf.entries();},items->{library=items;renderSaved();info(items.length()+" SRTs saved on this phone.");});
    }
    private void renderSaved(){
        libraryArea.removeAllViews();
        add(libraryArea,label("Private on-device location: "+shelf.storageLocation(),11,MUTED,false));
        add(libraryArea,label("Export selected files above to a folder you choose in Android Files/Downloads.",11,MUTED,false));
        if(library.length()==0){
            add(libraryArea,label("No stored subtitles yet. Collect 5, 10 or 20 complete SRTs above.",12,MUTED,false));return;
        }
        int ready=0,queued=0,finished=0,uncertain=0,review=0;
        for(int i=0;i<library.length();i++){
            JSONObject entry=library.optJSONObject(i);if(entry==null)continue;
            String state=SubtitleShelf.state(entry);
            if("QUEUED".equals(state))queued++;
            else if("FINISHED".equals(state))finished++;
            else if("UNKNOWN".equals(state)||"SUBMITTING".equals(state))uncertain++;
            else if("NEEDS_REVIEW".equals(state))review++;
            else ready++;
        }
        add(libraryArea,label("READY "+ready+"  •  QUEUED "+queued+"  •  UNCERTAIN "+uncertain+
            "  •  FINISHED "+finished+"  •  NEEDS REVIEW "+review+"  •  Selected "+librarySelection.size(),12,GREEN,true));
        String[] groups={"READY","SUBMITTING","UNKNOWN","QUEUED","FINISHED","NEEDS_REVIEW"};
        for(String group:groups){
            boolean printed=false;
            for(int i=library.length()-1;i>=0;i--){
                JSONObject e=library.optJSONObject(i);if(e==null||!group.equals(SubtitleShelf.state(e)))continue;
                if(!printed){add(libraryArea,label(group.equals("READY")?
                    "READY TO START — select multiple movies":group,14,WHITE,true));printed=true;}
                String id=e.optString("id"),title=e.optString("title","Unknown");
                String details=title+" • "+e.optString("language")+"\n"+
                    e.optString("release")+" • "+e.optInt("cues")+" cues • "+
                    Math.round(e.optDouble("durationSeconds")/60)+" min";
                if("READY".equals(group)){
                    CheckBox cb=new CheckBox(this);cb.setText(details);cb.setTextSize(12);
                    cb.setTextColor(WHITE);cb.setButtonTintList(ColorStateList.valueOf(GREEN));
                    cb.setChecked(librarySelection.contains(id));
                    cb.setOnCheckedChangeListener((v,yes)->{
                        if(yes)librarySelection.add(id);else librarySelection.remove(id);
                    });
                    add(libraryArea,cb);
                }else{
                    add(libraryArea,label(details,12,MUTED,false));
                    add(libraryArea,label(e.optString("stateReason",group),11,
                        "NEEDS_REVIEW".equals(group)?0xFFFFC47E:GREEN,false));
                    if("QUEUED".equals(group)){
                        String projectId=e.optString("projectId");
                        add(libraryArea,label("Cloudflare project: "+projectId,10,MUTED,false));
                        button(libraryArea,"⏸ Pause this movie",()->confirmMoviePause(projectId,title,true));
                        button(libraryArea,"▶ Resume this movie",()->confirmMoviePause(projectId,title,false));
                        button(libraryArea,"Export this queued SRT",()->openExportFolder(Collections.singletonList(id)));
                        button(libraryArea,"Run this movie AGAIN (explicit override)",()->confirmExplicitRequeue(id,title));
                    }else if("FINISHED".equals(group)){
                        button(libraryArea,"Export this finished SRT",()->openExportFolder(Collections.singletonList(id)));
                        button(libraryArea,"Run movie AGAIN (explicit override)",()->confirmExplicitRequeue(id,title));
                    }else if("SUBMITTING".equals(group)||"UNKNOWN".equals(group)){
                        button(libraryArea,"Check server for "+title,()->reconcileUnknownSubmissions());
                        button(libraryArea,"I verified: allow a new submission",()->confirmExplicitRequeue(id,title));
                    }
                }
            }
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
        if(selected.isEmpty()){err("Select READY subtitles using their checkboxes first.");return;}
        if(selected.size()>20){err("Submit up to 20 movie projects per batch.");return;}
        for(String id:selected){
            JSONObject entry=findEntry(id);
            if(entry==null||!"READY".equals(SubtitleShelf.state(entry))){
                err("One of the movies is already queued or needs review. Reload the list.");return;
            }
        }
        EditText minutes=new EditText(this);minutes.setInputType(InputType.TYPE_CLASS_NUMBER);
        minutes.setSingleLine(true);minutes.setText("15");minutes.setHint("Narration duration for each movie");
        new AlertDialog.Builder(this).setTitle("Queue "+selected.size()+" selected movie(s)")
            .setMessage("One Cloudflare project per selected movie, distributed across available Muse workers. The narration duration applies to EACH movie. Subtitles remain on the phone. An unknown server response locks that movie until reconciled, avoiding accidental repeats.")
            .setView(minutes).setNegativeButton("Cancel",null)
            .setPositiveButton("Start selected",(d,w)->{
                int target;
                try{target=Integer.parseInt(minutes.getText().toString().trim());}
                catch(NumberFormatException e){err("Enter 3–60 narration minutes.");return;}
                if(target<3||target>60){err("Choose 3–60 minutes.");return;}
                work("Checking Cloudflare before starting selected movies",()->{
                    JSONArray remote=cloud.projects().getJSONArray("projects");
                    JSONObject response=cloud.workers();
                    JSONArray ws=response.optJSONArray("workers");
                    List<String> active=new ArrayList<>();
                    if(ws!=null)for(int i=0;i<ws.length();i++){
                        JSONObject worker=ws.optJSONObject(i);
                        if(worker!=null&&worker.optBoolean("enabled",true)&&!worker.optBoolean("paused")&&
                           SecurityRules.validUuid(worker.optString("id")))active.add(worker.optString("id"));
                    }
                    if(active.isEmpty())throw new IllegalStateException("No enabled/unpaused Muse workers. Resume a worker before starting.");
                    int submitted=0,recognized=0,unknown=0,echoed=0;
                    StringBuilder failures=new StringBuilder();
                    for(String id:selected){
                        JSONObject entry=findEntry(id);
                        if(entry==null||!"READY".equals(SubtitleShelf.state(entry)))continue;
                        String title=entry.optString("title","Untitled");
                        final int count=++recognized;
                        info("Submitting "+count+"/"+selected.size()+": "+title);
                        int existing=CloudProjectReceipt.matchingCount(remote,title);
                        if(existing>0){
                            String found=CloudProjectReceipt.matchingProjectId(remote,title);
                            if(SecurityRules.validUuid(found)){
                                shelf.markQueued(id,found);
                                failures.append(title).append(": already on Cloudflare; linked to existing project instead of re-submitting.\n");
                            }else{
                                shelf.markUnknown(id,"Several matching Cloudflare projects. Resolve duplicates in Projects.");
                                unknown++;
                                failures.append(title).append(": multiple matching server projects; no submission made.\n");
                            }
                            continue;
                        }
                        boolean started=false;
                        try{
                            // Durable lock is written before the POST. App restarts cannot re-submit this movie silently.
                            shelf.markSubmitting(id);
                            started=true;
                            String srt=shelf.read(id);
                            JSONObject created=cloud.createProject(title,active.get((count-1)%active.size()),srt,48,target);
                            String projectId=CloudProjectReceipt.confirmedId(created);
                            if(!SecurityRules.validUuid(projectId)){
                                // The POST may have succeeded. GET reconciliation never sends another POST.
                                JSONArray fresh=cloud.projects().getJSONArray("projects");
                                projectId=CloudProjectReceipt.matchingProjectId(fresh,title);
                                remote=fresh;
                            }
                            if(!SecurityRules.validUuid(projectId))
                                throw new IOException("Server response has no confirmed project UUID. No automatic retry permitted.");
                            shelf.markQueued(id,projectId);
                            remote.put(new JSONObject().put("id",projectId).put("title",title));
                            submitted++;
                            if(created.optInt("targetMinutes",-1)==target||
                                (created.optJSONObject("project")!=null&&created.optJSONObject("project").optInt("targetMinutes",-1)==target))echoed++;
                        }catch(Exception failure){
                            if(started){
                                try{shelf.markUnknown(id,"Submission outcome unconfirmed. Recheck Projects before retry.");}
                                catch(Exception ignored){}
                                unknown++;
                            }
                            failures.append(title).append(": ")
                                .append(failure.getMessage()==null?"submission failed":failure.getMessage())
                                .append(started?" (LOCKED to prevent duplicate)\n":"\n");
                        }
                    }
                    return new String[]{String.valueOf(submitted),String.valueOf(unknown),
                        String.valueOf(echoed),failures.toString()};
                },report->{
                    librarySelection.clear();reloadLibrary();
                    String summary=report[0]+" NEW Cloudflare project(s) confirmed. "+
                        report[1]+" movie(s) have an uncertain or duplicate state and were LOCKED against retries.\n"+
                        "Requested "+target+" minutes of narration PER movie; "+
                        report[2]+" new project response(s) explicitly echoed that setting.\n\n"+
                        "Confirmed movies move from Ready to Queued in this screen. "+
                        "Unconfirmed movies stay visible for server reconciliation; no additional POST is sent.";
                    if(!report[3].isEmpty())summary+="\n\nDetails:\n"+report[3];
                    new AlertDialog.Builder(this).setTitle("Movie queue submission result")
                        .setMessage(summary).setPositiveButton("OK",null).show();
                });
            }).show();
    }
    private void reconcileUnknownSubmissions(){
        work("Rechecking Cloudflare for uncertain movies",()->{
            JSONArray remote=cloud.projects().getJSONArray("projects");
            JSONArray local=shelf.entries();int linked=0,remaining=0,finished=0;
            StringBuilder notes=new StringBuilder();
            for(int i=0;i<local.length();i++){
                JSONObject item=local.optJSONObject(i);
                if(item==null)continue;
                String state=SubtitleShelf.state(item);
                if("QUEUED".equals(state)){
                    String projectId=item.optString("projectId","");
                    for(int j=0;j<remote.length();j++){
                        JSONObject server=remote.optJSONObject(j);
                        if(server==null||!projectId.equals(server.optString("id")))continue;
                        String status=server.optString("status");
                        if("ready".equals(status)||"needs_review".equals(status)||"completed".equals(status)){
                            shelf.markFinished(item.optString("id"));finished++;
                        }
                    }
                    continue;
                }
                if(!"UNKNOWN".equals(state)&&!"SUBMITTING".equals(state))continue;
                String title=item.optString("title"),id=item.optString("id");
                String projectId=CloudProjectReceipt.matchingProjectId(remote,title);
                if(SecurityRules.validUuid(projectId)){
                    shelf.markQueued(id,projectId);linked++;
                    notes.append(title).append(": server project found and linked.\n");
                }else{
                    remaining++;
                    notes.append(title).append(": no unique server project. Still locked to prevent duplicates.\n");
                }
            }
            return new String[]{String.valueOf(linked),String.valueOf(remaining),String.valueOf(finished),notes.toString()};
        },report->{
            librarySelection.clear();reloadLibrary();
            showCopyableReport("Cloudflare reconciliation",
                report[0]+" movie(s) linked, "+report[1]+" remain uncertain; "+report[2]+" completed movie(s) updated.\n\n"+report[3]);
        });
    }
    private void confirmMoviePause(String id,String title,boolean pause){
        if(!SecurityRules.validUuid(id)){err("Movie has no confirmed Cloudflare project ID.");return;}
        new AlertDialog.Builder(this).setTitle((pause?"Pause ":"Resume ")+title)
            .setMessage("This controls only this movie project, not the whole Muse worker. Cloudflare must support movie-level pause/resume.")
            .setNegativeButton("Cancel",null)
            .setPositiveButton(pause?"Pause movie":"Resume movie",(d,w)->work("Updating movie queue",()->cloud.toggleMovie(id,pause),
                result->showCopyableReport("Movie control",result.toString()))).show();
    }
    private void confirmExplicitRequeue(String id,String title){
        EditText confirm=new EditText(this);confirm.setSingleLine(true);
        confirm.setHint("Type REQUEUE");confirm.setTextColor(Color.BLACK);
        new AlertDialog.Builder(this).setTitle("Explicitly allow another run?")
            .setMessage("DANGER: Cloudflare may already be processing this movie. Only use this after checking Projects. This overrides automatic duplicate protection. Type REQUEUE.")
            .setView(confirm).setNegativeButton("Cancel",null)
            .setPositiveButton("Allow new submission",(d,w)->{
                if(!"REQUEUE".equals(confirm.getText().toString().trim())){err("No change made.");return;}
                work("Recording manual requeue approval",()->{shelf.allowRequeue(id);return true;},
                    ok->{librarySelection.clear();reloadLibrary();});
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
