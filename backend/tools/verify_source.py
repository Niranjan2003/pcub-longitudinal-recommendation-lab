import ast,hashlib,json,pathlib,sys
root=pathlib.Path(__file__).resolve().parents[1]
ledger=json.loads((root/'implementation_ledger.json').read_text(encoding='utf-8'))
for e in ledger['files']:
    p=root/e['path']
    if not p.is_file():raise SystemExit('Missing source: '+e['path'])
    if hashlib.sha256(p.read_bytes()).hexdigest()!=e['sha256']:raise SystemExit('Pasted source differs: '+e['path'])
    if p.suffix=='.py':ast.parse(p.read_text(encoding='utf-8'))
for p in (root/'src').rglob('*.py'):
    t=ast.parse(p.read_text(encoding='utf-8'))
    for node in ast.walk(t):
        if isinstance(node,ast.ImportFrom) and node.module and node.module.startswith('crs_sim'):raise SystemExit('Historical import: '+str(p))
        if isinstance(node,ast.Import) and any(a.name.startswith('crs_sim') for a in node.names):raise SystemExit('Historical import: '+str(p))
print('Documented file hashes and Python syntax verified')
