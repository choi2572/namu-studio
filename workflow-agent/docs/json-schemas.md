# JSON 스키마 및 예시

이 문서는 Workflow Agent가 **주고받는 세 가지 JSON 계층**을 정리합니다.

1. **Skill set** — `POST /workflow-agent/skills/sync` 요청 본문  
2. **중간 워크플로우 스펙** — LLM이 생성하고 서버가 검증하는 **pre-DSL** JSON (`WorkflowSpec`)  
3. **최종 DSL** — 컴파일·2단계 검증을 통과한 **Namu 에디터 내보내기 형식** JSON (`draft` 응답의 `dsl`; 정본 예시는 [dsl-example.json](dsl-example.json))

구현 상의 단일 출처는 각각 `api/schemas/skills.py`, `spec/models.py`, `dsl/compiler.py` + `dsl/dsl_validation.py` 입니다. **스킬 페이로드의 논리적 모양**은 미들웨어 `GET /api/v1/skill-sets` 응답의 각 항목(`backend/mock_middleware/app.py`의 `MOCK_SKILL_SET`)과 맞춥니다. 다만 에이전트·런타임에 불필요한 필드(`allow_status_external_change`, 빈 `feedback` / `pre_conditions` / `post_effects` 등)는 동기화 본문에 굳이 실지 않아도 됩니다.

⸻

## 1. Skill set (`POST /workflow-agent/skills/sync`)

### 1.1 미들웨어와의 대응

| 개념 | 미들웨어 `skill_sets[]` | Sync `skills[]` (이 스키마) |
|------|-------------------------|---------------------------|
| 루트 | `skill_sets` | `skills` |
| 파라미터 스펙 | `parameters` | sync 본문에서는 **`inputs`**(값은 미들웨어 `parameters`와 동일한 `SkillParameter` 맵). |
| 그 외 | `namespace`, `name`, `version`, `description`, `outputs` | sync에서는 **`name`·`description`** 필수, **`inputs`**는 구조화된 스킬을 위해 권장(미들웨어 `parameters`와 동일 맵). 메타·`outputs`는 선택이나 프롬프트·해시에 반영된다. |

실제 HTTP 검증(`validate_skill_payload`)은 strip 후 **비어 있지 않은 `name`·`description`** 과 **`name` 중복**을 거부합니다. 중첩 `SkillParameter` / `SkillOutput` 규칙은 Pydantic 파싱 단계에서 처리됩니다. DSL 중간 스펙의 `skill` 문자열은 이 목록의 **`name`**과 일치해야 합니다(mock의 `Pick`, `Place`, `ValidateFrame` 등).

### 1.2 JSON Schema (Draft 2020-12)

