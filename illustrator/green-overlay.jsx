#target illustrator
#targetengine "greenOverlayEngine"

(function () {
    function showError(e) {
        var line = "";
        try {
            if (e && e.line) line = "\n行: " + e.line;
        } catch (_) {}
        alert("スクリプトエラー\n" + e + line);
    }

    try {
        if (!app.documents.length) {
            alert("ドキュメントが開かれていません。");
            return;
        }

        try {
            if ($.global.__greenOverlayWindow) {
                $.global.__greenOverlayWindow.visible = false;
                $.global.__greenOverlayWindow.close();
            }
        } catch (_) {}

        var doc = app.activeDocument;
        var destinationRefs = [];
        var objectEntries = [];
        var objectRoots = [];
        var objectRows = [];
        var picked = {};
        var suppressObjectEvent = 0;
        var lastObjectEventAt = 0;
        var lastObjectEventId = -1;
        var pendingFocusRef = null;

        function typeOf(item) {
            try { return item.typename; } catch (_) { return ""; }
        }

        function kindLabel(item) {
            var t = typeOf(item);
            if (t === "Layer") return "レイヤー";
            if (t === "GroupItem") return "グループ";
            if (t === "PathItem") return "パス";
            if (t === "CompoundPathItem") return "複合パス";
            if (t === "TextFrame") return "テキスト";
            if (t === "PlacedItem") return "配置画像";
            if (t === "RasterItem") return "画像";
            if (t === "SymbolItem") return "シンボル";
            if (t === "MeshItem") return "メッシュ";
            if (t === "PluginItem") return "プラグイン項目";
            if (t === "GraphItem") return "グラフ";
            return t || "オブジェクト";
        }

        function cleanText(s) {
            if (s === null || s === undefined) return "";
            s = String(s);
            s = s.replace(/\r\n/g, " ").replace(/\n/g, " ").replace(/\r/g, " ").replace(/\t/g, " ");
            while (s.indexOf("  ") >= 0) s = s.replace("  ", " ");
            return s.replace(/^ +/, "").replace(/ +$/, "");
        }

        function shorten(s, maxLen) {
            if (!s) return "";
            if (s.length <= maxLen) return s;
            return s.substring(0, maxLen - 1) + "…";
        }

        function isUsefulName(name) {
            name = cleanText(name);
            if (!name) return false;
            if (name.charAt(0) === "<" && name.charAt(name.length - 1) === ">") return false;
            return true;
        }

        function fileNameOf(item) {
            try {
                if (item.file && item.file.name) return item.file.name;
            } catch (_) {}
            return "";
        }

        function swatchNameOf(item) {
            try {
                if (!item.filled) return "";
                var c = item.fillColor;
                if (!c) return "";
                if (c.typename === "SpotColor" && c.spot && c.spot.name) return c.spot.name;
                if (c.typename === "PatternColor" && c.pattern && c.pattern.name) return c.pattern.name;
                if (c.typename === "GradientColor" && c.gradient && c.gradient.name) return c.gradient.name;
            } catch (_) {}
            return "";
        }

        function displayName(item, fallback) {
            var t = typeOf(item);
            var n = "";
            var extra;

            try { n = item.name; } catch (_) {}
            if (isUsefulName(n)) return cleanText(n);

            try {
                if (isUsefulName(item.note)) return shorten(cleanText(item.note), 32);
            } catch (_) {}

            if (t === "TextFrame") {
                try {
                    extra = cleanText(item.contents);
                    if (extra) return shorten(extra, 32);
                } catch (_) {}
            }

            if (t === "PlacedItem" || t === "RasterItem") {
                extra = fileNameOf(item);
                if (extra) return extra;
            }

            if (t === "SymbolItem") {
                try {
                    if (item.symbol && isUsefulName(item.symbol.name)) {
                        return item.symbol.name;
                    }
                } catch (_) {}
            }

            if (t === "GroupItem") {
                try {
                    if (item.clipped) return "クリップグループ";
                } catch (_) {}
            }

            if (t === "PathItem") {
                try {
                    if (item.clipping) return "クリッピングパス";
                } catch (_) {}
                extra = swatchNameOf(item);
                if (extra) return extra;
            }

            return fallback;
        }

        function withDocumentCoordinates(fn) {
            var oldSystem = app.coordinateSystem;
            try {
                app.coordinateSystem = CoordinateSystem.DOCUMENTCOORDINATESYSTEM;
                return fn();
            } finally {
                try { app.coordinateSystem = oldSystem; } catch (_) {}
            }
        }

        function boundsOf(item) {
            return withDocumentCoordinates(function () {
                var b;
                try { b = item.visibleBounds; } catch (_) { b = item.geometricBounds; }
                return {
                    left: b[0],
                    top: b[1],
                    right: b[2],
                    bottom: b[3],
                    width: Math.abs(b[2] - b[0]),
                    height: Math.abs(b[1] - b[3])
                };
            });
        }

        function indentText(depth) {
            var s = "";
            var i;
            for (i = 0; i < depth; i++) s += "    ";
            return s;
        }

        function jsNumber(n) {
            if (isNaN(n)) return "0";
            return String(Math.round(n * 1000) / 1000);
        }

        function sameItem(a, b) {
            if (!a || !b) return false;
            try { if (a === b) return true; } catch (_) {}
            try { if (a == b) return true; } catch (_) {}
            try {
                if (a.typename !== b.typename) return false;
            } catch (_) {
                return false;
            }
            try {
                if (a.absoluteZOrderPosition === b.absoluteZOrderPosition) return true;
            } catch (_) {}
            return false;
        }

        function itemKey(item) {
            try {
                return item.typename + "#" + item.absoluteZOrderPosition;
            } catch (_) {}
            try {
                return item.typename + "@" + item.zOrderPosition + ":" + item.name;
            } catch (_) {}
            return "";
        }

        function pushUnique(result, seen, item) {
            var key = itemKey(item);
            if (key) {
                if (seen[key]) return;
                seen[key] = true;
            }
            result.push(item);
        }

        function parentOf(item) {
            try { return item.parent; } catch (_) { return null; }
        }

        function isDirectChild(item, container) {
            var p = parentOf(item);
            var clipped = false;
            var pt;

            if (!p) return false;
            if (sameItem(p, container)) return true;

            try {
                clipped = typeOf(container) === "GroupItem" && container.clipped;
            } catch (_) {}

            if (!clipped) return false;

            try {
                pt = typeOf(p);
                if (pt === "Layer" || pt === "Document") return true;
            } catch (_) {}

            return false;
        }

        function addCollectionItems(container, prop, result, seen, requireDirect) {
            var col, i, item;
            try {
                col = container[prop];
                if (!col) return;
                for (i = 0; i < col.length; i++) {
                    item = col[i];
                    if (!requireDirect || isDirectChild(item, container)) {
                        pushUnique(result, seen, item);
                    }
                }
            } catch (_) {}
        }

        function addTypedChildren(container, result, seen, requireDirect) {
            var props = [
                "groupItems",
                "compoundPathItems",
                "pathItems",
                "textFrames",
                "placedItems",
                "rasterItems",
                "symbolItems",
                "meshItems",
                "pluginItems",
                "graphItems",
                "nonNativeItems",
                "legacyTextItems"
            ];
            var i;
            for (i = 0; i < props.length; i++) {
                addCollectionItems(container, props[i], result, seen, requireDirect);
            }
        }

        function sortByStack(items) {
            items.sort(function (a, b) {
                var za = 0;
                var zb = 0;
                try {
                    za = a.absoluteZOrderPosition;
                    zb = b.absoluteZOrderPosition;
                    return zb - za;
                } catch (_) {}
                try {
                    za = a.zOrderPosition;
                    zb = b.zOrderPosition;
                    return za - zb;
                } catch (__) {}
                return 0;
            });
        }

        function artItemCount(items) {
            var n = 0;
            var i;
            for (i = 0; i < items.length; i++) {
                if (typeOf(items[i]) !== "Layer") n++;
            }
            return n;
        }

        function directChildren(container) {
            var result = [];
            var seen = {};
            var i, t;

            t = typeOf(container);

            if (t === "Document") {
                try {
                    for (i = 0; i < container.layers.length; i++) {
                        result.push(container.layers[i]);
                    }
                } catch (_) {}
                return result;
            }

            if (t === "CompoundPathItem") {
                addCollectionItems(container, "pathItems", result, seen, false);
                return result;
            }

            if (t === "Layer") {
                try {
                    for (i = 0; i < container.layers.length; i++) {
                        pushUnique(result, seen, container.layers[i]);
                    }
                } catch (_) {}
            }

            addCollectionItems(container, "pageItems", result, seen, true);

            if (artItemCount(result) === 0) {
                addTypedChildren(container, result, seen, true);
            }

            if (artItemCount(result) === 0) {
                addCollectionItems(container, "groupItems", result, seen, false);
                addCollectionItems(container, "compoundPathItems", result, seen, false);
            }

            if (artItemCount(result) === 0) {
                addTypedChildren(container, result, seen, false);
            }

            sortByStack(result);
            return result;
        }

        function isDestination(item) {
            var t = typeOf(item);
            return t === "Layer" || t === "GroupItem";
        }

        function destinationChildren(container) {
            var result = [];
            var children = directChildren(container);
            var i;
            for (i = 0; i < children.length; i++) {
                if (isDestination(children[i])) result.push(children[i]);
            }
            return result;
        }

        function isStructuralContainer(item) {
            var t = typeOf(item);
            return t === "Layer" || t === "GroupItem" || t === "CompoundPathItem";
        }

        function labeledName(item, counts) {
            var kind = kindLabel(item);
            if (!counts[kind]) counts[kind] = 0;
            counts[kind]++;
            return displayName(item, kind + " " + counts[kind]);
        }

        function objectRowText(entry) {
            var marker;
            var check = "";

            if (entry.children.length > 0) {
                marker = entry.expanded ? "▼ " : "▶ ";
            } else {
                marker = "  ";
            }

            if (entry.selectable) {
                check = picked[entry.id] ? "[x] " : "[ ] ";
            }

            return indentText(entry.depth) + marker + check +
                entry.label + "  [" + kindLabel(entry.ref) + "]";
        }

        var w = new Window(
            "palette",
            "グリーンオーバーレイ",
            undefined,
            { resizeable: true }
        );
        $.global.__greenOverlayWindow = w;

        w.orientation = "column";
        w.alignChildren = ["fill", "top"];
        w.spacing = 8;
        w.margins = 10;

        var intro = w.add(
            "statictext",
            undefined,
            "対象を複数選択し、同じ位置・サイズに緑色の矩形を作成します。"
        );
        intro.characters = 58;

        var destinationPanel = w.add("panel", undefined, "作成先");
        destinationPanel.orientation = "column";
        destinationPanel.alignChildren = ["fill", "fill"];
        destinationPanel.margins = 8;

        var destinationTree = destinationPanel.add("treeview", undefined, []);
        destinationTree.preferredSize = [480, 160];

        var objectPanel = w.add("panel", undefined, "対象オブジェクト");
        objectPanel.orientation = "column";
        objectPanel.alignChildren = ["fill", "fill"];
        objectPanel.margins = 8;

        var toolbar = objectPanel.add("group");
        toolbar.orientation = "row";

        var selectAllButton = toolbar.add("button", undefined, "全選択");
        var clearButton = toolbar.add("button", undefined, "全解除");
        var countText = toolbar.add("statictext", undefined, "0件選択");
        countText.characters = 16;

        /*
          TreeView は onClick が来ない。ネイティブ複数選択は Ctrl/Cmd 必須。
          クリック・トグルは ListBox で扱い、階層の開閉は行テキストで表現する。
        */
        var objectList = objectPanel.add(
            "listbox",
            undefined,
            [],
            { multiselect: false }
        );
        objectList.preferredSize = [480, 330];

        var infoPanel = w.add("panel", undefined, "選択情報");
        infoPanel.orientation = "column";
        infoPanel.alignChildren = ["fill", "top"];
        infoPanel.margins = 8;

        var infoText = infoPanel.add(
            "statictext",
            undefined,
            "オブジェクトを選択してください。",
            { multiline: true }
        );
        infoText.preferredSize = [480, 56];

        var bottom = w.add("group");
        bottom.orientation = "row";
        bottom.alignment = ["fill", "bottom"];

        var statusText = bottom.add("statictext", undefined, "準備完了");
        statusText.alignment = ["fill", "center"];

        var runButton = bottom.add("button", undefined, "確認 / 実行");
        runButton.enabled = false;

        function selectedCount() {
            var count = 0;
            var i;
            for (i = 0; i < objectEntries.length; i++) {
                if (picked[objectEntries[i].id]) count++;
            }
            return count;
        }

        function updateRunState() {
            runButton.enabled =
                selectedCount() > 0 &&
                destinationTree.selection !== null;
        }

        function labelOfItem(item) {
            var i, entry;
            for (i = 0; i < objectEntries.length; i++) {
                entry = objectEntries[i];
                if (entry.ref === item || sameItem(entry.ref, item)) return entry.label;
            }
            return displayName(item, kindLabel(item));
        }

        function updateCountAndInfo(clickedItem) {
            var count = selectedCount();
            countText.text = count + "件選択";

            if (clickedItem) {
                try {
                    var b = boundsOf(clickedItem);
                    infoText.text =
                        "名前: " + labelOfItem(clickedItem) +
                        "\n種類: " + kindLabel(clickedItem) +
                        " / サイズ: " +
                        b.width.toFixed(2) + " × " +
                        b.height.toFixed(2) + " pt" +
                        " / 選択中: " + count + "件";
                } catch (_) {
                    infoText.text = count + "件のオブジェクトを選択中";
                }
            } else {
                infoText.text =
                    count > 0
                        ? count + "件のオブジェクトを選択中"
                        : "オブジェクトを選択してください。";
            }

            updateRunState();
        }

        function applyIllustratorSelection() {
            var i, entry;
            try { doc.selection = null; } catch (_) {}

            for (i = 0; i < objectEntries.length; i++) {
                entry = objectEntries[i];
                if (!entry.selectable || !picked[entry.id]) continue;

                try {
                    entry.ref.selected = true;
                } catch (_) {}
            }
        }

        function activeView() {
            try {
                if (doc.activeView) return doc.activeView;
            } catch (_) {}
            if (doc.views.length > 0) return doc.views[0];
            return null;
        }

        function sendBridgeTalk(code) {
            var bt = new BridgeTalk();
            try {
                bt.target = BridgeTalk.appSpecifier || "illustrator";
            } catch (_) {
                bt.target = "illustrator";
            }
            bt.body = code;
            bt.send();
        }

        function panScript(cx, cy, zoom) {
            return (
                "try{" +
                "if(app.documents.length){" +
                "var d=app.activeDocument;" +
                "var v=d.views[0];" +
                "try{if(d.activeView)v=d.activeView;}catch(e0){}" +
                "var cs=app.coordinateSystem;" +
                "app.coordinateSystem=CoordinateSystem.DOCUMENTCOORDINATESYSTEM;" +
                "var z=" + jsNumber(zoom) + ";" +
                "var p=[" + jsNumber(cx) + "," + jsNumber(cy) + "];" +
                "v.centerPoint=p;" +
                "v.zoom=z*1.001;" +
                "v.centerPoint=p;" +
                "v.zoom=z;" +
                "v.centerPoint=p;" +
                "try{app.coordinateSystem=cs;}catch(e1){}" +
                "try{app.redraw();}catch(e2){}" +
                "try{app.refresh();}catch(e3){}" +
                "}" +
                "}catch(e4){}"
            );
        }

        function panViewTo(item) {
            var b, view, zoom, p;
            if (!item) return;

            b = null;
            withDocumentCoordinates(function () {
                try { b = item.visibleBounds; } catch (_) {}
                if (!b) b = item.geometricBounds;
            });
            if (!b) return;

            zoom = 1;
            try {
                view = activeView();
                if (view) zoom = view.zoom;
            } catch (_) {}

            p = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];

            try {
                withDocumentCoordinates(function () {
                    view = activeView();
                    if (!view) return;
                    view.centerPoint = p;
                    view.zoom = zoom * 1.001;
                    view.centerPoint = p;
                    view.zoom = zoom;
                    view.centerPoint = p;
                });
            } catch (_) {}

            sendBridgeTalk(panScript(p[0], p[1], zoom));
        }

        $.global.__greenOverlayFollowCanvas = function () {
            try {
                applyIllustratorSelection();
                panViewTo(pendingFocusRef);
                try { app.redraw(); } catch (_) {}
                try { app.refresh(); } catch (_) {}
            } catch (_) {}
        };

        function requestCanvasFollow(item) {
            pendingFocusRef = item;
            sendBridgeTalk(
                '#targetengine "greenOverlayEngine"\n' +
                "try{$.global.__greenOverlayFollowCanvas();}catch(e){}"
            );
        }

        function addDestinationBranch(container, uiParent) {
            var children = destinationChildren(container);
            var i, item, node, destKids, counts, label;

            counts = {};
            for (i = 0; i < children.length; i++) {
                item = children[i];
                destKids = destinationChildren(item);
                label = labeledName(item, counts);

                if (destKids.length > 0) {
                    node = uiParent.add("node", label + "  [" + kindLabel(item) + "]");
                    node._destinationIndex = destinationRefs.length;
                    destinationRefs.push(item);
                    addDestinationBranch(item, node);
                    node.expanded = false;
                } else {
                    node = uiParent.add("item", label + "  [" + kindLabel(item) + "]");
                    node._destinationIndex = destinationRefs.length;
                    destinationRefs.push(item);
                }
            }
        }

        function collectObjectBranch(container, depth) {
            var children = directChildren(container);
            var nodes = [];
            var i, item, entry, counts;

            counts = {};
            for (i = 0; i < children.length; i++) {
                item = children[i];
                entry = {
                    id: objectEntries.length,
                    ref: item,
                    depth: depth,
                    selectable: false,
                    expanded: false,
                    children: [],
                    label: labeledName(item, counts)
                };
                objectEntries.push(entry);

                if (isStructuralContainer(item)) {
                    entry.selectable = false;
                    entry.children = collectObjectBranch(item, depth + 1);
                } else {
                    entry.children = collectObjectBranch(item, depth + 1);
                    entry.selectable = entry.children.length === 0;
                }

                nodes.push(entry);
            }

            return nodes;
        }

        function appendVisibleEntries(nodes, out) {
            var i, entry;
            for (i = 0; i < nodes.length; i++) {
                entry = nodes[i];
                out.push(entry);
                if (entry.expanded && entry.children.length > 0) {
                    appendVisibleEntries(entry.children, out);
                }
            }
        }

        function paintObjectList() {
            var visible = [];
            var i, entry, row;

            appendVisibleEntries(objectRoots, visible);

            suppressObjectEvent++;
            try {
                objectList.removeAll();
                objectRows = [];

                for (i = 0; i < visible.length; i++) {
                    entry = visible[i];
                    row = objectList.add("item", objectRowText(entry));
                    objectRows[row.index] = entry;
                    entry.ui = row;
                }
            } finally {
                suppressObjectEvent--;
            }
        }

        function refreshVisibleObjectRows() {
            var i, entry;
            for (i = 0; i < objectRows.length; i++) {
                entry = objectRows[i];
                try {
                    if (entry.ui) entry.ui.text = objectRowText(entry);
                } catch (_) {}
            }
        }

        function rebuildTrees() {
            destinationRefs = [];
            objectEntries = [];
            objectRoots = [];
            objectRows = [];
            picked = {};

            destinationTree.removeAll();
            addDestinationBranch(doc, destinationTree);

            objectRoots = collectObjectBranch(doc, 0);
            paintObjectList();

            countText.text = "0件選択";
            infoText.text = "オブジェクトを選択してください。";
            statusText.text = "準備完了";

            updateRunState();
        }

        destinationTree.onChange = function () {
            try {
                if (destinationTree.selection !== null) {
                    statusText.text =
                        "作成先: " + destinationTree.selection.text;
                }
                updateRunState();
            } catch (e) {
                showError(e);
            }
        };

        function handleObjectListEvent() {
            try {
                var row, entry, now, i;

                if (suppressObjectEvent > 0) return;

                row = objectList.selection;
                if (row === null) return;

                entry = objectRows[row.index];
                if (!entry) return;

                now = (new Date()).getTime();
                if (entry.id === lastObjectEventId && now - lastObjectEventAt < 80) {
                    return;
                }
                lastObjectEventId = entry.id;
                lastObjectEventAt = now;

                if (entry.selectable) {
                    picked[entry.id] = !picked[entry.id];
                    row.text = objectRowText(entry);
                    updateCountAndInfo(entry.ref);
                    requestCanvasFollow(entry.ref);
                    return;
                }

                if (entry.children.length === 0) return;

                entry.expanded = !entry.expanded;

                suppressObjectEvent++;
                try {
                    paintObjectList();
                    for (i = 0; i < objectRows.length; i++) {
                        if (objectRows[i].id === entry.id) {
                            objectList.selection = i;
                            break;
                        }
                    }
                } catch (_) {
                } finally {
                    suppressObjectEvent--;
                }
            } catch (e) {
                showError(e);
            }
        }

        objectList.onClick = handleObjectListEvent;
        objectList.onChange = handleObjectListEvent;

        selectAllButton.onClick = function () {
            try {
                var i, entry;

                for (i = 0; i < objectEntries.length; i++) {
                    entry = objectEntries[i];
                    if (entry.selectable) {
                        picked[entry.id] = true;
                    }
                }

                refreshVisibleObjectRows();
                pendingFocusRef = null;
                requestCanvasFollow(null);
                updateCountAndInfo(null);
                statusText.text = "すべて選択しました。";
            } catch (e) {
                showError(e);
            }
        };

        clearButton.onClick = function () {
            try {
                picked = {};
                refreshVisibleObjectRows();
                pendingFocusRef = null;
                requestCanvasFollow(null);
                updateCountAndInfo(null);
                statusText.text = "すべて解除しました。";
            } catch (e) {
                showError(e);
            }
        };

        function jsString(s) {
            return String(s)
                .replace(/\\/g, "\\\\")
                .replace(/"/g, '\\"')
                .replace(/\r/g, "\\r")
                .replace(/\n/g, "\\n");
        }

        function collectOverlayJobs() {
            var jobs = [];
            var skipped = 0;

            withDocumentCoordinates(function () {
                var i, entry, b, width, height, top, left;

                for (i = 0; i < objectEntries.length; i++) {
                    entry = objectEntries[i];
                    if (!entry.selectable || !picked[entry.id]) continue;

                    b = null;
                    try { b = entry.ref.geometricBounds; } catch (_) {}
                    if (!b) {
                        try { b = entry.ref.visibleBounds; } catch (__) {}
                    }
                    if (!b) {
                        skipped++;
                        continue;
                    }

                    width = Math.abs(b[2] - b[0]);
                    height = Math.abs(b[1] - b[3]);
                    if (width <= 0 || height <= 0) {
                        skipped++;
                        continue;
                    }

                    top = b[1] > b[3] ? b[1] : b[3];
                    left = b[0] < b[2] ? b[0] : b[2];
                    jobs.push({ t: top, l: left, w: width, h: height });
                }
            });

            return { jobs: jobs, skipped: skipped };
        }

        function buildExecuteScript(destination) {
            var collected = collectOverlayJobs();
            var jobs = collected.jobs;
            var i, parts, destType, destName, destZ;

            if (jobs.length === 0) {
                return "alert('対象の境界を取得できないため作成できません。');";
            }

            parts = [];
            for (i = 0; i < jobs.length; i++) {
                parts.push(
                    "{t:" + jsNumber(jobs[i].t) +
                    ",l:" + jsNumber(jobs[i].l) +
                    ",w:" + jsNumber(jobs[i].w) +
                    ",h:" + jsNumber(jobs[i].h) + "}"
                );
            }

            destType = typeOf(destination);
            destName = "";
            destZ = "null";
            try { destName = jsString(destination.name); } catch (_) {}
            try { destZ = jsNumber(destination.absoluteZOrderPosition); } catch (_) {}

            return (
                "(function(){" +
                "if(!app.documents.length){alert('ドキュメントが開かれていません。');return;}" +
                "var doc=app.activeDocument;" +
                "var oldcs=app.coordinateSystem;" +
                "app.coordinateSystem=CoordinateSystem.DOCUMENTCOORDINATESYSTEM;" +
                "function walkLayers(parent,z,name){" +
                "var i,lyr,found;" +
                "if(!parent.layers)return null;" +
                "for(i=0;i<parent.layers.length;i++){" +
                "lyr=parent.layers[i];" +
                "try{if(z!==null&&lyr.absoluteZOrderPosition==z)return lyr;}catch(e0){}" +
                "try{if(name!==''&&lyr.name==name)return lyr;}catch(e1){}" +
                "found=walkLayers(lyr,z,name);if(found)return found;" +
                "}" +
                "return null;" +
                "}" +
                "function findDest(){" +
                "var wantType='" + destType + "';" +
                "var wantZ=" + destZ + ";" +
                "var wantName=\"" + destName + "\";" +
                "var i,g;" +
                "if(wantType=='Layer'){" +
                "var L=walkLayers(doc,wantZ,wantName);if(L)return L;" +
                "}" +
                "if(wantType=='GroupItem'){" +
                "try{" +
                "for(i=0;i<doc.groupItems.length;i++){" +
                "g=doc.groupItems[i];" +
                "try{if(wantZ!==null&&g.absoluteZOrderPosition==wantZ)return g;}catch(e2){}" +
                "}" +
                "}catch(e3){}" +
                "}" +
                "return doc.activeLayer;" +
                "}" +
                "var dest=findDest();" +
                "var jobs=[" + parts.join(",") + "];" +
                "var skipped=" + collected.skipped + ";" +
                "var color=null;" +
                "try{" +
                "if(doc.documentColorSpace===DocumentColorSpace.CMYK){" +
                "color=new CMYKColor();color.cyan=75;color.magenta=0;color.yellow=80;color.black=0;" +
                "}" +
                "}catch(e4){}" +
                "if(!color){color=new RGBColor();color.red=0;color.green=200;color.blue=70;}" +
                "var made=[],failed=skipped,lastError='';" +
                "var i,rect;" +
                "for(i=0;i<jobs.length;i++){" +
                "try{" +
                "rect=null;" +
                "try{rect=dest.pathItems.rectangle(jobs[i].t,jobs[i].l,jobs[i].w,jobs[i].h);}" +
                "catch(e5){" +
                "rect=doc.pathItems.rectangle(jobs[i].t,jobs[i].l,jobs[i].w,jobs[i].h);" +
                "try{rect.move(dest,ElementPlacement.PLACEATBEGINNING);}catch(e6){}" +
                "}" +
                "rect.stroked=false;rect.filled=true;" +
                "try{rect.fillColor=color;}catch(e7){}" +
                "rect.name='グリーンオーバーレイ';" +
                "made.push(rect);" +
                "}catch(e8){failed++;lastError=String(e8);}" +
                "}" +
                "try{app.coordinateSystem=oldcs;}catch(e9){}" +
                "try{doc.selection=made;}catch(e10){}" +
                "try{app.redraw();}catch(e11){}" +
                "try{app.refresh();}catch(e12){}" +
                "if(failed>0){" +
                "alert(made.length+'件を作成しました。\\n'+failed+'件は作成できませんでした。'+(lastError?'\\n\\n'+lastError:''));" +
                "}else{" +
                "alert(made.length+'件を作成しました。');" +
                "}" +
                "})();"
            );
        }

        runButton.onClick = function () {
            try {
                var destinationNode = destinationTree.selection;
                if (destinationNode === null) {
                    alert("作成先を選択してください。");
                    return;
                }

                var destinationIndex = destinationNode._destinationIndex;
                var destination = destinationRefs[destinationIndex];

                if (!destination) {
                    alert("作成先を取得できません。");
                    return;
                }

                try {
                    if (destination.locked) {
                        alert("作成先がロックされています。");
                        return;
                    }
                } catch (_) {}

                var count = selectedCount();
                if (!count) {
                    alert("対象オブジェクトを選択してください。");
                    return;
                }

                if (!confirm(
                    count +
                    "件のオブジェクト上に緑色の要素を作成します。\n" +
                    "実行しますか？"
                )) {
                    return;
                }

                sendBridgeTalk(buildExecuteScript(destination));
                statusText.text = "作成を実行しました。";
            } catch (e) {
                showError(e);
            }
        };

        w.onResizing = w.onResize = function () {
            this.layout.resize();
        };

        w.onClose = function () {
            try {
                $.global.__greenOverlayWindow = null;
                $.global.__greenOverlayFollowCanvas = null;
            } catch (_) {}
        };

        rebuildTrees();
        try { w.layout.layout(true); } catch (_) {}
        w.show();

    } catch (e) {
        showError(e);
    }
}());
