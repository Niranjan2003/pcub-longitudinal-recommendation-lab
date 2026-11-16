import hashlib, json
from pathlib import Path
from demo_backend.recommendation.prompt import canonical
from demo_backend.ports.errors import MissingDecision, DecisionIntegrityError

class ForbiddenTransport:
    def generate_text(self, prompt):
        raise RuntimeError('Network disabled: a recorded decision is required')

class RecordedStore:
    mode='replay_only'
    def __init__(self, root):
        self.root=Path(root)
        manifest=json.loads((self.root/'recorded_decision_subset_manifest.json').read_text(encoding='utf-8'))
        self.entries={e['key']:e for e in manifest['decisions']}
        self.hits=[]
    def get(self,key):
        if key not in self.entries:raise MissingDecision(key)
        entry=self.entries[key]
        for e in entry['files']:
            p=(self.root/e['path']).resolve()
            if not p.is_relative_to(self.root.resolve()):raise DecisionIntegrityError('Invalid subset path')
            if hashlib.sha256(p.read_bytes()).hexdigest()!=e['sha256']:raise DecisionIntegrityError('Subset file hash mismatch')
        def read(rel):return json.loads((self.root/'recorded_decisions'/rel).read_text(encoding='utf-8'))
        d,q,e=read(key+'.json'),read('requests/'+key+'.json'),read('responses/'+key+'.json')
        for value,field in ((d,'record_sha256'),(e,'evidence_sha256')):
            unsigned=dict(value);digest=unsigned.pop(field)
            if hashlib.sha256(canonical(unsigned).encode()).hexdigest()!=digest:raise DecisionIntegrityError(field)
        raw=(e['response'].get('choices') or [{}])[0].get('message',{}).get('content') or ''
        if not (hashlib.sha256(canonical(q['input']).encode()).hexdigest()==key==d['input_sha256'] and q['input']==d['input'] and d['response_evidence_sha256']==e['evidence_sha256'] and hashlib.sha256(raw.encode()).hexdigest()==d['raw_response_sha256']):
            raise DecisionIntegrityError('Request, evidence and decision binding mismatch')
        self.hits.append(key)
        return d
    def reserve(self,*args):raise RuntimeError('Read-only decision store')
    def put(self,*args):raise RuntimeError('Read-only decision store')
