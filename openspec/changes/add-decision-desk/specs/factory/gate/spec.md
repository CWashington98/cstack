## ADDED Requirements

### Requirement: unseen-contested-decision-holds-the-merge

The gate SHALL hold a pull request that a contested decision affects until the owner has answered that decision. Agreed decisions, proved answers and earlier rulings SHALL NOT hold anything.

#### Scenario: contested-decision-holds-merge-only

- **GIVEN** a pull request that passes every gate rule
- **AND** one contested decision affects it, and the owner hasn't answered it
- **WHEN** `factory gate` runs on it
- **THEN** it holds with the reason naming that decision
- **EXAMPLE:** #431 hides deleted patients, which is decision `d-0014`, contested. The gate prints `would-hold: waiting on owner for contested decision d-0014 (hide or grey out deleted patients)`. Once the owner replies `keep d-0014`, the next gate run on #431 says `would-merge`.
