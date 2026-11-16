import argparse, json, os, re, secrets
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit,unquote
from pydantic import ValidationError
from demo_backend.adapters.resources import Resources
from demo_backend.adapters.sqlite import Store
from demo_backend.application.backend import Backend
from demo_backend.domain.service import ServiceError
from demo_backend.recommendation.feedback import NoSafeRecommendation
from demo_backend.ports.errors import MissingDecision,DecisionIntegrityError,BudgetExceeded
from demo_backend.adapters.live import UnknownCompletion

def handler(backend,allowed_origin=None,token=None):
    class Handler(BaseHTTPRequestHandler):
        server_version='PCUBDemo/1'
        def log_message(self,format,*args):return
        def send(self,status,value):
            body=json.dumps(value,ensure_ascii=False,allow_nan=False,separators=(',',':')).encode()
            self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(body)));self.send_header('Cache-Control','no-store')
            if allowed_origin and self.headers.get('Origin')==allowed_origin:
                self.send_header('Access-Control-Allow-Origin',allowed_origin);self.send_header('Vary','Origin')
            self.end_headers();self.wfile.write(body)
        def authorize(self):
            if self.headers.get('Origin') not in (None,allowed_origin):raise ServiceError('ORIGIN_DENIED',403)
            if token and not secrets.compare_digest(self.headers.get('Authorization',''),'Bearer '+token):raise ServiceError('UNAUTHORIZED',401)
        def do_OPTIONS(self):
            try:
                self.authorize();self.send_response(204)
                if allowed_origin:self.send_header('Access-Control-Allow-Origin',allowed_origin)
                self.send_header('Access-Control-Allow-Methods','GET,POST,OPTIONS');self.send_header('Access-Control-Allow-Headers','Content-Type,Idempotency-Key,Authorization');self.send_header('Content-Length','0');self.end_headers()
            except ServiceError as e:self.send(e.status,{'error':{'code':e.code}})
            except UnknownCompletion:self.send(409,{'error':{'code':'PROVIDER_UNKNOWN_COMPLETION','action':'Stop live operations. Preserve journal; do not retry or clear reservations.'}})
            except BudgetExceeded:self.send(409,{'error':{'code':'PROVIDER_BUDGET_OR_WRITER_UNAVAILABLE'}})
        def do_GET(self):self.route('GET')
        def do_POST(self):self.route('POST')
        def route(self,method):
            try:
                self.authorize();path=unquote(urlsplit(self.path).path);payload={};key=self.headers.get('Idempotency-Key','')
                if method=='POST':
                    if self.headers.get('Transfer-Encoding'):raise ServiceError('TRANSFER_ENCODING_UNSUPPORTED',400)
                    if self.headers.get('Content-Type','').split(';')[0]!='application/json':raise ServiceError('JSON_REQUIRED',415)
                    length=int(self.headers.get('Content-Length','0'))
                    if not 0<length<=65536:raise ServiceError('BODY_SIZE',413)
                    payload=json.loads(self.rfile.read(length).decode('utf-8'))
                    if not isinstance(payload,dict):raise ServiceError('JSON_OBJECT_REQUIRED',422)
                if method=='GET' and path=='/v1/capabilities':value=backend.capabilities()
                elif method=='GET' and path=='/v1/reference-results/r1':value=backend.reference_results()
                elif method=='GET' and path.startswith('/v1/recipes/'):value=backend.recipe(path[len('/v1/recipes/'):])
                elif method=='POST' and path=='/v1/sessions':value=backend.sessions.create(payload,key)
                elif method=='POST' and path=='/v1/branch-comparisons':value=backend.comparisons.create(payload,key)
                elif method=='GET' and re.fullmatch(r'/v1/branch-comparisons/[^/]+',path):value=backend.comparisons.get(path.rsplit('/',1)[1])
                else:
                    m=re.fullmatch(r'/v1/sessions/([^/]+)(?:/(recommendations|feedback))?',path)
                    if not m:raise ServiceError('ROUTE_NOT_FOUND',404)
                    sid,action=m.groups()
                    if method=='GET' and action is None:value=backend.sessions.get(sid)
                    elif method=='POST' and action=='recommendations':value=backend.sessions.recommend(sid,payload,key)
                    elif method=='POST' and action=='feedback':value=backend.sessions.feedback(sid,payload,key)
                    else:raise ServiceError('METHOD_NOT_ALLOWED',405)
                self.send(200,value)
            except ServiceError as e:self.send(e.status,{'error':{'code':e.code}})
            except UnknownCompletion:self.send(409,{'error':{'code':'PROVIDER_UNKNOWN_COMPLETION','action':'Stop live operations; preserve journal and do not retry.'}})
            except BudgetExceeded:self.send(409,{'error':{'code':'PROVIDER_BUDGET_OR_WRITER_UNAVAILABLE'}})
            except NoSafeRecommendation:self.send(422,{'error':{'code':'NO_SAFE_RECOMMENDATION','action':'Clarify constraints or start a new scenario; no constraints were relaxed.'}})
            except MissingDecision:self.send(409,{'error':{'code':'RECORDED_CONTEXT_UNAVAILABLE','action':'Use a supported curated context or a deterministic policy in a new scenario.'}})
            except DecisionIntegrityError:self.send(503,{'error':{'code':'ASSET_INTEGRITY_FAILURE'}})
            except (ValidationError,ValueError,UnicodeError,KeyError):self.send(422,{'error':{'code':'INVALID_REQUEST'}})
            except Exception:self.send(500,{'error':{'code':'INTERNAL_ERROR'}})
    return Handler

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--assets',default='assets');parser.add_argument('--database',default='runtime/demo.sqlite3');parser.add_argument('--port',type=int,default=8765);parser.add_argument('--live',action='store_true');parser.add_argument('--live-call-limit',type=int,default=0);parser.add_argument('--journal',default='runtime/provider.sqlite3');args=parser.parse_args()
    cfg=None
    if args.live:
        if args.live_call_limit<1:parser.error('--live requires a positive --live-call-limit')
        cfg={'journal':args.journal,'maximum':args.live_call_limit,'endpoint':os.environ['DEMO_PROVIDER_ENDPOINT'],'token':os.environ['DEMO_PROVIDER_TOKEN']}
    server=ThreadingHTTPServer(('127.0.0.1',args.port),handler(Backend(Resources(args.assets,cfg),Store(args.database)),os.environ.get('DEMO_FRONTEND_ORIGIN'),os.environ.get('DEMO_API_TOKEN')))
    try:server.serve_forever()
    finally:server.server_close()
if __name__=='__main__':main()
