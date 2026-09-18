#target illustrator
(function () {
    if (!app.documents.length) { alert("ドキュメントが開かれていません。"); return; }
    var doc=app.activeDocument, refs=[], destRefs=[], picked={};

    function nameOf(x){try{return x.name||("<"+x.typename+">");}catch(e){return "<オブジェクト>";}}
    function typeOf(x){try{return x.typename;}catch(e){return "";}}
    function kids(x){
        var a=[],i,it,t=typeOf(x);
        try{
            if(t==="Document"){for(i=0;i<x.layers.length;i++)a.push(x.layers[i]);}
            else if(t==="Layer"){
                for(i=0;i<x.pageItems.length;i++){it=x.pageItems[i];try{if(it.parent===x)a.push(it);}catch(e){}}
                for(i=0;i<x.layers.length;i++)a.push(x.layers[i]);
            } else if(t==="GroupItem"){
                for(i=0;i<x.pageItems.length;i++){it=x.pageItems[i];try{if(it.parent===x)a.push(it);}catch(e2){}}
            }
        }catch(e3){}
        return a;
    }
    function bounds(x){var b=x.geometricBounds;return {l:b[0],t:b[1],w:Math.abs(b[2]-b[0]),h:Math.abs(b[1]-b[3])};}

    var w=new Window("dialog","グリーンオーバーレイ");
    w.orientation="column"; w.alignChildren=["fill","top"]; w.margins=10;
    w.add("statictext",undefined,"対象と同じ位置・サイズに緑色の矩形を作成します。");

    var dp=w.add("panel",undefined,"作成先"); dp.alignChildren=["fill","fill"];
    var dt=dp.add("treeview",undefined,[]); dt.preferredSize=[440,140];

    var op=w.add("panel",undefined,"対象オブジェクト"); op.alignChildren=["fill","fill"];
    var bg=op.add("group");
    var allBtn=bg.add("button",undefined,"全選択");
    var noneBtn=bg.add("button",undefined,"全解除");
    var count=bg.add("statictext",undefined,"0件選択"); count.characters=12;
    var ot=op.add("treeview",undefined,[],{multiselect:true}); ot.preferredSize=[440,300];

    var info=w.add("statictext",undefined,"オブジェクトを選択してください。",{multiline:true});
    info.preferredSize=[440,42];
    var run=w.add("button",undefined,"確認 / 実行"); run.enabled=false;

    function addDest(x,p){
        var a=kids(x),i,n,t;
        for(i=0;i<a.length;i++){t=typeOf(a[i]); if(t==="Layer"||t==="GroupItem"){
            n=p.add("node",nameOf(a[i])+" ["+(t==="Layer"?"レイヤー":"グループ")+"]");
            n._i=destRefs.length; destRefs.push(a[i]); addDest(a[i],n);
        }}
    }
    function addObj(x,p){
        var a=kids(x),i,n,t;
        for(i=0;i<a.length;i++){t=typeOf(a[i]);
            n=p.add("node",nameOf(a[i])+" ["+t+"]"); n._i=refs.length;
            n._ok=(t!=="Layer"&&t!=="GroupItem"); refs.push(a[i]); addObj(a[i],n);
        }
    }
    function nodes(p,out){out=out||[];for(var i=0;i<p.items.length;i++){var n=p.items[i];if(n._ok)out.push(n);if(n.items&&n.items.length)nodes(n,out);}return out;}
    function setTreeSelection(){
        var a=nodes(ot,[]),s=[]; for(var i=0;i<a.length;i++)if(picked[a[i]._i])s.push(a[i]);
        try{ot.selection=s;}catch(e){}
    }
    function sync(){
        var a=nodes(ot,[]),sel=[],i,n;
        for(i=0;i<a.length;i++){n=a[i];if(picked[n._i])sel.push(refs[n._i]);}
        try{doc.selection=null;doc.selection=sel;}catch(e){}
        count.text=sel.length+"件選択"; run.enabled=sel.length>0&&!!dt.selection;
        if(sel.length===1){var b=bounds(sel[0]);info.text="名前: "+nameOf(sel[0])+"\nサイズ: "+b.w.toFixed(2)+" × "+b.h.toFixed(2)+" pt";}
        else info.text=sel.length?sel.length+"件のオブジェクトを選択中":"オブジェクトを選択してください。";
        app.redraw();
    }

    /* 일반 클릭을 누적 토글 선택으로 사용 */
    ot.onClick=function(){
        var s=ot.selection, a=(s instanceof Array)?s:(s?[s]:[]);
        if(!a.length)return;
        var n=a[a.length-1];
        if(n._ok){if(picked[n._i])delete picked[n._i];else picked[n._i]=true;}
        setTreeSelection(); sync();
    };
    dt.onChange=function(){run.enabled=Object.keys?false:run.enabled; sync();};
    allBtn.onClick=function(){var a=nodes(ot,[]);picked={};for(var i=0;i<a.length;i++)picked[a[i]._i]=true;setTreeSelection();sync();};
    noneBtn.onClick=function(){picked={};try{ot.selection=null;}catch(e){}sync();};

    function green(){var c=new RGBColor();c.red=0;c.green=200;c.blue=70;return c;}
    run.onClick=function(){
        if(!dt.selection)return;
        var dest=destRefs[dt.selection._i], a=nodes(ot,[]), chosen=[],i;
        for(i=0;i<a.length;i++)if(picked[a[i]._i])chosen.push(refs[a[i]._i]);
        if(!chosen.length)return;
        if(!confirm(chosen.length+"件のオブジェクト上に緑色の要素を作成します。\n実行しますか？"))return;
        var made=[],b,r;
        for(i=0;i<chosen.length;i++){try{
            b=bounds(chosen[i]); if(b.w<=0||b.h<=0)continue;
            r=dest.pathItems.rectangle(b.t,b.l,b.w,b.h);r.stroked=false;r.filled=true;r.fillColor=green();r.name="グリーンオーバーレイ";made.push(r);
        }catch(e){}}
        try{doc.selection=made;}catch(e2){} app.redraw(); alert(made.length+"件を作成しました。");
    };

    addDest(doc,dt); addObj(doc,ot);
    for(var i=0;i<dt.items.length;i++)dt.items[i].expanded=true;
    for(i=0;i<ot.items.length;i++)ot.items[i].expanded=true;
    w.center(); w.show();
}());
