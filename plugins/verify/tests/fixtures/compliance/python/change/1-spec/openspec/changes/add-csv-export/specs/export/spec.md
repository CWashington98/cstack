## ADDED Requirements

### Requirement: csv-export

Orders SHALL export as a file with a header row and one row per order. An export with no orders SHALL be refused.

#### Scenario: export-has-header-row

- **GIVEN** orders for Ada and Grace
- **WHEN** they are exported
- **THEN** the first line names the columns
- **AND** each order has its own line

#### Scenario: export-empty-refused

- **GIVEN** no orders
- **WHEN** they are exported
- **THEN** the export is refused with a message saying there is nothing to export
