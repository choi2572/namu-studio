# Backend API

Flask 백엔드 API 서버입니다.

## 구조

```
backend/
  app/
    __init__.py          # Flask app factory
    config.py            # 설정
    errors.py            # 에러 핸들러 (Problem+JSON)
    api/                 # API 엔드포인트 (blueprints)
      workflows.py       # Workflow APIs
      runs.py            # Run APIs
      capabilities.py    # Capabilities APIs
    domain/              # 도메인 모델
      models.py          # Dataclass 모델
    services/            # 비즈니스 로직
      workflow_service.py
      run_service.py
      validation.py
    repos/               # 리포지토리
      interfaces.py      # 인터페이스
      memory.py          # In-memory 구현
    adapters/            # 외부 시스템 어댑터
      execution_engine.py  # Dummy ExecutionEngineAdapter
  tests/                 # 테스트
  requirements.txt        # Python 의존성
  run.py                 # 실행 스크립트
```

## 설치

```bash
cd backend
pip install -r requirements.txt
```

## 실행

```bash
# 방법 1: run.py 사용
python run.py

# 방법 2: Flask CLI 사용
export FLASK_APP=app
flask run

# 방법 3: Python 모듈로 실행
python -m app
```

서버는 기본적으로 `http://localhost:5000`에서 실행됩니다.

## API 엔드포인트

모든 API는 `/api` prefix를 사용합니다.

### Workflows
- `GET /api/workflows` - 워크플로우 목록
- `POST /api/workflows` - 워크플로우 생성
- `GET /api/workflows/<workflow_id>` - 워크플로우 조회
- `PATCH /api/workflows/<workflow_id>` - 워크플로우 메타데이터 업데이트
- `GET /api/workflows/<workflow_id>/draft` - 드래프트 조회
- `PUT /api/workflows/<workflow_id>/draft` - 드래프트 저장
- `POST /api/workflows/<workflow_id>/validate` - 드래프트 검증
- `POST /api/workflows/<workflow_id>/publish` - 워크플로우 발행

### Runs
- `GET /api/runs` - 실행 목록 (필터 지원)
- `POST /api/runs` - 실행 시작
- `GET /api/runs/<run_id>` - 실행 조회
- `POST /api/runs/<run_id>/cancel` - 실행 취소
- `GET /api/runs/<run_id>/snapshot` - 실행 스냅샷
- `GET /api/runs/<run_id>/nodes/<state_name>/debug` - 노드 디버그 정보
- `GET /api/runs/<run_id>/events` - 실행 이벤트 (afterSeq 파라미터 지원)
- `POST /api/runs/<run_id>/resume` - 대기 중인 노드 재개

### Capabilities
- `GET /api/capabilities/skills` - 사용 가능한 스킬 목록
- `GET /api/capabilities/health` - 런타임 헬스 체크

## 테스트

```bash
pytest
```

또는 coverage와 함께:

```bash
pytest --cov=app --cov-report=html
```

## 현재 구현 상태

### 완료
- ✅ In-memory 리포지토리
- ✅ Dummy ExecutionEngineAdapter (시뮬레이션)
- ✅ Workflow CRUD 및 버전 관리
- ✅ Run 실행 및 모니터링
- ✅ 이벤트 페이지네이션
- ✅ 검증 로직
- ✅ 하나의 활성 실행 제약 조건

### 미구현 (M1 범위 밖)
- ❌ 실제 SQLite 데이터베이스
- ❌ 실제 미들웨어 연결
- ❌ JSON 파일 기반 영속성 (옵션으로 추가 가능)

## CORS

개발 환경에서 프론트엔드(`http://localhost:3000`)와의 통신을 위해 CORS가 활성화되어 있습니다.

## 에러 처리

모든 에러는 Problem+JSON 형식으로 반환됩니다:

```json
{
  "type": "https://tools.ietf.org/html/rfc7231#section-6.5.1",
  "title": "Bad Request",
  "status": 400,
  "detail": "Error message"
}
```
