"""Execution engine adapter that uses middleware REST + WebSocket monitor."""
import logging
import threading
from datetime import datetime
from typing import Dict, Any, Optional

from app.domain.models import Run, RunStatus
from app.adapters.execution_engine import ExecutionEngineAdapter
from app.adapters.middleware_client import (
    MiddlewareClient,
    run_middleware_monitor_ws,
)

logger = logging.getLogger(__name__)


class MiddlewareExecutionEngineAdapter(ExecutionEngineAdapter):
    """
    Starts workflow on middleware via REST, then runs WebSocket monitor
    in a background thread and persists all events to DB (run_events, node_runs, run).
    """

    def __init__(
        self,
        middleware_base_url: str,
        run_repo,
        node_run_repo,
        run_event_repo,
        workflow_repo,
        workflow_version_repo,
    ):
        self.client = MiddlewareClient(middleware_base_url)
        self.run_repo = run_repo
        self.node_run_repo = node_run_repo
        self.run_event_repo = run_event_repo
        self.workflow_repo = workflow_repo
        self.workflow_version_repo = workflow_version_repo
        self._monitor_thread: Optional[threading.Thread] = None

    def start_execution(
        self,
        run_id: str,
        workflow_dsl: Dict[str, Any],
        run_input: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Start workflow on middleware and start monitor WebSocket (persist to DB)."""
        run = self.run_repo.get(run_id)
        if not run:
            logger.warning("Run %s not found, cannot start middleware execution", run_id)
            return

        try:
            resp = self.client.start_workflow(workflow_dsl)
        except Exception as e:
            logger.exception("Middleware start_workflow failed: %s", e)
            run.status = RunStatus.FAILED
            run.failure_code = "MIDDLEWARE_START_FAILED"
            run.failure_message = str(e)
            run.finished_at = datetime.utcnow()
            self.run_repo.update(run)
            return

        workflow_id = resp.get("workflow_id")
        status = (resp.get("status") or "").lower()
        if not workflow_id:
            run.status = RunStatus.FAILED
            run.failure_code = "MIDDLEWARE_NO_WORKFLOW_ID"
            run.failure_message = "Middleware did not return workflow_id"
            run.finished_at = datetime.utcnow()
            self.run_repo.update(run)
            return

        run.middleware_workflow_id = workflow_id
        run.status = RunStatus.RUNNING
        run.started_at = run.started_at or datetime.utcnow()
        self.run_repo.update(run)

        base_url = self.client.base_url
        run_repo = self.run_repo
        node_run_repo = self.node_run_repo
        run_event_repo = self.run_event_repo

        def run_monitor() -> None:
            run_middleware_monitor_ws(
                base_url,
                run_id,
                run_repo,
                node_run_repo,
                run_event_repo,
                on_done=None,
            )

        self._monitor_thread = threading.Thread(target=run_monitor, daemon=True)
        self._monitor_thread.start()
        logger.info(
            "Started middleware workflow %s for run %s, monitor thread running",
            workflow_id,
            run_id,
        )

    def cancel_execution(self, run_id: str) -> None:
        """Cancel via middleware REST (POST cancel)."""
        run = self.run_repo.get(run_id)
        if not run:
            return
        if run.status in (RunStatus.SUCCESS, RunStatus.FAILED, RunStatus.CANCELED):
            return

        try:
            self.client.cancel_workflow()
        except Exception as e:
            logger.warning("Middleware cancel_workflow failed: %s", e)

        run.status = RunStatus.CANCELED
        run.finished_at = datetime.utcnow()
        self.run_repo.update(run)

        import uuid
        from app.domain.models import RunEvent

        seq = (self.run_event_repo.get_max_seq(run_id) or 0) + 1
        self.run_event_repo.create(
            RunEvent(
                event_id=str(uuid.uuid4()),
                run_id=run_id,
                seq=seq,
                timestamp=datetime.utcnow(),
                event_type="RUN_CANCELED",
                state_name=None,
                payload_json={"source": "backend_cancel"},
            )
        )

    def resume_wait(
        self,
        run_id: str,
        state_name: str,
        payload: Dict[str, Any],
    ) -> None:
        """Resume is not implemented for middleware adapter (middleware may support later)."""
        logger.warning("resume_wait not implemented for middleware adapter")
        pass

    def reconcile_stale_run(self, run: Run) -> bool:
        """
        Reconcile a potentially stale run when starting a new one.

        If the middleware runner is idle but this run is still RUNNING/WAITING in the DB,
        try to fetch workflow information from middleware first and mark the run terminal
        (SUCCESS/FAILED/CANCELED) based on that. As a fallback, mark it CANCELED.
        """
        try:
            resp = self.client.get_runner_status()
            runner_status = (resp.get("runner_status") or "").lower()
            if runner_status != "idle":
                return False
        except Exception as e:
            logger.warning("Reconcile: get_runner_status failed: %s", e)
            return False

        run_id = run.run_id
        run = self.run_repo.get(run_id)
        if not run or run.status not in (RunStatus.RUNNING, RunStatus.WAITING):
            return False

        workflow_id = getattr(run, "middleware_workflow_id", None)

        # 1) 우선 미들웨어 workflow info로 실제 최종 상태를 확인해 본다.
        if workflow_id:
            try:
                info = self.client.get_workflow_info(workflow_id)
                status = (info.get("status") or "").lower()
                if status in ("succeeded", "failed", "cancelled", "canceled"):
                    if status == "succeeded":
                        run.status = RunStatus.SUCCESS
                    elif status in ("failed", "failure", "error"):
                        run.status = RunStatus.FAILED
                        run.failure_code = run.failure_code or "MIDDLEWARE_FAILED"
                        run.failure_message = run.failure_message or info.get("message") or "Workflow failed"
                    else:
                        run.status = RunStatus.CANCELED
                    run.finished_at = datetime.utcnow()
                    self.run_repo.update(run)

                    import uuid
                    from app.domain.models import RunEvent

                    seq = (self.run_event_repo.get_max_seq(run_id) or 0) + 1
                    self.run_event_repo.create(
                        RunEvent(
                            event_id=str(uuid.uuid4()),
                            run_id=run_id,
                            seq=seq,
                            timestamp=datetime.utcnow(),
                            event_type="RUN_CANCELED" if run.status == RunStatus.CANCELED else "RUN_COMPLETED",
                            state_name=None,
                            payload_json={"source": "reconcile_stale_run", "middleware_status": status},
                        )
                    )
                    logger.info(
                        "Reconciled stale run %s via workflow_info (status=%s, marked %s)",
                        run_id,
                        status,
                        run.status.name,
                    )
                    return True
            except Exception as e:
                logger.warning("Reconcile: get_workflow_info(%s) failed: %s", workflow_id, e)

        # 2) workflow info에서도 터미널이 아니거나 정보를 얻지 못한 경우, 보수적으로 CANCELED 처리.
        run.status = RunStatus.CANCELED
        run.finished_at = datetime.utcnow()
        self.run_repo.update(run)

        import uuid
        from app.domain.models import RunEvent

        seq = (self.run_event_repo.get_max_seq(run_id) or 0) + 1
        self.run_event_repo.create(
            RunEvent(
                event_id=str(uuid.uuid4()),
                run_id=run_id,
                seq=seq,
                timestamp=datetime.utcnow(),
                event_type="RUN_CANCELED",
                state_name=None,
                payload_json={"source": "reconcile_stale_run", "middleware_status": "unknown"},
            )
        )
        logger.info("Reconciled stale run %s (middleware idle, marked CANCELED)", run_id)
        return True
