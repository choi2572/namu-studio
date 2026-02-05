"""
Mock middleware server: REST (workflow run, runner status, workflow info) + WebSocket (monitor).
Run: python -m mock_middleware.app (from backend dir) or flask --app mock_middleware.app run -p 8000
"""
import json
import logging
import threading
import time
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Set

from flask import Flask, request, jsonify
from flask_cors import CORS

from .runner import get_execution_order, get_branch_order

logger = logging.getLogger(__name__)

# In-memory runner state (single workflow at a time)
_state = {
    "runner_status": "idle",
    "workflow_id": None,
    "workflow_dsl": None,
    "node_history": [],
    "current_node": None,
    "started_at": None,
    "updated_at": None,
    "cancelled": False,
    "lock": threading.Lock(),
}
_ws_clients: Set[Any] = set()
_ws_clients_lock = threading.Lock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _broadcast(data: Dict[str, Any]) -> None:
    msg = json.dumps(data)
    with _ws_clients_lock:
        dead = []
        for ws in _ws_clients:
            try:
                ws.send(msg)
            except Exception as e:
                logger.debug("WS send failed: %s", e)
                dead.append(ws)
        for ws in dead:
            _ws_clients.discard(ws)


def _build_initial_message() -> Dict[str, Any]:
    with _state["lock"]:
        nh = deepcopy(_state["node_history"])
        wf_id = _state["workflow_id"]
        started = _state["started_at"]
        updated = _state["updated_at"]
        current = _state["current_node"]
        status = _state["runner_status"]
    total = len(nh) + (1 if current and not any(n.get("node_name") == current for n in nh) else 0)
    completed = sum(1 for n in nh if (n.get("status") or "").upper() == "SUCCESS")
    running = 1 if current else 0
    elapsed = 0
    if started:
        try:
            end_ts = updated or _now_iso()
            a = datetime.fromisoformat(started.replace("Z", "+00:00"))
            b = datetime.fromisoformat(end_ts.replace("Z", "+00:00"))
            elapsed = int((b - a).total_seconds() * 1000)
        except Exception:
            pass
    return {
        "type": "initial",
        "runner_status": status,
        "workflow": {
            "workflow_id": wf_id,
            "started_at": started,
            "current_node": {
                "name": current,
                "status": "RUNNING",
                "started_at": updated or started,
            } if current else None,
        },
        "node_history": nh,
        "execution_stats": {
            "total_nodes": max(total, 1),
            "completed_nodes": completed,
            "running_nodes": running,
            "failed_nodes": 0,
            "elapsed_time_ms": elapsed,
        },
    }


def _run_one_node(
    workflow_id: str,
    state_name: str,
    state_def: Dict[str, Any],
    total_duration_ms_ref: list,
) -> None:
    """한 노드 실행: RUNNING 브로드캐스트 → 2초 대기 → SUCCESS 브로드캐스트."""
    with _state["lock"]:
        if _state["cancelled"]:
            return
        _state["current_node"] = state_name
        _state["updated_at"] = _now_iso()
    started_at = _now_iso()
    _broadcast({
        "type": "node_status_change",
        "workflow_id": workflow_id,
        "timestamp": started_at,
        "node_name": state_name,
        "prev_status": "IDLE",
        "input": state_def.get("Parameters") or state_def.get("If") or {},
    })
    with _state["lock"]:
        _state["node_history"].append({
            "node_name": state_name,
            "status": "RUNNING",
            "started_at": started_at,
            "completed_at": None,
            "duration_ms": None,
            "input": state_def.get("Parameters") or {},
            "output": None,
        })
        _state["updated_at"] = started_at

    time.sleep(2)
    with _state["lock"]:
        if _state["cancelled"]:
            return
    completed_at = _now_iso()
    duration_ms = 2000
    total_duration_ms_ref[0] += duration_ms
    output = {"result": "ok", "state": state_name}
    _broadcast({
        "type": "node_status_change",
        "workflow_id": workflow_id,
        "timestamp": completed_at,
        "node_name": state_name,
        "prev_status": "RUNNING",
        "status": "SUCCESS",
        "output": output,
        "duration_ms": duration_ms,
    })
    with _state["lock"]:
        for n in _state["node_history"]:
            if n.get("node_name") == state_name:
                n["status"] = "SUCCESS"
                n["completed_at"] = completed_at
                n["duration_ms"] = duration_ms
                n["output"] = output
                break
        _state["current_node"] = None
        _state["updated_at"] = completed_at


