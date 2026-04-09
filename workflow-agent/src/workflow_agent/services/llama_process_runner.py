"""Single-process llama-server lifecycle (stop, spawn, port checks)."""

from __future__ import annotations

import logging
import socket
import subprocess
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import TextIO

from workflow_agent.services.model_runtime_backend import ModelRuntimeError

_STDERR_TAIL_LINES = 40

LOG = logging.getLogger(__name__)


def tcp_connect_ok(host: str, port: int, *, timeout: float) -> bool:
    try:
        with socket.create_connection((host, int(port)), timeout=timeout):
            return True
    except OSError:
        return False


def wait_until_port_closed(
    host: str,
    port: int,
    *,
    total_timeout: float,
    interval: float,
    log: logging.Logger,
) -> None:
    log.info("verify shutdown: expecting %s:%s to stop accepting connections", host, port)
    deadline = time.monotonic() + total_timeout
    while time.monotonic() < deadline:
        if not tcp_connect_ok(host, port, timeout=0.25):
            log.info("port %s:%s is closed (or refused)", host, port)
            return
        time.sleep(interval)
    msg = (
        f"shutdown verification failed: {host}:{port} still accepts connections after {total_timeout}s; "
        "another process may own the port"
    )
    raise ModelRuntimeError(msg)


def wait_until_port_open(
    host: str,
    port: int,
    *,
    total_timeout: float,
    interval: float,
    log: logging.Logger,
) -> None:
    log.info("waiting for listener on %s:%s (timeout=%ss)", host, port, total_timeout)
    deadline = time.monotonic() + total_timeout
    while time.monotonic() < deadline:
        if tcp_connect_ok(host, port, timeout=0.25):
            log.info("port %s:%s is accepting connections", host, port)
            return
        time.sleep(interval)
    msg = f"llama-server did not listen on {host}:{port} within {total_timeout}s"
    raise ModelRuntimeError(msg)


class LlamaServerProcessRunner:
    """Tracks one ``llama-server`` subprocess at a time (see ``ModelRuntimeBackend``)."""

    __slots__ = ("_lock", "_proc", "_shutdown_timeout", "_stdio_fh", "_stdio_log_path")

    def __init__(self, shutdown_timeout: float) -> None:
        self._shutdown_timeout = shutdown_timeout
        self._lock = threading.Lock()
        self._proc: subprocess.Popen[str] | None = None
        self._stdio_fh: TextIO | None = None
        self._stdio_log_path: Path | None = None

    def _release_stdio_locked(self) -> None:
        fh = self._stdio_fh
        self._stdio_fh = None
        self._stdio_log_path = None
        if fh is not None:
            try:
                fh.close()
            except OSError:
                pass

    def stop_tracked_process(self, log: logging.Logger) -> None:
        with self._lock:
            proc = self._proc
            if proc is None:
                self._release_stdio_locked()
                log.info("llama-server: no tracked process")
                return

            if proc.poll() is not None:
                log.info("llama-server: tracked process already exited (code=%s)", proc.returncode)
                self._proc = None
                self._release_stdio_locked()
                return

            pid = proc.pid
            log.info("llama-server: sending SIGTERM to pid=%s", pid)
            proc.terminate()
            try:
                proc.wait(timeout=self._shutdown_timeout)
            except subprocess.TimeoutExpired:
                log.warning("llama-server: pid=%s still alive after %ss; SIGKILL", pid, self._shutdown_timeout)
                proc.kill()
                proc.wait(timeout=10)

            self._proc = None
            self._release_stdio_locked()
            log.info("llama-server: process for former pid=%s is stopped", pid)

    def spawn(
        self,
        cmd: list[str],
        log: logging.Logger,
        *,
        stdio_log_path: Path | None = None,
    ) -> None:
        with self._lock:
            if self._proc is not None and self._proc.poll() is None:
                raise ModelRuntimeError("internal error: spawn requested while llama-server is still running")
            if self._proc is not None:
                self._proc = None
                self._release_stdio_locked()

            log.info("llama-server: spawning command: %s", " ".join(cmd))
            try:
                if stdio_log_path is not None:
                    lp = stdio_log_path.expanduser().resolve()
                    lp.parent.mkdir(parents=True, exist_ok=True)
                    self._stdio_log_path = lp
                    fh: TextIO = open(  # pylint: disable=consider-using-with
                        lp,
                        "a",
                        encoding="utf-8",
                    )
                    self._stdio_fh = fh
                    fh.write("\n" + "=" * 72 + "\n")
                    fh.write(f"# workflow-agent llama-server session {datetime.now(timezone.utc).isoformat()}\n")
                    fh.write(f"# command: {' '.join(cmd)}\n")
                    fh.write("=" * 72 + "\n")
                    fh.flush()
                    self._proc = subprocess.Popen(  # pylint: disable=consider-using-with
                        cmd,
                        stdout=fh,
                        stderr=subprocess.STDOUT,
                        text=True,
                        start_new_session=True,
                    )
                else:
                    self._stdio_fh = None
                    self._stdio_log_path = None
                    self._proc = subprocess.Popen(  # pylint: disable=consider-using-with
                        cmd,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        text=True,
                        start_new_session=True,
                    )
            except OSError as exc:
                self._release_stdio_locked()
                raise ModelRuntimeError(f"failed to spawn llama-server: {exc}") from exc

            log.info("llama-server: started pid=%s", self._proc.pid)

    def read_stderr_after_exit(self) -> str:
        proc: subprocess.Popen[str] | None
        log_path: Path | None
        fh: TextIO | None
        with self._lock:
            proc = self._proc
            log_path = self._stdio_log_path
            fh = self._stdio_fh
        if log_path is not None:
            if fh is not None:
                try:
                    fh.flush()
                except OSError:
                    pass
            try:
                text = log_path.read_text(encoding="utf-8")
            except OSError:
                return ""
            lines = text.splitlines()
            return "\n".join(lines[-_STDERR_TAIL_LINES:]).strip()
        if proc is None or proc.stderr is None:
            return ""
        try:
            _, err = proc.communicate(timeout=5)
        except (OSError, ValueError, subprocess.SubprocessError):
            return ""
        lines = (err or "").splitlines()
        return "\n".join(lines[-_STDERR_TAIL_LINES:]).strip()

    def poll_exit_early(self, log: logging.Logger, *, grace_seconds: float = 0.5) -> None:
        """If the server exits immediately after spawn, surface stderr."""
        time.sleep(grace_seconds)
        with self._lock:
            proc = self._proc
            if proc is None:
                return
            code = proc.poll()
            if code is None:
                return
        tail = self.read_stderr_after_exit()
        log.error("llama-server exited early with code=%s; stderr tail:\n%s", code, tail or "(empty)")
        raise ModelRuntimeError(
            f"llama-server exited immediately with code {code}",
            errors=[tail or f"exit code {code}"],
        )
