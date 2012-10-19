var expectedOrigin = null;
var source;

var pc;

// console messages don't show up in this context:
console = {
  log: function () {
    var s = "";
    for (var i=0; i<arguments.length; i++) {
      if (s) {
        s += " ";
      }
      if (typeof arguments[i] == "string") {
        s += arguments[i];
      } else {
        s += JSON.stringify(arguments[i]);
      }
    }
    alert(s);
  }
};
console.warn = console.error = console.info = console.debug = console.log;

var channel = new ChromePostMessageIncomingChannel();
channel.onmessage = function (data) {
  alert('CHAT MSG:' + JSON.stringify(data));
  if (data.wantOffer) {
    setupAudio(function (error, result) {
      if (error) {
        console.warn("Error doing setup:", error);
        // FIXME: Should probably message back that it didn't work
        return;
      }
      pc = result.pc;
      channel.send({rtcOffer: result.offer});
    }, "audio-chat");
  } else if (data.rtcOffer) {
  try{
    setupAudio(function (error, result) {
    alert('returned');
      if (error) {
        alert("Error doing setup with offer:", error);
        return;
      }
      pc = result.pc;
      alert('got offer, sending answer');
      channel.send({rtcAnswer: result.answer});
    }, "audio-chat", data.rtcOffer);
    }catch(e){alert("Error in setupAudio: " + e);}
  } else if (data.rtcAnswer) {
    respondToAnswer(function (error) {
    }, pc, data.rtcAnswer);
  }
};
