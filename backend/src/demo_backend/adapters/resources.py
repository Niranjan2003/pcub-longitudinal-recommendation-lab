import hashlib, json
from pathlib import Path
import numpy as np
from demo_backend.adapters.catalog import load_hummus_recipe_items
from demo_backend.adapters.recorded import RecordedStore, ForbiddenTransport
from demo_backend.prediction.features import FeaturePipeline
from demo_backend.prediction.population import NumpyMultinomialLogisticRegression
from demo_backend.recommendation.guarded import ScoreSettings
from demo_backend.application.policies import PolicyResolver, BACKENDS

def read(path):return json.loads(Path(path).read_text(encoding='utf-8'))
class Resources:
    def __init__(self, root,live_configuration=None):
        self.root=Path(root).resolve()
        self.live_configuration=live_configuration
        # Generated subset manifest lists precisely the copied operational assets.
        self.manifest=read(self.root/'subset_manifest.json')
        unsigned=dict(self.manifest);digest=unsigned.pop('fingerprint')
        if hashlib.sha256(json.dumps(unsigned,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()!=digest:raise ValueError('Subset manifest fingerprint mismatch')
        if unsigned['capture_fingerprint']!='368727191a5801c928aef6cff992ca16b9237c3ee920e9308c3f3987e039f0b6':raise ValueError('Wrong reference capture')
        for e in self.manifest['files']:
            p=(self.root/e['destination']).resolve()
            if not p.is_relative_to(self.root):raise ValueError('Asset path escapes root')
            if hashlib.sha256(p.read_bytes()).hexdigest()!=e['sha256']:raise ValueError('Asset integrity: '+e['destination'])
        self.recipes=tuple(load_hummus_recipe_items(self.root/'catalog/hummus_subset_10000.parquet',manifest_path=self.root/'catalog/hummus_subset_10000_manifest.json'))
        self.by_id={r.recipe_id:r for r in self.recipes}
        self.store=RecordedStore(self.root/'golden')
        self.settings=ScoreSettings.model_validate(read(self.root/'configuration/inheritance.json')['llm_settings'])
        self.bundles={}
        for backend in BACKENDS:
            folder=self.root/'models'/backend.replace('@','_')
            # Whole original model package manifest is copied, never rewritten as a subset.
            for e in read(folder/'manifest.json')['artifacts']:
                if hashlib.sha256((folder/e['path']).read_bytes()).hexdigest()!=e['sha256']:raise ValueError('Whole model package mismatch')
            p=FeaturePipeline.from_dict(read(folder/'features.json'),self.recipes)
            payload=read(folder/'population.json');m=NumpyMultinomialLogisticRegression.from_dict(payload)
            if tuple(payload['feature_names'])!=p.feature_names or m.coefficients.shape!=(len(p.feature_names),4) or m.intercepts.shape!=(4,) or not np.isfinite(m.coefficients).all() or not np.isfinite(m.intercepts).all():raise ValueError('Ordered feature/model alignment')
            self.bundles[backend]=(p,m,read(folder/'settings.json'),read(folder/'thresholds.json'))
    def resolver(self,offline_evaluation=False):
        recorded=RecordedStore(self.root/'golden')
        if self.live_configuration is None:return PolicyResolver(ForbiddenTransport(),recorded,self.settings)
        from demo_backend.adapters.live import Journal,Transport,LockedGuardedPolicy
        cfg=self.live_configuration;journal=Journal(cfg['journal'],recorded,cfg['maximum'],read_only=offline_evaluation)
        if offline_evaluation:return PolicyResolver(ForbiddenTransport(),journal,self.settings)
        client=Transport(journal,self.settings,cfg['endpoint'],cfg['token'])
        return PolicyResolver(client,journal,self.settings,guarded=LockedGuardedPolicy(client,journal,self.settings))
    def fixture(self,name):
        p=(self.root/'golden/fixtures/reference'/name).resolve()
        if p.parent!=(self.root/'golden/fixtures/reference').resolve() or p.suffix!='.json':raise ValueError('Invalid fixture name')
        return read(p)
