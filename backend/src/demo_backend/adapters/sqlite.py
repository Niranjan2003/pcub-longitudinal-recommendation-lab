import json, sqlite3, hashlib
from pathlib import Path
from demo_backend.domain.service import ServiceError

def encode(value):return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)
class _Connection(sqlite3.Connection):
    def __exit__(self,*args):
        try:return super().__exit__(*args)
        finally:self.close()
class Store:
    def __init__(self,path):
        self.path=Path(path);self.path.parent.mkdir(parents=True,exist_ok=True)
        with self.connect() as db:
            db.executescript('CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS requests(scope TEXT NOT NULL,key TEXT NOT NULL,digest TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(scope,key));')
    def connect(self):
        db=sqlite3.connect(self.path,timeout=30,isolation_level=None,factory=_Connection)
        db.execute('PRAGMA journal_mode=WAL');db.execute('PRAGMA synchronous=FULL')
        return db
    def get(self,table,key,db=None):
        if table not in ('sessions','jobs'):raise ValueError('Invalid table')
        if db is None:
            with self.connect() as conn:return self.get(table,key,conn)
        row=db.execute('SELECT body FROM '+table+' WHERE id=?',(key,)).fetchone()
        if row is None:raise ServiceError('NOT_FOUND',404)
        return json.loads(row[0])
    def put(self,db,table,key,value):
        if table not in ('sessions','jobs'):raise ValueError('Invalid table')
        db.execute('INSERT INTO '+table+' VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body',(key,encode(value)))
    def atomic(self,scope,key,payload,operation):
        if not key or len(key)>128:raise ServiceError('IDEMPOTENCY_KEY_REQUIRED',400)
        digest=hashlib.sha256(encode(payload).encode()).hexdigest()
        db=self.connect()
        try:
            db.execute('BEGIN IMMEDIATE')
            old=db.execute('SELECT digest,response FROM requests WHERE scope=? AND key=?',(scope,key)).fetchone()
            if old:
                if old[0]!=digest:raise ServiceError('IDEMPOTENCY_CONFLICT')
                db.commit();return json.loads(old[1])
            result=operation(db)
            db.execute('INSERT INTO requests VALUES(?,?,?,?)',(scope,key,digest,encode(result)))
            db.commit();return result
        except BaseException:
            db.rollback();raise
        finally:db.close()
