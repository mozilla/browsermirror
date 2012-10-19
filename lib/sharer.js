const { EchoProxy, ChromePostMessageChannel } = require("./channels.js");
const { data } = require("self");
const clipboard = require("clipboard");
const { Sidebar } = require("./sidebar");
const tabs = require("tabs");
const { Page } = require("page-worker");
const { setInterval } = require("timers");


function Sharer(tab, urls, onclose) {
  this.tab = tab;
  this.urls = urls;
  this._onclose = onclose;
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
  this.pollForBack();
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

  onclose: function () {
    this.socketProxier.send({chatMessage: "Bye!", bye: true});
    if (this._onclose) {
      this._onclose();
    }
  },

  pollForBack: function () {
    // FIXME: this is a hack for the tab ready event not firing when you hit "back"
    setInterval((function () {
      if (this.tab.url != this.expectedAttachedUrl) {
        console.log("Got a tab refresh, possibly because of a Back button");
        this.attachWorker();
      }
    }).bind(this), 100);
  },

  attachWorker: function () {
    if (this.worker) {
      console.log('Destroying worker:', this.worker.description);
      this.worker.destroy();
      this.worker = null;
    }
    this.expectedAttachedUrl = this.tab.url;
    this.worker = this.tab.attach({
      contentScriptFile: [
        data.url("logging.js"),
        data.url("channels.js"),
        data.url("rtc.js"),
        data.url("freeze.js"),
        data.url("domutils.js"),
        data.url("master.js"),
        data.url("share-worker.js")
      ]
    });
    this.worker.description = 'Mirror worker for: ' + this.tab.url;
    console.log('Created worker for:', this.worker.description);
    this.socketProxier.bindWorker(this.worker);
    this.worker.port.emit("StartShare", this.urls.hub, this.urls.share);
    this.worker.port.on("LocalMessage", this.processLocalMessage.bind(this));
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
        this.socketProxier.send({chatMessage: message});
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

  processLocalMessage: function (message) {
    if (message.chatMessage) {
      this.addChat(message.chatMessage, message.local, message.messageId);
    } else if (message.arrowUpdate) {
      // FIXME: do this
    } else if (message.connected) {
      var doc = this.sidebar.window().document;
      var id = "browsermirror-bye-" + message.connected;
      var el = doc.getElementById(id);
      if (el) {
        el.innerHTML = "";
        el.appendChild(doc.createTextNode("Reconnected"));
      }
    } else {
      console.warn("Got unexpected local message:", JSON.stringify(message));
    }
  },

  addChat: function (message, here, messageId) {
    var doc = this.sidebar.window().document;
    var el = doc.createElement('div');
    if (messageId) {
      el.id = messageId;
    }
    var prevEl = doc.getElementById(messageId);
    if (prevEl) {
      prevEl.parentNode.removeChild(prevEl);
    }
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
    console.log('sending message', data, iframe.channel.toString());
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
      // FIXME: this is probably too early to reveal the iframe:
      doc.getElementById('audio-container').style.display = '';
      console.log('opening iframe', this.urls.audioIframe);
      this._chatIframe = new ChatIframe(
        doc.getElementById('audio-iframe'), doc, this.urls.audioIframe,
        this.socketProxier);
    }
    return this._chatIframe;
  }
};

exports.Sharer = Sharer;

function ChatIframe(iframe, doc, iframeUrl, proxier) {
  iframe.src = iframeUrl;
  this.iframe = iframe;
  this.channel = new ChromePostMessageChannel(iframe, doc);
  this.proxier = proxier;
  this.channel.onmessage = (function (data) {
    console.log('proxying on chat message:', data);
    this.proxier.send(data);
  }).bind(this);
}

ChatIframe.prototype = {
  toString: function () {
    return '[ChatIframe src: ' + this.iframe.src + ' channel: ' + this.channel + ']';
  },
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
