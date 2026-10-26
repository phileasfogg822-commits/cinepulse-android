package com.cinepulse.mobile;

/** User-run, offline Windows hash-verification and absolute MP3 linking. */
final class WindowsPackageBootstrap {
    private WindowsPackageBootstrap(){}
    static String bat(){return "@echo off\r\nsetlocal\r\ncd /d \"%~dp0\"\r\nwhere node >nul 2>&1\r\nif errorlevel 1 (echo Node.js is needed to link the MP3 files.& pause & exit /b 1)\r\nnode CinePulse_Prepare_Windows.js\r\nif errorlevel 1 (echo Preparation failed. Cloudflare files remain unchanged.& pause & exit /b 1)\r\necho In Windows CinePulse, choose Import team project and select CinePulse_Windows_Ready.json\r\npause\r\n";}
    static String js(){return """
        'use strict';
        // Local only: validate MP3 hashes from the signed Cloudflare manifest.
        const fs=require('fs'),path=require('path'),crypto=require('crypto');
        const home=__dirname;
        try{
          const input=path.join(home,'CinePulse_Windows_Project.json');
          const project=JSON.parse(fs.readFileSync(input,'utf8'));
          if(project.cloudImport?.schema!=='cinepulse.windows-portable.v1')
            throw Error('Incorrect Windows portable project schema');
          for(const [track,lang] of [['english','english'],['hindiUrdu','urdu']]){
            const manifest=project.cloudImport.audio?.[lang];
            if(!manifest)throw Error(lang+' MP3 manifest missing');
            const expectedName=lang==='english'?'CinePulse_English.mp3':'CinePulse_Urdu.mp3';
            if(manifest.filename!==expectedName || !/^[a-f0-9]{64}$/i.test(manifest.sha256)
                || !Number.isSafeInteger(manifest.bytes)||manifest.bytes<=0)
              throw Error('Invalid '+lang+' MP3 manifest');
            const filename=path.join(home,expectedName),stat=fs.statSync(filename);
            if(!stat.isFile()||stat.size!==manifest.bytes)throw Error(lang+' MP3 byte count mismatch');
            const digest=crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
            if(digest.toLowerCase()!==manifest.sha256.toLowerCase())
              throw Error(lang+' MP3 SHA-256 mismatch');
            project.tracks[track].mp3Path=filename;
            project.tracks[track].message='SHA-256 verified local MP3; Windows still checks measured duration and SRT.';
            console.log('VERIFIED '+lang+': '+filename);
          }
          const output=path.join(home,'CinePulse_Windows_Ready.json');
          fs.writeFileSync(output,JSON.stringify(project,null,2),'utf8');
          console.log('READY:',output);
          console.log('Import via CinePulse > Import team project. Attach video; verify audio/SRT and scene matches.');
        }catch(e){console.error('Preparation failed:',String(e.message||e));process.exitCode=1;}
        """;}
}
