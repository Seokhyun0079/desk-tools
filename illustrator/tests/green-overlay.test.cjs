const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(__dirname + '/../green-overlay.jsx', 'utf8').replace(/^#target.*$/gm, '');
let reads = 0, z = 0, shown = false;
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
        removeAll(){this.items=[];},show(){shown=true;},update(){},close(){},hide(){}};
    controls.push(c);return c;
}
function File(){this.fsName='/mock/log';this.parent={exists:true};this.open=()=>true;this.writeln=s=>logs.push(s);this.close=()=>{};}
const context={app:{documents:[doc],activeDocument:doc,coordinateSystem:0,redraw(){}},CoordinateSystem:{DOCUMENTCOORDINATESYSTEM:1},
    Folder:{userData:{fsName:'/mock'}},File,$:{global:{}},Window:function(){return control('window');},
    RGBColor:function(){}, ElementPlacement:{PLACEATBEGINNING:1},ZOrderMethod:{BRINGTOFRONT:1},
    alert:s=>alerts.push(s),confirm:()=>true,
    BridgeTalk:function(){this.send=()=>{bodies.push(this.body); if(this.body.indexOf("__greenOverlayLoadStep")>=0) pending.push(this); return true;};}};
vm.runInNewContext(source,context);
assert(shown,'window must show before work');
assert.equal(reads,0,'no initial scan');
assert.equal(pending.length,1);
let batches=0;
while(pending.length){
    const bt=pending.shift();
    vm.runInNewContext(bt.body.replace(/^#target.*$/gm,''),context);
    batches++;
    if(bt.onResult) bt.onResult({body:''});
    assert(batches<1000,'loader terminates');
}
assert(batches>30,'large document is split across messages');
assert.equal(reads,3,'one scan per container, no leaf scans');
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

// Cancellation must invalidate queued work and prevent further scheduling.
const context2={...context, $:{global:{}}};
vm.runInNewContext(source,context2);
const cancel=controls.filter(c=>c.text==='読み込みを中止').at(-1);
cancel.onClick();
const queued=pending.shift();
const before=reads;
vm.runInNewContext(queued.body.replace(/^#target.*$/gm,''),context2);
queued.onResult({body:''});
assert.equal(reads,before);
assert.equal(pending.length,0);
console.log('Passed: window-first loading, bounded queued batches and cancellation');
