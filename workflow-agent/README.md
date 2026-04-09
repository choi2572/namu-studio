# Workflow Agent

Namu Studio 등에서 자연어 요청으로 로봇 워크플로우 **중간 스펙(JSON)** 과 **DSL(JSON)** 을 생성하는 FastAPI 백엔드 서비스입니다. 상세 동작·검증·응답 형식은 [docs/spec.md](docs/spec.md)를 기준으로 합니다.

## 요구 사항

- Python **3.10+**
- (선택) 로컬 추론용 **`llama-server`**(llama.cpp) 바이너리와 GGUF 가중치

## 설치

저장소의 `workflow-agent` 디렉터리에서 가상환경을 만든 뒤 편집 가능 설치를 권장합니다.

```bash
cd workflow-agent
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e .
```

개발용 도구까지 쓰려면:

```bash
pip install -e ".[dev]"
```

## 설정

서버 기동 시 `python-dotenv` 규칙으로 **소스 트리를 위로 올라가며** 첫 번째 `.env`를 읽습니다(보통 `workflow-agent/.env` 또는 상위 모노레포 루트의 `.env`). 이미 셸에 설정된 변수는 덮어쓰지 않습니다. 비활성화하려면 `PYTHON_DOTENV_DISABLED=1`을 설정합니다.

### 환경 변수

| 변수 | 설명 |
|------|------|
| `WORKFLOW_AGENT_MODELS_CONFIG` | **선택.** 이 경로의 YAML 파일로 `llama-server` 프로세스 기동·전환을 제어합니다. **미설정 시** `NoopModelRuntimeBackend`가 사용되며, 프로세스는 띄우지 않고 `model_loaded`는 `false`로 유지됩니다. |
| `WORKFLOW_AGENT_LOG_FILE` | **선택.** 지정하면 FastAPI/에이전트 로그를 이 파일에도 기록합니다(콘솔은 그대로). 부모 디렉터리가 없으면 생성합니다. |
| `WORKFLOW_AGENT_LLAMA_SERVER_LOG_DIR` | **선택.** 디렉터리를 지정하면 `llama-server` 프로세스 stdout/stderr를 `llama-server-<모델 id>.log`로 받습니다. 미설정 시 기존처럼 파이프만 사용합니다. |

### 모델 YAML

`config/models.example.yaml`을 복사해 GGUF 경로·포트·실행 파일을 맞춘 뒤, `WORKFLOW_AGENT_MODELS_CONFIG`에 그 파일의 절대 또는 상대 경로를 지정합니다.

- `llama_server_executable`: `llama-server` (PATH) 또는 전체 경로
- `models`: 모델 id(예: `qwen`, `gemma`)마다 `gguf_path`, `port`, `extra_args`
- `gguf_path`는 YAML 파일 기준 상대 경로 가능

## 실행

기본 바인딩은 **`0.0.0.0:8000`** 입니다.

```bash
export WORKFLOW_AGENT_MODELS_CONFIG=/path/to/models.yaml   # 선택
workflow-agent
```

동일 앱을 Uvicorn으로 직접 띄울 수도 있습니다.

```bash
uvicorn workflow_agent.main:app --host 0.0.0.0 --port 8000
```

OpenAPI 문서: 서버 기동 후 **http://127.0.0.1:8000/docs**

로그: Uvicorn **접속 로그**는 stdout, 앱(`workflow_agent.*`) 로그는 stderr로 나가는 경우가 많습니다. 터미널에 아무것도 안 보이면 `2>&1`으로 합치거나, 요청을 한 번 보내 보세요 (`GET /workflow-agent/status` 등). 기동 직후 stderr에 `Workflow Agent ready` 한 줄이 찍힙니다.

## API 개요

