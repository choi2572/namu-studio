"""YAML-driven local ``llama-server`` runner implementing ``ModelRuntimeBackend``."""

from __future__ import annotations

import logging
import os
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

from workflow_agent.services.llama_process_runner import (
    LlamaServerProcessRunner,
    tcp_connect_ok,
    wait_until_port_closed,
    wait_until_port_open,
)
from workflow_agent.services.model_runtime_backend import ModelRuntimeError
from workflow_agent.settings.llama_models_config import LlamaModelsConfig, ModelServeEntry

LOG = logging.getLogger(__name__)


def _wait_until_health_ok(
    host: str,
    port: int,
    health_path: str,
    per_request_timeout: float,
    total_timeout: float,
    interval: float,
    log: logging.Logger,
) -> None:
    """Poll HTTP until llama-server returns 2xx (503 while loading weights is retried)."""
    paths = [health_path]
    if health_path != "/":
        paths.append("/")
    deadline = time.monotonic() + total_timeout
    last_detail = "no response yet"
    last_periodic_warn = 0.0
    attempt = 0
    log.info(
        "llama-server: polling HTTP health until 2xx (deadline %.0fs, interval %ss); "
        "503 while the model loads/fits is normal",
        total_timeout,
        interval,
    )
    while time.monotonic() < deadline:
        attempt += 1
        for path in paths:
            url = f"http://{host}:{port}{path}"
            try:
                with urllib.request.urlopen(url, timeout=per_request_timeout) as resp:
                    code = resp.getcode()
                    if 200 <= code < 300:
                        log.info(
                            "llama-server: health OK (HTTP %s via %s, attempt %s)",
                            code,
                            path,
                            attempt,
                        )
                        return
                    last_detail = f"HTTP {code} for {path}"
            except urllib.error.HTTPError as exc:
                last_detail = f"HTTPError {exc.code} for {path}"
            except urllib.error.URLError as exc:
                last_detail = f"URLError for {path}: {exc.reason!r}"

        now = time.monotonic()
        if now - last_periodic_warn >= 15.0:
            log.warning(
                "llama-server: still waiting for ready health (attempt %s, last: %s)",
                attempt,
                last_detail,
            )
            last_periodic_warn = now

        time.sleep(interval)

    raise ModelRuntimeError(
        f"health check timed out after {total_timeout}s on {host}:{port} (last: {last_detail})",
        errors=[last_detail],
    )


def _build_llama_command(cfg: LlamaModelsConfig, entry: ModelServeEntry, gguf: Path) -> list[str]:
    return [
        cfg.llama_server_executable,
        "--model",
        str(gguf),
        "--port",
        str(entry.port),
        "--host",
        cfg.host,
        *entry.extra_args,
    ]


class LlamaCppProcessBackend:
    """One active ``llama-server`` at a time, keyed by configured model id."""

    __slots__ = ("_config", "_config_path", "_last_listen_port", "_runner", "_switch_lock")

    def __init__(self, config: LlamaModelsConfig, config_path: Path) -> None:
        self._config = config
        self._config_path = config_path.resolve()
        self._runner = LlamaServerProcessRunner(config.shutdown_timeout_seconds)
        self._switch_lock = threading.Lock()
        self._last_listen_port: int | None = None

    @classmethod
    def from_yaml_path(cls, path: Path | str) -> LlamaCppProcessBackend:
        p = Path(path).expanduser().resolve()
        cfg = LlamaModelsConfig.load_yaml_path(p)
        return cls(cfg, p)

    @property
    def models_config(self) -> LlamaModelsConfig:
        """YAML model definitions (host, ports, GGUF paths)."""
        return self._config

    def supported_models(self) -> frozenset[str]:
        return frozenset(self._config.models.keys())

    def updates_runtime_loaded_flag_after_switch(self) -> bool:
        return True

    def switch_to_model(self, model_id: str) -> None:
        log = LOG
        with self._switch_lock:
            entry = self._config.models.get(model_id)
            if entry is None:
                raise ModelRuntimeError(
                    f"model id {model_id!r} not present in {self._config_path}",
                    errors=[f"missing config entry for {model_id!r}"],
                )

            gguf = self._config.resolve_gguf_path(self._config_path, entry)
            if not gguf.is_file():
                raise ModelRuntimeError(
                    f"GGUF path does not exist or is not a file: {gguf}",
                    errors=[str(gguf)],
                )

            # 1) stop existing process
            self._runner.stop_tracked_process(log)

            # 2) verify prior listener released
            if self._last_listen_port is not None:
                wait_until_port_closed(
                    self._config.host,
                    self._last_listen_port,
                    total_timeout=self._config.shutdown_timeout_seconds,
                    interval=self._config.health_poll_interval_seconds,
                    log=log,
                )
                self._last_listen_port = None

            if tcp_connect_ok(self._config.host, entry.port, timeout=0.25):
                raise ModelRuntimeError(
                    f"refusing to start: {self._config.host}:{entry.port} already accepts connections",
                    errors=["port_in_use"],
                )

            cmd = _build_llama_command(self._config, entry, gguf)

            stdio_log: Path | None = None
            raw_log_dir = os.environ.get("WORKFLOW_AGENT_LLAMA_SERVER_LOG_DIR", "").strip()
            if raw_log_dir:
                stdio_log = Path(raw_log_dir).expanduser().resolve() / f"llama-server-{model_id}.log"
                log.info("llama-server: child stdout/stderr -> %s", stdio_log)

            try:
                # 3) start
                self._runner.spawn(cmd, log, stdio_log_path=stdio_log)
                self._runner.poll_exit_early(log, grace_seconds=0.75)

                # 4) wait for bind + health
                wait_until_port_open(
                    self._config.host,
                    entry.port,
                    total_timeout=self._config.startup_timeout_seconds,
                    interval=self._config.health_poll_interval_seconds,
                    log=log,
                )
                _wait_until_health_ok(
                    self._config.host,
                    entry.port,
                    self._config.health_path,
                    self._config.healthcheck_timeout_seconds,
                    self._config.health_ready_timeout_seconds,
                    self._config.health_poll_interval_seconds,
                    log,
                )
                self._last_listen_port = entry.port
            except ModelRuntimeError:
                log.error("llama-server: activation failed for %s; tearing down process", model_id)
                self._runner.stop_tracked_process(log)
                self._last_listen_port = None
                raise

            log.info("llama-server: model %s is active on port %s", model_id, entry.port)