def _run_workflow(workflow_id: str, dsl: Dict[str, Any]) -> None:
    """Background: simulate execution and broadcast events."""
    order = get_execution_order(dsl)
    if not order:
        with _state["lock"]:
            _state["runner_status"] = "idle"
            _state["workflow_id"] = None
            _state["workflow_dsl"] = None
            _state["node_history"] = []
            _state["current_node"] = None
            _state["updated_at"] = _now_iso()
        _broadcast({
            "type": "error",
            "workflow_id": workflow_id,
            "timestamp": _now_iso(),
            "message": "No states to execute",
            "error_code": "INVALID_DSL",
        })
        return

    # 워크플로 전체의 마지막 노드(End: true)만 여기서 break. 브랜치 내부 End는 break 안 함.
    workflow_terminal = next(
        (name for name, def_ in reversed(order) if def_.get("End")),
        None,
    )
    total_duration_ms = 0
    total_duration_ms_ref = [0]

    for state_name, state_def in order:
        with _state["lock"]:
            if _state["cancelled"]:
                break

        stype = (state_def.get("Type") or "").strip()
        if stype == "Parallel":
            # Parallel: 브랜치들을 스레드로 동시 실행, 둘 다 끝난 뒤 다음 노드로
            branches = state_def.get("Branches") or []
            with _state["lock"]:
                _state["current_node"] = state_name
                _state["updated_at"] = _now_iso()
            started_at = _now_iso()
            _broadcast({
                "type": "node_status_change",
                "workflow_id": workflow_id,
                "timestamp": started_at,
                "node_name": state_name,
                "prev_status": "IDLE",
                "input": state_def.get("Parameters") or state_def.get("If") or {},
            })
            with _state["lock"]:
                _state["node_history"].append({
                    "node_name": state_name,
                    "status": "RUNNING",
                    "started_at": started_at,
                    "completed_at": None,
                    "duration_ms": None,
                    "input": state_def.get("Parameters") or {},
                    "output": None,
                })
                _state["updated_at"] = started_at

            def run_branch(branch: Dict[str, Any]) -> None:
                for name, def_ in get_branch_order(branch):
                    _run_one_node(workflow_id, name, def_, total_duration_ms_ref)

            threads = [threading.Thread(target=run_branch, args=(b,)) for b in branches]
            for t in threads:
                t.start()
            for t in threads:
                t.join()

            with _state["lock"]:
                if _state["cancelled"]:
                    break
            completed_at = _now_iso()
            total_duration_ms_ref[0] += 2000
            _broadcast({
                "type": "node_status_change",
                "workflow_id": workflow_id,
                "timestamp": completed_at,
                "node_name": state_name,
                "prev_status": "RUNNING",
                "status": "SUCCESS",
                "output": {"result": "ok", "state": state_name, "branches": len(branches)},
                "duration_ms": 2000,
            })
            with _state["lock"]:
                for n in _state["node_history"]:
                    if n.get("node_name") == state_name:
                        n["status"] = "SUCCESS"
                        n["completed_at"] = completed_at
                        n["duration_ms"] = 2000
                        n["output"] = {"result": "ok", "state": state_name}
                        break
                _state["current_node"] = None
                _state["updated_at"] = completed_at
            continue

        _run_one_node(workflow_id, state_name, state_def, total_duration_ms_ref)

        if state_def.get("End") and state_name == workflow_terminal:
            break

    with _state["lock"]:
        _state["runner_status"] = "idle"
        _state["workflow_id"] = None
        _state["workflow_dsl"] = None
        _state["current_node"] = None
        _state["updated_at"] = _now_iso()

    _broadcast({
        "type": "workflow_completed",
        "workflow_id": workflow_id,
        "timestamp": _now_iso(),
        "status": "succeeded",
        "final_stats": {
            "total_duration_ms": total_duration_ms_ref[0],
            "total_nodes": len(order),
            "successful_nodes": len(order),
            "failed_nodes": 0,
        },
    })


