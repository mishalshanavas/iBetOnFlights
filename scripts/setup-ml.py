#!/usr/bin/env python3
"""One-command local setup. No deployment or production build is performed."""
import argparse
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--start-period", default="202301")
    parser.add_argument("--end-period")
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    python = ROOT / ".venv/bin/python"
    if not python.exists():
        subprocess.run([sys.executable, "-m", "venv", str(ROOT / ".venv")], check=True)
    subprocess.run([str(python), "-m", "pip", "install", "-r", "ml/requirements-caa-lock.txt"], cwd=ROOT, check=True)
    command = [str(python), "scripts/import-caa.py", "--start-period", args.start_period,
               "--dry-run", "--output-dir", "ml/datasets/caa"]
    if args.end_period:
        command += ["--end-period", args.end_period]
    if args.refresh:
        command += ["--refresh"]
    subprocess.run(command, cwd=ROOT, check=True)
    subprocess.run([str(python), "ml/train_caa.py"], cwd=ROOT, check=True)
    print("ML model is ready. npm run dev serves inference directly in the existing API.")


if __name__ == "__main__":
    main()
