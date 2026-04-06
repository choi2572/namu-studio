# Executable tests: smoke.monitor.spec.ts
# See tests/spec_driven_e2e_testing_strategy.md

Feature: Monitor smoke

  Scenario: Sidebar navigates to live monitor
    Given I open the app
    When I click the Monitor tab in the sidebar
    Then I should land on the live monitor page

  Scenario: Live runner monitor page loads
    Given I open the live monitor
    Then I should see the Monitor title and connection UI

  Scenario: Run monitor shows workflow and status
    Given I open the monitor for a seeded successful run
    Then I should see the published workflow name and SUCCESS

  Scenario: Replay mode shows DAG and timeline
    Given I open the monitor for a seeded run in replay mode
    Then I should see replay DAG description and Play control

  Scenario: Workflow prep for published workflow
    Given I open monitor workflow prep for a published seeded workflow
    Then Run should be enabled and DAG View should be visible
