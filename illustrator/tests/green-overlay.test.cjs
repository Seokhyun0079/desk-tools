const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const raw = fs.readFileSync(__dirname + '/../green-overlay.jsx');
assert.equal(raw[0], 0xEF);
assert.equal(raw[1], 0xBB);
assert.equal(raw[2], 0xBF, 'JSX must stay UTF-8 with BOM so Illustrator can read it');
const source = require('./load-script.cjs').loadScript(__dirname + '/../green-overlay.jsx');
let reads = 0, boundsReads = 0, z = 0, shown = false, readsAtShow = null, windowLayouts = 0;
function container(type, children) {
    const item = {typename:type, name:type, absoluteZOrderPosition:++z, layers:[], pathItems:{rectangle(){throw Error('locked destination');}}};
    children.forEach(child=>child.parent=item);
    Object.defineProperty(item,'pageItems',{get(){reads++;return children;}});
    return item;
}
const leaves = Array.from({length:1000},()=>({typename:'PathItem',name:'path',absoluteZOrderPosition:++z,visibleBounds:[0,10,10,0],geometricBounds:[0,10,10,0]}));
for (const leaf of leaves) Object.defineProperty(leaf,'visibleBounds',{get(){boundsReads++;return [0,10,10,0];}});
const nested=container('GroupItem',leaves);
const group=container('GroupItem',[nested]);
const layer=container('Layer',[group]);
const doc={typename:'Document',layers:[layer],views:[{zoom:1}],pageItems:leaves,pathItems:leaves,activeLayer:layer,selection:[]};
doc.pathItems.rectangle = () => { throw Error('locked destination'); };
const controls=[], logs=[], alerts=[], bodies=[], pending=[], messages=[];
function control(type,text) {
    const c={type,text,items:[],selection:null,layout:{resize(){},layout(){}},
        add(type,a,b){if(this.expanded===false) this.addedWhileCollapsed=true; const child=control(type,b===undefined?a:b);child.index=this.items.length;this.items.push(child);return child;},
        removeAll(){this.items=[];},show(){shown=true; readsAtShow=reads;},update(){},close(){},hide(){}};
    controls.push(c);return c;
}
function File(){this.fsName='/mock/log';this.parent={exists:true};this.open=()=>true;this.writeln=s=>logs.push(s);this.close=()=>{};}
const context={app:{documents:[doc],activeDocument:doc,coordinateSystem:0,redraw(){}},CoordinateSystem:{DOCUMENTCOORDINATESYSTEM:1},
    Folder:{userData:{fsName:'/mock'}},File,$:{global:{}},Window:function(){
        const w=control('window');
        const layout=w.layout.layout.bind(w.layout);
        w.layout.layout=function(){windowLayouts++; return layout();};
        return w;
    },
    RGBColor:function(){}, ElementPlacement:{PLACEATBEGINNING:1},ZOrderMethod:{BRINGTOFRONT:1},
    alert:s=>alerts.push(s),confirm:()=>true,
    BridgeTalk:function(){this.send=()=>{bodies.push(this.body);messages.push(this); if(this.body==="'ok';") pending.push(this); return true;};}};
vm.runInNewContext(source,context);
assert(shown,'window must show before work');
assert.equal(readsAtShow,0,'window shows before page item scans');
assert.equal(pending.length,0,'hierarchy load must not wait on BridgeTalk');
assert(!bodies.some(body=>body.includes('__greenOverlayLoadStep')||body.includes('#targetengine')));
assert.equal(reads,3,'one scan per container, no leaf scans');
assert.equal(boundsReads,0,'startup does not measure artwork bounds');
assert(windowLayouts>=2,'tree is laid out again after items exist');
const trees=controls.filter(c=>c.type==='treeview');
assert.equal(trees.length,2,'both lists use native arrows');
const tree=trees[0], list=trees[1];
const layerNode=list.items[0], groupNode=layerNode.items.find(row=>row._entry.ref===group), nestedNode=groupNode.items.find(row=>row._entry.ref===nested);
assert.equal(layerNode.type,'node');
assert.equal(groupNode.type,'node');
assert.equal(nestedNode.items.length,1001);
assert(!controls.some(c=>c.addedWhileCollapsed),'children added to a collapsed node stay invisible');
assert.equal(layerNode.expanded,false);
assert.equal(tree.items[0].expanded,false);
function clickRow(row){list.selection=row;list.onChange();}
layerNode.expanded=true;
clickRow(layerNode);
assert.equal(layerNode.expanded,true,'selection callback must not reverse native expansion');
controls.find(c=>c.text==='全選択').onClick();
assert(leaves.every(item=>item.selected));
clickRow(layerNode.items[0]);
assert(leaves.every(item=>!item.selected));
clickRow(layerNode.items[0]);
assert(leaves.every(item=>item.selected));
assert(nestedNode.items[1].text.includes('☑'));
clickRow(nestedNode.items[1]);
assert(!nestedNode.items[1]._entry.ref.selected);
clickRow(nestedNode.items[1]);
assert(nestedNode.items[1]._entry.ref.selected,'same leaf can be toggled again');
assert.equal(reads,3,'UI interactions reuse model');
const edits=controls.filter(c=>c.type==='edittext');
assert.deepEqual(edits.map(c=>c.text),['0','255','0','100'],'preserve RGB and opacity');
edits[0].text='12';edits[1].text='34';edits[2].text='56';edits[3].text='78';
tree.selection=tree.items[0];tree.onChange();
controls.find(c=>c.text==='確認 / 実行').onClick();
const execute=bodies.at(-1);
assert(execute.includes('color.red=12;color.green=34;color.blue=56;'));
assert(execute.includes('overlayOpacity=78'));
new vm.Script(execute); // validate serialized BridgeTalk code
vm.runInNewContext(execute,context);
assert(logs.some(line=>line.includes('execute.create')&&line.includes('locked destination')),'host failures persist');
assert(logs.some(line=>line.includes('execute.complete')));
assert(logs.some(line=>line.includes('startup.ready')));
const diagnostic=context.$.global.__greenOverlayDiagnostic;
assert.equal(diagnostic.schema,'overlay-counts-v1');
assert.equal(diagnostic.state,'ready');
assert.equal(diagnostic.counts.PathItem,1000);
assert.equal(diagnostic.counts.GroupItem,2);
assert.equal(diagnostic.counts.Layer,1);
assert.deepEqual(Object.keys(diagnostic).sort(),['counts','schema','state']);
assert(Object.values(diagnostic.counts).every(n=>typeof n==='number'));
assert(alerts.at(-1).includes('1000件は作成できませんでした。'));
controls.find(c=>c.text==='全解除').onClick();
assert(controls.some(c=>c.text==='0件選択'));
console.log('Passed: native trees, single container scan, native disclosure isolation, subtree and repeated leaf toggles, settings and host failure logs');

