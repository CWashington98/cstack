## ADDED Requirements

### Requirement: seat-limit

A team SHALL never hold more seats than its limit.

#### Scenario: seat-added-under-limit

- **GIVEN** a team with a limit of 3 and no seats
- **WHEN** a person is added
- **THEN** the person holds a seat
- **AND** the team's seats left drops from 3 to 2

#### Scenario: seat-refused-at-limit

- **GIVEN** a team at its limit
- **WHEN** anyone tries to add another person
- **THEN** the add is refused with "This team is full."
- **AND** the team still holds the same number of seats

#### Scenario: admin-adds-past-limit

- **GIVEN** a team at its limit
- **WHEN** an admin adds another person
- **THEN** the person holds a seat
