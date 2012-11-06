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

function httpServer(server) {
  // Fixes problem where insecure content (like CSS from a site) isn't
  // served up because the viewer is over https.  Not sure what we
  // should really do.
  var livePrefix = 'https://browsermirror.ianbicking.org';
  if (server.indexOf(livePrefix) == 0) {
    return 'http://browsermirror.ianbicking.org:8080' + server.substr(livePrefix.length, server.length);
  }
  return server;
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
    share: httpServer(server) + '/' + id,
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