// The first document handle cannot list layers. The open document still fills both trees.
let activeHits = 0;
const broken = {typename:'Document', name:'broken', views:[{zoom:1}], get layers(){ throw new Error('This is not a document'); }};
const flakyApp = Object.create(context.app);
Object.defineProperty(flakyApp, 'activeDocument', {
    get() { activeHits += 1; return activeHits === 1 ? broken : doc; }
});
const readsBefore = reads, alertsBefore = alerts.length;
const context2 = {...context, $:{global:{}}, app: flakyApp};
vm.runInNewContext(source, context2);
assert.equal(alerts.length, alertsBefore);
assert.equal(reads, readsBefore + 3);
const recovered = controls.filter(c => c.type === 'treeview').at(-1);
assert.equal(recovered.enabled, true);
assert(recovered.items[0].items.length > 1);
assert(logs.some(line => line.includes('children.layers') && line.includes('not a document')));
assert(logs.some(line => line.includes('startup.document') && line.includes('rebound')));
assert(logs.some(line => line.includes('roots=1')));
console.log('Passed: unreadable document handle rebinds and shows layers');

function art(type, name, extra) {
    const item = Object.assign({typename:type, name:name, absoluteZOrderPosition:++z}, extra||{});
    return item;
}
const clipPath = art('PathItem', '<Clip>', {clipping:true});
const clippedArt = art('PathItem', 'inside');
const mesh = art('MeshItem', 'mesh');
const plain = art('PathItem', 'plain');
function withKids(item, kids, extraCols) {
    kids.forEach(child => { child.parent = item; });
    Object.defineProperty(item, 'pageItems', {get(){ return kids; }});
    Object.assign(item, extraCols||{});
    return item;
}
const clipGroup = withKids(art('GroupItem', 'clips', {clipped:true, layers:[]}), [clippedArt], {
    pathItems:[clipPath], meshItems:[], pluginItems:[], graphItems:[], nonNativeItems:[], legacyTextItems:[]
});
clipPath.parent = clipGroup;
const hostLayer = withKids(art('Layer', 'Host', {layers:[]}), [clipGroup, plain], {
    pathItems:[clipPath, clippedArt, plain], meshItems:[mesh], pluginItems:[], graphItems:[], nonNativeItems:[], legacyTextItems:[]
});
mesh.parent = hostLayer;
const docMissing = {typename:'Document', name:'missing-types', layers:[hostLayer], views:[{zoom:1}], pageItems:[], pathItems:{rectangle(){throw Error('x');}}, selection:[], activeLayer:hostLayer};
const contextMissing = {...context, $:{global:{}}, app:{...context.app, documents:[docMissing], activeDocument:docMissing}};
vm.runInNewContext(source, contextMissing);
const missingList = controls.filter(c => c.type==='treeview').at(-1);
function entriesOf(node) {
    return (node.items||[]).map(child => child._entry).filter(Boolean);
}
const hostNode = missingList.items[0];
const hostEntries = entriesOf(hostNode).filter(entry => !entry.descendantToggle && !entry.layerTarget);
assert(hostEntries.some(entry => entry.ref === mesh), 'mesh outside pageItems is listed');
assert(!hostEntries.some(entry => entry.ref === clipPath), 'clipping path stays inside its group');
const groupNodeMissing = hostEntries.find(entry => entry.ref === clipGroup).ui;
const groupEntries = entriesOf(groupNodeMissing).filter(entry => !entry.descendantToggle && !entry.layerTarget);
assert(groupEntries.some(entry => entry.ref === clippedArt));
assert(groupEntries.some(entry => entry.ref === clipPath), 'clipping path omitted by pageItems is listed');
assert(!controls.some(c => c.addedWhileCollapsed));
console.log('Passed: clipping paths and meshes missing from pageItems are shown');

