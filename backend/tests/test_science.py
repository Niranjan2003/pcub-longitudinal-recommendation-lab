
import dataclasses, hashlib, json, math, socket, sys, unittest
from unittest.mock import patch
from collections import Counter
import numpy as np
from tests.support import *
from demo_backend.safety.gate import safe_context
from demo_backend.recommendation.baselines import DeterministicRecommendationPolicy
from demo_backend.recommendation.feedback import FeedbackSequencePolicy,score_components
from demo_backend.recommendation.deterministic import _score_recipe,_constraint_violations
from demo_backend.recommendation.shortlist import shortlist
from demo_backend.recommendation import guarded as sv
from demo_backend.recommendation.guard_contracts import GuardedRerankContext
from demo_backend.recommendation.json_extract import extract_json_object
from demo_backend.recommendation.prompt import canonical
from demo_backend.ports.errors import BudgetExceeded,MissingDecision,DecisionIntegrityError,LLMClientError
from demo_backend.domain.ontology import RESEARCH_REACTION_ORDER as ORDER,ResearchReaction as Reaction
from demo_backend.domain.canonical import canonical_json
from demo_backend.domain.seeds import stable_seed
from demo_backend.simulation import structured as oc
from demo_backend.simulation.agenda import resolve_backend,AgendaDerivedSimulator,ExternalAction,map_action
from demo_backend.simulation.transition import PCUBSyntheticStateTransition
from demo_backend.prediction.records import EncodedPredictorInput
from demo_backend.prediction.population import PopulationPredictor,PersonalizedPredictor,stable_softmax
from demo_backend.prediction.contextual import ContextualPersonalizer
from demo_backend.uncertainty.conformal import ConformalMethod
from demo_backend.uncertainty.aps import deterministic_order
from demo_backend.branching.allocators import EqualAllocator,GreedyAllocator,UncertaintyAllocator,PCUBAllocator,PCUBWeights,_tie_key
from demo_backend.branching.contracts import FrontierCandidate
from demo_backend.branching.engine import BranchEngine,_position_after
from demo_backend.branching.simulator import StudyBranchSimulator
from demo_backend.branching.predictor import BranchPredictor
from demo_backend.application.roots import synthetic_root
from demo_backend.evaluation.oracle import ExhaustiveSyntheticOracle
from demo_backend.evaluation.comparison import outcome_record
from demo_backend.application.reference_trajectory import generate_trajectory
from demo_backend.application.policies import BACKENDS

