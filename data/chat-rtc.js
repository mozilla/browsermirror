var pc;

function acceptRTC(data, networkCallback) {
  if (data.rtcOffer) {
    enableAudio(data.rtcOffer, networkCallback);
    document.getElementById('audio-chat').innerHTML = 'incoming chat';
  } else {
    respondToAnswer(function (error) {
      if (error) {
        // FIXME: not sure if we have console?
        console.error('Got error responding to answer:', error);
      }
      document.getElementById('audio-chat').innerHTML = 'chatting!';
    }, pc, data.rtcAnswer);
  }
}

function enableAudio(offer, networkCallback) {
  setupAudio(function (error, result) {
    if (error) {
      console.error('Got error enabling audio:', error);
      return;
    }
    pc = result.pc;
    if (result.offer) {
      networkCallback({rtcOffer: result.offer});
    } else {
      networkCallback({rtcAnswer: result.answer});
    }
  }, 'audio-container', offer);
}

function supportsWebRTC(networkCallback) {
  var el = document.getElementById('audio-chat-container');
  el.style.display = '';
  var button = document.getElementById('audio-chat');
  button.addEventListener('click', function () {
    document.getElementById('audio-chat'.innerHTML = 'chat request sent');
    enableAudio(networkCallback);
  }, false);
}
