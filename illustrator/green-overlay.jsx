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

        function typeOf(item) {
            try { return item.typename; } catch (_) { return ""; }
        }

        function nameOf(item) {
            try {
                if (item.name) return item.name;
                return "<" + item.typename + ">";
            } catch (_) {
                return "<オブジェクト>";
            }
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
                var b = item.geometricBounds;
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

        function directChildren(container) {
            var result = [];
            var i, child;
            var t = typeOf(container);

            try {
                if (t === "Document") {
                    for (i = 0; i < container.layers.length; i++) {
                        result.push(container.layers[i]);
                    }
                } else if (t === "Layer") {
                    for (i = 0; i < container.pageItems.length; i++) {
                        child = container.pageItems[i];
                        try {
                            if (child.parent === container) result.push(child);
                        } catch (_) {}
                    }
                    for (i = 0; i < container.layers.length; i++) {
                        result.push(container.layers[i]);
                    }
                } else if (t === "GroupItem") {
                    for (i = 0; i < container.pageItems.length; i++) {
                        child = container.pageItems[i];
                        try {
                            if (child.parent === container) result.push(child);
                        } catch (_) {}
                    }
                }
            } catch (_) {}

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

        function isSelectableTarget(item) {
            var t = typeOf(item);
            return t !== "Layer" && t !== "GroupItem";
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
                nameOf(entry.ref) + "  [" + kindLabel(entry.ref) + "]";
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

        var statusText = bottom.add("statictext", undefined, "読み込み中…");
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

        function updateCountAndInfo(clickedItem) {
            var count = selectedCount();
            countText.text = count + "件選択";

            if (clickedItem) {
                try {
                    var b = boundsOf(clickedItem);
                    infoText.text =
                        "名前: " + nameOf(clickedItem) +
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

            try { app.redraw(); } catch (_) {}
        }

        function activeView() {
            try {
                if (doc.activeView) return doc.activeView;
            } catch (_) {}
            if (doc.views.length > 0) return doc.views[0];
            return null;
        }

        function focusItem(item) {
            try {
                withDocumentCoordinates(function () {
                    var b = item.geometricBounds;
                    var centerX = (b[0] + b[2]) / 2;
                    var centerY = (b[1] + b[3]) / 2;
                    var view = activeView();
                    var oldZoom;

                    if (!view) return;

                    oldZoom = view.zoom;
                    view.centerPoint = [centerX, centerY];
                    view.zoom = oldZoom;
                    view.centerPoint = [centerX, centerY];
                });

                app.redraw();
            } catch (e) {
                statusText.text = "表示位置を移動できませんでした。";
            }
        }

        function addDestinationBranch(container, uiParent) {
            var children = destinationChildren(container);
            var i, item, node, destKids;

            for (i = 0; i < children.length; i++) {
                item = children[i];
                destKids = destinationChildren(item);

                if (destKids.length > 0) {
                    node = uiParent.add(
                        "node",
                        nameOf(item) + "  [" + kindLabel(item) + "]"
                    );
                    node._destinationIndex = destinationRefs.length;
                    destinationRefs.push(item);
                    addDestinationBranch(item, node);
                    node.expanded = false;
                } else {
                    node = uiParent.add(
                        "item",
                        nameOf(item) + "  [" + kindLabel(item) + "]"
                    );
                    node._destinationIndex = destinationRefs.length;
                    destinationRefs.push(item);
                }
            }
        }

        function collectObjectBranch(container, depth) {
            var children = directChildren(container);
            var nodes = [];
            var i, item, entry;

            for (i = 0; i < children.length; i++) {
                item = children[i];
                entry = {
                    id: objectEntries.length,
                    ref: item,
                    depth: depth,
                    selectable: isSelectableTarget(item),
                    expanded: false,
                    children: []
                };
                objectEntries.push(entry);

                if (!entry.selectable) {
                    entry.children = collectObjectBranch(item, depth + 1);
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
            statusText.text = "読み込み中…";
            w.update();

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
            w.update();
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
                    applyIllustratorSelection();
                    focusItem(entry.ref);
                    updateCountAndInfo(entry.ref);
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
                applyIllustratorSelection();
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
                try { app.redraw(); } catch (_) {}

                updateCountAndInfo(null);
                statusText.text = "すべて解除しました。";
            } catch (e) {
                showError(e);
            }
        };

        function greenColor() {
            var color = new RGBColor();
            color.red = 0;
            color.green = 200;
            color.blue = 70;
            return color;
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

                var made = [];
                var failed = 0;
                var i, entry;

                withDocumentCoordinates(function () {
                    var b, rect, width, height;

                    for (i = 0; i < objectEntries.length; i++) {
                        entry = objectEntries[i];

                        if (!entry.selectable || !picked[entry.id]) continue;

                        try {
                            b = entry.ref.geometricBounds;
                            width = Math.abs(b[2] - b[0]);
                            height = Math.abs(b[1] - b[3]);

                            if (width <= 0 || height <= 0) {
                                failed++;
                                continue;
                            }

                            rect = destination.pathItems.rectangle(
                                b[1],
                                b[0],
                                width,
                                height
                            );
                            rect.stroked = false;
                            rect.filled = true;
                            rect.fillColor = greenColor();
                            rect.name = "グリーンオーバーレイ";

                            made.push(rect);
                        } catch (_) {
                            failed++;
                        }
                    }
                });

                try { doc.selection = made; } catch (_) {}
                try { app.redraw(); } catch (_) {}

                if (failed > 0) {
                    statusText.text =
                        made.length + "件作成 / " +
                        failed + "件失敗";
                    alert(
                        made.length + "件を作成しました。\n" +
                        failed + "件は作成できませんでした。"
                    );
                } else {
                    statusText.text =
                        made.length + "件を作成しました。";
                    alert(made.length + "件を作成しました。");
                }
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
            } catch (_) {}
        };

        w.show();
        w.update();
        rebuildTrees();

    } catch (e) {
        showError(e);
    }
}());
