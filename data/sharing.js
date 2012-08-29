self.port.on("ShareOn", function () {
  document.getElementById('share').innerHTML = 'sharing...';
});

self.port.on("ShareOff", function () {
  document.getElementById('share').innerHTML = 'share';
});
