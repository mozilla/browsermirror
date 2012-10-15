var expectedOrigin = null;
var source;

var pc;

var channel = new PostMessageIncomingChannel();
channel.onmessage = function (data) {
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
    setupAudio(function (error, result) {
      if (error) {
        console.warn("Error doing setup with offer:", error);
        return;
      }
      pc = result.pc;
      channel.send({rtcAnswer: result.answer});
    }, "audio-chat", data.rtcOffer);
  } else if (data.rtcAnswer) {
    respondToAnswer(function (error) {
    }, pc, data.rtcAnswer);
  }
};
