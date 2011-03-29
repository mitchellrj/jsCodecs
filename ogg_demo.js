load('struct.js');
var f = readFile('test2.ogg');
var ogg_header_format = '4s2Bq3iB';
var common_header_format = 'B6s';
var id_header_format = 'IB4I2B';
var offset = 0;

var ogg_header = struct.unpack(ogg_header_format, f.slice(offset, offset+=struct.calcsize(ogg_header_format)));

var page_segments = ogg_header[ogg_header.length-1];
var segment_table = struct.unpack(page_segments+'B', f.slice(offset, offset+=page_segments));

var common_header = struct.unpack(common_header_format, f.slice(offset, offset+=struct.calcsize(common_header_format)));

var id_header = struct.unpack(id_header_format, f.slice(offset, offset+=struct.calcsize(id_header_format)));

ogg_header = struct.unpack(ogg_header_format, f.slice(offset, offset+=struct.calcsize(ogg_header_format)));
page_segments = ogg_header[ogg_header.length-1];
segment_table = struct.unpack(page_segments+'B', f.slice(offset, offset+=page_segments));

common_header = struct.unpack(common_header_format, f.slice(offset, offset+=struct.calcsize(common_header_format)));

var vendor_length = struct.unpack('I', f.slice(offset, offset+=4))[0];

var vendor = struct.unpack(vendor_length+'s', f.slice(offset, offset+=vendor_length))[0];
var user_comment_list_length = struct.unpack('I', f.slice(offset, offset+=4))[0];

var comments = [];
for (var c=0;c<user_comment_list_length;c++) {
  var comment_length = struct.unpack('I', f.slice(offset, offset+=4))[0];
  comments.push(struct.unpack(comment_length+'s', f.slice(offset, offset+=comment_length)))[0];
}
print ('Vendor\n======\n'+vendor+'\n');
print ('Comments\n========');
print (comments.join('\n'));
