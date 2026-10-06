const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const raw = fs.readFileSync(__dirname + '/../green-overlay.jsx');
assert.equal(raw[0], 0xEF);
assert.equal(raw[1], 0xBB);
assert.equal(raw[2], 0xBF, 'JSX must stay UTF-8 with BOM so Illustrator can read it');
const source = raw.toString('utf8').replace(/^\uFEFF/, '').replace(/^#target.*$/gm, '');
let reads = 0, z = 0, shown = false, readsAtShow = null, windowLayouts = 0;
function container(type, children) {
    const item = {typename:type, name:type, absoluteZOrderPosition:++z, layers:[], pathItems:{rectangle(){throw Error('locked destination');}}};
    children.forEach(child=>child.parent=item);
    Object.defineProperty(item,'pageItems',{get(){reads++;return children;}});
    return item;
}
const leaves = Array.from({length:1000},()=>({typename:'PathItem',name:'path',absoluteZOrderPosition:++z,visibleBounds:[0,10,10,0],geometricBounds:[0,10,10,0]}));
const nested=container('GroupItem',leaves);
const group=container('GroupItem',[nested]);
const layer=container('Layer',[group]);
const doc={typename:'Document',layers:[layer],views:[{zoom:1}],pageItems:leaves,pathItems:leaves,activeLayer:layer,selection:[]};
doc.pathItems.rectangle = () => { throw Error('locked destination'); };
const controls=[], logs=[], alerts=[], bodies=[], pending=[];
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
    BridgeTalk:function(){this.send=()=>{bodies.push(this.body); if(this.body==="'ok';") pending.push(this); return true;};}};
vm.runInNewContext(source,context);
assert(shown,'window must show before work');
assert.equal(readsAtShow,0,'window shows before page item scans');
assert.equal(pending.length,0,'hierarchy load must not wait on BridgeTalk');
assert(!bodies.some(body=>body.includes('__greenOverlayLoadStep')||body.includes('#targetengine')));
assert.equal(reads,3,'one scan per container, no leaf scans');
assert(windowLayouts>=2,'tree is laid out again after items exist');
const trees=controls.filter(c=>c.type==='treeview');
assert.equal(trees.length,2,'both lists use native arrows');
const tree=trees[0], list=trees[1];
const layerNode=list.items[0], groupNode=layerNode.items[1], nestedNode=groupNode.items[1];
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
const hostEntries = entriesOf(hostNode).filter(entry => !entry.descendantToggle);
assert(hostEntries.some(entry => entry.ref === mesh), 'mesh outside pageItems is listed');
assert(!hostEntries.some(entry => entry.ref === clipPath), 'clipping path stays inside its group');
const groupNodeMissing = hostEntries.find(entry => entry.ref === clipGroup).ui;
const groupEntries = entriesOf(groupNodeMissing).filter(entry => !entry.descendantToggle);
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
const layerArt = entriesOf(mixedTree.items[0]).filter(entry=>!entry.descendantToggle);
assert.equal(layerArt.length,1,'nested images stay inside their group');
const mixedEntries = entriesOf(layerArt[0].ui).filter(entry=>!entry.descendantToggle);
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
const idEntries=entriesOf(idTree.items[0]).filter(entry=>!entry.descendantToggle);
assert.equal(idEntries.length,4,'keep distinct images and deduplicate repeated references or UUIDs');
assert(idEntries.some(entry=>entry.ref===noIdA));
assert(idEntries.some(entry=>entry.ref===noIdB));
console.log('Passed: missing stacking metadata keeps distinct images, UUID duplicates are removed');
