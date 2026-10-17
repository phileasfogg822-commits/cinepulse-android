"""Dependency-free project structure / security baseline checks (not an Android build)."""
from pathlib import Path
import xml.etree.ElementTree as ET
p=Path(__file__).resolve().parents[1]
files={x.relative_to(p).as_posix(): x for x in p.rglob('*') if x.is_file()}
for f in ['app/src/main/AndroidManifest.xml','app/src/main/res/xml/network_security_config.xml','app/src/main/java/com/cinepulse/mobile/CloudApi.java','app/src/main/java/com/cinepulse/mobile/SecureTokenStore.java','app/src/main/java/com/cinepulse/mobile/VerifiedDownloads.java','app/src/main/java/com/cinepulse/mobile/MainActivity.java','.github/workflows/bootstrap-apk.yml']:
 assert f in files, f
for n,x in files.items():
 if n.endswith('.xml'):ET.parse(x)
main=(p/'app/src/main/AndroidManifest.xml').read_text()
assert main.count('uses-permission')==1
assert 'android.permission.INTERNET' in main
assert 'android:allowBackup="false"' in main
assert 'android:usesCleartextTraffic="false"' in main
assert 'android:exported="true"' in main
sdk=(p/'app/build.gradle').read_text()
assert 'minSdk 26' in sdk and 'targetSdk 35' in sdk
net=(p/'app/src/main/java/com/cinepulse/mobile/CloudApi.java').read_text()
assert 'setInstanceFollowRedirects(false)' in net and 'Bearer ' in net
store=(p/'app/src/main/java/com/cinepulse/mobile/SecureTokenStore.java').read_text()
assert 'AndroidKeyStore' in store and 'AES/GCM/NoPadding' in store
transfer=(p/'app/src/main/java/com/cinepulse/mobile/VerifiedDownloads.java').read_text()
assert 'sha256(temp)' in transfer and 'nbytes!=length' in transfer
assert 'MAX_MP3_BYTES' in transfer and 'File.createTempFile' in transfer
assert not any('ADMIN_TOKEN=' in x.read_text(errors='replace') or 'Bearer ey' in x.read_text(errors='replace') for x in files.values() if x.suffix in ('.java','.md','.gradle','.xml','.yml'))
print('PASS: project structure, XML, API isolation, encrypted token handling, bounded/verified downloads, and static baseline')
