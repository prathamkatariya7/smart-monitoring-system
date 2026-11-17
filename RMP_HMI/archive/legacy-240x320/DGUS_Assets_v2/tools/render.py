import os, io, csv, math, json, shutil
from PIL import Image, ImageDraw, ImageFont
import cairosvg, segno
import spec as SP
C=SP.C; S_=4
FD='/home/claude/fonts/ttf/'
FM={('P',400):'Poppins-Regular',('P',500):'Poppins-Medium',('P',600):'Poppins-SemiBold',('P',700):'Poppins-Bold',('P',800):'Poppins-ExtraBold',
    ('J',400):'JBM-Regular',('J',500):'JBM-Medium',('J',600):'JBM-Bold',('J',700):'JBM-Bold',('J',800):'JBM-ExtraBold'}
_fc={}
def font(f,wt,px):
    k=(f,wt,round(px*S_*4)); 
    if k not in _fc: _fc[k]=ImageFont.truetype(FD+FM[(f,wt)]+'.ttf',px*S_)
    return _fc[k]
def rgb(h): h=h.lstrip('#'); return tuple(int(h[i:i+2],16) for i in (0,2,4))
LIB_BG={33:C['header'],34:C['sunken'],35:C['surface'],36:C['bg'],37:C['bg'],38:C['surface'],39:C['surface']}
ISSUES=[]

def text_w(s,f,wt,sz,ls=0):
    fo=font(f,wt,sz); return (fo.getlength(s)+ls*S_*max(len(s)-1,0))/S_
def draw_text(d,x,y,w,s,sz,c,wt,f,al,ls,lh,issue_name=None):
    fo=font(f,wt,sz); asc,desc=fo.getmetrics(); tw=text_w(s,f,wt,sz,ls)
    if issue_name and tw>w+1.0: ISSUES.append(f'OVERFLOW {issue_name}: "{s}" width {tw:.0f} > box {w}')
    if al=='c': x0=x+(w-tw)/2
    elif al=='r': x0=x+w-tw
    else: x0=x
    base=(y+(lh-(asc+desc)/S_)/2)*S_+asc
    if ls==0: d.text((x0*S_,base),s,font=fo,fill=rgb(c),anchor='ls')
    else:
        cx=x0*S_
        for ch in s:
            d.text((cx,base),ch,font=fo,fill=rgb(c),anchor='ls'); cx+=fo.getlength(ch)+ls*S_
def draw_icon(img,n,x,y,sz,c,sw=2):
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="{sz}" height="{sz}" viewBox="0 0 24 24" fill="none" stroke="{c}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round">{SP.ICONS[n]}</svg>'
    png=cairosvg.svg2png(bytestring=svg.encode(),output_width=int(sz*S_),output_height=int(sz*S_))
    ic=Image.open(io.BytesIO(png)).convert('RGBA'); img.paste(ic,(int(round(x*S_)),int(round(y*S_))),ic)
def rr_path(x,y,w,h,r,n=16):
    pts=[];r=min(r,w/2,h/2)
    for cx,cy,a0 in ((x+w-r,y+r,-90),(x+w-r,y+h-r,0),(x+r,y+h-r,90),(x+r,y+r,180)):
        for i in range(n+1):
            a=math.radians(a0+90*i/n); pts.append((cx+r*math.cos(a),cy+r*math.sin(a)))
    pts.append(pts[0]); return pts
def draw_rect(d,e):
    x,y,w,h,r=e['x'],e['y'],e['w'],e['h'],e['r']
    box=[x*S_,y*S_,(x+w)*S_-1,(y+h)*S_-1]
    if e.get('fill'): d.rounded_rectangle(box,radius=r*S_,fill=rgb(e['fill']))
    if e.get('stroke'):
        sw=e.get('sw',1)
        if e.get('dash'):
            pts=[(px*S_,py*S_) for px,py in rr_path(x+sw/2,y+sw/2,w-sw,h-sw,r)]
            on,off=e['dash'][0]*S_,e['dash'][1]*S_; acc=0; draw=True
            for (x1,y1),(x2,y2) in zip(pts,pts[1:]):
                L=math.hypot(x2-x1,y2-y1); pos=0
                while pos<L:
                    seg=min((on if draw else off)-acc,L-pos)
                    if draw: d.line([(x1+(x2-x1)*pos/L,y1+(y2-y1)*pos/L),(x1+(x2-x1)*(pos+seg)/L,y1+(y2-y1)*(pos+seg)/L)],fill=rgb(e['stroke']),width=int(sw*S_))
                    pos+=seg; acc+=seg
                    if acc>=(on if draw else off)-1e-6: draw=not draw; acc=0
        else: d.rounded_rectangle(box,radius=r*S_,outline=rgb(e['stroke']),width=int(sw*S_))
