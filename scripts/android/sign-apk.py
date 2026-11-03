"""Sign the Android release with the repository's persistent release key."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import zipfile


def main():
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", default=json.loads((root / "package.json").read_text())["version"])
    args = parser.parse_args()
    version = json.loads((root / "package.json").read_text())["version"]
    if args.version != version or not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise SystemExit("The Android release version must match package.json.")

    required = ["ANDROID_KEYSTORE_BASE64", "ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD"]
    missing = [name for name in required if not os.environ.get(name)]
    if missing:
        raise SystemExit("Set the Android release signing secrets: " + ", ".join(missing))
    sdk = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    if not sdk:
        raise SystemExit("ANDROID_HOME must point to the Android SDK.")
    tools = Path(sdk) / "build-tools/36.0.0"
    unsigned = root / "android/app/build/outputs/apk/release/app-release-unsigned.apk"
    if not unsigned.is_file():
        raise SystemExit("Build android/:app:assembleRelease before signing.")
    with zipfile.ZipFile(unsigned) as apk:
        apk.getinfo("assets/game/index.html")
        caches = json.loads(apk.read("assets/game/caches/caches.json"))
        if not isinstance(caches, list) or not caches:
            raise SystemExit("The APK is missing its bundled slim cache.")
        for cache in caches:
            name = cache.get("name", "")
            if not cache.get("slimOf") or not name or any(c in name for c in "/\\:"):
                raise SystemExit("The APK must contain only the game's slim cache.")
            for file in ["main_file_cache.dat2", "main_file_cache.idx255"]:
                if apk.getinfo(f"assets/game/caches/{name}/{file}").file_size == 0:
                    raise SystemExit("The APK contains an empty cache file.")
    release = root / "release"
    release.mkdir(exist_ok=True)
    output = release / f"Run-Escape-{version}-android.apk"

    # The key stays outside the checkout and is removed even when signing fails.
    with tempfile.TemporaryDirectory(prefix="run-escape-signing-", dir=os.environ.get("RUNNER_TEMP")) as temporary:
        temporary = Path(temporary)
        keystore = temporary / "release.jks"
        encoded = "".join(os.environ["ANDROID_KEYSTORE_BASE64"].split())
        keystore.write_bytes(base64.b64decode(encoded, validate=True))
        keystore.chmod(0o600)
        aligned = temporary / "aligned.apk"
        subprocess.run([str(tools / "zipalign"), "-f", "4", str(unsigned), str(aligned)], check=True)
        subprocess.run([
            str(tools / "apksigner"), "sign", "--ks", str(keystore),
            "--ks-key-alias", os.environ["ANDROID_KEY_ALIAS"],
            "--ks-pass", "env:ANDROID_KEYSTORE_PASSWORD", "--key-pass", "env:ANDROID_KEY_PASSWORD",
            "--v1-signing-enabled", "false", "--v2-signing-enabled", "true",
            "--v3-signing-enabled", "true", "--v4-signing-enabled", "false",
            "--out", str(output), str(aligned),
        ], check=True)
        subprocess.run([str(tools / "apksigner"), "verify", "--verbose", str(output)], check=True)
        subprocess.run([str(tools / "zipalign"), "-c", "4", str(output)], check=True)

    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix(".apk.sha256").write_text(f"{digest}  {output.name}\n")
    print(f"Signed and verified {output.name} ({output.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
