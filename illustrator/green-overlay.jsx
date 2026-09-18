#target illustrator
#targetengine "greenOverlayEngine"

(function () {
    function showError(e) {
        var line = "";
        try { if (e.line) line = "\n行: " + e.line; } catch (_) {}
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
        var objectRefs = [];
        var objectRows = [];
        var destinationRefs = [];
        var picked = {};

        function typeOf(item) {
            try { return item.typename; } catch (e) { return ""; }
        }

        function nameOf(item) {
            try {
                if (item.name) return item.name;
                return "<" + item.typename + ">";
            } catch (e) {
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
            return t || "オブジェクト";
        }

        function directChildren(container) {
            var result = [];
            var i, item;
            var t = typeOf(container);

            try {
                if (t === "Document") {
                    for (i = 0; i < container.layers.length; i++) {
                        result.push(container.layers[i]);
                    }
                } else if (t === "Layer") {
                    for (i = 0; i < container.pageItems.length; i++) {
                        item = container.pageItems[i];
                        try {
                            if (item.parent === container) result.push(item);
                        } catch (_) {}
                    }
                    for (i = 0; i < container.layers.length; i++) {
                        result.push(container.layers[i]);
                    }
                } else if (t === "GroupItem") {
                    for (i = 0; i < container.pageItems.length; i++) {
                        item = container.pageItems[i];
                        try {
                            if (item.parent === container) result.push(item);
                        } catch (_) {}
                    }
                }
            } catch (_) {}

            return result;
        }

        function boundsOf(item) {
            var b = item.geometricBounds;
            return {
                left: b[0],
                top: b[1],
                right: b[2],
                bottom: b[3],
                width: Math.abs(b[2] - b[0]),
                height: Math.abs(b[1] - b[3])
            };
        }

        function indent(depth) {
            var s = "";
            for (var i = 0; i < depth; i++) s += "    ";
            return s;
        }

        function isTargetable(item) {
            var t = typeOf(item);
            return t !== "Layer" && t !== "GroupItem";
        }

        var w = new Window("palette", "グリーンオーバーレイ", undefined, { resizeable: true });
        $.global.__greenOverlayWindow = w;

        w.orientation = "column";
        w.alignChildren = ["fill", "top"];
        w.spacing = 8;
        w.margins = 10;

        var intro = w.add("statictext", undefined, "対象と同じ位置・サイズに緑色の矩形を作成します。");
        intro.characters = 52;

        var destinationPanel = w.add("panel", undefined, "作成先");
        destinationPanel.orientation = "column";
        destinationPanel.alignChildren = ["fill", "fill"];
        destinationPanel.margins = 8;

        var destinationList = destinationPanel.add("listbox", undefined, [], { multiselect: false });
        destinationList.preferredSize = [460, 150];

        var objectPanel = w.add("panel", undefined, "対象オブジェクト");
        objectPanel.orientation = "column";
        objectPanel.alignChildren = ["fill", "fill"];
        objectPanel.margins = 8;

        var toolbar = objectPanel.add("group");
        toolbar.orientation = "row";

        var selectAllButton = toolbar.add("button", undefined, "全選択");
        var clearButton = toolbar.add("button", undefined, "全解除");
        var countText = toolbar.add("statictext", undefined, "0件選択");
        countText.characters = 15;

        var objectList = objectPanel.add("listbox", undefined, [], { multiselect: false });
        objectList.preferredSize = [460, 320];

        var infoPanel = w.add("panel", undefined, "選択情報");
        infoPanel.orientation = "column";
        infoPanel.alignChildren = ["fill", "top"];
        infoPanel.margins = 8;

        var infoText = infoPanel.add("statictext", undefined, "オブジェクトを選択してください。", { multiline: true });
        infoText.preferredSize = [460, 54];

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
            for (i = 0; i < objectRefs.length; i++) {
                if (picked[i]) count++;
            }
            return count;
        }

        function updateRunState() {
            runButton.enabled = selectedCount() > 0 && destinationList.selection !== null;
        }

        function rowText(meta) {
            if (meta.targetable) {
                return indent(meta.depth) + (picked[meta.refIndex] ? "[x] " : "[ ] ") +
                    nameOf(objectRefs[meta.refIndex]) + "  [" + kindLabel(objectRefs[meta.refIndex]) + "]";
            }
            return indent(meta.depth) + nameOf(objectRefs[meta.refIndex]) +
                "  [" + kindLabel(objectRefs[meta.refIndex]) + "]";
        }

        function refreshObjectRowTexts() {
            var i;
            for (i = 0; i < objectRows.length; i++) {
                objectRows[i].listItem.text = rowText(objectRows[i]);
            }
        }

        function applyIllustratorSelection() {
            var i, item;
            try { doc.selection = null; } catch (_) {}

            for (i = 0; i < objectRefs.length; i++) {
                if (!picked[i]) continue;
                item = objectRefs[i];
                try { item.selected = true; } catch (_) {}
            }

            app.redraw();
        }

        function focusItem(item) {
            try {
                var b = boundsOf(item);
                var centerX = (b.left + b.right) / 2;
                var centerY = (b.top + b.bottom) / 2;
                if (doc.views.length > 0) {
                    var view = doc.views[0];
                    var oldZoom = view.zoom;
                    view.centerPoint = [centerX, centerY];
                    view.zoom = oldZoom;
                }
                app.redraw();
            } catch (_) {}
        }

        function updateInfo(item) {
            var count = selectedCount();

            if (!item) {
                infoText.text = count > 0 ? count + "件のオブジェクトを選択中" : "オブジェクトを選択してください。";
                return;
            }

            try {
                var b = boundsOf(item);
                infoText.text =
                    "名前: " + nameOf(item) +
                    "\n種類: " + kindLabel(item) +
                    " / サイズ: " + b.width.toFixed(2) + " × " + b.height.toFixed(2) + " pt" +
                    " / 選択中: " + count + "件";
            } catch (_) {
                infoText.text = count + "件のオブジェクトを選択中";
            }
        }

        function addDestinationRows(container, depth) {
            var children = directChildren(container);
            var i, item, t, row;

            for (i = 0; i < children.length; i++) {
                item = children[i];
                t = typeOf(item);

                if (t === "Layer" || t === "GroupItem") {
                    row = destinationList.add(
                        "item",
                        indent(depth) + nameOf(item) + "  [" + kindLabel(item) + "]"
                    );
                    destinationRefs[row.index] = item;
                    addDestinationRows(item, depth + 1);
                }
            }
        }

        function addObjectRows(container, depth) {
            var children = directChildren(container);
            var i, item, row, refIndex, meta;

            for (i = 0; i < children.length; i++) {
                item = children[i];
                refIndex = objectRefs.length;
                objectRefs.push(item);

                meta = {
                    refIndex: refIndex,
                    depth: depth,
                    targetable: isTargetable(item),
                    listItem: null
                };

                row = objectList.add("item", "");
                meta.listItem = row;
                objectRows[row.index] = meta;
                row.text = rowText(meta);

                addObjectRows(item, depth + 1);
            }
        }

        function rebuildLists() {
            statusText.text = "読み込み中…";
            w.update();

            objectRefs = [];
            objectRows = [];
            destinationRefs = [];
            picked = {};

            destinationList.removeAll();
            objectList.removeAll();

            addDestinationRows(doc, 0);
            addObjectRows(doc, 0);

            countText.text = "0件選択";
            infoText.text = "オブジェクトを選択してください。";
            statusText.text = "準備完了";
            updateRunState();
            w.update();
        }

        destinationList.onChange = function () {
            try {
                if (destinationList.selection !== null) {
                    statusText.text = "作成先: " + destinationList.selection.text;
                }
                updateRunState();
            } catch (e) {
                showError(e);
            }
        };

        objectList.onClick = function () {
            try {
                var row = objectList.selection;
                if (row === null) return;

                var meta = objectRows[row.index];
                if (!meta || !meta.targetable) return;

                if (picked[meta.refIndex]) {
                    picked[meta.refIndex] = false;
                } else {
                    picked[meta.refIndex] = true;
                }

                row.text = rowText(meta);
                countText.text = selectedCount() + "件選択";

                var clickedItem = objectRefs[meta.refIndex];
                applyIllustratorSelection();
                focusItem(clickedItem);
                updateInfo(clickedItem);
                updateRunState();
            } catch (e) {
                showError(e);
            }
        };

        selectAllButton.onClick = function () {
            try {
                var i;
                for (i = 0; i < objectRefs.length; i++) {
                    if (isTargetable(objectRefs[i])) picked[i] = true;
                }
                refreshObjectRowTexts();
                countText.text = selectedCount() + "件選択";
                applyIllustratorSelection();
                updateInfo(null);
                updateRunState();
            } catch (e) {
                showError(e);
            }
        };

        clearButton.onClick = function () {
            try {
                picked = {};
                refreshObjectRowTexts();
                countText.text = "0件選択";
                try { doc.selection = null; } catch (_) {}
                app.redraw();
                updateInfo(null);
                updateRunState();
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
                if (destinationList.selection === null) return;

                var destination = destinationRefs[destinationList.selection.index];
                if (!destination) {
                    alert("作成先を取得できません。");
                    return;
                }

                var count = selectedCount();
                if (!count) return;

                if (!confirm(count + "件のオブジェクト上に緑色の要素を作成します。\n実行しますか？")) {
                    return;
                }

                var made = [];
                var failed = 0;
                var i, source, b, rect;

                for (i = 0; i < objectRefs.length; i++) {
                    if (!picked[i]) continue;

                    source = objectRefs[i];

                    try {
                        b = boundsOf(source);
                        if (b.width <= 0 || b.height <= 0) {
                            failed++;
                            continue;
                        }

                        rect = destination.pathItems.rectangle(
                            b.top,
                            b.left,
                            b.width,
                            b.height
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

                try { doc.selection = made; } catch (_) {}
                app.redraw();

                if (failed > 0) {
                    statusText.text = made.length + "件作成 / " + failed + "件失敗";
                    alert(made.length + "件を作成しました。\n" + failed + "件は作成できませんでした。");
                } else {
                    statusText.text = made.length + "件を作成しました。";
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
            try { $.global.__greenOverlayWindow = null; } catch (_) {}
        };

        w.show();
        w.update();
        rebuildLists();

    } catch (e) {
        showError(e);
    }
}());
