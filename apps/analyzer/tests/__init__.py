import os
import sys


ANALYZER_ROOT = os.path.dirname(os.path.dirname(__file__))
if ANALYZER_ROOT not in sys.path:
    sys.path.insert(0, ANALYZER_ROOT)