`description` 필드는 프롬프트에 그대로 쓰일 수 있도록 **모든 스킬·파라미터·출력**에 둡니다. `SkillParameter`는 mock의 `_mock_param()` / 인라인 dict와 동일한 형태입니다.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://workflow-agent.local/schemas/skill-sync-request.json",
  "title": "SkillSyncRequest",
  "type": "object",
  "additionalProperties": false,
  "required": ["skills"],
  "properties": {
    "skills": {
      "type": "array",
      "description": "미들웨어 skill catalog와 동일한 정보를 담은 배열(루트 키만 skills).",
      "items": { "$ref": "#/$defs/SkillCatalogEntry" }
    }
  },
  "$defs": {
    "SkillParameter": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type", "description"],
      "properties": {
        "type": {
          "type": "string",
          "minLength": 1,
          "description": "타입 힌트(string, int, double, bool, object 등). DSL 파라미터 값 생성 시 제약 참고."
        },
        "description": {
          "type": "string",
          "minLength": 1,
          "description": "LLM이 인자 의미·단위·주의사항을 파악하도록 하는 설명."
        },
        "range": {
          "type": "object",
          "additionalProperties": false,
          "description": "숫자형일 때 허용 구간(선택). mock과 동일하게 min/max 단독 또는 병용.",
          "properties": {
            "min": { "type": "number" },
            "max": { "type": "number" }
          }
        },
        "candidates": {
          "type": "array",
          "description": "열거 가능 값(선택).",
          "items": { "type": "string" }
        }
      }
    },
    "SkillOutput": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type", "description"],
      "properties": {
        "type": {
          "type": "string",
          "minLength": 1,
          "description": "출력 값 타입 힌트."
        },
        "description": {
          "type": "string",
          "minLength": 1,
          "description": "출력 의미; 다음 스텝 설계·검증 힌트용."
        }
      }
    },
    "SkillCatalogEntry": {
      "type": "object",
      "additionalProperties": false,
      "required": ["name", "description"],
      "properties": {
        "namespace": {
          "type": "string",
          "minLength": 1,
          "description": "스킬 그룹(mock: vision, qa, robot, default, …). 미들웨어 필드와 동일; 프롬프트 계층 표시용(구현 반영 전에는 무시될 수 있음)."
        },
        "name": {
          "type": "string",
          "minLength": 1,
          "description": "워크플로 노드에서 참조하는 스킬 id(DSL/Skill 노드의 Skill 필드와 동일)."
        },
        "version": {
          "type": "string",
          "description": "정의 버전(선택). mock은 관례적으로 0.0.1 형태."
        },
        "description": {
          "type": "string",
          "minLength": 1,
          "description": "스킬이 수행하는 작업(프롬프트 핵심 문장)."
        },
        "inputs": {
          "type": "object",
          "description": "파라미터 이름 → SkillParameter. 미들웨어 키 `parameters`와 동일한 맵. 생략 시 빈 객체로 간주.",
          "additionalProperties": { "$ref": "#/$defs/SkillParameter" }
        },
        "outputs": {
          "type": "object",
          "description": "출력 이름 → SkillOutput. 미들웨어와 동일; 구현 반영 전에는 동기화 본문에 있어도 무시될 수 있음.",
          "additionalProperties": { "$ref": "#/$defs/SkillOutput" }
        }
      }
    }
  }
}
```

> **구현:** `SkillDefinition`(`api/schemas/skills.py`)은 **`namespace`·`version`·`description`·`inputs`·`outputs`** 를 파싱한다. 요청에 **`parameters`** 만 있으면 내부적으로 `inputs`로 합치며, `inputs`와 둘 다 오면 **`inputs`가 우선**한다. 알 수 없는 최상위 키는 무시한다(`extra="ignore"`). 프롬프트 블록(`skill_context_builder`)에는 네임스페이스·버전·inputs·outputs가 포함된다.

### 1.3 예시 (mock `skill_sets[]`와 동일한 **값**; 요청 키는 `inputs`)

미들웨어 JSON에서는 같은 맵이 `parameters` 아래에 온다. **`POST /skills/sync` 호환**을 위해 여기서는 `inputs`로 적었다.

```json
{
  "skills": [
    {
      "name": "ValidateFrame",
      "description": "Validate frame quality",
      "inputs": {
        "threshold": {
          "type": "double",
          "description": "Quality threshold",
          "range": { "min": 0.0, "max": 1.0 }
        }
      }
    },
    {
      "name": "Pick",
      "description": "Pick skill for simulated VLM DAG",
      "inputs": {
        "target": {
          "type": "string",
          "description": "Pick target reference"
        }
      }
    },
    {
      "name": "PlaceObject",
      "description": "Place an object at a destination location",
      "inputs": {
        "target_object": {
          "type": "string",
          "description": "The object identifier to place"
        },
        "destination": {
          "type": "string",
          "description": "The destination location identifier"
        },
        "orientation": {
          "type": "string",
          "description": "The orientation of the object (north, south, east, west)",
          "candidates": ["north", "south", "east", "west"]
        }
      }
    }
  ]
}
```

미들웨어에서 **`namespace`·`version`·`outputs`** 를 그대로 실으면 레지스트리 정규화·프롬프트 문단에 포함된다.

### 1.4 미들웨어 ↔ 문서 스키마 ↔ 실제 sync

| 항목 | 미들웨어 `skill_sets[]` | §1.2 `SkillCatalogEntry` | `POST .../skills/sync` |
|------|-------------------------|--------------------------|---------------------------|
| 파라미터 맵 | `parameters` | `inputs` | `inputs` |
| 메타 | `namespace`, `version`, `outputs` | 동일(선택) | 선택(`outputs`·메타는 레지스트리·프롬프트에 반영) |

빈 배열 동기화는 허용되지만, 그 경우 `skills_ready`가 `false`가 되어 draft 생성 전에 다시 스킬을 채워 동기화해야 합니다.

⸻

## 2. 중간 워크플로우 스펙 (Pre-DSL, `WorkflowSpec`)

LLM 출력은 루트에 바로 `{ "start", "nodes" }` 가 오거나, `spec` / `workflow` 등 **래퍼 키 안**에 같은 형태가 올 수 있습니다(서버가 추출).

노드는 `"type"` 디스크리미너로 구분됩니다: `"skill"` | `"branch"` | `"end"`.

### 2.1 JSON Schema (논리적 모양)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://workflow-agent.local/schemas/workflow-spec.json",
  "title": "WorkflowSpec",
  "type": "object",
  "additionalProperties": false,
  "required": ["start", "nodes"],
  "properties": {
    "start": { "type": "string", "minLength": 1 },
    "nodes": {
      "type": "object",
      "minProperties": 1,
      "additionalProperties": { "$ref": "#/$defs/Node" }
    },
    "version": { "type": "string" }
  },
  "$defs": {
    "SkillRetryPolicy": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "max_attempts": { "type": "integer", "minimum": 1, "maximum": 3, "default": 1 },
        "on_failure": { "type": "string", "enum": ["fail", "goto"], "default": "fail" },
        "goto_node": { "type": "string" }
      },
      "allOf": [
        {
          "if": { "properties": { "on_failure": { "const": "goto" } } },
          "then": {
            "required": ["goto_node"],
            "properties": { "goto_node": { "type": "string", "minLength": 1 } }
          }
        }
      ]
    },
    "SkillNode": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type", "skill", "next"],
      "properties": {
        "type": { "const": "skill" },
        "skill": { "type": "string", "minLength": 1 },
        "inputs": { "type": "object", "additionalProperties": true },
        "next": { "type": "string", "minLength": 1 },
        "retry": { "$ref": "#/$defs/SkillRetryPolicy" }
      }
    },
    "BranchArm": {
      "type": "object",
      "additionalProperties": false,
      "required": ["next"],
      "properties": {
        "next": { "type": "string", "minLength": 1 },
        "label": { "type": "string" }
      }
    },
    "BranchNode": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type", "branches", "default_next"],
      "properties": {
        "type": { "const": "branch" },
        "branches": {
          "type": "array",
          "minItems": 1,
          "items": { "$ref": "#/$defs/BranchArm" }
        },
        "default_next": { "type": "string", "minLength": 1 }
      }
    },
    "EndNode": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type"],
      "properties": {
        "type": { "const": "end" }
      }
    },
    "Node": {
      "oneOf": [
        { "$ref": "#/$defs/SkillNode" },
        { "$ref": "#/$defs/BranchNode" },
        { "$ref": "#/$defs/EndNode" }
      ]
    }
  }
}
```

