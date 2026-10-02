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
        add(type,a,b){const child=control(type,b===undefined?a:b);child.index=this.items.length;this.items.push(child);return child;},
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
