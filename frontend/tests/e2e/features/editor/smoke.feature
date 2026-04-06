# Executable tests: smoke.editor.spec.ts
# See tests/spec_driven_e2e_testing_strategy.md
# SSOT: docs/dsl-example.json (Import 변형 + mock_middleware 스킬 카탈로그)

Feature: Editor smoke

  Scenario: Backend and middleware expose health and skill catalog aligned with dsl-example
    Given the E2E stack is up
    Then the backend health endpoint should respond OK
    And the middleware skill-sets should include vision.PreprocessFrame and system.NotifyOps

  Scenario: Seeded draft editor loads from API
    Given I open the editor for workflow "wf-seed-draft"
    Then I should see the workflow title "Seeded Draft Workflow"
    And Save and Publish should be reachable from the workflow menu

  Scenario: Seeded published workflow draft API contains linear DSL states
    Given the draft API for workflow "wf-seed-published" is loaded
    Then the DSL should include FetchData, TransformData, and ProcessData states
    When I open the editor for workflow "wf-seed-published"
    Then I should see the published workflow title and editor shell

  Scenario: Seeded condition and parallel workflow shows CheckCondition and ParallelSplit
    Given I open the editor for workflow "wf-seed-condition-parallel"
    Then I should see node labels CheckCondition and ParallelSplit

  Scenario: Seeded wait workflow DSL contains WaitForEvent
    Given the draft API for workflow "wf-seed-wait" is loaded
    Then the DSL should include the WaitForEvent state
    When I open the editor for workflow "wf-seed-wait"
    Then I should see the wait workflow title and editor shell

  Scenario: Import docs/dsl-example.json shows Inputs and DSL Labels (Condition, Parallel, Retry, Output)
    Given I open the editor for workflow "wf-seed-draft"
    When I import the repository SSOT dsl-example.json via the workflow menu
    Then I should not see an Import failed dialog
    And I should see canvas labels Inputs, Condition, Parallel, Retry, and Output

  Scenario: Saving after dsl-example import persists draft via PUT
    Given I open the editor for workflow "wf-seed-draft"
    When I import the repository SSOT dsl-example.json via the workflow menu
    And I save from the workflow menu
    Then the draft PUT for wf-seed-draft should succeed

  Scenario: New workflow route loads
    Given I open "/editor/new"
    Then I should see the editor page shell

  Scenario: Leaving editor for dashboard may prompt and then shows dashboard
    Given I am editing workflow "wf-seed-draft"
    When I accept the leave confirmation and choose Dashboard in the sidebar
    Then I should land on the dashboard page
