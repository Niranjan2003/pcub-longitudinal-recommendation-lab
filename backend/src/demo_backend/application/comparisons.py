import hashlib, uuid
from demo_backend.domain.service import Compare, ServiceError
from demo_backend.domain.research import SimulatedResearchProfile, ResearchScenario
from demo_backend.application.policies import POLICIES
from demo_backend.application.roots import session_root
from demo_backend.branching.engine import BranchEngine, _position_after
from demo_backend.branching.simulator import StudyBranchSimulator
from demo_backend.branching.predictor import BranchPredictor
from demo_backend.branching.allocators import EqualAllocator, GreedyAllocator, UncertaintyAllocator, PCUBAllocator, PCUBWeights
from demo_backend.evaluation.oracle import ExhaustiveSyntheticOracle
from demo_backend.evaluation.comparison import outcome_record
from demo_backend.simulation.agenda import resolve_backend
from demo_backend.recommendation.prompt import canonical
from demo_backend.adapters.resources import read

class Comparisons:
    def __init__(self,resources,store):self.r,self.store=resources,store
    def create(self,payload,key):
        q=Compare.model_validate(payload)
        # Canonical policy order is the scientific tie order, never request order.
        pair=tuple(p for p in POLICIES if p[0] in q.policies)
        if len(pair)!=2:raise ServiceError('TWO_DISTINCT_KNOWN_POLICIES_REQUIRED',422)
        def operation(db):
            s=self.store.get('sessions',q.session_id,db)
            if s['revision']!=q.expected_revision:raise ServiceError('STALE_REVISION')
            if s['status']!='open' or s['pending'] is None:raise ServiceError('PENDING_ROOT_REQUIRED')
            if q.oracle and s['world_kind']!='synthetic_simulation':raise ServiceError('HUMAN_ORACLE_UNAVAILABLE',422)
            root=session_root(s,self.r.recipes)
            try:_position_after(_position_after(root.predictor_input.position,root),root)
            except ValueError as exc:raise ServiceError('INSUFFICIENT_HORIZON',422) from exc
            pipeline,model,settings,thresholds=self.r.bundles[s['backend']]
            weights=read(self.r.root/'weights'/s['backend'].replace('@','_')/'selection.json')['weights']
            resolver=self.r.resolver();sim=StudyBranchSimulator(resolver)
            engine=BranchEngine(BranchPredictor(pipeline,model),simulator=sim,policy_identities=pair)
            decision_store=resolver('guarded_llm_score_vector','1').store
            before=decision_store.accounting() if hasattr(decision_store,'accounting') else None
            prepared=engine.prepare_root(root)
            # Read-only full observable prepass verifies decision closure before comparison.
            # It is not the oracle and reads no synthetic outcome probabilities.
            engine.run(prepared,EqualAllocator(),20)
            decisions=sorted(set(decision_store.hits))
            seal=hashlib.sha256(canonical(decisions).encode()).hexdigest()
            after=decision_store.accounting() if hasattr(decision_store,'accounting') else None
            # All evaluation consumers use a fresh, strictly read-only resolver.
            sim=StudyBranchSimulator(self.r.resolver(offline_evaluation=True))
            engine=BranchEngine(BranchPredictor(pipeline,model),simulator=sim,policy_identities=pair)
            allocators={'equal':EqualAllocator(),'greedy':GreedyAllocator(),'uncertainty':UncertaintyAllocator(),'pcub':PCUBAllocator(PCUBWeights(**weights))}
            result=engine.run(prepared,allocators[q.allocator],q.budget)
            truth=None;metrics=None
            if q.oracle:
                oracle=ExhaustiveSyntheticOracle(simulator=sim,policy_identities=pair,generator=resolve_backend(s['backend']),private_profile=SimulatedResearchProfile.model_validate(s['private_profile']),private_scenario=ResearchScenario.model_validate(s['private_scenario']))
                truth=oracle.evaluate(prepared)
                metrics=outcome_record(root,pair,result,truth)
            jid=str(uuid.uuid4())
            value={'id':jid,'status':'complete','session_id':s['id'],'factual_revision':s['revision'],'root_id':root.root_context_id,'policies':pair,'result':result.model_dump(mode='json'),'metrics':metrics,'oracle':None if truth is None else {'policy_values':truth.policy_values,'best_policy':truth.best_policy,'exact_tie':truth.exact_tie,'meaning':'synthetic-model reference; never human ground truth'},'provenance':{'reaction_origin':'hypothetical','evidence_status':'counterfactual','world_kind':s['world_kind'],'recommendation_execution_mode':'recorded_guarded' if any(p[0]=='guarded_llm_score_vector' for p in pair) else 'deterministic','reference_run_fingerprint':None},'costs':{'preparation':{'live_calls':0,'reservations':0,'new_tokens':0,'unique_recorded_decisions':len(decisions),'decision_keys':decisions,'decision_manifest_sha256':seal},'evaluation':{'live_calls':0,'new_tokens':0,'expansions':result.actual_expansions},'combined':{'live_calls':0,'new_tokens':0}},'asset_manifest_fingerprint':self.r.manifest['fingerprint']}
            if after is not None:
                prior={r['key'] for r in before['records']};fresh=[r for r in after['records'] if r['key'] not in prior]
                tokens=None if any(r['usage'] is None or r['usage']['total_tokens'] is None for r in fresh) else sum(r['usage']['total_tokens'] for r in fresh)
                value['costs']['preparation'].update({'live_calls':len(fresh),'reservations':len(fresh),'new_tokens':tokens,'journal_before':before,'journal_after':after})
                value['costs']['combined']={'live_calls':len(fresh),'new_tokens':tokens}
                if any(k not in self.r.store.entries for k in decisions):value['provenance']['recommendation_execution_mode']='live_guarded'
            self.store.put(db,'jobs',jid,value);return value
        return self.store.atomic('comparison',key,payload,operation)
    def get(self,jid):return self.store.get('jobs',jid)
