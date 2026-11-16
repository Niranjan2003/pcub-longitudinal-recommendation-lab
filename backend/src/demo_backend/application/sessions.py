import uuid
from demo_backend.domain.service import CreateSession, Revision, Feedback, HumanOutcome, ServiceError
from demo_backend.domain.platform import UserPersona
from demo_backend.domain.research import ResearchInitialState, SimulatedResearchProfile, ResearchScenario, Position, ProfileCharacteristics, VersionedReference, CurrentContext, PredictorInput, RecommenderAction, SelectedItem, HistoryEntry, AuthoritativeOutcome, SampleProvenance
from demo_backend.domain.ontology import ResearchReaction, ResearchContinuation
from demo_backend.domain.versions import SEED_DERIVATION_VERSION
from demo_backend.domain.canonical import recipe_dataset_content_fingerprint
from demo_backend.simulation.profile_adapter import _persona, _dynamic_state, _state_features
from demo_backend.simulation.structured import PCUBOutcomeContext
from demo_backend.simulation.agenda import resolve_backend
from demo_backend.simulation.transition import PCUBSyntheticStateTransition
from demo_backend.catalog.windows import candidate_recipes
from demo_backend.ports.recommendation import RecommendationContext
from demo_backend.safety.gate import safe_context
from demo_backend.application.policies import POLICIES
from demo_backend.application.prediction import adapter,pack,predict,reveal,conformal_reference
from demo_backend.domain.provenance import validate_provenance

def public(s):
    if s['pending'] is not None:validate_provenance(s['pending']['provenance'])
    for e in s.get('evidence',[]):validate_provenance(e['provenance'])
    result={k:s[k] for k in ('id','world_kind','policy','backend','predictor','revision','status','plan','persona','request','state','history','pending','cancelled')}
    result['evidence']=s.get('evidence',[])
    result['reference_run_fingerprint']=None
    result['claim']='Interactive engineering simulation; not historical R1 evidence or measured human psychology.'
    return result
