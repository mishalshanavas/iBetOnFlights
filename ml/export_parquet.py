"""Convert exported research positions to a local Parquet dataset."""
import argparse
import pandas as pd
parser = argparse.ArgumentParser()
parser.add_argument("input")
parser.add_argument("output")
args = parser.parse_args()
pd.read_json(args.input).to_parquet(args.output, index=False)
