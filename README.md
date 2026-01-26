# namu-studio

Robot Workflow Authoring & Monitoring Tool

## 프로젝트 구조

```
namu-studio/
  frontend/     # Next.js 프론트엔드 애플리케이션
  backend/      # Flask 백엔드 API 서버
  docs/         # 시스템 문서 (루트에 유지)
```

## 빠른 시작

### 프론트엔드 실행

```bash
cd frontend
npm install
npm run dev
```

프론트엔드는 `http://localhost:3000`에서 실행됩니다.

### 백엔드 실행

```bash
cd backend
pip install -r requirements.txt
python run.py
```

백엔드는 `http://localhost:5000`에서 실행됩니다.

## 문서

자세한 시스템 규칙과 API 명세는 `docs/` 폴더를 참조하세요:

- `docs/00-system_rules.md` - 시스템 규칙 및 제약사항
- `docs/10-backend_api.md` - 백엔드 API 명세
- `docs/20-data_model.md` - 데이터 모델
- `docs/30-middleware_contract.md` - 미들웨어 계약
- `docs/40-ui_notes.md` - UI 가이드라인

## 개발 상태

### 완료
- ✅ 프론트엔드/백엔드 폴더 분리
- ✅ Flask 백엔드 스캐폴딩
- ✅ In-memory 리포지토리
- ✅ Dummy ExecutionEngineAdapter
- ✅ REST API 엔드포인트
- ✅ 검증 로직 및 테스트

### 현재 상태
- 프론트엔드는 mock 데이터를 사용 중
- 백엔드는 실제 API를 제공하지만 아직 프론트엔드와 연결되지 않음

## 다음 단계

1. 프론트엔드에서 mock API를 실제 백엔드 API로 전환
2. 환경 변수 설정 (API base URL)
3. 실제 미들웨어 연결 (향후)
