# Frontend

Next.js 기반 프론트엔드 애플리케이션입니다.

## 설치

```bash
cd frontend
npm install
```

## 실행

### 1. 백엔드 서버 시작

먼저 백엔드 서버를 시작해야 합니다:

```bash
# 다른 터미널에서
cd backend
pip install -r requirements.txt
python run.py
```

백엔드 서버는 `http://localhost:5000`에서 실행됩니다.

### 2. 프론트엔드 서버 시작

```bash
cd frontend
npm run dev
```

애플리케이션은 `http://localhost:3000`에서 실행됩니다.

## 환경 변수 설정

프론트엔드는 환경 변수를 통해 API 연결을 제어합니다. `.env.local` 파일을 생성하여 설정하세요:

```env
# Mock API 사용 여부 (true: mock 사용, false 또는 미설정: 실제 HTTP API 사용)
NEXT_PUBLIC_USE_MOCK_API=false

# 백엔드 API Base URL (USE_MOCK_API=false일 때 사용)
NEXT_PUBLIC_API_BASE_URL=http://localhost:5000/api
```

### 환경 변수 설명

- `NEXT_PUBLIC_USE_MOCK_API`: 
  - `true`: Mock API 어댑터 사용 (백엔드 없이 개발 가능)
  - `false` 또는 미설정: 실제 HTTP API 어댑터 사용 (백엔드 필요)
  
- `NEXT_PUBLIC_API_BASE_URL`: 
  - 실제 HTTP API를 사용할 때의 백엔드 Base URL
  - 기본값: `http://localhost:5000/api`
  - Next.js에서 `NEXT_PUBLIC_` 접두사가 붙은 환경 변수만 클라이언트에서 접근 가능

## 프로젝트 구조

```
src/
  api/              # API 인터페이스 및 구현
    interfaces.ts   # API 인터페이스 정의
    factory.ts       # 환경 변수 기반 API 어댑터 팩토리
    http/           # 실제 HTTP API 어댑터
      httpApi.ts
    mock/           # Mock API 어댑터
      mockApi.ts
      data.ts
  components/       # 재사용 가능한 UI 컴포넌트
  domain/           # DTOs, enums, 순수 로직
  features/         # Dashboard, Editor, Monitor, History
  lib/              # 유틸리티 (포맷팅, ids, 헬퍼)
  tests/            # 도메인 + mock API 단위 테스트
```

## API 어댑터 동작 방식

프론트엔드는 환경 변수에 따라 자동으로 적절한 API 어댑터를 선택합니다:

1. **Mock API 모드** (`USE_MOCK_API=true`):
   - 백엔드 서버 없이 개발 가능
   - 로컬 스토리지 기반 데이터 저장
   - 빠른 프로토타이핑 및 UI 개발에 적합

2. **HTTP API 모드** (`USE_MOCK_API=false`):
   - 실제 Flask 백엔드와 통신
   - 모든 API 호출이 백엔드로 전송됨
   - 개발자 도구 콘솔에서 API 호출 로그 확인 가능

두 모드 모두 동일한 인터페이스를 제공하므로 UI 코드 변경 없이 전환 가능합니다.

## 개발 팁

### API 호출 로깅

개발 모드에서는 모든 API 호출이 콘솔에 로깅됩니다:
- `[API Factory]`: 사용 중인 어댑터 타입 및 Base URL
- `[API]`: 각 HTTP 요청의 메서드, URL, 데이터

### 백엔드 연결 확인

1. 백엔드 서버가 실행 중인지 확인
2. 브라우저 개발자 도구의 Network 탭에서 API 요청 확인
3. 콘솔에서 `[API Factory]` 로그 확인

## 테스트

```bash
npm run test
```
