/**
 * WebAID Background Service Worker
 * Handles context menu for "Add note to selection"
 */

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "ua-add-note",
        title: "📝 Add note to selection",
        contexts: ["selection"],
    });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "ua-add-note" && info.selectionText) {
        chrome.tabs.sendMessage(tab.id, {
            action: "addNote",
            text: info.selectionText,
        });
    }
});
