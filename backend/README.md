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
      sqlite.py          # SQLite 구현
      registry.py        # 저장소 인스턴스 관리
    db/                  # 데이터베이스 모듈 (SQLite)
      __init__.py
      connection.py      # 연결 관리
      schema.py          # 스키마 및 마이그레이션
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

## 저장소 백엔드 설정

백엔드는 두 가지 저장소 백엔드를 지원합니다:

### In-Memory (기본값)
데이터는 메모리에만 저장되며 서버 재시작 시 사라집니다. 개발 및 테스트에 적합합니다.

```bash
# 기본값 (명시적으로 설정하려면)
export REPO_BACKEND=inmemory
python run.py
```

### SQLite
데이터는 SQLite 데이터베이스 파일에 영구 저장됩니다.

```bash
# SQLite 사용
export REPO_BACKEND=sqlite
export DB_PATH=./data/app.db  # 선택사항 (기본값: ./data/app.db)
export SEED_DATA=1  # 개발용 시드 데이터 추가 (선택사항)
python run.py
```

**SQLite 설정:**
- `REPO_BACKEND=sqlite`: SQLite 백엔드 활성화
- `DB_PATH`: 데이터베이스 파일 경로 (기본값: `./data/app.db`)
- `SEED_DATA=1`: 개발 환경에서만 시드 데이터 추가 (DEV 전용)

**SQLite PRAGMA 설정:**
- `journal_mode=WAL`: Write-Ahead Logging 활성화
- `foreign_keys=ON`: 외래 키 제약 조건 활성화
- `synchronous=NORMAL`: 성능과 안정성 균형
- `busy_timeout=5000`: 동시 접근 대기 시간 (5초)

**데이터베이스 파일 위치:**
- 기본값: `./data/app.db` (프로젝트 루트의 `data` 디렉토리)
- 프로덕션 권장: `/var/lib/<app>/app.db` 또는 환경 변수로 지정

**마이그레이션:**
- 앱 시작 시 자동으로 스키마 버전을 확인하고 필요한 마이그레이션을 적용합니다.
- 간단한 버전 테이블(`schema_version`)을 사용하여 마이그레이션을 관리합니다.

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

**테스트 파라미터화:**
주요 테스트는 `inmemory`와 `sqlite` 백엔드 모두에서 실행됩니다. 각 테스트는 두 백엔드에서 자동으로 실행되어 동일한 동작을 보장합니다.

## 현재 구현 상태

### 완료
- ✅ In-memory 리포지토리
- ✅ SQLite 리포지토리 (Python stdlib sqlite3)
- ✅ 저장소 백엔드 선택 (REPO_BACKEND 환경 변수)
- ✅ 자동 스키마 마이그레이션
- ✅ Dummy ExecutionEngineAdapter (시뮬레이션)
- ✅ Workflow CRUD 및 버전 관리
- ✅ Run 실행 및 모니터링
- ✅ 이벤트 페이지네이션
- ✅ 검증 로직
- ✅ 하나의 활성 실행 제약 조건
- ✅ 시드 데이터 (DEV 전용, SEED_DATA=1)

### 미구현 (M1 범위 밖)
- ❌ 실제 미들웨어 연결

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
