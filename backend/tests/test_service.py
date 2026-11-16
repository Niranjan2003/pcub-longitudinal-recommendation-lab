
import concurrent.futures, http.client, json, pathlib, tempfile, threading, unittest
from http.server import ThreadingHTTPServer
from tests.support import resources
from demo_backend.adapters.sqlite import Store
from demo_backend.application.backend import Backend
from demo_backend.application.roots import session_root
from demo_backend.domain.service import ServiceError
from demo_backend.api.server import handler

class Service(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.r=resources()
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.path=pathlib.Path(self.temp.name)/'state.sqlite3';self.db=Store(self.path);self.b=Backend(self.r,self.db)
    def tearDown(self):self.temp.cleanup()
    def human(self,predictor='contextual',**changes):
        payload={'world_kind':'human_interaction','predictor':predictor,'persona':{'user_id':'demo-human','display_name':'Demo','dietary_pattern':'omnivore'}};payload.update(changes)
        return self.b.sessions.create(payload,'create')
    def test_restart_duplicate_and_owner(self):
        s=self.human();q={'expected_revision':0}
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            responses=list(pool.map(lambda _:self.b.sessions.recommend(s['id'],q,'recommend'),range(8)))
        self.assertTrue(all(r==responses[0] for r in responses));s=responses[0]
        self.b=Backend(self.r,Store(self.path));self.assertEqual(self.b.sessions.recommend(s['id'],q,'recommend'),s)
        pending=s['pending'];body={'expected_revision':s['revision'],'recommendation_id':pending['id'],'reaction':'ACCEPT'}
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            responses=list(pool.map(lambda _:self.b.sessions.feedback(s['id'],body,'feedback'),range(8)))
        self.assertTrue(all(r==responses[0] for r in responses));saved=self.db.get('sessions',s['id'])
        self.assertEqual(len(saved['history']),1);self.assertEqual(saved['adapter']['updates'],1);self.assertIsNone(saved['adapter']['pending'])
        with self.assertRaises(ServiceError):self.b.sessions.feedback(s['id'],{**body,'reaction':'REJECT'},'feedback')
        with self.assertRaises(ServiceError):self.b.sessions.recommend(s['id'],{'expected_revision':0},'stale')
        self.assertIsNone(saved['private_profile']);self.assertNotIn('synthetic_reference',saved['evidence'][0]['outcome'])
        self.assertEqual(saved['evidence'][0]['provenance']['reaction_origin'],'human_submission')
    def test_atomic_rollback(self):
        s=self.human()
        def failure(db):
            changed=self.db.get('sessions',s['id'],db);changed['revision']=999;self.db.put(db,'sessions',s['id'],changed);raise RuntimeError('Injected crash before commit')
        with self.assertRaises(RuntimeError):self.db.atomic('fault','fault',{},failure)
        self.assertEqual(self.b.sessions.get(s['id'])['revision'],0)
        # Committed idempotency response survives a lost HTTP response/restart.
        result=self.b.sessions.recommend(s['id'],{'expected_revision':0},'lost-response')
        self.assertEqual(Backend(self.r,Store(self.path)).sessions.recommend(s['id'],{'expected_revision':0},'lost-response'),result)
    def test_provenance_matrix(self):
        from demo_backend.domain.provenance import validate_provenance
        f=json.loads((self.r.root/'golden/fixtures/new_contracts/A5.json').read_text(encoding='utf-8'))
        for row in f['expected_output']:
            value={k:row[k] for k in ('world_kind','reaction_origin','recommendation_execution_mode','evidence_status')};value['reference_run_fingerprint']='fixture' if row['reference_fingerprint_required'] else None
            if row['allowed']:self.assertEqual(validate_provenance(value),value)
            else:
                with self.assertRaises(ValueError):validate_provenance(value)
    def test_cancel_rollover_and_branch_isolation(self):
        s=self.human(predictor='class_bias');s=self.b.sessions.recommend(s['id'],{'expected_revision':s['revision']},'r0')
        root=session_root(self.db.get('sessions',s['id']),self.r.recipes)
        self.assertFalse(hasattr(root.profile,'tendencies'));self.assertEqual(root.persona.model_dump(mode='json'),s['persona'])
        self.assertEqual(root.state_snapshot.model_dump(mode='json'),s['state'])
        q={'session_id':s['id'],'expected_revision':s['revision'],'policies':['deterministic_recipe_recommendation','constraint_only_baseline'],'budget':2,'oracle':True}
        with self.assertRaises(ServiceError):self.b.comparisons.create(q,'oracle')
        before=self.db.get('sessions',s['id']);job=self.b.comparisons.create({**q,'oracle':False},'branch');self.assertEqual(self.db.get('sessions',s['id']),before);self.assertEqual(job['provenance']['evidence_status'],'counterfactual');self.assertIsNone(job['oracle'])
        for i in range(6):
            if i:s=self.b.sessions.recommend(s['id'],{'expected_revision':s['revision']},'r'+str(i))
            s=self.b.sessions.feedback(s['id'],{'expected_revision':s['revision'],'recommendation_id':s['pending']['id'],'reaction':'ACCEPT'},'f'+str(i))
        s=self.b.sessions.recommend(s['id'],{'expected_revision':s['revision']},'r6');self.assertEqual(s['pending']['predictor_input']['position'],{'session_index':2,'turn_index':1});self.assertEqual(len(s['history']),6)
        before=self.db.get('sessions',s['id']);s=self.b.sessions.feedback(s['id'],{'expected_revision':s['revision'],'operation':'cancel'},'cancel');after=self.db.get('sessions',s['id']);self.assertEqual(after['adapter']['counts'],before['adapter']['counts']);self.assertEqual(after['state'],before['state']);self.assertEqual(s['status'],'closed')
        with self.assertRaises(ServiceError):self.b.sessions.recommend(s['id'],{'expected_revision':s['revision']},'resume')
    def test_synthetic_and_no_safe(self):
        name=next(p.name for p in (self.r.root/'golden/fixtures/reference').glob('trajectory_*current_structured*deterministic_recipe*.json'))
        s=self.b.sessions.create({'world_kind':'synthetic_simulation','fixture':name},'synthetic');s=self.b.sessions.recommend(s['id'],{'expected_revision':s['revision']},'recommend')
        with self.assertRaises(ServiceError):self.b.sessions.feedback(s['id'],{'expected_revision':s['revision'],'recommendation_id':s['pending']['id'],'reaction':'REJECT'},'invented')
        s=self.b.sessions.feedback(s['id'],{'expected_revision':s['revision'],'recommendation_id':s['pending']['id']},'engine');self.assertEqual(s['evidence'][0]['provenance']['reaction_origin'],'synthetic_generated')
        self.assertNotIn('private_profile',s);self.assertIsNone(s['reference_run_fingerprint'])
        from demo_backend.recommendation.feedback import NoSafeRecommendation
        h=self.b.sessions.create({'world_kind':'human_interaction','persona':{'user_id':'blocked','display_name':'Blocked','dietary_pattern':'omnivore','max_ingredient_count':0,'min_servings':100000000}},'blocked')
        with self.assertRaises(NoSafeRecommendation):self.b.sessions.recommend(h['id'],{'expected_revision':0},'no-safe')
        self.assertEqual(self.b.sessions.get(h['id'])['revision'],0)
    def test_http_contract(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),handler(self.b));thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        def request(method,path,body=None,key=None):
            conn=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=30);headers={'Content-Type':'application/json'}
            if key:headers['Idempotency-Key']=key
            conn.request(method,path,None if body is None else json.dumps(body),headers);response=conn.getresponse();status=response.status;value=json.loads(response.read());conn.close();return status,value
        try:
            self.assertEqual(request('GET','/v1/capabilities')[0],200)
            self.assertEqual(request('GET','/v1/recipes/'+self.r.recipes[0].recipe_id)[0],200)
            self.assertEqual(request('GET','/v1/reference-results/r1')[1]['formal_closure_present'],False)
            payload={'world_kind':'human_interaction','persona':{'user_id':'http','display_name':'HTTP','dietary_pattern':'omnivore'}}
            self.assertEqual(request('POST','/v1/sessions',payload)[0],400)
            status,s=request('POST','/v1/sessions',payload,'c');self.assertEqual(status,200);base='/v1/sessions/'+s['id']
            self.assertEqual(request('GET',base)[1],s)
            status,s=request('POST',base+'/recommendations',{'expected_revision':0},'r');self.assertEqual(status,200)
            status,job=request('POST','/v1/branch-comparisons',{'session_id':s['id'],'expected_revision':s['revision'],'policies':['deterministic_recipe_recommendation','constraint_only_baseline'],'budget':2},'b');self.assertEqual(status,200)
            self.assertEqual(request('GET','/v1/branch-comparisons/'+job['id'])[1],job)
            status,s=request('POST',base+'/feedback',{'expected_revision':s['revision'],'recommendation_id':s['pending']['id'],'reaction':'ACCEPT'},'f');self.assertEqual(status,200);self.assertEqual(len(s['history']),1)
            self.assertEqual(request('GET','/v1/sessions/absent')[0],404)
        finally:server.shutdown();server.server_close();thread.join()