### 2.2 서버 측 추가 검증 (스키마만으로는 부족한 부분)

`spec/validation.py`에서 다음 등을 검사합니다.

- `start`가 `nodes` 키 중 하나인지  
- 모든 `next` / `default_next` / 분기 `next` / `retry.goto_node` 참조가 존재하는 노드 id인지  
- `skill` 문자열이 **동기화된 스킬 레지스트리**에 있는지  
- 그래프가 `start`에서 적어도 하나의 `end` 노드에 도달 가능한지  
- `end` 타입 노드가 최소 1개인지  

### 2.3 예시 (직선 플로 + 재시도)

```json
{
  "start": "pick",
  "version": "0.1",
  "nodes": {
    "pick": {
      "type": "skill",
      "skill": "pick_object",
      "inputs": { "object_id": "sku_001" },
      "next": "place",
      "retry": {
        "max_attempts": 3,
        "on_failure": "goto",
        "goto_node": "pick"
      }
    },
    "place": {
      "type": "skill",
      "skill": "place_in_box",
      "inputs": { "box_id": "box_A" },
      "next": "done"
    },
    "done": {
      "type": "end"
    }
  }
}
```

### 2.4 예시 (분기)

```json
{
  "start": "check",
  "nodes": {
    "check": {
      "type": "branch",
      "branches": [
        { "next": "pick_route", "label": "need_pick" },
        { "next": "skip_pick", "label": "already_holding" }
      ],
      "default_next": "abort"
    },
    "pick_route": {
      "type": "skill",
      "skill": "pick_object",
      "inputs": {},
      "next": "finish"
    },
    "skip_pick": {
      "type": "skill",
      "skill": "place_in_box",
      "inputs": {},
      "next": "finish"
    },
    "abort": {
      "type": "end"
    },
    "finish": {
      "type": "end"
    }
  }
}
```

