# Spec-Driven E2E Testing Strategy

_Playwright + Gherkin + YAML for regression-safe refactoring and feature development_

## Purpose

This document defines a **global E2E testing strategy** for the product, not only for the editor.

It is intended to be used in two situations:

1. **Before large refactors**  
   to freeze current user-visible behavior and prevent regressions

2. **As the default testing approach for new features**  
   so future work follows the same spec-driven pattern instead of ad hoc test writing

The current immediate use case is the large editor refactor, but this document should remain valid for:

- editor
- dashboard
- monitor
- run history
- workflow execution / monitoring
- future pages and features

The goal is to preserve **observable behavior**, not internal implementation.

---

## Core principles

### 1. Test behavior, not structure

We care about:

- what the user can do
- what the user can see
- what state transitions happen
- what gets saved / rendered / updated

We do **not** care about:

- component boundaries
- file layout
- internal hook names
- local state shape
- CSS class names unless they are part of a visual contract

### 2. One testing system for the whole product

We should not invent a different testing style for each page.

Use one consistent system across the app:

- **Playwright** for execution
- **Gherkin** for readable scenarios
- **YAML** for machine-friendly structured specs
- **Generated Playwright tests** for maintainable implementation

### 3. Refactor-safe, feature-friendly

This system should be useful both:

- when freezing current behavior before refactoring
- and when defining acceptance behavior for new features

That means the same spec structure should work for:

- regression coverage
- new feature development
- bug reproduction / prevention
- release confidence

### 4. Spec first, then tests

When possible, define:

1. feature intent in Gherkin
2. structured actions/assertions in YAML
3. generate Playwright tests from that spec

This keeps tests readable, reviewable, and scalable.

---

## High-level architecture

We use a 3-layer model:

### Layer 1: Gherkin

Human-readable feature scenarios

Use this for:

- acceptance criteria
- feature discussion
- behavior review
- preserving intent during refactors

### Layer 2: YAML spec

Structured scenario data

Use this for:

- route
- fixtures
- actions
- assertions
- mocks / contracts
- page-specific setup

### Layer 3: Playwright

Executable browser tests

Use this for:

- actual browser interaction
- network/mock integration
- DOM assertions
- visual behavior verification where needed

---

## Recommended repository structure

```text
tests/
  e2e/
    features/
      editor/
      dashboard/
      monitor/
      run-history/
      workflow/
      shared/

    specs/
      editor/
      dashboard/
      monitor/
      run-history/
      workflow/
      shared/

    generated/
      editor/
      dashboard/
      monitor/
      run-history/
      workflow/

    support/
      page-objects/
        app-shell.page.ts
        editor.page.ts
        dashboard.page.ts
        monitor.page.ts
        run-history.page.ts

      selectors/
        app-shell.selectors.ts
        editor.selectors.ts
        dashboard.selectors.ts
        monitor.selectors.ts
        run-history.selectors.ts

      helpers/
        canvas.helper.ts
        dragdrop.helper.ts
        websocket.helper.ts
        api.helper.ts
        assertions.helper.ts

      fixtures/
      generator/
      yaml/
      gherkin/

  playwright.config.ts
```

This structure is intentionally **product-wide**, not editor-only.

---

## Where this strategy applies

This testing approach should cover any user-facing flow, including:

### App shell / navigation

- sidebar tab navigation
- route changes
- page entry
- shared menus
- global loading/error states

### Dashboard

- workflow list rendering
- current run summaries
- runner status display
- navigation into workflow/run-related detail

### Editor

- workflow loading
- node editing
- save / publish
- retry
- failure handling flow
- graph interactions
- export-related behavior

### Monitor

- live monitor empty state
- websocket bootstrap
- workflow switching
- dynamic graph patch
- workflow completion handling

### Run History

- run list rendering
- run detail entry
- historical status visibility
- monitor entry from history if supported

### Workflow execution / monitoring

- rendering the correct workflow
- live state updates
- timeline / status panel behavior
- failure-related status display

### Future features

As new pages are added, they should plug into the same pattern rather than creating a separate testing style.

---

## When to use this strategy

### A. Before a big refactor

Example:

- editor page is ~8000 lines and needs to be broken up

Process:

1. identify current critical flows
2. spec the current behavior
3. generate E2E tests
4. run them against current app
5. refactor
6. re-run as regression gate

### B. During feature development

Example:

- adding Retry
- adding Failure Handling Flow
- adding Monitor tab

Process:

1. write acceptance scenario
2. write YAML contract
3. generate tests
4. implement feature
5. use tests as acceptance + regression proof

### C. For bugs

Example:

- monitor loads wrong workflow after workflow switch

Process:

1. write bug-repro scenario
2. encode expected correct behavior
3. generate E2E
4. fix bug
5. keep test permanently

---

## Recommended test taxonomy

We should not treat every test equally.

### 1. Smoke E2E

Purpose:

- app opens
- key pages load
- core actions available

Examples:

