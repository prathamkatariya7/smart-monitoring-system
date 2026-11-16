import csv, json, os, shutil
import spec as SP, render as RN
O='/home/claude/out/DGUS_Assets_v2'
DOC={0x2000:'0x2000',0x2018:'(new) was text 0x2010',0x2020:'0x2020',0x2040:'0x2040',0x2050:'0x2050',0x1100:'0x1004 (overlap)',0x1110:'0x1006 (overlap)',0x1120:'0x100A (overlap)',0x1130:'0x1014 (overlap)',0x1140:'0x1016 (overlap)',0x1160:'0x1020',0x1180:'0x1030',0x3000:'0x3000',0x3010:'0x3010',0x3020:'0x3020',0x3030:'0x3030',0x3040:'0x3040',0x3050:'0x3050',0x1301:'(new) was text 0x1008'}
rows={}; order=[]
def words(e):
    return e['bytes']//2 if e['t']=='slot' else 1
for pid,P in SP.S.items():
    for e in P['els']:
        if e['t'] not in('slot','islot','pslot','touch'): continue
        if e['t']=='touch': key=(e['vp'],e['val'])
        else: key=(e['vp'],None)
        r=dict(e,page=pid,pname=P['title'])
        if e['t']!='touch' and e['vp'] in rows: rows[e['vp']]['pages'].append(pid); continue
        if e['t']=='touch' and key in rows: continue
        r['pages']=[pid]; rows[key[0] if e['t']!='touch' else key]=r
# overlap check (word addresses)
spans=[]
for k,r in rows.items():
    vp=r['vp']; spans.append((vp,vp+words(r)-1,r['name']))
spans.sort(); bad=[]
for a,b in zip(spans,spans[1:]):
    if a[1]>=b[0] and not(a[0]==b[0]): bad.append((a,b))
# touch vars share a VP across values -> collapse
print('VP overlaps:',bad or 'none')
# CSV
os.makedirs(O,exist_ok=True)
with open(f'{O}/VP_map.csv','w',newline='') as f:
    w=csv.writer(f); w.writerow(['vp_hex','name','widget','pages','x','y','w','h','bytes','cell','align','color','max_chars','icon_lib','values_or_notes','writer','rate','doc_v2.0_vp'])
    for k,r in sorted(rows.items(),key=lambda kv:(kv[1]['vp'],str(kv[1].get('val')))):
        vp=r['vp']; t=r['t']
        wd={'slot':'Text Display','islot':'Icon Display (variable icon)','pslot':'Progress Bar Display','touch':'Touch: Return Key Code'}[t]
        pages=','.join(str(p) for p in r['pages'])
        if t=='slot': row=[f'0x{vp:04X}',r['name'],wd,pages,r['x'],r['y'],r['w'],r['h'],r['bytes'],f"{r['cell']}x{r['cell']*2}",r['al'],r['c'],r['chars'],'',r['sample'],'ESP32->DWIN',r['rate'],DOC.get(vp,'(new)')]
        elif t=='islot':
            L=SP.LIBS[r['lib']]; row=[f'0x{vp:04X}',r['name'],wd,pages,r['x'],r['y'],L['w'],L['h'],2,'','','','',r['lib'],r['values'],'ESP32->DWIN',r['rate'],DOC.get(vp,'(new)')]
        elif t=='pslot': row=[f'0x{vp:04X}',r['name'],wd,pages,r['x'],r['y'],r['w'],r['h'],2,'','',r['fill'],'','','0..100 (%)','ESP32->DWIN',r['rate'],'(new)']
        else: row=[f'0x{vp:04X}',f"{r['name']} (value 0x{r['val']:04X})",wd,pages,r['x'],r['y'],r['w'],r['h'],2,'','','','','',f"{r['key']} equivalent",'DWIN->ESP32','on press',DOC.get(vp,'(new)')]
        w.writerow(row)
print('rows',len(rows))
# serial test frames
def fr(addr,payload): b=bytes([0x82,addr>>8,addr&255])+payload; return ' '.join(f'{x:02X}' for x in bytes([0x5A,0xA5,len(b)])+b)
lines=['# Serial test frames - hex mode, 115200 8N1. Replace nothing; paste as-is into SSCOM/Realterm.','# Text writes end with FF FF (enable "end marker 0xFFFF" on every Text Display).','']
pn={0:0,1:1,2:2,3:3,4:4,5:5,6:6,7:7,8:8,9:9}
for pid,P in SP.S.items():
    lines.append(f'## Page {pid} - {P["title"]}  (firmware constant: doc page {P["doc_page"]})')
    lines.append('Go to page    : '+fr(0x0084,bytes([0x5A,0x01,0,pid])))
    seen=set()
    for e in P['els']:
        if e['t']=='slot' and e['vp'] not in seen:
            seen.add(e['vp']); s=e['sample'].encode('ascii'); assert len(s)<=e['bytes']
            lines.append(f'{e["name"]:<18}: '+fr(e['vp'],s+(b'\xff\xff' if len(s)<e['bytes'] else b'')))
        elif e['t']=='islot' and e['vp'] not in seen:
            seen.add(e['vp']); lines.append(f'{e["name"]:<18}: '+fr(e['vp'],bytes([0,e['sample']]))+f'   (values {e["values"]})')
        elif e['t']=='pslot' and e['vp'] not in seen:
            seen.add(e['vp']); lines.append(f'{e["name"]:<18}: '+fr(e['vp'],bytes([0,e['val']])))
    lines.append('')
lines+=['## Read current page : 5A A5 04 83 00 14 01   -> reply 5A A5 06 83 00 14 01 <page_hi> <page_lo>',
'## Touch/return-key frames the ESP32 must parse (DWIN -> ESP32):',
'accept   : 5A A5 06 83 30 10 01 00 00','reject   : 5A A5 06 83 30 10 01 00 01','start    : 5A A5 06 83 30 30 01 00 00','cancel   : 5A A5 06 83 30 30 01 00 01',
'silence  : 5A A5 06 83 30 40 01 00 01','release  : 5A A5 06 83 30 50 01 00 01','return   : 5A A5 06 83 30 60 01 00 01','',
'## Write ACK from display (if enabled): 5A A5 03 82 4F 4B']
open(f'{O}/05_serial_test_frames.txt','w').write('\n'.join(lines))
# compact print for Figma handoff
out=[]
for k,r in sorted(rows.items(),key=lambda kv:(kv[1]['vp'],str(kv[1].get('val')))):
    t=r['t']; vp=r['vp']; pg=','.join(map(str,r['pages']))
    typ={'slot':'Text','islot':'Icon','pslot':'Bar','touch':'Touch'}[t]
    ln={'slot':lambda:f"{r['bytes']}B {r['cell']}x{r['cell']*2}",'islot':lambda:f"ICL{r['lib']}",'pslot':lambda:'0-100','touch':lambda:f"={r['val']}"}[t]()
    out.append([f'0x{vp:04X}',r['name'],typ,ln,pg])
json.dump(out,open('/home/claude/build/vprows.json','w'))
print(json.dumps(out,separators=(',',':')))