// Mixed containers must supplement every artwork collection, even when pageItems
// already exposes text. Duplicate references must remain a single tree entry.
const textOnly = art('TextFrame', 'text');
const linked = art('PlacedItem', '', {file:{name:'linked.png'}});
const embedded = art('RasterItem', 'embedded');
const symbol = art('SymbolItem', 'symbol');
const extraGroup = withKids(art('GroupItem', 'extra-group', {layers:[]}), [], {});
const compoundChild = art('PathItem', 'compound-child');
const compound = art('CompoundPathItem', 'compound', {pathItems:[compoundChild]});
compoundChild.parent = compound;
const mixedArt = [linked, embedded, symbol, extraGroup, compound,
    art('PathItem','path'), art('MeshItem','mesh'), art('PluginItem','plugin'),
    art('GraphItem','graph'), art('NonNativeItem','non-native'), art('LegacyTextItem','legacy')];
const propsForType = {PlacedItem:'placedItems',RasterItem:'rasterItems',SymbolItem:'symbolItems',
    GroupItem:'groupItems',CompoundPathItem:'compoundPathItems',PathItem:'pathItems',
    MeshItem:'meshItems',PluginItem:'pluginItems',GraphItem:'graphItems',
    NonNativeItem:'nonNativeItems',LegacyTextItem:'legacyTextItems'};
const typed = {textFrames:[textOnly]};
for (const item of mixedArt) typed[propsForType[item.typename]] = [item];
// Include one image in both collections to check deduplication.
const mixedGroup = withKids(art('GroupItem','mixed',{layers:[]}), [textOnly,linked], typed);
mixedArt.forEach(item => { item.parent = mixedGroup; });
const mixedLayer = withKids(art('Layer','mixed-layer',{layers:[]}), [mixedGroup], {});
// Layer typed collections can include descendants; do not flatten them.
mixedLayer.placedItems = [linked];
const mixedDoc = {...docMissing,layers:[mixedLayer],activeLayer:mixedLayer};
vm.runInNewContext(source,{...context,$:{global:{}},app:{...context.app,documents:[mixedDoc],activeDocument:mixedDoc}});
const mixedTree = controls.filter(c=>c.type==='treeview').at(-1);
const layerArt = entriesOf(mixedTree.items[0]).filter(entry=>!entry.descendantToggle && !entry.layerTarget);
assert.equal(layerArt.length,1,'nested images stay inside their group');
const mixedEntries = entriesOf(layerArt[0].ui).filter(entry=>!entry.descendantToggle && !entry.layerTarget);
assert.equal(mixedEntries.length,mixedArt.length+1);
for (const item of mixedArt) assert.equal(mixedEntries.filter(entry=>entry.ref===item).length,1,item.typename+' is listed once');
assert(mixedEntries.find(entry=>entry.ref===linked).ui.text.includes('linked.png'));
assert(entriesOf(mixedEntries.find(entry=>entry.ref===compound).ui).some(entry=>entry.ref===compoundChild));
console.log('Passed: mixed text/image/symbol/group collections are complete and preserve hierarchy');

// Missing optional stacking metadata must not make distinct images share a key.
const noIdA = {typename:'RasterItem',name:'same'};
const noIdB = {typename:'RasterItem',name:'same'};
const uuidA = {typename:'PlacedItem',name:'same',uuid:'image-a'};
const uuidB = {typename:'PlacedItem',name:'same',uuid:'image-b'};
const uuidWrapper = {...uuidA};
const idLayer = withKids(art('Layer','ids',{layers:[]}),[noIdA,noIdB,uuidA,uuidB],{
    rasterItems:[noIdA,noIdB],placedItems:[uuidWrapper,uuidB]
});
uuidWrapper.parent=idLayer;
const idDoc = {...docMissing,layers:[idLayer],activeLayer:idLayer};
vm.runInNewContext(source,{...context,$:{global:{}},app:{...context.app,documents:[idDoc],activeDocument:idDoc}});
const idTree=controls.filter(c=>c.type==='treeview').at(-1);
const idEntries=entriesOf(idTree.items[0]).filter(entry=>!entry.descendantToggle && !entry.layerTarget);
assert.equal(idEntries.length,4,'keep distinct images and deduplicate repeated references or UUIDs');
assert(idEntries.some(entry=>entry.ref===noIdA));
assert(idEntries.some(entry=>entry.ref===noIdB));
console.log('Passed: missing stacking metadata keeps distinct images, UUID duplicates are removed');