모든 엔드포인트는 경로 prefix **`/workflow-agent`** 를 사용합니다.

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/workflow-agent/status` | 서비스 생존, 활성 모델 id, 모델 로드 여부, 스킬 동기화 준비 여부, 스킬 해시 |
| `POST` | `/workflow-agent/skills/sync` | 미들웨어 skill catalog와 맞춘 스킬 정의 검증 후 레지스트리·프롬프트 컨텍스트 갱신 (`namespace`·구조화된 `inputs`·`outputs` 등; [docs/json-schemas.md](docs/json-schemas.md) §1) |
| `POST` | `/workflow-agent/models/activate` | 요청한 모델 id로 로컬 `llama-server` 전환(YAML 백엔드일 때 프로세스 재기동) |
| `POST` | `/workflow-agent/draft` | 자연어 → LLM → 스펙 검증 → DSL 컴파일·검증까지 일괄 처리 |

### Draft 요청 본문 (요약)

```json
{
  "request": "자연어 워크플로우 설명",
  "model": "qwen",
  "system_prompt_suffix": "선택. 시스템 프롬프트 맨 끝(스킬 카탈로그 뒤)에 붙는 추가 지시."
}
```

- `model`은 **생략 가능**합니다. 넣을 경우 **반드시** `GET /workflow-agent/status`의 `active_model`과 같은 id여야 합니다. 다른 모델이면 먼저 `POST /workflow-agent/models/activate`로 전환합니다.
- `system_prompt_suffix`는 **생략 가능**합니다. 비어 있지 않으면 LLM `system` 메시지의 **마지막**에 trim 후 추가됩니다(제품별 규칙을 코드 없이 넣을 때 사용).

### Draft LLM 프롬프트 (개요)

- **System**: 중간 스펙 스키마 설명, 에디터 DSL 플로우 참고([docs/dsl-example.json](docs/dsl-example.json) 요약), 제약, `## Available skills` 아래 **읽기 쉬운 스킬 목록**(각 스킬 `description` / `required_inputs` / `outputs`; JSON 한 줄 덤프 아님), 그다음 `system_prompt_suffix`.
- **User**: `User request:` + 자연어 + 마무리 문장 `Generate the intermediate workflow JSON now.`
- 실제로 어떻게 이어지는지 **문장 예시**는 [docs/draft-prompt-example.md](docs/draft-prompt-example.md)를 참고하세요.

### 성공 / 실패 응답

- 성공 시 `metadata.request_id`는 **`draft-` + UUID** 형식입니다.
- 실패 시 `error_code`, `errors`, `guidance`, 선택적 `last_spec`이 포함됩니다. 오류 코드 목록은 [docs/spec.md §9](docs/spec.md)를 참고하세요.

## 권장 호출 순서

1. `WORKFLOW_AGENT_MODELS_CONFIG`를 설정했다면 **`POST /workflow-agent/models/activate`** 로 사용할 모델을 활성화합니다.
2. **`POST /workflow-agent/skills/sync`** 로 현재 로봇 스킬 목록을 보냅니다. 미들웨어 `GET /api/v1/skill-sets`의 `parameters` 맵은 본문에서 **`inputs`** 키로 보냅니다(객체 구조 동일).
3. **`GET /workflow-agent/status`** 에서 `alive && model_loaded && skills_ready` 인지 확인합니다(스펙 §12 UI 활성 조건).
4. **`POST /workflow-agent/draft`** 로 초안을 생성합니다.

## 개발

```bash
ruff format . && ruff check .
# 선택
pylint src/workflow_agent
```

## 문서

- [docs/spec.md](docs/spec.md) — 아키텍처, 파이프라인, 검증, 재시도, 응답·오류 계약
- [docs/json-schemas.md](docs/json-schemas.md) — 스킬·중간 스펙·최종 DSL 설명
- [docs/draft-prompt-example.md](docs/draft-prompt-example.md) — Draft 시 LLM에 전달되는 `system` / `user` 구성 예시
- [docs/dsl-example.json](docs/dsl-example.json) — 에디터 내보내기용 최종 DSL 정본 예시(전체 플로 제어)