def create_app() -> Flask:
    app = Flask(__name__)
    CORS(app)

    @app.route("/api/v1/runner/status", methods=["GET"])
    def runner_status():
        with _state["lock"]:
            status = _state["runner_status"]
            if status == "idle":
                return jsonify({"runner_status": "idle"})
            wf_id = _state["workflow_id"]
            current = _state["current_node"]
            started = _state["started_at"]
            updated = _state["updated_at"]
            nh = _state["node_history"]
        completed = [n["node_name"] for n in nh if (n.get("status") or "").upper() == "SUCCESS"]
        all_names = list({n.get("node_name") for n in nh if n.get("node_name")} | ({current} if current else set()))
        pending = [x for x in all_names if x != current and x not in completed]
        return jsonify({
            "runner_status": status,
            "workflow": {
                "workflow_id": wf_id,
                "current_node": current,
                "progress": {
                    "completed_states": completed,
                    "current_state": current or "",
                    "pending_states": pending,
                },
                "started_at": started,
                "updated_at": updated,
            },
        })

    @app.route("/api/v1/workflows/run", methods=["POST"])
    def workflow_run():
        data = request.get_json() or {}
        req_type = (data.get("request_type") or "").strip().lower()
        if req_type == "cancel":
            with _state["lock"]:
                _state["cancelled"] = True
            return jsonify({
                "workflow_id": _state.get("workflow_id") or "wf_0",
                "status": "cancelled",
            })
        if req_type != "start":
            return jsonify({"error": "validation error", "message": "request_type must be start or cancel"}), 400
        workflow_json = data.get("workflow_json")
        if not workflow_json or not isinstance(workflow_json, dict):
            return jsonify({"error": "validation error", "message": "workflow_json required"}), 400
        if not workflow_json.get("States"):
            return jsonify({"error": "validation error", "message": "Invalid workflow JSON", "details": {"reason": "No States"}}), 400

        with _state["lock"]:
            if _state["runner_status"] == "running":
                return jsonify({"error": "Runner busy", "message": "Another workflow is running"}), 409
            workflow_id = f"wf_{int(time.time() * 1000)}"
            _state["runner_status"] = "running"
            _state["workflow_id"] = workflow_id
            _state["workflow_dsl"] = deepcopy(workflow_json)
            _state["node_history"] = []
            _state["current_node"] = None
            _state["cancelled"] = False
            _state["started_at"] = _now_iso()
            _state["updated_at"] = _state["started_at"]

        t = threading.Thread(target=_run_workflow, args=(workflow_id, deepcopy(workflow_json)), daemon=True)
        t.start()
        return jsonify({"workflow_id": workflow_id, "status": "running"})

    @app.route("/api/v1/workflows/<workflow_id>", methods=["GET"])
    def workflow_info(workflow_id: str):
        with _state["lock"]:
            if _state["workflow_id"] != workflow_id:
                return jsonify({"error": "Not found", "message": f"Workflow {workflow_id} not found"}), 404
            status = _state["runner_status"]
            started = _state["started_at"]
            updated = _state["updated_at"]
            current = _state["current_node"]
            nh = deepcopy(_state["node_history"])
        total = len(nh) + (1 if current and not any(n.get("node_name") == current for n in nh) else 0)
        completed = sum(1 for n in nh if (n.get("status") or "").upper() == "SUCCESS")
        running = 1 if current else 0
        elapsed = 0
        if started and updated:
            try:
                a = datetime.fromisoformat(started.replace("Z", "+00:00"))
                b = datetime.fromisoformat(updated.replace("Z", "+00:00"))
                elapsed = int((b - a).total_seconds() * 1000)
            except Exception:
                pass
        return jsonify({
            "workflow_id": workflow_id,
            "status": "running" if status == "running" else "succeeded",
            "started_at": started,
            "updated_at": updated,
            "current_node": current,
            "progress": {
                "completed_states": [n["node_name"] for n in nh if (n.get("status") or "").upper() == "SUCCESS"],
                "current_state": current or "",
                "pending_states": [n["node_name"] for n in nh if (n.get("status") or "").upper() != "SUCCESS"] + ([current] if current else []),
            },
            "node_history": nh,
            "execution_stats": {
                "total_nodes": max(total, 1),
                "completed_nodes": completed,
                "running_nodes": running,
                "failed_nodes": 0,
                "elapsed_time_ms": elapsed,
            },
        })

    try:
        from flask_sock import Sock
        sock = Sock(app)

        @sock.route("/api/v1/workflows/monitor")
        def monitor_ws(ws):
            with _ws_clients_lock:
                _ws_clients.add(ws)
            try:
                ws.send(json.dumps(_build_initial_message()))
                while True:
                    raw = ws.receive()
                    if raw is None:
                        break
                    try:
                        data = json.loads(raw)
                        if (data.get("type") or "").strip().lower() == "ping":
                            ws.send(json.dumps({"type": "pong"}))
                    except json.JSONDecodeError:
                        pass
            except Exception as e:
                logger.debug("WS client closed: %s", e)
            finally:
                with _ws_clients_lock:
                    _ws_clients.discard(ws)
    except ImportError:
        logger.warning("flask_sock not installed; WebSocket monitor disabled. pip install flask-sock")

    return app


app = create_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=True, use_reloader=False)
