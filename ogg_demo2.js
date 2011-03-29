load('struct.js');
load('bitstream.js');
load('stringio.js');
load('ogg.js');
load('vorbis.js');

var data = readFile('test2.ogg');
var f = new StringIO(data);

var v = new Vorbis(f);

print(v.vendor);
for (k in v.comments) {
  if (v.comments.hasOwnProperty(k)) {
    print(k+': '+v.comments[k]);
  }
}