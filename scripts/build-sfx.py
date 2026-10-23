#!/usr/bin/env python3
"""Rebuild the curated CC0 SFX sprite. Requires Python 3 + ffmpeg, no runtime dependency.
Usage: python3 scripts/build-sfx.py /path/to/extracted/packs
Each pack directory must contain Audio/ and License.txt. See audio/sfx/README.md.
"""
import array, hashlib, json, math, pathlib, subprocess, sys, wave
ROOT = pathlib.Path(__file__).resolve().parent.parent
PACKS = pathlib.Path(sys.argv[1])
RATE = 22050
sources = {}
def raw(pack, name, limit=.4, rate=1):
    file = PACKS / pack / 'Audio' / (name + '.ogg')
    data = array.array('h', subprocess.check_output(['ffmpeg','-v','error','-i',str(file),'-ac','1','-ar',str(RATE),'-f','s16le','-']))
    if sys.byteorder != 'little': data.byteswap()
    samples = [v/32768 for v in data]
    peak = max(map(abs,samples)) or 1
    edges = [i for i,v in enumerate(samples) if abs(v) > peak * .004]
    if edges: samples = samples[max(0,edges[0]-44):edges[-1]+45]
    samples = [samples[min(len(samples)-1,int(i*rate))] for i in range(min(int(limit*RATE),int(len(samples)/rate)))]
    sources[pack+'/'+name+'.ogg'] = hashlib.sha256(file.read_bytes()).hexdigest()
    return samples

def layer(*parts):
    result = [0.] * max(int(delay*RATE)+len(sound) for sound,delay,gain in parts)
    for sound,delay,gain in parts:
        offset=int(delay*RATE)
        for i,v in enumerate(sound): result[offset+i] += v*gain
    return result

def r(pack,name,limit=.3,rate=1): return raw(pack,name,limit,rate)
clicks = [r('interface',f'click_00{i}',.09) for i in [1,2,3]]
slide=r('casino','card-slide-1',.14)
flip=r('casino','card-place-3',.13)
fan=r('casino','card-fan-1',.18)
glass=r('impact','impactGlass_light_000',.14)
wood=r('impact','impactWood_light_000',.12)
punch=r('impact','impactPunch_medium_000',.2)
whoosh=r('rpg','knifeSlice2',.18)
bell=r('impact','impactBell_heavy_000',.55)
def chime(rates,spacing=.07,tail=.2):
    return layer(*[(r('impact','impactGlass_light_000',tail,rate),i*spacing,.65) for i,rate in enumerate(rates)])
clips={
    **{f'select{i}': (s,-20) for i,s in enumerate(clicks)},
    'open':(layer((fan,0,1),(wood,.02,.25)),-20),
    'close':(r('casino','card-shove-1',.17),-20),
    'pickup':(slide,-21),
    'summon':(layer((r('rpg','bookPlace1',.25),0,1),(wood,.03,.3)),-18),
    'summonScifi':(layer((r('scifi','forceField_000',.29,1.3),0,.6),(flip,0,.6)),-17),
    'artifact':(layer((r('rpg','metalClick',.18),0,.8),(glass,.03,.6)),-18),
    'spell':(layer((whoosh,0,.7),(chime([1.25,1.5],.045,.13),.04,.4)),-17),
    'landTap':(r('casino','chip-lay-1',.1),-18),
    'turnStart':(layer((fan,0,.8),(glass,.05,.3)),-19),
    'attack':(layer((whoosh,0,.65),(punch,.08,1)),-18),
    'block':(layer((r('impact','impactMetal_medium_000',.25),0,.8),(wood,0,.8)),-16),
    'damageTaken':(r('impact','impactPunch_heavy_000',.26),-15),
    'damageDealt':(punch,-16),
    'heal':(chime([1,1.25,1.5],.045,.18),-20),
    'destroy':(r('impact','impactPlank_medium_000',.3,.9),-17),
    'packRip':(r('casino','cards-pack-open-1',.34,1.5),-21),
    'reveal':(flip,-21),
    'revealRare':(layer((flip,0,.7),(chime([1,1.25,1.5],.065,.24),.04,.65)),-18),
    'revealEpic':(layer((fan,0,.7),(chime([1,1.25,1.5,2],.08,.28),.04,.65)),-17),
    'revealLegendary':(layer((fan,0,.7),(chime([1,1.25,1.5,2,2.5],.1,.35),.04,.65),(bell,.25,.15)),-19),
    'achievement':(layer((r('rpg','handleCoins',.38),0,.7),(chime([1,1.25,1.5,2],.09,.3),.05,.7)),-20),
    'victory':(layer(*[(r('impact','impactBell_heavy_000',.65,rate),i*.13,.6) for i,rate in enumerate([1,1.25,1.5,2])]),-17),
    'defeat':(layer((r('impact','impactMetal_heavy_000',.6,.75),0,.7),(r('rpg','cloth3',.3,.8),.3,.6)),-20),
    'deny':(layer((wood,0,.9),(wood,.08,.6)),-21)
}
frames=array.array('h'); manifest={}
for name,(samples,db) in clips.items():
    count=len(samples)
    for i in range(count):
        fade=min(1,i/min(44,max(1,count//8)),(count-1-i)/min(220,max(1,count//5)))
        samples[i]*=max(0,fade)
    scale=10**(db/20)/(max(map(abs,samples)) or 1)
    samples=[v*scale for v in samples]
    manifest[name]=[len(frames),count]
    frames.extend(round(max(-1,min(1,v))*32767) for v in samples)
    frames.extend([0]*int(RATE*.035))
out=ROOT/'audio/sfx';out.mkdir(parents=True,exist_ok=True)
with wave.open(str(out/'sfx-bank.wav'),'wb') as w:
    w.setparams((1,2,RATE,0,'NONE','not compressed'));w.writeframes(frames.tobytes())
for pack in ['interface','casino','rpg','impact','scifi']:
    (out/'licenses').mkdir(exist_ok=True)
    (out/'licenses'/(pack+'.txt')).write_bytes((PACKS/pack/'License.txt').read_bytes())
provenance={'creator':'Kenney / Kenney.nl','license':'CC0-1.0','sampleRate':RATE,'clips':manifest,'sources':sources,
    'bankSha256':hashlib.sha256((out/'sfx-bank.wav').read_bytes()).hexdigest()}
(out/'manifest.json').write_text(json.dumps(provenance,indent=2)+'\n')
p=ROOT/'feedback.js';s=p.read_text();start=s.index('    // BEGIN SAMPLE MANIFEST');end=s.index('    // END SAMPLE MANIFEST',start)
s=s[:start]+'    // BEGIN SAMPLE MANIFEST (generated by scripts/build-sfx.py)\n    const SAMPLE_RATE = '+str(RATE)+';\n    const SAMPLE_CLIPS = '+json.dumps(manifest,separators=(',',':'))+';\n'+s[end:];p.write_text(s)
print(f'{len(clips)} clips, {len(frames)/RATE:.2f}s, {(out/"sfx-bank.wav").stat().st_size:,} bytes')
