import json
import os
import sys
from pathlib import Path

def setup():
    from argostranslate import package, translate
    if not any(p.from_code == "en" and p.to_code == "pl" for p in package.get_installed_packages()):
        package.update_package_index()
        candidates = [p for p in package.get_available_packages() if p.from_code == "en" and p.to_code == "pl"]
        if not candidates:
            raise RuntimeError("English-Polish model unavailable")
        package.install_from_path(candidates[0].download())
    return translate

if __name__ == "__main__":
    # Keep stdout reserved for the JSON response.
    output = sys.stdout
    sys.stdout = sys.stderr
    os.environ["ARGOS_MODEL_PROVIDER"] = "OPENNMT"
    os.environ["ARGOS_DEVICE_TYPE"] = "cpu"
    os.environ["ARGOS_INTER_THREADS"] = "1"
    os.environ["ARGOS_INTRA_THREADS"] = "2"
    os.environ["ARGOS_CHUNK_TYPE"] = "MINISBD"
    os.environ["ARGOS_PACKAGES_DIR"] = str(Path(sys.argv[1]).resolve())
    Path(os.environ["ARGOS_PACKAGES_DIR"]).mkdir(parents=True, exist_ok=True)
    request = json.load(sys.stdin)
    translator = setup()
    result = {k: translator.translate(request[k], "en", "pl") if request[k] else "" for k in ("title", "content")}
    output.write(json.dumps(result, ensure_ascii=True))
    output.flush()
