"""Middleware REST + WebSocket client (workflow execution & monitor).
See docs/middleware_api_spec.md.
"""
import json
import logging
import threading
import uuid
from datetime import datetime
from typing import Any, Callable, Dict, Optional
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

from app.domain.models import NodeRun, NodeStatus, Run, RunEvent, RunStatus

logger = logging.getLogger(__name__)


def _parse_ts(ts: Any) -> Optional[datetime]:
    """Parse timestamp (ISO string or number) to datetime."""
    if ts is None:
        return None
    if isinstance(ts, (int, float)):
        try:
            return datetime.utcfromtimestamp(ts / 1000.0 if ts > 1e12 else ts)
        except (ValueError, OSError):
            return None
    if isinstance(ts, str):
        try:
            return datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            return None
    return None


def _middleware_node_status_to_internal(status: str) -> str:
    """Map middleware node status to our NodeStatus value."""
    s = (status or "").upper()
    if s == "SUCCESS":
        return NodeStatus.SUCCEEDED.value
    if s in ("RUNNING", "WAITING", "FAILED", "SKIPPED", "CANCELED"):
        return s
    if s == "IDLE":
        return NodeStatus.READY.value
    return NodeStatus.READY.value


class MiddlewareClient:
    """REST client for middleware workflow APIs."""

    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")
        self._timeout = 30

    def _url(self, path: str) -> str:
        p = path if path.startswith("/") else f"/{path}"
        return f"{self.base_url}{p}"

    def _request(
        self,
        method: str,
        path: str,
        body: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        url = self._url(path)
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
        req = Request(
            url,
            data=data,
            method=method,
            headers={"Content-Type": "application/json"} if data else {},
        )
        try:
            with urlopen(req, timeout=self._timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except HTTPError as e:
            body = e.read().decode("utf-8") if e.fp else ""
            try:
                err = json.loads(body)
                raise RuntimeError(err.get("message", err.get("error", body)))
            except json.JSONDecodeError:
                raise RuntimeError(body or str(e))
        except URLError as e:
            raise RuntimeError(f"Middleware unreachable: {e.reason}")

    def get_runner_status(self) -> Dict[str, Any]:
        """GET /api/v1/runner/status"""
        return self._request("GET", "/api/v1/runner/status")

    def start_workflow(self, workflow_json: Dict[str, Any]) -> Dict[str, Any]:
        """POST /api/v1/workflows/run with request_type start."""
        return self._request(
            "POST",
            "/api/v1/workflows/run",
            {"request_type": "start", "workflow_json": workflow_json},
        )

    def cancel_workflow(self) -> Dict[str, Any]:
        """POST /api/v1/workflows/run with request_type cancel."""
        return self._request(
            "POST",
            "/api/v1/workflows/run",
            {"request_type": "cancel"},
        )

    def workflows_run(self, body: Dict[str, Any]) -> Dict[str, Any]:
        """POST /api/v1/workflows/run — forward request body (start/cancel)."""
        return self._request("POST", "/api/v1/workflows/run", body=body)

    def get_workflow_info(self, workflow_id: str) -> Dict[str, Any]:
        """GET /api/v1/workflows/{workflow_id} (workflow information)."""
        return self._request(
            "GET",
            f"/api/v1/workflows/{workflow_id}",
        )

    def get_skill_set(self) -> Dict[str, Any]:
        """GET /api/v1/skill-set from middleware (skillsets list)."""
        return self._request("GET", "/api/v1/skill-set")


def _apply_initial_to_db(
    run_id: str,
    payload: Dict[str, Any],
    run_repo,
    node_run_repo,
    run_event_repo,
) -> None:
    """Persist middleware 'initial' message to run_events and node_runs; update run."""
    run = run_repo.get(run_id)
    if not run:
        return

    workflow = payload.get("workflow") or {}
    node_history = payload.get("node_history") or []
    runner_status = (payload.get("runner_status") or "").lower()

    # Update run timing
    started_at_str = workflow.get("started_at")
    if started_at_str:
        run.started_at = _parse_ts(started_at_str) or run.started_at
    if runner_status == "running":
        run.status = RunStatus.RUNNING
    run_repo.update(run)

    seq = run_event_repo.get_max_seq(run_id) or 0

    # Ensure RUN_CREATED / RUN_STARTED if no events yet
    if seq == 0:
        seq += 1
        run_event_repo.create(
            RunEvent(
                event_id=str(uuid.uuid4()),
                run_id=run_id,
                seq=seq,
                timestamp=run.started_at or datetime.utcnow(),
                event_type="RUN_CREATED",
                state_name=None,
                payload_json={"source": "middleware_initial"},
            )
        )
        seq += 1
        run_event_repo.create(
            RunEvent(
                event_id=str(uuid.uuid4()),
                run_id=run_id,
                seq=seq,
                timestamp=run.started_at or datetime.utcnow(),
                event_type="RUN_STARTED",
                state_name=None,
                payload_json={"source": "middleware_initial"},
            )
        )

    # 기존에 이미 NODE_STARTED가 있는 노드 집합 (node_status_change 중복 방지)
    existing_events = run_event_repo.get_by_run(run_id)
    already_has_started = {e.state_name for e in existing_events if e.event_type == "NODE_STARTED" and e.state_name}

    for item in node_history:
        node_name = item.get("node_name") or item.get("name")
        if not node_name:
            continue
        status_str = (item.get("status") or "RUNNING").upper()
        our_status = _middleware_node_status_to_internal(status_str)
        node_run_id = f"{run_id}-{node_name}"
        existing = node_run_repo.get_by_run_and_state(run_id, node_name)
        started_at = _parse_ts(item.get("started_at"))
        completed_at = _parse_ts(item.get("completed_at"))
        duration_ms = item.get("duration_ms")
        input_json = item.get("input")
        output_json = item.get("output")

        if existing:
            existing.status = NodeStatus(our_status)
            existing.started_at = started_at or existing.started_at
            existing.finished_at = completed_at
            existing.duration_ms = duration_ms
            if input_json is not None:
                existing.input_json = input_json
            if output_json is not None:
                existing.output_json = output_json
            node_run_repo.update(existing)
        else:
            node_run_repo.create(
                NodeRun(
                    node_run_id=node_run_id,
                    run_id=run_id,
                    state_name=node_name,
                    node_type="Skill",
                    status=NodeStatus(our_status),
                    started_at=started_at,
                    finished_at=completed_at,
                    duration_ms=duration_ms,
                    input_json=input_json,
                    output_json=output_json,
                )
            )

        # initial 수신 시 이미 완료된 노드는 타임라인에 NODE_STARTED/NODE_SUCCEEDED 보정 (WS 연결 지연으로 놓친 이벤트)
        if node_name not in already_has_started:
            seq = (run_event_repo.get_max_seq(run_id) or 0) + 1
            run_event_repo.create(
                RunEvent(
                    event_id=str(uuid.uuid4()),
                    run_id=run_id,
                    seq=seq,
                    timestamp=started_at or run.started_at or datetime.utcnow(),
                    event_type="NODE_STARTED",
                    state_name=node_name,
                    payload_json={"input": input_json},
                )
            )
            already_has_started.add(node_name)
            if status_str == "SUCCESS" and completed_at is not None:
                seq = (run_event_repo.get_max_seq(run_id) or 0) + 1
                run_event_repo.create(
                    RunEvent(
                        event_id=str(uuid.uuid4()),
                        run_id=run_id,
                        seq=seq,
                        timestamp=completed_at,
                        event_type="NODE_SUCCEEDED",
                        state_name=node_name,
                        payload_json={"output": output_json, "duration_ms": duration_ms},
                    )
                )


def _apply_node_status_change(
    run_id: str,
    payload: Dict[str, Any],
    run_repo,
    node_run_repo,
    run_event_repo,
) -> None:
    """Handle node_status_change: persist event and update node_run."""
    node_name = payload.get("node_name")
    if not node_name:
        return
    prev = (payload.get("prev_status") or "").upper()
    status = (payload.get("status") or "").upper()
    ts = _parse_ts(payload.get("timestamp")) or datetime.utcnow()
    seq = (run_event_repo.get_max_seq(run_id) or 0) + 1

    node_run_id = f"{run_id}-{node_name}"
    existing = node_run_repo.get_by_run_and_state(run_id, node_name)

    # 스펙: RUNNING 전환 시 "prev_status": "IDLE"만 오고 "status" 없을 수 있음 → NODE_STARTED 처리
    is_node_started = status == "RUNNING" or (prev == "IDLE" and status != "SUCCESS")
    if is_node_started:
        if not existing:
            node_run_repo.create(
                NodeRun(
                    node_run_id=node_run_id,
                    run_id=run_id,
                    state_name=node_name,
                    node_type="Skill",
                    status=NodeStatus.RUNNING,
                    started_at=ts,
                    input_json=payload.get("input"),
                )
            )
        else:
            existing.status = NodeStatus.RUNNING
            existing.started_at = ts
            existing.input_json = payload.get("input") or existing.input_json
            node_run_repo.update(existing)
        # initial 보정으로 이미 NODE_STARTED가 있으면 중복 생성 안 함
        existing_events = run_event_repo.get_by_run(run_id)
        has_started = any(e.state_name == node_name and e.event_type == "NODE_STARTED" for e in existing_events)
        if not has_started:
            run_event_repo.create(
                RunEvent(
                    event_id=str(uuid.uuid4()),
                    run_id=run_id,
                    seq=seq,
                    timestamp=ts,
                    event_type="NODE_STARTED",
                    state_name=node_name,
                    payload_json={"input": payload.get("input")},
                )
            )
    elif status == "SUCCESS":
        output = payload.get("output")
        duration_ms = payload.get("duration_ms")
        if existing:
            existing.status = NodeStatus.SUCCEEDED
            existing.finished_at = ts
            existing.output_json = output
            existing.duration_ms = duration_ms
            node_run_repo.update(existing)
        run_event_repo.create(
            RunEvent(
                event_id=str(uuid.uuid4()),
                run_id=run_id,
                seq=seq,
                timestamp=ts,
                event_type="NODE_SUCCEEDED",
                state_name=node_name,
                payload_json={"output": output, "duration_ms": duration_ms},
            )
        )


def _apply_workflow_completed(
    run_id: str,
    payload: Dict[str, Any],
    run_repo,
    run_event_repo,
) -> None:
    """Handle workflow_completed / workflow_cancelled: set run SUCCESS or CANCELED, emit event."""
    run = run_repo.get(run_id)
    if not run:
        return
    ts = _parse_ts(payload.get("timestamp")) or datetime.utcnow()
    status_str = (payload.get("status") or "succeeded").lower()
    if status_str in ("cancelled", "canceled"):
        run.status = RunStatus.CANCELED
        event_type = "RUN_CANCELED"
        payload_json = {"source": "workflow_cancelled"}
    else:
        run.status = RunStatus.SUCCESS
        event_type = "RUN_SUCCEEDED"
        payload_json = payload.get("final_stats") or {}
    run.finished_at = ts
    run_repo.update(run)
    seq = (run_event_repo.get_max_seq(run_id) or 0) + 1
    run_event_repo.create(
        RunEvent(
            event_id=str(uuid.uuid4()),
            run_id=run_id,
            seq=seq,
            timestamp=ts,
            event_type=event_type,
            state_name=None,
            payload_json=payload_json,
        )
    )


def _apply_error(
    run_id: str,
    payload: Dict[str, Any],
    run_repo,
    node_run_repo,
    run_event_repo,
) -> None:
    """Handle error: set run FAILED, optional node failure, emit RUN_FAILED."""
    run = run_repo.get(run_id)
    if not run:
        return
    ts = _parse_ts(payload.get("timestamp")) or datetime.utcnow()
    run.status = RunStatus.FAILED
    run.finished_at = ts
    run.failure_code = payload.get("error_code") or "EXECUTION_FAILED"
    run.failure_message = payload.get("message") or "Workflow error"
    run_repo.update(run)

    node_name = payload.get("node_name")
    if node_name:
        existing = node_run_repo.get_by_run_and_state(run_id, node_name)
        if existing:
            existing.status = NodeStatus.FAILED
            existing.finished_at = ts
            existing.feedback_json = payload.get("details") or {}
            node_run_repo.update(existing)

    seq = (run_event_repo.get_max_seq(run_id) or 0) + 1
    run_event_repo.create(
        RunEvent(
            event_id=str(uuid.uuid4()),
            run_id=run_id,
            seq=seq,
            timestamp=ts,
            event_type="RUN_FAILED",
            state_name=node_name,
            payload_json={
                "message": payload.get("message"),
                "error_code": payload.get("error_code"),
                "details": payload.get("details"),
            },
        )
    )


def _apply_feedback(
    run_id: str,
    payload: Dict[str, Any],
    node_run_repo,
) -> None:
    """Store feedback on node_run."""
    node_name = payload.get("node_name")
    if not node_name:
        return
    existing = node_run_repo.get_by_run_and_state(run_id, node_name)
    if existing:
        existing.feedback_json = payload.get("feedback") or {}
        node_run_repo.update(existing)


def _apply_graph_patch(
    run_id: str,
    data: Dict[str, Any],
    run_event_repo,
) -> None:
    """Persist graph_patch event for replay and monitor (VLM dynamic workflow)."""
    ts = _parse_ts(data.get("timestamp")) or datetime.utcnow()
    seq = (run_event_repo.get_max_seq(run_id) or 0) + 1
    # Store full message as payload so replay can apply patches in order
    payload = {
        "target": data.get("target"),
        "nodes_added": data.get("nodes_added") or [],
        "edges_added": data.get("edges_added") or [],
        "start_at": data.get("start_at"),
        "rev": data.get("rev"),
    }
    run_event_repo.create(
        RunEvent(
            event_id=str(uuid.uuid4()),
            run_id=run_id,
            seq=seq,
            timestamp=ts,
            event_type="GRAPH_PATCH",
            state_name=None,
            payload_json=payload,
        )
    )


def run_middleware_monitor_ws(
    base_url: str,
    run_id: str,
    run_repo,
    node_run_repo,
    run_event_repo,
    on_done: Optional[Callable[[], None]] = None,
) -> None:
    """
    Connect to WS /api/v1/workflows/monitor and persist all events to DB.
    Runs in the current thread (intended to be run in a daemon thread).
    base_url is the middleware base URL (e.g. http://localhost:8000).
    """
    try:
        import websocket
    except ImportError:
        logger.warning(
            "websocket-client not installed; run pip install websocket-client for middleware monitor"
        )
        if on_done:
            on_done()
        return

    ws_url = base_url.replace("http://", "ws://").replace("https://", "wss://")
    path = "/api/v1/workflows/monitor"
    if not path.startswith("/"):
        path = "/" + path
    url = f"{ws_url.rstrip('/')}{path}"

    def persist_initial(data: Dict[str, Any]) -> None:
        _apply_initial_to_db(
            run_id, data, run_repo, node_run_repo, run_event_repo
        )

    def persist_node_change(data: Dict[str, Any]) -> None:
        _apply_node_status_change(
            run_id, data, run_repo, node_run_repo, run_event_repo
        )

    def persist_workflow_completed(data: Dict[str, Any]) -> None:
        _apply_workflow_completed(run_id, data, run_repo, run_event_repo)

    def persist_error(data: Dict[str, Any]) -> None:
        _apply_error(run_id, data, run_repo, node_run_repo, run_event_repo)

    def persist_feedback(data: Dict[str, Any]) -> None:
        _apply_feedback(run_id, data, node_run_repo)

    def persist_graph_patch(data: Dict[str, Any]) -> None:
        _apply_graph_patch(run_id, data, run_event_repo)

    closed = threading.Event()

    def on_message(ws, message: str) -> None:
        try:
            data = json.loads(message)
        except json.JSONDecodeError:
            logger.warning("Monitor WS run_id=%s: invalid JSON", run_id)
            return
        msg_type = (data.get("type") or "").strip().lower()
        logger.debug("Monitor WS run_id=%s type=%s", run_id, msg_type)
        try:
            if msg_type == "initial":
                persist_initial(data)
            elif msg_type == "node_status_change":
                persist_node_change(data)
            elif msg_type == "workflow_completed":
                persist_workflow_completed(data)
                closed.set()
            elif msg_type == "workflow_cancelled":
                persist_workflow_completed(data)
                closed.set()
            elif msg_type == "error":
                persist_error(data)
                closed.set()
            elif msg_type == "feedback":
                persist_feedback(data)
            elif msg_type == "graph_patch":
                persist_graph_patch(data)
            elif msg_type == "pong":
                pass
            else:
                logger.debug("Monitor WS run_id=%s: unhandled type=%s", run_id, msg_type)
        except Exception as e:
            logger.exception("Monitor WS run_id=%s persist type=%s failed: %s", run_id, msg_type, e)

    def on_close(ws, close_status_code, close_msg) -> None:
        closed.set()
        if on_done:
            on_done()

    def on_error(ws, error) -> None:
        logger.exception("Middleware WebSocket error: %s", error)
        closed.set()
        if on_done:
            on_done()

    try:
        ws = websocket.WebSocketApp(
            url,
            on_message=on_message,
            on_close=on_close,
            on_error=on_error,
        )
        ws.run_forever(ping_interval=25, ping_timeout=10)
    except Exception as e:
        logger.exception("Middleware monitor WS failed: %s", e)
    finally:
        # Fallback: if run still active, sync once via workflow information API (REST)
        run = run_repo.get(run_id)
        if run and run.status in (RunStatus.RUNNING, RunStatus.WAITING) and getattr(run, "middleware_workflow_id", None):
            try:
                client = MiddlewareClient(base_url)
                info = client.get_workflow_info(run.middleware_workflow_id)
                status = (info.get("status") or "").lower()
                if status in ("succeeded", "failed", "cancelled", "canceled"):
                    run.status = RunStatus.SUCCESS if status == "succeeded" else RunStatus.FAILED
                    run.finished_at = _parse_ts(info.get("updated_at")) or datetime.utcnow()
                    if status == "failed":
                        run.failure_code = "MIDDLEWARE_FAILED"
                        run.failure_message = info.get("message") or "Workflow failed"
                    run_repo.update(run)
                else:
                    _apply_initial_to_db(
                        run_id,
                        {
                            "type": "initial",
                            "runner_status": info.get("status", "running"),
                            "workflow": {
                                "workflow_id": info.get("workflow_id"),
                                "started_at": info.get("started_at"),
                                "current_node": info.get("current_node"),
                            },
                            "node_history": info.get("node_history", []),
                        },
                        run_repo,
                        node_run_repo,
                        run_event_repo,
                    )
            except Exception as sync_err:
                logger.warning("Workflow info sync after WS close failed: %s", sync_err)
        if on_done:
            on_done()
