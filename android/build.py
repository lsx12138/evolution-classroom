"""Build a signed, installable APK using the Android tools already on this PC."""
from pathlib import Path
import os
import secrets
import shutil
import subprocess
import tempfile
import sys
import zipfile
import json
import xml.etree.ElementTree as ET

sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

ROOT = Path(__file__).resolve().parent
SDK = Path(os.environ.get('ANDROID_HOME') or Path.home() / 'AppData/Local/Android/Sdk')
java_command=shutil.which('java')
if not os.environ.get('JAVA_HOME') and not java_command: raise SystemExit('Set JAVA_HOME to a JDK (tested: JDK 21).')
JDK = Path(os.environ.get('JAVA_HOME') or Path(java_command).resolve().parent.parent)
TOOLS = SDK / 'build-tools/36.0.0'
ANDROID = SDK / 'platforms/android-36/android.jar'
TEMP_ROOT = Path(tempfile.gettempdir()).resolve()
BUILD = Path(tempfile.mkdtemp(prefix='evolution-classroom-', dir=TEMP_ROOT)).resolve()
DIST = ROOT / 'dist'
SIGNING = ROOT / 'signing'
UPSTREAM = ROOT.parent / 'node_modules/@ansuman-shukla/whiteboard-mcp'
version_name = ET.parse(ROOT / 'AndroidManifest.xml').getroot().get('{http://schemas.android.com/apk/res/android}versionName')
if not version_name or not all(c in '0123456789.' for c in version_name):
    raise SystemExit('Invalid Android version name')
localization = json.loads(subprocess.check_output([
    os.environ.get('NODE_EXE') or shutil.which('node') or 'node', str(ROOT.parent / 'localize-whiteboard.mjs')
], encoding='utf-8'))
localized_assets = Path(localization['assetDirectory']).name


def run(name, *args, env=None):
    print('Running:', name, flush=True)
    argv = [str(a) for a in args]
    if Path(argv[0]).name == 'java.exe':
        argv[1:1] = ['-Dfile.encoding=UTF-8', '-Duser.language=en']
    elif Path(argv[0]).name in ('javac.exe', 'keytool.exe'):
        argv[1:1] = ['-J-Dfile.encoding=UTF-8', '-J-Duser.language=en']
    subprocess.run(argv, check=True, cwd=BUILD, env=env)


for file in (JDK / 'bin/javac.exe', TOOLS / 'aapt2.exe', TOOLS / 'lib/d8.jar', ANDROID, UPSTREAM / 'dist/frontend/index.html'):
    if not file.is_file():
        raise SystemExit('Missing build prerequisite: ' + str(file))
BUILD.mkdir(exist_ok=True)
DIST.mkdir(exist_ok=True)
SIGNING.mkdir(exist_ok=True)
for name in ('classes', 'generated', 'dex', 'assets', 'test-classes'):
    target = (BUILD / name).resolve()
    if target.parent != BUILD.resolve():
        raise SystemExit('Refusing to clean outside the app build directory')
    if target.exists():
        shutil.rmtree(target)
    target.mkdir()
def frontend_ignore(path, names):
    if Path(path).resolve() == (UPSTREAM / 'dist/frontend/assets').resolve():
        return [name for name in names if name != localized_assets]
    return []


shutil.copytree(UPSTREAM / 'dist/frontend', BUILD / 'assets/whiteboard', ignore=frontend_ignore)
shutil.copyfile(UPSTREAM / 'LICENSE', BUILD / 'assets/WHITEBOARD_LICENSE.txt')
shutil.copyfile(ROOT / 'NOTICE.md', BUILD / 'assets/NOTICE.md')
shutil.copytree(ROOT / 'src', BUILD / 'src')
shutil.copytree(ROOT / 'res', BUILD / 'res')
shutil.copytree(ROOT / 'tests', BUILD / 'tests')
shutil.copyfile(ROOT / 'AndroidManifest.xml', BUILD / 'AndroidManifest.xml')
compiled = BUILD / 'compiled.zip'
if compiled.exists():
    compiled.unlink()