⸻

## 3. 최종 DSL (에디터 / `dsl-example.json`)

전체 워크플로우 JSON의 **정본 예시**는 [dsl-example.json](dsl-example.json) 입니다(저장소 루트 `docs/dsl-example.json` 과 동일 본문). `workflow-agent`가 중간 스펙만 컴파일할 때는 같은 계약의 부분집합(`Comment`, `StartAt`, `States` 안의 `Skill` / `Condition` / `Succeed`)을 생성합니다.

### 3.1 루트 필드 (검증기 허용)

| 필드 | 필수 | 설명 |
|------|------|------|
| `Comment` | 아니오 | 설명 문자열 |
| `StartAt` | 예 | 최상위 `States`의 시작 상태 id |
| `Inputs` | 아니오 | 전역 입력 (`Type`: `"Pass"`, `Skill`, `Next`, `Parameters` — 예시 파일 참고) |
| `States` | 예 | 상태 id → 상태 객체 |
| `OnFailure` | 아니오 | `StartAt`, `States` |

레거시 `Version` / `SpecVersion` 은 사용하지 않습니다. 컴파일러는 `Comment`에 프로비넌스(`workflow-agent; workflow-dsl/editor-v1`)를 넣습니다.

### 3.2 최상위 `States`의 `Type`

| `Type` | 역할 |
|--------|------|
| `Skill` | `Skill`, `Parameters`; **`Next` 또는 `End`: true** 택일; 선택 `Label`, 선택 인라인 `Retry` |
| `Succeed` | 종료 |
| `Condition` | `If`: `{ Condition, Then }`, `Else` |
| `Repeat` | `RepeatCount`, `StartAt`, 중첩 `States`, `Next` |
| `Parallel` | `Branches[]`, `Next` |
| `Retry` | `MaxAttempts`, `StartAt`, `States`, 선택 `BeforeRetryAfterFailure`, `Next` |

`If.Condition` 은 편집기 비교식(`Variable`/`Operator`/`Value`) 또는 `{ Type: ArmIndex, Index }`, `{ Type: Label, Label }` 입니다. 중간 스펙의 `branch`를 컴파일할 때 라벨 없는 팔은 **ArmIndex** 로 내보냅니다.

모든 상태 id는 문서 전역에서 유일해야 하고, 전이 문자열은 등록된 id를 가리켜야 합니다. `Succeed` 는 `States` 또는 `OnFailure.States` 중 어딘가에 최소 한 개 필요합니다.

### 3.3 컴파일러 범위

중간 스펙의 `skill` / `branch` / `end` 만 번역합니다. `Repeat`, `Parallel`, 전역 `Inputs`, `OnFailure` 등은 [dsl-example.json](dsl-example.json) 에 맞춘 **에디터·타 파이프라인**이 채웁니다.

### 3.4 최소 컴파일 예시 (§2.3 직선 플로 대응)

```json
{
  "Comment": "workflow-agent; workflow-dsl/editor-v1; entry='pick'",
  "StartAt": "pick",
  "States": {
    "pick": {
      "Type": "Skill",
      "Skill": "pick_object",
      "Parameters": { "object_id": "sku_001" },
      "Next": "place",
      "Label": "pick",
      "Retry": {
        "MaxAttempts": 3,
        "OnFailure": "goto",
        "GotoState": "pick"
      }
    },
    "place": {
      "Type": "Skill",
      "Skill": "place_in_box",
      "Parameters": { "box_id": "box_A" },
      "Next": "done",
      "Label": "place"
    },
    "done": {
      "Type": "Succeed",
      "Label": "done"
    }
  }
}
```

전체 구조와 중첩 `States`는 [dsl-example.json](dsl-example.json)을 따릅니다. `States` 키 순서는 컴파일 시 **노드 id 정렬**로 안정화됩니다.

⸻

## 관련 문서

- [spec.md](spec.md) — API, 파이프라인, 검증 전략, 오류 코드
