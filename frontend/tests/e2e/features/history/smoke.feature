# Executable tests: smoke.history.spec.ts
# See tests/spec_driven_e2e_testing_strategy.md

Feature: Run History smoke

  Scenario: History lists seeded runs
    Given I open Run History
    Then I should see the runs table with seeded success and failed runs

  Scenario: Filter runs by status
    Given I open Run History
    When I filter by status FAILED
    Then only the failed seeded run is listed

  Scenario: Click a run row opens replay monitor
    Given I open Run History
    When I click the seeded success run row
    Then I should be on monitor replay for that run
