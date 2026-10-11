## ADDED Requirements

### Requirement: seat-limit

A team SHALL be able to add seats up to its limit and no further, and SHALL see how many seats it has left.

#### Scenario: seat-added-under-limit

- **GIVEN** a team using 2 of its 3 seats
- **WHEN** the team adds a seat
- **THEN** the team uses 3 seats

#### Scenario: seat-refused-at-limit

- **GIVEN** a team using 3 of its 3 seats
- **WHEN** the team adds a seat
- **THEN** the seat is refused
- **AND** the team still uses 3 seats

#### Scenario: seats-left-shown

- **GIVEN** a team using 1 of its 3 seats
- **WHEN** the team looks at its seats
- **THEN** it sees 2 seats left