def draw_els(img,els,ox=0,oy=0,mode='static',path=None,name=''):
    d=ImageDraw.Draw(img)
    for e in els:
        t=e['t']
        if t=='rect':
            e2=dict(e,x=e['x']+ox,y=e['y']+oy); draw_rect(d,e2)
        elif t=='text':
            draw_text(d,e['x']+ox,e['y']+oy,e['w'],e['s'],e['sz'],e['c'],e['wt'],e['f'],e['al'],e['ls'],e['lh'],issue_name=f'{name}:{e["s"][:20]}')
        elif t=='icon': draw_icon(img,e['n'],e['x']+ox,e['y']+oy,e['sz'],e['c'],e['sw'])
        elif t=='qr':
            q=segno.make(e['data'],error='m',boost_error=False); m=q.matrix
            assert len(m)==25,len(m)
            for j,row in enumerate(m):
                for i,v in enumerate(row):
                    if v: d.rectangle([(e['x']+ox+i*e['m'])*S_,(e['y']+oy+j*e['m'])*S_,(e['x']+ox+(i+1)*e['m'])*S_-1,(e['y']+oy+(j+1)*e['m'])*S_-1],fill=(0,0,0))
        elif mode in ('preview','map') and t in ('slot','islot','pslot','touch'):
            pass
    return img
def lib_img(lib,idx,bg=True):
    L=SP.LIBS[lib]; img=Image.new('RGB',(L['w']*S_,L['h']*S_),rgb(LIB_BG[lib]))
    draw_els(img,L['imgs'][idx],0,0,name=f'lib{lib}/{idx}')
    return img.resize((L['w'],L['h']),Image.LANCZOS)
def sample_slot(img,e):
    d=ImageDraw.Draw(img); cw=e['cell']; px=cw/0.6
    fo=font('J',e['wt'] if e['wt'] in (400,500,700,800) else 700,px)
    s=e['sample']
    if len(s)>e['chars']: ISSUES.append(f'SAMPLE TOO LONG {e["name"]}: {s}')
    if len(s)>e['bytes']: ISSUES.append(f'SAMPLE>BYTES {e["name"]}')
    n=len(s)*cw; x0=e['x'] if e['al']=='l' else (e['x']+e['w']-n if e['al']=='r' else e['x']+(e['w']-n)/2)
    asc,desc=fo.getmetrics(); base=(e['y']+(e['h']-(asc+desc)/S_)/2)*S_+asc
    for i,ch in enumerate(s):   # monospaced cells like DGUS
        d.text(((x0+i*cw+cw/2)*S_,base),ch,font=fo,fill=rgb(e['c']),anchor='ms')
def render_page(pid,mode='static'):
    P=SP.S[pid]; img=Image.new('RGB',(SP.W*S_,SP.H*S_),rgb(C['bg']))
    draw_els(img,[e for e in P['els'] if e['t'] in('rect','text','icon','qr')],name=f'P{pid}')
    if mode=='static':
        return img.resize((SP.W,SP.H),Image.LANCZOS)
    for e in P['els']:
        if e['t']=='slot' and mode=='preview': sample_slot(img,e)
        if e['t']=='islot' and mode=='preview':
            li=lib_img(e['lib'],e['sample']).resize((SP.LIBS[e['lib']]['w']*S_,SP.LIBS[e['lib']]['h']*S_)); img.paste(li,(e['x']*S_,e['y']*S_))
        if e['t']=='pslot' and mode=='preview':
            d=ImageDraw.Draw(img); d.rounded_rectangle([e['x']*S_,e['y']*S_,(e['x']+e['w'])*S_,(e['y']+e['h'])*S_],radius=e['r']*S_,fill=rgb(e['track']))
            d.rounded_rectangle([e['x']*S_,e['y']*S_,(e['x']+e['w']*e['val']/100)*S_,(e['y']+e['h'])*S_],radius=e['r']*S_,fill=rgb(e['fill']))
    out=img.resize((SP.W,SP.H),Image.LANCZOS)
    if mode=='map':
        d=ImageDraw.Draw(out,'RGBA')
        for e in P['els']:
            if e['t']=='slot': col=(255,0,200)
            elif e['t']=='islot':
                L=SP.LIBS[e['lib']]; e=dict(e,w=L['w'],h=L['h']); col=(255,160,0)
            elif e['t']=='pslot': col=(0,220,255)
            elif e['t']=='touch': col=(80,255,80)
            else: continue
            d.rectangle([e['x'],e['y'],e['x']+e['w']-1,e['y']+e['h']-1],outline=col+(255,),fill=col+(40,))
    return out

if __name__=='__main__':
    O='/home/claude/out/DGUS_Assets_v2'; shutil.rmtree(O,ignore_errors=True)
    for dname in ['01_backgrounds_bmp','01_backgrounds_png','01_backgrounds_named','02_icon_libraries','03_placement_map','04_preview_with_sample_values']: os.makedirs(f'{O}/{dname}')
    for pid in SP.S:
        im=render_page(pid,'static'); im.save(f'{O}/01_backgrounds_bmp/{pid}.bmp'); im.save(f'{O}/01_backgrounds_png/{pid}.png'); im.save(f'{O}/01_backgrounds_named/{SP.S[pid]["file"]}.bmp')
        render_page(pid,'map').resize((480,640),Image.NEAREST).save(f'{O}/03_placement_map/MAP_{pid}_{SP.S[pid]["file"]}.png')
        render_page(pid,'preview').save(f'{O}/04_preview_with_sample_values/PREVIEW_{pid}_{SP.S[pid]["file"]}.png')
    for lib,L in SP.LIBS.items():
        dd=f'{O}/02_icon_libraries/{lib}_{L["name"]}_{L["w"]}x{L["h"]}'; os.makedirs(dd)
        for i in range(len(L['imgs'])):
            im=lib_img(lib,i); im.save(f'{dd}/{i}.bmp'); im.save(f'{dd}/{i}.png')
    print('\n'.join(ISSUES) or 'no layout issues')
