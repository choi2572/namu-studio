# Executable tests: smoke.dashboard.spec.ts
# See tests/spec_driven_e2e_testing_strategy.md

Feature: Dashboard smoke

  Scenario: Dashboard shows summary stats for seeded data
    Given I open the dashboard
    Then I should see total workflows, runs, and success rate

  Scenario: Workflow table lists seeded workflows
    Given I open the dashboard
    Then I should see the draft and published seeded workflows

  Scenario: Clicking a draft workflow row opens the editor
    Given I open the dashboard
    When I click the seeded draft workflow row
    Then I should be on the editor for that workflow

  Scenario: Clicking a published workflow row opens workflow monitor
    Given I open the dashboard
    When I click the seeded published workflow row
    Then I should be on the monitor route for that workflow