class Sessions:
    def __init__(self,resources,store):self.r,self.store=resources,store
    def create(self,payload,key):
        q=CreateSession.model_validate(payload)
        if (q.policy,'1') not in POLICIES:raise ServiceError('UNKNOWN_POLICY',422)
        def operation(db):
            sid=str(uuid.uuid4());profile=scenario=None
            if q.world_kind=='synthetic_simulation':
                f=self.r.fixture(q.fixture)
                if not f['fixture_id'].startswith('trajectory_'):raise ServiceError('TRAJECTORY_FIXTURE_REQUIRED',422)
                profile=SimulatedResearchProfile.model_validate(f['input']['profile']);original=ResearchScenario.model_validate(f['input']['scenario'])
                if q.prediction_backend not in original.scenario_id:raise ServiceError('BACKEND_FIXTURE_MISMATCH',422)
                persona=_persona(profile);state=profile.initial_state;subject=profile.profile_id
                scenario=original.model_copy(update={'scenario_id':sid,'simulation_seed_namespace':'interactive:'+sid,'recommender_policy':VersionedReference(identifier=q.policy,version='1')})
                plan=scenario.session_plan.model_dump(mode='json');request=scenario.initial_context.request;dataset=scenario.dataset
            else:
                persona=q.persona;subject=persona.user_id;request=q.request
                state=q.initial_state or ResearchInitialState(**dict.fromkeys(('trust','motivation','fatigue','satisfaction','engagement','resistance'),0.5))
                plan={'number_of_sessions':q.segments,'turns_per_session':q.turns_per_segment}
                dataset=VersionedReference(identifier='HUMMUS',version='hummus_10000_food_only_v2',fingerprint=recipe_dataset_content_fingerprint(self.r.recipes))
            s={'id':sid,'subject_id':subject,'world_kind':q.world_kind,'policy':q.policy,'backend':q.prediction_backend,'predictor':q.predictor,'revision':0,'status':'open','plan':plan,'request':request,'dataset':dataset.model_dump(mode='json'),'persona':persona.model_dump(mode='json'),'state':state.model_dump(mode='json'),'history':[],'pending':None,'cancelled':[],'adapter':pack(adapter(self.r.bundles[q.prediction_backend],q.predictor).start_state()),'private_profile':None if profile is None else profile.model_dump(mode='json'),'private_scenario':None if scenario is None else scenario.model_dump(mode='json')}
            self.store.put(db,'sessions',sid,s);return public(s)
        return self.store.atomic('create',key,payload,operation)
    def get(self,sid):return public(self.store.get('sessions',sid))
    def checked(self,db,sid,revision):
        s=self.store.get('sessions',sid,db)
        if s['revision']!=revision:raise ServiceError('STALE_REVISION')
        if s['status']!='open':raise ServiceError('SESSION_CLOSED')
        return s
    def recommend(self,sid,payload,key):
        q=Revision.model_validate(payload)
        def operation(db):
            s=self.checked(db,sid,q.expected_revision)
            if s['pending'] is not None:return public(s)
            history=tuple(HistoryEntry.model_validate(x) for x in s['history']);n=len(history);turns=s['plan']['turns_per_session']
            if n>=turns*s['plan']['number_of_sessions']:raise ServiceError('HORIZON_REACHED')
            position=Position(session_index=n//turns+1,turn_index=n%turns+1)
            state=ResearchInitialState.model_validate(s['state']);persona=UserPersona.model_validate(s['persona'])
            recent=[h.action.selected_item.item_id for h in history]
            candidates=candidate_recipes(self.r.recipes,profile_id=s['subject_id'],dataset_fingerprint=s['dataset']['fingerprint'] or s['dataset']['identifier'],ordinal=n+1)
            memory={'observable_history':history,'recent_recipe_ids':recent,'accepted_recipe_ids':[h.action.selected_item.item_id for h in history if h.reaction==ResearchReaction.ACCEPT],'rejected_recipe_ids':[h.action.selected_item.item_id for h in history if h.reaction==ResearchReaction.REJECT],'recent_preference_feedback':['requested_change:'+d.value for h in history for c in h.requested_changes for d in c.dimensions],'prior_observation_count':n,'session_index':position.session_index,'current_request':s['request']}
            ctx=safe_context(RecommendationContext(persona,_dynamic_state(state),candidates,position.turn_index,memory))
            resolver=self.r.resolver();chosen_policy=resolver(s['policy'],'1');journal=getattr(chosen_policy,'store',None)
            cost_before=journal.accounting() if hasattr(journal,'accounting') else None
            output=chosen_policy.recommend(ctx);recipe=self.r.by_id[output.selected_recipe_id]
            oid=f'{sid}:s{position.session_index:02d}:t{position.turn_index:02d}'
            action=RecommenderAction(action_id=oid+':action',action_type='recommend_recipe',selected_item=SelectedItem(item_id=recipe.recipe_id,title=recipe.title,ingredients=tuple(recipe.ingredients),dataset=VersionedReference.model_validate(s['dataset']),known_constraints=tuple(output.constraint_violations)),explanation=output.rationale,grounding=(f"policy:{s['policy']}@1",'v3_observable_history_request_position'))
            characteristics=ProfileCharacteristics(**{k:tuple(getattr(persona,k)) if k!='dietary_pattern' else persona.dietary_pattern for k in ('dietary_pattern','allergies','excluded_ingredients','health_goals','taste_preferences')})
            inp=PredictorInput(position=position,action=action,recommender_policy=VersionedReference(identifier=s['policy'],version='1'),profile_features=characteristics,context=CurrentContext(request=s['request']),history=history,features=_state_features(state,position,'profile:'+s['subject_id']+':initial_state' if not history else history[-1].source_evidence_ids[0]))
            probabilities,adapted=predict(self.r.bundles[s['backend']],s['predictor'],s['adapter'],inp,s['subject_id'],sid,oid)
            mode='recorded_guarded' if s['policy']=='guarded_llm_score_vector' else 'deterministic'
            decision_key=None
            if s['policy']=='guarded_llm_score_vector':
                decision_key=resolver(s['policy'],'1').events[-1]['decision_sha256']
                if decision_key not in self.r.store.entries:mode='live_guarded'
            s['pending']={'id':oid,'recommendation':output.model_dump(mode='json'),'predictor_input':inp.model_dump(mode='json'),'probabilities':probabilities,'provenance':{'world_kind':s['world_kind'],'reaction_origin':None,'evidence_status':'pending','recommendation_execution_mode':mode,'reference_run_fingerprint':None}}
            s['pending']['source_decision_fingerprint']=decision_key
            s['pending']['conformal_reference']=conformal_reference(self.r.bundles[s['backend']],inp,oid)
            s['pending']['asset_manifest_fingerprint']=self.r.manifest['fingerprint']
            s['pending']['provider_costs']={'reservations':0,'live_calls':0,'new_tokens':0,'cache_reuse':decision_key is not None}
            if cost_before is not None:
                cost_after=journal.accounting();prior={r['key'] for r in cost_before['records']};fresh=[r for r in cost_after['records'] if r['key'] not in prior]
                tokens=None if any(r['usage'] is None or r['usage']['total_tokens'] is None for r in fresh) else sum(r['usage']['total_tokens'] for r in fresh)
                s['pending']['provider_costs']={'reservations':len(fresh),'live_calls':len(fresh),'new_tokens':tokens,'cache_reuse':not fresh,'journal_before':cost_before,'journal_after':cost_after}
            s['adapter']=adapted;s['revision']+=1;self.store.put(db,'sessions',sid,s);return public(s)
        return self.store.atomic('recommend:'+sid,key,payload,operation)
    def feedback(self,sid,payload,key):
        q=Feedback.model_validate(payload)
        def operation(db):
            s=self.checked(db,sid,q.expected_revision);pending=s['pending']
            if q.operation in ('cancel','close'):
                if q.reaction is not None or q.requested_changes:raise ServiceError('CLOSE_CANNOT_REVEAL',422)
                if pending:
                    s['cancelled'].append(pending);s['pending']=None
                    if isinstance(s['adapter'],dict) and 'pending' in s['adapter']:s['adapter']['pending']=None
                s['status']='closed';s['revision']+=1;self.store.put(db,'sessions',sid,s);return public(s)
            if pending is None or q.recommendation_id!=pending['id']:raise ServiceError('PENDING_RECOMMENDATION_MISMATCH')
            inp=PredictorInput.model_validate(pending['predictor_input']);state=ResearchInitialState.model_validate(s['state'])
            if s['world_kind']=='human_interaction':
                if q.reaction is None:raise ServiceError('HUMAN_REACTION_REQUIRED',422)
                outcome=HumanOutcome(reaction=q.reaction,continuation=q.continuation,requested_changes=q.requested_changes,source_evidence_ids=(pending['id']+':human-feedback',))
                origin='human_submission'
            else:
                if q.reaction is not None or q.requested_changes or q.continuation!=ResearchContinuation.CONTINUE:raise ServiceError('SYNTHETIC_REACTION_IS_ENGINE_OWNED',422)
                profile=SimulatedResearchProfile.model_validate(s['private_profile']);scenario=ResearchScenario.model_validate(s['private_scenario'])
                outcome=resolve_backend(s['backend']).generate(PCUBOutcomeContext(profile,scenario,inp.position,self.r.by_id[inp.action.selected_item.item_id],inp.action.selected_item.known_constraints,state,inp.history,tuple(h.action.selected_item.item_id for h in inp.history)))
                origin='synthetic_generated'
            # Only this atomic operation reveals the label and advances state.
            s['adapter']=reveal(self.r.bundles[s['backend']],s['predictor'],s['adapter'],outcome.reaction)
            s['state']=PCUBSyntheticStateTransition().apply(state,outcome).state_after.model_dump(mode='json')
            entry=HistoryEntry(position=inp.position,action=inp.action,reaction=outcome.reaction,continuation=outcome.continuation,requested_changes=outcome.requested_changes,source_evidence_ids=outcome.source_evidence_ids)
            s['history'].append(entry.model_dump(mode='json'));s['pending']=None;s['revision']+=1
            s.setdefault('evidence',[]).append({'forecast':pending,'outcome':outcome.model_dump(mode='json'),'provenance':{**pending['provenance'],'reaction_origin':origin,'evidence_status':'factual'}})
            if len(s['history'])==s['plan']['number_of_sessions']*s['plan']['turns_per_session'] or (s['world_kind']=='human_interaction' and outcome.continuation==ResearchContinuation.DISENGAGE):s['status']='closed'
            self.store.put(db,'sessions',sid,s);return public(s)
        return self.store.atomic('feedback:'+sid,key,payload,operation)
