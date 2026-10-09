#!/usr/bin/env python3
"""stdio 侧车入口（WorkOn modelClient 调用）：python ml/jev/sidecar.py --mode fast"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from jev.serve.sidecar import main
main()
