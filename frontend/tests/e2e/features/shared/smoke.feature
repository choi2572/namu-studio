# Human-readable smoke contract. Executable tests: smoke.app-shell.spec.ts
# See tests/spec_driven_e2e_testing_strategy.md

Feature: App shell and core pages smoke

  Scenario: Dashboard lists workflows
    Given I open the app
    Then I should see the dashboard page
    And I should see a workflow named "Pick & Place Draft"

  Scenario: Sidebar navigates to Monitor
    Given I open the app
    When I click the Monitor tab in the sidebar
    Then I should land on the monitor page

  Scenario: Editor loads an existing workflow
    Given I open the editor for workflow "workflow-001"
    Then I should see the workflow title "Pick & Place Draft"
    And Save and Publish should be reachable from the workflow menu