run('compile resources', TOOLS / 'aapt2.exe', 'compile', '--dir', BUILD / 'res', '-o', compiled)
resource_apk = BUILD / 'resources.apk'
run('link resources', TOOLS / 'aapt2.exe', 'link', '-o', resource_apk, '-I', ANDROID,
    '--manifest', BUILD / 'AndroidManifest.xml', '--java', BUILD / 'generated',
    compiled, '-A', BUILD / 'assets', '--min-sdk-version', '26', '--target-sdk-version', '35')
sources = list((BUILD / 'src').rglob('*.java')) + list((BUILD / 'generated').rglob('*.java'))
run('compile Java', JDK / 'bin/javac.exe', '-encoding', 'UTF-8', '--release', '8',
    '-classpath', ANDROID, '-d', BUILD / 'classes', *sources)
run('verify connection parsing', JDK / 'bin/javac.exe', '-encoding', 'UTF-8', '-classpath', BUILD / 'classes',
    '-d', BUILD / 'test-classes', BUILD / 'tests/ConnectionInfoTest.java')
run('connection tests', JDK / 'bin/java.exe', '-cp', str(BUILD / 'classes') + os.pathsep + str(BUILD / 'test-classes'), 'ConnectionInfoTest')
classes = list((BUILD / 'classes').rglob('*.class'))
run('compile DEX', JDK / 'bin/java.exe', '-cp', TOOLS / 'lib/d8.jar', 'com.android.tools.r8.D8',
    '--min-api', '26', '--lib', ANDROID, '--output', BUILD / 'dex', *classes)
unsigned = BUILD / 'classroom-unsigned.apk'
with zipfile.ZipFile(resource_apk, 'r') as resources, zipfile.ZipFile(unsigned, 'w', compression=zipfile.ZIP_DEFLATED) as apk:
    for source in resources.infolist():
        entry = zipfile.ZipInfo(source.filename, source.date_time)
        entry.compress_type = source.compress_type
        entry.external_attr = source.external_attr
        apk.writestr(entry, resources.read(source))
    for dex in (BUILD / 'dex').glob('*.dex'):
        apk.write(dex, dex.name)
aligned = BUILD / 'classroom-aligned.apk'
run('align APK', TOOLS / 'zipalign.exe', '-f', '-p', '4', unsigned, aligned)
key = SIGNING / 'classroom-local.p12'
password = SIGNING / 'keystore-password.txt'
if not key.exists():
    if not password.exists():
        password.write_text(secrets.token_urlsafe(32), encoding='ascii')
    signing_env = {**os.environ, 'STUDY_APK_KEYPASS': password.read_text(encoding='ascii')}
    run('create local signing key', JDK / 'bin/keytool.exe', '-genkeypair', '-keystore', key,
        '-storetype', 'PKCS12', '-storepass:env', 'STUDY_APK_KEYPASS', '-keypass:env', 'STUDY_APK_KEYPASS',
        '-alias', 'study-classroom', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '3650',
        '-dname', 'CN=Evolution Classroom, OU=Personal Learning', env=signing_env)
output = DIST / ('进化课堂-' + version_name + '.apk')
signing_env = {**os.environ, 'STUDY_APK_KEYPASS': password.read_text(encoding='ascii')}
run('sign APK', JDK / 'bin/java.exe', '-jar', TOOLS / 'lib/apksigner.jar', 'sign', '--ks', key,
    '--ks-key-alias', 'study-classroom', '--ks-pass', 'env:STUDY_APK_KEYPASS', '--key-pass', 'env:STUDY_APK_KEYPASS',
    '--out', output, aligned, env=signing_env)
run('verify signature', JDK / 'bin/java.exe', '-jar', TOOLS / 'lib/apksigner.jar', 'verify', '--verbose', output)
print('APK:', output, flush=True)
print('Size MiB:', round(output.stat().st_size / 1024 / 1024, 2), flush=True)
if BUILD.parent == TEMP_ROOT and BUILD.name.startswith('evolution-classroom-'):
    shutil.rmtree(BUILD)