// Layer targets use an external button. Native disclosure, leaf picks and bulk picks
// must continue to operate independently of the one-rectangle layer target.
const firstLayerButton=controls.find(c=>c.text==='レイヤー全体を対象にする');
assert(!firstLayerButton.enabled,'layer button is disabled until a layer row is selected');
const readsBeforeLayer=reads;
const selectionBeforeLayer=leaves.map(item=>item.selected);
clickRow(layerNode);
assert(firstLayerButton.enabled);
assert(!layerNode.text.includes('（対象）'),'native layer row does not itself toggle a target');
firstLayerButton.onClick();
assert(layerNode.text.includes('（対象）'));
assert(controls.some(c=>c.text==='1件選択'));
assert.deepEqual(leaves.map(item=>item.selected),selectionBeforeLayer,'layer button does not change individual artwork selection');
assert.equal(reads,readsBeforeLayer,'layer click reads bounds from the loaded model, not collections');
assert.equal(layerNode.expanded,true,'layer target selection preserves native disclosure');
const previewMessage=messages.at(-1);
assert(previewMessage.onResult,'layer center is requested asynchronously');
const previewBounds=vm.runInNewContext(previewMessage.body,context);
previewMessage.onResult({body:previewBounds});
assert.deepEqual(Array.from(doc.views[0].centerPoint),[5,5],'layer preview follows union center using fresh host refs');
const readsAfterPreview=reads;
firstLayerButton.onClick();
assert(!layerNode.text.includes('（対象）'),'same layer button toggles off');
assert.equal(reads,readsAfterPreview,'deselection does not rescan geometry');
assert.equal(layerNode.items.length,2,'layer children keep their pre-feature structure: subtree toggle plus group');
console.log('Passed: external layer button, unchanged tree children/disclosure and cached bounds');

function runLayerTool(document) {
    const first=controls.length;
    const ctx={...context,$:{global:{}},app:{...context.app,documents:[document],activeDocument:document}};
    vm.runInNewContext(source,ctx);
    const own=controls.slice(first), ownTrees=own.filter(c=>c.type==='treeview');
    const layerButton=own.find(c=>c.text==='レイヤー全体を対象にする');
    return {ctx,own,layerButton,destination:ownTrees[0],targets:ownTrees[1],
        click(row){ownTrees[1].selection=row;ownTrees[1].onChange();},
        pickLayer(node){ownTrees[1].selection=node;ownTrees[1].onChange();assert(layerButton.enabled);layerButton.onClick();},
        previewLayer(){const msg=messages.at(-1);const result=vm.runInNewContext(msg.body,ctx);if(msg.onResult)msg.onResult({body:result});return result;}};
}
function rowFor(node, ref) { return node.items.find(row=>row._entry && row._entry.ref===ref); }
function layerPicked(node) { return node.text.includes('（対象）'); }
const bounded=(name,b,extra)=>art('PathItem',name,Object.assign({visibleBounds:b,geometricBounds:b},extra||{}));
const mainPath=bounded('main',[10,40,30,10]);
const lockedPath=bounded('locked',[40,50,60,5],{locked:true});
const hiddenPath=bounded('hidden',[-999,999,999,-999],{hidden:true});
const guide=bounded('guide',[-900,900,900,-900],{guides:true});
const mask=bounded('mask',[-2,32,22,-2],{clipping:true,geometricBounds:[0,30,20,0]});
const outside=bounded('masked artwork',[-500,600,600,-500]);
const clipped=withKids(art('GroupItem','clip',{clipped:true}),[mask,outside]);
const subPath=bounded('sublayer',[100,80,110,70]);
const sublayer=withKids(art('Layer','same-name',{layers:[]}),[subPath]);
const hiddenSub=withKids(art('Layer','hidden-sublayer',{layers:[],visible:false}),[bounded('hidden sub',[-800,800,800,-800])]);
const rootKids=[mainPath,lockedPath,hiddenPath,guide,clipped];
const rootLayer=withKids(art('Layer','same-name',{layers:[sublayer,hiddenSub]}),rootKids);
sublayer.parent=rootLayer;hiddenSub.parent=rootLayer;
const created=[];
rootLayer.pathItems={rectangle(top,left,width,height){
    const rect=bounded('new overlay',[-1000,1000,1000,-1000]);
    rect.args=[top,left,width,height];rect.parent=rootLayer;rect.zOrder=()=>{};rect.move=()=>{};
    rootKids.push(rect);created.push(rect);return rect;
}};
const layerDoc={typename:'Document',layers:[rootLayer],views:[{zoom:2}],
    pageItems:[mainPath,lockedPath,hiddenPath,guide,clipped,mask,outside,subPath],pathItems:[],
    activeLayer:rootLayer,selection:[]};
