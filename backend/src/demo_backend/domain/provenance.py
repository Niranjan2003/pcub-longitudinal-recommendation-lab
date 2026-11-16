def validate_provenance(value):
    world=value['world_kind'];origin=value['reaction_origin'];mode=value['recommendation_execution_mode'];status=value['evidence_status']
    if world not in ('human_interaction','synthetic_simulation','reference_replay') or mode not in ('deterministic','recorded_guarded','live_guarded'):raise ValueError('Unknown provenance dimension')
    if world=='reference_replay' and (mode=='live_guarded' or not value.get('reference_run_fingerprint')):raise ValueError('Reference replay requires sealed reference identity and forbids live decisions')
    if world!='reference_replay' and value.get('reference_run_fingerprint') is not None:raise ValueError('Interactive lineage is not reference replay')
    expected={'human_interaction':'human_submission','synthetic_simulation':'synthetic_generated','reference_replay':'recorded_synthetic'}
    allowed=(status=='pending' and origin is None) or (status=='counterfactual' and origin=='hypothetical') or (status=='factual' and origin==expected[world])
    if not allowed:raise ValueError('Invalid provenance combination')
    return value
