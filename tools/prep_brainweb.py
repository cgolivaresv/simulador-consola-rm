"""Genera brainweb.gz.txt desde el fantoma BrainWeb 3D (0,5 mm) incluido en KomaMRI.jl.

Uso: guardar brain3D.mat de KomaMRI (KomaMRIBase/src/datatypes/phantom/) como bw/lab.npy
     (scipy.io.loadmat(...)['data'].astype(uint8)) y ejecutar este script.
Salida: etiquetas a 1 mm en orden [z][y][x] (x→izquierda, y→posterior, z→cabeza), uint8:
        bits 0-5 tejido (0 aire, 1 hueso, 2 grasa, 3 LCR, 4 SG, 5 SB, 7 músculo/piel, 10 vasos),
        bit 6 lesión de EM, bit 7 infarto agudo ACM izquierda. Comprimido con gzip y en base64.
"""
import numpy as np, gzip, json
from scipy import ndimage as nd
a=np.load('bw/lab.npy')                       # axis0 A->P, axis1 R->L, axis2 F->H, 0.5 mm
# majority-ish downsample to 1 mm: take mode over 2x2x2 blocks
s=a[:a.shape[0]//2*2,:a.shape[1]//2*2,:a.shape[2]//2*2]
blk=s.reshape(s.shape[0]//2,2,s.shape[1]//2,2,s.shape[2]//2,2).transpose(0,2,4,1,3,5).reshape(s.shape[0]//2,s.shape[1]//2,s.shape[2]//2,8)
vals=np.array([0,23,46,70,93,116,139,162,185,209,232,255])
cnt=np.stack([(blk==v).sum(-1) for v in vals],-1)
v=vals[cnt.argmax(-1)]
mp={0:0,23:3,46:4,70:5,93:2,116:7,139:7,162:1,185:10,209:2,232:7,255:2}
lab=np.zeros(v.shape,np.uint8)
for k,t in mp.items(): lab[v==k]=t
lab=lab.transpose(2,0,1).copy()                # -> [z][y][x], y = posterior+, x = left+
NZ,NY,NX=lab.shape
br=np.argwhere(np.isin(lab,[4,5]))
cz=br[:,0].min()+ (br[:,0].max()-br[:,0].min())*0.47   # put ventricles/AC near z≈+10
cy=(br[:,1].min()+br[:,1].max())/2; cx=(br[:,2].min()+br[:,2].max())/2
Z,Y,X=np.meshgrid(np.arange(NZ)-cz+10,np.arange(NY)-cy,np.arange(NX)-cx,indexing='ij')
wm=lab==5
# --- MS: periventricular ovoids (Dawson fingers), juxtacortical, infratentorial ---
vent=(lab==3)&(np.abs(X)<25)&(np.abs(Y)<45)&(Z>0)&(Z<40)
vent=nd.binary_opening(vent,iterations=1)
dv=nd.distance_transform_edt(~vent)
rng=np.random.default_rng(7)
ms=np.zeros_like(wm)
cand=np.argwhere(wm&(dv>1.5)&(dv<5)&(Z>2)&(Z<42))
for c in cand[rng.choice(len(cand),16,replace=False)]:
    r=np.array([rng.uniform(4.5,7),rng.uniform(3,4.5),rng.uniform(2.8,4)])  # ovoid, long axis F-H
    ms|=(((Z-Z[tuple(c)])/r[0])**2+((Y-Y[tuple(c)])/r[1])**2+((X-X[tuple(c)])/r[2])**2)<=1
gm=lab==4
dg=nd.distance_transform_edt(~gm)
cand=np.argwhere(wm&(dg<2)&(Z>5)&(Z<50))
for c in cand[rng.choice(len(cand),4,replace=False)]:
    ms|=(((Z-Z[tuple(c)])/3.2)**2+((Y-Y[tuple(c)])/3.2)**2+((X-X[tuple(c)])/3.2)**2)<=1
cand=np.argwhere(wm&(Z<-15)&(Z>-35)&(np.abs(X)<12)&(Y>-5)&(Y<25))
for c in cand[rng.choice(len(cand),2,replace=False)]:
    ms|=(((Z-Z[tuple(c)])/3.5)**2+((Y-Y[tuple(c)])/3.5)**2+((X-X[tuple(c)])/3.5)**2)<=1
ms&=wm
# --- acute infarct: left MCA territory (patient left = x>0) ---
th=np.arctan2(Y,X)
brain=nd.binary_fill_holes(nd.binary_closing(np.isin(lab,[3,4,5,10]),iterations=3))
depth=nd.distance_transform_edt(brain)
noise=nd.gaussian_filter(rng.standard_normal(lab.shape),6);noise/=noise.std()
st=np.isin(lab,[4,5])&(X>4)&(th>-0.95+0.18*noise)&(th<0.6+0.18*noise)&(depth<26+5*noise)&(Z>-10+4*noise)&(Z<40+5*noise)
st=nd.binary_opening(st,iterations=1)&np.isin(lab,[4,5])
ll,nn=nd.label(st);sizes=nd.sum(st,ll,range(1,nn+1));st=ll==(1+int(np.argmax(sizes)))
out=lab.copy(); out[ms]|=64; out[st]|=128
raw=out.tobytes()
import base64
open('brainweb.gz.txt','w').write(base64.b64encode(gzip.compress(raw,9)).decode())
meta={'nx':NX,'ny':NY,'nz':NZ,'ox':float(-cx),'oy':float(-cy),'oz':float(-cz+10),'d':1}
print(json.dumps(meta),'ms vox',int(ms.sum()),'stroke vox',int(st.sum()),'size',len(gzip.compress(raw,9)))