- app shell renders
- sidebar navigation works
- dashboard loads
- editor loads
- monitor loads

### 2. Core workflow E2E

Purpose:

- critical end-to-end user flows

Examples:

- open workflow in editor, modify, save, reload
- enable failure handling and verify persistence
- monitor active workflow from middleware state
- navigate from dashboard to history/detail

### 3. Feature contract E2E

Purpose:

- lock down feature-specific behavior

Examples:

- retry scope behavior
- failure drawer behavior
- monitor workflow replacement on workflow id change

### 4. Contract / export E2E

Purpose:

- verify behavior that depends on generated payloads or persisted state

Examples:

- retry DSL shape
- OnFailure DSL presence/absence
- reload after save preserves feature configuration

---

## Priority model

Do not try to cover everything at once.

### P0

Must exist before risky refactors:

- app shell navigation
- dashboard basic load
- editor basic load
- save / publish reachable
- node add/delete/connect
- monitor empty state and basic running state

### P1

Feature-critical:

- retry
- failure handling drawer
- workflow menu actions
- save/reload persistence
- run history basic flows

### P2

More advanced:

- export/DSL contract
- monitor workflow switching
- websocket edge cases
- validation rules
- timeline / failure handler visualization

---

## Gherkin guidelines

Gherkin is the **human contract**.

### Use Gherkin for:

- what the feature does
- what state transition matters
- what the user expects

### Good rules

- one scenario = one behavior slice
- avoid giant all-in-one scenarios
- use product language, not implementation language
- keep it readable by non-authors

### Example: Monitor

```gherkin
Feature: Live monitor page

  Scenario: Show empty state when no workflow is running
    Given I open the monitor page
    When the runner has no active workflow
    Then I should see the empty monitor state

  Scenario: Render current workflow when runner is already running
    Given I open the monitor page
    When the runner reports an active workflow on initial connection
    Then the workflow graph should be rendered
    And the current running node should be highlighted
```

### Example: Shared navigation

```gherkin
Feature: App shell navigation

  Scenario: Navigate from dashboard to monitor
    Given I open the app
    When I click the Monitor tab
    Then I should land on the monitor page
```

---

## YAML spec guidelines

YAML is the **structured execution contract**.

A spec should describe:

- route / page
- fixture / seed state
- API / websocket mock behavior if needed
- actions
- assertions

### Recommended shape

```yaml
name: monitor-empty-state
feature: monitor-live
route: /monitor

fixture:
  auth: default
  runner:
    status: idle

mocks:
  websocket:
    initial:
      type: initial
      runner_status: idle
      workflow: null

actions:
  - type: open_page

assertions:
  - type: visible
    target: monitor_empty_state
  - type: text_contains
    target: monitor_empty_state
    value: No workflow is currently running
```

### Example: app shell navigation

```yaml
name: navigate-dashboard-to-monitor
feature: app-shell
route: /dashboard

actions:
  - type: open_page
  - type: click_tab
    target: monitor

assertions:
  - type: route_is
    value: /monitor
  - type: visible
    target: monitor_page
```

### Example: editor retry

```yaml
name: retry-basic-main-scope
feature: retry
route: /editor
fixture:
  workflow: empty

actions:
  - type: open_page
  - type: add_node
    nodeType: retry
    targetCanvas: main
    position: { x: 320, y: 180 }
  - type: add_node
    nodeType: skill
    nodeName: step_1
    targetCanvas: main
    position: { x: 520, y: 180 }
  - type: connect
    from: retry_1
    fromPort: main
    to: step_1
    toPort: input

assertions:
  - type: node_in_retry_scope
    nodeId: step_1
    owner: retry_1
```

---

## Generated Playwright tests

Generated tests must still be readable.

### Requirements

- one feature/scenario should map clearly to one or more tests
- output should be human-editable TypeScript
- page objects should be used instead of raw selectors everywhere
- generated tests should not become opaque metaprogrammed blobs

### Generator should do

- parse Gherkin title/intent
- parse YAML actions/assertions
- map actions to page objects/helpers
- map assertions to assertion helpers
- emit readable `.spec.ts`

---

## Page object model

This is mandatory for maintainability.

### Shared page objects

- `AppShellPage`
- `DashboardPage`
- `EditorPage`
- `MonitorPage`
- `RunHistoryPage`

### Example responsibilities

#### `AppShellPage`

- open app
- click sidebar tab
- assert current route/page

#### `DashboardPage`

- wait for dashboard load
- assert runner/workflow cards
- navigate to relevant detail pages

#### `EditorPage`

- open workflow menu
- add node
- connect nodes
- save/publish
- open failure drawer
- modify retry node

#### `MonitorPage`

- wait for websocket bootstrap
- assert empty state
- assert graph rendered
- assert node highlighted
- assert workflow replaced

---

## Selector strategy

Stable selectors are critical.

Prefer `data-testid` for:

- page roots
- tabs
- menu items
- drawers
- fixed nodes
- palette entries
- nodes
- ports
- badges
- monitor empty states
- graph containers
- timeline/status elements