rootLayer.parent=layerDoc;
const layerTool=runLayerTool(layerDoc);
const rootUI=layerTool.targets.items[0], subUI=rowFor(rootUI,sublayer);
layerTool.pickLayer(rootUI);
layerTool.previewLayer();
assert(layerTool.own.some(c=>typeof c.text==='string' && c.text.includes('110.00 × 80.00 pt')),'layer combines visible descendants and stroke bounds');
layerTool.pickLayer(subUI);
layerTool.click(rowFor(rootUI,mainPath));
assert(layerTool.own.some(c=>c.text==='3件選択'),'two layer targets plus one ordinary target');
assert.equal(layerTool.ctx.$.global.__greenOverlayDiagnostic.counts.Layer,3,'target rows do not duplicate model objects');
// Artwork added/moved after loading must be included at execution time.
subPath.visibleBounds=subPath.geometricBounds=[100,90,130,70];
const newlyAdded=bounded('added after load',[150,100,160,90]);
newlyAdded.parent=rootLayer;rootKids.push(newlyAdded);
layerTool.destination.selection=layerTool.destination.items[0];layerTool.destination.onChange();
layerTool.own.find(c=>c.text==='確認 / 実行').onClick();
const layerExecute=bodies.at(-1);
new vm.Script(layerExecute);
assert(layerExecute.includes('t:"Layer",p:[0],n:"same-name"'),'layer source is resolved by the cached address');
assert(layerExecute.includes('t:"Layer",p:[0,0],n:"same-name"'),'same-name sublayers have distinct source addresses');
vm.runInNewContext(layerExecute,layerTool.ctx);
assert.equal(created.length,3,'one rectangle for each selected layer and each selected ordinary object');
assert.deepEqual(created.map(r=>r.args),[[100,0,160,100],[90,100,30,20],[40,10,20,30]],'every layer snapshot precedes creation into the source layer');
assert(created.every(r=>r.fillColor.red===0 && r.fillColor.green===255 && r.opacity===100));
assert.equal(layerTool.ctx.app.coordinateSystem,0,'coordinate system restored');
layerTool.own.find(c=>c.text==='全解除').onClick();
assert(!layerPicked(rootUI) && !layerPicked(subUI));
assert(layerTool.own.some(c=>c.text==='0件選択'));
console.log('Passed: layer live bounds, nested layers, hidden/guide exclusion, locked art, clipping, duplicate names, independent targets and pre-creation snapshots');

// Full-select and subtree-select retain the previous leaf-only meaning.
layerTool.own.find(c=>c.text==='全選択').onClick();
assert(!layerPicked(rootUI) && !layerPicked(subUI));
layerTool.own.find(c=>c.text==='全解除').onClick();
const rootSubtree=rootUI.items.find(row=>row._entry.descendantToggle);
layerTool.click(rootSubtree);
assert(!layerPicked(rootUI) && !layerPicked(subUI));
layerTool.click(rootSubtree);
assert(layerTool.own.some(c=>c.text==='0件選択'));
console.log('Passed: full/subtree select retain leaf-only behavior; clear removes all layer targets');

const emptyLayer=withKids(art('Layer','empty',{layers:[]}),[]);
const hiddenOnlyLayer=withKids(art('Layer','hidden-only',{layers:[]}),[bounded('hidden',[-10,10,10,-10],{hidden:true})]);
const childOfHidden=withKids(art('Layer','child',{layers:[]}),[bounded('child',[0,10,10,0])]);
const hiddenAncestor=withKids(art('Layer','ancestor',{layers:[childOfHidden],visible:false}),[]);
childOfHidden.parent=hiddenAncestor;
const emptyDoc={...layerDoc,layers:[emptyLayer,hiddenOnlyLayer,hiddenAncestor],pageItems:[],pathItems:[],activeLayer:emptyLayer};
const emptyTool=runLayerTool(emptyDoc);
for(const ref of [emptyLayer,hiddenOnlyLayer,childOfHidden]) {
    const all=[];function visit(n){all.push(n);n.items.forEach(visit);}visit(emptyTool.targets);
    const node=all.find(n=>n._entry && n._entry.ref===ref);
    const before=alerts.length;
    emptyTool.pickLayer(node);
    assert(layerPicked(node),'layer selection does not read native visibility/bounds');
    assert.equal(alerts.length,before,'empty/hidden layers do not cause selection-time errors');
    assert.equal(emptyTool.previewLayer(),'','empty/hidden layer preview does not pan');
    emptyTool.pickLayer(node);
}
assert(emptyTool.own.some(c=>c.text==='0件選択'));
console.log('Passed: empty and hidden layer selection is nonblocking; preview handles absent bounds');

// A layer that becomes empty between selection and execution must never use
// another selected artwork as the old host's selection fallback.
const disappearing=bounded('disappearing',[0,10,10,0]);
const vanishingLayer=withKids(art('Layer','vanishing',{layers:[]}),[disappearing]);
const vanishingDoc={...layerDoc,layers:[vanishingLayer],pageItems:[disappearing],pathItems:[],activeLayer:vanishingLayer};
const vanishTool=runLayerTool(vanishingDoc);
vanishTool.pickLayer(vanishTool.targets.items[0]);
disappearing.hidden=true;
vanishTool.destination.selection=vanishTool.destination.items[0];vanishTool.destination.onChange();
vanishTool.own.find(c=>c.text==='確認 / 実行').onClick();
const emptyExecute=bodies.at(-1);
assert(emptyExecute.includes('t:"Layer",p:[0]'));
const misleading=bounded('unrelated',[0,50,50,0]);
vanishingDoc.selection=[misleading];
let accidentalCreates=0;
vanishingDoc.pathItems.rectangle=()=>{accidentalCreates++;return misleading;};
let layerOnlyHostReads=0;
Object.defineProperty(vanishingDoc,'pageItems',{get(){layerOnlyHostReads++;return [misleading];}});
vm.runInNewContext(emptyExecute,vanishTool.ctx);
assert.equal(layerOnlyHostReads,0,'layer-only execution does not enumerate unrelated artwork');
assert.equal(accidentalCreates,0,'empty layer never falls back to another selected object');
assert(alerts.at(-1).includes('1件は作成できませんでした'));
console.log('Passed: disappearing layer bounds are reported, with no wrong-object fallback');

