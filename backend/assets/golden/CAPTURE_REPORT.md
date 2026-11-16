# Golden-reference capture report — completed coverage

## Environment
Original environment.json retained unchanged. Completion used the same executable/dependencies and guarded bootstrap; no installations.

## Repository verification
Original git_before/after and completion_git_checks agree. All used source/asset hashes verified before/after; original fixture bytes preserved.

## Captured cases

- A1: PASS 
- A10: PASS 
- A11: PASS 
- A2: PASS 
- A3: PASS 
- A4: PASS 
- A5: PASS 
- A6: PASS 
- A7: PASS 
- A8: PASS 
- A9: PASS 
- H1: PASS 
- H10: PASS 
- H11: PASS 
- H12: PASS 
- H13: PASS 
- H14: PASS 
- H15: PASS 
- H16: PASS 
- H17: PASS 
- H18: PASS 
- H19: PASS 
- H2: PASS 
- H20: PASS 
- H3: PASS 
- H4: PASS 
- H5: PASS 
- H6: PASS 
- H7: PASS 
- H8: PASS 
- H9: PASS 
- branches: PASS 
- contracts: PASS 
- trajectories: PASS 
- turns: PASS 
- validation_accounting: PASS 

## Blocked items
{}

## Decision closure
77 unique existing decisions; no provider or reservation operations in the production lookup adapter. Dry scorer parser tests record reservation/result events in memory only, never scientific journal writes.

## Reference versus new-contract fixtures
Strictly separated directories. Feature-name validation is not enforced by the original model loader: its permissive result is captured, while stronger future rejection is a new contract. Human close/cancel, SQLite, HTTP and future subset validation have no old implementation and are not reference-capture blockers.

## Integrity
All prior fixture bytes unchanged; new fixture paths end _completion or explicitly name new contracts. capture_manifest.json contains final file hashes and canonical payload fingerprint (excluding its own fingerprint field). Completion source reads are merged into reference_source_manifest.json. Oracle instrumentation observes original locals/utility returns without changing arguments or results.

## Scientific warnings
Initial capture incidents: hostname guard was narrowed to allow local metadata; explicit UTF-8 reads resolved a Windows corpus-decoding discrepancy. Diagnostic retained separately. No scientific source repairs were made. H20 explicitly uses a later S1T4 branch root after initial T1/T2 payloads. Structured raw utilities are observed before the source rounding return; Python/NumPy numeric implementations remain separate. New-contract fixtures do not establish historical human validity.

## Final verdict
CAPTURE SEALED — SAFE TO FINALIZE RECONSTRUCTION MANUAL

Final independent validation reconstructed all 12 oracle backend/pair expected values exactly from captured path utilities/probabilities. An additional explicit ACCEPT/REJECT/ACCEPT probe exercises nonzero signed-history decay, and an additional nextafter health-score fixture protects deterministic near ties. Original fixture bytes remain unchanged.
