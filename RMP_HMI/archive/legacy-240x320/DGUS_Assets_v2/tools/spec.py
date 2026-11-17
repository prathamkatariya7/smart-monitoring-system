# Single source of truth for the Borosil RMP DWIN HMI v2.0 (10 screens, 240x320)
# Used for: PIL backgrounds/icons, VP map, Figma drawing (JSON export).
import json

C = dict(
 bg='#0A1020', header='#0E1729', surface='#121B30', sunken='#0E1729', border='#273657', border2='#3A4A6E',
 tp='#F4F7FC', ts='#9DB0CF', tm='#8196BC',
 cyan='#00F0FF', blue='#38BDF8',
 green='#10B981', greenD='#059669', greenBg='#0A291D', greenHdr='#065F46',
 amber='#F59E0B', amberD='#D97706', amberDk='#B45309', amberBg='#3A2A0A',
 red='#EF4444', redD='#DC2626', redBg='#450A0A', redBg2='#1F1010', redLt='#FCA5A5', redLine='#7F1D1D', yellow='#FDE047', yellowLt='#FEF08A',
 indigo='#1D4ED8', royal='#2563EB', slate='#334155', slateTxt='#94A3B8', dark='#1A0F14',
)
W,H=240,320
CW={8:8,12:12,16:16,20:20}   # DGUS cell widths (cell height = 2x)

ICONS = {  # Lucide (ISC licence) inner SVG, 24x24 viewBox
 'check':'<path d="M20 6 9 17l-5-5"/>',
 'x':'<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
 'play':'<polygon points="6 3 20 12 6 21 6 3"/>',
 'arrow-left':'<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
 'hourglass':'<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>',
 'triangle-alert':'<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
 'clipboard-list':'<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
 'flame':'<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
 'volume-x':'<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/>',
 'flask':'<path d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2"/><path d="M8.5 2h7"/><path d="M7 16h10"/>',
 'circle-check':'<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
 'wifi':'<path d="M12 20h.01"/><path d="M2 8.82a15 15 0 0 1 20 0"/><path d="M5 12.859a10 10 0 0 1 14 0"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/>',
}

# ---- element builders ------------------------------------------------------
def R(x,y,w,h,fill=None,stroke=None,sw=1,r=0,dash=None,name=None): return dict(t='rect',x=x,y=y,w=w,h=h,fill=fill,stroke=stroke,sw=sw,r=r,dash=dash,name=name)
def T(x,y,w,s,sz,c,wt=600,f='P',al='l',ls=0,name=None,lh=None): return dict(t='text',x=x,y=y,w=w,s=s,sz=sz,c=c,wt=wt,f=f,al=al,ls=ls,name=name,lh=lh or round(sz*1.3))
def I(n,x,y,sz,c,sw=2): return dict(t='icon',n=n,x=x,y=y,sz=sz,c=c,sw=sw)
def SLOT(vp,name,x,y,chars,cell,al,c,sample,bytes_,wt=500,writer='ESP32',rate='on change',note=''):
    return dict(t='slot',vp=vp,name=name,x=x,y=y,w=chars*CW[cell],h=cell*2,chars=chars,cell=cell,al=al,c=c,sample=sample,bytes=bytes_,wt=wt,writer=writer,rate=rate,note=note)
def ISLOT(vp,name,x,y,lib,sample,values,rate='on change'): return dict(t='islot',vp=vp,name=name,x=x,y=y,lib=lib,sample=sample,values=values,rate=rate)
def PSLOT(vp,name,x,y,w,h,val,fill,track,r=2,rate='on change'): return dict(t='pslot',vp=vp,name=name,x=x,y=y,w=w,h=h,val=val,fill=fill,track=track,r=r,rate=rate)
def TOUCH(vp,val,name,x,y,w,h,key): return dict(t='touch',vp=vp,val=val,name=name,x=x,y=y,w=w,h=h,key=key)

