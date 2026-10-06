#target illustrator
#targetengine "greenOverlayEngine"

(function () {
    // Read-only diagnostics. Never read document/artwork names, text, files,
    // coordinates, image data, or error messages; report fixed types and counts.
    var types = ["Document", "Layer", "GroupItem", "CompoundPathItem", "PathItem", "TextFrame", "PlacedItem", "RasterItem", "SymbolItem", "MeshItem", "PluginItem", "GraphItem", "NonNativeItem", "LegacyTextItem"];
    var props = ["pageItems", "groupItems", "compoundPathItems", "pathItems", "textFrames", "placedItems", "rasterItems", "symbolItems", "meshItems", "pluginItems", "graphItems", "nonNativeItems", "legacyTextItems"];
    var lines = ["desk-tools-artwork-diagnostic-v1"], treeCounts = {}, parentStats = {}, containers = [], failures = 0;
    var inspected = 0, limit = 100000, limited = false;
    function kind(item) {
        var t;
        try { t = item.typename; } catch (_) { return "Unknown"; }
        for (var i = 0; i < types.length; i++) if (t === types[i]) return t;
        return "Unknown";
    }
    function increment(counts, t) { counts[t] = (counts[t] || 0) + 1; }
    function same(a, b) {
        try { if (a === b || a == b) return true; } catch (_) {}
        if (kind(a) !== kind(b)) return false;
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
    function each(owner, prop, visit) {
        if (limited) return;
        try {
            var col = owner[prop], n = col ? col.length : 0;
            for (var i = 0; i < n; i++) {
                if (inspected >= limit) { limited = true; return; }
                inspected++;
                try { visit(col[i]); } catch (_) { failures++; }
            }
        } catch (_) { failures++; }
    }
    function addContainer(item) {
        if (!item) return;
        if (containers.length >= 2048) { limited = true; return; }
        for (var i = 0; i < containers.length; i++) if (same(containers[i], item)) return;
        containers.push(item);
    }
    function collectLayers(owner) {
        each(owner, "layers", function (layer) {
            var before = containers.length;
            addContainer(layer);
            if (containers.length !== before) collectLayers(layer);
        });
    }
    function inspectParent(item, container) {
        var t = kind(item), p = null, status = "rejected", clipped = false;
        var s = parentStats[t] || (parentStats[t] = {accepted:0, rejected:0, unreadable:0, parents:{}});
        try { p = item.parent; } catch (_) { status = "unreadable"; }
        if (p) {
            increment(s.parents, kind(p));
            if (same(p, container)) status = "accepted";
        }
        if (status !== "accepted" && kind(container) === "GroupItem") {
            try { clipped = !!container.clipped; } catch (_) {}
            if (clipped) {
                if (p && (kind(p) === "Layer" || kind(p) === "Document")) status = "accepted";
                if (!p) try { if (item.clipping) status = "accepted"; } catch (_) {}
            }
        }
        s[status]++;
    }
    function readRows(items) {
        if (!items) return;
        for (var i = 0; i < items.length; i++) {
            var row = items[i];
            try {
                if (row._entry && !row._entry.descendantToggle) increment(treeCounts, kind(row._entry.ref));
                readRows(row.items);
            } catch (_) { failures++; }
        }
    }
    function readControls(control) {
        if (!control) return;
        if (control.type === "treeview") { readRows(control.items); return; }
        var children = control.children;
        if (children) for (var i = 0; i < children.length; i++) readControls(children[i]);
    }
    function countsLine(counts) {
        var out = [], all = types.concat(["Unknown"]);
        for (var i = 0; i < all.length; i++) if (counts[all[i]]) out.push(all[i] + "=" + counts[all[i]]);
        return out.length ? out.join(" ") : "none";
    }
    function show() {
        var w = new Window("dialog", "要素一覧の診断（件数のみ）");
        w.orientation = "column"; w.alignChildren = ["fill", "top"];
        w.add("statictext", undefined, "文書名・文字内容・画像・ファイル名・座標は読み取りません。");
        w.add("statictext", undefined, "下の結果をクリックし、Ctrl/Cmd+A → Ctrl/Cmd+C でコピーしてください。");
        var report = w.add("edittext", undefined, lines.join("\n"), {multiline:true, scrolling:true, readonly:true});
        report.preferredSize = [760, 460];
        w.add("button", undefined, "閉じる", {name:"ok"});
        w.show();
    }
    try {
        if (!app.documents.length) { lines.push("No open document"); show(); return; }
        var doc = app.activeDocument;
        var version = "unknown";
        try { var match = String(app.version).match(/^[0-9]+(?:\.[0-9]+)*/); if (match) version = match[0]; } catch (_) {}
        lines.push("Illustrator=" + version);
        lines.push("DOCUMENT COLLECTION LENGTHS (not unique totals)");
        for (var i = 0; i < props.length; i++) {
            try { var col = doc[props[i]]; lines.push(props[i] + "=" + (col ? col.length : 0)); }
            catch (_) { lines.push(props[i] + "=unreadable"); }
        }
        var nativeCounts = {};
        each(doc, "pageItems", function (item) { increment(nativeCounts, kind(item)); });
        lines.push("DOCUMENT pageItems sampled types: " + countsLine(nativeCounts));
        var loaded = null;
        try { loaded = $.global.__greenOverlayWindow; } catch (_) {}
        lines.push("OverlayWindow=" + (loaded ? "present" : "absent"));
        readControls(loaded);
        lines.push("LOADED TARGET TREE: " + countsLine(treeCounts));
        collectLayers(doc);
        each(doc, "groupItems", addContainer);
        each(doc, "compoundPathItems", addContainer);
        lines.push("PARENT FILTER OBSERVATIONS (repeated collection memberships)");
        for (i = 0; i < containers.length && !limited; i++) {
            var container = containers[i];
            var scanProps = kind(container) === "CompoundPathItem" ? ["pathItems"] : props;
            for (var j = 0; j < scanProps.length && !limited; j++) {
                each(container, scanProps[j], function (item) { inspectParent(item, container); });
            }
        }
        var all = types.concat(["Unknown"]);
        for (i = 0; i < all.length; i++) {
            var s = parentStats[all[i]];
            if (s) lines.push(all[i] + ": accepted=" + s.accepted + " rejected=" + s.rejected + " unreadable=" + s.unreadable + " parentTypes=" + countsLine(s.parents));
        }
        lines.push("containers=" + containers.length + " inspected=" + inspected + " readFailures=" + failures + " sampleLimitReached=" + limited);
        lines.push("Sample limits: 100000 collection observations / 2048 containers");
    } catch (_) { lines.push("Diagnostic failed (details omitted to avoid exposing document data)"); }
    show();
})();
