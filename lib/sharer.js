const { EchoProxy, PostMessageChannel } = require("./channels.js");
const data = require("self").data;
const clipboard = require("clipboard");
const Sidebar = require("./sidebar").Sidebar;
const tabs = require("tabs");
const Page = require("page-worker").Page;


function Sharer(tab, urls, onclose) {
  this.tab = tab;
  this.urls = urls;
  this.onclose = onclose;
  this.sidebar = new Sidebar({
    title: 'Sharing',
    url: data.url('chat.html'),
    onReady: (function () {
      this.bindChatEvents();
    }).bind(this),
    showForTab: (function (tab) {
      return tab == this.tab;
    }).bind(this),
    onClose: (function (event) {
      this.onclose();
    }).bind(this)
  });
  this.tabActivate = this.tabActivate.bind(this);
  tabs.on("activate", this.tabActivate);
  this.attachWorker = this.attachWorker.bind(this);
  this.tab.on("ready", this.attachWorker);
  this.socketProxier = new SocketProxier(this.urls.hub, this.urls.blank);
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
    this.tab.removeListener("ready", this.attachWorker);
  },

  attachWorker: function () {
    if (this.worker) {
      console.log('Destroying worker:', this.worker.description);
      this.worker.destroy();
      this.worker = null;
    }
    this.worker = this.tab.attach({
      contentScriptFile: [
        data.url("logging.js"),
        data.url("channels.js"),
        data.url("rtc.js"),
        data.url("mirror.js"),
        data.url("share-worker.js")
      ]
    });
    this.worker.description = 'Mirror worker for: ' + this.tab.url;
    console.log('Created worker for:', this.worker.description);
    this.socketProxier.bindWorker(this.worker);
    this.worker.port.emit("StartShare", this.urls.hub, this.urls.share);
    this.worker.port.on("ChatMessage", (function (message, here) {
      this.addChat(message, here);
    }).bind(this));
    this.worker.port.on("RTC", this.acceptRTC.bind(this));
    this.worker.port.on("SupportsWebRTC", this.supportsWebRTC.bind(this));
  },

  bindChatEvents: function () {
    var doc = this.sidebar.window().document;
    /*
    var highlightButton = doc.getElementById('jsmirror-highlight');
    if (highlightButton) {
      highlightButton.addEventListener('click', (function () {
        this.worker.port.emit("Highlight");
        highlightButton.style.backgroundColor = '#f00';
        highlightButton.style.color = '#fff';
      }).bind(this), false);
    }*/
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
    shareUrl.href = this.urls.share;
    var shareField = doc.getElementById('jsmirror-share-field');
    shareField.value = this.urls.share;
    shareField.addEventListener("change", (function () {
      shareField.value = this.urls.share;
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
      clipboard.set(this.urls.share, 'text');
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
    el.className = 'chat-message';
    if (here) {
      el.className += ' chat-local';
    } else {
      el.className += ' chat-remote';
    }
    el.appendChild(doc.createTextNode(message));
    var container = doc.getElementById('jsmirror-chat');
    container.appendChild(el);
  },

  tabActivate: function () {
    // FIXME: this isn't quite right, since it's just whether a share
    // is active in the current window, not anywhere, but the button
    // is effectively global
    /*
    if (tabs.activeTab != this.tab) {
      sharer.port.emit("ShareOff");
    } else {
      sharer.port.emit("ShareOn");
    }*/
  },

  acceptRTC: function (data) {
    var iframe = this.getChatIframe();
    iframe.channel.send(data);
  },

  supportsWebRTC: function () {
    var doc = this.sidebar.window().document;
    doc.getElementById('audio-chat-container').style.display = '';
    var chatEl = doc.getElementById('audio-chat');
    chatEl.addEventListener('click', (function () {
      chatEl.innerHTML = 'chat request sent';
      this.getChatIframe().send({wantOffer: true});

    }).bind(this), false);
  },

  getChatIframe: function () {
    if (! this._chatIframe) {
      var doc = this.sidebar.window().document;
      this._chatIframe = new ChatIframe(
        doc.getElementById('audio-iframe'), this.urls.chatIframe,
        this.socketProxier);
    }
    return this._chatIframe;
  }
};

exports.Sharer = Sharer;

function ChatIframe(iframe, iframeUrl, proxier) {
  iframe.src = iframeUrl;
  this.iframe = iframe;
  this.channel = new PostMessageChannel(iframe);
  this.proxier = proxier;
  this.channel.onmessage = (function (data) {
    this.proxier.send(data);
  }).bind(this);
}

ChatIframe.prototype = {
  send: function (data) {
    this.channel.send(data);
  }
};

function SocketProxier(hubUrl, blankUrl) {
  this.bindings = [];
  this.wsWorker = Page({
    contentScriptFile: [
      data.url("channels.js"),
      data.url("wsecho.js")
    ],
    contentURL: blankUrl
  });
  this.wsWorker.description = 'Socket forwarder';
  this.wsWorker.port.emit("StartProxier", hubUrl);
  this.consumerWorker = null;
  this._proxy = null;
}

SocketProxier.prototype = {
  destroy: function () {
    this.wsWorker.destroy();
    this.wsWorker = null;
    this.closeProxy();
  },

  bindWorker: function (worker) {
    this.closeProxy();
    this.consumerWorker = worker;
    this._proxy = EchoProxy(this.consumerWorker, this.wsWorker);
  },

  closeProxy: function () {
    if (this._proxy) {
      this._proxy.close();
      this._proxy = null;
    }
  },

  send: function (data) {
    this._proxy.send(data);
  }

};
