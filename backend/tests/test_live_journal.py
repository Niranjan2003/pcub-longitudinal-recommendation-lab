
import json,pathlib,tempfile,unittest
from unittest.mock import patch
from tests.support import resources,context
from demo_backend.adapters.live import Journal,Transport,UnknownCompletion
from demo_backend.ports.errors import MissingDecision,DecisionIntegrityError
from demo_backend.recommendation.guarded import score_once
from demo_backend.recommendation.guard_contracts import GuardedRerankContext
from demo_backend.recommendation.shortlist import shortlist
from demo_backend.recommendation.prompt import canonical

class EmptyRecorded:
    entries={}
    def get(self,key):raise MissingDecision(key)
class LiveJournal(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.r=resources()
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.path=pathlib.Path(self.temp.name)/'provider.sqlite3';self.j=Journal(self.path,EmptyRecorded(),2)
        row=self.r.fixture('A3_completion.json')['expected_output'][0];self.key=row['decision_key'];self.value=row['input'];self.j.bind(self.key,self.value)
        self.observed=GuardedRerankContext.model_validate(self.value['observable_context']);self.fb=shortlist(context(self.r.fixture('H2.json')['input']))[2]
    def tearDown(self):self.temp.cleanup()
    def run_score(self,client):return score_once(client,self.j,self.key,self.value,self.observed,self.r.settings,self.fb)
    def reply(self):
        content=canonical({'candidate_scores':[50]*len(self.observed.candidates),'reason_codes':['BALANCED_TRADEOFF'],'tradeoff_summary':'fixture'})
        wire=canonical({'model':'fixture','usage':{'prompt_tokens':10,'completion_tokens':20,'total_tokens':30},'choices':[{'message':{'content':content}}]}).encode()
        class Reply:
            def __enter__(self):return self
            def __exit__(self,*args):return False
            def read(self,n):return wire
        return Reply()
    def test_raw_recovery_no_second_transport(self):
        transport=Transport(self.j,self.r.settings,'https://fixture.invalid/api','test-token')
        class Opener:
            def open(inner,*args,**kwargs):return self.reply()
        with patch('urllib.request.build_opener',return_value=Opener()) as network:
            with self.j.writer(),patch.object(self.j,'put',side_effect=RuntimeError('crash after durable response')):
                with self.assertRaises(RuntimeError):self.run_score(transport)
            self.assertEqual(network.call_count,1)
            with self.j.writer():record,replayed=self.run_score(transport)
            self.assertFalse(replayed);self.assertEqual(network.call_count,1);self.assertFalse(record['fallback'])
            with self.j.writer():cached,replayed=self.run_score(transport)
            self.assertTrue(replayed);self.assertEqual(record,cached);self.assertEqual(network.call_count,1)
        accounting=self.j.accounting();self.assertEqual(accounting['reservations'],1);self.assertEqual(accounting['unknown'],0);self.assertEqual(accounting['records'][0]['usage']['total_tokens'],30)
        reader=Journal(self.path,EmptyRecorded(),2,read_only=True);self.assertEqual(reader.get(self.key),record)
    def test_unknown_never_retried(self):
        transport=Transport(self.j,self.r.settings,'https://fixture.invalid/api','test-token')
        with patch('urllib.request.build_opener',side_effect=TimeoutError('fixture')) as network:
            with self.j.writer():
                with self.assertRaises(UnknownCompletion):self.run_score(transport)
            with self.j.writer():
                with self.assertRaises(UnknownCompletion):self.run_score(transport)
            self.assertEqual(network.call_count,1)
        self.assertEqual(self.j.accounting()['unknown'],1)
