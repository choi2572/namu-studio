"""Console + optional application log file (``WORKFLOW_AGENT_LOG_FILE``)."""

from __future__ import annotations

import logging
import os
from pathlib import Path

_LOG_FMT = "%(asctime)s %(levelname)s [%(name)s] %(message)s"


def configure_application_logging() -> None:
    """Ensure stderr logging exists, then append a file handler when configured."""
    root = logging.getLogger()
    if not root.handlers:
        logging.basicConfig(level=logging.INFO, format=_LOG_FMT)

    raw = os.environ.get("WORKFLOW_AGENT_LOG_FILE", "").strip()
    if not raw:
        return

    path = Path(raw).expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    resolved = path.resolve()
    for h in root.handlers:
        if isinstance(h, logging.FileHandler):
            try:
                if Path(h.baseFilename).resolve() == resolved:
                    return
            except OSError:
                continue

    fh = logging.FileHandler(path, encoding="utf-8")
    fh.setLevel(logging.INFO)
    fh.setFormatter(logging.Formatter(_LOG_FMT))
    root.addHandler(fh)
