var connection = null;

var hub = location.pathname.replace(/\/*$/, '');
var address = location.protocol + "//" + location.host + "/hub" + hub;
var channel = new WebSocketChannel(address);
var outgoing = new PostMessageChannel(null);
outgoing.rawdata = true;
outgoing.onmessage = function (data) {
  channel.send(data);
};

channel.send({hello: true, isMaster: false, supportsWebRTC: supportsWebRTC()});
channel.onmessage = function (data) {
  //console.log('incoming message', data);
  if (data.chatMessages) {
    for (var i=0; i<data.chatMessages.length; i++) {
      displayMessage(data.chatMessages[i], false);
    }
    return;
  }
  if (data.rtcOffer) {
    console.log('Got remote offer');
    enableAudio(data.rtcOffer);
    document.getElementById('audio-chat').innerHTML = 'incoming chat';
    return;
  }
  if (data.rtcAnswer) {
    console.log('Got remote answer');
    respondToAnswer(function (error) {
      if (error) {
        console.error("Error setting up answer:", error);
        return;
      }
      document.getElementById('audio-chat').innerHTML = 'chatting!';
    }, pc, data.rtcAnswer);
    return;
  }
  if (data.hello) {
    channel.send({helloBack: true, isMaster: false, supportsWebRTC: supportsWebRTC()});
  }
  if (data.supportsWebRTC && supportsWebRTC()) {
    var el = document.getElementById('audio-chat-container');
    el.style.display = '';
    var button = document.getElementById('audio-chat');
    button.addEventListener('click', function () {
      document.getElementById('audio-chat').innerHTML = 'chat request sent';
      enableAudio();
    }, false);
  }
  if (data.doc && data.doc.href) {
    setUrl(data.doc.href);
  }
  outgoing.send(data);
};

var chatDiv;
var chatInput;
var urlEl;

window.addEventListener('load', function () {
  var iframe = document.getElementById('iframe-window');
  outgoing.bindWindow(iframe);
  chatDiv = document.getElementById('jsmirror-chat');
  chatInput = document.getElementById('jsmirror-input');
  urlEl = document.getElementById('jsmirror-url');
  chatInput.addEventListener('keypress', function (event) {
    if (event.keyCode == 13) { // Enter
      var message = chatInput.value;
      displayMessage(message, true);
      channel.send({chatMessages: [message]});
      chatInput.value = '';
    }
  }, false);
}, false);

function displayMessage(message, here) {
  var div;
  if (typeof message == "string") {
    div = document.createElement('div');
    div.style.margin = '0';
    div.style.padding = '2px';
    div.style.borderBottom = '1px solid #888';
    if (! here) {
      div.style.backgroundColor = '#666';
    }
    div.appendChild(document.createTextNode(message));
  } else {
    div = message;
    if (! here) {
      div.style.backgroundColor = '#666';
    }
  }
  chatDiv.appendChild(div);
}

function setUrl(url) {
  if (urlEl) {
    urlEl.href = url;
    urlEl.innerHTML = '';
    urlEl.appendChild(document.createTextNode(url));
  } else {
    setTimeout(function () {
      setUrl(url);
    }, 100);
  }
}

var pc;

function enableAudio(offer) {
  setupAudio(function (error, result) {
    if (error) {
      console.error('Got error enabling audio:', error);
      return;
    }
    pc = result.pc;
    console.log('setup', result);
    var msg;
    if (result.offer) {
      msg = {rtcOffer: result.offer};
    } else {
      msg = {rtcAnswer: result.answer};
    }
    console.log('sending', JSON.stringify(msg));
    channel.send(msg);
  }, 'audio-container', offer);
}
