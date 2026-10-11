## Requirements

### Requirement: order-total

An order's total SHALL add up the price of every item times its quantity.

#### Scenario: order-total-shown

- **GIVEN** an order of 3 items at 2 and 1 item at 5
- **WHEN** its total is shown
- **THEN** it reads 11
