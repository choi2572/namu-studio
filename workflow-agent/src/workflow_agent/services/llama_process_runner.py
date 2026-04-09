"""Single-process llama-server lifecycle (stop, spawn, port checks)."""

from __future__ import annotations

import logging
import socket
import subprocess
import threading
import time

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

    __slots__ = ("_lock", "_proc", "_shutdown_timeout")

    def __init__(self, shutdown_timeout: float) -> None:
        self._shutdown_timeout = shutdown_timeout
        self._lock = threading.Lock()
        self._proc: subprocess.Popen[str] | None = None

    def stop_tracked_process(self, log: logging.Logger) -> None:
        with self._lock:
            proc = self._proc
            if proc is None:
                log.info("llama-server: no tracked process")
                return

            if proc.poll() is not None:
                log.info("llama-server: tracked process already exited (code=%s)", proc.returncode)
                self._proc = None
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
            log.info("llama-server: process for former pid=%s is stopped", pid)

    def spawn(self, cmd: list[str], log: logging.Logger) -> None:
        with self._lock:
            if self._proc is not None and self._proc.poll() is None:
                raise ModelRuntimeError("internal error: spawn requested while llama-server is still running")
            if self._proc is not None:
                self._proc = None

            log.info("llama-server: spawning command: %s", " ".join(cmd))
            try:
                self._proc = subprocess.Popen(  # pylint: disable=consider-using-with
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    start_new_session=True,
                )
            except OSError as exc:
                raise ModelRuntimeError(f"failed to spawn llama-server: {exc}") from exc

            log.info("llama-server: started pid=%s", self._proc.pid)

    def read_stderr_after_exit(self) -> str:
        with self._lock:
            proc = self._proc
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
