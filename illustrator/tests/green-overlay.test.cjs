const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(__dirname + '/../green-overlay.jsx', 'utf8').replace(/^#target.*$/gm, '');
let reads = 0, z = 0, shown = false;
function container(type, children) {
    const item = {typename:type, name:type, absoluteZOrderPosition:++z, layers:[], pathItems:{rectangle(){throw Error('locked destination');}}};
    children.forEach(child=>child.parent=item);
    Object.defineProperty(item,'pageItems',{get(){assert(shown,'show window before scanning');reads++;return children;}});
    return item;
}
const leaves = Array.from({length:1000},()=>({typename:'PathItem',name:'path',absoluteZOrderPosition:++z,visibleBounds:[0,10,10,0],geometricBounds:[0,10,10,0]}));
const nested=container('GroupItem',leaves);
const group=container('GroupItem',[nested]);
const layer=container('Layer',[group]);
const doc={typename:'Document',layers:[layer],views:[{zoom:1}],pageItems:leaves,pathItems:leaves,activeLayer:layer,selection:[]};
doc.pathItems.rectangle = () => { throw Error('locked destination'); };
const controls=[], logs=[], alerts=[], bodies=[];
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
    BridgeTalk:function(){this.send=()=>{bodies.push(this.body);return true;};}};
vm.runInNewContext(source,context);
assert.equal(reads,0,'startup must not scan descendants');
const tree=controls.find(c=>c.type==='treeview');
const list=controls.find(c=>c.type==='listbox');
function clickRow(index){list.selection=list.items[index];list.onChange();}
clickRow(0);
assert.equal(reads,1,'opening layer reads only that layer');
assert.equal(list.items.length,3,'layer, subtree toggle, collapsed group');
tree.onExpand(tree.items[0]);
assert.equal(reads,1,'destination shares model cache');
controls.find(c=>c.text==='全選択').onClick();
assert(leaves.every(item=>item.selected),'all selects unloaded nested descendants');
assert(controls.some(c=>c.text==='1000件選択'));
clickRow(1); // descendant toggle, all already selected
assert(leaves.every(item=>!item.selected),'subtree toggle clears collapsed descendants');
clickRow(1);
assert(leaves.every(item=>item.selected),'subtree toggle restores descendants');
clickRow(2); // expand group
clickRow(4); // expand nested group
assert.equal(list.items.length,1006);
assert(list.items[6].text.includes('☑'),'loaded rows retain picked markers');
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
console.log('Passed: lazy startup, shared cache, nested whole/subtree selection, row markers, RGB/opacity preservation, generated host code and failure logging');
