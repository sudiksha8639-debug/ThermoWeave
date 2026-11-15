"""Write mock stand-ins for every upstream hand-off.  Usage: python -m pipeline.tables.make_mocks"""
from . import mocks

if __name__ == "__main__":
    mocks.generate()
    print("wrote mock hand-offs: data/processed/*.parquet and upstream JSON in web/public/data")