### Examples

```text
data-testid="app-shell"
data-testid="sidebar-tab-dashboard"
data-testid="sidebar-tab-editor"
data-testid="sidebar-tab-monitor"
data-testid="sidebar-tab-run-history"

data-testid="dashboard-page"
data-testid="editor-page"
data-testid="monitor-page"
data-testid="run-history-page"

data-testid="workflow-menu-button"
data-testid="workflow-menu-save"
data-testid="workflow-menu-publish"
data-testid="workflow-menu-failure-handling"
data-testid="workflow-menu-edit-failure-flow"

data-testid="monitor-empty-state"
data-testid="monitor-graph"
data-testid="monitor-current-node"
```

### Rule

Do not depend on fragile DOM nesting when a stable test id can be added.

---

## Network and realtime strategy

Because this app has REST + websocket behavior, the test system should support both.

### REST

Use:

- real API in stable environments when practical
- or deterministic mocks/fixtures when isolation is needed

### WebSocket

Provide a reusable mock/test harness so tests can simulate:

- `initial`
- `node_status_change`
- `workflow_completed`

This is important for:

- monitor page
- live monitoring flows
- future realtime features

### Important

Realtime tests should verify:

- initial bootstrap
- state patching
- workflow replacement
- cleanup on page transition/unmount

---

## Canvas guidance

Canvas tests are flaky if done casually.

### Rules

- reset zoom/pan when possible
- use shared drag-drop helpers
- use shared edge-connect helpers
- assert on result state, not fragile drag motion details
- keep coordinates deterministic
- keep canvas-specific helpers centralized

### Suggested helpers

- `dragPaletteNodeToCanvas(nodeType, position)`
- `connectNodePorts(fromNodeId, fromPort, toNodeId, toPort)`
- `resetCanvasViewport()`

These helpers are reusable across editor, failure flow, and future graph-based views.

---

## Cross-feature contract examples

This system should support contracts that cross page boundaries.

### Example 1

Editor save → dashboard reflects updated workflow metadata

### Example 2

Workflow published in editor → monitor can render matching workflow definition

### Example 3

Dashboard navigation → run history detail → monitor entry

This is why the doc should remain global rather than editor-local.

---

## Minimal baseline before the editor refactor

Because the next immediate step is editor refactoring, we should still define a focused minimum baseline.

### Must-have before refactor

- app shell navigation works
- editor page loads
- basic save works
- basic publish works
- node add/delete/connect works
- retry basic behavior works
- failure handling drawer opens and persists

### Strongly recommended

- monitor empty state
- monitor running workflow bootstrap
- at least one reload persistence test
- at least one DSL/export-related contract test

This keeps the short-term priority clear without making the whole strategy editor-only.

---

## Anti-patterns to avoid

Do not:

- write giant page-specific docs that cannot scale to other pages
- tightly couple tests to current component/file structure
- generate unreadable Playwright code
- skip page objects
- skip stable selectors
- make every scenario rely on full backend integration
- put all behavior into one mega scenario
- treat canvas UIs as special snowflakes with no shared helper layer

---

## Cursor usage guidance

Use this document as the top-level contract for spec-driven E2E work.

Recommended order when using Cursor:

1. add missing `data-testid` values across app shell and core pages
2. create shared page objects
3. define minimal YAML schema
4. define Gherkin feature files
5. implement generator from Gherkin/YAML to Playwright
6. generate P0 tests first
7. review generated tests manually
8. expand feature coverage incrementally

### Important

Cursor can generate a lot quickly, but humans must still review:

- whether the scenario is actually useful
- whether assertions are strong enough
- whether selectors are stable
- whether the test preserves user behavior rather than current implementation

---

## Definition of done

This strategy is working when:

- large refactors can proceed with confidence
- new features can be specified in the same format
- tests are readable and maintainable
- generated tests remain editable
- page-specific coverage fits into one shared system
- regression confidence improves across the whole product, not just one screen

---

## Immediate next steps

1. Add stable `data-testid` values across:
   - app shell
   - dashboard
   - editor
   - monitor
   - run history

2. Build core page objects:
   - AppShellPage
   - EditorPage
   - DashboardPage
   - MonitorPage
   - RunHistoryPage

3. Define minimal shared YAML schema for:
   - route
   - fixture
   - mocks
   - actions
   - assertions

4. Write initial feature files for:
   - app shell navigation
   - editor basic
   - retry
   - failure handling
   - monitor live

5. Generate and run P0 Playwright tests

6. Freeze current behavior before starting the editor refactor

---

## Appendix: suggested initial feature set

### App shell

- sidebar navigation works

### Editor

- editor basic
- save/publish
- retry
- failure handling

### Monitor

- empty state
- initial running workflow bootstrap
- workflow replacement after completion

### Run history

- list load
- detail entry

### Dashboard

- dashboard loads
- current workflow summary visible
- navigation into related pages
