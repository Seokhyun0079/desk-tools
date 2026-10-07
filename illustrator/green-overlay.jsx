#target illustrator
#targetengine "greenOverlayEngine"

(function () {
    var sessionStarted = new Date().getTime();
    var logFile = new File(Folder.userData.fsName + "/desk-tools/green-overlay.log");
    function logEvent(stage, error, item) {
        try {
            if (!logFile.parent.exists && !logFile.parent.create()) return false;
            if (logFile.exists && logFile.length > 1024 * 1024) {
                var previous = new File(logFile.fsName + ".1");
                if (previous.exists) previous.remove();
                if (!logFile.copy(previous.fsName)) return false;
                logFile.remove();
            }
            logFile.encoding = "UTF-8";
            if (!logFile.open("a")) return false;
            try {
                var detail = error ? String(error) : "";
                if (error && error.line) detail += " line=" + error.line;
                if (item) {
                    try { detail += " type=" + item.typename; } catch (_) {}
                }
                logFile.writeln(new Date().toString() + " | " + stage + " | " + detail.replace(/[\r\n]+/g, " "));
            } finally { logFile.close(); }
            return true;
        } catch (_) { return false; }
    }

    function showError(e) {
        var logged = logEvent("ui.error", e);
        var line = "";
        try {
            if (e && e.line) line = "\n行: " + e.line;
        } catch (_) {}
        alert("スクリプトエラー\n" + e + line + (logged ? "\nログ: " + logFile.fsName : "\nログを保存できませんでした。"));
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
        var inObjectListHandler = false;
        var cachedZoom = 1;
        try {
            if (doc.views.length > 0) cachedZoom = doc.views[0].zoom;
        } catch (_) {}

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
                if (typeOf(item) === "Layer") {
                    for (var i = 0; i < objectEntries.length; i++) {
                        if (sameItem(objectEntries[i].ref, item)) {
                            b = objectEntries[i].targetBounds;
                            break;
                        }
                    }
                    if (!b) throw new Error("表示中のオブジェクトの範囲がありません。");
                } else {
                    try { b = item.visibleBounds; } catch (_) { b = item.geometricBounds; }
                }
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

        // Layers have no bounds of their own. The UI uses its loaded model;
        // execution refreshes the same calculation from the live DOM before
        // any overlay is created. Never select, group, or move the source art.
        function layerArtworkBounds(root, useModel) {
            function refOf(node) { return useModel ? node.ref : node; }
            function childrenOf(node) { return useModel ? node.children : directChildren(node); }
            function hidden(ref) {
                try {
                    return typeOf(ref) === "Layer" ? ref.visible === false : ref.hidden === true;
                } catch (_) { throw new Error("表示状態を取得できません。"); }
            }
            function normalized(b) {
                if (!b || b.length !== 4) return null;
                for (var i = 0; i < 4; i++) {
                    if (typeof b[i] !== "number" || !isFinite(b[i])) return null;
                }
                return [Math.min(b[0], b[2]), Math.max(b[1], b[3]),
                    Math.max(b[0], b[2]), Math.min(b[1], b[3])];
            }
            function rectOf(ref, mask) {
                var b;
                try { b = normalized(mask ? ref.geometricBounds : ref.visibleBounds); } catch (_) {}
                if (!b) {
                    try { b = normalized(mask ? ref.visibleBounds : ref.geometricBounds); } catch (_) {}
                }
                if (!b) throw new Error("オブジェクトの範囲を取得できません。");
                return b;
            }
            function union(a, b) {
                if (!a) return b;
                if (!b) return a;
                return [Math.min(a[0], b[0]), Math.max(a[1], b[1]),
                    Math.max(a[2], b[2]), Math.min(a[3], b[3])];
            }
            function clipping(node) {
                var ref = refOf(node), t = typeOf(ref);
                if (t === "PathItem") {
                    try { return ref.clipping === true; } catch (_) { return false; }
                }
                if (t === "CompoundPathItem") {
                    var paths = childrenOf(node);
                    for (var i = 0; i < paths.length; i++) {
                        try { if (refOf(paths[i]).clipping) return true; } catch (_) {}
                    }
                }
                return false;
            }
            function walk(node) {
                var ref = refOf(node), t = typeOf(ref);
                if (hidden(ref)) return null;
                if (t === "Layer" || t === "GroupItem") {
                    var kids = childrenOf(node), result = null, clip = null, clipped = false;
                    try { clipped = t === "GroupItem" && ref.clipped; } catch (_) {}
                    for (var i = 0; i < kids.length; i++) {
                        if (clipped && clipping(kids[i])) {
                            clip = rectOf(refOf(kids[i]), true);
                        } else {
                            result = union(result, walk(kids[i]));
                        }
                    }
                    if (clipped && result) {
                        if (!clip) throw new Error("クリッピング範囲を取得できません。");
                        result = [Math.max(result[0], clip[0]), Math.min(result[1], clip[1]),
                            Math.min(result[2], clip[2]), Math.max(result[3], clip[3])];
                        if (result[0] > result[2] || result[3] > result[1]) return null;
                    }
                    return result;
                }
                try { if (t === "PathItem" && ref.guides) return null; } catch (_) {}
                return rectOf(ref, false);
            }
            var ancestor = refOf(root);
            while (ancestor && typeOf(ancestor) !== "Document") {
                if (hidden(ancestor)) return null;
                ancestor = parentOf(ancestor);
            }
            return walk(root);
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
                var au = a.uuid, bu = b.uuid;
                if (typeof au === "string" && au && typeof bu === "string" && bu) return au === bu;
            } catch (_) {}
            try {
                var az = a.absoluteZOrderPosition, bz = b.absoluteZOrderPosition;
                if (typeof az === "number" && typeof bz === "number" && az === bz) return true;
            } catch (_) {}
            return false;
        }

        function itemKey(item) {
            var t = typeOf(item), value;
            try {
                value = item.uuid;
                if (typeof value === "string" && value) return t + "@uuid:" + value;
            } catch (_) {}
            try {
                value = item.absoluteZOrderPosition;
                if (typeof value === "number" && isFinite(value)) return t + "#" + value;
            } catch (_) {}
            try {
                value = item.zOrderPosition;
                if (typeof value === "number" && isFinite(value)) return t + "@local:" + value;
            } catch (_) {}
            return "";
        }

        function pushUnique(result, seen, item) {
            var key = itemKey(item);
            if (key) {
                if (seen[key]) return;
                seen[key] = true;
            } else {
                // Undefined metadata is not an identity. Retain distinct artwork
                // and only remove repeated host references when no key exists.
                for (var i = 0; i < result.length; i++) {
                    if (sameItem(result[i], item)) return;
                }
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

            if (!p) {
                try {
                    if (typeOf(container) === "GroupItem" && container.clipped && item.clipping) return true;
                } catch (_) {}
                return false;
            }
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
            var col, i, item, length;
            try {
                col = container[prop];
                if (!col) return;
                length = col.length;
                for (i = 0; i < length; i++) {
                    item = col[i];
                    if (!requireDirect || isDirectChild(item, container)) {
                        pushUnique(result, seen, item);
                    }
                }
            } catch (e) { logEvent("children." + prop, e, container); }
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

            addTypedChildren(container, result, seen, true);

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

        function descendantSelectionState(entry) {
            var total = 0, selected = 0;

            function walk(nodes) {
                var i, child;
                for (i = 0; i < nodes.length; i++) {
                    child = nodes[i];
                    if (child.selectable) {
                        total++;
                        if (picked[child.id]) selected++;
                    } else if (!child.childrenLoaded) {
                        // Unknown descendants must not be treated as fully selected.
                        total++;
                    } else if (child.children.length > 0) {
                        walk(child.children);
                    }
                }
            }

            walk(entry.children);
            if (total === 0 || selected === 0) return 0;
            if (selected === total) return 2;
            return 1;
        }

        function objectRowText(entry) {
            var check = "";

            if (entry.selectable) {
                check = picked[entry.id] ? "☑ " : "☐ ";
            }

            return check +
                entry.label + "  [" + kindLabel(entry.ref) + "]";
        }

        function setDescendantsPicked(entry, value) {
            ensureObjectChildren(entry);
            var i, child;
            for (i = 0; i < entry.children.length; i++) {
                child = entry.children[i];
                if (child.selectable) {
                    picked[child.id] = value;
                    try { child.ref.selected = value; } catch (e) { logEvent("selection.descendants", e, child.ref); }
                } else if (isStructuralContainer(child.ref)) {
                    setDescendantsPicked(child, value);
                }
            }
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
            "対象を複数選択し、同じ位置・サイズに矩形を作成します。"
        );
        intro.characters = 58;

        var appearancePanel = w.add("panel", undefined, "オーバーレイ設定");
        appearancePanel.orientation = "row";
        appearancePanel.alignChildren = ["left", "center"];
        appearancePanel.margins = 8;

        appearancePanel.add("statictext", undefined, "R");
        var redInput = appearancePanel.add("edittext", undefined, "0");
        redInput.characters = 4;
        appearancePanel.add("statictext", undefined, "G");
        var greenInput = appearancePanel.add("edittext", undefined, "255");
        greenInput.characters = 4;
        appearancePanel.add("statictext", undefined, "B");
        var blueInput = appearancePanel.add("edittext", undefined, "0");
        blueInput.characters = 4;
        appearancePanel.add("statictext", undefined, "不透明度 %");
        var opacityInput = appearancePanel.add("edittext", undefined, "100");
        opacityInput.characters = 4;

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


        // Both lists use native TreeView disclosure buttons.
        var objectList = objectPanel.add("treeview", undefined, []);
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

        var cancelLoadButton = bottom.add("button", undefined, "読み込みを中止");
        var runButton = bottom.add("button", undefined, "確認 / 実行");
        runButton.enabled = false;

        function clampNumber(value, minValue, maxValue) {
            var n = Number(value);
            if (isNaN(n)) return null;
            if (n < minValue) n = minValue;
            if (n > maxValue) n = maxValue;
            return Math.round(n);
        }

        function overlaySettings() {
            var r = clampNumber(redInput.text, 0, 255);
            var g = clampNumber(greenInput.text, 0, 255);
            var b = clampNumber(blueInput.text, 0, 255);
            var opacity = clampNumber(opacityInput.text, 0, 100);
            if (r === null || g === null || b === null || opacity === null) return null;
            redInput.text = String(r);
            greenInput.text = String(g);
            blueInput.text = String(b);
            opacityInput.text = String(opacity);
            return { r: r, g: g, b: b, opacity: opacity };
        }

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
                } catch (e) {
                    logEvent("bounds.info", e, clickedItem);
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

        function applyIllustratorSelection(entry) {
            if (!entry || !entry.selectable) return;
            try {
                entry.ref.selected = !!picked[entry.id];
            } catch (e) { logEvent("selection.item", e, entry.ref); }
        }

        function activeView() {
            try {
                if (doc.activeView) return doc.activeView;
            } catch (_) {}
            if (doc.views.length > 0) return doc.views[0];
            return null;
        }

        function zOrderOf(item) {
            try { return item.absoluteZOrderPosition; } catch (_) { return null; }
        }

        function currentZoom() {
            try {
                var view = activeView();
                if (view && view.zoom) return view.zoom;
            } catch (_) {}
            return cachedZoom;
        }

        function sendBridgeTalk(code) {
            var bt = new BridgeTalk();
            try {
                bt.target = BridgeTalk.appSpecifier || "illustrator";
            } catch (_) {
                bt.target = "illustrator";
            }
            bt.body = code;
            bt.onError = function (message) { logEvent("bridgetalk.error", message.body); };
            if (!bt.send()) logEvent("bridgetalk.send", "Message could not be sent");
        }

        function panToPointScript(x, y, zoom) {
            return (
                "(function(){" +
                "if(!app.documents.length)return;" +
                "var doc=app.activeDocument;" +
                "var v=doc.views[0];" +
                "try{if(doc.activeView)v=doc.activeView;}catch(e0){}" +
                "var p=[" + jsNumber(x) + "," + jsNumber(y) + "];" +
                "v.centerPoint=p;" +
                "try{v.zoom=" + jsNumber(zoom) + ";}catch(e1){}" +
                "})();"
            );
        }

        function requestCanvasFollow(entry) {
            if (!entry || !entry.ref) return;
            try {
                var b = boundsOf(entry.ref);
                sendBridgeTalk(
                    panToPointScript(
                        (b.left + b.right) / 2,
                        (b.top + b.bottom) / 2,
                        currentZoom()
                    )
                );
            } catch (e) { logEvent("view.follow", e, entry.ref); }
        }

        function addDestinationBranch(entries, uiParent) {
            for (var i = 0; i < entries.length; i++) {
                var entry = entries[i];
                if (!isDestination(entry.ref)) continue;
                var kids = [];
                for (var j = 0; j < entry.children.length; j++) {
                    if (isDestination(entry.children[j].ref)) kids.push(entry.children[j]);
                }
                var node = uiParent.add(kids.length ? "node" : "item", entry.label + "  [" + kindLabel(entry.ref) + "]");
                node._destinationIndex = destinationRefs.length;
                var info = {ref: entry.ref, z: entry.zOrder, type: entry.itemType, name: ""};
                try { info.name = String(entry.ref.name); } catch (_) {}
                destinationRefs.push(info);
                if (kids.length) {
                    addDestinationBranch(kids, node);
                    node.expanded = false;
                }
            }
        }

        // Both native trees share one model; leaf objects do not scan child collections.
        function collectObjectBranch(container, depth) {
            var children = directChildren(container);
            var nodes = [], counts = {};
            for (var i = 0; i < children.length; i++) {
                var item = children[i];
                var structural = isStructuralContainer(item);
                var entry = {
                    id: objectEntries.length, ref: item, depth: depth,
                    selectable: !structural, expanded: false, children: [],
                    childrenLoaded: !structural,
                    label: labeledName(item, counts),
                    zOrder: zOrderOf(item), itemType: typeOf(item)
                };
                objectEntries.push(entry);
                nodes.push(entry);
            }
            return nodes;
        }

        function ensureObjectChildren(entry) {
            if (entry.childrenLoaded) return;
            var started = new Date().getTime();
            entry.children = collectObjectBranch(entry.ref, entry.depth + 1);
            entry.childrenLoaded = true;
            logEvent("children.loaded", "elapsedMs=" + (new Date().getTime() - started) + " count=" + entry.children.length, entry.ref);
        }

        function loadAllTargets(nodes) {
            for (var i = 0; i < nodes.length; i++) {
                var entry = nodes[i];
                if (!entry.selectable) {
                    ensureObjectChildren(entry);
                    loadAllTargets(entry.children);
                }
            }
        }

        function addObjectNodes(entries, parent) {
            for (var i = 0; i < entries.length; i++) {
                var entry = entries[i];
                var node = parent.add(entry.children.length || entry.itemType === "Layer" ? "node" : "item", objectRowText(entry));
                if (parent !== objectList) parent.expanded = true;
                node._entry = entry;
                entry.ui = node;
                objectRows.push({ui: node, entry: entry});
                if (entry.children.length) {
                    var toggle = node.add("item", "☐ 配下を全選択 / 全解除");
                    toggle._entry = {descendantToggle: true, parentEntry: entry};
                    objectRows.push({ui: toggle, entry: toggle._entry});
                    node.expanded = true;
                    addLayerTargetRow(entry, node);
                    addObjectNodes(entry.children, node);
                    node.expanded = false;
                } else if (entry.itemType === "Layer") {
                    addLayerTargetRow(entry, node);
                    node.expanded = false;
                }
            }
        }

        function addLayerTargetRow(entry, node) {
            if (entry.itemType !== "Layer") return;
            var target = node.add("item", "☐ このレイヤーを対象にする");
            target._entry = {layerTarget: true, parentEntry: entry};
            objectRows.push({ui: target, entry: target._entry});
            node.expanded = true;
        }

        function paintObjectList() {
            suppressObjectEvent++;
            try {
                objectList.removeAll();
                objectRows = [];
                addObjectNodes(objectRoots, objectList);
            } finally { suppressObjectEvent--; }
        }

        function refreshVisibleObjectRows() {
            for (var i = 0; i < objectRows.length; i++) {
                var row = objectRows[i], entry = row.entry;
                if (entry.layerTarget) {
                    row.ui.text = (picked[entry.parentEntry.id] ? "☑ " : "☐ ") + "このレイヤーを対象にする";
                } else if (entry.descendantToggle) {
                    var state = descendantSelectionState(entry.parentEntry);
                    row.ui.text = (state === 2 ? "☑ " : (state === 1 ? "◩ " : "☐ ")) + "配下を全選択 / 全解除";
                } else {
                    row.ui.text = objectRowText(entry);
                }
            }
        }

        var loading = false;
        var loadToken = String(new Date().getTime()) + ":" + Math.random();
        var scanJobs = [], uiJobs = [], ticks = 0, scanned = 0;
        var typedProps = ["groupItems", "compoundPathItems", "pathItems", "textFrames", "placedItems", "rasterItems", "symbolItems", "meshItems", "pluginItems", "graphItems", "nonNativeItems", "legacyTextItems"];
        // Mixed containers need every typed collection, including linked/embedded
        // images and symbols. Keep only direct children and remove duplicates.
        var supplementProps = typedProps;
        var nodesToCollapse = [];

        function captureDiagnosticCounts() {
            var counts = {};
            for (var i = 0; i < objectEntries.length; i++) {
                // itemType was cached by the existing loader. Do not make new
                // Illustrator DOM calls just to prepare a diagnostic report.
                var t = objectEntries[i].itemType || "Unknown";
                counts[t] = (counts[t] || 0) + 1;
            }
            $.global.__greenOverlayDiagnostic = {schema: "overlay-counts-v1", state: "ready", counts: counts};
        }

        function enableLists(value) {
            destinationTree.enabled = objectList.enabled = value;
            selectAllButton.enabled = clearButton.enabled = value;
            runButton.enabled = false;
            cancelLoadButton.enabled = !value;
        }

        function scanJob(ref, depth, out) {
            var t = typeOf(ref);
            var props = t === "Document" ? ["layers"] :
                (t === "CompoundPathItem" ? ["pathItems"] :
                    (t === "Layer" ? ["layers", "pageItems"] : ["pageItems"]));
            return {ref: ref, depth: depth, out: out, props: props, prop: 0,
                col: null, index: 0, length: 0, refs: [], seen: {}, counts: {}, stage: 0, build: 0};
        }

        // A BridgeTalk callback can run while the open file is temporarily "not a document".
        // Layer reads there finish as an empty tree and the status still says ready.
        // Read the hierarchy in this turn, after the window is visible.
        function runLoadInline() {
            try {
                while (loading) loadStep(loadToken);
            } catch (e) {
                stopLoading("読み込みに失敗しました。", e);
                showError(e);
            }
        }

        function collapseFinishedNodes() {
            for (var i = nodesToCollapse.length - 1; i >= 0; i--) {
                try { nodesToCollapse[i].expanded = false; } catch (_) {}
            }
            nodesToCollapse = [];
        }

        function relayout() {
            try { w.layout.layout(true); } catch (e) { logEvent("ui.layout", e); }
            try { destinationTree.layout.layout(true); } catch (_) {}
            try { objectList.layout.layout(true); } catch (_) {}
            try { w.update(); } catch (_) {}
        }

        function layerLength(target) {
            try {
                var layers = target.layers;
                if (!layers || typeof layers.length !== "number") return -1;
                return layers.length;
            } catch (e) {
                logEvent("children.layers", e, target);
                return -1;
            }
        }

        function useReadableDocument() {
            if (layerLength(doc) > 0) return true;
            try {
                var active = app.activeDocument;
                if (active && layerLength(active) > 0) {
                    doc = active;
                    logEvent("startup.document", "rebound");
                    return true;
                }
            } catch (e) {
                logEvent("startup.document", e);
            }
            return false;
        }

        function stopLoading(message, error) {
            loading = false;
            enableLists(false);
            cancelLoadButton.enabled = false;
            statusText.text = message;
            logEvent(error ? "startup.failed" : "startup.cancelled", error || "User cancelled");
        }

        cancelLoadButton.onClick = function () { stopLoading("読み込みを中止しました。再実行してください。"); };

        function readOne(job) {
            if (job.prop < job.props.length) {
                var prop = job.props[job.prop];
                if (!job.col) {
                    try { job.col = job.ref[prop]; job.length = job.col ? job.col.length : 0; }
                    catch (e) { logEvent("children." + prop, e, job.ref); job.length = 0; }
                }
                if (job.index < job.length) {
                    try {
                        var item = job.col[job.index++];
                        if (prop === "layers" || typeOf(job.ref) === "CompoundPathItem" || job.stage >= 2 || isDirectChild(item, job.ref)) {
                            pushUnique(job.refs, job.seen, item);
                        }
                        scanned++;
                    } catch (e) { logEvent("children.item", e, job.ref); }
                    return false;
                }
                job.prop++; job.col = null; job.index = 0;
                return false;
            }
            if (job.stage < 1 && typeOf(job.ref) !== "Document" && typeOf(job.ref) !== "CompoundPathItem") {
                job.stage = 1; job.props = supplementProps; job.prop = 0;
                return false;
            }
            // Last resort for hosts whose direct-child test rejects every item.
            if (job.stage < 2 && typeOf(job.ref) !== "Document" && typeOf(job.ref) !== "CompoundPathItem" && artItemCount(job.refs) === 0) {
                job.stage = 2; job.props = typedProps; job.prop = 0;
                return false;
            }
            if (!job.sorted) {
                sortByStack(job.refs); job.sorted = true;
            }
            if (job.build < job.refs.length) {
                var ref = job.refs[job.build++], structural = isStructuralContainer(ref);
                var entry = {id: objectEntries.length, ref: ref, depth: job.depth,
                    selectable: !structural, expanded: false, children: [], childrenLoaded: true,
                    label: labeledName(ref, job.counts), zOrder: zOrderOf(ref), itemType: typeOf(ref)};
                objectEntries.push(entry); job.out.push(entry);
                if (structural) scanJobs.unshift(scanJob(ref, job.depth + 1, entry.children));
                return false;
            }
            return true;
        }

        function drawOne(job) {
            var entry = job.entry;
            var node = job.objectParent.add(entry.children.length || entry.itemType === "Layer" ? "node" : "item", objectRowText(entry));
            // Expand only after a real child exists; an empty node may ignore it.
            if (job.objectParent !== objectList) job.objectParent.expanded = true;
            node._entry = entry; entry.ui = node;
            objectRows.push({ui: node, entry: entry});
            if (entry.children.length) {
                nodesToCollapse.push(node);
                var toggle = node.add("item", "☐ 配下を全選択 / 全解除");
                node.expanded = true;
                toggle._entry = {descendantToggle: true, parentEntry: entry};
                objectRows.push({ui: toggle, entry: toggle._entry});
            } else if (entry.itemType === "Layer") {
                nodesToCollapse.push(node);
            }
            addLayerTargetRow(entry, node);
            var destParent = job.destParent;
            if (isDestination(entry.ref)) {
                var hasDest = false;
                for (var k = 0; k < entry.children.length; k++) {
                    if (isDestination(entry.children[k].ref)) { hasDest = true; break; }
                }
                var dest = destParent.add(hasDest ? "node" : "item", entry.label + "  [" + kindLabel(entry.ref) + "]");
                if (destParent !== destinationTree) destParent.expanded = true;
                dest._destinationIndex = destinationRefs.length;
                var info = {ref: entry.ref, z: entry.zOrder, type: entry.itemType, name: ""};
                try { info.name = String(entry.ref.name); } catch (_) {}
                destinationRefs.push(info);
                if (hasDest) {
                    nodesToCollapse.push(dest);
                }
                destParent = dest;
            }
            for (var i = entry.children.length - 1; i >= 0; i--) {
                uiJobs.push({entry: entry.children[i], objectParent: node, destParent: destParent});
            }
        }

        function capturedDocumentClosed() {
            try {
                return !app.documents.length;
            } catch (_) {
                return false;
            }
        }

        function loadStep(token) {
            if (!loading || token !== loadToken) return;
            try {
                if (capturedDocumentClosed()) {
                    stopLoading("ドキュメントが変わりました。再実行してください。"); return;
                }
                var started = new Date().getTime(), units = 0;
                while (units++ < 64 && new Date().getTime() - started < 20) {
                    if (scanJobs.length) {
                        var job = scanJobs[0];
                        if (readOne(job)) {
                            // Child jobs may have been prepended during the previous unit.
                            scanJobs.shift();
                        }
                    } else {
                        if (!uiStarted) {
                            uiStarted = true;
                            for (var i = objectRoots.length - 1; i >= 0; i--) {
                                uiJobs.push({entry: objectRoots[i], objectParent: objectList, destParent: destinationTree});
                            }
                        }
                        if (!uiJobs.length) {
                            loading = false; enableLists(true); updateRunState();
                            collapseFinishedNodes();
                            relayout();
                            captureDiagnosticCounts();
                            statusText.text = objectRoots.length
                                ? "準備完了"
                                : "レイヤーを読み取れませんでした。再実行してください。";
                            logEvent("startup.ready", "elapsedMs=" + (new Date().getTime() - sessionStarted) + " entries=" + objectEntries.length + " roots=" + objectRoots.length);
                            return;
                        }
                        drawOne(uiJobs.pop());
                    }
                }
                var frames = ["◐", "◓", "◑", "◒"];
                statusText.text = frames[ticks++ % 4] + (uiStarted ? " 一覧を作成中… " : " 読み込み中… ") + objectEntries.length + "件 / 調査 " + scanned + "件";
                w.update();
            } catch (e) { stopLoading("読み込みに失敗しました。", e); showError(e); }
        }
        var uiStarted = false;

        function rebuildTrees() {
            $.global.__greenOverlayDiagnostic = {schema: "overlay-counts-v1", state: "loading", counts: {}};
            destinationRefs = []; objectEntries = []; objectRoots = []; objectRows = []; picked = {};
            destinationTree.removeAll(); objectList.removeAll();
            nodesToCollapse = [];
            loading = true; enableLists(false);
            if (!useReadableDocument()) {
                loading = false;
                enableLists(false);
                cancelLoadButton.enabled = false;
                statusText.text = "レイヤーを読み取れませんでした。再実行してください。";
                logEvent("startup.failed", "No readable layers");
                relayout();
                return;
            }
            scanJobs = [scanJob(doc, 0, objectRoots)]; uiJobs = []; uiStarted = false;
            statusText.text = "読み込み中…";
            runLoadInline();
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
                var row, entry, i;

                if (suppressObjectEvent > 0 || inObjectListHandler) return;
                inObjectListHandler = true;

                row = objectList.selection;
                if (row === null) {
                    inObjectListHandler = false;
                    return;
                }

                entry = row._entry;
                if (!entry) {
                    inObjectListHandler = false;
                    return;
                }

                if (entry.layerTarget) {
                    var layerEntry = entry.parentEntry;
                    var selectLayer = !picked[layerEntry.id];
                    if (selectLayer) {
                        layerEntry.targetBounds = withDocumentCoordinates(function () {
                            return layerArtworkBounds(layerEntry, true);
                        });
                        if (!layerEntry.targetBounds) {
                            alert("表示中のオブジェクトがないため、このレイヤーは対象にできません。");
                            suppressObjectEvent++;
                            try { objectList.selection = null; } catch (_) {}
                            suppressObjectEvent--;
                            inObjectListHandler = false;
                            return;
                        }
                    }
                    picked[layerEntry.id] = selectLayer;
                    refreshVisibleObjectRows();
                    updateCountAndInfo(layerEntry.ref);
                    if (selectLayer) requestCanvasFollow(layerEntry);
                    suppressObjectEvent++;
                    try { objectList.selection = null; } catch (_) {}
                    suppressObjectEvent--;
                    inObjectListHandler = false;
                    return;
                }

                if (entry.descendantToggle) {
                    var parentEntry = entry.parentEntry;
                    var turnOn = descendantSelectionState(parentEntry) !== 2;
                    setDescendantsPicked(parentEntry, turnOn);
                    refreshVisibleObjectRows();
                    updateCountAndInfo(null);
                    statusText.text = turnOn
                        ? "配下をすべて選択しました。"
                        : "配下をすべて解除しました。";
                    suppressObjectEvent++;
                    try { objectList.selection = null; } catch (_) {}
                    suppressObjectEvent--;
                    inObjectListHandler = false;
                    return;
                }

                if (entry.selectable) {
                    picked[entry.id] = !picked[entry.id];
                    refreshVisibleObjectRows();
                    updateCountAndInfo(entry.ref);
                    try { applyIllustratorSelection(entry); } catch (_) {}
                    if (picked[entry.id]) requestCanvasFollow(entry);
                    suppressObjectEvent++;
                    try { objectList.selection = null; } catch (_) {}
                    suppressObjectEvent--;
                    inObjectListHandler = false;
                    return;
                }

                // Container disclosure is handled exclusively by the native TreeView.
                inObjectListHandler = false;
            } catch (e) {
                inObjectListHandler = false;
                showError(e);
            }
        }

        objectList.onClick = null;
        objectList.onChange = handleObjectListEvent;

        selectAllButton.onClick = function () {
            try {
                loadAllTargets(objectRoots);
                var i, entry;

                for (i = 0; i < objectEntries.length; i++) {
                    entry = objectEntries[i];
                    if (entry.selectable) {
                        picked[entry.id] = true;
                    }
                }

                refreshVisibleObjectRows();
                try {
                    for (i = 0; i < objectEntries.length; i++) {
                        entry = objectEntries[i];
                        if (entry.selectable) {
                            try { entry.ref.selected = true; } catch (e) { logEvent("selection.all", e, entry.ref); }
                        }
                    }
                } catch (_) {}
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
                try { doc.selection = null; } catch (_) {}
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

        function syncIllustratorSelectionFromPicked() {
            var i, entry;
            try { doc.selection = null; } catch (_) {}

            for (i = 0; i < objectEntries.length; i++) {
                entry = objectEntries[i];
                if (!entry.selectable || !picked[entry.id]) continue;
                try { entry.ref.selected = true; } catch (e) { logEvent("selection.sync", e, entry.ref); }
            }
        }

        function collectPickedKeys() {
            var keys = [];
            var i, entry;
            for (i = 0; i < objectEntries.length; i++) {
                entry = objectEntries[i];
                if (!picked[entry.id]) continue;
                if (entry.itemType === "Layer") {
                    // Snapshot every layer before creating any overlays. Inserting
                    // an overlay into a source layer must not enlarge later targets.
                    var b = withDocumentCoordinates(function () {
                        return layerArtworkBounds(entry.ref, false);
                    });
                    entry.targetBounds = b;
                    keys.push("{t:\"Layer\",b:" + (b ? "[" +
                        jsNumber(b[0]) + "," + jsNumber(b[1]) + "," +
                        jsNumber(b[2]) + "," + jsNumber(b[3]) + "]" : "null") + "}");
                    continue;
                }
                if (!entry.selectable) continue;
                if (entry.zOrder === null || entry.zOrder === undefined) continue;
                keys.push(
                    "{z:" + jsNumber(entry.zOrder) +
                    ",t:\"" + jsString(entry.itemType) + "\"}"
                );
            }
            return keys;
        }

        function hostLoggerSource() {
            return 'var logFile=new File("' + jsString(logFile.fsName) + '");' + logEvent.toString() + ';';
        }

        function buildExecuteScript(destInfo, settings) {
            var keys = collectPickedKeys();
            var destType, destName, destZ;

            if (keys.length === 0) {
                return "alert('対象オブジェクトを特定できません。');";
            }

            destType = destInfo.type || "Layer";
            destName = jsString(destInfo.name || "");
            destZ = destInfo.z === null || destInfo.z === undefined
                ? "null"
                : jsNumber(destInfo.z);

            return (
                "(function(){" + hostLoggerSource() +
                "if(!app.documents.length){logEvent('execute.document','No document');alert('ドキュメントが開かれていません。');return;}" +
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
                "function keyOf(z,t){return t+'#'+z;}" +
                "function collectSources(keys){" +
                "var wanted={},found={},result=[],i,item,k,hasArt=false;" +
                "for(i=0;i<keys.length;i++){if(keys[i].t!='Layer'){wanted[keyOf(keys[i].z,keys[i].t)]=true;hasArt=true;}}" +
                "if(!hasArt){for(i=0;i<keys.length;i++)result.push(null);return result;}" +
                "try{" +
                "for(i=0;i<doc.pageItems.length;i++){" +
                "item=doc.pageItems[i];" +
                "try{k=keyOf(item.absoluteZOrderPosition,item.typename);}catch(e4){continue;}" +
                "if(wanted[k]&&!found[k])found[k]=item;" +
                "}" +
                "}catch(e5){logEvent('sources.pageItems',e5);}" +
                "try{" +
                "for(i=0;i<doc.pathItems.length;i++){" +
                "item=doc.pathItems[i];" +
                "try{k=keyOf(item.absoluteZOrderPosition,item.typename);}catch(e6){continue;}" +
                "if(wanted[k]&&!found[k])found[k]=item;" +
                "}" +
                "}catch(e7){logEvent('sources.pathItems',e7);}" +
                "for(i=0;i<keys.length;i++){" +
                "k=keyOf(keys[i].z,keys[i].t);" +
                "result.push(found[k]||null);" +
                "}" +
                "return result;" +
                "}" +
                "var dest=findDest();" +
                "var keys=[" + keys.join(",") + "];" +
                "var sources=collectSources(keys);" +
                "var selectionFallback=[];" +
                "try{for(var si=0;si<doc.selection.length;si++)selectionFallback.push(doc.selection[si]);}catch(eSel){}" +
                "var color=new RGBColor();" +
                "color.red=" + settings.r + ";color.green=" + settings.g + ";color.blue=" + settings.b + ";" +
                "var overlayOpacity=" + settings.opacity + ";" +
                "var made=[],failed=0,lastError='',fallbackIndex=0;" +
                "var i,src,b,w,h,top,left,rect;" +
                "for(i=0;i<sources.length;i++){" +
                "try{" +
                "src=null;" +
                "if(keys[i].t=='Layer'){" +
                "b=keys[i].b;" +
                "if(!b){failed++;lastError='レイヤーに表示中の範囲がありません';logEvent('execute.layerBounds',lastError);continue;}" +
                "}else{" +
                "src=sources[i];" +
                "if(!src&&fallbackIndex<selectionFallback.length){src=selectionFallback[fallbackIndex++];}" +
                "if(!src){failed++;lastError='対象が見つかりません';logEvent('execute.source',lastError);continue;}" +
                "try{b=src.visibleBounds;}catch(e8){b=src.geometricBounds;}" +
                "}" +
                "w=Math.abs(b[2]-b[0]);h=Math.abs(b[1]-b[3]);" +
                "if(w<=0||h<=0){failed++;logEvent('execute.bounds','Non-positive bounds',src);continue;}" +
                "top=b[1]>b[3]?b[1]:b[3];left=b[0]<b[2]?b[0]:b[2];" +
                "rect=null;" +
                "try{rect=dest.pathItems.rectangle(top,left,w,h);}" +
                "catch(e10){" +
                "rect=doc.pathItems.rectangle(top,left,w,h);" +
                "try{rect.move(dest,ElementPlacement.PLACEATBEGINNING);}catch(e11){logEvent('execute.move',e11);}" +
                "}" +
                "rect.stroked=false;rect.filled=true;" +
                "try{rect.fillColor=color;}catch(e12){logEvent('execute.color',e12);}" +
                "try{rect.opacity=overlayOpacity;}catch(eOpacity){logEvent('execute.opacity',eOpacity);}" +
                "rect.name='オーバーレイ';" +
                "try{rect.zOrder(ZOrderMethod.BRINGTOFRONT);}catch(eZ){logEvent('execute.zOrder',eZ);}" +
                "made.push(rect);" +
                "}catch(e13){failed++;lastError=String(e13);logEvent('execute.create',e13,src);}" +
                "}" +
                "try{app.coordinateSystem=oldcs;}catch(e14){logEvent('execute.coordinates',e14);}" +
                "try{doc.selection=made;}catch(e15){logEvent('execute.selection',e15);}" +
                "try{app.redraw();}catch(e16){logEvent('execute.redraw',e16);}" +
                "logEvent('execute.complete','made='+made.length+' failed='+failed);" +
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
                var destInfo = destinationRefs[destinationIndex];

                if (!destInfo || !destInfo.ref) {
                    alert("作成先を取得できません。");
                    return;
                }

                try {
                    if (destInfo.ref.locked) {
                        alert("作成先がロックされています。");
                        return;
                    }
                } catch (_) {}

                var settings = overlaySettings();
                if (!settings) {
                    alert("RGB は 0〜255、不透明度は 0〜100 の数値で入力してください。");
                    return;
                }

                var count = selectedCount();
                if (!count) {
                    alert("対象オブジェクトを選択してください。");
                    return;
                }

                if (!confirm(
                    count +
                    "件のオブジェクト上に矩形を作成します。\n" +
                    "RGB: " + settings.r + ", " + settings.g + ", " + settings.b +
                    " / 不透明度: " + settings.opacity + "%\n" +
                    "実行しますか？"
                )) {
                    return;
                }

                syncIllustratorSelectionFromPicked();
                sendBridgeTalk(buildExecuteScript(destInfo, settings));
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
                loading = false;
                $.global.__greenOverlayDiagnostic = null;
                $.global.__greenOverlayWindow = null;
                try { w.hide(); } catch (_) {}
                try { w.close(); } catch (_) {}
            } catch (_) {}
            return true;
        };

        enableLists(false);
        try { w.layout.layout(true); } catch (e) { logEvent("ui.layout", e); }
        w.show();
        w.update();
        rebuildTrees();

    } catch (e) {
        showError(e);
    }
}());