// Compound clipping paths use the compound's geometric mask bounds, while
// normal artwork keeps visible bounds including stroke width.
const compoundMaskPath=bounded('compound-mask-path',[0,20,20,0],{clipping:true});
const compoundMask=art('CompoundPathItem','compound-mask',{pathItems:[compoundMaskPath],
    visibleBounds:[-2,22,22,-2],geometricBounds:[0,20,20,0]});
compoundMaskPath.parent=compoundMask;
const compoundMasked=withKids(art('GroupItem','compound-clipped',{clipped:true}),[
    compoundMask,bounded('outside compound',[-500,500,500,-500])]);
const strokeOnly=bounded('stroke',[-10,30,20,-5],{geometricBounds:[0,20,10,0]});
const maskLayer=withKids(art('Layer','compound-layer',{layers:[]}),[compoundMasked,strokeOnly]);
const maskDoc={...layerDoc,layers:[maskLayer],pageItems:[],pathItems:[],activeLayer:maskLayer};
const maskTool=runLayerTool(maskDoc);
maskTool.pickLayer(maskTool.targets.items[0]);
maskTool.previewLayer();
assert(maskTool.own.some(c=>typeof c.text==='string' && c.text.includes('30.00 × 35.00 pt')));
maskTool.destination.selection=maskTool.destination.items[0];maskTool.destination.onChange();
maskTool.own.find(c=>c.text==='確認 / 実行').onClick();
assert(bodies.at(-1).includes('t:"Layer",p:[0],n:"compound-layer"'));
const brokenBounds=bounded('unreadable',[0,10,10,0]);
Object.defineProperty(brokenBounds,'visibleBounds',{get(){throw Error('bounds unavailable');}});
Object.defineProperty(brokenBounds,'geometricBounds',{get(){throw Error('bounds unavailable');}});
const brokenBoundsLayer=withKids(art('Layer','bounds-failure',{layers:[]}),[brokenBounds]);
const brokenBoundsDoc={...layerDoc,layers:[brokenBoundsLayer],pageItems:[],pathItems:[],activeLayer:brokenBoundsLayer};
const boundsFailureTool=runLayerTool(brokenBoundsDoc);
const beforeBrokenSelection=alerts.length;
boundsFailureTool.pickLayer(boundsFailureTool.targets.items[0]);
assert(layerPicked(boundsFailureTool.targets.items[0]));
assert.equal(alerts.length,beforeBrokenSelection,'broken geometry cannot abort layer selection');
assert.equal(boundsFailureTool.previewLayer(),'');
boundsFailureTool.destination.selection=boundsFailureTool.destination.items[0];boundsFailureTool.destination.onChange();
boundsFailureTool.own.find(c=>c.text==='確認 / 実行').onClick();
vm.runInNewContext(bodies.at(-1),boundsFailureTool.ctx);
assert(alerts.at(-1).includes('1件は作成できませんでした'));
assert(alerts.at(-1).includes('範囲を取得できない項目が 1 件'));
console.log('Passed: unreadable layer geometry is reported per execution target, without breaking selection');