class Science(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.guard=patch.object(socket.socket,'connect',side_effect=AssertionError('OFFLINE_NETWORK_ATTEMPT'));cls.guard.start()
        cls.dns=patch('socket.getaddrinfo',side_effect=AssertionError('OFFLINE_DNS_ATTEMPT'));cls.dns.start()
        cls.r=resources()
    @classmethod
    def tearDownClass(cls):cls.guard.stop();cls.dns.stop()
    def f(self,name):return self.r.fixture(name+'.json')
    def eq(self,a,b):self.assertEqual(cv(a),b)
    def test_safety_and_ranking(self):
        f=self.f('H1');c=context(f['input']);self.eq([r.recipe_id for r in safe_context(c).recipes],f['expected_output']['safe_ids'])
        self.eq({r.recipe_id:_constraint_violations(c.persona,r) for r in c.recipes},f['expected_intermediate_values']['reasons'])
        with self.assertRaises(ValueError):safe_context(dataclasses.replace(c,recipes=(c.recipes[0],c.recipes[0])))
        with self.assertRaises(ValueError):safe_context(dataclasses.replace(c,recipes=(c.recipes[1],)))
        for name,policy in [('H2',DeterministicRecommendationPolicy()),('H3',FeedbackSequencePolicy()),('H3_signed_decay_probe',FeedbackSequencePolicy()),('A2_deterministic_near_tie',DeterministicRecommendationPolicy())]:
            f=self.f(name);self.eq(policy.recommend(context(f['input'])),f['expected_output'])
        f=self.f('H2_completion');self.eq(DeterministicRecommendationPolicy().recommend(context(f['input'])),f['expected_output']['ranking']);self.eq(DeterministicRecommendationPolicy().recommend(context(f['expected_output']['tie_context'])),f['expected_output']['tie_result'])
        for row in self.f('H3_completion')['expected_output']:
            c=context(row['input']);self.eq({r.recipe_id:score_components(c,r) for r in c.recipes},row['components']);self.eq(FeedbackSequencePolicy().recommend(c),row['result'])
    def test_guarded_parser_and_identities(self):
        f=self.f('A1_completion');value=f['input']['canonical_input'];observed=GuardedRerankContext.model_validate(value['observable_context']);fb=shortlist(context(self.f('H2')['input']))[2]
        special={'provider':RuntimeError('recorded fake provider error'),'timeout':TimeoutError('fake timeout'),'budget':BudgetExceeded('fake budget'),'call_limit':LLMClientError('limit',diagnostic_category='call_limit_exceeded'),'completed_invalid':LLMClientError('No final content',diagnostic_category='empty_response')}
        for row in f['expected_output']:
            events=[];error=None
            if 'lookup_error' in row:error=MissingDecision('missing') if row['lookup_error']=='MissingDecision' else DecisionIntegrityError('bad checksum')
            raw=special.get(row.get('case'),row.get('raw'))
            class Dry:
                def get(self,k):
                    if error:raise error
                    return None
                def reserve(self,k):events.append('dry_parser_reservation')
                def put(self,k,v):events.append('dry_parser_result');return v
            class Fake:
                last_response_model='recorded-fixture';last_usage=None
                def generate_text(self,p):
                    if isinstance(raw,Exception):raise raw
                    return raw
            got=result(lambda:sv.score_once(Fake(),Dry(),'test-only',value,observed,self.r.settings,fb))
            if 'value' in got:
                d=got['value'][0];got={'fallback':d['fallback'],'reason':d['fallback_reason'],'decision':d['decision'],'ranking':d['scientific_ranking'],'selected':d['selected_recipe_id']}
            self.eq(got,row['result'])
            if 'events' in row:self.eq(events,row['events'])
        for row in self.f('A3_completion')['expected_output']:
            f=self.f('A3_completion');fallback=RecommendationAgentOutput.model_validate(f['input']['fallback'])
            observed=GuardedRerankContext.model_validate(row['input']['observable_context'])
            key,value=sv.decision_input(observed,sv.ScoreSettings.model_validate(f['input']['settings']),fallback)
            self.eq(key,row['decision_key']);self.eq(canonical(value),row['canonical']);self.eq(sv.prompt(observed),row['prompt']);self.eq(canonical(value).encode().hex(),row['utf8_hex'])
        f=self.f('H4');key=hashlib.sha256(canonical(f['input']).encode()).hexdigest();self.eq(self.r.store.get(key),f['expected_output'])
        for key in self.r.store.entries:self.r.store.get(key)
        self.assertEqual(len(self.r.store.entries),77)
        with self.assertRaises(MissingDecision):self.r.store.get('0'*64)
    def test_outcomes_transitions_features(self):
        for backend in BACKENDS:
            p,m,settings,thresholds=self.r.bundles[backend]
            for row in self.f('turns_'+backend)['expected_output']:
                d=private(row['outcome_context']);o=resolve_backend(backend).generate(d)
                self.eq(o,row['observation']['post_reaction']);self.eq(PCUBSyntheticStateTransition().apply(d.state_before,o),row['transition'])
                inp=PredictorInput.model_validate(row['observation']['predictor_input']);x=p.transform(inp)
                self.eq(p.feature_names,row['feature_names']);self.eq(x,row['features']);self.eq(m.predict_logits(x),row['logits']);self.eq(m.predict_proba(x),row['probabilities'])
        for row in self.f('H5_completion')['expected_output']:
            d=private(row['input']);raw={}
            def trace(frame,event,arg):
                if frame.f_code is oc._utilities.__code__ and event=='return':raw.update(cv(frame.f_locals['utilities']))
                return trace
            sys.settrace(trace)
            try:o=oc.PCUBSyntheticOutcomeGenerator().generate(d)
            finally:sys.settrace(None)
            self.eq(o,row['outcome']);self.eq(oc._features(d),row['features']);self.eq(oc._utilities(d,oc._features(d)),row['rounded_logits']);self.eq(raw,row['raw_adjusted_logits'])
        for row in self.f('H6_completion')['expected_output']:self.eq(AgendaDerivedSimulator().generate(private(row['input'])),row['outcome'])
        for row in self.f('H6_completion')['expected_intermediate_values']['mapping']:self.eq(map_action(ExternalAction(**row['input'])),row['output'])
        for row in self.f('H7_completion')['expected_output']:self.eq(PCUBSyntheticStateTransition().apply(ResearchInitialState.model_validate(row['input_state']),AuthoritativeOutcome.model_validate(row['outcome'])),row['result'])
        for row in self.f('H8_completion')['expected_output']:
            p,m,s,t=self.r.bundles[row['backend']];x=p.transform(PredictorInput.model_validate(row['input']));self.eq(x,row['vector']);self.eq(m.predict_logits(x),row['logits']);self.eq(m.predict_proba(x),row['probabilities']);self.eq(ORDER[int(np.argmax(m.predict_proba(x)))],row['predicted_class'])
    def test_personalization(self):
        for row in self.f('H10')['expected_output']:
            p,m,s,t=self.r.bundles[row['backend']]
            a=ContextualPersonalizer(m,s['feature_indices'],learning_rate=s['contextual_rate'],l2=s['contextual_l2']) if row['method']=='contextual_online_personalization_v1' else PersonalizedPredictor(m,np.asarray(s['prior']),prior_concentration=s['class_bias_concentration'])
            state=a.start_state()
            for step in row['steps']:
                d=dict(step['input']);d['vector']=np.asarray(d['vector']);d['prior_reactions']=tuple(Reaction(x) for x in d['prior_reactions']);inp=EncodedPredictorInput(**d)
                self.eq(state,step['before']);self.eq(a.predict(inp,state),step['prediction']);self.eq(state,step['pending']);a.update(state,Reaction(step['revealed']));self.eq(state,step['after'])
            self.eq(a.start_state(),row['reset'])
        from demo_backend.application.prediction import pack,unpack
        for row in self.f('H10')['expected_output']:
            if row['method']=='contextual_online_personalization_v1':
                for step in row['steps']:self.eq(pack(unpack(step['pending'])),step['pending'])
        for row in self.f('H10_completion')['expected_output']:
            p,m,s,t=self.r.bundles[row['backend']];original=next(x for x in self.f('H10')['expected_output'] if x['backend']==row['backend'] and x['method']=='contextual_online_personalization_v1')
            def view(step):
                d=dict(step['input']);d['vector']=np.asarray(d['vector']);d['prior_reactions']=tuple(Reaction(x) for x in d['prior_reactions']);return EncodedPredictorInput(**d)
            first,second=map(view,original['steps'][:2]);a=ContextualPersonalizer(m,s['feature_indices'],learning_rate=s['contextual_rate'],l2=s['contextual_l2']);st=a.start_state();a.predict(first,st)
            self.eq(result(lambda:a.predict(dataclasses.replace(first,scenario_id='different-scenario'),st)),row['pending_owner_mismatch']);self.eq(result(lambda:a.predict(second,st)),row['late_reveal_next_predict']);a.update(st,Reaction(original['steps'][0]['revealed']))
            self.eq(result(lambda:a.update(st,Reaction(original['steps'][0]['revealed']))),row['second_update']);self.eq(result(lambda:a.predict(dataclasses.replace(second,scenario_id='different-scenario'),st)),row['owner_mismatch_after_reveal']);self.eq(result(lambda:a.predict(dataclasses.replace(second,history_depth=9),st)),row['skipped_depth'])
    def test_loader_boundaries(self):
        import copy
        from demo_backend.prediction.features import FeaturePipeline
        from demo_backend.prediction.population import NumpyMultinomialLogisticRegression
        f=self.f('A6');bad=copy.deepcopy(f['input']['original_features']);bad['base']['feature_specification_fingerprint']='bad'
        self.eq(result(lambda:FeaturePipeline.from_dict(bad,self.r.recipes)),f['expected_output']['feature_fingerprint_failure'])
        mp=copy.deepcopy(f['input']['model']);mp['class_order']=list(reversed(mp['class_order']))
        self.eq(result(lambda:NumpyMultinomialLogisticRegression.from_dict(mp)),f['expected_output']['class_mismatch'])
        # The reference loader accepts reordered names. The service loader's separate
        # ordered-name gate rejects them; do not claim this stricter check is historical.
        mp=copy.deepcopy(f['input']['model']);mp['feature_names'].reverse();model=NumpyMultinomialLogisticRegression.from_dict(mp)
        p,m,s,t=self.r.bundles[BACKENDS[0]];self.assertNotEqual(tuple(mp['feature_names']),p.feature_names)
        self.assertEqual(model.coefficients.shape,m.coefficients.shape)
    def test_conformal_numerics(self):
        for row in self.f('H11')['expected_output']:
            # Resolve the backend from the saved observation ID; models retain their own method settings.
            backend=next(b for b in BACKENDS if b in row['id']);s=self.r.bundles[backend][2]
            method=ConformalMethod(**s['conformal_methods'][row['method']]);self.eq(method.scores(row['probabilities'],row['u']),row['scores']);self.eq(method.prediction_set(row['probabilities'],row['threshold'],row['u']),row['set'])
        f=self.f('A2_completion')
        from demo_backend.simulation.numeric import stable_softmax as python_softmax
        self.eq(python_softmax({r.value:0. for r in ORDER},[r.value for r in ORDER],temperature=.92),f['expected_intermediate_values']['python'])
        self.eq(stable_softmax(np.zeros(4)),f['expected_intermediate_values']['numpy'])
        decision=sv.GuardedScoreDecision.model_validate_json(canonical({'candidate_scores':[50,50],'reason_codes':['BALANCED_TRADEOFF'],'tradeoff_summary':'tie'}));candidates=[{'recipe_id':'a'},{'recipe_id':'b'}]
        self.eq(sv.derive_ranking(decision,candidates),f['expected_output']['integer_score_tie']);self.eq(sv.derive_ranking(decision.model_copy(update={'candidate_scores':[50,51]}),candidates),f['expected_output']['adjacent_integer_ranks'])
        for row in f['expected_output']['sets']:
            method=ConformalMethod(row['method']);self.eq(method.scores([.4,.3,.2,.1],.5),row['scores'])
            for boundary in row['thresholds']:self.eq(method.prediction_set([.4,.3,.2,.1],boundary['q'],.5),boundary['set'])
        for row in f['expected_output']['sampling']:self.eq(oc._sample(dict(zip([r.value for r in ORDER],[.25,.25,0.,.5])),row['draw']),row['result'])
        for row in f['expected_output']['class_ties']:self.eq(deterministic_order(row['p']),row['order']);self.eq(int(np.argmax(row['p'])),row['argmax'])
        for row in self.f('A10')['expected_output']:
            method=ConformalMethod(row['method']);self.eq(result(lambda:method.prediction_set([.25]*4,0.,.5)),row['threshold_zero']);self.eq(method.calibrate([.2],.95),row['quantile']);self.eq(method.prediction_set([.4,.3,.2,.1],.5,.5),row['crossing'])
        f=self.f('A3');self.eq(stable_seed(*f['expected_output']['seed_parts']),f['expected_output']['seed']);self.eq(canonical_json(f['input'][0]).encode().hex(),f['expected_output']['utf8'])
    def test_allocator_ties(self):
        f=self.f('H14_completion');frontier=[FrontierCandidate.model_validate(v) for v in f['input']]
        self.eq([_tie_key(v) for v in frontier],f['expected_intermediate_values']['tie_keys'])
        for a,row in zip((EqualAllocator(),GreedyAllocator(),UncertaintyAllocator(),PCUBAllocator(PCUBWeights(.5,.5,0,0))),f['expected_output']):
            remaining=list(frontier);counts={}
            for step in row['steps']:
                self.eq(counts,step['before']);chosen=a.select(tuple(remaining),counts);self.eq(chosen.candidate_id,step['chosen']);remaining.remove(chosen);counts[chosen.first_reaction.value]=counts.get(chosen.first_reaction.value,0)+1;self.eq(counts,step['after'])
    def test_branches_and_oracle(self):
        trajectories=[self.r.fixture(p.name) for p in (self.r.root/'golden/fixtures/reference').glob('trajectory_*.json')]
        for backend in BACKENDS:
            f=self.f('branches_'+backend.replace('@','_'));row=ResearchObservation.model_validate(f['input']['root'])
            source=next(x for x in trajectories if x['input']['scenario']['scenario_id']==row.scenario_id);profile=SimulatedResearchProfile.model_validate(source['input']['profile']);scenario=ResearchScenario.model_validate(source['input']['scenario'])
            root=synthetic_root(row,profile,scenario,self.r.recipes);pipeline,model,s,t=self.r.bundles[backend]
            for expected in f['expected_output']:
                pair=tuple(tuple(p) for p in expected['pair']);sim=StudyBranchSimulator(self.r.resolver());engine=BranchEngine(BranchPredictor(pipeline,model),simulator=sim,policy_identities=pair);prepared=engine.prepare_root(root)
                self.eq(prepared.snapshots,expected['prepared_snapshots']);self.eq(prepared.actions,expected['prepared_actions']);self.eq(prepared.probabilities,expected['prepared_probabilities'])
                self.eq(engine._candidates(prepared=prepared,parent_id=None,depth=1,branch_path=(),policy_probabilities=prepared.probabilities,parent_cumulative=(1.,1.),actions=prepared.actions),expected['frontier'])
                allocators=[EqualAllocator(),GreedyAllocator(),UncertaintyAllocator(),PCUBAllocator(PCUBWeights(**f['input']['weights']))];a=next(a for a in allocators if a.allocator_id==expected['result']['allocator_id']);got=engine.run(prepared,a,expected['result']['budget']);self.eq(got,expected['result'])
                oracle=ExhaustiveSyntheticOracle(simulator=sim,policy_identities=pair,generator=resolve_backend(backend),private_profile=profile,private_scenario=scenario).evaluate(prepared)
                self.eq(oracle,expected['oracle']);self.eq(outcome_record(root,pair,got,oracle),expected['case_result'])
        for row in self.f('H17_completion')['expected_output']:
            # Independent arithmetic using captured contributions; this does not call the oracle implementation.
            for policy in row['pair']:
                total=0.
                terms=[t for t in row['contribution_terms'] if t['policy_id']==policy[0]]
                for first in ORDER:
                    subset=[t for t in terms if t['reaction_one']==first.value]
                    unique={t['reaction_two']:t for t in subset};expected_two=0.
                    for second in ORDER:
                        t=unique[second.value];expected_two+=t['probabilities_two'][second.value]*t['utility_two']
                    t=subset[0];total+=t['probabilities_one'][first.value]*(t['utility_one']+expected_two)
                self.eq(total,row['result']['policy_values'][policy[0]])
    def test_longitudinal(self):
        for path in sorted((self.r.root/'golden/fixtures/reference').glob('trajectory_*.json')):
            f=self.r.fixture(path.name);profile=SimulatedResearchProfile.model_validate(f['input']['profile']);scenario=ResearchScenario.model_validate(f['input']['scenario']);backend=next(b for b in BACKENDS if b in scenario.scenario_id);no=[]
            got=generate_trajectory(profile,scenario,self.r.recipes,outcome_generator=resolve_backend(backend),no_safe_events=no,resolver=self.r.resolver());self.eq(got,f['expected_output']);self.eq(no,f['expected_intermediate_values']['no_safe'])
    def test_workflow_projection(self):
        expected=self.f('H20_completion')['expected_output'];action_id=expected['recommendation']['action_id'];source=next(self.r.fixture(p.name) for p in (self.r.root/'golden/fixtures/reference').glob('trajectory_*deterministic_recipe*.json') if self.r.fixture(p.name)['input']['scenario']['scenario_id'] in action_id)
        profile=SimulatedResearchProfile.model_validate(source['input']['profile']);scenario=ResearchScenario.model_validate(source['input']['scenario']);pipeline,model,s,t=self.r.bundles[BACKENDS[0]]
        trajectory=generate_trajectory(profile,scenario,self.r.recipes,outcome_generator=resolve_backend(BACKENDS[0]),no_safe_events=[],resolver=self.r.resolver());first,second=trajectory.observations[:2]
        self.eq(first.predictor_input.action,expected['recommendation']);self.eq(model.predict_proba(pipeline.transform(first.predictor_input)),expected['population_prediction']);self.eq(first.post_reaction,expected['authoritative_reaction']);self.eq(PCUBSyntheticStateTransition().apply(profile.initial_state,first.post_reaction),expected['transition']);self.eq(second.predictor_input.history,expected['next_history']);self.eq(second.predictor_input.action,expected['next_recommendation'])
        ref=expected['branch_comparison_at_later_S1T4'];root=synthetic_root(trajectory.observations[3],profile,scenario,self.r.recipes);pair=tuple(tuple(p) for p in ref['pair']);sim=StudyBranchSimulator(self.r.resolver());engine=BranchEngine(BranchPredictor(pipeline,model),simulator=sim,policy_identities=pair);prepared=engine.prepare_root(root);weights=self.f('branches_current_structured_simulator_1')['input']['weights'];result_value=engine.run(prepared,PCUBAllocator(PCUBWeights(**weights)),8);truth=ExhaustiveSyntheticOracle(simulator=sim,policy_identities=pair,generator=resolve_backend(BACKENDS[0]),private_profile=profile,private_scenario=scenario).evaluate(prepared)
        self.eq(result_value,ref['result']);self.eq(truth,ref['oracle']);self.eq(outcome_record(root,pair,result_value,truth),ref['case_result'])
