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
from typing import Any, Callable, Dict, List, Optional, Set

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


def _broadcast_feedback(
    workflow_id: str,
    node_name: str,
    feedback: Dict[str, Any],
    timestamp: Optional[str] = None,
) -> None:
    """Feedback 이벤트 브로드캐스트. 백엔드는 마지막 수신값만 node_run.feedback_json에 저장."""
    _broadcast({
        "type": "feedback",
        "workflow_id": workflow_id,
        "timestamp": timestamp or _now_iso(),
        "node_name": node_name,
        "feedback": feedback,
    })


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
        "status": "RUNNING",
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

    # 2Hz로 feedback 전송 (0.5초 간격). 백엔드는 마지막 수신값만 DB에 저장 → replay 시 마지막 스냅샷만 노출.
    feedback_interval_s = 0.5
    elapsed_s = 0.0
    step = 0
    while elapsed_s < 2.0:
        time.sleep(feedback_interval_s)
        elapsed_s += feedback_interval_s
        with _state["lock"]:
            if _state["cancelled"]:
                return
        step += 1
        _broadcast_feedback(workflow_id, state_name, {
            "message": "running",
            "step": step,
            "elapsed_ms": int(elapsed_s * 1000),
        })
    with _state["lock"]:
        if _state["cancelled"]:
            return
    completed_at = _now_iso()
    # 노드 끝날 때 마지막 feedback 한 번 더 전송 → DB에 최종 스냅샷 저장
    _broadcast_feedback(workflow_id, state_name, {
        "message": "completed",
        "step": "final",
        "elapsed_ms": 2000,
    }, timestamp=completed_at)
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

    cancelled = False
    for state_name, state_def in order:
        with _state["lock"]:
            if _state["cancelled"]:
                cancelled = True
                break

        stype = (state_def.get("Type") or "").strip()
        branches_raw = state_def.get("Branches")
        is_parallel = (stype or "").lower() == "parallel" or (isinstance(branches_raw, list) and len(branches_raw or []) > 0)
        if is_parallel:
            # Expected: parallel_node_name NODE_STARTED → 브랜치들 동시 실행 → 둘 다 끝나면 parallel_node_name NODE_SUCCEEDED(duration) → Next
            branches = list(branches_raw) if isinstance(branches_raw, list) else []
            parallel_start = _now_iso()
            with _state["lock"]:
                if _state["cancelled"]:
                    cancelled = True
                    break
                _state["current_node"] = state_name
                _state["updated_at"] = parallel_start
            _broadcast({
                "type": "node_status_change",
                "workflow_id": workflow_id,
                "timestamp": parallel_start,
                "node_name": state_name,
                "prev_status": "IDLE",
                "status": "RUNNING",
                "input": {},
            })
            with _state["lock"]:
                _state["node_history"].append({
                    "node_name": state_name,
                    "status": "RUNNING",
                    "started_at": parallel_start,
                    "completed_at": None,
                    "duration_ms": None,
                    "input": {},
                    "output": None,
                })
                _state["updated_at"] = parallel_start

            def run_branch(branch: Dict[str, Any]) -> None:
                for name, def_ in get_branch_order(deepcopy(branch)):
                    with _state["lock"]:
                        if _state["cancelled"]:
                            return
                    _run_one_node(workflow_id, name, def_, total_duration_ms_ref)

            stop_feedback = threading.Event()

            def feedback_loop() -> None:
                step = 0
                while not stop_feedback.wait(0.5):
                    with _state["lock"]:
                        if _state["cancelled"]:
                            return
                    step += 1
                    _broadcast_feedback(workflow_id, state_name, {
                        "message": "parallel_running",
                        "step": step,
                        "branches": len(branches),
                    })

            feedback_thread = threading.Thread(target=feedback_loop, daemon=True)
            feedback_thread.start()

            threads = [threading.Thread(target=run_branch, args=(deepcopy(b),)) for b in branches]
            for t in threads:
                t.start()
            for t in threads:
                t.join()

            stop_feedback.set()
            feedback_thread.join(timeout=1.0)

            with _state["lock"]:
                if _state["cancelled"]:
                    cancelled = True
                    break
            parallel_end = _now_iso()
            _broadcast_feedback(workflow_id, state_name, {
                "message": "completed",
                "step": "final",
                "branches": len(branches),
            }, timestamp=parallel_end)
            try:
                a = datetime.fromisoformat(parallel_start.replace("Z", "+00:00"))
                b = datetime.fromisoformat(parallel_end.replace("Z", "+00:00"))
                duration_ms = int((b - a).total_seconds() * 1000)
            except Exception:
                duration_ms = 2000 * max(len(branches), 1)
            output = {"result": "ok", "branches": len(branches)}
            _broadcast({
                "type": "node_status_change",
                "workflow_id": workflow_id,
                "timestamp": parallel_end,
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
                        n["completed_at"] = parallel_end
                        n["duration_ms"] = duration_ms
                        n["output"] = output
                        break
                _state["current_node"] = None
                _state["updated_at"] = parallel_end
            total_duration_ms_ref[0] += duration_ms
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

    if cancelled:
        _broadcast({
            "type": "workflow_cancelled",
            "workflow_id": workflow_id,
            "timestamp": _now_iso(),
            "status": "cancelled",
        })
    else:
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


# Mock skill-sets for GET /api/vi1/skill-sets (name, version, description, namespace + parameters, outputs, etc.)
MOCK_SKILL_SETS = {
    "skillsets": [
        {
            "namespace": "default",
            "name": "PickObject",
            "version": "0.0.1",
            "description": "Pick an object from a target location",
            "parameters": {
                "target_object": {"type": "string", "description": "The target object identifier to pick"},
                "location": {"type": "string", "description": "The location where the object is located"},
            },
            "outputs": {
                "object_weight": {"type": "int", "description": "The weight of the picked object in grams"},
            },
            "feedback": [],
            "pre_conditions": ["Object must be visible", "Gripper must be ready"],
            "post_effects": ["Object is held by gripper", "Location is now empty"],
        },
        {
            "namespace": "default",
            "name": "PlaceObject",
            "version": "0.0.1",
            "description": "Place an object at a destination location",
            "parameters": {
                "target_object": {"type": "string", "description": "The object identifier to place"},
                "destination": {"type": "string", "description": "The destination location identifier"},
                "orientation": {"type": "string", "description": "The orientation of the object (north, south, east, west)"},
            },
            "outputs": {
                "placement_success": {"type": "bool", "description": "Whether the placement was successful"},
            },
            "feedback": [],
            "pre_conditions": ["Object must be held by gripper", "Destination must be available"],
            "post_effects": ["Object is placed at destination", "Gripper is now empty"],
        },
        {
            "namespace": "default",
            "name": "MoveObject",
            "version": "0.0.1",
            "description": "Move an object from one location to another",
            "parameters": {
                "target_object": {"type": "string", "description": "The object identifier to move"},
                "source_location": {"type": "string", "description": "The source location identifier"},
                "target_location": {"type": "string", "description": "The target location identifier"},
            },
            "outputs": {
                "move_distance": {"type": "float", "description": "The distance moved in meters"},
                "move_duration": {"type": "int", "description": "The time taken to move in milliseconds"},
            },
            "feedback": [],
            "pre_conditions": ["Object must exist at source location", "Target location must be available"],
            "post_effects": ["Object is now at target location", "Source location is now empty"],
        },
    ]
}


def create_app() -> Flask:
    app = Flask(__name__)
    CORS(app)

    @app.route("/api/vi1/skill-sets", methods=["GET"])
    def skill_sets():
        return jsonify(MOCK_SKILL_SETS)

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
