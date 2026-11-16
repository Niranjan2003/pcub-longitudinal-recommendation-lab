from demo_backend.application.sessions import Sessions
from demo_backend.application.comparisons import Comparisons
from demo_backend.application.policies import POLICIES,BACKENDS
from demo_backend.adapters.resources import read
from demo_backend.domain.service import ServiceError

class Backend:
    def __init__(self,resources,store):
        self.r=resources;self.sessions=Sessions(resources,store);self.comparisons=Comparisons(resources,store)
    def capabilities(self):
        return {'api_version':'1','mode':'offline' if self.r.live_configuration is None else 'live_opt_in','policies':[p[0] for p in POLICIES],'backends':BACKENDS,'predictors':['population','class_bias','contextual'],'allocators':['equal','greedy','uncertainty','pcub'],'budgets':[2,4,8,12],'branch_depth':2,'human_oracle':False,'live_guarded':self.r.live_configuration is not None,'conformal':'Frozen synthetic reference diagnostics, not guaranteed human coverage; never branch pruning','recorded_guarded':'Only exact contexts in the bounded recorded closure are available','asset_manifest_fingerprint':self.r.manifest['fingerprint']}
    def recipe(self,rid):
        if rid not in self.r.by_id:raise ServiceError('RECIPE_NOT_FOUND',404)
        return self.r.by_id[rid].model_dump(mode='json')
    def reference_results(self):
        folder=self.r.root/'reference-results'
        return {'world_kind':'reference_replay','reference_run_fingerprint':read(self.r.root/'golden/recorded_decision_subset_manifest.json')['upstream_freeze_fingerprint'],'formal_closure_present':False,'claim':'Historical R1 aggregates; not results of the interactive demo. RQ1 positive gain and RQ3 strict superiority were not established.','tables':{name:read(folder/(name+'.json')) for name in ('primary_comparison','branch_metrics','longitudinal_metrics','llm_accounting','replay_record')}}
