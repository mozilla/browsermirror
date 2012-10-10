const widgets = require("widget");
const simplePrefs = require('simple-prefs');
const data = require("self").data;
const { atob, btoa } = require("chrome").Cu.import("resource://gre/modules/Services.jsm");
const Page = require("page-worker").Page;
const tabs = require("tabs");
const clipboard = require("clipboard");
const Sidebar = require("./sidebar").Sidebar;

function getServer() {
  return simplePrefs.prefs.server.replace(/\/*$/, '');
}

function makeId() {
  if (simplePrefs.prefs.stickyShareId) {
    return simplePrefs.prefs.stickyShareId;
  }
  return btoa(Math.random()).replace(/=/g, '').substr(0, 10);
}

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
  var address = getServer() + '/hub/' + id;
  var shareUrl = getServer() + '/' + id;
  sharingWorker = new Sharer(tabs.activeTab, address, shareUrl);
  sharer.port.emit("ShareOn");
}

function Sharer(tab, serverAddress, shareUrl) {
  this.tab = tab;
  this.serverAddress = serverAddress;
  this.shareUrl = shareUrl;
  this.sidebar = new Sidebar({
    title: 'Sharing',
    url: data.url('chat.html'),
    onReady: (function () {
      this.bindEvents();
    }).bind(this),
    showForTab: (function (tab) {
      return tab == this.tab;
    }).bind(this),
    onClose: (function (event) {
      this.destroy();
      sharingWorker = null;
    }).bind(this)
  });
  this.tabActivate = this.tabActivate.bind(this);
  tabs.on("activate", this.tabActivate);
  this.attachWorker = this.attachWorker.bind(this);
  this.tab.on("ready", this.attachWorker);
  this.socketProxier = new SocketProxier();
  this.attachWorker();
}

Sharer.prototype = {

  destroy: function () {
    this.worker.destroy();
    this.worker = null;
    this.sidebar.destroy();
    this.sidebar = null;
    if (this.socketProxier) {
      this.socketProxier.destroy();
      this.socketProxier = null;
    }
    tabs.removeListener("activate", this.tabActivate);
  },

  attachWorker: function () {
    if (this.worker) {
      this.worker.destroy();
    }
    this.worker = this.tab.attach({
      contentScriptFile: [
        data.url("wsecho.js"),
        data.url("network.js"),
        data.url("mirror.js"),
        data.url("share-worker.js")
      ]
    });
    this.socketProxier.bindWorker(this.worker);
    this.worker.port.emit("StartShare", this.serverAddress, this.shareUrl);
    this.worker.port.on("ChatMessage", (function (message, here) {
      this.addChat(message, here);
    }).bind(this));
  },

  bindEvents: function () {
    var doc = this.sidebar.window().document;
    var highlightButton = doc.getElementById('jsmirror-highlight');
    highlightButton.addEventListener('click', (function () {
      this.worker.port.emit("Highlight");
      highlightButton.style.backgroundColor = '#f00';
      highlightButton.style.color = '#fff';
    }).bind(this), false);
    var chatInput = doc.getElementById('jsmirror-input');
    chatInput.addEventListener('keypress', (function (event) {
      if (event.keyCode == 13) { // Enter
        var message = chatInput.value;
        this.addChat(message, true);
        this.worker.port.emit("ChatInput", message);
        chatInput.value = '';
      }
    }).bind(this), false);
    var shareUrl = doc.getElementById('jsmirror-share-url');
    shareUrl.href = this.shareUrl;
    var shareField = doc.getElementById('jsmirror-share-field');
    shareField.value = this.shareUrl;
    shareField.addEventListener("change", (function () {
      shareField.value = this.shareUrl;
    }).bind(this), false);
    var shareText = doc.getElementById('jsmirror-share-text');
    shareUrl.addEventListener('click', (function (event) {
      event.preventDefault();
      event.stopPropagation();
      shareUrl.style.display = 'none';
      shareField.style.display = '';
      shareText.style.display = '';
      shareField.focus();
      shareField.select();
      clipboard.set(this.shareUrl, 'text');
    }).bind(this), false);
    shareField.addEventListener('blur', function () {
      shareField.style.display = 'none';
      shareText.style.display = 'none';
      shareUrl.style.display = '';
    }, false);
    shareText.addEventListener('click', function (event) {
      // We don't want clicking the label to cause a blur
      // FIXME: doesn't work, I guess the blur happens first
      shareField.focus();
      shareField.select();
      event.preventDefault();
      event.stopPropagation();
    }, false);
  },

  addChat: function (message, here) {
    var doc = this.sidebar.window().document;
    var el = doc.createElement('div');
    el.style.margine = '0';
    el.style.padding = '2px';
    el.style.borderBottom = '1px solid #888';
    if (! here) {
      el.style.backgroundColor = '#fff';
    }
    el.appendChild(doc.createTextNode(message));
    var container = doc.getElementById('jsmirror-chat');
    container.appendChild(el);
  },

  tabActivate: function () {
    if (tabs.activeTab != this.tab) {
      sharer.port.emit("ShareOff");
    } else {
      sharer.port.emit("ShareOn");
    }
  }

};

function SocketProxier() {
  this.id = parseInt(Math.random() * 1000);
  this.bindings = [];
  this.wsWorker = Page({
    contentScriptFile: data.url("wsecho.js"),
    contentURL: getServer() + "/static/blank.html"
  });
  this.wsWorker.port.emit("startProxier");
  this.consumerWorker = null;
}

SocketProxier.prototype = {
  destroy: function () {
    this.wsWorker.destroy();
    for (var i=0; i<this.bindings.length; i++) {
      var b = this.bindings[i];
      b[0].removeListener(b[1], b[2]);
    }
  },

  bindWorker: function (worker) {
    this.consumerWorker = worker;
    for (var i=0; i<this.bindings.length; i++) {
      var b = this.bindings[i];
      b[0].removeListener(b[1], b[2]);
    }
    this.echo(["eventOpened", "eventClosed", "dataReceived"],
              this.wsWorker, this.consumerWorker);
    this.echo(["openConnection", "close", "sendData"],
              this.consumerWorker, this.wsWorker);
  },

  echo: function (names, fromWorker, toWorker) {
    names.forEach(function (name) {
      var func = (function () {
        var args = [name];
        for (var i=0; i<arguments.length; i++) {
          args.push(arguments[i]);
        }
        toWorker.port.emit.apply(toWorker.port, args);
      }).bind(this);
      fromWorker.port.on(name, func);
      this.bindings.push([fromWorker, name, func]);
    }, this);
  }
};
