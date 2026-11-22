#!/usr/bin/env python3
"""a2_share · PC 端入口。

    python a2-share/pc/a2_share.py --help
    python a2-share/pc/a2_share.py --selftest
"""

from __future__ import annotations

import sys
from pathlib import Path

# 让 `import a2share` 在任何工作目录下都能工作
sys.path.insert(0, str(Path(__file__).resolve().parent))

from a2share.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
