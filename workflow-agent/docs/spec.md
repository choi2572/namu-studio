
Workflow Agent Spec (v0.1)

1. Overview

Workflow Agent는 자연어 입력을 기반으로 로봇 workflow DSL을 생성하는 LLM 기반 서비스이다.
로컬 LLM (llama.cpp)과 skill registry를 활용하여 구조화된 workflow를 생성한다.

⸻

2. System Architecture

Namu Studio (Frontend)
        ↓
Workflow Agent (Backend)
        ├── Model Manager
        ├── Prompt Builder
        ├── Validator
        ├── Compiler
        ↓
llama.cpp Server (Local LLM)
        ↓
Model (Qwen / Gemma)


⸻

3. Core Concepts

3.1 Model Strategy

Role	Model
Default	Qwen2.5
Optional	Gemma4

	•	한 번에 하나의 모델만 active
	•	모델 변경은 프로세스 재시작 기반

⸻

3.2 Skill Registry

Input (from Namu Studio)

[
  {
    "name": "pick_object",
    "description": "Pick up object",
    "inputs": {"object_id": "string"}
  }
]

Internal Structure
	•	raw_skill_registry (원본 저장)
	•	prompt_skill_context (LLM용 요약 문자열)

스킬 동기화·중간 스펙·최종 DSL에 대한 **JSON Schema 초안 및 예시**는 [json-schemas.md](json-schemas.md)를 참고한다.

⸻

3.3 Prompt Context

User Request
+ Skill Context
+ JSON Schema Description
+ Generation Rules
+ Constraints
+ Examples (optional)


⸻

4. API Design

4.1 Status

GET /workflow-agent/status

Response:

{
  "alive": true,
  "active_model": "qwen",
  "model_loaded": true,
  "skills_ready": true,
  "skills_hash": "abc123"
}


⸻

4.2 Skill Sync

POST /workflow-agent/skills/sync

	•	skill payload 수신
	•	validation 수행
	•	prompt context 생성 및 캐싱

⸻

4.3 Model Activate

POST /workflow-agent/models/activate

{
  "model": "qwen"
}

	•	기존 llama-server 종료
	•	새 모델로 재기동

⸻

4.4 Draft Generation

POST /workflow-agent/draft

{
  "request": "Pick object and place in box, retry twice if failed",
  "model": "qwen" // optional
}

	•	model 필드가 있으면 GET /workflow-agent/status 의 active_model 과 동일한 id 여야 한다. 생략 시 활성 모델을 사용한다.
	•	다른 모델로 생성하려면 먼저 POST /workflow-agent/models/activate 로 전환한다.


⸻

5. Processing Pipeline

1. Request 수신
2. Prompt 생성
3. LLM 호출
4. Spec JSON 생성
5. Spec Validation
6. Compile (Spec → DSL)
7. DSL Validation
8. Response 반환


⸻

6. Validation Strategy

6.1 Spec Validation
	•	schema validation
	•	required fields
	•	skill 존재 여부
	•	node type 검증
	•	branch 구조 검증

⸻

6.2 DSL Validation
	•	검증 대상은 Namu 에디터 내보내기 형식(``docs/dsl-example.json`` 정본)과 동일한 계약이다.
	•	루트: ``StartAt``, ``States`` 필수; ``Comment``, ``Inputs``, ``OnFailure`` 선택.
	•	상태 타입: ``Skill``, ``Succeed``, ``Condition``, ``Repeat``, ``Parallel``, ``Retry`` 등 — ``dsl_validation.py`` 참고.
	•	상태 id 전역 유일, 전이 대상 유효성, ``Skill`` 의 ``Next`` / ``End`` 규칙, 최소 하나의 ``Succeed``.

⸻

7. Retry & Repair
	•	최대 3회 시도
	•	1: initial generation
	•	2~3: repair (validation error 포함)

Repair Input:
	•	original request
	•	previous spec
	•	validation errors

⸻

8. Response Format

Success

{
  "success": true,
  "model": "qwen",
  "spec": {...},
  "dsl": {...},
  "warnings": [],
  "metadata": {
    "request_id": "draft-8f3c2e1a-…",
    "skills_hash": "abc123"
  }
}

	•	metadata.request_id 는 draft- 접두어 + UUID 문자열이다.


⸻

Failure

{
  "success": false,
  "error_code": "SPEC_VALIDATION_FAILED",
  "errors": [
    "Unknown skill: place_box"
  ],
  "guidance": {
    "basic": "요청한 동작이 skill과 매칭되지 않았습니다.",
    "suggestion": "예: move_to_box → release_object"
  },
  "last_spec": {...}
}


⸻

9. Error Codes
	•	MODEL_UNAVAILABLE
	•	SKILL_CONTEXT_NOT_READY
	•	LLM_TIMEOUT
	•	SPEC_PARSE_FAILED
	•	SPEC_VALIDATION_FAILED
	•	COMPILE_FAILED
	•	DSL_VALIDATION_FAILED
	•	INVALID_MODEL (알 수 없는 모델 id — 주로 ``POST /workflow-agent/models/activate``)
	•	DRAFT_MODEL_NOT_ACTIVE (``POST /draft`` 의 ``model`` 이 현재 ``active_model`` 과 불일치)
	•	INTERNAL_ERROR (서버 내부 비정상 종료; 로그 필요)

⸻

10. Model Management
	•	단일 active model 유지
	•	모델 전환 시:
	•	기존 프로세스 종료
	•	신규 프로세스 실행
	•	hot swap 미지원

⸻

11. Performance Notes
	•	주요 병목: output token generation
	•	JSON output은 일반 텍스트보다 느림
	•	draft 생성 목표 latency: 2~8초

⸻

12. UI Integration

Enable 조건

alive && model_loaded && skills_ready


⸻

User Flow

1. 자연어 입력
2. draft 생성 요청
3. 결과 import
4. editor 렌더링


⸻

13. Future Extensions
	•	/workflow-agent/replan API
	•	partial workflow patch generation
	•	skill filtering (context reduction)
	•	LLM-based guidance (optional)
	•	multi-model routing

⸻

14. Naming

Service Name: workflow-agent

⸻

15. Key Design Principles
	•	deterministic validation first
	•	LLM은 생성만 담당
	•	compile/validation은 서버 책임
	•	model과 logic 분리
	•	failure는 명확하게 설명

⸻

END

:::

⸻
