#target illustrator
#targetengine "greenOverlayEngine"

(function () {
    // Constant-size, read-only report. No collection elements, artwork properties,
    // layer recursion, UI-tree traversal, parent checks, or identity comparisons.
    var props = ["pageItems", "groupItems", "compoundPathItems", "pathItems", "textFrames", "placedItems", "rasterItems", "symbolItems", "meshItems", "pluginItems", "graphItems", "nonNativeItems", "legacyTextItems"];
    var types = ["Layer", "GroupItem", "CompoundPathItem", "PathItem", "TextFrame", "PlacedItem", "RasterItem", "SymbolItem", "MeshItem", "PluginItem", "GraphItem", "NonNativeItem", "LegacyTextItem", "Unknown"];
    try {
        var previous = $.global.__artworkDiagnosticWindow;
        if (previous) previous.close();
    } catch (_) {}
    var w = new Window("palette", "要素一覧の診断（基本件数のみ）");
    $.global.__artworkDiagnosticWindow = w;
    w.orientation = "column"; w.alignChildren = ["fill", "top"];
    w.add("statictext", undefined, "文書の種類別件数のみ取得します。要素や階層は走査しません。");
    w.add("statictext", undefined, "結果欄をクリックし、Ctrl/Cmd+A → Ctrl/Cmd+C でコピーしてください。");
    var report = w.add("edittext", undefined, "基本件数を取得中…", {multiline:true, scrolling:true, readonly:true});
    report.preferredSize = [760, 420];
    var close = w.add("button", undefined, "閉じる");
    close.onClick = function () { w.close(); };
    w.onClose = function () { $.global.__artworkDiagnosticWindow = null; return true; };
    // Show the report before any document access. Host property reads can still
    // block individually; do not claim they are asynchronous or interruptible.
    w.show(); w.update();
    var lines = ["desk-tools-artwork-diagnostic-v2", "Mode=basic-counts-only (no artwork scan)"];
    try {
        if (!app.documents.length) {
            lines.push("No open document");
        } else {
            var doc = app.activeDocument;
            var version = "unknown";
            try { var match = String(app.version).match(/^[0-9]+(?:\.[0-9]+)*/); if (match) version = match[0]; } catch (_) {}
            lines.push("Illustrator=" + version);
            lines.push("DOCUMENT COLLECTION LENGTHS (not unique totals)");
            for (var i = 0; i < props.length; i++) {
                try { var col = doc[props[i]]; lines.push(props[i] + "=" + (col ? col.length : 0)); }
                catch (_) { lines.push(props[i] + "=unreadable"); }
                report.text = lines.join("\n"); w.update();
            }
            // The overlay captures this plain-data snapshot during its existing
            // load. Diagnostics never rereads its artwork references or UI nodes.
            var snapshot = $.global.__greenOverlayDiagnostic;
            if (snapshot && snapshot.schema === "overlay-counts-v1") {
                lines.push("OverlaySnapshot=" + (snapshot.state === "ready" ? "ready" : "not-ready"));
                lines.push("LOADED TARGET COUNTS (cached during overlay load)");
                for (i = 0; i < types.length; i++) {
                    var n = snapshot.counts[types[i]];
                    if (typeof n === "number" && isFinite(n) && n > 0) lines.push(types[i] + "=" + n);
                }
            } else {
                lines.push("OverlaySnapshot=unavailable (run updated overlay to include cached counts)");
            }
        }
    } catch (_) { lines.push("Basic counts unavailable (error details omitted)"); }
    report.text = lines.join("\n"); w.update();
})();
