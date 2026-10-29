## ADDED Requirements

### Requirement: evidence-goes-to-its-own-branch

`evidence.mjs publish --pr <n>` SHALL take the newest run in `.verify/runs/` for the pull request's head, and copy that run's screenshots and recordings to the branch `verify-evidence`, in the folder `pr-<n>/<head>/`. The branch SHALL hold only evidence files and never share history with the project's code. It SHALL then write a "Proof it works" section into the pull request's description, between `<!-- verify-evidence:start -->` and `<!-- verify-evidence:end -->`, with the run's status, its commit and each image or recording linked from that branch. Running it again SHALL replace the section, not add a second one.

It SHALL only push to `verify-evidence`, and SHALL refuse when the project lists that name in `protectedBranches`.

#### Scenario: publish-adds-proof-to-description

- **GIVEN** a pull request at head `9c2d4e1`, and a finished run for `9c2d4e1` with status `verified live` and two screenshots
- **WHEN** `evidence.mjs publish --pr 88` runs
- **THEN** the branch `verify-evidence` has both screenshots in `pr-88/9c2d4e1…/`
- **AND** the description has one section between the markers with the status, the commit and both images

#### Scenario: rerun-replaces-section

- **GIVEN** a description that already has a section between the markers
- **WHEN** `evidence.mjs publish` runs again after a new run
- **THEN** the description has exactly one section, for the new run

#### Scenario: no-run-for-head-says-so

- **GIVEN** runs exist only for an older commit
- **WHEN** `evidence.mjs publish --pr 88` runs
- **THEN** it exits 1 saying no run matches the head, and pushes and edits nothing

#### Scenario: files-outside-run-folder-refused

- **GIVEN** a run whose `run.json` names an artifact outside its run folder, such as `../../.env`
- **WHEN** `evidence.mjs publish` runs
- **THEN** it exits 1 naming that file, and pushes and edits nothing
- **GUARDS** evidence publishing must never upload a file from outside the run folder.