# ---- icon libraries (images shown by icon variables) -----------------------
def pill(txt,fill,fg,w,h,dot=None):
    els=[R(0,0,w,h,fill=fill,r=h//2)]
    if dot: els.append(R(8,h//2-3,6,6,fill=dot,r=3)); tx=18
    else: tx=0
    els.append(T(tx,(h-12)//2,w-tx,txt,9,fg,700,'P','c' if not dot else 'c',lh=12))
    return els
LIBS = {
 33:dict(name='conn_pill',w=56,h=18,states=['0 ONLINE','1 OFFLINE'],imgs=[
     [R(0,0,56,18,fill=C['greenD'],r=9),R(8,6,6,6,fill='#FFFFFF',r=3),T(16,3,38,'ONLINE',8,'#FFFFFF',700,al='c',lh=12)],
     [R(0,0,56,18,fill=C['redD'],r=9),R(8,6,6,6,fill='#FFFFFF',r=3),T(16,3,38,'OFFLINE',8,'#FFFFFF',700,al='c',lh=12)]]),
 34:dict(name='quality_pill',w=52,h=18,states=['0 GOOD','1 SUSPECT','2 BAD'],imgs=[
     [R(0,0,52,18,fill=C['greenD'],r=9),T(0,3,52,'GOOD',9,'#FFFFFF',700,al='c',lh=12)],
     [R(0,0,52,18,fill=C['amberD'],r=9),T(0,3,52,'SUSPECT',8,'#FFFFFF',700,al='c',lh=12)],
     [R(0,0,52,18,fill=C['redD'],r=9),T(0,3,52,'BAD',9,'#FFFFFF',700,al='c',lh=12)]]),
 35:dict(name='status_dot',w=9,h=9,states=['0 good','1 suspect','2 bad','3 off'],imgs=[
     [R(0,0,9,9,fill=C['green'],r=5)],[R(0,0,9,9,fill=C['amber'],r=5)],[R(0,0,9,9,fill=C['red'],r=5)],[R(0,0,9,9,fill=C['tm'],r=5)]]),
 36:dict(name='alarm_header',w=240,h=40,states=['0 bright','1 dim'],imgs=[
     [R(0,0,240,40,fill=C['redD']),I('triangle-alert',14,10,20,'#FFFFFF'),T(40,9,170,'CRITICAL SAFETY ALARM',13,'#FFFFFF',800,al='l',lh=20),I('flame',210,10,20,'#FDE047')],
     [R(0,0,240,40,fill='#7F1D1D'),I('triangle-alert',14,10,20,'#FCA5A5'),T(40,9,170,'CRITICAL SAFETY ALARM',13,'#FCA5A5',800,al='l',lh=20),I('flame',210,10,20,'#FCA5A5')]]),
 37:dict(name='mute_button',w=216,h=48,states=['0 SILENCE','1 SILENCED'],imgs=[
     [R(0,0,216,48,fill=C['amberD'],r=6),I('volume-x',22,14,20,'#FFFFFF'),T(48,12,160,'SILENCE HARDWARE SIREN',12,'#FFFFFF',700,lh=24)],
     [R(0,0,216,48,fill=C['slate'],r=6),I('volume-x',22,14,20,C['slateTxt']),T(48,12,160,'SIREN SILENCED',12,C['slateTxt'],700,lh=24)]]),
 38:dict(name='run_footer_hint',w=200,h=16,states=['0 hint','1 silenced'],imgs=[
     [T(0,1,200,'Short-press Select to mute alerts',8,C['tm'],500,lh=14)],
     [R(0,0,200,16,fill=C['amberBg'],stroke=C['amber'],r=8),I('volume-x',8,2,12,C['amber'],2),T(24,1,172,'SIREN SILENCED - monitoring on',8,C['amber'],700,lh=14)]]),
 39:dict(name='audit_state',w=204,h=16,states=['0 saving','1 stored'],imgs=[
     [I('hourglass',0,1,12,C['amber']),T(18,1,186,'Saving to server...',9,C['amber'],600,lh=14)],
     [I('circle-check',0,1,12,C['green']),T(18,1,186,'Signed & stored (TimescaleDB)',9,C['green'],600,lh=14)]]),
}

# ---- screens ---------------------------------------------------------------
def header(title,fill=None,h=34,tc='#FFFFFF',sz=12,x=12,al='l',w=None,icon=None):
    els=[R(0,0,W,h,fill=fill or C['header']),R(0,h-1,W,1,fill=C['border'])]
    if icon: els.append(I(icon[0],icon[1],(h-icon[2])//2,icon[2],icon[3]))
    if title: els.append(T(x,(h-18)//2,w or (W-2*x),title,sz,tc,700,al=al,lh=18,name='title'))
    return els
def card(x,y,w,h,fill=None,stroke=None,sw=1,r=8,dash=None): return R(x,y,w,h,fill=fill or C['surface'],stroke=stroke or C['border'],sw=sw,r=r,dash=dash,name='card')
def btn(x,y,w,h,fill,label,fg,icon=None,sz=13,stroke=None,sw=1):
    els=[R(x,y,w,h,fill=fill,stroke=stroke,sw=sw,r=6,name='button')]
    tw=len(label)*sz*0.62; ix=x+(w-tw-(22 if icon else 0))/2
    if icon: els.append(I(icon,round(ix),y+(h-16)//2,16,fg,2.5)); ix+=22
    els.append(T(round(ix),y+(h-20)//2,round(tw)+8,label,sz,fg,700,lh=20))
    return els

S={}
# 0 BOOT -------------------------------------------------------------------
S[0]=dict(file='00_boot',doc_page='0x0000',title='Boot / POST',els=[
 R(0,0,W,H,fill=C['bg']),
 T(0,50,W,'BOROSIL',34,C['blue'],800,al='c',ls=1,lh=42,name='logo placeholder - replace with company logo PNG'),
 T(0,92,W,'Scientific',16,C['cyan'],400,al='c',ls=5,lh=22,name='logo placeholder sub'),
 T(0,141,W,'BOROSIL RMP',18,C['tp'],800,al='c',ls=1,lh=26),
 T(0,168,W,'Reactor Monitoring Platform',10,C['ts'],500,al='c',lh=16),
 R(20,210,200,60,fill=C['surface'],stroke=C['border'],r=4,name='post box'),
 T(28,218,184,'MAX31865 RTD ... OK',9,C['green'],500,'J',lh=14),
 T(28,232,184,'RS232 Motor .... OK',9,C['green'],500,'J',lh=14),
 T(28,246,184,'Crypto / NVS ... OK',9,C['green'],500,'J',lh=14),
 PSLOT(0x1306,'boot_progress',20,285,200,6,65,C['cyan'],C['border']),
 SLOT(0x1060,'fw_version',20,300,16,8,'l',C['tm'],'FW v0.1.0-p4',16,rate='once at boot'),
])
# 1 IDLE -------------------------------------------------------------------
S[1]=dict(file='01_idle',doc_page='0x0001',title='Idle Standby',els=[
 R(0,0,W,H,fill=C['bg']),*header(None),
 I('flask',10,9,16,C['blue']),
 SLOT(0x2000,'reactor_title',32,9,16,8,'l',C['tp'],'Reactor 25',24,wt=700),
 ISLOT(0x2018,'conn_pill',172,8,33,0,'0 ONLINE,1 OFFLINE'),
 SLOT(0x2020,'lab_name',12,40,15,8,'l',C['ts'],'QC Lab 1',20),
 SLOT(0x2040,'clock',188,40,5,8,'r',C['ts'],'14:32',10,rate='every 1 s'),
 card(10,58,220,86),
 T(22,66,150,'STANDBY VESSEL TEMP',10,C['tm'],600,lh=14),
 ISLOT(0x1300,'temp_quality_dot',208,69,35,0,'0 good,1 suspect,2 bad,3 off'),
 SLOT(0x1100,'temp_value',22,82,5,20,'r',C['cyan'],'24.8',8,wt=700,rate='1 Hz'),
 T(126,98,40,'°C',16,C['blue'],500,lh=22),
 SLOT(0x1110,'temp_raw',22,126,15,8,'l',C['tm'],'Raw 24.9 C',16,rate='1 Hz'),
 SLOT(0x1120,'cal_tag',154,126,8,8,'r',C['tm'],'Cal v1',10),
 card(10,152,220,64,r=8),
 R(120,160,1,48,fill=C['border']),
 T(20,158,90,'STIRRER',9,C['ts'],600,lh=12),
 SLOT(0x1130,'rpm_value',20,176,4,12,'l',C['tp'],'0',8,wt=700,rate='1 Hz'),
 T(72,186,36,'RPM',10,C['tm'],500,lh=14),
 T(126,158,90,'TORQUE',9,C['ts'],600,lh=12),
 SLOT(0x1140,'torque_value',126,176,5,12,'l',C['tp'],'0.0',8,wt=700,rate='1 Hz'),
 T(190,186,36,'N·cm',10,C['tm'],500,lh=14),
 R(10,226,220,82,fill=C['sunken'],stroke=C['border2'],sw=1.5,r=6,dash=[5,4],name='standby box'),
 I('hourglass',108,234,24,C['amber'],2),
 T(10,262,220,'WAITING FOR ASSIGNMENT',11,C['amber'],700,al='c',lh=16),
 T(10,279,220,'Assign via Lab Incharge Web Portal',9,C['tm'],500,al='c',lh=14),
 T(10,293,220,'Hold Menu 3s for Network Info',8,C['tm'],500,al='c',lh=12),
])
# 2 SOFTAP -----------------------------------------------------------------
S[2]=dict(file='02_prov',doc_page='0x0002',title='SoftAP Wi-Fi Provisioning',els=[
 R(0,0,W,H,fill=C['bg']),
 R(0,0,W,34,fill=C['amberDk']),I('wifi',12,9,16,'#FFFFFF'),
 T(0,8,W,'NETWORK SETUP REQUIRED',11,'#FFFFFF',700,al='c',lh=18),
 R(56,42,128,128,fill='#FFFFFF',r=8,name='qr card'),
 dict(t='qr',x=70,y=56,m=4,data='http://192.168.4.1'),
 card(10,178,220,85,r=6),
 T(22,186,200,'1. Connect phone to Wi-Fi:',10,C['ts'],500,lh=14),
 T(22,201,200,'Borosil-RMP-Setup',12,C['cyan'],700,'J',lh=18),
 T(22,226,200,'2. Open browser to:',10,C['ts'],500,lh=14),
 T(22,241,200,'http://192.168.4.1',12,'#FFFFFF',700,'J',lh=18),
 T(0,288,W,'Listening for credentials...',9,C['amber'],500,al='c',lh=14),
])
# 3 UNBOUND ----------------------------------------------------------------
S[3]=dict(file='03_unbound',doc_page='0x0003',title='Unclaimed / Unbound Device',els=[
 R(0,0,W,H,fill=C['bg']),
 R(0,0,W,34,fill=C['slate']),
 T(0,8,W,'DEVICE NOT BOUND',12,'#FFFFFF',700,al='c',lh=18),
 R(20,46,200,50,fill=C['amberBg'],stroke=C['amber'],r=8,name='warning badge'),
 I('triangle-alert',28,52,14,C['amber']),
 T(46,51,170,'TELEMETRY NOT RECORDED',10,C['amber'],700,lh=14),
 T(28,67,186,'Device is online but has no',8,C['ts'],500,lh=12),
 T(28,79,186,'reactor assignment.',8,C['ts'],500,lh=12),
 card(10,105,220,122,fill=C['surface'],stroke=C['border2'],r=6),
 T(18,113,200,'HARDWARE IDENTIFIER (UUID)',8,C['tm'],600,lh=12),
 SLOT(0x2050,'device_uuid',18,130,24,8,'l',C['cyan'],'01a1af2d...6bc7',36,wt=700,rate='once'),
 T(18,158,36,'MAC',9,C['tm'],600,'J',lh=14),
 SLOT(0x3280,'mac_address',50,156,17,8,'l',C['ts'],'E8:F6:0A:E3:90:FB',18,rate='once'),
 T(18,178,36,'IP',9,C['tm'],600,'J',lh=14),
 SLOT(0x3210,'ip_address',50,176,16,8,'l',C['ts'],'172.16.50.162',16,rate='on change'),
 T(18,198,36,'MQTT',9,C['tm'],600,'J',lh=14),
 SLOT(0x3220,'mqtt_broker',54,196,19,8,'l',C['ts'],'172.16.50.138:18883',24,rate='on change'),
 T(14,238,212,'Log into Web Admin > Devices >',9,C['ts'],500,al='c',lh=14),
 T(14,252,212,'Claim & Bind this device to a',9,C['ts'],500,al='c',lh=14),
 T(14,266,212,'Reactor vessel.',9,C['ts'],500,al='c',lh=14),
])
# 4 ASSIGNMENT -------------------------------------------------------------
S[4]=dict(file='04_assignment',doc_page='0x0010',title='Analyst Process Assignment',els=[
 R(0,0,W,H,fill=C['bg']),
 R(0,0,W,36,fill=C['indigo']),I('clipboard-list',12,10,16,'#FFFFFF'),
 T(36,9,190,'PROCESS ASSIGNMENT',13,'#FFFFFF',700,lh=18),
 R(10,46,220,92,fill=C['surface'],stroke=C['blue'],sw=1.5,r=8,name='analyst card'),
 T(18,54,200,'ASSIGNED ANALYST',9,C['blue'],600,lh=12),
 SLOT(0x3000,'analyst_name',18,70,17,12,'l',C['tp'],'Deepa Nair',30,wt=700,rate='on assignment'),
 SLOT(0x3070,'scope_tag',18,110,25,8,'l',C['ts'],'QC Lab 1 | Reactor 25',24,rate='on assignment'),
 R(10,144,220,46,fill=C['sunken'],r=4,name='process summary'),
 SLOT(0x3020,'process_name',18,148,25,8,'l',C['tp'],'Synthesis Batch B-42',30,wt=700,rate='on assignment'),
 T(18,170,204,'Physically inspect vessel readiness.',9,C['ts'],500,lh=14),
 *btn(12,198,216,44,C['greenD'],'ACCEPT ASSIGNMENT','#FFFFFF','check',13),
 *btn(12,250,216,38,C['dark'],'REJECT ASSIGNMENT',C['red'],'x',12,stroke=C['red'],sw=1.5),
 T(0,300,W,'UP = Accept     DOWN = Reject',8,C['tm'],500,al='c',lh=12),
 TOUCH(0x3010,0,'accept',12,198,216,44,'BTN_UP'),TOUCH(0x3010,1,'reject',12,250,216,38,'BTN_DOWN'),
])
# 5 PRE-START --------------------------------------------------------------
S[5]=dict(file='05_prestart',doc_page='0x0011',title='Pre-Start Checklist & Limits',els=[
 R(0,0,W,H,fill=C['bg']),*header('PRE-START CHECKLIST'),
 R(160,8,68,18,fill=C['greenBg'],stroke=C['green'],r=9),T(160,10,68,'ACCEPTED',9,C['green'],700,al='c',lh=14),
 card(10,42,220,108,r=8),
 SLOT(0x3020,'process_name',18,50,25,8,'l',C['blue'],'Synthesis Batch B-42',30,wt=700,rate='on assignment'),
 R(18,72,204,1,fill=C['border']),
 T(18,80,110,'Max Allowed Temp:',10,C['ts'],500,lh=16),
 SLOT(0x3080,'max_temp',116,80,8,8,'r',C['tp'],'85.0',8,rate='on assignment'),T(184,80,40,'°C',10,C['tm'],500,lh=16),
 T(18,98,110,'Max Allowed Speed:',10,C['ts'],500,lh=16),
 SLOT(0x3090,'max_speed',116,98,8,8,'r',C['tp'],'600',8,rate='on assignment'),T(184,98,40,'RPM',10,C['tm'],500,lh=16),
 T(18,116,110,'Max Rate of Rise:',10,C['ts'],500,lh=16),
 SLOT(0x30A0,'max_roc',116,116,8,8,'r',C['amber'],'+5.0',8,rate='on assignment'),T(184,116,44,'°C/min',10,C['tm'],500,lh=16),
 R(10,156,220,40,fill=C['sunken'],r=4,name='attestation'),
 I('check',18,163,11,C['green'],3),T(34,162,190,'RTD probe submerged in reactant',9,C['ts'],500,lh=14),
 I('check',18,177,11,C['green'],3),T(34,176,190,'Motor impeller clear of vessel wall',9,C['ts'],500,lh=14),
 *btn(12,204,216,44,C['royal'],'START PROCESS','#FFFFFF','play',14),
 *btn(12,256,216,36,C['slate'],'CANCEL / RETURN',C['slateTxt'],None,11),
 T(0,300,W,'UP = Start     DOWN = Cancel',8,C['tm'],500,al='c',lh=12),
 TOUCH(0x3030,0,'start',12,204,216,44,'BTN_UP'),TOUCH(0x3030,1,'cancel',12,256,216,36,'BTN_DOWN'),
])
# 6 RUNNING ----------------------------------------------------------------
S[6]=dict(file='06_running',doc_page='0x0012',title='Live Running Dashboard',els=[
 R(0,0,W,H,fill=C['bg']),*header(None,h=32),
 SLOT(0x2000,'reactor_title',10,8,14,8,'l',C['tp'],'Deepa N. R-25',24,wt=700),
 ISLOT(0x2018,'conn_pill',132,7,33,0,'0 ONLINE,1 OFFLINE'),
 SLOT(0x2040,'clock',190,8,5,8,'r',C['ts'],'14:32',10,rate='every 1 s'),
 card(8,36,224,112,fill=C['sunken'],r=8),
 T(18,44,150,'REACTION TEMPERATURE',10,C['ts'],600,lh=14),
 ISLOT(0x1301,'temp_quality_pill',172,43,34,0,'0 GOOD,1 SUSPECT,2 BAD'),
 SLOT(0x1100,'temp_value',18,66,5,20,'r',C['cyan'],'35.2',8,wt=700,rate='1 Hz'),
 T(122,80,32,'°C',18,C['blue'],500,lh=24),
 SLOT(0x11B0,'trend_rate',148,86,6,8,'r',C['green'],'+0.4',10,wt=700,rate='1 Hz'),T(198,88,30,'°C/min',8,C['green'],500,lh=12),
 R(18,118,204,1,fill=C['border']),
 SLOT(0x1110,'temp_raw',18,124,15,8,'l',C['tm'],'Raw 35.6 C',16,rate='1 Hz'),
 SLOT(0x1120,'cal_tag',158,124,8,8,'r',C['tm'],'Cal v1.0',10),
 card(8,152,110,76,r=6),T(16,158,90,'STIRRER',9,C['ts'],600,lh=12),
 SLOT(0x1130,'rpm_value',16,174,4,12,'l',C['tp'],'350',8,wt=700,rate='1 Hz'),T(68,184,36,'RPM',10,C['tm'],500,lh=14),
 SLOT(0x1150,'rpm_set',16,206,8,8,'l',C['tm'],'Set: 350',10,rate='on change'),
 card(122,152,110,76,r=6),T(130,158,90,'TORQUE',9,C['ts'],600,lh=12),
 SLOT(0x1140,'torque_value',130,174,5,12,'l',C['tp'],'12.4',8,wt=700,rate='1 Hz'),T(194,184,34,'N·cm',10,C['tm'],500,lh=14),
 PSLOT(0x1305,'torque_load_bar',130,208,90,4,60,C['cyan'],C['border']),
 card(8,232,224,82,r=6),
 I('circle-check',16,240,16,C['green']),T(38,241,70,'RUNNING',11,C['green'],700,lh=16),
 SLOT(0x11D0,'batch_tag',108,242,12,8,'l',C['green'],'BATCH B-42',12,wt=700),
 T(16,262,56,'Duration:',9,C['ts'],500,lh=14),SLOT(0x11C0,'duration',68,260,8,8,'l',C['tp'],'01:24:10',10,rate='every 1 s'),
 T(142,262,44,'Faults:',9,C['ts'],500,lh=14),SLOT(0x1160,'fault_code',186,260,4,8,'l',C['tp'],'0',6,rate='on change'),
 ISLOT(0x1307,'run_footer',16,288,38,0,'0 hint,1 silenced'),
])
# 7 ALARM ------------------------------------------------------------------
S[7]=dict(file='07_alarm',doc_page='0x0013',title='Critical Safety Alarm',els=[
 R(0,0,W,H,fill=C['bg']),
 ISLOT(0x1308,'alarm_header_flash',0,0,36,0,'0 bright,1 dim',rate='toggle 1 Hz while alarm active'),
 R(8,46,224,110,fill=C['redBg'],stroke=C['red'],sw=2,r=8,name='diagnosis card'),
 SLOT(0x1180,'alarm_param',16,54,26,8,'l',C['yellow'],'PARAMETER: THERMAL RUNAWAY',32,wt=700,rate='on alarm'),
 SLOT(0x1170,'alarm_rate',16,72,6,16,'r',C['tp'],'+15.2',16,wt=800,rate='1 Hz'),T(116,84,100,'°C/min',12,C['tp'],700,lh=18),
 T(16,108,70,'Safety Limit:',9,C['redLt'],700,lh=14),SLOT(0x11A0,'alarm_limit',86,106,6,8,'r',C['redLt'],'+5.0',8,wt=700,rate='on alarm'),T(136,108,90,'°C/min Exceeded!',9,C['redLt'],700,lh=14),
 T(16,128,100,'Vessel Temperature:',9,C['tp'],500,lh=14),SLOT(0x1190,'alarm_temp',120,126,6,8,'r',C['tp'],'86.2',8,wt=700,rate='1 Hz'),T(172,128,30,'°C',9,C['tp'],500,lh=14),
 R(8,162,224,80,fill=C['redBg2'],stroke=C['redLine'],r=6,name='actions card'),
 T(16,168,208,'1. Cut heating mantle power immediately.',9,C['tp'],500,lh=14),
 T(16,184,208,'2. Verify condenser cooling water flow.',9,C['tp'],500,lh=14),
 T(16,200,208,'3. Inspect stirrer rotation clearance.',9,C['tp'],500,lh=14),
 T(16,220,208,'Server & Lab Incharge alerted automatically.',9,C['yellowLt'],600,lh=14),
 ISLOT(0x1309,'mute_button',12,248,37,0,'0 SILENCE,1 SILENCED'),
 T(0,304,W,'Visual alarm remains active until condition clears',8,C['redLt'],500,al='c',lh=12),
 TOUCH(0x3040,1,'silence siren',12,248,216,48,'BTN_SELECT / BTN_MENU'),
])
# 8 COMPLETED --------------------------------------------------------------
S[8]=dict(file='08_complete',doc_page='0x0014',title='Process Completion & Handover',els=[
 R(0,0,W,H,fill=C['bg']),
 R(0,0,W,36,fill=C['greenHdr']),I('circle-check',12,10,16,'#FFFFFF'),
 T(0,9,W,'BATCH COMPLETED',12,'#FFFFFF',700,al='c',lh=18),
 card(10,46,220,125,r=8),
 SLOT(0x3020,'process_name',18,56,25,8,'l',C['cyan'],'Synthesis Batch B-42',30,wt=700),
 T(18,84,90,'Total Duration:',10,C['tp'],500,lh=16),SLOT(0x3100,'total_duration',112,84,8,8,'r',C['tp'],'02:45:18',10,rate='once'),
 T(18,104,90,'Final Temp:',10,C['ts'],500,lh=16),SLOT(0x3110,'final_temp',112,104,8,8,'r',C['ts'],'24.2',8,rate='once'),T(180,104,30,'°C',10,C['ts'],500,lh=16),
 T(18,124,100,'Samples Logged:',10,C['ts'],500,lh=16),SLOT(0x3120,'samples_logged',112,124,8,8,'r',C['ts'],'9,918',10,rate='once'),
 ISLOT(0x130A,'audit_state',18,148,39,1,'0 saving,1 stored'),
 *btn(12,210,216,48,C['greenD'],'RELEASE VESSEL TO IDLE','#FFFFFF','check',13),
 T(0,268,W,'UP / SELECT = Release',8,C['tm'],500,al='c',lh=12),
 TOUCH(0x3050,1,'release',12,210,216,48,'BTN_UP / BTN_SELECT'),
])
# 9 DIAGNOSTICS ------------------------------------------------------------
rows=[('SSID',0x3200,'ssid',16,'BSL_PUNE',16),('IP',0x3210,'ip_address',16,'172.16.50.162',16),('MQTT',0x3220,'mqtt_broker',19,'172.16.50.138:18883',24),
      ('mTLS',0x3230,'mtls_status',19,'CONNECTED (TLSv1.2)',24),('NTP',0x3240,'ntp_status',19,'LOCKED (+/-2 ms)',20),('RTD',0x3250,'rtd_status',19,'ACTIVE (430.0 Rref)',20),
      ('RS232',0x3260,'rs232_status',19,'HEIDOLPH (9600 8N1)',20),('FLASH',0x3270,'flash_status',19,'Ring 16MB (3% used)',24),('MAC',0x3280,'mac_address',19,'E8:F6:0A:E3:90:FB',18)]
dels=[R(0,0,W,H,fill=C['bg']),*header('SYSTEM DIAGNOSTICS',w=210),I('flask',212,9,16,C['blue']),
      R(10,40,220,225,fill=C['surface'],stroke=C['border'],r=6,name='metrics')]
for i,(lab,vp,nm,ch,smp,by) in enumerate(rows):
    y=48+i*24
    dels+= [ISLOT(0x1310+i,'dot_'+nm,18,y+4,35,0 if i!=8 else 0,'0 good,1 suspect,2 bad,3 off'),
            T(32,y+3,40,lab,9,C['tm'],600,'J',lh=14),
            SLOT(vp,nm,70,y,ch,8,'r',C['tp'],smp,by,rate='on change')]
dels+= btn(12,272,216,38,C['slate'],'RETURN TO MONITORING','#FFFFFF','arrow-left',12)
dels+= [TOUCH(0x3060,1,'return',12,272,216,38,'BTN_MENU short / BTN_DOWN')]
S[9]=dict(file='09_diagnostics',doc_page='0x0020',title='Hardware & Network Diagnostics',els=dels)

if __name__=='__main__':
    json.dump(dict(C=C,ICONS=ICONS,LIBS={str(k):v for k,v in LIBS.items()},S={str(k):v for k,v in S.items()}),open('/home/claude/build/spec.json','w'))
    print('ok',len(S))
