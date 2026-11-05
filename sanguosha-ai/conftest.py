"""让 pytest 能直接 import sanguosha_ai 包。"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
