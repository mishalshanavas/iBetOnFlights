#!/usr/bin/env python3
"""Deploy the private prediction API using AWS CLI and ignored .env.local."""
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
REGION = os.environ.get("PREDICTION_AWS_REGION", "ap-south-1")
STACK = "flightguard-predictions"


def aws(*args):
    result = subprocess.run(["aws", *args, "--region", REGION, "--output", "json"],
                            cwd=ROOT, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip())
    if args[:2] == ("cloudformation", "package"):
        return {}
    return json.loads(result.stdout) if result.stdout.strip() else {}


def main():
    env_file = ROOT / ".env.local"
    lines = env_file.read_text().splitlines() if env_file.exists() else []
    config = dict(line.split("=", 1) for line in lines if "=" in line and not line.startswith("#"))
    config = {key: value.strip().strip('"').strip("'") for key, value in config.items()}
    for key in ("DATABASE_URL", "DATABASE_AUTH_TOKEN", "PREDICTION_API_TOKEN"):
        if os.environ.get(key):
            config[key] = os.environ[key]
    if not config.get("DATABASE_URL", "").startswith(("libsql://", "https://")) or not config.get("DATABASE_AUTH_TOKEN"):
        raise RuntimeError("Set hosted DATABASE_URL and DATABASE_AUTH_TOKEN in .env.local.")
    config.setdefault("PREDICTION_API_TOKEN", secrets.token_urlsafe(48))
    account = aws("sts", "get-caller-identity")["Account"]
    bucket = f"flightguard-lambda-{account}-{REGION}"
    try:
        aws("s3api", "head-bucket", "--bucket", bucket)
    except RuntimeError:
        args = ["s3api", "create-bucket", "--bucket", bucket]
        if REGION != "us-east-1":
            args += ["--create-bucket-configuration", f"LocationConstraint={REGION}"]
        aws(*args)
    aws("s3api", "put-public-access-block", "--bucket", bucket,
        "--public-access-block-configuration",
        "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true")
    subprocess.run(["npm", "run", "lambda:package"], cwd=ROOT, check=True)
    with tempfile.TemporaryDirectory(prefix="flightguard-deploy-") as directory:
        template = Path(directory) / "template.yaml"
        parameters = Path(directory) / "parameters.json"
        parameters.write_text(json.dumps([
            {"ParameterKey": "DatabaseUrl", "ParameterValue": config["DATABASE_URL"]},
            {"ParameterKey": "DatabaseAuthToken", "ParameterValue": config["DATABASE_AUTH_TOKEN"]},
            {"ParameterKey": "PredictionApiToken", "ParameterValue": config["PREDICTION_API_TOKEN"]},
        ]))
        parameters.chmod(0o600)
        aws("cloudformation", "package", "--template-file", "aws/template.yaml",
            "--s3-bucket", bucket, "--output-template-file", str(template))
        try:
            aws("cloudformation", "describe-stacks", "--stack-name", STACK)
            operation, waiter = "update-stack", "stack-update-complete"
        except RuntimeError as error:
            if "does not exist" not in str(error):
                raise
            operation, waiter = "create-stack", "stack-create-complete"
        try:
            aws("cloudformation", operation, "--stack-name", STACK,
                "--template-body", f"file://{template}", "--parameters", f"file://{parameters}",
                "--capabilities", "CAPABILITY_IAM", "CAPABILITY_AUTO_EXPAND")
            print(f"Waiting for {STACK} in {REGION}...", flush=True)
            aws("cloudformation", "wait", waiter, "--stack-name", STACK)
        except RuntimeError as error:
            if "No updates are to be performed" not in str(error):
                raise
    stack = aws("cloudformation", "describe-stacks", "--stack-name", STACK)["Stacks"][0]
    config["PREDICTION_API_BASE_URL"] = next(item["OutputValue"] for item in stack["Outputs"] if item["OutputKey"] == "ApiUrl")
    keys = ("DATABASE_URL", "DATABASE_AUTH_TOKEN", "PREDICTION_API_TOKEN", "PREDICTION_API_BASE_URL")
    lines = [line for line in lines if line.split("=", 1)[0] not in keys]
    env_file.write_text("\n".join(lines + [key + "=" + config[key] for key in keys]) + "\n")
    env_file.chmod(0o600)
    print("Deployed: " + config["PREDICTION_API_BASE_URL"])
    print("Server credentials saved to ignored .env.local.")


if __name__ == "__main__":
    main()
