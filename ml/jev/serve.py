#!/usr/bin/env python3
"""HTTP 服务入口：python ml/jev/serve.py --port 8765"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from jev.serve.server import main
main()
