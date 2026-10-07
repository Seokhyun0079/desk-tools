#target illustrator
#targetengine "greenOverlayEngine"

// Keep this file beside the green-overlay/ directory.
(function () {
#include "green-overlay/logging.jsxinc"
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
        var activeLayerEntry = null;
        var suppressObjectEvent = 0;
        var inObjectListHandler = false;
        var cachedZoom = 1;
        try {
            if (doc.views.length > 0) cachedZoom = doc.views[0].zoom;
        } catch (_) {}

#include "green-overlay/model.jsxinc"
#include "green-overlay/bounds.jsxinc"
#include "green-overlay/ui.jsxinc"
#include "green-overlay/bridge.jsxinc"
#include "green-overlay/tree.jsxinc"
#include "green-overlay/execute.jsxinc"
#include "green-overlay/actions.jsxinc"

        enableLists(false);
        try { w.layout.layout(true); } catch (e) { logEvent("ui.layout", e); }
        w.show();
        w.update();
        rebuildTrees();

    } catch (e) {
        showError(e);
    }
}());
