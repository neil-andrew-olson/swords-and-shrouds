import gzip,json,struct,zipfile,pathlib,base64
z=zipfile.ZipFile('/tmp/castle.zip');texture=z.read('Models/GLB format/Textures/colormap.png')
for name in ['rocks-large','wall-pillar','siege-ballista','tower-square-top-roof-high']:
 p=pathlib.Path('public/assets/'+name+'.glb.gz');b=gzip.decompress(p.read_bytes());length=struct.unpack_from('<I',b,12)[0];j=json.loads(b[20:20+length]);
 for image in j.get('images',[]):image['uri']='data:image/png;base64,'+base64.b64encode(texture).decode()
 data=json.dumps(j,separators=(',',':')).encode();data+=b' '*((-len(data))%4);rest=b[20+length:];result=struct.pack('<III',0x46546c67,2,20+len(data)+len(rest))+struct.pack('<II',len(data),0x4e4f534a)+data+rest;p.write_bytes(gzip.compress(result,mtime=0))
