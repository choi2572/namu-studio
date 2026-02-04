# workflow execution
## request
POST /api/v1/workflows/run

### run workflow

```json
{
“request_type”: “start”,
“workflow_json”: {
 // created dsl_json
  “Comment”: “~~~”,
   “StartAt”: “~~~~~”, 
   ~~
   }
   }
   ```
   ### cancel workflow
   ```json
   {
   “request_type”: “cancel”
   }
   ```

   ## response
   ```json
   // 200
   {
   “workflow_id”: “wf_1753xxxxxx”, // 형식은 wf_{timestamp}
   “status”: “running” // or cancelled
   }

   // 400 -> Bad request(invalid workflow json)
   {
   “error”: “validation error”,
   “message”: “Invalid workflow JSON”,
   “details”: {
   “state”: “node_name”,
   “reason”: “e.g. Invalid Skill name”
   }
   }
   // 422 -> Unprocessable Entity - conversion error
   // 500 -> Internal server error

   # Runner status
   ## request
   GET /api/v1/runner/status

   ## response
   ```json
   // 200, running
   {
   “runner_status”: “running”, // idle, running, error
   “workflow”:
   {
   “workflow_id”: “wf_xxxxxxxxxxxx”,
   “current_node”: “current_running_node_name”,
   “progress”:{
   “completed_states”: [“node_name1”],
   “current_state”: “node_name2”,
   “pending_states”: [“node_name3”, “node_name4”, “node_name5”]
   },
   “started_at”: “2026-01-23T12:34:56Z”,
   “updated_at”: “2026-01-23T12:35:06Z”,
   }
   }

   // 200, idle
   {
   “runner_status”: “idle”
   }

   // 200, error
   {
   “runner_status”: “error”,
   “error”: “error msgs”,
   “details”: {
   “error_code”: “RUNNER_ERROR”,
   “error_message”: “error msgs222”
   }
   }
   ```

   # workflow information
   ## request
   GET /api/v1/workflows/{workflow_id}

   ## response
   ```json
   // 200, only running workflow
   {
   “workflow_id”: “wf_xxxxxxxxxxxx”,
   “status”: ”running”,
   “started_at”: “xx”,
   “updated_at”: “yy”,
   “current_node”: “current_running_node_name”,
   “progress”:{
   “completed_states”: [“node_name1”],
   “current_state”: “node_name2”,
   “pending_states”: [“node_name3”, “node_name4”, “node_name5”]
   },
   “node_history”:[
   {
   “node_name”: “node_name1”,
   “status”: “SUCCESS”
   “started_at”: “xx”,
   “completed_at”: “yy”,
   “duration_ms”: 3000,
   “input”: {
   //input json
   },
   “output”: {
   //output json
   }
   },
   {
   “node_name”: “node_name2”,
   “status”: “RUNNING”,
   “started_at”: “zz”,
   “completed_at”: null,
   “duration_ms”: null,
   “input”: {
   //input json
   }
   }
   ],
   “execution_stats”: {
   “total_nodes”: 10,
   “completed_nodes”: 1,
   “running_nodes”: 1,
   “failed_nodes”: 0,
   “elapsed_time_ms”: 41242
   }
   }
   ```


   # workflow monitor
   ## endpoint(Websocket)
   WS /api/v1/workflows/monitor

   ws 연결-initial data 전송(현재상태)-실시간 이벤트 수신(노드상태 변화 시 자동 이벤트 전송)-연결유지(client ping -> middleware pong)-연결 종료(workflow 종료 - 완료/실패 시  자동 연결 종료, 클라이언트가 연결 종료 가능)

   initial data
   ```json
   {
   “type”: “initial”,
   “runner_status”: “running”,
   “workflow”:{
   “workflow_id”: “wf_xxxxxxxxxxxx”,
   “started_at”: “xx”,
   “current_node”: {
   “name”:“current_running_node_name”,
   “status”: “RUNNING”,
   “started_at”: “xxx”
   }
   }
   “node_history”:[
   {
   “node_name”: “node_name1”,
   “status”: “SUCCESS”
   “started_at”: “xx”,
   “completed_at”: “yy”,
   “duration_ms”: 3000,
   “input”: {
   //input json
   },
   “output”: {
   //output json
   }
   },
   {
   “node_name”: “node_name2”,
   “status”: “RUNNING”,
   “started_at”: “zz”,
   “completed_at”: null,
   “duration_ms”: null,
   “input”: {
   //input json
   }
   }
   ],
   “execution_stats”: {
   “total_nodes”: 10,
   “completed_nodes”: 1,
   “running_nodes”: 1,
   “failed_nodes”: 0,
   “elapsed_time_ms”: 41242
   }
   }

   ```

   노드 상태 변화 시 이벤트
   ```json
   // RUNNING으로 변경될때
   {
   “type”: “node_status_change”,
   “workflow_id”: “wf_xxxxxxxxx”,
   “timestamp”: xxxxxxxxxx,
   “node_name”: “node_name2”,
   “prev_status”: “IDLE”,
   “input”: {
   // input json
   }
   }

   // SUCCESS로 변경될때
   {
   “type”: “node_status_change”,
   “workflow_id”: “wf_xxxxxxxxx”,
   “timestamp”: yyyyyyyyyy,
   “node_name”: “node_name2”,
   “prev_status”: “RUNNING”,
   “status”: “SUCCESS”,
   “output”: {
   // output json
   }
   }

   // feedback event
   {
   “type”: “feedback”,
   “workflow_id”: “wf_xxxxxxxxx”,
   “timestamp”: yyyyyyyyyy,
   “node_name”: “node_name2”,
   “feedback”: {
   // feedback json
   }
   }

   // workflow completed event
   {
   “type”: “workflow_completed”,
   “workflow_id”: “wf_xxxxxxxxx”,
   “timestamp”: yyyyyyyyyy,
   “status”: “succeeded”,
   “final_stats”: {
   “total_duration_ms”: 12345,
   “total_nodes”: 10,
   “successful_nodes”: 10,
   “failed_nodes”: 0
   }
   }

   // error event
   {
   “type”: “error”,
   “workflow_id”: “wf_xxxxxxxxx”,
   “timestamp”: yyyyyyyyyy,
   “message”: “error msgxxxx”
   “node_name”: “node_name2”,
   “error_code”: “EXECUTION_FAILED”,
   “details”: {
   “timeout_seconds”: 50,
   “elapsed_time_ms”: 23456
   }
   }
   ```

   ping
   ```json
   {
   “type”: “ping”
   }
   ```

   pong
   ```json
   {
   “type”: “pong”
   }
   ```

   SkillSetInfo
   - 기존 mock api (skillsetsapi 와 동일)