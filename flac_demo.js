load('struct.js');
load('stringio.js');
load('bitstream.js');
load('flac.js');
var s = new StringIO(readFile('test.flac'));
var f = new Flac(s);