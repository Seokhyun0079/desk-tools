const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const raw = fs.readFileSync(__dirname + '/../artwork-diagnostics.jsx');
assert.deepEqual([...raw.subarray(0,3)],[0xef,0xbb,0xbf]);
const source = raw.toString('utf8').replace(/^\uFEFF/,'').replace(/^#target.*$/gm,'');
const secret='CONFIDENTIAL_INTERNAL_NAME';
let sensitiveReads=0, elementReads=0, lengthReads=0, shows=0, updates=0;
const props=['pageItems','groupItems','compoundPathItems','pathItems','textFrames','placedItems','rasterItems','symbolItems','meshItems','pluginItems','graphItems','nonNativeItems','legacyTextItems'];
const doc={};
for(const prop of ['name','contents','note','file','fullName','geometricBounds','visibleBounds','imageData','layers','selection']) {
    Object.defineProperty(doc,prop,{get(){sensitiveReads++;throw Error(secret);}});
}
for(const prop of props) {
    const collection=new Proxy({}, {get(target,key){
        if(key==='length'){lengthReads++;return 1000000000;}
        elementReads++;throw Error('collection elements must never be read');
    }});
    Object.defineProperty(doc,prop,{configurable:true,get(){assert(shows>0,'window must show before document queries');return collection;}});
}
Object.defineProperty(doc,'meshItems',{get(){assert(shows>0);throw Error(secret);}});
const controls=[];
function control(type,text) {
    return {type,text,add(type,a,b){const c=control(type,b);controls.push(c);return c;},show(){shows++;},update(){updates++;},close(){}};
}
const globals={__greenOverlayDiagnostic:{schema:'overlay-counts-v1',state:'ready',counts:{Layer:1,TextFrame:3,PlacedItem:2,[secret]:99}}};
Object.defineProperty(globals,'__greenOverlayWindow',{get(){throw Error('must not traverse existing UI');}});
const app={documents:[doc],version:'29.0 '+secret};
Object.defineProperty(app,'activeDocument',{get(){assert(shows>0);return doc;}});
const context={app,$:{global:globals},Window:function(type,title){return control(type,title);}};
vm.runInNewContext(source,context);
let report=controls.find(c=>c.type==='edittext').text;
assert.equal(sensitiveReads,0);
assert.equal(elementReads,0,'even billion-element collections must not be enumerated');
assert.equal(lengthReads,12,'one length read per supported collection');
assert(report.includes('placedItems=1000000000'));
assert(report.includes('meshItems=unreadable'));
assert(report.includes('OverlaySnapshot=ready'));
assert(report.includes('PlacedItem=2'));
assert(!report.includes(secret));
assert.equal(shows,1);
assert(updates>=14);
assert(!/\b(?:BridgeTalk|File|Folder)\b/.test(source));
controls.length=0;
vm.runInNewContext(source,{...context,app:{documents:[]},$:{global:{}}});
report=controls.find(c=>c.type==='edittext').text;
assert(report.includes('No open document'));
console.log('Passed: constant collection reads, zero element/parent/UI traversal, window shown first, cached counts, private fields untouched, sanitized errors');