// Some Illustrator wrappers throw when visibility is queried even while their
// geometry is readable. Keep their bounds and the complete native child tree.
const uncertainPath=bounded('unknown visibility',[0,20,30,0]);
Object.defineProperty(uncertainPath,'hidden',{get(){throw Error('hidden unavailable');}});
const uncertainGroup=withKids(art('GroupItem','unknown group'),[uncertainPath]);
Object.defineProperty(uncertainGroup,'hidden',{get(){throw Error('hidden unavailable');}});
const confirmedHidden=bounded('confirmed hidden',[-500,500,500,-500],{hidden:true});
const uncertainLayer=withKids(art('Layer','unknown layer',{layers:[]}),[uncertainGroup,confirmedHidden]);
Object.defineProperty(uncertainLayer,'visible',{get(){throw Error('visible unavailable');}});
const uncertainDoc={...layerDoc,layers:[uncertainLayer],pageItems:[],pathItems:[],activeLayer:uncertainLayer};
const uncertainTool=runLayerTool(uncertainDoc);
const uncertainRoot=uncertainTool.targets.items[0], uncertainGroupRow=rowFor(uncertainRoot,uncertainGroup);
assert(rowFor(uncertainGroupRow,uncertainPath),'leaf artwork exists before layer selection');
const childRowsBefore=uncertainRoot.items.slice();
const groupRowsBefore=uncertainGroupRow.items.slice();
const alertsBeforeUnknown=alerts.length;
uncertainTool.pickLayer(uncertainRoot);
assert(layerPicked(uncertainRoot));
assert.equal(alerts.length,alertsBeforeUnknown,'visibility read failure does not abort the layer target');
assert.deepEqual(uncertainRoot.items,childRowsBefore,'layer selection never adds/removes/reorders child rows');
assert.deepEqual(uncertainGroupRow.items,groupRowsBefore);
uncertainTool.previewLayer();
assert(uncertainTool.own.some(c=>c.text==='レイヤー範囲を取得しました（不確かな表示状態または代替範囲を含む）。'));
assert(uncertainTool.own.some(c=>typeof c.text==='string' && c.text.includes('30.00 × 20.00 pt')));
uncertainTool.destination.selection=uncertainTool.destination.items[0];uncertainTool.destination.onChange();
uncertainTool.own.find(c=>c.text==='確認 / 実行').onClick();
assert(bodies.at(-1).includes('t:"Layer",p:[0],n:"unknown layer"'));
uncertainTool.pickLayer(uncertainRoot);
assert(!layerPicked(uncertainRoot));
uncertainTool.click(uncertainGroupRow);
assert(!uncertainTool.layerButton.enabled,'group row cannot operate the previous layer target');
assert(logs.some(line=>line.includes('bounds.visibility')&&line.includes('Unknown visibility included')));
console.log('Passed: throwing visibility accessors preserve bounds, child rows, retry and confirmed-hidden exclusion');

// Cached Illustrator wrappers may stop exposing geometry after startup. Layer
// selection must remain usable, and execution must use fresh native handles.
const stalePath=bounded('cached-path',[0,10,10,0]);
const staleLayer=withKids(art('Layer','fresh-handles',{layers:[]}),[stalePath]);
const staleDoc={...layerDoc,layers:[staleLayer],pageItems:[stalePath],pathItems:[],activeLayer:staleLayer};
const staleTool=runLayerTool(staleDoc);
const staleUI=staleTool.targets.items[0];
let staleBoundsReads=0;
for (const prop of ['visibleBounds','geometricBounds']) Object.defineProperty(stalePath,prop,{get(){staleBoundsReads++;throw Error('stale artwork handle');}});
const freshPath=bounded('fresh-path',[20,60,80,10]);
const freshLayer=withKids(art('Layer','fresh-handles',{layers:[]}),[freshPath]);
const freshCreated=[];
freshLayer.pathItems={rectangle(top,left,width,height){const r={args:[top,left,width,height],zOrder(){}};freshCreated.push(r);return r;}};
const freshDoc={...staleDoc,layers:[freshLayer],pageItems:[freshPath],pathItems:[],activeLayer:freshLayer,views:[{zoom:1}]};
staleTool.ctx.app.activeDocument=freshDoc;staleTool.ctx.app.documents=[freshDoc];
const staleAlertsBefore=alerts.length;
staleTool.pickLayer(staleUI);
assert.equal(staleBoundsReads,0,'selection must never read cached artwork geometry');
assert.equal(alerts.length,staleAlertsBefore);
staleTool.previewLayer();
assert.deepEqual(Array.from(freshDoc.views[0].centerPoint),[50,35]);
assert.equal(staleBoundsReads,0,'preview resolves live layer and artwork handles');
staleTool.destination.selection=staleTool.destination.items[0];staleTool.destination.onChange();
staleTool.own.find(c=>c.text==='確認 / 実行').onClick();
const freshExecute=bodies.at(-1);
assert.equal(staleBoundsReads,0,'building execution only serializes cached layer addresses');
vm.runInNewContext(freshExecute,staleTool.ctx);
assert.deepEqual(freshCreated.map(r=>r.args),[[60,20,60,50]]);
assert.equal(staleBoundsReads,0);
console.log('Passed: stale UI geometry cannot fail layer selection, preview or fresh host execution');

// If child bounds are unavailable but a group has valid bounds, use its native
// container bounds with an explicit approximation notice.
const opaqueChild=bounded('opaque-child',[0,10,10,0]);
for(const prop of ['visibleBounds','geometricBounds'])Object.defineProperty(opaqueChild,prop,{get(){throw Error('child bounds unavailable');}});
const readableGroup=withKids(art('GroupItem','readable-group',{visibleBounds:[-10,40,50,-5],geometricBounds:[-10,40,50,-5]}),[opaqueChild]);
const fallbackLayer=withKids(art('Layer','fallback-layer',{layers:[]}),[readableGroup]);
const fallbackCreated=[];
fallbackLayer.pathItems={rectangle(top,left,width,height){const r={args:[top,left,width,height],zOrder(){}};fallbackCreated.push(r);return r;}};
const fallbackDoc={...layerDoc,layers:[fallbackLayer],pageItems:[],pathItems:[],activeLayer:fallbackLayer};
const fallbackTool=runLayerTool(fallbackDoc);
fallbackTool.pickLayer(fallbackTool.targets.items[0]);
fallbackTool.previewLayer();
fallbackTool.destination.selection=fallbackTool.destination.items[0];fallbackTool.destination.onChange();
fallbackTool.own.find(c=>c.text==='確認 / 実行').onClick();
vm.runInNewContext(bodies.at(-1),fallbackTool.ctx);
assert.deepEqual(fallbackCreated.map(r=>r.args),[[40,-10,60,45]]);
assert(alerts.at(-1).includes('グループ範囲の代替'));
assert(logs.some(line=>line.includes('bounds.fallback')));
console.log('Passed: readable group bounds recover unreadable children with an approximation notice');

