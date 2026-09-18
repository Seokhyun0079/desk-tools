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
        var picked = {};

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
                } else if (t === "CompoundPathItem") {
                    for (i = 0; i < container.pathItems.length; i++) {
                        child = container.pathItems[i];
                        try {
                            if (child.parent === container) result.push(child);
                        } catch (_) {}
                    }
                }
            } catch (_) {}

            return result;
        }

        function hasChildren(item) {
            return directChildren(item).length > 0;
        }

        function isDestination(item) {
            var t = typeOf(item);
            return t === "Layer" || t === "GroupItem";
        }

        function isSelectableTarget(item) {
            var t = typeOf(item);
            return t !== "Layer" &&
                   t !== "GroupItem" &&
                   t !== "CompoundPathItem";
        }

        function objectText(entry) {
            var item = entry.ref;
            if (entry.selectable) {
                return (picked[entry.id] ? "[x] " : "[ ] ") +
                    nameOf(item) + "  [" + kindLabel(item) + "]";
            }
            return nameOf(item) + "  [" + kindLabel(item) + "]";
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

        var objectTree = objectPanel.add("treeview", undefined, []);
        objectTree.preferredSize = [480, 330];

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

        function focusItem(item) {
            try {
                withDocumentCoordinates(function () {
                    var b = item.geometricBounds;
                    var centerX = (b[0] + b[2]) / 2;
                    var centerY = (b[1] + b[3]) / 2;

                    if (doc.views.length > 0) {
                        doc.views[0].centerPoint = [centerX, centerY];
                    }
                });

                app.redraw();
            } catch (e) {
                statusText.text = "表示位置を移動できませんでした。";
            }
        }

        function addDestinationBranch(container, uiParent) {
            var children = directChildren(container);
            var i, item, node;

            for (i = 0; i < children.length; i++) {
                item = children[i];

                if (!isDestination(item)) continue;

                node = uiParent.add(
                    "node",
                    nameOf(item) + "  [" + kindLabel(item) + "]"
                );
                node._destinationIndex = destinationRefs.length;
                destinationRefs.push(item);
                node.expanded = false;

                addDestinationBranch(item, node);
            }
        }

        function addObjectBranch(container, uiParent) {
            var children = directChildren(container);
            var i, item, childList, node, entry;

            for (i = 0; i < children.length; i++) {
                item = children[i];
                childList = directChildren(item);

                entry = {
                    id: objectEntries.length,
                    ref: item,
                    selectable: isSelectableTarget(item),
                    ui: null
                };
                objectEntries.push(entry);

                if (childList.length > 0) {
                    node = uiParent.add("node", objectText(entry));
                    node.expanded = false;
                } else {
                    node = uiParent.add("item", objectText(entry));
                }

                node._entryId = entry.id;
                entry.ui = node;

                if (childList.length > 0) {
                    addObjectBranch(item, node);
                }
            }
        }

        function refreshSelectionMarkers() {
            var i, entry;
            for (i = 0; i < objectEntries.length; i++) {
                entry = objectEntries[i];
                try {
                    entry.ui.text = objectText(entry);
                } catch (_) {}
            }
        }

        function rebuildTrees() {
            statusText.text = "読み込み中…";
            w.update();

            destinationRefs = [];
            objectEntries = [];
            picked = {};

            destinationTree.removeAll();
            objectTree.removeAll();

            addDestinationBranch(doc, destinationTree);
            addObjectBranch(doc, objectTree);

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

        objectTree.onClick = function () {
            try {
                var clicked = objectTree.selection;
                if (clicked === null) return;

                var entryId = clicked._entryId;
                var entry =
                    (entryId === undefined || entryId === null)
                        ? null
                        : objectEntries[entryId];

                if (entry && entry.selectable) {
                    picked[entry.id] = !picked[entry.id];
                    clicked.text = objectText(entry);

                    applyIllustratorSelection();
                    focusItem(entry.ref);
                    updateCountAndInfo(entry.ref);
                }

                /*
                  TreeView 자체의 selection은 단일 선택이므로
                  체크 상태와 혼동되지 않도록 클릭 처리가 끝난 뒤 해제한다.
                  복수 선택 상태는 picked에만 보존된다.
                */
                objectTree.selection = null;
            } catch (e) {
                showError(e);
            }
        };

        selectAllButton.onClick = function () {
            try {
                var i, entry;

                for (i = 0; i < objectEntries.length; i++) {
                    entry = objectEntries[i];
                    if (entry.selectable) {
                        picked[entry.id] = true;
                    }
                }

                refreshSelectionMarkers();
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
                refreshSelectionMarkers();

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
                var destination =
                    destinationRefs[destinationIndex];

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
                    var b, rect;

                    for (i = 0; i < objectEntries.length; i++) {
                        entry = objectEntries[i];

                        if (!entry.selectable ||
                            !picked[entry.id]) {
                            continue;
                        }

                        try {
                            b = entry.ref.geometricBounds;

                            var width = Math.abs(b[2] - b[0]);
                            var height = Math.abs(b[1] - b[3]);

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

        /*
          먼저 패널을 보이고, 그 뒤 계층을 읽는다.
          큰 문서에서도 "아무것도 안 뜨는" 상태를 피한다.
        */
        w.show();
        w.update();
        rebuildTrees();

    } catch (e) {
        showError(e);
    }
}());
