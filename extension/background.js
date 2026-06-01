// background.js — opens the bracket (a new tab, which is our override) when
// the toolbar button is clicked.
const api = typeof browser !== "undefined" ? browser : chrome;

api.action.onClicked.addListener(() => {
  api.tabs.create({});
});