// Failure of a layer must not prevent an ordinary selected target from running.
const badLayerPath=bounded('bad-layer-path',[0,20,20,0]);
for(const prop of ['visibleBounds','geometricBounds'])Object.defineProperty(badLayerPath,prop,{get(){throw Error('cannot read bounds');}});
const badLayer=withKids(art('Layer','bad-layer',{layers:[]}),[badLayerPath]);
const goodOrdinary=bounded('ordinary-good',[5,30,25,10]);
const goodLayer=withKids(art('Layer','ordinary-layer',{layers:[]}),[goodOrdinary]);
const mixedCreated=[];
goodLayer.pathItems={rectangle(top,left,width,height){const r={args:[top,left,width,height],zOrder(){}};mixedCreated.push(r);return r;}};
const mixedFailureDoc={...layerDoc,layers:[badLayer,goodLayer],pageItems:[badLayerPath,goodOrdinary],pathItems:[],activeLayer:goodLayer};
const mixedFailureTool=runLayerTool(mixedFailureDoc);
mixedFailureTool.pickLayer(rowFor(mixedFailureTool.targets,badLayer));
const ordinaryUI=rowFor(rowFor(mixedFailureTool.targets,goodLayer),goodOrdinary);
mixedFailureTool.click(ordinaryUI);
const ordinaryDest=mixedFailureTool.destination.items.find(n=>n.text.includes('ordinary-layer'));
mixedFailureTool.destination.selection=ordinaryDest;mixedFailureTool.destination.onChange();
mixedFailureTool.own.find(c=>c.text==='確認 / 実行').onClick();
vm.runInNewContext(bodies.at(-1),mixedFailureTool.ctx);
assert.deepEqual(mixedCreated.map(r=>r.args),[[30,5,20,20]]);
assert(alerts.at(-1).includes('1件を作成しました')&&alerts.at(-1).includes('1件は作成できませんでした'));
console.log('Passed: unreadable layer targets cannot abort ordinary target creation');

// Compound masks can derive their rectangle from component paths when the
// host does not expose a compound-wide geometric/visible bound.
for(const prop of ['visibleBounds','geometricBounds'])Object.defineProperty(compoundMask,prop,{get(){throw Error('compound-wide bounds unavailable');}});
maskTool.pickLayer(maskTool.targets.items[0]);
maskTool.pickLayer(maskTool.targets.items[0]);
const reconstructedMask=maskTool.previewLayer();
assert(reconstructedMask.startsWith('-10,30,20,-5;'));
console.log('Passed: compound clipping bounds can be reconstructed from component paths');

// Splitting the source must preserve relative include resolution when the user
// extracts the repository to a folder whose name contains spaces/non-ASCII text.
const os=require('node:os'), path=require('node:path');
const packageRoot=fs.mkdtempSync(path.join(os.tmpdir(),'desk-tools-'));
try {
    const relocated=path.join(packageRoot,'script folder 日本語');
    fs.cpSync(path.resolve(__dirname,'..'),relocated,{recursive:true});
    const loaded=require('./load-script.cjs').loadScript(path.join(relocated,'green-overlay.jsx'));
    assert.equal(loaded,source);
    new vm.Script(loaded);
    const missing=path.join(relocated,'green-overlay','bounds.jsxinc');
    fs.rmSync(missing);
    assert.throws(()=>require('./load-script.cjs').loadScript(path.join(relocated,'green-overlay.jsx')),/ENOENT/);
}finally{fs.rmSync(packageRoot,{recursive:true,force:true});}
assert(!execute.includes('function layerArtworkBounds'),'ordinary-only execution does not serialize layer-only helpers');
console.log('Passed: modular package relocation, BOMs, missing dependency detection and unchanged ordinary-only host payload');

// The old loader already recovers transient document wrappers. Layer host
// callbacks need the same recovery rather than retaining an unreadable wrapper.
const transientDocument={typename:'Document',get layers(){throw Error('This is not a document');}};
let liveDocumentHits=0;
Object.defineProperty(staleTool.ctx.app,'activeDocument',{get(){liveDocumentHits++;return liveDocumentHits<=2?transientDocument:freshDoc;}});
vm.runInNewContext(freshExecute,staleTool.ctx);
assert.equal(liveDocumentHits,3);
assert.equal(freshCreated.length,2);
assert.deepEqual(freshCreated[1].args,[60,20,60,50]);
console.log('Passed: layer execution recovers a transient unreadable active-document wrapper');
