function supportsWebRTC() {
  // FIXME: this is to disable the currently-nonfunctioning RTC support
  return false;
  return !!(
    (window.mozRTCPeerConnection || window.RTCPeerConnection) &&
    (navigator.mozGetUserMedia || navigator.getUserMedia)
  );
}

if (window.mozRTCPeerConnection) {
  RTCPeerConnection = mozRTCPeerConnection;
}

if (navigator.mozGetUserMedia) {
  navigator.getUserMedia = navigator.mozGetUserMedia;
}

function setupAudio(callback, audioEl, offer) {
  if (offer) {
    console.log('Got offer, creating answer');
  } else {
    console.log('Creating offer');
  }
  var pc = new RTCPeerConnection();
  if (typeof audioEl == "string") {
    audioEl = document.getElementById(audioEl);
  }
  /*if (audioEl.tagName != "AUDIO") {
    // FIXME: add controls?
    var el = document.createElement("audio");
    audioEl.appendChild(el);
    audioEl = el;
  }*/
  if (audioEl.tagName != "VIDEO") {
    // FIXME: add controls?
    var el = document.createElement("video");
    el.style.width = '100%';
    audioEl.appendChild(el);
    audioEl = el;
  }
  console.log('creating media');
  // FIXME: change to audio
  console.log(navigator.mozGetUserMedia({video: true}, function (stream) {
    console.log('media created', stream);
    pc.addStream(stream);
    audioEl.mozSrcObject = stream;
    audioEl.play();
    if (offer) {
      console.log('setting remotedescription from offer');
      pc.setRemoteDescription(offer, function () {
        console.log('remotedescription set / making answer');
        pc.createAnswer(offer, function (answer) {
          console.log('createAnswer returned / setting localdescription');
          pc.setLocalDescription(answer, function () {
            console.log('setLocalDescription done');
            callback(null, {pc: pc, answer: answer});
          }, function (code) {
            callback({stage: 'setLocalDescription', code: code});
          });
        }, function (code) {
          callback({stage: 'createAnswer', code: code});
        });
      }, function (code) {
        callback({stage: 'setRemoteDescription', code: code});
      });
    } else {
      // We need to generate an offer
      console.log('creating offer');
      pc.createOffer(function (offer) {
        console.log('offer created / setting localDescription');
        pc.setLocalDescription(offer, function () {
          console.log('Finished description ready for callback');
          callback(null, {pc: pc, offer: offer});
        }, function (code) {
          callback({stage: 'setLocalDescription', code: code});
        });
      }, function (code) {
        callback({stage: 'createOffer', code: code});
      });
    }
  }, function (code) {
    console.error("No stream available");
    callback({stage: "getUserMedia", code: code});
  }));
  console.log('thing finished');
}

function respondToAnswer(callback, pc, answer) {
  pc.setRemoteDescription(function () {
    callback();
  }, function (code) {
    callback({stage: "setRemoteDescription", code: code});
  });
}
