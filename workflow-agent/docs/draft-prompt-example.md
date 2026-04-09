# Draft 생성 시 LLM 프롬프트 구성 (최종 예시)

`POST /workflow-agent/draft` 호출 시 로컬 LLM(llama OpenAI 호환 채팅 API)에는 **두 개의 메시지**가 전달됩니다.

| 역할 | 출처 |
|------|------|
| `system` | `build_draft_system_prompt()` — 스키마·플로우 설명·제약·**스킬 카탈로그**·선택적 접미사 |
| `user` | `build_draft_user_prompt()` — 자연어 요청 + 고정 마무리 문장 |

스킬 목록은 마지막 `POST /workflow-agent/skills/sync`로 캐시된 레지스트리를 `build_prompt_skill_context()`로 렌더링한 문자열입니다. 형식은 **한 스킬당 YAML 스타일 블록**이며, JSON 한 줄 덤프는 쓰지 않습니다.

---

## 1. 스킬 한 개가 시스템 프롬프트에 들어가는 모양

`DetectObjects` (mock 미들웨어 catalog와 동일한 정보를 sync했다고 가정):

```text
- DetectObjects [analysis]
  description: Run object detection
  version: 0.0.1
  required_inputs:
    - model (string): Detector model id
  outputs:
    - detections (object): Detection list
```

`range` / `candidates`가 있으면 같은 줄 끝에 대괄호로 붙습니다. 예: `ValidateFrame`의 임계값.

```text
    - threshold (double): Quality threshold [range 0.0..1.0]
```

`candidates` 예 (`NotifyOps`의 severity):

```text
    - severity (string): Severity [allowed: info, warn, error, critical]
```

여러 스킬은 **빈 줄 하나**로 구분됩니다.

---

## 2. 시스템 프롬프트 전체 구조 (요약)

실제 `system` 문자열은 다음 블록을 **위에서 아래 순서로 이어 붙인 것**입니다.

1. 역할 한 줄 (`You convert robot workflow requests…`)
2. 중간 워크플로 스펙 JSON 설명 (`_SCHEMA_PLACEHOLDER` — `start` / `nodes` / `skill`·`branch`·`end` 등)
3. 에디터 DSL 플로우 참고 (`_FLOW_CONTROL_EDITOR_REFERENCE`)
4. 제약 (`_CONSTRAINTS_PLACEHOLDER`)
5. 수리 라운드인 경우에만 수리 안내 (`_REPAIR_INSTRUCTION`)
6. 제목 줄 `## Available skills`
7. **스킬 블록 전체** (`build_prompt_skill_context` 결과; 상단에 `Available skills:` 중복 헤더는 없음)
8. **선택:** `DraftRequest.system_prompt_suffix`가 비어 있지 않으면 **맨 끝에** 그 내용을 추가 (앞뒤 trim 후, 선행 개행 후 붙음)

접미사는 API 본문으로 넘깁니다. 예:

```json
{
  "request": "…",
  "system_prompt_suffix": "Always prefer skill names with namespace when ambivalent.\nNever invent parameters not listed under required_inputs."
}
```

---

## 3. 사용자 메시지 (`user`) 최종 형태

요청:

> 모델아이디가 1번인 물체 찾은다음에 집어서 테이블로 옮겨주고 알려주는 workflow draft 작성해줘

실제 `user` 콘텐츠:

```text
User request:
모델아이디가 1번인 물체 찾은다음에 집어서 테이블로 옮겨주고 알려주는 workflow draft 작성해줘

Generate the intermediate workflow JSON now.
```

---

## 4. 축약 예: `system`의 꼬리 부분만 (스킬 2개 + 접미사)

전체 시스템 프롬프트는 수천~수만 자가 될 수 있어, 여기서는 **## Available skills 이하**만 예시로 둡니다.

```text
## Available skills
- DetectObjects [analysis]
  description: Run object detection
  version: 0.0.1
  required_inputs:
    - model (string): Detector model id
  outputs:
    - detections (object): Detection list

- PickObject [default]
  description: Pick an object from a target location
  version: 0.0.1
  required_inputs:
    - location (string): The location where the object is located
    - target_object (string): The target object identifier to pick
  outputs:
    - object_weight (int): The weight of the picked object in grams

[제품/배포별 커스텀 — DraftRequest.system_prompt_suffix]
예: 사용자가 말한 «알려준다»는 NotifyOps 등 알림 스킬로 연결하고, 모델 ID는 DetectObjects.inputs.model에 반영할 것.
```

(대괄호 안은 **예시** 접미사 문구이며, 실제 값은 클라이언트가 `system_prompt_suffix`로 전달합니다.)

---

## 5. HTTP 페이로드와의 관계

`LlamaChatCompletionClient.complete()`는 다음과 같이 보냅니다.

```json
{
  "model": "local",
  "messages": [
    { "role": "system", "content": "<위에서 조립한 system 전체>" },
    { "role": "user", "content": "<위 user 블록>" }
  ],
  "response_format": { "type": "json_object" },
  "temperature": 0.2,
  "stream": false
}
```

구현 참고: `workflow_agent/services/draft_service.py`, `draft_prompt.py`, `skill_context_builder.py`, `api/schemas/draft.py`.
