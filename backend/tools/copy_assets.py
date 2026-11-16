import argparse,hashlib,json,pathlib,shutil
def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False)
def read(p):return json.loads(p.read_text(encoding='utf-8'))
p=argparse.ArgumentParser();p.add_argument('--ledger',required=True);p.add_argument('--destination',required=True);p.add_argument('--capture',required=True);args=p.parse_args()
dest=pathlib.Path(args.destination).resolve();capture=pathlib.Path(args.capture).resolve()
reference=pathlib.Path(r'C:/Users/nsreegit22/PCUB V3-R1').resolve()
if dest.is_relative_to(reference) or dest.is_relative_to(capture) or reference.is_relative_to(dest) or capture.is_relative_to(dest):raise SystemExit('Unsafe asset destination')
manifest=read(capture/'capture_manifest.json');unsigned=dict(manifest);digest=unsigned.pop('fingerprint')
if digest!='368727191a5801c928aef6cff992ca16b9237c3ee920e9308c3f3987e039f0b6' or hashlib.sha256(canonical(unsigned).encode()).hexdigest()!=digest:raise SystemExit('Capture seal mismatch')
for e in manifest['files']:
    if hashlib.sha256((capture/e['path']).read_bytes()).hexdigest()!=e['sha256']:raise SystemExit('Capture changed: '+e['path'])
entries=read(pathlib.Path(args.ledger))['files']
for e in entries:
    source=pathlib.Path(e['source']);target=(dest/e['destination']).resolve()
    if not target.is_relative_to(dest):raise SystemExit('Destination traversal')
    if hashlib.sha256(source.read_bytes()).hexdigest()!=e['sha256']:raise SystemExit('Upstream changed: '+str(source))
    if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest()!=e['sha256']:raise SystemExit('Existing destination differs: '+str(target))
for e in entries:
    target=dest/e['destination'];target.parent.mkdir(parents=True,exist_ok=True)
    if not target.exists():shutil.copyfile(e['source'],target)
    if hashlib.sha256(target.read_bytes()).hexdigest()!=e['sha256']:raise SystemExit('Copy failed')
subset={'version':'demo_asset_subset_v1','capture_fingerprint':digest,'files':entries}
subset['fingerprint']=hashlib.sha256(canonical(subset).encode()).hexdigest()
path=dest/'subset_manifest.json';wire=canonical(subset)+'\n'
if path.exists() and path.read_text(encoding='utf-8')!=wire:raise SystemExit('Refusing to replace different subset manifest')
path.write_text(wire,encoding='utf-8')
print('Verified asset files:',len(entries))
