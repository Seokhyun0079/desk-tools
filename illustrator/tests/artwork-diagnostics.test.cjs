const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const raw = fs.readFileSync(__dirname + '/../artwork-diagnostics.jsx');
assert.deepEqual([...raw.subarray(0,3)],[0xef,0xbb,0xbf]);
const source = raw.toString('utf8').replace(/^\uFEFF/,'').replace(/^#target.*$/gm,'');
let sensitiveReads = 0, shows = 0;
const secret = 'CONFIDENTIAL_INTERNAL_NAME';
function guard(item) {
    for (const prop of ['name','contents','note','file','fullName','geometricBounds','visibleBounds','imageData']) {
        Object.defineProperty(item,prop,{get(){sensitiveReads++;throw Error(secret);}});
    }
    return item;
}
const text = guard({typename:'TextFrame',uuid:'private-text-id'});
const image = guard({typename:'PlacedItem',uuid:'private-image-id'});
const raster = guard({typename:'RasterItem',uuid:'private-raster-id'});
const unknown = guard({typename:secret});
const layer = guard({typename:'Layer',layers:[],pageItems:[text,image,unknown],placedItems:[image],rasterItems:[raster]});
text.parent=layer; image.parent=layer; unknown.parent=layer;
Object.defineProperty(raster,'parent',{get(){throw Error(secret);}});
const doc = guard({typename:'Document',layers:[layer],pageItems:[text,image,unknown],placedItems:[image],rasterItems:[raster],groupItems:[],compoundPathItems:[]});
Object.defineProperty(doc,'meshItems',{get(){throw Error(secret);}});
const targetTree = {type:'treeview',items:[{_entry:{ref:layer},items:[{_entry:{ref:text}},{_entry:{descendantToggle:true,parentEntry:{ref:layer}}}]}]};
const destTree = {type:'treeview',items:[{_destinationIndex:0}]};
const controls=[];
function control(type,text) {
    const c={type,text,add(type,a,b){const child=control(type,b);controls.push(child);return child;},show(){shows++;}};
    return c;
}
const context={app:{documents:[doc],activeDocument:doc,version:'29.0 '+secret},
    $:{global:{__greenOverlayWindow:{type:'palette',children:[destTree,{type:'group',children:[targetTree]}]}}},
    Window:function(type,title){return control(type,title);}};
vm.runInNewContext(source,context);
let report=controls.find(c=>c.type==='edittext').text;
assert.equal(sensitiveReads,0,'diagnostics never reads document names, text, image data, filenames or coordinates');
assert(!report.includes(secret));
assert(!report.includes('private-image-id'));
assert(!report.includes('private-text-id'));
assert(report.includes('Illustrator=29.0\n'));
assert(report.includes('placedItems=1'));
assert(report.includes('rasterItems=1'));
assert(report.includes('meshItems=unreadable'));
assert(report.includes('LOADED TARGET TREE: Layer=1 TextFrame=1'));
assert(report.includes('PlacedItem: accepted=2 rejected=0 unreadable=0 parentTypes=Layer=2'));
assert(report.includes('RasterItem: accepted=0 rejected=0 unreadable=1'));
assert(report.includes('Unknown=1'));
assert.equal(shows,1);
assert(!/\b(?:BridgeTalk|File|Folder)\b/.test(source),'no network messages or filesystem operations');
controls.length=0;
vm.runInNewContext(source,{...context,app:{documents:[]},$:{global:{}}});
report=controls.find(c=>c.type==='edittext').text;
assert(report.includes('No open document'));
console.log('Passed: private fields untouched, fixed-type counts, loaded-tree comparison, parent filter counts, sanitized failures, no writes or network');
