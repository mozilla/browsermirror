/*
The main.js module handles the widget that activates sharing, and the
configuration for URLs
*/

const widgets = require("widget");
const data = require("self").data;
const tabs = require("tabs");
const { Sharer } = require("./sharer.js");
const { btoa } = require("chrome").Cu.import("resource://gre/modules/Services.jsm");
const simplePrefs = require('simple-prefs');
const { StartupPanel } = require("./startup-panel");

function getServer() {
  return simplePrefs.prefs.server.replace(/\/*$/, '');
}

function makeId() {
  if (simplePrefs.prefs.stickyShareId) {
    return simplePrefs.prefs.stickyShareId;
  }
  return btoa(Math.random()).replace(/=/g, '').substr(0, 10);
}

StartupPanel({
  name: "SeeItSaveIt",
  contentURL: data.url("startup-help.html")
});

var sharer = widgets.Widget({
  id: "browsermirror-sharer",
  label: "Share This Session",
  contentURL: data.url("sharing.html"),
  contentScriptFile: data.url("sharing.js"),
  onClick: startShare,
  width: 46
});

var sharingWorker = null;

function startShare() {
  if (sharingWorker) {
    sharingWorker.destroy();
    sharingWorker = null;
    sharer.port.emit("ShareOff");
    return;
  }
  var id = makeId();
  var server = getServer();
  var urls = {
    hub: server + '/hub/' + id,
    share: server + '/' + id,
    audioIframe: server + '/data/audio-iframe.html',
    loginIframe: server + '/data/login-iframe.html',
    blank: server + '/static/blank.html'
  };
  sharingWorker = new Sharer(tabs.activeTab, urls, function () {
    sharingWorker.destroy();
    sharingWorker = null;
    sharer.port.emit("ShareOff");
  });
  sharer.port.emit("ShareOn");
}
