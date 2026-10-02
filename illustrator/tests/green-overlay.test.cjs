const fs = require('fs');
const vm = require('vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(__dirname + '/../green-overlay.jsx', 'utf8').replace(/^#target.*$/gm, '');
let reads = 0;
function container(type, children) {
    const item = { typename: type, name: type, layers: [] };
    children.forEach(child => child.parent = item);
    Object.defineProperty(item, 'pageItems', { get() { reads++; return children; } });
    return item;
}
const leaves = Array.from({length: 1000}, () => ({typename:'PathItem', name:'path', geometricBounds:[0,10,10,0]}));
const group = container('GroupItem', leaves);
const layer = container('Layer', [group]);
const doc = {typename:'Document', layers:[layer], views:[{centerPoint:[0,0]}]};
const controls = [];
function control(type, text) {
    const c = {type, text, items:[], selection:null, layout:{resize(){}},
        add(type, a, b) { const child = control(type, b === undefined ? a : b); this.items.push(child); return child; },
        removeAll(){this.items=[];}, show(){}, update(){}, close(){} };
    controls.push(c); return c;
}
const lines=[];
function File(){this.parent={exists:true};this.fsName='/mock/log';this.open=()=>true;this.writeln=s=>lines.push(s);this.close=()=>{};}
const context = {app:{documents:[doc],activeDocument:doc,redraw(){},coordinateSystem:0},
    CoordinateSystem:{DOCUMENTCOORDINATESYSTEM:1}, Folder:{userData:{fsName:'/mock'}},File,
    $:{global:{}},Window:function(){return control('window');},alert:message=>{throw Error(message);},confirm:()=>true};
vm.runInNewContext(source,context);
const trees = controls.filter(c=>c.type==='treeview');
assert.equal(reads,0,'startup must not scan any layer items');
assert.equal(trees[1].items.length,1);
trees[1].onExpand(trees[1].items[0]);
const readsAfterObject = reads;
trees[0].onExpand(trees[0].items[0]);
assert.equal(reads,readsAfterObject,'destination reuses cached children');
assert.equal(trees[1].items[0].items[0].items.length,1,'group remains unloaded');
controls.find(c=>c.text==='全選択').onClick();
assert(leaves.every(item=>item.selected),'select all includes collapsed descendants');
assert(controls.some(c=>c.text==='1000件選択'));
trees[1].onExpand(trees[1].items[0].items[0]);
assert.equal(trees[1].items[0].items[0].items.length,1000);
const leafNode=trees[1].items[0].items[0].items[0];
doc.views[0].centerPoint=[99,99];trees[1].selection=leafNode;trees[1].onClick();
assert.equal(leafNode.text.slice(0,3),'[ ]');
assert.deepEqual(doc.views[0].centerPoint,[99,99],'deselection must not move view');
assert(lines.some(line=>line.includes('startup.ready')));
console.log('Passed: lazy startup, shared cache, collapsed select-all, markers, deselection focus, startup log');
