"""Backfill node_runs.duration_ms and NODE_SUCCEEDED event payloads for existing history.

임시 스크립트 용도:
- 과거에 실행된 run 들에 대해, duration_ms 가 비어 있는 노드 실행 기록을 채운다.
- 기준:
  - 같은 run_id, state_name 에 대해
    - NODE_STARTED 의 timestamp = started_at
    - NODE_SUCCEEDED 의 timestamp = finished_at
    - duration_ms = finished_at - started_at (ms 단위)
"""

from __future__ import annotations

from datetime import datetime
from typing import Dict, Tuple

from app.db.connection import get_db


def _parse_ts(ts: str) -> datetime:
  """ISO 문자열을 datetime 으로 파싱 (run_events.timestamp 형식 가정)."""
  # backend/app/repos/sqlite._iso_to_datetime 와 동일한 규칙 사용
  return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def backfill_node_run_durations() -> None:
  conn = get_db()
  conn.row_factory = conn.row_factory  # just to be explicit

  cur = conn.cursor()

  # 1) duration_ms 가 NULL 이고 finished_at 이 있는 node_runs 만 대상
  cur.execute(
      """
      SELECT node_run_id, run_id, state_name, started_at, finished_at
      FROM node_runs
      WHERE duration_ms IS NULL
        AND started_at IS NOT NULL
        AND finished_at IS NOT NULL
      """
  )
  rows = cur.fetchall()

  if not rows:
    print("No node_runs need backfill.")
    return

  print(f"Backfilling {len(rows)} node_runs ...")

  # 미리 run_events 를 메모리로 올리기 위해 run_id 집합 수집
  run_ids = sorted({row["run_id"] for row in rows})

  # run_id, state_name -> (started_ts, finished_ts) from events
  event_times: Dict[Tuple[str, str], Tuple[datetime | None, datetime | None]] = {}

  # 2) 각 run 에 대해 NODE_STARTED / NODE_SUCCEEDED 이벤트 타임스탬프 조회
  for run_id in run_ids:
    cur.execute(
        """
        SELECT event_type, state_name, timestamp
        FROM run_events
        WHERE run_id = ?
          AND state_name IS NOT NULL
          AND event_type IN ('NODE_STARTED', 'NODE_SUCCEEDED')
        ORDER BY seq ASC
        """,
        (run_id,),
    )
    for ev in cur.fetchall():
      state_name = ev["state_name"]
      key = (run_id, state_name)
      ts = _parse_ts(ev["timestamp"])
      started, finished = event_times.get(key, (None, None))
      if ev["event_type"] == "NODE_STARTED":
        # 첫 NODE_STARTED 만 사용
        if started is None:
          started = ts
      elif ev["event_type"] == "NODE_SUCCEEDED":
        # 마지막 NODE_SUCCEEDED 를 사용 (여러 번 있을 수 있다고 가정)
        finished = ts
      event_times[key] = (started, finished)

  updated = 0

  # 3) node_runs.duration_ms 계산 + 업데이트
  for row in rows:
    node_run_id = row["node_run_id"]
    run_id = row["run_id"]
    state_name = row["state_name"]

    key = (run_id, state_name)
    started_ev, finished_ev = event_times.get(key, (None, None))

    # 이벤트 타임스탬프가 둘 다 있는 경우 우선 사용, 아니면 node_runs.started_at/finished_at으로 계산
    if started_ev and finished_ev:
      duration_ms = int((finished_ev - started_ev).total_seconds() * 1000)
    else:
      started_at = _parse_ts(row["started_at"])
      finished_at = _parse_ts(row["finished_at"])
      duration_ms = int((finished_at - started_at).total_seconds() * 1000)

    if duration_ms < 0:
      # 이상치 방지: 음수면 0 으로 클램프
      duration_ms = 0

    cur.execute(
        "UPDATE node_runs SET duration_ms = ? WHERE node_run_id = ?",
        (duration_ms, node_run_id),
    )
    updated += 1

  # 4) NODE_SUCCEEDED 이벤트 payload_json.duration_ms 도 같이 채우기 (있으면)
  cur.execute(
      """
      SELECT event_id, run_id, state_name, timestamp, payload_json
      FROM run_events
      WHERE event_type = 'NODE_SUCCEEDED'
      """
  )
  ev_rows = cur.fetchall()

  import json

  ev_updated = 0
  for ev in ev_rows:
    run_id = ev["run_id"]
    state_name = ev["state_name"]
    if not state_name:
      continue
    key = (run_id, state_name)

    # 방금 계산한 duration_ms 사용 (없으면 스킵)
    cur.execute(
        "SELECT duration_ms FROM node_runs WHERE run_id = ? AND state_name = ? ORDER BY attempt DESC LIMIT 1",
        (run_id, state_name),
    )
    nr = cur.fetchone()
    if not nr or nr["duration_ms"] is None:
      continue
    duration_ms = nr["duration_ms"]

    raw = ev["payload_json"]
    try:
      payload = json.loads(raw) if raw is not None else {}
    except json.JSONDecodeError:
      payload = {}

    if payload.get("duration_ms") == duration_ms:
      continue

    payload["duration_ms"] = duration_ms
    cur.execute(
        "UPDATE run_events SET payload_json = ? WHERE event_id = ?",
        (json.dumps(payload), ev["event_id"]),
    )
    ev_updated += 1

  conn.commit()
  print(f"Updated node_runs.duration_ms = {updated}, NODE_SUCCEEDED payload.duration_ms = {ev_updated}")


if __name__ == "__main__":
  backfill_node_run_durations()

