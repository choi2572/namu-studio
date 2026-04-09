"""Console + optional application log file (``WORKFLOW_AGENT_LOG_FILE``)."""

from __future__ import annotations

import logging
import os
import sys
from copy import deepcopy
from pathlib import Path
from typing import Any

_LOG_FMT = "%(asctime)s %(levelname)s [%(name)s] %(message)s"


def _stderr_stream_handler_exists(root: logging.Logger) -> bool:
    for h in root.handlers:
        if isinstance(h, logging.StreamHandler) and not isinstance(h, logging.FileHandler):
            stream = getattr(h, "stream", None)
            if stream in (sys.stderr, sys.__stderr__):
                return True
    return False


def configure_application_logging() -> None:
    """Attach stderr (and optional file) handlers on the root logger for app modules."""
    root = logging.getLogger()
    if not _stderr_stream_handler_exists(root):
        stderr_h = logging.StreamHandler(sys.stderr)
        stderr_h.setLevel(logging.INFO)
        stderr_h.setFormatter(logging.Formatter(_LOG_FMT))
        root.addHandler(stderr_h)
    if root.level == logging.NOTSET:
        root.setLevel(logging.INFO)

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


def build_uvicorn_log_config() -> dict[str, Any]:
    """Uvicorn default config plus a root logger so ``workflow_agent.*`` INFO logs are not dropped."""
    from uvicorn.config import LOGGING_CONFIG

    cfg: dict[str, Any] = deepcopy(LOGGING_CONFIG)
    cfg["root"] = {"handlers": ["default"], "level": "INFO"}
    return cfg
